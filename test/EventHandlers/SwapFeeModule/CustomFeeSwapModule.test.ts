import {
  CustomFeeSwapModule,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("CustomFeeSwapModule Events", () => {
  const { mockLiquidityPoolData } = setupCommon();
  const moduleAddress = toChecksumAddress(
    "0xbcAE2d4b4E8E34a4100e69E9C73af8214a89572e",
  );
  const chainId = 42220; // Celo

  describe("SetCustomFee event", () => {
    it("should create the DynamicFeeGlobalConfig entity", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const poolAddress = toChecksumAddress(mockLiquidityPoolData.id);
      const fee = 300n;

      // Pre-populate pool in the mock database
      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData,
      );

      const mockEvent = CustomFeeSwapModule.SetCustomFee.createMockEvent({
        pool: poolAddress,
        fee: fee,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: moduleAddress,
        },
      });

      // Execute
      const result = await CustomFeeSwapModule.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb: populatedDb,
      });

      // Assert: Check that DynamicFeeGlobalConfig was created
      const config = result.entities.DynamicFeeGlobalConfig.get(moduleAddress);
      expect(config).not.toBeUndefined();
      expect(config?.id).toBe(moduleAddress);
      expect(config?.chainId).toBe(chainId);
      expect(config?.secondsAgo).toBeUndefined();
    });

    it("should update the pool's baseFee", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const poolAddress = toChecksumAddress(mockLiquidityPoolData.id);
      const fee = 400n;

      // Pre-populate pool in the mock database
      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData,
      );

      const mockEvent = CustomFeeSwapModule.SetCustomFee.createMockEvent({
        pool: poolAddress,
        fee: fee,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: moduleAddress,
        },
      });

      // Execute
      const result = await CustomFeeSwapModule.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb: populatedDb,
      });

      // Assert: Check that pool's baseFee was updated
      const updatedPool =
        result.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).not.toBeUndefined();
      expect(updatedPool?.baseFee).toBe(fee);
    });
  });
});
