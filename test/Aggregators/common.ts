import { TickMath } from "@uniswap/v3-sdk";

/**
 * Returns sqrt(1.0001^tick) in Q64.96 fixed-point as bigint — the same
 * conversion the source-of-truth helper uses internally. Centralizes the
 * JSBI→bigint plumbing so test math reads cleanly.
 *
 * @param tick - Tick to convert; must be in `[TickMath.MIN_TICK, TickMath.MAX_TICK]` or the SDK will throw.
 * @returns Q64.96 sqrt price as bigint.
 */
export const sqrtAt = (tick: bigint): bigint =>
  BigInt(TickMath.getSqrtRatioAtTick(Number(tick)).toString());
