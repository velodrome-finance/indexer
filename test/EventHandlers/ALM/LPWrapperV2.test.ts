import { expect } from "chai";
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
      expect(wrapper).to.be.undefined;
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

      expect(userStats).to.not.be.undefined;
      // ALM amounts should be cumulative (subtracted from existing values)
      expect(userStats?.almAmount0).to.equal(750n * TEN_TO_THE_18_BI); // 1000 - 250
      expect(userStats?.almAmount1).to.equal(375n * TEN_TO_THE_6_BI); // 500 - 125
      expect(userStats?.almLpAmount).to.equal(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      expect(userStats?.lastActivityTimestamp).to.deep.equal(
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
      expect(wrapper).to.not.be.undefined;
      expect(wrapper?.amount0).to.equal(mockALMLPWrapperData.amount0);
      expect(wrapper?.amount1).to.equal(mockALMLPWrapperData.amount1);
      expect(wrapper?.lpAmount).to.equal(mockALMLPWrapperData.lpAmount);

      // Verify sender's almLpAmount decreased
      const userStatsFrom =
        result.entities.UserStatsPerPool.get(userStatsFromId);
      expect(userStatsFrom).to.not.be.undefined;
      expect(userStatsFrom?.almLpAmount).to.equal(4000n * TEN_TO_THE_18_BI); // 5000 - 1000

      // Verify recipient's almLpAmount increased
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).to.not.be.undefined;
      expect(userStatsTo?.almLpAmount).to.equal(3000n * TEN_TO_THE_18_BI); // 2000 + 1000
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
      expect(userStatsFrom?.almLpAmount).to.equal(2500n * TEN_TO_THE_18_BI); // 3000 - 500

      // Verify recipient's almLpAmount was created and set to transfer amount
      const userStatsToId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsTo).to.not.be.undefined;
      expect(userStatsTo?.almLpAmount).to.equal(500n * TEN_TO_THE_18_BI); // 0 + 500
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
      expect(wrapper).to.be.undefined;

      // Verify that no user stats were created or updated
      const userStatsFromId = `${toChecksumAddress(senderAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStatsToId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStatsFrom =
        result.entities.UserStatsPerPool.get(userStatsFromId);
      const userStatsTo = result.entities.UserStatsPerPool.get(userStatsToId);
      expect(userStatsFrom).to.be.undefined;
      expect(userStatsTo).to.be.undefined;
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

      expect(wrapper).to.not.be.undefined;
      // Zero amounts should add zero (no change to recalculated amounts)
      // Recalculation falls back to current, then adds 0
      expect(wrapper?.amount0).to.equal(mockALMLPWrapperData.amount0 + 0n);
      expect(wrapper?.amount1).to.equal(mockALMLPWrapperData.amount1 + 0n);
      expect(wrapper?.lpAmount).to.equal(mockALMLPWrapperData.lpAmount);
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

      expect(wrapper).to.not.be.undefined;
      // amount0 and amount1 are recalculated from liquidity and price, then deposited amounts are added
      // In test environment without mocked effects, recalculation fails and falls back to current wrapper values
      // After first deposit: current + first deposit amounts
      // After second deposit: (current + first deposit) + second deposit amounts
      // Since recalculation always falls back to initial current, we get: current + first + second
      expect(wrapper?.amount0).to.equal(
        mockALMLPWrapperData.amount0 +
          500n * TEN_TO_THE_18_BI +
          1000n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 + 1000 = 2500
      expect(wrapper?.amount1).to.equal(
        mockALMLPWrapperData.amount1 +
          250n * TEN_TO_THE_6_BI +
          500n * TEN_TO_THE_6_BI,
      ); // 500 + 250 + 500 = 1250
      // lpAmount aggregates both deposits (incremented)
      expect(wrapper?.lpAmount).to.equal(
        mockALMLPWrapperData.lpAmount +
          1000n * TEN_TO_THE_18_BI +
          2000n * TEN_TO_THE_18_BI,
      ); // 2000 + 1000 + 2000 = 5000

      // Both users should have their individual stats
      const userStats1Id = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      const userStats2Id = `${toChecksumAddress(recipient2)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      const userStats1 = result.entities.UserStatsPerPool.get(userStats1Id);
      const userStats2 = result.entities.UserStatsPerPool.get(userStats2Id);

      expect(userStats1).to.not.be.undefined;
      expect(userStats1?.almAmount0).to.equal(500n * TEN_TO_THE_18_BI);
      expect(userStats2).to.not.be.undefined;
      expect(userStats2?.almAmount0).to.equal(1000n * TEN_TO_THE_18_BI);
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

      expect(wrapper).to.not.be.undefined;
      // Initial + deposit - withdrawal
      // Since recalculation falls back to initial, we get: initial + deposit - withdrawal
      expect(wrapper?.amount0).to.equal(
        initialAmount0 + 500n * TEN_TO_THE_18_BI - 250n * TEN_TO_THE_18_BI,
      ); // 1000 + 500 - 250 = 1250
      expect(wrapper?.amount1).to.equal(
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

      expect(createdEvent).to.not.be.undefined;
      expect(createdEvent?.id).to.equal(eventId);
      expect(createdEvent?.lpWrapperAddress).to.equal(
        toChecksumAddress(lpWrapperAddress),
      );
      expect(createdEvent?.currentTotalSupplyLPTokens).to.equal(
        7500n * TEN_TO_THE_18_BI,
      );
      // Handler uses event.transaction.hash
      expect(createdEvent?.transactionHash).to.equal(
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

      expect(updatedEvent).to.not.be.undefined;
      expect(updatedEvent?.currentTotalSupplyLPTokens).to.equal(
        8000n * TEN_TO_THE_18_BI,
      );
      expect(updatedEvent?.transactionHash).to.equal(newTransactionHash);
    });
  });
});
