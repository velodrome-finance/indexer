import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { setupCommon } from "../Pool/common";

describe("CustomSwapFeeModule Events", () => {
  const { createMockPool } = setupCommon();
  const moduleAddress = toChecksumAddress(
    "0xbcAE2d4b4E8E34a4100e69E9C73af8214a89572e",
  );
  const chainId = 42220; // Celo

  // lastSnapshotTimestamp: undefined prevents Quirk 1 crash in shouldSnapshot
  const mockPool = createMockPool({
    chainId: chainId,
    lastSnapshotTimestamp: undefined,
  });

  describe("SetCustomFee event", () => {
    it("should create the DynamicFeeGlobalConfig entity", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(mockPool);
      const fee = 300n;

      await simulateEvent(indexer, chainId, {
        contract: "CustomSwapFeeModule",
        event: "SetCustomFee",
        params: {
          pool: mockPool.poolAddress as `0x${string}`,
          fee: fee,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: moduleAddress,
        logIndex: 1,
      });

      const config = await indexer.DynamicFeeGlobalConfig.get(moduleAddress);
      expect(config).toBeDefined();
      expect(config?.id).toBe(moduleAddress);
      expect(config?.chainId).toBe(chainId);
      expect(config?.secondsAgo).toBeUndefined();
    });

    it("should update the pool's baseFee", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(mockPool);
      const fee = 400n;

      await simulateEvent(indexer, chainId, {
        contract: "CustomSwapFeeModule",
        event: "SetCustomFee",
        params: {
          pool: mockPool.poolAddress as `0x${string}`,
          fee: fee,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: moduleAddress,
        logIndex: 1,
      });

      const updatedPool = await indexer.Pool.get(mockPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(fee);
      expect(updatedPool?.currentFee).toBe(fee);
    });
  });
});
