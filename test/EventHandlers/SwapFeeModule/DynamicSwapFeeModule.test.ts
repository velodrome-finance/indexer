import {
  DynamicSwapFeeModule,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("DynamicSwapFeeModule Events", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const moduleAddress = toChecksumAddress(
    "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
  );

  describe("SecondsAgoSet event", () => {
    it("should create the DynamicFeeGlobalConfig entity", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const secondsAgo = 300n;

      const mockEvent = DynamicSwapFeeModule.SecondsAgoSet.createMockEvent({
        secondsAgo: secondsAgo,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
          srcAddress: moduleAddress,
        },
      });

      // Execute
      const result = await DynamicSwapFeeModule.SecondsAgoSet.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert
      const config = result.entities.DynamicFeeGlobalConfig.get(
        toChecksumAddress(moduleAddress),
      );
      expect(config).toBeDefined();
      expect(config?.id).toBe(toChecksumAddress(moduleAddress));
      expect(config?.secondsAgo).toBe(secondsAgo);
    });
  });

  describe("Dynamic Fee Update Events", () => {
    it("should update baseFee, scalingFactor, and feeCap fields on the pool entity", async () => {
      // Setup
      let mockDb = MockDb.createMockDb();
      const poolAddress = toChecksumAddress(mockLiquidityPoolData.id);
      const baseFee = 400n;
      const scalingFactor = 10000000n;
      const feeCap = 2000n;

      // Pre-populate tokens and pool in the mock database
      mockDb = mockDb.entities.Token.set(mockToken0Data);
      mockDb = mockDb.entities.Token.set(mockToken1Data);
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(
        mockLiquidityPoolData,
      );

      // Execute - Update baseFee
      let result = await DynamicSwapFeeModule.CustomFeeSet.processEvent({
        event: DynamicSwapFeeModule.CustomFeeSet.createMockEvent({
          pool: poolAddress,
          fee: baseFee,
          mockEventData: {
            block: {
              timestamp: 1000000,
              number: 123456,
              hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
            },
            chainId: 10,
            logIndex: 1,
            srcAddress: moduleAddress,
          },
        }),
        mockDb,
      });

      let updatedPool = result.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );

      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(baseFee);
      expect(updatedPool?.scalingFactor).toBeUndefined();
      expect(updatedPool?.feeCap).toBeUndefined();

      // Execute - Update scalingFactor
      result = await DynamicSwapFeeModule.ScalingFactorSet.processEvent({
        event: DynamicSwapFeeModule.ScalingFactorSet.createMockEvent({
          pool: poolAddress,
          scalingFactor: scalingFactor,
          mockEventData: {
            block: {
              timestamp: 1000000,
              number: 123457,
              hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
            },
            chainId: 10,
            logIndex: 2,
            srcAddress: moduleAddress,
          },
        }),
        mockDb,
      });

      updatedPool = result.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );

      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBeUndefined();
      expect(updatedPool?.scalingFactor).toBe(scalingFactor);
      expect(updatedPool?.feeCap).toBeUndefined();

      // Execute - Update feeCap
      result = await DynamicSwapFeeModule.FeeCapSet.processEvent({
        event: DynamicSwapFeeModule.FeeCapSet.createMockEvent({
          pool: poolAddress,
          feeCap: feeCap,
          mockEventData: {
            block: {
              timestamp: 1000000,
              number: 123458,
              hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
            },
            chainId: 10,
            logIndex: 3,
            srcAddress: moduleAddress,
          },
        }),
        mockDb,
      });

      updatedPool = result.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBeUndefined();
      expect(updatedPool?.scalingFactor).toBeUndefined();
      expect(updatedPool?.feeCap).toBe(feeCap);
    });
  });
});
