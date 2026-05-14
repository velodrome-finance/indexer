import type { Token, handlerContext } from "generated";
import { estimateBlockAtTimestamp } from "./ChainBlockTime";
import {
  CHAIN_CONSTANTS,
  MS_IN_AN_HOUR,
  PriceOracleType,
  TokenId,
} from "./Constants";
import {
  getTokenDetails,
  getTokenPrice,
  hasContractBytecode,
  roundBlockToInterval,
} from "./Effects/Index";
import { getRebindTarget, isBlacklistedToken } from "./PriceOverrides";
import { setTokenPriceSnapshot } from "./Snapshots/TokenPriceSnapshot";
export interface TokenPriceData {
  pricePerUSDNew: bigint;
  decimals: bigint;
}

// Issue #668: receiver-side guard against transient absurd oracle reads. The
// Fraxtal V3 oracle has historically returned values 15–30 OOM away from the
// surrounding baseline for sfrxETH and FXB20291231; persisting any one of
// those readings permanently poisons cumulative pool aggregates because
// volume/fees are append-only. We treat the on-chain oracle as untrusted
// input: any refresh whose ratio against the last accepted price exceeds
// 10× is rejected as long as the anchor is still fresh (≤ 14 days). See the
// issue body for the heuristic calibration.
const PRICE_SPIKE_RATIO_THRESHOLD = 10n;
const PRICE_SPIKE_STALENESS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Returns true when two positive bigints diverge by ≥ {@link PRICE_SPIKE_RATIO_THRESHOLD}
 * in either direction (a ≥ T·b or b ≥ T·a). Zero inputs are treated as
 * non-divergent — callers handle the zero case explicitly because its
 * meaning differs by site (first-fetch exemption vs. unverifiable canonical).
 *
 * @param a - First positive bigint.
 * @param b - Second positive bigint.
 * @returns Whether the ratio between a and b is ≥10× in either direction.
 */
function ratioDivergesBy10x(a: bigint, b: bigint): boolean {
  return (
    a > 0n &&
    b > 0n &&
    (a >= b * PRICE_SPIKE_RATIO_THRESHOLD ||
      b >= a * PRICE_SPIKE_RATIO_THRESHOLD)
  );
}

/**
 * Creates and persists a Token entity at first sight, gated on the address
 * actually being a contract on-chain.
 *
 * Issue #677: addresses with no deployed bytecode (EOAs, never-deployed
 * contracts) used to write Token rows with empty `symbol`/`name` from the
 * static fallback in {@link getTokenDetails}. The bytecode gate filters them
 * here so callers see `null` and can skip downstream work.
 *
 * @param tokenAddress - Address of the token contract.
 * @param chainId - Chain ID where the token lives.
 * @param blockNumber - Block at which the entity is being created.
 * @param context - Envio handler context for effects + Token.set.
 * @param blockTimestamp - Block timestamp in seconds; stored as `lastUpdatedTimestamp`.
 * @returns The created Token entity, or `null` when the address has no deployed bytecode.
 */
export async function createTokenEntity(
  tokenAddress: string,
  chainId: number,
  blockNumber: number,
  context: handlerContext,
  blockTimestamp: number,
): Promise<Token | null> {
  const blockDatetime = new Date(blockTimestamp * 1000);

  const { hasCode } = await context.effect(hasContractBytecode, {
    address: tokenAddress,
    chainId,
  });
  if (!hasCode) {
    context.log.warn(
      `[createTokenEntity] Skipping Token row for non-contract address ${tokenAddress} on chain ${chainId} (no deployed bytecode)`,
    );
    return null;
  }

  const tokenDetails = await context.effect(getTokenDetails, {
    contractAddress: tokenAddress,
    chainId,
  });

  const tokenEntity: Token = {
    id: TokenId(chainId, tokenAddress),
    address: tokenAddress,
    symbol: tokenDetails.symbol,
    name: tokenDetails.name, // Now using the actual name from token details
    chainId: chainId,
    decimals: BigInt(tokenDetails.decimals),
    pricePerUSDNew: BigInt(0),
    lastUpdatedTimestamp: blockDatetime,
    lastSuccessfulPriceTimestamp: undefined,
    isWhitelisted: false,
  };

  context.Token.set(tokenEntity);
  return tokenEntity;
}

