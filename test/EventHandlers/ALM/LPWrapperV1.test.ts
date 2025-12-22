import { expect } from "chai";
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

      expect(wrapper).to.not.be.undefined;
      expect(wrapper?.id).to.equal(wrapperId);
      expect(wrapper?.chainId).to.equal(chainId);
      expect(wrapper?.pool).to.equal(toChecksumAddress(poolAddress));
      // amount0 and amount1 are recalculated from liquidity and price, then deposited amounts are added
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // Then deposited amounts are added: current + deposited
      expect(wrapper?.amount0).to.equal(
        mockALMLPWrapperData.amount0 + 500n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 = 1500
      expect(wrapper?.amount1).to.equal(
        mockALMLPWrapperData.amount1 + 250n * TEN_TO_THE_6_BI,
      ); // 500 + 250 = 750
      // lpAmount is incremented (aggregation from events)
      expect(wrapper?.lpAmount).to.equal(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 = 3000
      expect(wrapper?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
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
      expect(wrapper).to.be.undefined;
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

      expect(userStats).to.not.be.undefined;
      expect(userStats?.id).to.equal(userStatsId);
      expect(userStats?.userAddress).to.equal(
        toChecksumAddress(recipientAddress),
      );
      expect(userStats?.poolAddress).to.equal(toChecksumAddress(poolAddress));
      expect(userStats?.chainId).to.equal(chainId);
      expect(userStats?.almAmount0).to.equal(500n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).to.equal(250n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).to.equal(1000n * TEN_TO_THE_18_BI);
      // V1: recipient receives the LP tokens, so their stats are updated
      expect(userStats?.almAddress).to.equal(
        toChecksumAddress(lpWrapperAddress),
      );
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

      expect(userStats).to.not.be.undefined;
      // ALM amounts should be cumulative (added to existing values)
      expect(userStats?.almAmount0).to.equal(800n * TEN_TO_THE_18_BI); // 300 + 500
      expect(userStats?.almAmount1).to.equal(400n * TEN_TO_THE_6_BI); // 150 + 250
      expect(userStats?.almLpAmount).to.equal(1600n * TEN_TO_THE_18_BI); // 600 + 1000
      expect(userStats?.lastActivityTimestamp).to.deep.equal(
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

      expect(wrapper).to.not.be.undefined;
      expect(userStats).to.not.be.undefined;
      // amount0 and amount1 are recalculated from liquidity and price, then deposited amounts are added
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // Then deposited amounts are added: current + deposited
      expect(wrapper?.amount0).to.equal(
        mockALMLPWrapperData.amount0 + 500n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 = 1500
      expect(wrapper?.amount1).to.equal(
        mockALMLPWrapperData.amount1 + 250n * TEN_TO_THE_6_BI,
      ); // 500 + 250 = 750
      // lpAmount is incremented (aggregation from events)
      expect(wrapper?.lpAmount).to.equal(
        mockALMLPWrapperData.lpAmount + 1000n * TEN_TO_THE_18_BI,
      );
      expect(userStats?.almAmount0).to.equal(500n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).to.equal(250n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).to.equal(1000n * TEN_TO_THE_18_BI);
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

      expect(wrapper).to.not.be.undefined;
      // amount0 and amount1 are recalculated from liquidity and price, then withdrawn amounts are subtracted
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // Then withdrawn amounts are subtracted: current - withdrawn
      expect(wrapper?.amount0).to.equal(
        mockALMLPWrapperData.amount0 - 250n * TEN_TO_THE_18_BI,
      ); // 1000 - 250 = 750
      expect(wrapper?.amount1).to.equal(
        mockALMLPWrapperData.amount1 - 125n * TEN_TO_THE_6_BI,
      ); // 500 - 125 = 375
      // lpAmount is decremented (aggregation from events)
      expect(wrapper?.lpAmount).to.equal(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      expect(wrapper?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
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
      expect(wrapper).to.be.undefined;
    });

    it("should create UserStatsPerPool entity if it doesn't exist", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

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

      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(userStats).to.not.be.undefined;
      expect(userStats?.id).to.equal(userStatsId);
      expect(userStats?.userAddress).to.equal(
        toChecksumAddress(recipientAddress),
      );
      expect(userStats?.poolAddress).to.equal(toChecksumAddress(poolAddress));
      expect(userStats?.chainId).to.equal(chainId);
      // V1: recipient withdraws and receives tokens, so their position decreases (negative values)
      expect(userStats?.almAmount0).to.equal(-250n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).to.equal(-125n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).to.equal(-500n * TEN_TO_THE_18_BI);
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

      expect(userStats).to.not.be.undefined;
      // ALM amounts should be decreased (subtracted from existing values)
      expect(userStats?.almAmount0).to.equal(550n * TEN_TO_THE_18_BI); // 800 - 250
      expect(userStats?.almAmount1).to.equal(275n * TEN_TO_THE_6_BI); // 400 - 125
      expect(userStats?.almLpAmount).to.equal(1100n * TEN_TO_THE_18_BI); // 1600 - 500
      expect(userStats?.lastActivityTimestamp).to.deep.equal(
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

      expect(fromUserStats).to.not.be.undefined;
      expect(toUserStats).to.not.be.undefined;

      // Sender's almLpAmount should be decreased
      expect(fromUserStats?.almLpAmount).to.equal(500n * TEN_TO_THE_18_BI); // 1000 - 500

      // Recipient's almLpAmount should be increased
      expect(toUserStats?.almLpAmount).to.equal(500n * TEN_TO_THE_18_BI);
      expect(toUserStats?.userAddress).to.equal(toChecksumAddress(toAddress));
      expect(toUserStats?.poolAddress).to.equal(toChecksumAddress(poolAddress));
      expect(toUserStats?.chainId).to.equal(chainId);
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
      expect(fromUserStats).to.be.undefined;
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

      expect(toUserStats).to.not.be.undefined;
      expect(toUserStats?.id).to.equal(toUserStatsId);
      expect(toUserStats?.userAddress).to.equal(toChecksumAddress(toAddress));
      expect(toUserStats?.poolAddress).to.equal(toChecksumAddress(poolAddress));
      expect(toUserStats?.chainId).to.equal(chainId);
      expect(toUserStats?.almLpAmount).to.equal(500n * TEN_TO_THE_18_BI);
    });

    it("should handle zero address transfers (mint/burn)", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const zeroAddress = "0x0000000000000000000000000000000000000000";
      const transferAmount = 1000n * TEN_TO_THE_18_BI;

      // Mint: from zero address
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

      expect(toUserStats).to.not.be.undefined;
      expect(toUserStats?.almLpAmount).to.equal(transferAmount);

      // Burn: to zero address
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

      expect(burnerUserStats).to.not.be.undefined;
      expect(burnerUserStats?.almLpAmount).to.equal(0n); // 1000 - 1000
    });
  });
});
