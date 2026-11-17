import { S, createEffect } from "envio";
import { type PublicClient, parseAbi } from "viem";
import { PoolId } from "../Constants";
import {
  type CanonicalSourcePool,
  getCanonicalSourcePools,
} from "../PriceOverrides";
import {
  type PricingCandidate,
  buildPricingCandidate,
  selectPricingCandidate,
} from "../Pricing/PoolRoute";
import { ONE_USD, getMinPricingDepthUSD } from "../Pricing/PricingConfig";
import {
  type BlockSample,
  type ChainClock,
  calibrateChainClock,
  findBlockAtOrBefore,
} from "./BlockAtTimestamp";
import { executeRpc, isCacheableResult } from "./RpcGateway";

/**
 * The canonical source's price read from its own chain over RPC
 * (docs/adr/0010-canonical-source-rpc-price.md). A leaf token with a canonical
 * source (WETH on a leaf chain → Optimism WETH, XVELO → Optimism VELO, xAERO →
 * Base AERO; `CANONICAL_SOURCES` in src/PriceOverrides.ts) that has no
 * qualifying local pool asks, in order: the committed seed, the source chain's
 * own snapshots in ClickHouse (`getCanonicalSourcePrice`), and then this.
 *
 * It exists for one window: a backfill in per-chain mode, where a leaf chain
 * processes hours past the seed's end before the source chain has indexed
 * them. Without it the leaf token carries its last price through that window,
 * and the result stays in history.
 *
 * What is read: the source's configured pools against a pinned stablecoin
 * (`CANONICAL_SOURCE_POOLS`), at one block
 * {@link CANONICAL_RPC_MARGIN_SECONDS} before the start of the asking block's
 * clock hour. The deepest pool that passes the source chain's own pricing
 * rules (depth floor, imbalance bound, price ceiling) sets the price.
 *
 * RPC volume is small by construction: the cache key is (source, hour), so an
 * hour is read once for every leaf chain, token and worker that asks; a read
 * is one `eth_getBlockByNumber` (after a one-time calibration per chain) plus
 * one batched request for the pools. Three sources cost about 7 calls per hour
 * of the window.
 *
 * `PRICING_CANONICAL_RPC_EFFECT=false` turns it off
 * (see `readCanonicalPriceSettings` in src/Effects/CanonicalSourcePrice.ts).
 */

const HOUR_MS = 3_600_000;

/**
 * How long before the hour's start the source block is taken. The asking block
 * is inside the hour, so the block read is at least this old on the wall clock
 * and is final however the indexer is running (envio's reorg window is 200
 * blocks, 400 s on Optimism and 40 s on Base). Effect cache rows are never
 * rolled back, so only a final block may be cached.
 */
export const CANONICAL_RPC_MARGIN_SECONDS = 600;

/**
 * After a failed RPC read, further reads are skipped (answered as "not yet",
 * uncached) for this long, so an outage costs one round of retries per minute
 * rather than one per token-hour.
 */
export const CANONICAL_RPC_BACKOFF_MS = 60_000;

/** A source pool's state at one block. */
export interface SourcePoolRead {
  /** Token0 held by the pool (CL: its balance; V2: its reserve), raw units. */
  readonly reserve0: bigint;
  /** Token1 held by the pool, raw units. */
  readonly reserve1: bigint;
  /** CL pools only. */
  readonly sqrtPriceX96?: bigint;
}

/** What the effect decided for one source hour. */
export type CanonicalRpcPriceDecision =
  | {
      readonly kind: "price";
      /** The source's USD price, 1e18-base. */
      readonly priceUSD: bigint;
      /** Stablecoin-side depth of the pool used, USD 1e18-base. */
      readonly depthUSD: bigint;
      /** The pool used (checksummed). */
      readonly poolAddress: string;
      /** The source block read. */
      readonly block: BlockSample;
    }
  /** The block is final and no configured pool gives a usable price there. */
  | { readonly kind: "none"; readonly reason: string }
  /** No answer now (RPC failure, source head behind); ask again later. */
  | { readonly kind: "pending"; readonly reason: string };

/** The RPC reads behind the effect (injected in tests). */
export interface CanonicalRpcDeps {
  /** Reads a block header. Throws when no endpoint answers. */
  readonly getBlock: (
    chainId: number,
    block: number | "latest",
  ) => Promise<BlockSample>;
  /**
   * Reads a pool at a block. Returns undefined when the pool has no state
   * there (not deployed yet: a deterministic answer); throws when no endpoint
   * answers.
   */
  readonly readPool: (
    chainId: number,
    pool: CanonicalSourcePool,
    blockNumber: number,
  ) => Promise<SourcePoolRead | undefined>;
  /** Wall clock for the backoff. */
  readonly nowMs: () => number;
  /** Logger for failures. */
  readonly warn: (message: string) => void;
}

