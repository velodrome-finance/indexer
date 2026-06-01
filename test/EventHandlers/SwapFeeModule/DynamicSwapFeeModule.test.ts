import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("DynamicSwapFeeModule Events", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const moduleAddress = toChecksumAddress(
    "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
  );
  const chainId = 10 as const;

  describe("SecondsAgoSet event", () => {
    it("should create the DynamicFeeGlobalConfig entity", async () => {
      // Setup
      const indexer = createTestIndexer();
      const secondsAgo = 300n;

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "DynamicSwapFeeModule",
                event: "SecondsAgoSet",
                srcAddress: moduleAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  secondsAgo: secondsAgo,
                },
              },
            ],
          },
        },
      });

      // Assert
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
      const poolAddress = mockLiquidityPoolData.poolAddress;
      const baseFee = 400n;
      const scalingFactor = 10000000n;
      const feeCap = 2000n;

      // Execute - Update baseFee (fresh indexer for first check)
      const indexer1 = createTestIndexer();
      indexer1.Token.set(mockToken0Data);
      indexer1.Token.set(mockToken1Data);
      indexer1.Pool.set(mockLiquidityPoolData);

      await indexer1.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "DynamicSwapFeeModule",
                event: "CustomFeeSet",
                srcAddress: moduleAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
                },
                params: {
                  pool: poolAddress as `0x${string}`,
                  fee: baseFee,
                },
              },
            ],
          },
        },
      });

      let updatedPool = await indexer1.Pool.get(mockLiquidityPoolData.id);

      expect(updatedPool).toBeDefined();
      expect(updatedPool?.baseFee).toBe(baseFee);
      expect(updatedPool?.scalingFactor).toBeUndefined();
      expect(updatedPool?.feeCap).toBeUndefined();

      // Execute - Update scalingFactor (fresh indexer seeded with state after first event)
      const indexer2 = createTestIndexer();
      indexer2.Token.set(mockToken0Data);
      indexer2.Token.set(mockToken1Data);
      // Seed pool with state from after first event
      indexer2.Pool.set({ ...mockLiquidityPoolData, baseFee: baseFee });

      await indexer2.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "DynamicSwapFeeModule",
                event: "ScalingFactorSet",
                srcAddress: moduleAddress,
                logIndex: 2,
                block: {
                  timestamp: 1000000,
                  number: 123457,
                  hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
                },
                params: {
                  pool: poolAddress as `0x${string}`,
                  scalingFactor: scalingFactor,
                },
              },
            ],
          },
        },
      });

      updatedPool = await indexer2.Pool.get(mockLiquidityPoolData.id);

      expect(updatedPool).toBeDefined();
      // baseFee should be preserved from the previous event
      expect(updatedPool?.baseFee).toBe(baseFee);
      expect(updatedPool?.scalingFactor).toBe(scalingFactor);
      expect(updatedPool?.feeCap).toBeUndefined();

      // Execute - Update feeCap (fresh indexer seeded with state after second event)
      const indexer3 = createTestIndexer();
      indexer3.Token.set(mockToken0Data);
      indexer3.Token.set(mockToken1Data);
      // Seed pool with state from after second event
      indexer3.Pool.set({
        ...mockLiquidityPoolData,
        baseFee: baseFee,
        scalingFactor: scalingFactor,
      });

      await indexer3.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "DynamicSwapFeeModule",
                event: "FeeCapSet",
                srcAddress: moduleAddress,
                logIndex: 3,
                block: {
                  timestamp: 1000000,
                  number: 123458,
                  hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
                },
                params: {
                  pool: poolAddress as `0x${string}`,
                  feeCap: feeCap,
                },
              },
            ],
          },
        },
      });

      updatedPool = await indexer3.Pool.get(mockLiquidityPoolData.id);
      expect(updatedPool).toBeDefined();
      // baseFee and scalingFactor should be preserved from previous events
      expect(updatedPool?.baseFee).toBe(baseFee);
      expect(updatedPool?.scalingFactor).toBe(scalingFactor);
      expect(updatedPool?.feeCap).toBe(feeCap);
    });
  });
});
