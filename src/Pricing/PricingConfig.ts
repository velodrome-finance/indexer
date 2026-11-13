import { CHAIN_CONSTANTS, MS_IN_AN_HOUR, TEN_TO_THE_18_BI } from "../Constants";

/**
 * Pool-derived token pricing: thresholds and the static tier map
 * (docs/adr/0003-pool-derived-token-prices.md).
 *
 * Every token is priced only through pools whose counterparty sits in a
 * strictly lower tier, so the pricing graph is acyclic and a refresh recurses
 * at most three levels deep (tier 3 → 2 → 1 → 0).
 */

/** One USD in the 1e18-scaled `pricePerUSDNew` representation. */
export const ONE_USD = TEN_TO_THE_18_BI;

/**
 * Pricing tiers. A token is only ever priced through a counterparty of a
 * strictly lower tier.
 *
 * - `PINNED` (0): the chain's destination token and configured stablecoins,
 *   pinned to exactly $1 with no pool lookup.
 * - `WETH` (1): the chain's WETH, priced only through tier-0 counterparties.
 * - `CONNECTOR` (2): the chain's other configured price connectors
 *   (src/constants/price_connectors.json) and its reward token, priced only
 *   through tiers 0–1.
 * - `OTHER` (3): everything else, priced only through tiers 0–2.
 */
export const PRICING_TIER = {
  PINNED: 0,
  WETH: 1,
  CONNECTOR: 2,
  OTHER: 3,
} as const;

/** One of the {@link PRICING_TIER} values. */
export type PricingTier = (typeof PRICING_TIER)[keyof typeof PRICING_TIER];

/**
 * A candidate pool may only set a token's price when the value it implies for
 * the token's own side is at most this multiple of the counterparty side's
 * value. Taken from the Uniswap v4 indexer (`MAX_PRICING_POOL_VALUE_IMBALANCE`),
 * where it was measured over 2,584 organically traded one-sided pools: 99.9%
 * sit below 1000x and no real pool sat between 1e4x and 1e6x, while every
 * observed poison pool sat at 7.6e3x–1e24x. With the bound, faking $X of value
 * requires depositing ~$X/1000 of real counterparty capital.
 */
export const MAX_PRICING_POOL_VALUE_IMBALANCE = 1000n;

/**
 * Absolute ceiling on any accepted price (1e18-base): $1M per whole token.
 * Kept from the oracle era (#788): an audit of 4.77M non-zero oracle reads found
 * nothing legitimate above it (WBTC ≈ $100K sits an order of magnitude below),
 * so a pool-derived candidate above it is a broken pool, never a price.
 */
export const MAX_ACCEPTED_PRICE = 1_000_000n * ONE_USD;

/**
 * How long a token keeps its last successful price when no route qualifies.
 * Once `lastSuccessfulPriceTimestamp` is older than this the price drops to 0:
 * a token whose liquidity has left must stop inflating TVL (#694).
 */
export const PRICE_CARRY_WINDOW_MS = 7 * 24 * MS_IN_AN_HOUR;

/** Refresh / snapshot cadence: one price refresh per token per clock hour. */
export const PRICE_REFRESH_INTERVAL_MS = MS_IN_AN_HOUR;

/**
 * Most peer pools a two-hop refresh considers (ADR 0007), oldest first in
 * registration order. Each peer costs its own pool and counterparty reads, and
 * on Base a meme token can share pools with hundreds of other tier-3 tokens;
 * the cap bounds that fan-out deterministically. Established markets register
 * first, so they are the ones kept.
 */
export const MAX_TWO_HOP_PEER_POOLS = 32;

/**
 * A canonical cross-chain source (src/PriceOverrides.ts) is only a candidate
 * while its last successful price is within this window either side of the
 * block being priced. Chains are not processed in time order during a
 * backfill, so the source chain may be months ahead or behind; a price from
 * the future is rejected like a stale one. Two hours covers the source's own
 * hourly cadence plus an hour of slack.
 */
export const CANONICAL_ALIGNMENT_WINDOW_MS = 2 * MS_IN_AN_HOUR;

/**
 * Default minimum counterparty-side depth (USD, 1e18-base) for a pool to set a
 * price. $1,000 matches the repo's existing thin-pool guard for the #892 TVL
 * cap (`TVL_CAP_ANCHOR_FLOOR_USD`), which separated live poison from drained
 * legitimate pools, and sits near the Uniswap v4 indexer's per-chain floor on
 * cheap-native chains (e.g. 3,600 CELO). Leaf chains have thin order books, so
 * a higher floor would leave their connector-side tokens unpriced.
 */
const DEFAULT_MIN_PRICING_DEPTH_USD = 1_000n * ONE_USD;

