import { createTestIndexer } from "envio";
import {
  ALMLPWrapperId,
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import { setupCommon } from "../Pool/common";

describe("ALMLPWrapperV2 Events", () => {
  const {
    mockALMLPWrapperData,
    mockLiquidityPoolData,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = mockLiquidityPoolData.chainId as 10;
  const lpWrapperAddress = toChecksumAddress(
    "0x0000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const userA = toChecksumAddress("0xcccccccccccccccccccccccccccccccccccccccc");
  const userB = toChecksumAddress("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");

  const blockTimestamp = 1000000;
  const blockNumber = 123456;
  const txHash =
    "0x1111111111111111111111111111111111111111111111111111111111111111";

  describe("Deposit Event", () => {
    it("should update existing ALM_LP_Wrapper entity when it exists", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 1000n * TEN_TO_THE_18_BI,
                  amount0: 500n * TEN_TO_THE_18_BI,
                  amount1: 250n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const rawWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      const wrapper = rawWrapper
        ? rehydrateTimestamps("ALM_LP_Wrapper", rawWrapper)
        : undefined;

      expect(wrapper).toBeDefined();
      expect(wrapper?.id).toBe(wrapperId);
      expect(wrapper?.chainId).toBe(chainId);
      expect(wrapper?.pool).toBe(toChecksumAddress(poolAddress));
      expect(wrapper?.liquidity).toBeDefined();
      // lpAmount is incremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 = 3000
      expect(wrapper?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const indexer = createTestIndexer();

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 1000n * TEN_TO_THE_18_BI,
                  amount0: 500n * TEN_TO_THE_18_BI,
                  amount1: 250n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      // Verify that no wrapper was created
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should create UserStatsPerPool entity if it doesn't exist", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 1000n * TEN_TO_THE_18_BI,
                  amount0: 500n * TEN_TO_THE_18_BI,
                  amount1: 250n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const userStatsId = UserStatsPerPoolId(chainId, userA, poolAddress);
      const userStats = await indexer.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      expect(userStats?.id).toBe(userStatsId);
      expect(userStats?.userAddress).toBe(userA);
      expect(userStats?.poolAddress).toBe(poolAddress);
      expect(userStats?.chainId).toBe(chainId);
      // User amounts are derived from LP share, not directly from event amounts
      expect(userStats?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
    });

    it("should update existing UserStatsPerPool entity with cumulative values", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      const userStatsId = UserStatsPerPoolId(chainId, userA, poolAddress);
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userA,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 600n * TEN_TO_THE_18_BI,
        }),
      );

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 1000n * TEN_TO_THE_18_BI,
                  amount0: 500n * TEN_TO_THE_18_BI,
                  amount1: 250n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const rawUserStats = await indexer.UserStatsPerPool.get(userStatsId);
      const userStats = rawUserStats
        ? rehydrateTimestamps("UserStatsPerPool", rawUserStats)
        : undefined;

      expect(userStats).toBeDefined();
      // ALM amounts are derived from LP share after deposit
      expect(userStats?.almLpAmount).toBe(1600n * TEN_TO_THE_18_BI); // 600 + 1000
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should update both ALM_LP_Wrapper and UserStatsPerPool in the same transaction", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 1000n * TEN_TO_THE_18_BI,
                  amount0: 500n * TEN_TO_THE_18_BI,
                  amount1: 250n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const userStatsId = UserStatsPerPoolId(chainId, userA, poolAddress);

      const rawWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      const wrapper = rawWrapper
        ? rehydrateTimestamps("ALM_LP_Wrapper", rawWrapper)
        : undefined;
      const userStats = await indexer.UserStatsPerPool.get(userStatsId);

      expect(wrapper).toBeDefined();
      expect(userStats).toBeDefined();
      expect(wrapper?.liquidity).toBeDefined();
      // lpAmount is incremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      );
      // User amounts are derived from LP share after deposit
      expect(userStats?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
    });
  });

  describe("Withdraw Event", () => {
    it("should decrease amounts in existing ALM_LP_Wrapper entity", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler uses sender (not recipient), so we need to provide sender in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Withdraw",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  sender: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 500n * TEN_TO_THE_18_BI,
                  amount0: 250n * TEN_TO_THE_18_BI,
                  amount1: 125n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const rawWrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      const wrapper = rawWrapper
        ? rehydrateTimestamps("ALM_LP_Wrapper", rawWrapper)
        : undefined;

      expect(wrapper).toBeDefined();
      expect(wrapper?.liquidity).toBeDefined();
      // lpAmount is decremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      expect(wrapper?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const indexer = createTestIndexer();

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler uses sender (not recipient), so we need to provide sender in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Withdraw",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  sender: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 500n * TEN_TO_THE_18_BI,
                  amount0: 250n * TEN_TO_THE_18_BI,
                  amount1: 125n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      // Verify that no wrapper was created or updated
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should update UserStatsPerPool entity for recipient with decreased amounts", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      const userStatsId = UserStatsPerPoolId(chainId, userA, poolAddress);
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userA,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 2000n * TEN_TO_THE_18_BI,
        }),
      );

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler uses sender (not recipient), so we need to provide sender in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Withdraw",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  sender: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 500n * TEN_TO_THE_18_BI,
                  amount0: 250n * TEN_TO_THE_18_BI,
                  amount1: 125n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const rawUserStats = await indexer.UserStatsPerPool.get(userStatsId);
      const userStats = rawUserStats
        ? rehydrateTimestamps("UserStatsPerPool", rawUserStats)
        : undefined;

      expect(userStats).toBeDefined();
      // ALM amounts are derived from LP share after withdrawal
      expect(userStats?.almLpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });

  describe("Transfer Event", () => {
    it("should update UserStatsPerPool for both sender and recipient", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (required for Transfer to work)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for both sender and recipient
      const userStatsFromId = UserStatsPerPoolId(chainId, userB, poolAddress);
      const userStatsToId = UserStatsPerPoolId(chainId, userA, poolAddress);

      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userB,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 5000n * TEN_TO_THE_18_BI, // Sender has 5000 tokens
        }),
      );

      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userA,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 2000n * TEN_TO_THE_18_BI, // Recipient has 2000 tokens
        }),
      );

      const transferAmount = 1000n * TEN_TO_THE_18_BI;

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Transfer",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  from: userB,
                  to: userA,
                  value: transferAmount,
                },
              },
            ],
          },
        },
      });

      // Verify ALM_LP_Wrapper is unchanged (transfers don't affect pool-level liquidity)
      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeDefined();
      expect(wrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);

      // Verify sender's almLpAmount decreased
      const userStatsFrom = await indexer.UserStatsPerPool.get(userStatsFromId);
      expect(userStatsFrom).toBeDefined();
      expect(userStatsFrom?.almLpAmount).toBe(4000n * TEN_TO_THE_18_BI); // 5000 - 1000

      const userStatsTo = await indexer.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).toBeDefined();
      expect(userStatsTo?.almLpAmount).toBe(3000n * TEN_TO_THE_18_BI); // 2000 + 1000
      expect(userStatsTo?.almAddress).toBe(lpWrapperAddress);
    });

    it("should handle transfer when recipient has no existing ALM position", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate only sender's user stats
      const userStatsFromId = UserStatsPerPoolId(chainId, userB, poolAddress);
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userB,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 3000n * TEN_TO_THE_18_BI,
        }),
      );

      const transferAmount = 500n * TEN_TO_THE_18_BI;

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Transfer",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  from: userB,
                  to: userA,
                  value: transferAmount,
                },
              },
            ],
          },
        },
      });

      // Verify sender's almLpAmount decreased
      const userStatsFrom = await indexer.UserStatsPerPool.get(userStatsFromId);
      expect(userStatsFrom?.almLpAmount).toBe(2500n * TEN_TO_THE_18_BI); // 3000 - 500

      // Verify recipient's almLpAmount was created and set to transfer amount
      const userStatsToId = UserStatsPerPoolId(chainId, userA, poolAddress);
      const userStatsTo = await indexer.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).toBeDefined();
      expect(userStatsTo?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI); // 0 + 500
      // Recipient's amounts are derived from LP share after transfer
      expect(userStatsTo?.almAddress).toBe(lpWrapperAddress);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const indexer = createTestIndexer();

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Transfer",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  from: userB,
                  to: userA,
                  value: 1000n * TEN_TO_THE_18_BI,
                },
              },
            ],
          },
        },
      });

      // Verify that no wrapper was created or updated
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();

      // Verify that no user stats were created or updated
      const userStatsFromId = UserStatsPerPoolId(chainId, userB, poolAddress);
      const userStatsToId = UserStatsPerPoolId(chainId, userA, poolAddress);
      const userStatsFrom = await indexer.UserStatsPerPool.get(userStatsFromId);
      const userStatsTo = await indexer.UserStatsPerPool.get(userStatsToId);
      expect(userStatsFrom).toBeUndefined();
      expect(userStatsTo).toBeUndefined();
    });

    it("should skip zero address transfers (mint/burn) to avoid double counting", async () => {
      // Mint scenario: fresh indexer — from zero address, no UserStatsPerPool should be created
      const mintIndexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      mintIndexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const zeroAddress = toChecksumAddress(
        "0x0000000000000000000000000000000000000000",
      );
      const transferAmount = 1000n * TEN_TO_THE_18_BI;

      // Mint: from zero address - handler should return early without updating UserStatsPerPool
      // Deposit/Withdraw events already handle mints/burns correctly
      await mintIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Transfer",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  from: zeroAddress,
                  to: userA,
                  value: transferAmount,
                },
              },
            ],
          },
        },
      });

      const toUserStatsId = UserStatsPerPoolId(chainId, userA, poolAddress);
      const toUserStats = await mintIndexer.UserStatsPerPool.get(toUserStatsId);

      // Handler returns early for mints, so no UserStatsPerPool should be created/updated
      expect(toUserStats).toBeUndefined();

      // Burn scenario: fresh indexer — to zero address, UserStatsPerPool should remain unchanged
      const burnIndexer = createTestIndexer();
      const burnerAddress = userB;
      const burnerUserStatsId = UserStatsPerPoolId(
        chainId,
        burnerAddress,
        poolAddress,
      );

      burnIndexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });
      burnIndexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: burnerAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: transferAmount,
        }),
      );

      await burnIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Transfer",
                srcAddress: lpWrapperAddress,
                logIndex: 2,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  from: burnerAddress,
                  to: zeroAddress,
                  value: transferAmount,
                },
              },
            ],
          },
        },
      });

      const burnerUserStats =
        await burnIndexer.UserStatsPerPool.get(burnerUserStatsId);

      // Handler returns early for burns, so UserStatsPerPool should remain unchanged
      expect(burnerUserStats).toBeDefined();
      expect(burnerUserStats?.almLpAmount).toBe(transferAmount); // Unchanged
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero amounts in Deposit", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 0n,
                  amount0: 0n,
                  amount1: 0n,
                },
              },
            ],
          },
        },
      });

      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      // Zero amounts should add zero (no change to recalculated amounts)
      // Recalculation falls back to current, then adds 0
      expect(wrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);
    });

    it("should handle multiple deposits from different users", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const recipient2 = toChecksumAddress(
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      );

      // Both deposits in ONE simulate array (B9: only one process() per indexer)
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 1000n * TEN_TO_THE_18_BI,
                  amount0: 500n * TEN_TO_THE_18_BI,
                  amount1: 250n * TEN_TO_THE_6_BI,
                },
              },
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 2,
                block: {
                  timestamp: 1000001,
                  number: blockNumber + 1,
                  hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: recipient2,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 2000n * TEN_TO_THE_18_BI,
                  amount0: 1000n * TEN_TO_THE_18_BI,
                  amount1: 500n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      expect(wrapper?.liquidity).toBeDefined();
      // lpAmount aggregates both deposits (incremented)
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount +
          1000n * TEN_TO_THE_18_BI +
          2000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 + 2000 = 5000

      // Both users should have their individual stats
      const userStats1Id = UserStatsPerPoolId(chainId, userA, poolAddress);
      const userStats2Id = UserStatsPerPoolId(chainId, recipient2, poolAddress);

      const userStats1 = await indexer.UserStatsPerPool.get(userStats1Id);
      const userStats2 = await indexer.UserStatsPerPool.get(userStats2Id);

      expect(userStats1).toBeDefined();
      expect(userStats1?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
      expect(userStats2).toBeDefined();
      expect(userStats2?.almLpAmount).toBe(2000n * TEN_TO_THE_18_BI);
    });

    it("should handle deposit and withdrawal sequence correctly", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Deposit then withdraw in ONE simulate array (B9: only one process() per indexer)
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "Deposit",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  recipient: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 1000n * TEN_TO_THE_18_BI,
                  amount0: 500n * TEN_TO_THE_18_BI,
                  amount1: 250n * TEN_TO_THE_6_BI,
                },
              },
              {
                contract: "ALMLPWrapperV2",
                event: "Withdraw",
                srcAddress: lpWrapperAddress,
                logIndex: 2,
                block: {
                  timestamp: 1000001,
                  number: blockNumber + 1,
                  hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  sender: userA,
                  pool: poolAddress as `0x${string}`,
                  lpAmount: 500n * TEN_TO_THE_18_BI,
                  amount0: 250n * TEN_TO_THE_18_BI,
                  amount1: 125n * TEN_TO_THE_6_BI,
                },
              },
            ],
          },
        },
      });

      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      // lpAmount: initial 2000 + deposit 1000 - withdraw 500 = 2500
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount +
          1000n * TEN_TO_THE_18_BI -
          500n * TEN_TO_THE_18_BI,
      );
      expect(wrapper?.liquidity).toBeDefined();
    });
  });

  describe("TotalSupplyLimitUpdated Event", () => {
    it("should create ALM_TotalSupplyLimitUpdated_event entity", async () => {
      const indexer = createTestIndexer();

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "TotalSupplyLimitUpdated",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  newTotalSupplyLimit: 10000n * TEN_TO_THE_18_BI,
                  totalSupplyLimitOld: 5000n * TEN_TO_THE_18_BI,
                  totalSupplyCurrent: 7500n * TEN_TO_THE_18_BI,
                },
              },
            ],
          },
        },
      });

      const eventId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const createdEvent =
        await indexer.ALM_TotalSupplyLimitUpdated_event.get(eventId);

      expect(createdEvent).toBeDefined();
      expect(createdEvent?.id).toBe(eventId);
      expect(createdEvent?.lpWrapperAddress).toBe(lpWrapperAddress);
      expect(createdEvent?.currentTotalSupplyLPTokens).toBe(
        7500n * TEN_TO_THE_18_BI,
      );
      // Handler uses event.transaction.hash
      expect(createdEvent?.transactionHash).toBe(txHash);
    });

    it("should update existing ALM_TotalSupplyLimitUpdated_event entity", async () => {
      const indexer = createTestIndexer();

      const eventId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_TotalSupplyLimitUpdated_event.set({
        id: eventId,
        lpWrapperAddress: lpWrapperAddress,
        currentTotalSupplyLPTokens: 5000n * TEN_TO_THE_18_BI,
        transactionHash: "0xoldhash",
      });

      const newTransactionHash =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "ALMLPWrapperV2",
                event: "TotalSupplyLimitUpdated",
                srcAddress: lpWrapperAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: txHash,
                },
                transaction: {
                  hash: newTransactionHash,
                },
                params: {
                  newTotalSupplyLimit: 10000n * TEN_TO_THE_18_BI,
                  totalSupplyLimitOld: 5000n * TEN_TO_THE_18_BI,
                  totalSupplyCurrent: 8000n * TEN_TO_THE_18_BI,
                },
              },
            ],
          },
        },
      });

      const updatedEvent =
        await indexer.ALM_TotalSupplyLimitUpdated_event.get(eventId);

      expect(updatedEvent).toBeDefined();
      expect(updatedEvent?.currentTotalSupplyLPTokens).toBe(
        8000n * TEN_TO_THE_18_BI,
      );
      expect(updatedEvent?.transactionHash).toBe(newTransactionHash);
    });
  });
});
