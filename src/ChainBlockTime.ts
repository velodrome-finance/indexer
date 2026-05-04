/**
 * Per-chain anchor pairs for converting a wall-clock timestamp into an
 * approximate block number on that chain.
 *
 * Each anchor is a single (block, unix-timestamp) reference pair plus the
 * chain's nominal block time. Estimation is plain arithmetic:
 *
 *     estimatedBlock = anchorBlock + floor((timestamp - anchorTimestamp) / blocktime)
 *
 * This is a HEURISTIC — real block times drift slightly, so the estimate can
 * be off by a handful of blocks over months. Callers should pair this with
 * `roundBlockToInterval` (1-hour buckets ≈ 1800 blocks on 2s chains), which
 * absorbs drift and aligns the estimate with the cache key the source chain's
 * own indexer will eventually use.
 *
 * Only chains that act as a `source` in `PriceOverrides.REBINDS` need an
 * anchor — that is currently Optimism and Base.
 *
 * NOTE: `blocktimeSeconds` here must match the implicit blocktime in
 * `roundBlockToInterval` (Effects/Token.ts), otherwise the prefetched cache
 * slot won't line up with the source chain's eventual native refresh.
 */
interface ChainAnchor {
  readonly block: number;
  readonly timestamp: number; // unix seconds
  readonly blocktimeSeconds: number;
}

const CHAIN_ANCHORS: ReadonlyMap<number, ChainAnchor> = new Map([
  // Optimism Bedrock genesis: block 105_235_063 at 2023-06-06 16:28:23 UTC.
  [10, { block: 105_235_063, timestamp: 1_686_068_903, blocktimeSeconds: 2 }],
  // Base genesis: block 0 at 2023-06-15 00:35:47 UTC.
  [8453, { block: 0, timestamp: 1_686_789_347, blocktimeSeconds: 2 }],
]);

/**
 * Estimates a chain's block number at a given wall-clock timestamp using a
 * fixed (block, timestamp) anchor and the chain's nominal block time.
 *
 * Returns `undefined` when:
 *  - the chain has no anchor configured (caller should skip cross-chain
 *    prefetch — there's no way to guess the right block)
 *  - the timestamp is before the anchor (chain hadn't started yet)
 *
 * @param chainId - Chain whose block number is being estimated.
 * @param timestampSec - Wall-clock target timestamp in unix seconds.
 * @returns Estimated block number, or undefined if it can't be estimated.
 */
export function estimateBlockAtTimestamp(
  chainId: number,
  timestampSec: number,
): number | undefined {
  const anchor = CHAIN_ANCHORS.get(chainId);
  if (!anchor) return undefined;
  if (timestampSec < anchor.timestamp) return undefined;

  const elapsedSec = timestampSec - anchor.timestamp;
  return anchor.block + Math.floor(elapsedSec / anchor.blocktimeSeconds);
}
