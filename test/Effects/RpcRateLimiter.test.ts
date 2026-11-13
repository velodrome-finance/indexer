import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TokenBucket,
  acquireAll,
  getBucket,
  resetRateLimitersForTests,
} from "../../src/Effects/RpcRateLimiter";

describe("TokenBucket", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetRateLimitersForTests();
  });

  it("allows a burst, then paces at the configured rate in FIFO order", async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket(10, 2, () => Date.now());
    const order: number[] = [];
    const all = [0, 1, 2, 3].map((i) =>
      bucket.acquire().then(() => order.push(i)),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([0, 1]);
    expect(bucket.queued).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(order).toEqual([0, 1, 2]);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(all);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("acquireAll waits for every bucket", async () => {
    vi.useFakeTimers();
    const fast = new TokenBucket(100, 1);
    const slow = new TokenBucket(1, 1);
    await acquireAll([fast, slow]);
    let done = false;
    const p = acquireAll([fast, slow]).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(done).toBe(true);
  });

  it("getBucket returns one shared bucket per key", () => {
    expect(getBucket("drpc-account", 80)).toBe(getBucket("drpc-account", 5));
    expect(getBucket("drpc-account", 80).ratePerSecond).toBe(80);
  });
});
