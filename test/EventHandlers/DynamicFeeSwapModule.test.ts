import { expect } from "chai";
import {
  DynamicFeeSwapModule,
  MockDb,
} from "../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../src/Constants";
import { setupCommon } from "./Pool/common";

describe("DynamicFeeSwapModule Events", () => {
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

      const mockEvent = DynamicFeeSwapModule.SecondsAgoSet.createMockEvent({
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
      const result = await DynamicFeeSwapModule.SecondsAgoSet.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert
      const config = result.entities.DynamicFeeGlobalConfig.get(
        toChecksumAddress(moduleAddress),
      );
      expect(config).to.not.be.undefined;
      expect(config?.id).to.equal(toChecksumAddress(moduleAddress));
      expect(config?.secondsAgo).to.equal(secondsAgo);
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
      let result = await DynamicFeeSwapModule.CustomFeeSet.processEvent({
        event: DynamicFeeSwapModule.CustomFeeSet.createMockEvent({
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

      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.baseFee).to.equal(baseFee);
      expect(updatedPool?.scalingFactor).to.be.undefined;
      expect(updatedPool?.feeCap).to.be.undefined;

      // Execute - Update scalingFactor
      result = await DynamicFeeSwapModule.ScalingFactorSet.processEvent({
        event: DynamicFeeSwapModule.ScalingFactorSet.createMockEvent({
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

      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.baseFee).to.be.undefined;
      expect(updatedPool?.scalingFactor).to.equal(scalingFactor);
      expect(updatedPool?.feeCap).to.be.undefined;

      // Execute - Update feeCap
      result = await DynamicFeeSwapModule.FeeCapSet.processEvent({
        event: DynamicFeeSwapModule.FeeCapSet.createMockEvent({
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
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.baseFee).to.be.undefined;
      expect(updatedPool?.scalingFactor).to.be.undefined;
      expect(updatedPool?.feeCap).to.equal(feeCap);
    });
  });
});