/** Process-wide counters, for the log line and tests. */
export interface CanonicalRpcStats {
  /** `getBlock` requests made. */
  blockRequests: number;
  /** Pool reads made (one batched request each). */
  poolReads: number;
  priced: number;
  none: number;
  pending: number;
}

const stats: CanonicalRpcStats = {
  blockRequests: 0,
  poolReads: 0,
  priced: 0,
  none: 0,
  pending: 0,
};

/** One clock per source chain, calibrated on first use. */
const clocks = new Map<number, Promise<ChainClock>>();
/** Reads are skipped until this time after a failure. */
let backoffUntilMs = 0;

/**
 * The effect's counters since the process started.
 *
 * @returns A copy of the counters
 */
export function getCanonicalRpcStats(): CanonicalRpcStats {
  return { ...stats };
}

/**
 * Forgets the chain clocks, the backoff and the counters (tests).
 *
 * @returns void
 */
export function resetCanonicalRpcState(): void {
  clocks.clear();
  backoffUntilMs = 0;
  for (const key of Object.keys(stats) as (keyof CanonicalRpcStats)[]) {
    stats[key] = 0;
  }
}

/**
 * Splits a token id into its chain and address.
 *
 * @param tokenId - `{chainId}-{address}`
 * @returns The parts, or undefined for another shape
 */
function parseTokenId(
  tokenId: string,
): { chainId: number; address: string } | undefined {
  const dash = tokenId.indexOf("-");
  const chainId = Number(tokenId.slice(0, dash));
  const address = tokenId.slice(dash + 1);
  if (dash <= 0 || !Number.isInteger(chainId) || address === "") {
    return undefined;
  }
  return { chainId, address };
}

/**
 * Prices a source token from the states of its configured pools at one block,
 * by the rules its own chain applies to local pools: each pool offers pool
 * ratio × $1 at the stablecoin side's depth, and the deepest one that passes
 * the chain's depth floor, the 1000× imbalance bound and the $1M ceiling wins
 * (pure).
 *
 * @param sourceTokenId - Source token id (`{chainId}-{address}`)
 * @param pools - The source's configured pools
 * @param reads - Each pool's state at the block, in the same order; undefined
 *   for a pool without state there
 * @returns The winning candidate (its `sourceId` is the pool id), or undefined
 */
export function selectCanonicalRpcCandidate(
  sourceTokenId: string,
  pools: ReadonlyArray<CanonicalSourcePool>,
  reads: ReadonlyArray<SourcePoolRead | undefined>,
): PricingCandidate | undefined {
  const source = parseTokenId(sourceTokenId);
  if (!source) return undefined;
  const candidates: PricingCandidate[] = [];
  pools.forEach((pool, i) => {
    const read = reads[i];
    if (!read) return;
    const sourceIsToken0 = pool.token0.address === source.address;
    if (!sourceIsToken0 && pool.token1.address !== source.address) return;
    const [target, quote] = sourceIsToken0
      ? [pool.token0, pool.token1]
      : [pool.token1, pool.token0];
    const candidate = buildPricingCandidate(
      {
        id: PoolId(source.chainId, pool.address),
        token0_id: sourceIsToken0 ? sourceTokenId : "quote",
        token1_id: sourceIsToken0 ? "quote" : sourceTokenId,
        isCL: pool.isCL,
        isStable: false,
        reserve0: read.reserve0,
        reserve1: read.reserve1,
        sqrtPriceX96: read.sqrtPriceX96,
      },
      { id: sourceTokenId, decimals: BigInt(target.decimals) },
      { decimals: BigInt(quote.decimals), pricePerUSDNew: ONE_USD },
    );
    if (candidate) candidates.push(candidate);
  });
  return selectPricingCandidate(
    candidates,
    getMinPricingDepthUSD(source.chainId),
  );
}

/**
 * Reads the source's pools at the block for `hourMs` and decides its price
 * (the effect's body, separated for tests). Never throws: an RPC failure is
 * logged and answered as pending, and further reads are skipped for
 * {@link CANONICAL_RPC_BACKOFF_MS}.
 *
 * @param input.sourceTokenId - Source token id (`{chainId}-{address}`)
 * @param input.hourMs - Start of the asking block's clock hour, in ms
 * @param deps - RPC reads, clock and logger
 * @returns The decision
 */