/**
 * Refreshes a token's price subject to a uniform 1-hour throttle, dispatching
 * to blacklist, cross-chain rebind, or on-chain oracle paths as configured.
 *
 * Two clocks are tracked independently (issue #694):
 *
 * - `lastUpdatedTimestamp` advances on EVERY refresh attempt (including $0
 *   reads and fallback writes). It drives the 1-hour throttle at the top of
 *   this function, ensuring we don't re-hit the oracle on every subsequent
 *   event for stuck tokens.
 * - `lastSuccessfulPriceTimestamp` advances ONLY when a non-zero price is
 *   persisted (main oracle write or rebind with a priced source). It drives
 *   the 7-day staleness window guarding the V3 last-known-price fallback —
 *   so once a token enters fallback, the window can actually expire even
 *   with hourly retries.
 *
 * @param token - The token entity to refresh.
 * @param blockNumber - Block at which to fetch price (rounded to an hourly bucket for cache hits).
 * @param blockTimestamp - Block timestamp in seconds.
 * @param chainId - Chain the token lives on.
 * @param context - Envio handler context.
 * @returns The updated token entity (or the unchanged input when throttled).
 */
export async function refreshTokenPrice(
  token: Token,
  blockNumber: number,
  blockTimestamp: number,
  chainId: number,
  context: handlerContext,
): Promise<Token> {
  const blockTimestampMs = blockTimestamp * 1000;

  // Issue #676: uniform 1-hour throttle for all tokens (regardless of current
  // price). RPC cost is bounded by the throttle plus Envio's hourly-rounded
  // effect cache key on `getTokenPrice`. Safe because we always bump
  // `lastUpdatedTimestamp` below, so the throttle advances even on $0 results.
  const shouldRefresh =
    !token.lastUpdatedTimestamp ||
    blockTimestampMs - token.lastUpdatedTimestamp.getTime() >= MS_IN_AN_HOUR;

  if (!shouldRefresh) {
    return token;
  }

  // Issue #672: heal empty symbol/name from a transient RPC failure at token
  // creation. ERC20 metadata is otherwise treated as immutable, so a single
  // failure during createTokenEntity persists `?` (empty symbol) forever.
  const healedMetadata = await maybeHealMetadata(token, chainId, context);

  // Issue #669: blacklist + canonical rebind override the oracle for known-bad
  // (chain, token) pairs. See src/PriceOverrides.ts for rationale per token.
  if (isBlacklistedToken(chainId, token.address)) {
    const updated: Token = {
      ...token,
      ...healedMetadata,
      pricePerUSDNew: 0n,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
    };
    context.Token.set(updated);
    return updated;
  }

  const rebindTarget = getRebindTarget(chainId, token.address);
  if (rebindTarget) {
    const sourceToken = await context.Token.get(
      TokenId(rebindTarget.chainId, rebindTarget.address),
    );
    let sourcePrice = sourceToken?.pricePerUSDNew ?? 0n;

    // Cold-sync gap: the source chain's indexer hasn't priced the source token
    // yet (e.g. Swell handler at T runs while OP indexer is still behind T).
    // Reach across to the source chain's oracle directly. The effect cache
    // key is (tokenAddress, chainId, blockNumber), and we round to the same
    // hour bucket the source chain's own indexer will use — so when the
    // source catches up its native refresh hits this cache slot for free.
    // Worked example walked through in test/PriceOracle.test.ts.
    if (sourcePrice === 0n) {
      const estimatedSourceBlock = estimateBlockAtTimestamp(
        rebindTarget.chainId,
        blockTimestamp,
      );
      if (estimatedSourceBlock !== undefined) {
        const sourceBlockRounded = roundBlockToInterval(
          estimatedSourceBlock,
          rebindTarget.chainId,
        );
        const prefetched = await context.effect(getTokenPrice, {
          tokenAddress: rebindTarget.address,
          chainId: rebindTarget.chainId,
          blockNumber: sourceBlockRounded,
          canonicalOnly: false,
        });
        sourcePrice = prefetched.pricePerUSDNew;
      }
    }

    const updated: Token = {
      ...token,
      ...healedMetadata,
      pricePerUSDNew: sourcePrice,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
      lastSuccessfulPriceTimestamp:
        sourcePrice > 0n
          ? new Date(blockTimestampMs)
          : token.lastSuccessfulPriceTimestamp,
    };
    context.Token.set(updated);
    if (sourcePrice > 0n) {
      setTokenPriceSnapshot(
        token.address,
        chainId,
        blockNumber,
        new Date(blockTimestampMs),
        sourcePrice,
        token.isWhitelisted,
        context,
      );
    }
    return updated;
  }

  try {
    // Round block number to nearest hour interval for better cache hits
    // Cache key is based on input parameters, so rounding must happen before effect call
    const roundedBlockNumber = roundBlockToInterval(blockNumber, chainId);

    // ERC20 metadata is mostly immutable, but symbol/name may have been
    // persisted as empty due to a transient RPC failure at createTokenEntity
    // time (issue #672). Heal happens above this try block; price fetch below.
    const priceData = await context.effect(getTokenPrice, {
      tokenAddress: token.address,
      chainId,
      blockNumber: roundedBlockNumber,
      canonicalOnly: false,
    });
    let currentPrice = priceData.pricePerUSDNew;

    // Issue #668: reject refreshes that jump ≥10× vs a still-fresh accepted
    // anchor. First-fetch (anchor == 0) and stale-anchor (anchor older than
    // PRICE_SPIKE_STALENESS_MS) are exempt — neither shape can be a transient
    // oracle glitch poisoning a previously-good baseline.
    const anchorPrice = token.pricePerUSDNew;
    const anchorAgeMs = token.lastUpdatedTimestamp
      ? blockTimestampMs - token.lastUpdatedTimestamp.getTime()
      : Number.POSITIVE_INFINITY;
    if (
      ratioDivergesBy10x(anchorPrice, currentPrice) &&
      anchorAgeMs < PRICE_SPIKE_STALENESS_MS
    ) {
      context.log.warn(
        `[priceSpikeRejected] ${token.address} chain=${chainId} anchor=${anchorPrice} candidate=${currentPrice}`,
      );
      currentPrice = anchorPrice;
    }

    // Issue #700: bootstrap-from-canonical guard. The ratio rejector above is
    // exempt for first-fetch (anchor == 0) because there's no prior accepted
    // price to anchor against — but that lets a poisoned full-connector path
    // (e.g. an illiquid pool with a one-wei trade) write a wildly inflated
    // first price, which then propagates into every downstream USD aggregate.
    // Cross-check the candidate against an oracle read using only the
    // canonical connectors ([SYSTEM, WETH, USDC]). If the canonical path
    // returns 0n or the two answers diverge by ≥10×, treat the first-fetch
    // candidate as untrusted and write 0n.
    if (anchorPrice === 0n && currentPrice > 0n) {
      const canonical = await context.effect(getTokenPrice, {
        tokenAddress: token.address,
        chainId,
        blockNumber: roundedBlockNumber,
        canonicalOnly: true,
      });
      const canonicalPrice = canonical.pricePerUSDNew;
      if (
        canonicalPrice === 0n ||
        ratioDivergesBy10x(currentPrice, canonicalPrice)
      ) {
        context.log.warn(
          `[bootstrapPathRejected] ${token.address} chain=${chainId} candidate=${currentPrice} canonical=${canonicalPrice}`,
        );
        currentPrice = 0n;
      }
    }

    // If price fetch returned 0, it could mean:
    // 1. No price path exists in the oracle (token not configured)
    // 2. Historical state unavailable (RPC limitation)
    //
    // If we have a previous non-zero price, use it as fallback.
    // This works in harmony with Envio's effect caching - if the effect cache has a previous
    // successful result, it will be used. But if it returns 0, we fall back to the token's stored price.
    //
    // Issue #694: gate the staleness window on `lastSuccessfulPriceTimestamp`,
    // not `lastUpdatedTimestamp`. The latter advances on every attempt
    // (including fallback writes), which previously made the window
    // effectively never expire while a token was stuck in fallback.
    const shouldUseLastKnownPrice =
      currentPrice === 0n &&
      token.pricePerUSDNew > 0n &&
      token.lastSuccessfulPriceTimestamp &&
      // Only use last known price if the LAST SUCCESSFUL write is relatively
      // recent (within 7 days). This prevents using very stale prices but
      // allows for temporary oracle issues.
      blockTimestampMs - token.lastSuccessfulPriceTimestamp.getTime() <
        7 * 24 * 60 * 60 * 1000;

    // V3 last-known-price fallback: V3 is the modern, mostly-reliable oracle,
    // but does throw transient $0 reads. Earlier V1/V2 windows are short and
    // unreliable enough that fallback there would mask real failures, so we
    // only trust the stored price as a substitute when V3 is the active oracle.
    if (
      shouldUseLastKnownPrice &&
      CHAIN_CONSTANTS[chainId].oracle.getType(blockNumber) ===
        PriceOracleType.V3
    ) {
      const updatedToken: Token = {
        ...token,
        ...healedMetadata,
        lastUpdatedTimestamp: new Date(blockTimestampMs),
        // lastSuccessfulPriceTimestamp deliberately NOT bumped: this write
        // doesn't represent a fresh oracle success (#694).
      };
      context.Token.set(updatedToken);
      return updatedToken;
    }

    const updatedToken: Token = {
      ...token,
      ...healedMetadata,
      pricePerUSDNew: currentPrice,
      lastUpdatedTimestamp: new Date(blockTimestampMs),
      lastSuccessfulPriceTimestamp:
        currentPrice > 0n
          ? new Date(blockTimestampMs)
          : token.lastSuccessfulPriceTimestamp,
    };
    context.Token.set(updatedToken);

    setTokenPriceSnapshot(
      token.address,
      chainId,
      blockNumber,
      new Date(blockTimestampMs),
      currentPrice,
      token.isWhitelisted,
      context,
    );
    return updatedToken;
  } catch (error) {
    context.log.error(
      `Error refreshing token price for ${token.address} on chain ${chainId}: ${error}`,
    );
    // Return original token if refresh fails - this preserves the last known price
    return token;
  }
}

