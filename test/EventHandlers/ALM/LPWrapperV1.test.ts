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
  const lpWrapperAddress = toChecksumAddress(
    "0x000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const recipientAddress = toChecksumAddress(
    "0xcccccccccccccccccccccccccccccccccccccccc",
  );
  const senderAddress = toChecksumAddress(
    "0xdddddddddddddddddddddddddddddddddddddddd",
  );

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

  /**
   * Helper function to set up a burn Transfer event and extend mockDb with getWhere support
   * @param mockDb - The mock database to extend
   * @param actualBurnedAmount - The actual LP amount burned
   * @param logIndex - The log index of the burn Transfer event (default: 0)
   * @returns The extended mockDb with burn Transfer event set up
   */
  function setupBurnTransferAndExtendMockDb(
    mockDb: ReturnType<typeof MockDb.createMockDb>,
    actualBurnedAmount: bigint,
    logIndex = 0,
  ): ReturnType<typeof MockDb.createMockDb> {
    const burnTransferId = `${chainId}-${mockEventData.transaction.hash}-${lpWrapperAddress}-${logIndex}`;
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    const burnTransfer = {
      id: burnTransferId,
      chainId: chainId,
      txHash: mockEventData.transaction.hash,
      wrapperAddress: lpWrapperAddress,
      logIndex: logIndex,
      blockNumber: BigInt(mockEventData.block.number),
      from: senderAddress,
      to: zeroAddress,
      value: actualBurnedAmount,
      isBurn: true,
      consumedByLogIndex: undefined,
      timestamp: new Date(mockEventData.block.timestamp * 1000),
    };
    let updatedMockDb =
      mockDb.entities.ALMLPWrapperTransferInTx.set(burnTransfer);

    // Extend mockDb to support getWhere queries for ALMLPWrapperTransferInTx
    const storedTransfers = [burnTransfer];
    updatedMockDb = {
      ...updatedMockDb,
      entities: {
        ...updatedMockDb.entities,
        ALMLPWrapperTransferInTx: {
          ...updatedMockDb.entities.ALMLPWrapperTransferInTx,
          getWhere: {
            txHash: {
              eq: async (txHash: string) => {
                return storedTransfers.filter((t) => t.txHash === txHash);
              },
            },
          },
          get: (id: string) => {
            return storedTransfers.find((t) => t.id === id);
          },
          // biome-ignore lint/suspicious/noExplicitAny: Mock entity type not available
          set: (entity: any) => {
            const index = storedTransfers.findIndex((t) => t.id === entity.id);
            if (index >= 0) {
              storedTransfers[index] = entity;
            } else {
              storedTransfers.push(entity);
            }
            return updatedMockDb;
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: MockDb type extension needed for test setup
    } as any;

    return updatedMockDb;
  }

  describe("Deposit Event", () => {
    it("should update existing ALM_LP_Wrapper entity when it exists", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
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

      expect(wrapper).toBeDefined();
      expect(wrapper?.id).toBe(wrapperId);
      expect(wrapper?.chainId).toBe(chainId);
      expect(wrapper?.pool).toBe(poolAddress);
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 = 3000
      // No LiquidityPoolAggregator in mockDb → sqrtPriceX96 undefined → liquidity unchanged
      expect(wrapper?.liquidity).toBe(mockALMLPWrapperData.liquidity);
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

      const userStatsId = `${recipientAddress}_${poolAddress}_${chainId}`;
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      expect(userStats?.id).toBe(userStatsId);
      expect(userStats?.userAddress).toBe(recipientAddress);
      expect(userStats?.poolAddress).toBe(poolAddress);
      expect(userStats?.chainId).toBe(chainId);
      expect(userStats?.almLpAmount).toBe(1000n * TEN_TO_THE_18_BI);
      // V1: recipient receives the LP tokens, so their stats are updated
      expect(userStats?.almAddress).toBe(lpWrapperAddress);
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
      const userStatsId = `${recipientAddress}_${poolAddress}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: recipientAddress,
          poolAddress: poolAddress,
          chainId: chainId,
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

      const userStatsId = `${recipientAddress}_${poolAddress}_${chainId}`;

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(wrapper).toBeDefined();
      expect(userStats).toBeDefined();
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      );
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

      // Pre-populate with matching burn Transfer event (V1 needs this to get actual burned amount)
      mockDb = setupBurnTransferAndExtendMockDb(
        mockDb,
        500n * TEN_TO_THE_18_BI,
        0, // Before Withdraw event (logIndex: 1)
      );

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

      expect(wrapper).toBeDefined();
      // No LiquidityPoolAggregator in mockDb → sqrtPriceX96 undefined → liquidity unchanged
      expect(wrapper?.liquidity).toBe(mockALMLPWrapperData.liquidity);
      // lpAmount is decremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500
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
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should create UserStatsPerPool entity if it doesn't exist", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats (user has LP before withdrawing)
      // V1 withdraws use sender, not recipient
      const userStatsId = `${senderAddress}_${poolAddress}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: senderAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 500n * TEN_TO_THE_18_BI, // User has 500 LP
        }),
      );

      // Pre-populate with matching burn Transfer event (V1 needs this to get actual burned amount)
      mockDb = setupBurnTransferAndExtendMockDb(
        mockDb,
        500n * TEN_TO_THE_18_BI,
        0, // Before Withdraw event (logIndex: 1)
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

      expect(userStats).toBeDefined();
      expect(userStats?.id).toBe(userStatsId);
      expect(userStats?.userAddress).toBe(senderAddress);
      expect(userStats?.poolAddress).toBe(poolAddress);
      expect(userStats?.chainId).toBe(chainId);
      expect(userStats?.almLpAmount).toBe(0n); // 500 - 500 = 0
    });

    it("should update existing UserStatsPerPool entity with decreased values", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      // V1 withdraws use sender, not recipient
      const userStatsId = `${senderAddress}_${poolAddress}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: senderAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 1600n * TEN_TO_THE_18_BI,
        }),
      );

      // Pre-populate with matching burn Transfer event (V1 needs this to get actual burned amount)
      mockDb = setupBurnTransferAndExtendMockDb(
        mockDb,
        500n * TEN_TO_THE_18_BI,
        0, // Before Withdraw event (logIndex: 1)
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

      expect(userStats).toBeDefined();
      // ALM amounts are derived from LP share after withdrawal
      expect(userStats?.almLpAmount).toBe(1100n * TEN_TO_THE_18_BI); // 1600 - 500
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });

  describe("Transfer Event", () => {
    const fromAddress = toChecksumAddress(
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    );
    const toAddress = toChecksumAddress(
      "0xffffffffffffffffffffffffffffffffffffffff",
    );

    it("should update UserStatsPerPool for both sender and recipient", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper (required for Transfer events to get pool address)
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for sender
      const fromUserStatsId = `${fromAddress}_${poolAddress}_${chainId}`;
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
      const toUserStatsId = `${toAddress}_${poolAddress}_${chainId}`;
      const toUserStats = result.entities.UserStatsPerPool.get(toUserStatsId);

      expect(fromUserStats).toBeDefined();
      expect(toUserStats).toBeDefined();

      expect(fromUserStats?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI); // 1000 - 500
      expect(toUserStats?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI);
      expect(toUserStats?.almAddress).toBe(lpWrapperAddress);
      expect(toUserStats?.userAddress).toBe(toAddress);
      expect(toUserStats?.poolAddress).toBe(poolAddress);
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
      const fromUserStatsId = `${fromAddress}_${poolAddress}_${chainId}`;
      const fromUserStats =
        result.entities.UserStatsPerPool.get(fromUserStatsId);
      expect(fromUserStats).toBeUndefined();
    });

    it("should create UserStatsPerPool for recipient if it doesn't exist", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${lpWrapperAddress}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for sender
      const fromUserStatsId = `${fromAddress}_${poolAddress}_${chainId}`;
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

      const toUserStatsId = `${toAddress}_${poolAddress}_${chainId}`;
      const toUserStats = result.entities.UserStatsPerPool.get(toUserStatsId);

      expect(toUserStats).toBeDefined();
      expect(toUserStats?.id).toBe(toUserStatsId);
      expect(toUserStats?.userAddress).toBe(toAddress);
      expect(toUserStats?.poolAddress).toBe(poolAddress);
      expect(toUserStats?.chainId).toBe(chainId);
      expect(toUserStats?.almLpAmount).toBe(500n * TEN_TO_THE_18_BI);
      expect(toUserStats?.almAddress).toBe(lpWrapperAddress);
      // Recipient's amounts are derived from LP share after transfer
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

      const toUserStatsId = `${toAddress}_${poolAddress}_${chainId}`;
      const toUserStats =
        mintResult.entities.UserStatsPerPool.get(toUserStatsId);

      // Handler returns early for mints, so no UserStatsPerPool should be created/updated
      expect(toUserStats).toBeUndefined();

      // Burn: to zero address - handler should return early without updating UserStatsPerPool
      // Pre-populate with user stats for the burner
      const burnerAddress = fromAddress;
      const burnerUserStatsId = `${burnerAddress}_${poolAddress}_${chainId}`;
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
      expect(burnerUserStats).toBeDefined();
      expect(burnerUserStats?.almLpAmount).toBe(transferAmount); // Unchanged
    });
  });
});
