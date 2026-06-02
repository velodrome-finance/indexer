import { createTestIndexer } from "envio";
import { toCanonicalFeeScale, toChecksumAddress } from "../../../src/Constants";
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
      const config = await indexer.DynamicFeeGlobalConfig.get(moduleAddress);
      expect(config).toBeDefined();
      expect(config?.id).toBe(moduleAddress);
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
  });
});
