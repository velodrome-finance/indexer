/**
 * Token-bucket rate limiter for outgoing JSON-RPC calls.
 *
 * Envio's effect `rateLimit` counts effect invocations in one bucket per effect,
 * but one invocation can issue 1-5 JSON-RPC calls against any of 12 chains, so
 * it cannot express a provider's per-request limit. Limiting happens instead at
 * the transport, once per JSON-RPC call, with one bucket per (chain, role) and
 * an optional bucket shared by every endpoint on the same provider account.
 */

/** A token bucket with FIFO waiters. */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly waiters: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param ratePerSecond - Sustained requests per second.
   * @param burst - Bucket capacity (defaults to one second of traffic, min 1).
   * @param now - Clock, injectable for tests.
   */
  constructor(
    readonly ratePerSecond: number,
    readonly burst: number = Math.max(1, Math.ceil(ratePerSecond)),
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.lastRefill = now();
  }

  private refill(): void {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(
        this.burst,
        this.tokens + elapsed * this.ratePerSecond,
      );
      this.lastRefill = t;
    }
  }

  /**
   * Waits until one token is available and consumes it.
   *
   * @returns Promise that resolves once the caller may send one request.
   */
  acquire(): Promise<void> {
    this.refill();
    if (this.waiters.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.schedule();
    });
  }

  /** Number of callers currently queued (for diagnostics). */
  get queued(): number {
    return this.waiters.length;
  }

  private schedule(): void {
    if (this.timer) return;
    this.refill();
    const deficit = Math.max(0, 1 - this.tokens);
    const waitMs = Math.ceil((deficit / this.ratePerSecond) * 1000);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refill();
      while (this.waiters.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        this.waiters.shift()?.();
      }
      if (this.waiters.length > 0) this.schedule();
    }, waitMs);
    // Never keep the process alive just for queued RPC calls.
    (this.timer as { unref?: () => void }).unref?.();
  }
}

const buckets = new Map<string, TokenBucket>();

/**
 * Returns the process-wide bucket for `key`, creating it on first use.
 *
 * @param key - Bucket identity (e.g. `10:primary`, `drpc-account`).
 * @param ratePerSecond - Rate used only when the bucket is created.
 * @returns The shared {@link TokenBucket}.
 */
export function getBucket(key: string, ratePerSecond: number): TokenBucket {
  let b = buckets.get(key);
  if (!b) {
    b = new TokenBucket(ratePerSecond);
    buckets.set(key, b);
  }
  return b;
}

/**
 * Acquires one token from each bucket in order (chain bucket first, then the
 * shared account bucket), so a request is sent only when both allow it.
 *
 * @param list - Buckets to acquire from.
 * @returns Promise that resolves when every bucket granted a token.
 */
export async function acquireAll(list: TokenBucket[]): Promise<void> {
  for (const b of list) await b.acquire();
}

/** Clears all buckets (tests only). */
export function resetRateLimitersForTests(): void {
  buckets.clear();
}
