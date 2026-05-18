import type { ALM_LP_Wrapper, UserStatsPerPool } from "envio";
import { createTestIndexer } from "envio";
import { ALMLPWrapperId, toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { setupCommon } from "../Pool/common";

describe("ALMCore Rebalance Event", () => {
  const {
    mockALMLPWrapperData,
    mockLiquidityPoolData,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const wrapperAddress = mockALMLPWrapperData.id.split("_")[0];
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const blockTimestamp = 1000000;
  const blockNumber = 123456;

  const block = {
    timestamp: blockTimestamp,
    number: blockNumber,
    hash: transactionHash,
  };

  describe("Rebalance event", () => {
    it("should update ALM_LP_Wrapper entity with new position state", async () => {
      const indexer = createTestIndexer();
      const wrapperId = mockALMLPWrapperData.id;
      // Pre-seed without Date fields to avoid Quirk 1 (handlers read lastUpdatedTimestamp)
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      });

      const newAmount0 = 800n * 10n ** 18n;
      const newAmount1 = 400n * 10n ** 6n;
      const newLiquidity = 2000000n;
      const newTokenId = 2n;
      const newTickLower = -1500n;
      const newTickUpper = 1500n;
      const newProperty = 3000n;
      const sqrtPriceX96 = 79228162514264337593543950336n; // sqrt(1) * 2^96

      await simulateEvent(indexer, chainId, {
        contract: "ALMCore",
        event: "Rebalance",
        params: {
          rebalanceEventParams: [
            poolAddress as `0x${string}`,
            [
              mockALMLPWrapperData.token0 as `0x${string}`,
              mockALMLPWrapperData.token1 as `0x${string}`,
              newProperty,
              newTickLower,
              newTickUpper,
              newLiquidity,
            ],
            sqrtPriceX96,
            newAmount0,
            newAmount1,
            1n, // ammPositionIdBefore
            newTokenId, // ammPositionIdAfter
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      const updatedWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(updatedWrapper).toBeDefined();
      expect(updatedWrapper?.liquidity).toBe(newLiquidity);
      expect(updatedWrapper?.tokenId).toBe(newTokenId);
      expect(updatedWrapper?.tickLower).toBe(newTickLower);
      expect(updatedWrapper?.tickUpper).toBe(newTickUpper);
      expect(updatedWrapper?.property).toBe(newProperty);
      // Quirk 2: Date fields returned as ISO strings from indexer
      expect(
        new Date(
          updatedWrapper?.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(blockTimestamp * 1000);

      // Verify wrapper-level lpAmount aggregation is preserved
      expect(updatedWrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const indexer = createTestIndexer();
      // No wrappers seeded

      await simulateEvent(indexer, chainId, {
        contract: "ALMCore",
        event: "Rebalance",
        params: {
          rebalanceEventParams: [
            poolAddress as `0x${string}`,
            [
              mockALMLPWrapperData.token0 as `0x${string}`,
              mockALMLPWrapperData.token1 as `0x${string}`,
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
            79228162514264337593543950336n,
            500n * 10n ** 18n,
            250n * 10n ** 6n,
            1n,
            2n,
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      // Verify that no wrapper was created or updated
      const updatedWrapper = await indexer.ALM_LP_Wrapper.get(
        mockALMLPWrapperData.id,
      );
      expect(updatedWrapper).toBeUndefined();
    });

    it("should handle multiple wrappers and update the first one", async () => {
      const indexer = createTestIndexer();

      // Create multiple wrappers with the same pool address
      const wrapper1: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ),
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      const wrapper2: ALM_LP_Wrapper = {
        ...mockALMLPWrapperData,
        id: ALMLPWrapperId(
          chainId,
          toChecksumAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        ),
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      };

      indexer.ALM_LP_Wrapper.set(wrapper1);
      indexer.ALM_LP_Wrapper.set(wrapper2);

      const newTokenId = 3n;
      await simulateEvent(indexer, chainId, {
        contract: "ALMCore",
        event: "Rebalance",
        params: {
          rebalanceEventParams: [
            poolAddress as `0x${string}`,
            [
              mockALMLPWrapperData.token0 as `0x${string}`,
              mockALMLPWrapperData.token1 as `0x${string}`,
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
            79228162514264337593543950336n,
            500n * 10n ** 18n,
            250n * 10n ** 6n,
            1n,
            newTokenId,
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      // Should update the first wrapper (wrapper1)
      const updatedWrapper1 = await indexer.ALM_LP_Wrapper.get(wrapper1.id);
      expect(updatedWrapper1?.tokenId).toBe(newTokenId);

      // Second wrapper should remain unchanged
      const unchangedWrapper2 = await indexer.ALM_LP_Wrapper.get(wrapper2.id);
      expect(unchangedWrapper2?.tokenId).toBe(wrapper2.tokenId);
    });

    it("should not update UserStatsPerPool on Rebalance (underlyings derived at snapshot time)", async () => {
      const indexer = createTestIndexer();
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
      });

      const userAlmLpAmount = 1000n * 10n ** 18n;
      const userStats = createMockUserStatsPerPool({
        poolAddress,
        chainId,
        almAddress: wrapperAddress,
        almLpAmount: userAlmLpAmount,
      });
      indexer.UserStatsPerPool.set(userStats);

      await simulateEvent(indexer, chainId, {
        contract: "ALMCore",
        event: "Rebalance",
        params: {
          rebalanceEventParams: [
            poolAddress as `0x${string}`,
            [
              mockALMLPWrapperData.token0 as `0x${string}`,
              mockALMLPWrapperData.token1 as `0x${string}`,
              3000n,
              -1000n,
              1000n,
              1000000n,
            ],
            79228162514264337593543950336n,
            800n * 10n ** 18n,
            400n * 10n ** 6n,
            1n,
            2n,
          ],
        },
        block,
        transaction: { hash: transactionHash },
        logIndex: 1,
      });

      const updatedWrapper = await indexer.ALM_LP_Wrapper.get(
        mockALMLPWrapperData.id,
      );
      expect(updatedWrapper?.liquidity).toBe(1000000n);
      expect(updatedWrapper?.tokenId).toBe(2n);

      // User stats unchanged (almAmount0/almAmount1 are derived at snapshot time, not stored)
      const updatedUser = await indexer.UserStatsPerPool.get(userStats.id);
      expect(updatedUser).toBeDefined();
      expect(updatedUser?.almLpAmount).toBe(userAlmLpAmount);
    });
  });
});