/**
 * Per-chain overrides of {@link DEFAULT_MIN_PRICING_DEPTH_USD}. Optimism and
 * Base carry the deepest books and by far the largest junk-token population
 * (111 of the 128 blacklisted poison tokens are on Base, 11 on Optimism), so
 * they use $5,000 —
 * comparable to the Uniswap v4 indexer's 1 ETH `minimumNativeLocked` on the
 * same chains (~$2.3K–$4K at 2025–26 ETH prices) with some extra margin.
 */
const MIN_PRICING_DEPTH_USD_BY_CHAIN: ReadonlyMap<number, bigint> = new Map([
  [10, 5_000n * ONE_USD], // Optimism
  [8453, 5_000n * ONE_USD], // Base
]);

/**
 * Minimum counterparty-side depth (USD, 1e18-base) a pool must hold on this
 * chain before it may set a token's price.
 *
 * @param chainId - Chain the pool lives on
 * @returns The floor in 1e18-base USD
 */
export function getMinPricingDepthUSD(chainId: number): bigint {
  return (
    MIN_PRICING_DEPTH_USD_BY_CHAIN.get(chainId) ?? DEFAULT_MIN_PRICING_DEPTH_USD
  );
}

/**
 * Highest block number any reward-token lookup needs to cover. The legacy
 * `rewardToken` is block-dependent on Optimism (VELO v1 before the v2
 * migration), so the tier map takes both ends of the range to include every
 * legacy reward token a chain has ever had.
 */
const LATEST_BLOCK = Number.MAX_SAFE_INTEGER;

/**
 * Every reward token a chain has ever had, lowercased: the legacy deployment's
 * (both ends of its block range) and the Aero deployment's. On Base both AERO
 * tokens are listed: AERO v1 (legacy gauges) and the Aero AERO.
 *
 * @param c - The chain's constants
 * @returns Lowercased reward-token addresses (possibly empty)
 */
function rewardTokensOf(c: (typeof CHAIN_CONSTANTS)[number]): string[] {
  const out: string[] = [];
  if (c.legacy) {
    out.push(
      c.legacy.rewardToken(0).toLowerCase(),
      c.legacy.rewardToken(LATEST_BLOCK).toLowerCase(),
    );
  }
  if (c.aero) out.push(c.aero.rewardToken.toLowerCase());
  return out;
}

interface ChainTierSets {
  readonly pinned: ReadonlySet<string>;
  readonly weth: string;
  readonly connectors: ReadonlySet<string>;
}

/**
 * Per-chain lowercased tier membership, built once at module load from
 * {@link CHAIN_CONSTANTS}: `pinned` = destination token + stablecoins, `weth`,
 * `connectors` = price connectors + reward tokens (minus anything in a lower
 * tier, which {@link getPricingTier} checks first).
 */
const TIER_SETS: ReadonlyMap<number, ChainTierSets> = new Map(
  Object.entries(CHAIN_CONSTANTS).map(([chainId, c]) => [
    Number(chainId),
    {
      pinned: new Set([
        c.destinationToken.toLowerCase(),
        ...[...c.stablecoins].map((a) => a.toLowerCase()),
      ]),
      weth: c.weth.toLowerCase(),
      connectors: new Set([
        ...c.priceConnectors.map((p) => p.address.toLowerCase()),
        ...rewardTokensOf(c),
      ]),
    },
  ]),
);

/**
 * Pricing tier of a token (see {@link PRICING_TIER}). Static per (chain,
 * address): it never depends on block number, so a pool registered as a
 * pricing candidate stays acyclic forever.
 *
 * @param chainId - Chain the token lives on
 * @param address - Token address (any case)
 * @returns The token's tier; `OTHER` for unknown chains
 */
export function getPricingTier(chainId: number, address: string): PricingTier {
  const sets = TIER_SETS.get(chainId);
  if (!sets) return PRICING_TIER.OTHER;
  const lower = address.toLowerCase();
  if (sets.pinned.has(lower)) return PRICING_TIER.PINNED;
  if (lower === sets.weth) return PRICING_TIER.WETH;
  if (sets.connectors.has(lower)) return PRICING_TIER.CONNECTOR;
  return PRICING_TIER.OTHER;
}

/**
 * The fixed price of a tier-0 token: exactly $1 for the chain's destination
 * token and configured stablecoins. Lives here (not in the RPC gateway) so the
 * pricing path never needs an effect to learn it.
 *
 * @param chainId - Chain the token lives on
 * @param address - Token address (any case)
 * @returns `ONE_USD` for a pinned token, `undefined` otherwise
 */
export function getPinnedPrice(
  chainId: number,
  address: string,
): bigint | undefined {
  return getPricingTier(chainId, address) === PRICING_TIER.PINNED
    ? ONE_USD
    : undefined;
}
