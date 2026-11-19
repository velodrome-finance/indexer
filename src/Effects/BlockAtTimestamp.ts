/**
 * Finds the block a chain was at for a given time, with as few `getBlock`
 * requests as possible. Used by the canonical source RPC price
 * (src/Effects/CanonicalSourceRpcPrice.ts), which asks for consecutive clock
 * hours of the same chain: after a one-time calibration (two requests) the
 * first guess is normally right, so a lookup costs one request.
 *
 * No block time is assumed: Optimism runs at 2 s per block, Base at 0.2 s
 * since 2026 (several blocks share one timestamp), and both changed over their
 * history. The search extrapolates from the nearest known block at the measured
 * rate, then interpolates between the blocks it has seen on either side of the
 * target, bisecting whenever an interpolated step failed to halve the range
 * (a change of block time inside the range makes interpolation crawl).
 */

/** A block's number and timestamp (seconds). */
export interface BlockSample {
  readonly number: number;
  readonly timestamp: number;
}

/** Reads one block header. Must throw when the request fails. */
export type GetBlock = (block: number | "latest") => Promise<BlockSample>;

/**
 * A block at most this many seconds before the target is accepted without
 * searching for the exact boundary: two Optimism blocks, about twenty Base
 * blocks. A price moves far less than the hourly granularity in that time.
 */
export const BLOCK_SEARCH_TOLERANCE_SECONDS = 4;

/** How far behind the head the block-time sample is taken. */
export const BLOCK_RATE_SAMPLE_BLOCKS = 50_000;

/** Steps after which the search only bisects. */
export const BLOCK_SEARCH_INTERPOLATION_STEPS = 16;

/** Hard bound on `getBlock` requests per search (bisection needs under 40). */
export const BLOCK_SEARCH_MAX_STEPS = 64;

/** Found blocks remembered per chain, keyed by target timestamp. */
const FOUND_MEMO_SIZE = 512;

/** What a chain's clock is known to be. */
export interface ChainClock {
  /** The newest block seen. */
  head: BlockSample;
  /** The last block a search ended on; searches start from it or the head. */
  anchor: BlockSample;
  /** Measured seconds per block near the anchor. */
  secondsPerBlock: number;
  /** Target timestamp → block found, oldest first. */
  readonly found: Map<number, BlockSample>;
}

/** The outcome of {@link findBlockAtOrBefore}. */
export type BlockSearchResult =
  | { readonly kind: "block"; readonly block: BlockSample }
  /** The chain's head is still before the target. */
  | { readonly kind: "ahead-of-head"; readonly head: BlockSample }
  /** The target is before the chain's first block. */
  | { readonly kind: "before-genesis" };

/**
 * Reads the head and one older block to measure the chain's block time.
 *
 * @param getBlock - Block header reader
 * @returns The chain's clock, anchored at the head
 */
export async function calibrateChainClock(
  getBlock: GetBlock,
): Promise<ChainClock> {
  const head = await getBlock("latest");
  const sampleNumber = Math.max(0, head.number - BLOCK_RATE_SAMPLE_BLOCKS);
  const sample =
    sampleNumber === head.number ? head : await getBlock(sampleNumber);
  const blocks = head.number - sample.number;
  const seconds = head.timestamp - sample.timestamp;
  return {
    head,
    anchor: head,
    secondsPerBlock: blocks > 0 && seconds > 0 ? seconds / blocks : 2,
    found: new Map(),
  };
}

/**
 * The last block at or before `targetTimestamp`, or one at most
 * {@link BLOCK_SEARCH_TOLERANCE_SECONDS} earlier.
 *
 * Mutates `clock`: the head is refreshed when the target lies past it, the
 * found block becomes the anchor, the block time is re-measured from the
 * distance between consecutive anchors, and the answer is remembered.
 *
 * @param clock - The chain's clock (see {@link calibrateChainClock})
 * @param targetTimestamp - Target time in seconds
 * @param getBlock - Block header reader
 * @returns The block, or why there is none
 * @throws When `getBlock` throws, or the search does not converge
 */
