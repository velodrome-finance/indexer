import { ALMLPWrapperV2, MockDb } from "../../../generated/src/TestHelpers.gen";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  toChecksumAddress,
} from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("ALMLPWrapperV2 Events", () => {
  const {
    mockALMLPWrapperData,
    mockLiquidityPoolData,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = mockLiquidityPoolData.chainId;
  const lpWrapperAddress = toChecksumAddress(
    "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const userA = toChecksumAddress("0xcccccccccccccccccccccccccccccccccccccccc");
  const userB = toChecksumAddress("0xdddddddddddddddddddddddddddddddddddddddd");

  const mockEventData = {
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
    chainId,
    logIndex: 1,
    srcAddress: lpWrapperAddress,
    transaction: {
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
  };

  describe("Deposit Event", () => {
    it("should update existing ALM_LP_Wrapper entity when it exists", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

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
      const mockDb = MockDb.createMockDb();

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Verify that no wrapper was created
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should create UserStatsPerPool entity if it doesn't exist", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStatsId = `${userA}_${poolAddress}_${chainId}`;
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      expect(userStats?.id).toBe(userStatsId);
      expect(userStats?.userAddress).toBe(userA);
      expect(userStats?.poolAddress).toBe(poolAddress);
      expect(userStats?.chainId).toBe(chainId);
      // User amounts are derived from LP share, not directly from event amounts
      expect(userStats?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
    });

    it("should update existing UserStatsPerPool entity with cumulative values", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      const userStatsId = `${userA}_${poolAddress}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userA,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 600n * TEN_TO_THE_18_BI,
        }),
      );

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      // ALM amounts are derived from LP share after deposit
      expect(userStats?.almLpAmount).toBe(1600n * TEN_TO_THE_18_BI); // 600 + 1000
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should update both ALM_LP_Wrapper and UserStatsPerPool in the same transaction", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStatsId = `${userA}_${poolAddress}_${chainId}`;

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

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
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler uses sender (not recipient), so we need to provide sender in the mock
      const mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        sender: userA,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      expect(wrapper?.liquidity).toBeDefined();
      // lpAmount is decremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      expect(wrapper?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const mockDb = MockDb.createMockDb();

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler uses sender (not recipient), so we need to provide sender in the mock
      const mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        sender: userA,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Verify that no wrapper was created or updated
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should update UserStatsPerPool entity for recipient with decreased amounts", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      const userStatsId = `${userA}_${poolAddress}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userA,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 2000n * TEN_TO_THE_18_BI,
        }),
      );

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler uses sender (not recipient), so we need to provide sender in the mock
      const mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        sender: userA,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

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
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (required for Transfer to work)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for both sender and recipient
      const userStatsFromId = `${userB}_${poolAddress}_${chainId}`;
      const userStatsToId = `${userA}_${poolAddress}_${chainId}`;

      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userB,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 5000n * TEN_TO_THE_18_BI, // Sender has 5000 tokens
        }),
      );

      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userA,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 2000n * TEN_TO_THE_18_BI, // Recipient has 2000 tokens
        }),
      );

      const transferAmount = 1000n * TEN_TO_THE_18_BI;
      const mockEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: userB,
        to: userA,
        value: transferAmount,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Transfer.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Verify ALM_LP_Wrapper is unchanged (transfers don't affect pool-level liquidity)
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeDefined();
      expect(wrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);

      // Verify sender's almLpAmount decreased
      const userStatsFrom =
        result.entities.UserStatsPerPool.get(userStatsFromId);
      expect(userStatsFrom).toBeDefined();
      expect(userStatsFrom?.almLpAmount).toBe(4000n * TEN_TO_THE_18_BI); // 5000 - 1000

      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).toBeDefined();
      expect(userStatsTo?.almLpAmount).toBe(3000n * TEN_TO_THE_18_BI); // 2000 + 1000
      expect(userStatsTo?.almAddress).toBe(lpWrapperAddress);
    });

    it("should handle transfer when recipient has no existing ALM position", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate only sender's user stats
      const userStatsFromId = `${userB}_${poolAddress}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: userB,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 3000n * TEN_TO_THE_18_BI,
        }),
      );

      const transferAmount = 500n * TEN_TO_THE_18_BI;
      const mockEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: userB,
        to: userA,
        value: transferAmount,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Transfer.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Verify sender's almLpAmount decreased
      const userStatsFrom =
        result.entities.UserStatsPerPool.get(userStatsFromId);
      expect(userStatsFrom?.almLpAmount).toBe(2500n * TEN_TO_THE_18_BI); // 3000 - 500

      // Verify recipient's almLpAmount was created and set to transfer amount
      const userStatsToId = `${userA}_${poolAddress}_${chainId}`;
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).toBeDefined();
      expect(userStatsTo?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI); // 0 + 500
      // Recipient's amounts are derived from LP share after transfer
      expect(userStatsTo?.almAddress).toBe(lpWrapperAddress);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: userB,
        to: userA,
        value: 1000n * TEN_TO_THE_18_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Transfer.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Verify that no wrapper was created or updated
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();

      // Verify that no user stats were created or updated
      const userStatsFromId = `${userB}_${poolAddress}_${chainId}`;
      const userStatsToId = `${userA}_${poolAddress}_${chainId}`;
      const userStatsFrom =
        result.entities.UserStatsPerPool.get(userStatsFromId);
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsFrom).toBeUndefined();
      expect(userStatsTo).toBeUndefined();
    });

    it("should skip zero address transfers (mint/burn) to avoid double counting", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const zeroAddress = "0x0000000000000000000000000000000000000000";
      const transferAmount = 1000n * TEN_TO_THE_18_BI;

      // Mint: from zero address - handler should return early without updating UserStatsPerPool
      // Deposit/Withdraw events already handle mints/burns correctly
      const mintEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: zeroAddress,
        to: userA,
        value: transferAmount,
        mockEventData,
      });

      const mintResult = await ALMLPWrapperV2.Transfer.processEvent({
        event: mintEvent,
        mockDb,
      });

      const toUserStatsId = `${userA}_${poolAddress}_${chainId}`;
      const toUserStats =
        mintResult.entities.UserStatsPerPool.get(toUserStatsId);

      // Handler returns early for mints, so no UserStatsPerPool should be created/updated
      expect(toUserStats).toBeUndefined();

      // Burn: to zero address - handler should return early without updating UserStatsPerPool
      // Pre-populate with user stats for the burner
      const burnerAddress = userB;
      const burnerUserStatsId = `${burnerAddress}_${poolAddress}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: burnerAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: transferAmount,
        }),
      );

      const burnEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: burnerAddress,
        to: zeroAddress,
        value: transferAmount,
        mockEventData,
      });

      const burnResult = await ALMLPWrapperV2.Transfer.processEvent({
        event: burnEvent,
        mockDb,
      });

      const burnerUserStats =
        burnResult.entities.UserStatsPerPool.get(burnerUserStatsId);

      // Handler returns early for burns, so UserStatsPerPool should remain unchanged
      expect(burnerUserStats).toBeDefined();
      expect(burnerUserStats?.almLpAmount).toBe(transferAmount); // Unchanged
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero amounts in Deposit", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 0n,
        amount0: 0n,
        amount1: 0n,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      // Zero amounts should add zero (no change to recalculated amounts)
      // Recalculation falls back to current, then adds 0
      expect(wrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);
    });

    it("should handle multiple deposits from different users", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const recipient2 = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

      // First deposit
      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      let mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      let result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Update mockDb with the result
      mockDb = result;

      // Second deposit from different user
      mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipient2,
        pool: poolAddress,
        lpAmount: 2000n * TEN_TO_THE_18_BI,
        amount0: 1000n * TEN_TO_THE_18_BI,
        amount1: 500n * TEN_TO_THE_6_BI,
        mockEventData: {
          ...mockEventData,
          block: {
            ...mockEventData.block,
            timestamp: 1000001,
          },
        },
      });

      result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb: result,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      expect(wrapper?.liquidity).toBeDefined();
      // lpAmount aggregates both deposits (incremented)
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount +
          1000n * TEN_TO_THE_18_BI +
          2000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 + 2000 = 5000

      // Both users should have their individual stats
      const userStats1Id = `${userA}_${poolAddress}_${chainId}`;
      const userStats2Id = `${recipient2}_${poolAddress}_${chainId}`;

      const userStats1 = result.entities.UserStatsPerPool.get(userStats1Id);
      const userStats2 = result.entities.UserStatsPerPool.get(userStats2Id);

      expect(userStats1).toBeDefined();
      expect(userStats1?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
      expect(userStats2).toBeDefined();
      expect(userStats2?.almLpAmount).toBe(2000n * TEN_TO_THE_18_BI);
    });

    it("should handle deposit and withdrawal sequence correctly", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // First deposit
      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      let mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: userA,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      let result = await ALMLPWrapperV2.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      mockDb = result;

      // Then withdraw
      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler uses sender (not recipient), so we need to provide sender in the mock
      mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        sender: userA,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData: {
          ...mockEventData,
          block: {
            ...mockEventData.block,
            timestamp: 1000001,
          },
        },
      });

      result = await ALMLPWrapperV2.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

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
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapperV2.TotalSupplyLimitUpdated.createMockEvent({
        newTotalSupplyLimit: 10000n * TEN_TO_THE_18_BI,
        totalSupplyLimitOld: 5000n * TEN_TO_THE_18_BI,
        totalSupplyCurrent: 7500n * TEN_TO_THE_18_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.TotalSupplyLimitUpdated.processEvent({
        event: mockEvent,
        mockDb,
      });

      const eventId = `${lpWrapperAddress}_${chainId}`;
      const createdEvent =
        result.entities.ALM_TotalSupplyLimitUpdated_event.get(eventId);

      expect(createdEvent).toBeDefined();
      expect(createdEvent?.id).toBe(eventId);
      expect(createdEvent?.lpWrapperAddress).toBe(lpWrapperAddress);
      expect(createdEvent?.currentTotalSupplyLPTokens).toBe(
        7500n * TEN_TO_THE_18_BI,
      );
      // Handler uses event.transaction.hash
      expect(createdEvent?.transactionHash).toBe(
        mockEventData.transaction.hash,
      );
    });

    it("should update existing ALM_TotalSupplyLimitUpdated_event entity", async () => {
      let mockDb = MockDb.createMockDb();

      const eventId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_TotalSupplyLimitUpdated_event.set({
        id: eventId,
        lpWrapperAddress: lpWrapperAddress,
        currentTotalSupplyLPTokens: 5000n * TEN_TO_THE_18_BI,
        transactionHash: "0xoldhash",
      });

      const newTransactionHash =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
      const mockEvent = ALMLPWrapperV2.TotalSupplyLimitUpdated.createMockEvent({
        newTotalSupplyLimit: 10000n * TEN_TO_THE_18_BI,
        totalSupplyLimitOld: 5000n * TEN_TO_THE_18_BI,
        totalSupplyCurrent: 8000n * TEN_TO_THE_18_BI,
        mockEventData: {
          ...mockEventData,
          transaction: {
            hash: newTransactionHash,
          },
        },
      });

      const result = await ALMLPWrapperV2.TotalSupplyLimitUpdated.processEvent({
        event: mockEvent,
        mockDb,
      });

      const updatedEvent =
        result.entities.ALM_TotalSupplyLimitUpdated_event.get(eventId);

      expect(updatedEvent).toBeDefined();
      expect(updatedEvent?.currentTotalSupplyLPTokens).toBe(
        8000n * TEN_TO_THE_18_BI,
      );
      expect(updatedEvent?.transactionHash).toBe(newTransactionHash);
    });
  });
});
