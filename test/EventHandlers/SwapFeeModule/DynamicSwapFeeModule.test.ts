import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { setupCommon } from "../Pool/common";

describe("DynamicSwapFeeModule Events", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const moduleAddress = toChecksumAddress(
    "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
  );

  describe("SecondsAgoSet event", () => {
    it("should create the DynamicFeeGlobalConfig entity", async () => {
      const indexer = createTestIndexer();
      const secondsAgo = 300n;

      await simulateEvent(indexer, 10, {
        contract: "DynamicSwapFeeModule",
        event: "SecondsAgoSet",
        params: { secondsAgo },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: moduleAddress,
        logIndex: 1,
      });

      const config = await indexer.DynamicFeeGlobalConfig.get(
        toChecksumAddress(moduleAddress),
      );
      expect(config).toBeDefined();
      expect(config?.id).toBe(toChecksumAddress(moduleAddress));
      expect(config?.secondsAgo).toBe(secondsAgo);
    });
  });

  describe("Dynamic Fee Update Events", () => {
    it("should update baseFee, scalingFactor, and feeCap fields on the pool entity", async () => {
      const indexer = createTestIndexer();
      const poolAddress = mockLiquidityPoolData.poolAddress;
      const baseFee = 400n;
      const scalingFactor = 10000000n;
      const feeCap = 2000n;

      // Pre-populate tokens and pool
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      // lastSnapshotTimestamp: undefined prevents Quirk 1 crash in shouldSnapshot.
      // Pool entity types lastSnapshotTimestamp as Date (non-null) — cast to bypass.
      indexer.Pool.set({
        ...mockLiquidityPoolData,
        lastSnapshotTimestamp: undefined,
      } as unknown as Parameters<typeof indexer.Pool.set>[0]);

      // Execute - Update baseFee
      await simulateEvent(indexer, 10, {
        contract: "DynamicSwapFeeModule",
        event: "CustomFeeSet",
        params: {
          pool: poolAddress as `0x${string}`,
          fee: baseFee,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        },
        srcAddress: moduleAddress,
        logIndex: 1,
      });

      let updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(baseFee);
      expect(updatedPool?.scalingFactor).toBeUndefined();
      expect(updatedPool?.feeCap).toBeUndefined();

      // Execute - Update scalingFactor (state persists on same indexer)
      await simulateEvent(indexer, 10, {
        contract: "DynamicSwapFeeModule",
        event: "ScalingFactorSet",
        params: {
          pool: poolAddress as `0x${string}`,
          scalingFactor,
        },
        block: {
          timestamp: 1000000,
          number: 123457,
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        },
        srcAddress: moduleAddress,
        logIndex: 2,
      });

      updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);
      expect(updatedPool).toBeDefined();
      // baseFee should be preserved from the previous event
      expect(updatedPool?.baseFee).toBe(baseFee);
      expect(updatedPool?.scalingFactor).toBe(scalingFactor);
      expect(updatedPool?.feeCap).toBeUndefined();

      // Execute - Update feeCap
      await simulateEvent(indexer, 10, {
        contract: "DynamicSwapFeeModule",
        event: "FeeCapSet",
        params: {
          pool: poolAddress as `0x${string}`,
          feeCap,
        },
        block: {
          timestamp: 1000000,
          number: 123458,
          hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        },
        srcAddress: moduleAddress,
        logIndex: 3,
      });

      updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);
      expect(updatedPool).toBeDefined();
      // baseFee and scalingFactor should be preserved from previous events
      expect(updatedPool?.baseFee).toBe(baseFee);
      expect(updatedPool?.scalingFactor).toBe(scalingFactor);
      expect(updatedPool?.feeCap).toBe(feeCap);
    });
  });
});
