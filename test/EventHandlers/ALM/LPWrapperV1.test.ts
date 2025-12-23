import { ALMLPWrapperV1, MockDb } from "../../../generated/src/TestHelpers.gen";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  toChecksumAddress,
} from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("ALMLPWrapperV1 Events", () => {
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

      // V1: Deposit event has both sender and recipient fields
      const mockEvent = ALMLPWrapperV1.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).not.toBeUndefined();
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

      const mockEvent = ALMLPWrapperV1.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Deposit.processEvent({
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

      const mockEvent = ALMLPWrapperV1.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).not.toBeUndefined();
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
      // V1: recipient receives the LP tokens, so their stats are updated
      expect(userStats?.almAddress).toBe(toChecksumAddress(lpWrapperAddress));
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

      const mockEvent = ALMLPWrapperV1.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).not.toBeUndefined();
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

      const mockEvent = ALMLPWrapperV1.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(wrapper).not.toBeUndefined();
      expect(userStats).not.toBeUndefined();
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

      // V1: Withdraw event has both sender and recipient fields
      const mockEvent = ALMLPWrapperV1.Withdraw.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).not.toBeUndefined();
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

      const mockEvent = ALMLPWrapperV1.Withdraw.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Withdraw.processEvent({
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

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats (user has LP before withdrawing)
      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: toChecksumAddress(recipientAddress),
          poolAddress: toChecksumAddress(poolAddress),
          chainId: chainId,
          almLpAmount: 500n * TEN_TO_THE_18_BI, // User has 500 LP
        }),
      );

      const mockEvent = ALMLPWrapperV1.Withdraw.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI, // User withdraws all their LP
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).not.toBeUndefined();
      expect(userStats?.id).toBe(userStatsId);
      expect(userStats?.userAddress).toBe(toChecksumAddress(recipientAddress));
      expect(userStats?.poolAddress).toBe(toChecksumAddress(poolAddress));
      expect(userStats?.chainId).toBe(chainId);
      // User amounts are derived from LP share after withdrawal
      // After withdrawal: wrapper amount0=750, amount1=375, lpAmount=1500
      // User LP=0 (500 - 500), so derived amounts are 0
      expect(userStats?.almAmount0).toBe(0n);
      expect(userStats?.almAmount1).toBe(0n);
      expect(userStats?.almLpAmount).toBe(0n); // 500 - 500 = 0
    });

    it("should update existing UserStatsPerPool entity with decreased values", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
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
          almAmount0: 800n * TEN_TO_THE_18_BI,
          almAmount1: 400n * TEN_TO_THE_6_BI,
          almLpAmount: 1600n * TEN_TO_THE_18_BI,
        }),
      );

      const mockEvent = ALMLPWrapperV1.Withdraw.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).not.toBeUndefined();
      // ALM amounts are derived from LP share after withdrawal
      // After withdrawal: wrapper amount0=750, amount1=375, lpAmount=1500
      // User LP=1100 (1600 - 500), so user gets: amount0=(750*1100)/1500=550, amount1=(375*1100)/1500=275
      expect(userStats?.almAmount0).toBe(550n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).toBe(275n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).toBe(1100n * TEN_TO_THE_18_BI); // 1600 - 500
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });

  describe("Transfer Event", () => {
    const fromAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const toAddress = "0xffffffffffffffffffffffffffffffffffffffff";

    it("should update UserStatsPerPool for both sender and recipient", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (required for Transfer events to get pool address)
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for sender
      const fromUserStatsId = `${toChecksumAddress(fromAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: fromAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 1000n * TEN_TO_THE_18_BI,
        }),
      );

      const transferAmount = 500n * TEN_TO_THE_18_BI;

      const mockEvent = ALMLPWrapperV1.Transfer.createMockEvent({
        from: fromAddress,
        to: toAddress,
        value: transferAmount,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Transfer.processEvent({
        event: mockEvent,
        mockDb,
      });

      const fromUserStats =
        result.entities.UserStatsPerPool.get(fromUserStatsId);
      const toUserStatsId = `${toChecksumAddress(toAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const toUserStats = result.entities.UserStatsPerPool.get(toUserStatsId);

      expect(fromUserStats).not.toBeUndefined();
      expect(toUserStats).not.toBeUndefined();

      // Sender's almLpAmount should be decreased
      expect(fromUserStats?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI); // 1000 - 500
      // Sender's amounts are derived from LP share after transfer
      // Wrapper: amount0=1000, amount1=500, lpAmount=2000 (unchanged in transfers)
      // Sender LP=500, so sender gets: amount0=(1000*500)/2000=250, amount1=(500*500)/2000=125
      expect(fromUserStats?.almAmount0).toBe(250n * TEN_TO_THE_18_BI);
      expect(fromUserStats?.almAmount1).toBe(125n * TEN_TO_THE_6_BI);

      // Recipient's almLpAmount should be increased
      expect(toUserStats?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI);
      // Recipient's amounts are derived from LP share after transfer
      // Wrapper: amount0=1000, amount1=500, lpAmount=2000 (unchanged in transfers)
      // Recipient LP=500, so recipient gets: amount0=(1000*500)/2000=250, amount1=(500*500)/2000=125
      expect(toUserStats?.almAmount0).toBe(250n * TEN_TO_THE_18_BI);
      expect(toUserStats?.almAmount1).toBe(125n * TEN_TO_THE_6_BI);
      expect(toUserStats?.almAddress).toBe(toChecksumAddress(lpWrapperAddress));
      expect(toUserStats?.userAddress).toBe(toChecksumAddress(toAddress));
      expect(toUserStats?.poolAddress).toBe(toChecksumAddress(poolAddress));
      expect(toUserStats?.chainId).toBe(chainId);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const mockDb = MockDb.createMockDb();

      const transferAmount = 500n * TEN_TO_THE_18_BI;

      const mockEvent = ALMLPWrapperV1.Transfer.createMockEvent({
        from: fromAddress,
        to: toAddress,
        value: transferAmount,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Transfer.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Verify that no user stats were created
      const fromUserStatsId = `${toChecksumAddress(fromAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const fromUserStats =
        result.entities.UserStatsPerPool.get(fromUserStatsId);
      expect(fromUserStats).toBeUndefined();
    });

    it("should create UserStatsPerPool for recipient if it doesn't exist", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for sender
      const fromUserStatsId = `${toChecksumAddress(fromAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: fromAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 1000n * TEN_TO_THE_18_BI,
        }),
      );

      const transferAmount = 500n * TEN_TO_THE_18_BI;

      const mockEvent = ALMLPWrapperV1.Transfer.createMockEvent({
        from: fromAddress,
        to: toAddress,
        value: transferAmount,
        mockEventData,
      });

      const result = await ALMLPWrapperV1.Transfer.processEvent({
        event: mockEvent,
        mockDb,
      });

      const toUserStatsId = `${toChecksumAddress(toAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const toUserStats = result.entities.UserStatsPerPool.get(toUserStatsId);

      expect(toUserStats).not.toBeUndefined();
      expect(toUserStats?.id).toBe(toUserStatsId);
      expect(toUserStats?.userAddress).toBe(toChecksumAddress(toAddress));
      expect(toUserStats?.poolAddress).toBe(toChecksumAddress(poolAddress));
      expect(toUserStats?.chainId).toBe(chainId);
      expect(toUserStats?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI);
      expect(toUserStats?.almAddress).toBe(toChecksumAddress(lpWrapperAddress));
      // Recipient's amounts are derived from LP share after transfer
      // Wrapper: amount0=1000, amount1=500, lpAmount=2000 (unchanged in transfers)
      // Recipient LP=500, so recipient gets: amount0=(1000*500)/2000=250, amount1=(500*500)/2000=125
      expect(toUserStats?.almAmount0).toBe(250n * TEN_TO_THE_18_BI);
      expect(toUserStats?.almAmount1).toBe(125n * TEN_TO_THE_6_BI);
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
      const mintEvent = ALMLPWrapperV1.Transfer.createMockEvent({
        from: zeroAddress,
        to: toAddress,
        value: transferAmount,
        mockEventData,
      });

      const mintResult = await ALMLPWrapperV1.Transfer.processEvent({
        event: mintEvent,
        mockDb,
      });

      const toUserStatsId = `${toChecksumAddress(toAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const toUserStats =
        mintResult.entities.UserStatsPerPool.get(toUserStatsId);

      // Handler returns early for mints, so no UserStatsPerPool should be created/updated
      expect(toUserStats).toBeUndefined();

      // Burn: to zero address - handler should return early without updating UserStatsPerPool
      // Pre-populate with user stats for the burner
      const burnerAddress = fromAddress;
      const burnerUserStatsId = `${toChecksumAddress(burnerAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: burnerAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: transferAmount,
        }),
      );

      const burnEvent = ALMLPWrapperV1.Transfer.createMockEvent({
        from: burnerAddress,
        to: zeroAddress,
        value: transferAmount,
        mockEventData,
      });

      const burnResult = await ALMLPWrapperV1.Transfer.processEvent({
        event: burnEvent,
        mockDb,
      });

      const burnerUserStats =
        burnResult.entities.UserStatsPerPool.get(burnerUserStatsId);

      // Handler returns early for burns, so UserStatsPerPool should remain unchanged
      expect(burnerUserStats).not.toBeUndefined();
      expect(burnerUserStats?.almLpAmount).toBe(transferAmount); // Unchanged
      expect(burnerUserStats?.almAmount0).toBe(0n); // Unchanged
      expect(burnerUserStats?.almAmount1).toBe(0n); // Unchanged
    });
  });
});
