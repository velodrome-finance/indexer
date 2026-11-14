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

  // Real dust swaps on Arc pool 0x72dff32c…8506 (Aero), all 32 of its
  // fallbacks: Slipstream rounds the fee up, so a swap of a few wei pays 1 wei.
  describe("dust swaps whose 1-wei fee is above 10% of the input", () => {
    it("accepts block 22246148: amount1 = 8 wei, price move worth 7 wei, fee 1 wei", () => {
      // L = 5045175576823008, √P 141379045363969075072011 → …473895306410244:
      // L·Δ√P / 2^96 = 6.99999… → principal1 7.
      const r = deriveCLSwapFee({
        amount0: -2198300797601n,
        amount1: 8n,
        principal0: -2198300797601n,
        principal1: 7n,
        walkEndLiquidity: 5045175576823008n,
        eventLiquidity: 5045175576823008n,
      });
      expect(r).toEqual({
        ok: true,
        feeAmount0: 0n,
        feeAmount1: 1n,
        amountIn: 8n,
        feeRate: undefined,
      });
    });

    it("accepts block 21930747: 1 wei in, price unmoved, the whole wei is fee", () => {
      const r = deriveCLSwapFee({
        amount0: 0n,
        amount1: 1n,
        principal0: 0n,
        principal1: 0n,
        walkEndLiquidity: 3070123232655090n,
        eventLiquidity: 3070123232655090n,
      });
      expect(r).toMatchObject({ ok: true, feeAmount1: 1n, amountIn: 1n });
    });

    it("accepts block 24925730: 7 wei across a tick crossing pays 1 wei per step plus round-ups, fee 3", () => {
      // tick −265331 → −265330, liquidity 232252167810690 → 232274257439628:
      // two swap steps, each rounding its fee and its input up.
      const r = deriveCLSwapFee({
        amount0: -1438863906771n,
        amount1: 7n,
        principal0: -1438863906771n,
        principal1: 4n,
        walkEndLiquidity: 232274257439628n,
        eventLiquidity: 232274257439628n,
      });
      expect(r).toMatchObject({ ok: true, feeAmount1: 3n, amountIn: 7n });
    });

    it("normal swaps keep the 10% cap", () => {
      expect(
        deriveCLSwapFee({
          ...base,
          principal1: 80n,
          amount0: -1n,
          amount1: 100n,
        }),
      ).toMatchObject({ ok: false, reason: "fee_above_cap", derivedFee: 20n });
      // At 100 wei, 10 wei of rounding is admitted, 11 is not.
      expect(
        deriveCLSwapFee({
          ...base,
          principal1: 90n,
          amount0: -1n,
          amount1: 100n,
        }),
      ).toMatchObject({ ok: true, feeAmount1: 10n });
      expect(
        deriveCLSwapFee({
          ...base,
          principal1: 89n,
          amount0: -1n,
          amount1: 100n,
        }),
      ).toMatchObject({ ok: false, reason: "fee_above_cap", derivedFee: 11n });
    });
  });
});
