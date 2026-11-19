import { describe, expect, it } from "vitest";
import {
  BLOCK_SEARCH_TOLERANCE_SECONDS,
  type BlockSample,
  type GetBlock,
  calibrateChainClock,
  findBlockAtOrBefore,
} from "../../src/Effects/BlockAtTimestamp";

/**
 * A fake chain: `timestampOf(n)` for blocks 0..head, with a request counter.
 */
function fakeChain(head: number, timestampOf: (n: number) => number) {
  const state = { head, requests: 0 };
  const getBlock: GetBlock = async (block) => {
    state.requests++;
    const number = block === "latest" ? state.head : block;
    if (!Number.isInteger(number) || number < 0 || number > state.head) {
      throw new Error(`block ${number} out of range`);
    }
    return { number, timestamp: timestampOf(number) };
  };
  return { state, getBlock, timestampOf };
}

/** The exact answer by linear scan from a guess, for checking. */
function lastBlockAtOrBefore(
  chain: ReturnType<typeof fakeChain>,
  target: number,
): number {
  let lo = 0;
  let hi = chain.state.head;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (chain.timestampOf(mid) <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function expectCorrect(
  chain: ReturnType<typeof fakeChain>,
  target: number,
  block: BlockSample,
) {
  expect(block.timestamp).toBe(chain.timestampOf(block.number));
  expect(block.timestamp).toBeLessThanOrEqual(target);
  expect(target - block.timestamp).toBeLessThanOrEqual(
    BLOCK_SEARCH_TOLERANCE_SECONDS,
  );
  expect(block.number).toBeLessThanOrEqual(lastBlockAtOrBefore(chain, target));
}

const GENESIS = 1_700_000_000;

describe("BlockAtTimestamp", () => {
  it("calibrates with two requests and measures the block time", async () => {
    const chain = fakeChain(10_000_000, (n) => GENESIS + 2 * n);
    const clock = await calibrateChainClock(chain.getBlock);
    expect(chain.state.requests).toBe(2);
    expect(clock.secondsPerBlock).toBe(2);
    expect(clock.head.number).toBe(10_000_000);
  });

  it("steady clock: one request per lookup, consecutive hours", async () => {
    const chain = fakeChain(10_000_000, (n) => GENESIS + 2 * n);
    const clock = await calibrateChainClock(chain.getBlock);
    const headTs = chain.timestampOf(chain.state.head);
    // Five days of hours, oldest first, as a backfill asks them.
    const firstHour = Math.floor((headTs - 5 * 86_400) / 3600) * 3600;
    let total = 0;
    for (let h = 0; h < 120; h++) {
      const target = firstHour + h * 3600 - 600;
      const before = chain.state.requests;
      const found = await findBlockAtOrBefore(clock, target, chain.getBlock);
      if (found.kind !== "block") throw new Error(found.kind);
      expectCorrect(chain, target, found.block);
      total += chain.state.requests - before;
    }
    expect(total).toBe(120);
  });

  it("remembers a target: the second lookup makes no request", async () => {
    const chain = fakeChain(1_000_000, (n) => GENESIS + 2 * n);
    const clock = await calibrateChainClock(chain.getBlock);
    const target = GENESIS + 1_500_001;
    const first = await findBlockAtOrBefore(clock, target, chain.getBlock);
    const before = chain.state.requests;
    const second = await findBlockAtOrBefore(clock, target, chain.getBlock);
    expect(chain.state.requests).toBe(before);
    expect(second).toEqual(first);
  });

  it("sub-second blocks sharing a timestamp (Base since 2026)", async () => {
    // 0.2 s blocks: five blocks per second.
    const chain = fakeChain(50_000_000, (n) => GENESIS + Math.floor(n / 5));
    const clock = await calibrateChainClock(chain.getBlock);
    expect(clock.secondsPerBlock).toBeCloseTo(0.2, 5);
    for (const back of [600, 3_600, 86_400, 30 * 86_400]) {
      const target = chain.timestampOf(chain.state.head) - back;
      const before = chain.state.requests;
      const found = await findBlockAtOrBefore(clock, target, chain.getBlock);
      if (found.kind !== "block") throw new Error(found.kind);
      expectCorrect(chain, target, found.block);
      expect(chain.state.requests - before).toBeLessThanOrEqual(2);
    }
  });

  it("a block time that changed mid-history still converges in a few requests", async () => {
    // 2 s per block for the first 30M blocks, then 0.2 s (like Base).
    const SWITCH = 30_000_000;
    const chain = fakeChain(60_000_000, (n) =>
      n <= SWITCH
        ? GENESIS + 2 * n
        : GENESIS + 2 * SWITCH + Math.floor((n - SWITCH) / 5),
    );
    const clock = await calibrateChainClock(chain.getBlock);
    const switchTs = chain.timestampOf(SWITCH);
    // [target, most requests]: a target right at the change defeats any
    // linear guess and costs a bisection (log2 of the range).
    for (const [target, most] of [
      [switchTs + 86_400, 2], // after the change
      [switchTs - 86_400, 8], // a day before it, coming from the fast side
      [GENESIS + 1_000_003, 3], // deep in the slow era, odd second
      [switchTs + 3, 30], // right at the change
    ]) {
      const before = chain.state.requests;
      const found = await findBlockAtOrBefore(clock, target, chain.getBlock);
      if (found.kind !== "block") throw new Error(found.kind);
      expectCorrect(chain, target, found.block);
      expect(chain.state.requests - before).toBeLessThanOrEqual(most);
    }
  });

  it("irregular timestamps (gaps and bursts) are bracketed correctly", async () => {
    // A 6-hour halt at block 500k, otherwise 2 s blocks.
    const chain = fakeChain(
      1_000_000,
      (n) => GENESIS + 2 * n + (n >= 500_000 ? 21_600 : 0),
    );
    const clock = await calibrateChainClock(chain.getBlock);
    // Inside the halt: the last block before it is the answer, far more than
    // the tolerance before the target.
    const target = GENESIS + 2 * 499_999 + 10_000;
    const found = await findBlockAtOrBefore(clock, target, chain.getBlock);
    expect(found).toEqual({
      kind: "block",
      block: { number: 499_999, timestamp: GENESIS + 2 * 499_999 },
    });
  });

  it("a target at or past the head refreshes the head, then reports ahead-of-head", async () => {
    const chain = fakeChain(1_000, (n) => GENESIS + 2 * n);
    const clock = await calibrateChainClock(chain.getBlock);
    const target = GENESIS + 2 * 1_100;
    expect(await findBlockAtOrBefore(clock, target, chain.getBlock)).toEqual({
      kind: "ahead-of-head",
      head: { number: 1_000, timestamp: GENESIS + 2_000 },
    });
    // The chain moves on; the same lookup now succeeds.
    chain.state.head = 1_200;
    const found = await findBlockAtOrBefore(clock, target, chain.getBlock);
    expect(found).toEqual({
      kind: "block",
      block: { number: 1_100, timestamp: target },
    });
    expect(clock.head.number).toBe(1_200);
  });

  it("a target before the first block reports before-genesis", async () => {
    const chain = fakeChain(100_000, (n) => GENESIS + 2 * n);
    const clock = await calibrateChainClock(chain.getBlock);
    expect(
      await findBlockAtOrBefore(clock, GENESIS - 10, chain.getBlock),
    ).toEqual({ kind: "before-genesis" });
  });

  it("propagates a getBlock failure", async () => {
    const chain = fakeChain(100_000, (n) => GENESIS + 2 * n);
    const clock = await calibrateChainClock(chain.getBlock);
    const failing: GetBlock = async () => {
      throw new Error("rpc down");
    };
    await expect(
      findBlockAtOrBefore(clock, GENESIS + 5_000, failing),
    ).rejects.toThrow("rpc down");
  });
});