/**
 * Re-fetches ERC20 metadata when the stored Token entity has an empty symbol or
 * name (issue #672). createTokenEntity calls getTokenDetails exactly once per
 * pool's PoolCreated event, so a transient RPC failure persists `?` (empty
 * symbol) on the Token forever. The Effect already bypasses cache on empty
 * results, so a fresh call retries the underlying RPC.
 *
 * Returns an overlay containing only the fields that were empty on `token` and
 * came back non-empty from the RPC. Callers spread it: `{ ...token, ...healed }`.
 * Failures are logged but never thrown — metadata is display-only and must not
 * abort the price refresh.
 *
 * @param token - Existing Token entity (read-only).
 * @param chainId - Chain to query.
 * @param context - Envio handler context for the effect call and logging.
 * @returns `{ symbol?, name? }` overlay; empty object if no heal applied.
 */
async function maybeHealMetadata(
  token: Token,
  chainId: number,
  context: handlerContext,
): Promise<{ symbol?: string; name?: string }> {
  if (token.symbol && token.name) {
    return {};
  }

  try {
    const details = await context.effect(getTokenDetails, {
      contractAddress: token.address,
      chainId,
    });
    const overlay: { symbol?: string; name?: string } = {};
    if (!token.symbol && details.symbol) overlay.symbol = details.symbol;
    if (!token.name && details.name) overlay.name = details.name;
    return overlay;
  } catch (error) {
    context.log.error(
      `Error refreshing token metadata for ${token.address} on chain ${chainId}: ${error}`,
    );
    return {};
  }
}
