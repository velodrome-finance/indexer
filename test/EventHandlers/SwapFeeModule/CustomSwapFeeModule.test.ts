import "../../eventHandlersRegistration";
import {
  CustomSwapFeeModule,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("CustomSwapFeeModule Events", () => {
  const { createMockLiquidityPoolAggregator } = setupCommon();
  const moduleAddress = toChecksumAddress(
    "0xbcAE2d4b4E8E34a4100e69E9C73af8214a89572e",
  );
  const chainId = 42220; // Celo

  const mockLiquidityPoolAggregator = createMockLiquidityPoolAggregator({
    chainId: chainId,
  });

  describe("SetCustomFee event", () => {
    it("should create the DynamicFeeGlobalConfig entity", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const fee = 300n;

      // Pre-populate pool in the mock database
      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = CustomSwapFeeModule.SetCustomFee.createMockEvent({
        pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
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
      const result = await populatedDb.processEvents([mockEvent]);

      // Assert: Check that DynamicFeeGlobalConfig was created
      const config = result.entities.DynamicFeeGlobalConfig.get(moduleAddress);
      expect(config).toBeDefined();
      expect(config?.id).toBe(moduleAddress);
      expect(config?.chainId).toBe(chainId);
      expect(config?.secondsAgo).toBeUndefined();
    });

    it("should update the pool's baseFee", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const fee = 400n;

      // Pre-populate pool in the mock database
      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = CustomSwapFeeModule.SetCustomFee.createMockEvent({
        pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
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
      const result = await populatedDb.processEvents([mockEvent]);

      // Assert: Check that pool's baseFee was updated
      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(fee);
      expect(updatedPool?.currentFee).toBe(fee);
    });
  });
});
