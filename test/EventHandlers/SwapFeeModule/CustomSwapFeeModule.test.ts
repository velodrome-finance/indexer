import { createTestIndexer } from "envio";
import { toCanonicalFeeScale, toChecksumAddress } from "../../../src/Constants";
import { DynamicFeeGlobalConfigId } from "../../../src/EventHandlers/SwapFeeModule/DynamicFeeGlobalConfigSharedLogic";
import { setupCommon } from "../Pool/common";

describe("CustomSwapFeeModule Events", () => {
  const { createMockPool } = setupCommon();
  const moduleAddress = toChecksumAddress(
    "0xbcAE2d4b4E8E34a4100e69E9C73af8214a89572e",
  );
  const chainId = 42220 as const; // Celo

  const mockPool = createMockPool({
    chainId: chainId,
  });

  describe("SetCustomFee event", () => {
    it("should create the DynamicFeeGlobalConfig entity", async () => {
      // Setup
      const indexer = createTestIndexer();
      const fee = 300n;

      // Pre-populate pool in the test indexer
      indexer.Pool.set(mockPool);

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CustomSwapFeeModule",
                event: "SetCustomFee",
                srcAddress: moduleAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 31597000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  pool: mockPool.poolAddress as `0x${string}`,
                  fee: fee,
                },
              },
            ],
          },
        },
      });

      // Assert: Check that DynamicFeeGlobalConfig was created
      const config = await indexer.DynamicFeeGlobalConfig.get(
        DynamicFeeGlobalConfigId(chainId, moduleAddress),
      );
      expect(config).toBeDefined();
      expect(config?.id).toBe(`${chainId}-${moduleAddress}`);
      expect(config?.chainId).toBe(chainId);
      expect(config?.secondsAgo).toBeUndefined();
    });

    it("should update the pool's baseFee", async () => {
      // Setup
      const indexer = createTestIndexer();
      const fee = 400n;

      // Pre-populate pool in the test indexer
      indexer.Pool.set(mockPool);

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CustomSwapFeeModule",
                event: "SetCustomFee",
                srcAddress: moduleAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 31597000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  pool: mockPool.poolAddress as `0x${string}`,
                  fee: fee,
                },
              },
            ],
          },
        },
      });

      // Assert: Check that pool's baseFee was updated. mockPool is a V2 pool
      // (isCL=false), so the basis-point fee is lifted to canonical FEE_SCALE
      // (1e6) at write — issue #812. (A CL pool's fee, already in FEE_SCALE,
      // would be stored unchanged.)
      const updatedPool = await indexer.Pool.get(mockPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(
        toCanonicalFeeScale(fee, mockPool.isCL),
      );
      expect(updatedPool?.currentFee).toBe(
        toCanonicalFeeScale(fee, mockPool.isCL),
      );
    });

    it("keeps one DynamicFeeGlobalConfig row per chain for a module address shared across leaf chains", async () => {
      // CustomSwapFeeModule 0x6812…C238 is deployed on Soneium, Ink, Unichain,
      // Metal, Superseed and Swell.
      const sharedModule = toChecksumAddress(
        "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
      );
      const soneiumPool = createMockPool({ chainId: 1868 });
      const inkPool = createMockPool({ chainId: 57073 });
      const setCustomFee = (pool: string) => ({
        contract: "CustomSwapFeeModule" as const,
        event: "SetCustomFee" as const,
        srcAddress: sharedModule,
        logIndex: 1,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        params: { pool: pool as `0x${string}`, fee: 300n },
      });
      const indexer = createTestIndexer();
      indexer.Pool.set(soneiumPool);
      indexer.Pool.set(inkPool);

      await indexer.process({
        chains: { 1868: { simulate: [setCustomFee(soneiumPool.poolAddress)] } },
      });
      await indexer.process({
        chains: { 57073: { simulate: [setCustomFee(inkPool.poolAddress)] } },
      });

      const soneium = await indexer.DynamicFeeGlobalConfig.get(
        DynamicFeeGlobalConfigId(1868, sharedModule),
      );
      const ink = await indexer.DynamicFeeGlobalConfig.get(
        DynamicFeeGlobalConfigId(57073, sharedModule),
      );
      expect(soneium?.chainId).toBe(1868);
      expect(ink?.chainId).toBe(57073);
      expect(await indexer.DynamicFeeGlobalConfig.getAll()).toHaveLength(2);
    });
  });
});
