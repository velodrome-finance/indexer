import {
  CustomUnstakedFeeModule,
  MockDb,
  UnstakedFeeModule,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("UnstakedFeeModule Events", () => {
  const { createMockLiquidityPoolAggregator } = setupCommon();
  const gaugeCapsModuleAddress = toChecksumAddress(
    "0xCCC21f4750E8B3E9C095BCB5d2fF59247A2CCD35",
  );
  const gaugesV3ModuleAddress = toChecksumAddress(
    "0xc2cc3256434AfbC36Bb5e815e1Bb2151310a1a0b",
  );
  const initialCustomModuleAddress = toChecksumAddress(
    "0x0AD08370c76Ff426F534bb2AFFD9b5555338ee68",
  );
  const chainId = 8453; // Base

  const mockLiquidityPoolAggregator = createMockLiquidityPoolAggregator({
    chainId: chainId,
  });

  describe("CustomFeeSet event", () => {
    it("should set unstakedFee to the raw fee value on the pool", async () => {
      const mockDb = MockDb.createMockDb();
      const fee = 500n;

      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = UnstakedFeeModule.CustomFeeSet.createMockEvent({
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
          srcAddress: gaugeCapsModuleAddress,
        },
      });

      const result = await populatedDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.unstakedFee).toBe(fee);
      // baseFee and currentFee must be orthogonal and untouched.
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

      const mockEvent = UnstakedFeeModule.CustomFeeSet.createMockEvent({
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
          srcAddress: gaugesV3ModuleAddress,
        },
      });

      const result = await populatedDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.unstakedFee).toBe(sentinelFee);
    });

    it("should store fee=0 raw (distinct from null / never-set)", async () => {
      const mockDb = MockDb.createMockDb();
      const populatedDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      const mockEvent = UnstakedFeeModule.CustomFeeSet.createMockEvent({
        pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
        fee: 0n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: gaugeCapsModuleAddress,
        },
      });

      const result = await populatedDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.unstakedFee).toBe(0n);
    });

    it("should no-op (not throw) when the pool aggregator does not exist", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = UnstakedFeeModule.CustomFeeSet.createMockEvent({
        pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
        fee: 500n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: gaugeCapsModuleAddress,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Last-writer-wins across module deployments", () => {
    it("applies the most-recent event regardless of which module (Custom vs plain) fired it", async () => {
      let mockDb = MockDb.createMockDb();
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolAggregator,
      );

      // First: Initial CustomUnstakedFeeModule fires SetCustomFee with 300.
      const initialEvent = CustomUnstakedFeeModule.SetCustomFee.createMockEvent(
        {
          pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
          fee: 300n,
          mockEventData: {
            block: {
              timestamp: 1000000,
              number: 123456,
              hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
            },
            chainId: chainId,
            logIndex: 1,
            srcAddress: initialCustomModuleAddress,
          },
        },
      );
      mockDb = await mockDb.processEvents([initialEvent]);

      // Then: Gauges V3 UnstakedFeeModule fires CustomFeeSet with 700 on a later block.
      const laterEvent = UnstakedFeeModule.CustomFeeSet.createMockEvent({
        pool: mockLiquidityPoolAggregator.poolAddress as `0x${string}`,
        fee: 700n,
        mockEventData: {
          block: {
            timestamp: 1000100,
            number: 123500,
            hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: gaugesV3ModuleAddress,
        },
      });
      const result = await mockDb.processEvents([laterEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolAggregator.id,
      );
      expect(updatedPool?.unstakedFee).toBe(700n);
    });
  });
});
