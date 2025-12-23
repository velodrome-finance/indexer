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
  const lpWrapperAddress = "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const poolAddress = mockLiquidityPoolData.id;
  const recipientAddress = "0xcccccccccccccccccccccccccccccccccccccccc";
  const senderAddress = "0xdddddddddddddddddddddddddddddddddddddddd";

  const mockEventData = {
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
    chainId,
    logIndex: 1,
    srcAddress: toChecksumAddress(lpWrapperAddress),
    transaction: {
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    },
  };

  describe("Deposit Event", () => {
    it("should update existing ALM_LP_Wrapper entity when it exists", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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
      // amount0 and amount1 are recalculated from liquidity and price, then deposited amounts are added
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // Then deposited amounts are added: current + deposited
      expect(wrapper?.amount0).toBe(
        mockALMLPWrapperData.amount0 + 500n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 = 1500
      expect(wrapper?.amount1).toBe(
        mockALMLPWrapperData.amount1 + 250n * TEN_TO_THE_6_BI,
      ); // 500 + 250 = 750
      // lpAmount is incremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 = 3000
      expect(wrapper?.ammStateIsDerived).toBe(true);
      expect(wrapper?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const mockDb = MockDb.createMockDb();

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should create UserStatsPerPool entity if it doesn't exist", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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

      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      expect(userStats?.id).toBe(userStatsId);
      expect(userStats?.userAddress).toBe(toChecksumAddress(recipientAddress));
      expect(userStats?.poolAddress).toBe(toChecksumAddress(poolAddress));
      expect(userStats?.chainId).toBe(chainId);
      // User amounts are derived from LP share, not directly from event amounts
      // After deposit: wrapper amount0=1500, amount1=750, lpAmount=3000
      // User LP=1000, so user gets: amount0=(1500*1000)/3000=500, amount1=(750*1000)/3000=250
      expect(userStats?.almAmount0).toBe(500n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).toBe(250n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
    });

    it("should update existing UserStatsPerPool entity with cumulative values", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: recipientAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almAmount0: 300n * TEN_TO_THE_18_BI,
          almAmount1: 150n * TEN_TO_THE_6_BI,
          almLpAmount: 600n * TEN_TO_THE_18_BI,
        }),
      );

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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
      // After deposit: wrapper amount0=1500, amount1=750, lpAmount=3000
      // User LP=1600 (600 existing + 1000 new), so user gets: amount0=(1500*1600)/3000=800, amount1=(750*1600)/3000=400
      expect(userStats?.almAmount0).toBe(800n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).toBe(400n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).toBe(1600n * TEN_TO_THE_18_BI); // 600 + 1000
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should update both ALM_LP_Wrapper and UserStatsPerPool in the same transaction", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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

      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(wrapper).toBeDefined();
      expect(userStats).toBeDefined();
      // amount0 and amount1 are recalculated from liquidity and price, then deposited amounts are added
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // Then deposited amounts are added: current + deposited
      expect(wrapper?.amount0).toBe(
        mockALMLPWrapperData.amount0 + 500n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 = 1500
      expect(wrapper?.amount1).toBe(
        mockALMLPWrapperData.amount1 + 250n * TEN_TO_THE_6_BI,
      ); // 500 + 250 = 750
      // lpAmount is incremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      );
      // User amounts are derived from LP share after deposit
      // After deposit: wrapper amount0=1500, amount1=750, lpAmount=3000
      // User LP=1000, so user gets: amount0=(1500*1000)/3000=500, amount1=(750*1000)/3000=250
      expect(userStats?.almAmount0).toBe(500n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).toBe(250n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
    });
  });

  describe("Withdraw Event", () => {
    it("should decrease amounts in existing ALM_LP_Wrapper entity", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        recipient: recipientAddress,
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
      // amount0 and amount1 are recalculated from liquidity and price, then withdrawn amounts are subtracted
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // Then withdrawn amounts are subtracted: current - withdrawn
      expect(wrapper?.amount0).toBe(
        mockALMLPWrapperData.amount0 - 250n * TEN_TO_THE_18_BI,
      ); // 1000 - 250 = 750
      expect(wrapper?.amount1).toBe(
        mockALMLPWrapperData.amount1 - 125n * TEN_TO_THE_6_BI,
      ); // 500 - 125 = 375
      // lpAmount is decremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      expect(wrapper?.ammStateIsDerived).toBe(true);
      expect(wrapper?.lastUpdatedTimestamp).toEqual(new Date(1000000 * 1000));
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const mockDb = MockDb.createMockDb();

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        recipient: recipientAddress,
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
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should update UserStatsPerPool entity for recipient with decreased amounts", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: recipientAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almAmount0: 1000n * TEN_TO_THE_18_BI,
          almAmount1: 500n * TEN_TO_THE_6_BI,
          almLpAmount: 2000n * TEN_TO_THE_18_BI,
        }),
      );

      // V2: Withdraw event has sender, recipient, pool, amount0, amount1, lpAmount
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        recipient: recipientAddress,
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
      // After withdrawal: wrapper amount0=750, amount1=375, lpAmount=1500
      // User LP=1500 (2000 - 500), so user gets: amount0=(750*1500)/1500=750, amount1=(375*1500)/1500=375
      expect(userStats?.almAmount0).toBe(750n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).toBe(375n * TEN_TO_THE_6_BI);
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
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for both sender and recipient
      const userStatsFromId = `${toChecksumAddress(senderAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStatsToId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: senderAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 5000n * TEN_TO_THE_18_BI, // Sender has 5000 tokens
        }),
      );

      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: recipientAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 2000n * TEN_TO_THE_18_BI, // Recipient has 2000 tokens
        }),
      );

      const transferAmount = 1000n * TEN_TO_THE_18_BI;
      const mockEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: senderAddress,
        to: recipientAddress,
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
      expect(wrapper?.amount0).toBe(mockALMLPWrapperData.amount0);
      expect(wrapper?.amount1).toBe(mockALMLPWrapperData.amount1);
      expect(wrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);

      // Verify sender's almLpAmount decreased
      const userStatsFrom =
        result.entities.UserStatsPerPool.get(userStatsFromId);
      expect(userStatsFrom).toBeDefined();
      expect(userStatsFrom?.almLpAmount).toBe(4000n * TEN_TO_THE_18_BI); // 5000 - 1000
      // Sender's amounts are derived from LP share after transfer
      // Wrapper: amount0=1000, amount1=500, lpAmount=2000 (unchanged in transfers)
      // Sender LP=4000, so sender gets: amount0=(1000*4000)/2000=2000, amount1=(500*4000)/2000=1000
      expect(userStatsFrom?.almAmount0).toBe(2000n * TEN_TO_THE_18_BI);
      expect(userStatsFrom?.almAmount1).toBe(1000n * TEN_TO_THE_6_BI);

      // Verify recipient's almLpAmount increased
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).toBeDefined();
      expect(userStatsTo?.almLpAmount).toBe(3000n * TEN_TO_THE_18_BI); // 2000 + 1000
      // Recipient's amounts are derived from LP share after transfer
      // Wrapper: amount0=1000, amount1=500, lpAmount=2000 (unchanged in transfers)
      // Recipient LP=3000, so recipient gets: amount0=(1000*3000)/2000=1500, amount1=(500*3000)/2000=750
      expect(userStatsTo?.almAmount0).toBe(1500n * TEN_TO_THE_18_BI);
      expect(userStatsTo?.almAmount1).toBe(750n * TEN_TO_THE_6_BI);
      expect(userStatsTo?.almAddress).toBe(toChecksumAddress(lpWrapperAddress));
    });

    it("should handle transfer when recipient has no existing ALM position", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate only sender's user stats
      const userStatsFromId = `${toChecksumAddress(senderAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: senderAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 3000n * TEN_TO_THE_18_BI,
        }),
      );

      const transferAmount = 500n * TEN_TO_THE_18_BI;
      const mockEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: senderAddress,
        to: recipientAddress,
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
      const userStatsToId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).toBeDefined();
      expect(userStatsTo?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI); // 0 + 500
      // Recipient's amounts are derived from LP share after transfer
      // Wrapper: amount0=1000, amount1=500, lpAmount=2000 (unchanged in transfers)
      // Recipient LP=500, so recipient gets: amount0=(1000*500)/2000=250, amount1=(500*500)/2000=125
      expect(userStatsTo?.almAmount0).toBe(250n * TEN_TO_THE_18_BI);
      expect(userStatsTo?.almAmount1).toBe(125n * TEN_TO_THE_6_BI);
      expect(userStatsTo?.almAddress).toBe(toChecksumAddress(lpWrapperAddress));
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapperV2.Transfer.createMockEvent({
        from: senderAddress,
        to: recipientAddress,
        value: 1000n * TEN_TO_THE_18_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV2.Transfer.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Verify that no wrapper was created or updated
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();

      // Verify that no user stats were created or updated
      const userStatsFromId = `${toChecksumAddress(senderAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStatsToId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStatsFrom =
        result.entities.UserStatsPerPool.get(userStatsFromId);
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsFrom).toBeUndefined();
      expect(userStatsTo).toBeUndefined();
    });

    it("should skip zero address transfers (mint/burn) to avoid double counting", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
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
        to: recipientAddress,
        value: transferAmount,
        mockEventData,
      });

      const mintResult = await ALMLPWrapperV2.Transfer.processEvent({
        event: mintEvent,
        mockDb,
      });

      const toUserStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const toUserStats =
        mintResult.entities.UserStatsPerPool.get(toUserStatsId);

      // Handler returns early for mints, so no UserStatsPerPool should be created/updated
      expect(toUserStats).toBeUndefined();

      // Burn: to zero address - handler should return early without updating UserStatsPerPool
      // Pre-populate with user stats for the burner
      const burnerAddress = senderAddress;
      const burnerUserStatsId = `${toChecksumAddress(burnerAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
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
      expect(burnerUserStats?.almAmount0).toBe(0n); // Unchanged
      expect(burnerUserStats?.almAmount1).toBe(0n); // Unchanged
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero amounts in Deposit", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      const mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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
      expect(wrapper?.amount0).toBe(mockALMLPWrapperData.amount0 + 0n);
      expect(wrapper?.amount1).toBe(mockALMLPWrapperData.amount1 + 0n);
      expect(wrapper?.lpAmount).toBe(mockALMLPWrapperData.lpAmount);
    });

    it("should handle multiple deposits from different users", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const recipient2 = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

      // First deposit
      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      let mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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
      // amount0 and amount1 are recalculated from liquidity and price, then deposited amounts are added
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // After first deposit: current + first deposit amounts
      // After second deposit: (current + first deposit) + second deposit amounts
      // Since recalculation always falls back to initial current, we get: current + first + second
      expect(wrapper?.amount0).toBe(
        mockALMLPWrapperData.amount0 +
          500n * TEN_TO_THE_18_BI +
          1000n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 + 1000 = 2500
      expect(wrapper?.amount1).toBe(
        mockALMLPWrapperData.amount1 +
          250n * TEN_TO_THE_6_BI +
          500n * TEN_TO_THE_6_BI,
      ); // 500 + 250 + 500 = 1250
      // lpAmount aggregates both deposits (incremented)
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount +
          1000n * TEN_TO_THE_18_BI +
          2000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 + 2000 = 5000

      // Both users should have their individual stats
      const userStats1Id = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStats2Id = `${toChecksumAddress(recipient2)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      const userStats1 = result.entities.UserStatsPerPool.get(userStats1Id);
      const userStats2 = result.entities.UserStatsPerPool.get(userStats2Id);

      expect(userStats1).toBeDefined();
      // User1 amounts are derived from LP share after both deposits
      // After both deposits: wrapper amount0=2500, amount1=1250, lpAmount=5000
      // User1 LP=1000, so user1 gets: amount0=(2500*1000)/5000=500, amount1=(1250*1000)/5000=250
      expect(userStats1?.almAmount0).toBe(500n * TEN_TO_THE_18_BI);
      expect(userStats2).toBeDefined();
      // User2 amounts are derived from LP share after both deposits
      // After both deposits: wrapper amount0=2500, amount1=1250, lpAmount=5000
      // User2 LP=2000, so user2 gets: amount0=(2500*2000)/5000=1000, amount1=(1250*2000)/5000=500
      expect(userStats2?.almAmount0).toBe(1000n * TEN_TO_THE_18_BI);
    });

    it("should handle deposit and withdrawal sequence correctly", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const initialAmount0 = 1000n * TEN_TO_THE_18_BI;
      const initialAmount1 = 500n * TEN_TO_THE_6_BI;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
        amount0: initialAmount0,
        amount1: initialAmount1,
      });

      // First deposit
      // V2: Deposit event has sender, recipient, pool, amount0, amount1, lpAmount, totalSupply
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      let mockEvent = ALMLPWrapperV2.Deposit.createMockEvent({
        recipient: recipientAddress,
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
      // The handler only uses recipient (not sender), so we only need to provide recipient in the mock
      mockEvent = ALMLPWrapperV2.Withdraw.createMockEvent({
        recipient: recipientAddress,
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
      // Initial + deposit - withdrawal
      // Since recalculation falls back to initial, we get: initial + deposit - withdrawal
      expect(wrapper?.amount0).toBe(
        initialAmount0 + 500n * TEN_TO_THE_18_BI - 250n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 - 250 = 1250
      expect(wrapper?.amount1).toBe(
        initialAmount1 + 250n * TEN_TO_THE_6_BI - 125n * TEN_TO_THE_6_BI,
      ); // 500 + 250 - 125 = 625
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

      const eventId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const createdEvent =
        result.entities.ALM_TotalSupplyLimitUpdated_event.get(eventId);

      expect(createdEvent).toBeDefined();
      expect(createdEvent?.id).toBe(eventId);
      expect(createdEvent?.lpWrapperAddress).toBe(
        toChecksumAddress(lpWrapperAddress),
      );
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

      const eventId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_TotalSupplyLimitUpdated_event.set({
        id: eventId,
        lpWrapperAddress: toChecksumAddress(lpWrapperAddress),
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
