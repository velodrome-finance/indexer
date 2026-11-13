import { createTestIndexer } from "envio";
import {
  FeeToTickSpacingMappingId,
  PoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import { ZERO_FEE_INDICATOR } from "../../../src/EventHandlers/SwapFeeModule/CustomSwapFeeSharedLogic";
import { setupCommon } from "../Pool/common";

// On chain, a custom fee of 420 (ZERO_FEE_INDICATOR) charges 0% and a custom
// fee of 0 means "use the default" — for the V2 PoolFactory, the CL
// CustomSwapFeeModule and the CL DynamicSwapFeeModule alike
// (scripts/verify-fee-sentinels.ts). The handlers store what is charged.
describe("custom swap fee sentinels (420 = zero fee, 0 = default)", () => {
  const { createMockPool } = setupCommon();
  const chainId = 10 as const;
  const block = {
    number: 2000000,
    timestamp: 2000000,
    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };
  const v2Factory = toChecksumAddress(
    "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a",
  );
  const customModule = toChecksumAddress(
    "0x7361E9079920fb75496E9764A2665d8ee5049D5f",
  );
  const dynamicModule = toChecksumAddress(
    "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
  );

  const v2Pool = (isStable: boolean) =>
    createMockPool({
      chainId,
      isCL: false,
      isStable,
      baseFee: 10000n,
      currentFee: 10000n,
    });
  const clPool = () =>
    createMockPool({
      chainId,
      isCL: true,
      tickSpacing: 100n,
      baseFee: 2500n,
      currentFee: 2500n,
    });
  const tickSpacingDefault = {
    id: FeeToTickSpacingMappingId(chainId, 100n),
    chainId,
    tickSpacing: 100n,
    fee: 500n,
    lastUpdatedTimestamp: new Date(0),
  };

  async function run(
    pool: ReturnType<typeof createMockPool>,
    contract: "PoolFactory" | "CustomSwapFeeModule" | "DynamicSwapFeeModule",
    fee: bigint,
    withMapping = true,
  ) {
    const indexer = createTestIndexer();
    indexer.Pool.set(pool);
    if (withMapping) indexer.FeeToTickSpacingMapping.set(tickSpacingDefault);
    const event =
      contract === "DynamicSwapFeeModule"
        ? {
            contract,
            event: "CustomFeeSet" as const,
            srcAddress: dynamicModule,
          }
        : {
            contract,
            event: "SetCustomFee" as const,
            srcAddress: contract === "PoolFactory" ? v2Factory : customModule,
          };
    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              ...event,
              logIndex: 1,
              block,
              params: { pool: pool.poolAddress as `0x${string}`, fee },
            },
          ],
        },
      },
    } as never);
    return indexer.Pool.get(PoolId(chainId, pool.poolAddress));
  }

  it("V2 PoolFactory: 420 stores a zero fee", async () => {
    const p = await run(v2Pool(false), "PoolFactory", ZERO_FEE_INDICATOR);
    expect(p?.baseFee).toBe(0n);
    expect(p?.currentFee).toBe(0n);
  });

  it("V2 PoolFactory: 0 restores the volatile / stable default", async () => {
    const vol = await run(v2Pool(false), "PoolFactory", 0n);
    expect(vol?.baseFee).toBe(3000n); // 30 bps
    expect(vol?.currentFee).toBe(3000n);
    const stable = await run(v2Pool(true), "PoolFactory", 0n);
    expect(stable?.baseFee).toBe(500n); // 5 bps
    expect(stable?.currentFee).toBe(500n);
  });

  it("CL CustomSwapFeeModule: 420 stores zero, 0 restores the tick-spacing default", async () => {
    const zero = await run(clPool(), "CustomSwapFeeModule", ZERO_FEE_INDICATOR);
    expect(zero?.baseFee).toBe(0n);
    expect(zero?.currentFee).toBe(0n);
    const reset = await run(clPool(), "CustomSwapFeeModule", 0n);
    expect(reset?.baseFee).toBe(500n);
    expect(reset?.currentFee).toBe(500n);
  });

  it("CL CustomSwapFeeModule: 0 without a tick-spacing mapping keeps the previous fee", async () => {
    const p = await run(clPool(), "CustomSwapFeeModule", 0n, false);
    expect(p?.baseFee).toBe(2500n);
    expect(p?.currentFee).toBe(2500n);
  });

  it("CL DynamicSwapFeeModule: 420 stores a zero base fee, 0 the tick-spacing default", async () => {
    const zero = await run(
      clPool(),
      "DynamicSwapFeeModule",
      ZERO_FEE_INDICATOR,
    );
    expect(zero?.baseFee).toBe(0n);
    const reset = await run(clPool(), "DynamicSwapFeeModule", 0n);
    expect(reset?.baseFee).toBe(500n);
    // currentFee is the measured per-swap rate; a base-fee change leaves it.
    expect(reset?.currentFee).toBe(2500n);
  });

  it("ordinary values are unchanged (V2 bps lifted ×100, CL as-is)", async () => {
    expect((await run(v2Pool(false), "PoolFactory", 25n))?.baseFee).toBe(2500n);
    expect((await run(clPool(), "CustomSwapFeeModule", 300n))?.baseFee).toBe(
      300n,
    );
    expect((await run(clPool(), "DynamicSwapFeeModule", 12n))?.baseFee).toBe(
      12n,
    );
  });
});
