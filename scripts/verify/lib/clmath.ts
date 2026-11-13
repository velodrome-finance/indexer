/**
 * Concentrated-liquidity math (Uniswap v3 / Slipstream), bigint port of
 * TickMath.getSqrtRatioAtTick and SqrtPriceMath amount deltas. Written for the
 * harness so the ground truth does not share code with the indexer; the unit
 * test compares it with @uniswap/v3-sdk.
 */

export const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/**
 * sqrt(1.0001^tick) * 2^96, rounded up, exactly as TickMath.getSqrtRatioAtTick.
 * @param tick - Tick index
 * @returns sqrtPriceX96
 */
export function sqrtRatioAtTick(tick: number): bigint {
  const absTick = BigInt(Math.abs(tick));
  if (absTick > BigInt(MAX_TICK)) throw new Error(`tick out of range: ${tick}`);
  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  const m: [bigint, bigint][] = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, mul] of m) {
    if ((absTick & bit) !== 0n) ratio = (ratio * mul) >> 128n;
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function mulDivRoundingUp(a: bigint, b: bigint, d: bigint): bigint {
  const p = a * b;
  return p / d + (p % d === 0n ? 0n : 1n);
}

/**
 * Token0 amount between two sqrt prices for liquidity L (SqrtPriceMath.getAmount0Delta).
 * @param sa - sqrt price A (X96)
 * @param sb - sqrt price B (X96)
 * @param liquidity - L
 * @param roundUp - Round up (mint) or down (burn / holdings)
 * @returns Amount of token0
 */
export function amount0Delta(
  sa: bigint,
  sb: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  let a = sa;
  let b = sb;
  if (a > b) [a, b] = [b, a];
  if (a === 0n) return 0n;
  const num1 = liquidity << 96n;
  const num2 = b - a;
  if (roundUp) {
    return mulDivRoundingUp(mulDivRoundingUp(num1, num2, b), 1n, a);
  }
  return (num1 * num2) / b / a;
}

/**
 * Token1 amount between two sqrt prices for liquidity L (SqrtPriceMath.getAmount1Delta).
 * @param sa - sqrt price A (X96)
 * @param sb - sqrt price B (X96)
 * @param liquidity - L
 * @param roundUp - Round up or down
 * @returns Amount of token1
 */
export function amount1Delta(
  sa: bigint,
  sb: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  let a = sa;
  let b = sb;
  if (a > b) [a, b] = [b, a];
  return roundUp
    ? mulDivRoundingUp(liquidity, b - a, Q96)
    : (liquidity * (b - a)) / Q96;
}

/**
 * Token amounts a position holds at the current price (what a full burn would
 * return, rounded down), mirroring Pool._modifyPosition with a negative delta.
 * @param liquidity - Position liquidity
 * @param sqrtPriceX96 - Current pool sqrt price
 * @param tick - Current pool tick
 * @param tickLower - Position lower tick
 * @param tickUpper - Position upper tick
 * @returns amount0, amount1
 */
export function positionAmounts(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tick: number,
  tickLower: number,
  tickUpper: number,
): { amount0: bigint; amount1: bigint } {
  if (liquidity === 0n) return { amount0: 0n, amount1: 0n };
  const sa = sqrtRatioAtTick(tickLower);
  const sb = sqrtRatioAtTick(tickUpper);
  if (tick < tickLower) {
    return { amount0: amount0Delta(sa, sb, liquidity, false), amount1: 0n };
  }
  if (tick < tickUpper) {
    return {
      amount0: amount0Delta(sqrtPriceX96, sb, liquidity, false),
      amount1: amount1Delta(sa, sqrtPriceX96, liquidity, false),
    };
  }
  return { amount0: 0n, amount1: amount1Delta(sa, sb, liquidity, false) };
}