export async function findBlockAtOrBefore(
  clock: ChainClock,
  targetTimestamp: number,
  getBlock: GetBlock,
): Promise<BlockSearchResult> {
  const remembered = clock.found.get(targetTimestamp);
  if (remembered) return { kind: "block", block: remembered };

  if (targetTimestamp >= clock.head.timestamp) {
    clock.head = await getBlock("latest");
    if (targetTimestamp >= clock.head.timestamp) {
      return { kind: "ahead-of-head", head: clock.head };
    }
  }

  const accept = (block: BlockSample): BlockSearchResult => {
    const blocks = Math.abs(block.number - clock.anchor.number);
    const seconds = Math.abs(block.timestamp - clock.anchor.timestamp);
    if (blocks >= 1000 && seconds > 0) clock.secondsPerBlock = seconds / blocks;
    clock.anchor = block;
    clock.found.set(targetTimestamp, block);
    if (clock.found.size > FOUND_MEMO_SIZE) {
      const oldest = clock.found.keys().next().value;
      if (oldest !== undefined) clock.found.delete(oldest);
    }
    return { kind: "block", block };
  };
  const isClose = (block: BlockSample): boolean =>
    block.timestamp <= targetTimestamp &&
    targetTimestamp - block.timestamp <= BLOCK_SEARCH_TOLERANCE_SECONDS;

  // lo: newest block seen at or before the target; hi: oldest block seen after it.
  const seen: { lo?: BlockSample; hi: BlockSample } = { hi: clock.head };
  const note = (block: BlockSample): void => {
    if (block.timestamp <= targetTimestamp) {
      if (!seen.lo || block.number > seen.lo.number) seen.lo = block;
    } else if (block.number < seen.hi.number) {
      seen.hi = block;
    }
  };
  note(clock.anchor);
  if (seen.lo && isClose(seen.lo)) return accept(seen.lo);

  const rate = Math.max(clock.secondsPerBlock, 0.001);
  // Extrapolate from whichever known block is nearer in time.
  const from =
    seen.lo &&
    targetTimestamp - seen.lo.timestamp < seen.hi.timestamp - targetTimestamp
      ? seen.lo
      : seen.hi;
  let guess =
    from.number + Math.round((targetTimestamp - from.timestamp) / rate);
  let stepsWithoutLo = 0;
  // Width of the bracket before the last step; undefined while one side is open.
  let lastWidth: number | undefined;

  for (let step = 0; step < BLOCK_SEARCH_MAX_STEPS; step++) {
    const lowest = seen.lo ? seen.lo.number + 1 : 0;
    const highest = seen.hi.number - 1;
    if (lowest > highest) {
      // Adjacent blocks on either side of the target (or nothing before it).
      return seen.lo ? accept(seen.lo) : { kind: "before-genesis" };
    }
    guess = Math.min(Math.max(guess, lowest), highest);
    const block = await getBlock(guess);
    note(block);
    if (isClose(block)) return accept(block);

    const { lo, hi } = seen;
    const width = lo ? hi.number - lo.number : undefined;
    const halved =
      width === undefined || lastWidth === undefined || width * 2 <= lastWidth;
    lastWidth = width;
    if (lo && halved && step < BLOCK_SEARCH_INTERPOLATION_STEPS) {
      // Linear interpolation between the two sides; exact on a steady clock.
      const span = hi.timestamp - lo.timestamp;
      guess =
        span > 0
          ? lo.number +
            Math.floor(
              ((targetTimestamp - lo.timestamp) * (hi.number - lo.number)) /
                span,
            )
          : lo.number + 1;
    } else if (lo) {
      guess = Math.floor((lo.number + hi.number) / 2);
    } else {
      // Everything seen so far is after the target: step back at the measured
      // rate, doubling the step from the third miss on (blocks were faster
      // back then than the rate measured near the head).
      stepsWithoutLo++;
      const back =
        Math.max(Math.ceil((hi.timestamp - targetTimestamp) / rate), 1) *
        2 ** Math.max(0, stepsWithoutLo - 2);
      guess = hi.number - back;
    }
  }
  throw new Error(
    `block search for timestamp ${targetTimestamp} did not converge in ${BLOCK_SEARCH_MAX_STEPS} steps`,
  );
}
