import {
  CustomUnstakedFeeModule,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("CustomUnstakedFeeModule Events", () => {
  const { createMockLiquidityPoolAggregator } = setupCommon();
  const baseInitialModuleAddress = toChecksumAddress(
    "0x0AD08370c76Ff426F534bb2AFFD9b5555338ee68",
  );
  const optimismModuleAddress = toChecksumAddress(
    "0xC565F7ba9c56b157Da983c4Db30e13F5f06C59D9",
  );

  describe("SetCustomFee event on Base (Initial deployment)", () => {
    const chainId = 8453;
    const mockLiquidityPoolAggregator = createMockLiquidityPoolAggregator({
      chainId: chainId,
    });

    it("should set unstakedFee to the raw fee value on the pool", async () => {
      const mockDb = MockDb.createMockDb();
      const fee = 250n;

      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = CustomUnstakedFeeModule.SetCustomFee.createMockEvent({
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
          srcAddress: baseInitialModuleAddress,
        },
      });

      const result = await populatedDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.unstakedFee).toBe(fee);
      expect(updatedPool?.baseFee).toBe(mockLiquidityPoolAggregator.baseFee);
      expect(updatedPool?.currentFee).toBe(
        mockLiquidityPoolAggregator.currentFee,
      );
    });

    it("should store the raw ZERO_FEE_INDICATOR sentinel (420) without normalization", async () => {
      const mockDb = MockDb.createMockDb();
      const sentinelFee = 420n;

      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = CustomUnstakedFeeModule.SetCustomFee.createMockEvent({
        pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
        fee: sentinelFee,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: baseInitialModuleAddress,
        },
      });

      const result = await populatedDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.unstakedFee).toBe(sentinelFee);
    });

    it("should no-op (not throw) when the pool aggregator does not exist", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = CustomUnstakedFeeModule.SetCustomFee.createMockEvent({
        pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
        fee: 250n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: baseInitialModuleAddress,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("SetCustomFee event on Optimism", () => {
    const chainId = 10;
    const mockLiquidityPoolAggregator = createMockLiquidityPoolAggregator({
      chainId: chainId,
    });

    it("should set unstakedFee when emitted from the Optimism module", async () => {
      const mockDb = MockDb.createMockDb();
      const fee = 1000n;

      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = CustomUnstakedFeeModule.SetCustomFee.createMockEvent({
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
          srcAddress: optimismModuleAddress,
        },
      });

      const result = await populatedDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.unstakedFee).toBe(fee);
    });
  });
});
