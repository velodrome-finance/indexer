import type { Token } from "envio";
import { PoolId, TokenId } from "../Constants";
import type { handlerContext } from "../EntityTypes";
import type { Pool } from "../EntityTypes";
import { poolSpotPrice0 } from "../PoolPriceRatio";
import {
  MAX_ACCEPTED_PRICE,
  MAX_PRICING_POOL_VALUE_IMBALANCE,
  PRICING_TIER,
  getPricingTier,
} from "./PricingConfig";

/**
 * One offer to price a target token T. All values are USD in 1e18-base.
 *
 * - `pool`: a local pool pricing T through its counterparty C. With
 *   `hops: 2` C is a tier-3 peer whose own price came from a direct pool route
 *   computed in the same refresh (see {@link combineTwoHopCandidate}).
 */
export interface PricingCandidate {
  /** Where the offer comes from. */
  readonly kind: "pool";
  /** Pool id (`{chainId}-{poolAddress}`). */
  readonly sourceId: string;
  /** T's USD price: pool ratio (T in C) × C's USD price. 0n ⇒ not derivable. */
  readonly priceUSD: bigint;
  /** Verifiable depth: C's reserve valued at C's price. */
  readonly depthUSD: bigint;
  /** T-side reserve valued at the candidate price. */
  readonly targetSideUSD: bigint;
  /** 2 for a two-hop pool route through a tier-3 peer; absent (= 1) otherwise. */
  readonly hops?: 1 | 2;
  /** Two-hop only: the peer token id (`{chainId}-{address}`) T was priced through. */
  readonly viaTokenId?: string;
  /** Two-hop only: the pool that priced the peer directly. */
  readonly viaPoolId?: string;
}

/**
 * Builds the pricing candidate a pool offers for `target`, valuing it through
 * the pool's other token (`counterparty`) at that token's stored USD price.
 *
 * The pool ratio comes from {@link poolSpotPrice0} (CL: `sqrtPriceX96`; V2
 * stable: sAMM marginal price; V2 volatile: reserve ratio), decimal-adjusted
 * with both tokens' stored decimals, and is kept as an exact fraction until the
 * single trailing division. A counterparty without a positive price, or a pool
 * without a defined ratio, yields a candidate with `priceUSD = 0n`, which
 * {@link selectPricingCandidate} rejects.
 *
 * Pure: no reads, no writes.
 *
 * @param pool - Pool containing both `target` and `counterparty`
 * @param target - The token being priced
 * @param counterparty - The pool's other token, carrying its current USD price
 * @returns The candidate, or `undefined` when `target` is not one of the
 *   pool's tokens
 */
export function buildPricingCandidate(
  pool: Pick<
    Pool,
    | "id"
    | "token0_id"
    | "token1_id"
    | "isCL"
    | "isStable"
    | "reserve0"
    | "reserve1"
    | "sqrtPriceX96"
  >,
  target: Pick<Token, "id" | "decimals">,
  counterparty: Pick<Token, "decimals" | "pricePerUSDNew">,
): PricingCandidate | undefined {
  const targetIsToken0 = pool.token0_id === target.id;
  if (!targetIsToken0 && pool.token1_id !== target.id) return undefined;

  const counterpartyPrice = counterparty.pricePerUSDNew;
  const [decimals0, decimals1] = targetIsToken0
    ? [target.decimals, counterparty.decimals]
    : [counterparty.decimals, target.decimals];
  const [targetReserve, counterpartyReserve] = targetIsToken0
    ? [pool.reserve0, pool.reserve1]
    : [pool.reserve1, pool.reserve0];

  const depthUSD =
    counterpartyPrice > 0n && counterpartyReserve > 0n
      ? (counterpartyReserve * counterpartyPrice) / 10n ** counterparty.decimals
      : 0n;

  const spot0 = poolSpotPrice0(pool, decimals0, decimals1);
  if (!spot0 || counterpartyPrice <= 0n) {
    return {
      kind: "pool",
      sourceId: pool.id,
      priceUSD: 0n,
      depthUSD,
      targetSideUSD: 0n,
    };
  }
  // Price of T in C units: token0-in-token1 when T is token0, its reciprocal otherwise.
  const [num, den] = targetIsToken0
    ? [spot0.num, spot0.den]
    : [spot0.den, spot0.num];
  const priceUSD = (num * counterpartyPrice) / den;
  const targetSideUSD =
    targetReserve > 0n
      ? (targetReserve * priceUSD) / 10n ** target.decimals
      : 0n;

  return {
    kind: "pool",
    sourceId: pool.id,
    priceUSD,
    depthUSD,
    targetSideUSD,
  };
}

/**
 * Whether a candidate may set a price at all: positive and within the absolute
 * ceiling, counterparty depth at or above the chain floor, and the token side
 * worth at most {@link MAX_PRICING_POOL_VALUE_IMBALANCE}× the counterparty side.
 *
 * @param candidate - The candidate to check
 * @param minDepthUSD - The chain's minimum counterparty depth (1e18-base USD)
 * @returns true when the candidate qualifies
 */
export function isQualifyingCandidate(
  candidate: PricingCandidate,
  minDepthUSD: bigint,
): boolean {
  return (
    candidate.priceUSD > 0n &&
    candidate.priceUSD <= MAX_ACCEPTED_PRICE &&
    candidate.depthUSD >= minDepthUSD &&
    candidate.targetSideUSD <=
      candidate.depthUSD * MAX_PRICING_POOL_VALUE_IMBALANCE
  );
}