export async function fetchCanonicalSourceRpcPrice(
  input: { sourceTokenId: string; hourMs: number },
  deps: CanonicalRpcDeps,
): Promise<CanonicalRpcPriceDecision> {
  const source = parseTokenId(input.sourceTokenId);
  const pools = getCanonicalSourcePools(input.sourceTokenId);
  if (!source || pools.length === 0) {
    return { kind: "none", reason: "no pools configured for the source" };
  }
  if (!Number.isInteger(input.hourMs) || input.hourMs % HOUR_MS !== 0) {
    return { kind: "none", reason: "not the start of a clock hour" };
  }
  if (deps.nowMs() < backoffUntilMs) {
    return { kind: "pending", reason: "RPC backoff after an error" };
  }
  const { chainId } = source;
  const getBlock = (block: number | "latest"): Promise<BlockSample> => {
    stats.blockRequests++;
    return deps.getBlock(chainId, block);
  };
  try {
    let pendingClock = clocks.get(chainId);
    if (!pendingClock) {
      pendingClock = calibrateChainClock(getBlock);
      clocks.set(chainId, pendingClock);
      // A failed calibration must not be remembered.
      pendingClock.catch(() => clocks.delete(chainId));
    }
    const clock = await pendingClock;

    const hourStart = input.hourMs / 1000;
    if (clock.head.timestamp < hourStart) {
      clock.head = await getBlock("latest");
      if (clock.head.timestamp < hourStart) {
        return {
          kind: "pending",
          reason: `source head ${clock.head.number} is before the hour`,
        };
      }
    }
    const found = await findBlockAtOrBefore(
      clock,
      hourStart - CANONICAL_RPC_MARGIN_SECONDS,
      getBlock,
    );
    if (found.kind === "before-genesis") {
      return { kind: "none", reason: "before the source chain's first block" };
    }
    if (found.kind === "ahead-of-head") {
      return { kind: "pending", reason: "source head is before the block" };
    }
    const { block } = found;

    const reads = await Promise.all(
      pools.map((pool) => {
        stats.poolReads++;
        return deps.readPool(chainId, pool, block.number);
      }),
    );
    const best = selectCanonicalRpcCandidate(input.sourceTokenId, pools, reads);
    if (!best) {
      return {
        kind: "none",
        reason: `no qualifying pool at block ${block.number}`,
      };
    }
    return {
      kind: "price",
      priceUSD: best.priceUSD,
      depthUSD: best.depthUSD,
      poolAddress: best.sourceId.slice(best.sourceId.indexOf("-") + 1),
      block,
    };
  } catch (error) {
    backoffUntilMs = deps.nowMs() + CANONICAL_RPC_BACKOFF_MS;
    deps.warn(
      `[getCanonicalSourceRpcPrice] RPC read failed for ${input.sourceTokenId} hour ${input.hourMs}; not cached, retried on a later refresh: ${error}`,
    );
    return { kind: "pending", reason: "RPC error" };
  }
}

const SOURCE_POOL_ABI = parseAbi([
  // Only the leading words every v3-style slot0 shares are decoded.
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick)",
  "function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)",
  "function balanceOf(address account) view returns (uint256)",
]);

/**
 * Reads one source pool at a block: a CL pool's `slot0` and its two token
 * balances (one batched request), or a V2 pool's `getReserves`. Pure RPC; the
 * caller adds retry and fallback.
 *
 * @param client - Viem client for the pool's chain
 * @param pool - The pool
 * @param blockNumber - Block to read at
 * @returns The pool's state
 * @throws Propagates RPC and contract errors
 */
export async function readCanonicalSourcePool(
  client: PublicClient,
  pool: CanonicalSourcePool,
  blockNumber: number,
): Promise<SourcePoolRead> {
  const address = pool.address as `0x${string}`;
  const at = { blockNumber: BigInt(blockNumber) };
  if (!pool.isCL) {
    const [reserve0, reserve1] = await client.readContract({
      address,
      abi: SOURCE_POOL_ABI,
      functionName: "getReserves",
      ...at,
    });
    return { reserve0, reserve1 };
  }
  const balanceOf = (token: string): Promise<bigint> =>
    client.readContract({
      address: token as `0x${string}`,
      abi: SOURCE_POOL_ABI,
      functionName: "balanceOf",
      args: [address],
      ...at,
    });
  const [slot0, reserve0, reserve1] = await Promise.all([
    client.readContract({
      address,
      abi: SOURCE_POOL_ABI,
      functionName: "slot0",
      ...at,
    }),
    balanceOf(pool.token0.address),
    balanceOf(pool.token1.address),
  ]);
  return { reserve0, reserve1, sqrtPriceX96: slot0[0] };
}

