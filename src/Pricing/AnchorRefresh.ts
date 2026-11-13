import { CHAIN_CONSTANTS, TokenId, toChecksumAddress } from "../Constants";
import { getRehydrated } from "../EntityTimestamps";
import type { handlerContext } from "../EntityTypes";
import { refreshTokenPrice } from "../PriceOracle";
import { listCanonicalSources } from "../PriceOverrides";
import { PRICING_TIER, getPricingTier } from "./PricingConfig";

/**
 * Time-driven refresh of the tokens other prices depend on (ADR 0006): every
 * chain's WETH, price connectors and reward tokens, and every canonical source
 * that lives on the chain. Pinned (tier-0) tokens are excluded: their price
 * never changes. Without this, such a token is refreshed only when an event
 * happens to touch it or something priced through it, and a canonical source's
 * `lastSuccessfulPriceTimestamp` can sit hours before the block another chain
 * compares it against.
 */

/**
 * Block interval of the anchor refresh per chain: about one hour of blocks at
 * the chain's *fastest* block time in its indexed history, so the refresh
 * never runs less than hourly. Running more often costs only throttled calls
 * (the refresh itself is once per clock hour). A chain missing here gets no
 * anchor refresh.
 *
 * - 2 s OP-stack chains (Optimism, Mode, Lisk, Fraxtal, Soneium, Metal, Swell,
 *   Superseed): 1,800.
 * - Base: 2 s until its block-time cut, 0.2 s after; 1,800 (ten no-op calls
 *   an hour at 0.2 s rather than one call every ten hours at 2 s).
 * - 1 s chains (Ink, Unichain, Celo since its L2 migration): 3,600.
 * - Ethereum 12 s: 300. Arbitrum and Robinhood Chain (Arbitrum Orbit), 0.25 s:
 *   14,400. Arc, sub-second blocks: 7,200.
 */
const ANCHOR_REFRESH_BLOCK_INTERVAL: ReadonlyMap<number, number> = new Map([
  [10, 1_800],
  [8453, 1_800],
  [34443, 1_800],
  [1135, 1_800],
  [252, 1_800],
  [1868, 1_800],
  [1750, 1_800],
  [1923, 1_800],
  [5330, 1_800],
  [57073, 3_600],
  [130, 3_600],
  [42220, 3_600],
  [1, 300],
  [42161, 14_400],
  [4663, 14_400],
  [5042, 7_200],
]);

/**
 * The anchor refresh's block interval on a chain.
 *
 * @param chainId - Chain id
 * @returns Blocks between anchor refreshes, or `undefined` for no refresh
 */
export function getAnchorRefreshBlockInterval(
  chainId: number,
): number | undefined {
  return ANCHOR_REFRESH_BLOCK_INTERVAL.get(chainId);
}

/**
 * The chain's anchor tokens (checksummed, deduplicated, in a stable order):
 * WETH, then the configured price connectors, the legacy and Aero reward
 * tokens, and the canonical sources located on the chain, minus any pinned
 * (tier-0) token.
 *
 * Pure: no reads, no writes.
 *
 * @param chainId - Chain id
 * @returns Anchor token addresses (empty for an unknown chain)
 */
export function getAnchorTokens(chainId: number): string[] {
  const c = CHAIN_CONSTANTS[chainId];
  if (!c) return [];
  const candidates = [
    c.weth,
    ...c.priceConnectors.map((p) => p.address),
    ...(c.legacy
      ? [c.legacy.rewardToken(0), c.legacy.rewardToken(Number.MAX_SAFE_INTEGER)]
      : []),
    ...(c.aero ? [c.aero.rewardToken] : []),
    ...listCanonicalSources()
      .filter(({ source }) => source.chainId === chainId)
      .map(({ source }) => source.address),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const address = toChecksumAddress(raw);
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (getPricingTier(chainId, address) === PRICING_TIER.PINNED) continue;
    out.push(address);
  }
  return out;
}

/**
 * Refreshes every anchor token of `chainId` that has a Token row, at this
 * block's time. Each refresh applies the usual once-per-clock-hour throttle,
 * so a call in an hour where the token was already refreshed is a no-op.
 * Tokens not created yet (no pool seen) are skipped.
 *
 * @param chainId - Chain the block belongs to
 * @param blockNumber - Block number
 * @param blockTimestamp - Block timestamp in seconds
 * @param context - Handler context
 * @returns Promise that resolves once every refresh is staged
 */
export async function refreshAnchorTokens(
  chainId: number,
  blockNumber: number,
  blockTimestamp: number,
  context: handlerContext,
): Promise<void> {
  const addresses = getAnchorTokens(chainId);
  const tokens = await Promise.all(
    addresses.map((address) =>
      getRehydrated(context.Token, "Token", TokenId(chainId, address)),
    ),
  );
  await Promise.all(
    tokens.map((token) =>
      token
        ? refreshTokenPrice(
            token,
            blockNumber,
            blockTimestamp,
            chainId,
            context,
          )
        : undefined,
    ),
  );
}
