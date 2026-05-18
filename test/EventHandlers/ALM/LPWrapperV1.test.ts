import { createTestIndexer } from "envio";
import {
  ALMLPWrapperId,
  ALMLPWrapperTransferInTxId,
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
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
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  );

  const blockTimestamp = 1000000;
  const blockNumber = 123456;
  const txHash =
    "0x1111111111111111111111111111111111111111111111111111111111111111";

  const block = {
    timestamp: blockTimestamp,
    number: blockNumber,
    hash: txHash,
  };

  const mockEventData = {
    block,
    chainId,
    logIndex: 1,
    srcAddress: lpWrapperAddress,
    transaction: {
      hash: txHash,
    },
  };

  /**
   * Helper function to seed a burn Transfer event on the indexer.
   * @param indexer - The test indexer
   * @param actualBurnedAmount - The actual LP amount burned
   * @param logIndex - The log index of the burn Transfer event (default: 0)
   */
  function seedBurnTransfer(
    indexer: ReturnType<typeof createTestIndexer>,
    actualBurnedAmount: bigint,
    logIndex = 0,
  ): void {
    const burnTransferId = ALMLPWrapperTransferInTxId(
      chainId,
      txHash,
      lpWrapperAddress,
      logIndex,
    );
    const zeroAddress = toChecksumAddress(
      "0x0000000000000000000000000000000000000000",
    );
    const burnTransfer = {
      id: burnTransferId,
      chainId: chainId,
      txHash: txHash,
      wrapperAddress: lpWrapperAddress,
      logIndex: logIndex,
      blockNumber: BigInt(blockNumber),
      from: senderAddress,
      to: zeroAddress,
      value: actualBurnedAmount,
      isBurn: true,
      consumedByLogIndex: undefined,
      timestamp: new Date(blockTimestamp * 1000),
    };
    indexer.ALMLPWrapperTransferInTx.set(burnTransfer);
  }

  describe("Deposit Event", () => {
    it("should update existing ALM_LP_Wrapper entity when it exists", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // V1: Deposit event has both sender and recipient fields
      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Deposit",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 1000n * TEN_TO_THE_18_BI,
          amount0: 500n * TEN_TO_THE_18_BI,
          amount1: 250n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      expect(wrapper?.id).toBe(wrapperId);
      expect(wrapper?.chainId).toBe(chainId);
      expect(wrapper?.pool).toBe(poolAddress);
      expect(wrapper?.lpAmount).toBe(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 = 3000
      // No Pool in indexer → sqrtPriceX96 undefined → liquidity unchanged
      expect(wrapper?.liquidity).toBe(mockALMLPWrapperData.liquidity);
      // Quirk 2: Date fields returned as ISO strings
      expect(
        new Date(wrapper?.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(blockTimestamp * 1000);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Deposit",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 1000n * TEN_TO_THE_18_BI,
          amount0: 500n * TEN_TO_THE_18_BI,
          amount1: 250n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
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

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Deposit",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 1000n * TEN_TO_THE_18_BI,
          amount0: 500n * TEN_TO_THE_18_BI,
          amount1: 250n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const userStatsId = UserStatsPerPoolId(
        chainId,
        recipientAddress,
        poolAddress,
      );
      const userStats = await indexer.UserStatsPerPool.get(userStatsId);

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
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      const userStatsId = UserStatsPerPoolId(
        chainId,
        recipientAddress,
        poolAddress,
      );
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: recipientAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 600n * TEN_TO_THE_18_BI,
        }),
      );

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Deposit",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 1000n * TEN_TO_THE_18_BI,
          amount0: 500n * TEN_TO_THE_18_BI,
          amount1: 250n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const userStats = await indexer.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      // ALM amounts are derived from LP share after deposit
      expect(userStats?.almLpAmount).toBe(1600n * TEN_TO_THE_18_BI); // 600 + 1000
      // Quirk 2: Date fields returned as ISO strings
      expect(
        new Date(
          userStats?.lastActivityTimestamp as unknown as string,
        ).getTime(),
      ).toBe(blockTimestamp * 1000);
    });

    it("should update both ALM_LP_Wrapper and UserStatsPerPool in the same transaction", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (created by StrategyCreated event)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Deposit",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 1000n * TEN_TO_THE_18_BI,
          amount0: 500n * TEN_TO_THE_18_BI,
          amount1: 250n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const userStatsId = UserStatsPerPoolId(
        chainId,
        recipientAddress,
        poolAddress,
      );

      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      const userStats = await indexer.UserStatsPerPool.get(userStatsId);

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
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with matching burn Transfer event (V1 needs this to get actual burned amount)
      seedBurnTransfer(indexer, 500n * TEN_TO_THE_18_BI, 0); // Before Withdraw event (logIndex: 1)

      // V1: Withdraw event has both sender and recipient fields
      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Withdraw",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 500n * TEN_TO_THE_18_BI,
          amount0: 250n * TEN_TO_THE_18_BI,
          amount1: 125n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).toBeDefined();
      // No Pool in indexer → sqrtPriceX96 undefined → liquidity unchanged
      expect(wrapper?.liquidity).toBe(mockALMLPWrapperData.liquidity);
      // lpAmount is decremented (aggregation from events)
      expect(wrapper?.lpAmount).toBe(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      // Quirk 2: Date fields returned as ISO strings
      expect(
        new Date(wrapper?.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(blockTimestamp * 1000);
    });

    it("should not update when ALM_LP_Wrapper entity not found", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Withdraw",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 500n * TEN_TO_THE_18_BI,
          amount0: 250n * TEN_TO_THE_18_BI,
          amount1: 125n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      // Verify that no wrapper was created
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      const wrapper = await indexer.ALM_LP_Wrapper.get(wrapperId);
      expect(wrapper).toBeUndefined();
    });

    it("should reduce UserStatsPerPool almLpAmount to zero after full withdrawal", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats (user has LP before withdrawing)
      // V1 withdraws use sender, not recipient
      const userStatsId = UserStatsPerPoolId(
        chainId,
        senderAddress,
        poolAddress,
      );
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: senderAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 500n * TEN_TO_THE_18_BI, // User has 500 LP
        }),
      );

      // Pre-populate with matching burn Transfer event (V1 needs this to get actual burned amount)
      seedBurnTransfer(indexer, 500n * TEN_TO_THE_18_BI, 0); // Before Withdraw event (logIndex: 1)

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Withdraw",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 500n * TEN_TO_THE_18_BI, // User withdraws all their LP
          amount0: 250n * TEN_TO_THE_18_BI,
          amount1: 125n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const userStats = await indexer.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      expect(userStats?.id).toBe(userStatsId);
      expect(userStats?.userAddress).toBe(senderAddress);
      expect(userStats?.poolAddress).toBe(poolAddress);
      expect(userStats?.chainId).toBe(chainId);
      expect(userStats?.almLpAmount).toBe(0n); // 500 - 500 = 0
    });

    it("should update existing UserStatsPerPool entity with decreased values", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats
      // V1 withdraws use sender, not recipient
      const userStatsId = UserStatsPerPoolId(
        chainId,
        senderAddress,
        poolAddress,
      );
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: senderAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 1600n * TEN_TO_THE_18_BI,
        }),
      );

      // Pre-populate with matching burn Transfer event (V1 needs this to get actual burned amount)
      seedBurnTransfer(indexer, 500n * TEN_TO_THE_18_BI, 0); // Before Withdraw event (logIndex: 1)

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Withdraw",
        params: {
          sender: senderAddress,
          recipient: recipientAddress,
          pool: poolAddress as `0x${string}`,
          lpAmount: 500n * TEN_TO_THE_18_BI,
          amount0: 250n * TEN_TO_THE_18_BI,
          amount1: 125n * TEN_TO_THE_6_BI,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const userStats = await indexer.UserStatsPerPool.get(userStatsId);

      expect(userStats).toBeDefined();
      // ALM amounts are derived from LP share after withdrawal
      expect(userStats?.almLpAmount).toBe(1100n * TEN_TO_THE_18_BI); // 1600 - 500
      // Quirk 2: Date fields returned as ISO strings
      expect(
        new Date(
          userStats?.lastActivityTimestamp as unknown as string,
        ).getTime(),
      ).toBe(blockTimestamp * 1000);
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
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper (required for Transfer events to get pool address)
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for sender
      const fromUserStatsId = UserStatsPerPoolId(
        chainId,
        fromAddress,
        poolAddress,
      );
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: fromAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 1000n * TEN_TO_THE_18_BI,
        }),
      );

      const transferAmount = 500n * TEN_TO_THE_18_BI;

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Transfer",
        params: {
          from: fromAddress,
          to: toAddress,
          value: transferAmount,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const fromUserStats = await indexer.UserStatsPerPool.get(fromUserStatsId);
      const toUserStatsId = UserStatsPerPoolId(chainId, toAddress, poolAddress);
      const toUserStats = await indexer.UserStatsPerPool.get(toUserStatsId);

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
      const indexer = createTestIndexer();

      const transferAmount = 500n * TEN_TO_THE_18_BI;

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Transfer",
        params: {
          from: fromAddress,
          to: toAddress,
          value: transferAmount,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      // Verify that no user stats were created
      const fromUserStatsId = UserStatsPerPoolId(
        chainId,
        fromAddress,
        poolAddress,
      );
      const fromUserStats = await indexer.UserStatsPerPool.get(fromUserStatsId);
      expect(fromUserStats).toBeUndefined();
    });

    it("should create UserStatsPerPool for recipient if it doesn't exist", async () => {
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      // Pre-populate with existing user stats for sender
      const fromUserStatsId = UserStatsPerPoolId(
        chainId,
        fromAddress,
        poolAddress,
      );
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: fromAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: 1000n * TEN_TO_THE_18_BI,
        }),
      );

      const transferAmount = 500n * TEN_TO_THE_18_BI;

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Transfer",
        params: {
          from: fromAddress,
          to: toAddress,
          value: transferAmount,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const toUserStatsId = UserStatsPerPoolId(chainId, toAddress, poolAddress);
      const toUserStats = await indexer.UserStatsPerPool.get(toUserStatsId);

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
      const indexer = createTestIndexer();

      // Pre-populate with existing wrapper
      const wrapperId = ALMLPWrapperId(chainId, lpWrapperAddress);
      indexer.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const zeroAddress = toChecksumAddress(
        "0x0000000000000000000000000000000000000000",
      );
      const transferAmount = 1000n * TEN_TO_THE_18_BI;

      // Mint: from zero address - handler should return early without updating UserStatsPerPool
      // Deposit/Withdraw events already handle mints/burns correctly
      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Transfer",
        params: {
          from: zeroAddress,
          to: toAddress,
          value: transferAmount,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 1,
      });

      const toUserStatsId = UserStatsPerPoolId(chainId, toAddress, poolAddress);
      const toUserStats = await indexer.UserStatsPerPool.get(toUserStatsId);

      // Handler returns early for mints, so no UserStatsPerPool should be created/updated
      expect(toUserStats).toBeUndefined();

      // Burn: to zero address - handler should return early without updating UserStatsPerPool
      // Pre-populate with user stats for the burner
      const burnerAddress = fromAddress;
      const burnerUserStatsId = UserStatsPerPoolId(
        chainId,
        burnerAddress,
        poolAddress,
      );
      indexer.UserStatsPerPool.set(
        createMockUserStatsPerPool({
          userAddress: burnerAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          almLpAmount: transferAmount,
        }),
      );

      await simulateEvent(indexer, chainId, {
        contract: "ALMLPWrapperV1",
        event: "Transfer",
        params: {
          from: burnerAddress,
          to: zeroAddress,
          value: transferAmount,
        },
        block,
        transaction: { hash: txHash },
        srcAddress: lpWrapperAddress,
        logIndex: 2,
      });

      const burnerUserStats =
        await indexer.UserStatsPerPool.get(burnerUserStatsId);

      // Handler returns early for burns, so UserStatsPerPool should remain unchanged
      expect(burnerUserStats).toBeDefined();
      expect(burnerUserStats?.almLpAmount).toBe(transferAmount); // Unchanged
    });
  });
});