/** The effect's answer when there is no price. */
const NO_PRICE = {
  priceUSD: 0n,
  depthUSD: 0n,
  poolAddress: "",
  sourceBlock: 0,
  sourceTimestamp: 0,
};

/**
 * Cross-chain cached effect: the canonical source's USD price (1e18) for the
 * clock hour starting at `hourMs`, read from the source's pools on its own
 * chain {@link CANONICAL_RPC_MARGIN_SECONDS} before the hour starts, or
 * `priceUSD = 0n` when no configured pool gives a usable price at that block.
 *
 * Caching: both answers are facts about a final block and are cached for
 * good, keyed by (source, hour) alone, so every leaf chain, token and worker
 * shares one read. When there is no answer yet (an RPC failure after retries
 * and the fallback endpoint, or a source head that has not reached the hour)
 * the effect throws: envio then stores nothing, not even in memory, and the
 * caller carries the token's price and asks again on a later refresh.
 *
 * @param input.sourceTokenId - Canonical source token id (`{chainId}-{address}`)
 * @param input.hourMs - Start of the asking block's clock hour, in ms
 * @returns `{ priceUSD, depthUSD, poolAddress, sourceBlock, sourceTimestamp }`;
 *   `priceUSD = 0n` means no price
 * @throws When there is no answer yet
 */
export const getCanonicalSourceRpcPrice = createEffect(
  {
    name: "getCanonicalSourceRpcPrice",
    input: S.schema({ sourceTokenId: S.string, hourMs: S.number }),
    output: S.schema({
      priceUSD: S.bigint,
      depthUSD: S.bigint,
      poolAddress: S.string,
      sourceBlock: S.number,
      sourceTimestamp: S.number,
    }),
    rateLimit: false,
    cache: true,
    crossChain: true,
  },
  async ({ input, context }) => {
    const decision = await fetchCanonicalSourceRpcPrice(input, {
      getBlock: async (chainId, block) => {
        const result = await executeRpc<BlockSample | null>(
          context,
          { name: "getCanonicalSourceRpcPrice.getBlock", chainId },
          null,
          async (client) => {
            const header = await client.getBlock(
              block === "latest"
                ? { blockTag: "latest" }
                : { blockNumber: BigInt(block) },
            );
            return {
              number: Number(header.number),
              timestamp: Number(header.timestamp),
            };
          },
        );
        if (result.value === null) {
          throw new Error(
            `getBlock ${block} on chain ${chainId}: ${result.errorClass}`,
          );
        }
        return result.value;
      },
      readPool: async (chainId, pool, blockNumber) => {
        const result = await executeRpc<SourcePoolRead | null>(
          context,
          {
            name: "getCanonicalSourceRpcPrice.readPool",
            chainId,
            details: { pool: pool.address, block: blockNumber },
          },
          null,
          (client) => readCanonicalSourcePool(client, pool, blockNumber),
        );
        if (result.value !== null) return result.value;
        // A deterministic revert or empty return: no such pool at that block.
        if (isCacheableResult(result)) return undefined;
        throw new Error(
          `pool ${pool.address} at block ${blockNumber} on chain ${chainId}: ${result.errorClass}`,
        );
      },
      nowMs: Date.now,
      warn: (message) => context.log.warn(message),
    });
    stats[
      decision.kind === "price"
        ? "priced"
        : decision.kind === "none"
          ? "none"
          : "pending"
    ]++;
    const hour = new Date(input.hourMs).toISOString();
    context.log.info(
      `[getCanonicalSourceRpcPrice] ${input.sourceTokenId} hour ${hour}: ${decision.kind}${decision.kind === "price" ? ` ${decision.priceUSD} from pool ${decision.poolAddress} at block ${decision.block.number}` : ` (${decision.reason})`}`,
      { event: "pricing.canonical_rpc", ...stats },
    );
    if (decision.kind === "pending") {
      throw new Error(
        `no canonical RPC price yet for ${input.sourceTokenId} hour ${hour}: ${decision.reason}`,
      );
    }
    if (decision.kind === "none") return NO_PRICE;
    return {
      priceUSD: decision.priceUSD,
      depthUSD: decision.depthUSD,
      poolAddress: decision.poolAddress,
      sourceBlock: decision.block.number,
      sourceTimestamp: decision.block.timestamp,
    };
  },
);