/**
 * Picks the candidate that sets a token's price: the deepest qualifying one
 * (see {@link isQualifyingCandidate}), as in the Uniswap v4 indexer's
 * `findNativePerToken`. Ties keep the earlier candidate, so the result is
 * deterministic in input order (callers list pools in registration order).
 *
 * Pure: easy to unit test.
 *
 * @param candidates - Candidates from every registered pricing pool
 * @param minDepthUSD - The chain's minimum counterparty depth (1e18-base USD)
 * @returns The winning candidate, or `undefined` when none qualifies
 */
export function selectPricingCandidate(
  candidates: readonly PricingCandidate[],
  minDepthUSD: bigint,
): PricingCandidate | undefined {
  let best: PricingCandidate | undefined;
  for (const candidate of candidates) {
    if (!isQualifyingCandidate(candidate, minDepthUSD)) continue;
    if (!best || candidate.depthUSD > best.depthUSD) best = candidate;
  }
  return best;
}

/**
 * Combines a peer pool's candidate with the peer's own direct route into one
 * two-hop candidate for the target (ADR 0007). `hop` must be the candidate the
 * peer pool P2 (target T / peer C) offers when C is valued at `via.priceUSD`;
 * `via` is C's winning direct pool candidate (pool P1, C / lower-tier token).
 *
 * The weakest link governs: the depth is `min(depth of P1, depth of P2)`, and
 * the imbalance bound in {@link isQualifyingCandidate} is then applied to T's
 * side of P2 against that minimum, so a deep peer pool cannot lend depth to a
 * shallow peer route, nor the reverse. The price is P2's ratio × C's direct
 * price (already in `hop.priceUSD`).
 *
 * Pure: no reads, no writes.
 *
 * @param hop - P2's candidate for T, with C at its direct price
 * @param via - C's winning direct pool candidate (its `sourceId` is P1)
 * @param viaTokenId - C's token id
 * @returns The two-hop candidate
 */
export function combineTwoHopCandidate(
  hop: PricingCandidate,
  via: PricingCandidate,
  viaTokenId: string,
): PricingCandidate {
  return {
    kind: "pool",
    sourceId: hop.sourceId,
    priceUSD: hop.priceUSD,
    depthUSD: hop.depthUSD < via.depthUSD ? hop.depthUSD : via.depthUSD,
    targetSideUSD: hop.targetSideUSD,
    hops: 2,
    viaTokenId,
    viaPoolId: via.sourceId,
  };
}

/**
 * Which of a new pool's tokens may be priced through it:
 *
 * - each side whose counterparty sits in a strictly lower pricing tier (a
 *   direct route; at most one side, since tiers are strictly ordered);
 * - both sides when both tokens are tier 2 or both are tier 3 (a peer pool,
 *   usable only for a two-hop route through a peer that has a direct route of
 *   its own, ADR 0007). Tier 2 is included because a connector's only deep
 *   market can be against another connector (WBTC / tBTC on Optimism in 2023).
 *
 * A pool between two pinned tokens qualifies for neither.
 *
 * @param chainId - Chain the pool lives on
 * @param token0Address - Pool token0 address
 * @param token1Address - Pool token1 address
 * @returns Token ids (`{chainId}-{address}`) that gain this pool as a pricing candidate
 */
export function getPricingPoolTargets(
  chainId: number,
  token0Address: string,
  token1Address: string,
): string[] {
  const tier0 = getPricingTier(chainId, token0Address);
  const tier1 = getPricingTier(chainId, token1Address);
  if (tier0 > tier1) return [TokenId(chainId, token0Address)];
  if (tier1 > tier0) return [TokenId(chainId, token1Address)];
  if (tier0 === PRICING_TIER.OTHER || tier0 === PRICING_TIER.CONNECTOR) {
    return [TokenId(chainId, token0Address), TokenId(chainId, token1Address)];
  }
  return [];
}

/**
 * Registers a newly created pool as a pricing candidate for the tokens
 * {@link getPricingPoolTargets} names, appending the pool id to each one's
 * `TokenPricingPools` row. Direct and peer pools share the list; the refresh
 * tells them apart by the counterparty's tier. Called from the V2
 * `PoolFactory` and CL `CLFactory` `PoolCreated` handlers. Idempotent: a pool
 * already on the list is not appended twice.
 *
 * @param context - Handler context for the `TokenPricingPools` read + write
 * @param chainId - Chain the pool lives on
 * @param poolAddress - The new pool's address
 * @param token0Address - Pool token0 address
 * @param token1Address - Pool token1 address
 * @returns Promise that resolves once the append (if any) is staged
 */
export async function registerPricingPool(
  context: handlerContext,
  chainId: number,
  poolAddress: string,
  token0Address: string,
  token1Address: string,
): Promise<void> {
  const poolId = PoolId(chainId, poolAddress);
  for (const tokenId of getPricingPoolTargets(
    chainId,
    token0Address,
    token1Address,
  )) {
    const existing = await context.TokenPricingPools.get(tokenId);
    const pools = existing?.pools ?? [];
    if (pools.includes(poolId)) continue;
    context.TokenPricingPools.set({ id: tokenId, pools: [...pools, poolId] });
  }
}
