import {
  MIN_AMOUNT_IN_FOR_FEE_RATE,
  deriveCLSwapFee,
} from "../../src/Aggregators/CLSwapFee";

describe("deriveCLSwapFee", () => {
  const L = 10n ** 24n;
  const base = {
    principal0: -5_000_000_000n,
    principal1: 1_000_000_000_000n,
    walkEndLiquidity: L,
    eventLiquidity: L,
  };

  it("charges amountIn − principal on token1 input and rounds the rate to nearest", () => {
    // 1e12 principal, fee 500 ppm of the gross input: fee = 1e12·500/(1e6−500).
    const fee = 500_250_126n;
    const r = deriveCLSwapFee({
      ...base,
      amount0: -5_000_000_000n,
      amount1: base.principal1 + fee,
    });
    expect(r).toEqual({
      ok: true,
      feeAmount0: 0n,
      feeAmount1: fee,
      amountIn: base.principal1 + fee,
      feeRate: 500n,
    });
  });

  it("charges the fee on token0 when token0 is the input", () => {
    const r = deriveCLSwapFee({
      ...base,
      principal0: 2_000_000_000n,
      principal1: -7n,
      amount0: 2_000_000_000n + 200_000n,
      amount1: -7n,
    });
    expect(r.ok && r.feeAmount0).toBe(200_000n);
    expect(r.ok && r.feeAmount1).toBe(0n);
    // 200000 / 2000200000 = 99.99 ppm → 100
    expect(r.ok && r.feeRate).toBe(100n);
  });

  it("leaves the rate undefined below MIN_AMOUNT_IN_FOR_FEE_RATE but keeps the fee", () => {
    const amountIn = MIN_AMOUNT_IN_FOR_FEE_RATE - 1n;
    const r = deriveCLSwapFee({
      ...base,
      principal1: amountIn - 1_000n,
      amount0: -1n,
      amount1: amountIn,
    });
    expect(r.ok && r.feeAmount1).toBe(1_000n);
    expect(r.ok && r.feeRate).toBeUndefined();
  });

  it("returns a zero fee for a zero-fee pool", () => {
    const r = deriveCLSwapFee({
      ...base,
      amount0: -5_000_000_000n,
      amount1: base.principal1,
    });
    expect(r).toMatchObject({ ok: true, feeAmount1: 0n, feeRate: 0n });
  });

  it("returns zero fees when no leg is an input", () => {
    const r = deriveCLSwapFee({ ...base, amount0: 0n, amount1: 0n });
    expect(r).toMatchObject({ ok: true, feeAmount0: 0n, feeAmount1: 0n });
  });

  it("rejects when the walk's ending liquidity disagrees with the event", () => {
    const r = deriveCLSwapFee({
      ...base,
      walkEndLiquidity: L - 1n,
      amount0: -1n,
      amount1: base.principal1 + 1_000n,
    });
    expect(r).toMatchObject({ ok: false, reason: "liquidity_mismatch" });
  });

  it("rejects a negative fee", () => {
    const r = deriveCLSwapFee({
      ...base,
      amount0: -1n,
      amount1: base.principal1 - 1n,
    });
    expect(r).toMatchObject({
      ok: false,
      reason: "negative_fee",
      derivedFee: -1n,
    });
  });

  it("rejects a fee above 10% of amountIn, accepts exactly 10%", () => {
    const amountIn = 10_000_000_000n;
    const over = deriveCLSwapFee({
      ...base,
      principal1: amountIn - 1_000_000_001n,
      amount0: -1n,
      amount1: amountIn,
    });
    expect(over).toMatchObject({ ok: false, reason: "fee_above_cap" });
    const at = deriveCLSwapFee({
      ...base,
      principal1: amountIn - 1_000_000_000n,
      amount0: -1n,
      amount1: amountIn,
    });
    expect(at).toMatchObject({ ok: true, feeRate: 100_000n });
  });
});
