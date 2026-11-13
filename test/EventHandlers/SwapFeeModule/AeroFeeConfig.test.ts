import { createTestIndexer } from "envio";
import {
  FeeToTickSpacingMappingId,
  POOL_DEPLOYMENT,
  PoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import { HOOK_ZERO_FEE_INDICATOR } from "../../../src/EventHandlers/SwapFeeModule/DynamicSwapFeeHook";
import "../../eventHandlersRegistration";
import { setupCommon } from "../Pool/common";

// Aero fee configuration: the CL DynamicSwapFeeHook (replaces the legacy fee
// modules) and the V2 CustomFeeModules.
describe("Aero fee configuration", () => {
  const { createMockPool } = setupCommon();
  const block = {
    number: 30_000_000,
    timestamp: 1_790_000_000,
    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };
  const hook = toChecksumAddress("0xC0ed888AfE87ed1AcF01D9f19bB850159e3ce434");
  const liteHook = toChecksumAddress(
    "0xaAf164008441F112eB2858d9F7A2dB1B84b1E415",
  );
  const aeroCLFactory = toChecksumAddress(
    "0x7F83235643181E440433400a027618Cd50879751",
  );
  const volatileModule = toChecksumAddress(
    "0x7949DE8d67E4F6b8509Bdbb43FF0503aF1247a7A",
  );
  const chainId = 5042 as const;

  const clPool = createMockPool({
    chainId,
    isCL: true,
    deployment: POOL_DEPLOYMENT.AERO,
    tickSpacing: 100n,
    factoryAddress: aeroCLFactory,
    baseFee: 10000n,
    currentFee: 10000n,
    feeCap: 600n,
    scalingFactor: 3_000_000n,
  });
  const v2Pool = createMockPool({
    chainId,
    poolAddress: "0x4444444444444444444444444444444444444444",
    isCL: false,
    isStable: false,
    deployment: POOL_DEPLOYMENT.AERO,
    baseFee: 3000n,
    currentFee: 3000n,
  });

  async function run(
    item: {
      contract: "DynamicSwapFeeHook" | "V2CustomFeeModule";
      event: string;
      srcAddress: string;
      params: Record<string, unknown>;
    },
    pools = [clPool, v2Pool],
  ) {
    const idx = createTestIndexer();
    for (const p of pools) idx.Pool.set(p);
    idx.FeeToTickSpacingMapping.set({
      id: FeeToTickSpacingMappingId(chainId, aeroCLFactory, 100n),
      chainId,
      factoryAddress: aeroCLFactory,
      tickSpacing: 100n,
      fee: 10000n,
      lastUpdatedTimestamp: new Date(0),
    });
    await idx.process({
      chains: {
        [chainId]: {
          // biome-ignore lint/suspicious/noExplicitAny: one item of either contract
          simulate: [{ ...item, logIndex: 1, block } as any],
        },
      },
    });
    return idx;
  }

  const customFeeSet = (fee: bigint, src = hook) => ({
    contract: "DynamicSwapFeeHook" as const,
    event: "CustomFeeSet",
    srcAddress: src,
    params: { pool: clPool.poolAddress, fee },
  });

  it("stores a custom base fee as-is (FEE_SCALE 1e6)", async () => {
    const idx = await run(customFeeSet(199n));
    const p = await idx.Pool.get(clPool.id);
    expect(p?.baseFee).toBe(199n);
    // The rate a swap pays is measured per swap; configuration leaves it alone.
    expect(p?.currentFee).toBe(10000n);
  });

  it("resolves 0 and the hook's zero-fee indicator to the factory's tick-spacing fee", async () => {
    expect(HOOK_ZERO_FEE_INDICATOR.get(hook)).toBe(16777215n);
    for (const raw of [0n, 16777215n]) {
      const idx = await run(customFeeSet(raw), [
        { ...clPool, baseFee: 199n },
        v2Pool,
      ]);
      expect((await idx.Pool.get(clPool.id))?.baseFee).toBe(10000n);
    }
  });

  it("uses the lite-launch hook's own zero-fee indicator (55555)", async () => {
    expect(HOOK_ZERO_FEE_INDICATOR.get(liteHook)).toBe(55555n);
    const idx = await run(customFeeSet(55555n, liteHook), [
      { ...clPool, baseFee: 199n },
    ]);
    expect((await idx.Pool.get(clPool.id))?.baseFee).toBe(10000n);
    // On the main hook 55555 is an ordinary (if invalid) value.
    const idx2 = await run(customFeeSet(55555n), [
      { ...clPool, baseFee: 199n },
    ]);
    expect((await idx2.Pool.get(clPool.id))?.baseFee).toBe(55555n);
  });

  it("stores FeeCapSet / ScalingFactorSet and clears both on DynamicFeeReset", async () => {
    const capIdx = await run({
      contract: "DynamicSwapFeeHook",
      event: "FeeCapSet",
      srcAddress: hook,
      params: { pool: clPool.poolAddress, feeCap: 1500n },
    });
    expect((await capIdx.Pool.get(clPool.id))?.feeCap).toBe(1500n);
    const sfIdx = await run({
      contract: "DynamicSwapFeeHook",
      event: "ScalingFactorSet",
      srcAddress: hook,
      params: { pool: clPool.poolAddress, scalingFactor: 17_000_000n },
    });
    expect((await sfIdx.Pool.get(clPool.id))?.scalingFactor).toBe(17_000_000n);
    const resetIdx = await run({
      contract: "DynamicSwapFeeHook",
      event: "DynamicFeeReset",
      srcAddress: hook,
      params: { pool: clPool.poolAddress },
    });
    const reset = await resetIdx.Pool.get(clPool.id);
    expect(reset?.feeCap).toBeUndefined();
    expect(reset?.scalingFactor).toBeUndefined();
    expect(reset?.baseFee).toBe(10000n);
  });

  it("V2 CustomFeeModule: bps lifted to FEE_SCALE, 420 = 0%, 0 = factory default", async () => {
    const setFee = (fee: bigint) => ({
      contract: "V2CustomFeeModule" as const,
      event: "SetCustomFee",
      srcAddress: volatileModule,
      params: { pool: v2Pool.poolAddress, fee },
    });
    const idx = await run(setFee(100n));
    expect((await idx.Pool.get(v2Pool.id))?.baseFee).toBe(10000n);
    expect((await idx.Pool.get(v2Pool.id))?.currentFee).toBe(10000n);
    const zero = await run(setFee(420n));
    expect((await zero.Pool.get(v2Pool.id))?.baseFee).toBe(0n);
    const reset = await run(setFee(0n), [{ ...v2Pool, baseFee: 10000n }]);
    expect((await reset.Pool.get(v2Pool.id))?.baseFee).toBe(3000n);
    expect(PoolId(chainId, v2Pool.poolAddress)).toBe(v2Pool.id);
  });
});
