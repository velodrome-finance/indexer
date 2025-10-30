import { expect } from "chai";
import { ALMLPWrapper, MockDb } from "../../../generated/src/TestHelpers.gen";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  toChecksumAddress,
} from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("ALMLPWrapper Events", () => {
  const {
    mockALMLPWrapperData,
    mockLiquidityPoolData,
    mockUserStatsPerPoolData,
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
    srcAddress: lpWrapperAddress,
  };

  describe("Deposit Event", () => {
    it("should create ALM_LP_Wrapper entity if it doesn't exist", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).to.not.be.undefined;
      expect(wrapper?.id).to.equal(wrapperId);
      expect(wrapper?.chainId).to.equal(chainId);
      expect(wrapper?.pool).to.equal(toChecksumAddress(poolAddress));
      expect(wrapper?.amount0).to.equal(500n * TEN_TO_THE_18_BI);
      expect(wrapper?.amount1).to.equal(250n * TEN_TO_THE_6_BI);
      expect(wrapper?.lpAmount).to.equal(1000n * TEN_TO_THE_18_BI);
      expect(wrapper?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
    });

    it("should update existing ALM_LP_Wrapper entity with increased amounts", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).to.not.be.undefined;
      expect(wrapper?.amount0).to.equal(1250n * TEN_TO_THE_18_BI); // 1000 + 250
      expect(wrapper?.amount1).to.equal(625n * TEN_TO_THE_6_BI); // 500 + 125
      expect(wrapper?.lpAmount).to.equal(2500n * TEN_TO_THE_18_BI); // 2000 + 500
      expect(wrapper?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
    });

    it("should create UserStatsPerPool entity if it doesn't exist", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Deposit.processEvent({
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

      // Pre-populate with existing user stats
      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set({
        ...mockUserStatsPerPoolData,
        id: userStatsId,
        userAddress: toChecksumAddress(recipientAddress),
        poolAddress: toChecksumAddress(poolAddress),
        almAmount0: 300n * TEN_TO_THE_18_BI,
        almAmount1: 150n * TEN_TO_THE_6_BI,
        almLpAmount: 600n * TEN_TO_THE_18_BI,
      });

      const mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Deposit.processEvent({
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
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);
      const userStats = result.entities.UserStatsPerPool.get(userStatsId);

      expect(wrapper).to.not.be.undefined;
      expect(userStats).to.not.be.undefined;
      expect(wrapper?.amount0).to.equal(500n * TEN_TO_THE_18_BI);
      expect(wrapper?.amount1).to.equal(250n * TEN_TO_THE_6_BI);
      expect(wrapper?.lpAmount).to.equal(1000n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount0).to.equal(500n * TEN_TO_THE_18_BI);
      expect(userStats?.almAmount1).to.equal(250n * TEN_TO_THE_6_BI);
      expect(userStats?.almLpAmount).to.equal(1000n * TEN_TO_THE_18_BI);
    });
  });

  describe("Withdraw Event", () => {
    it("should create ALM_LP_Wrapper entity if it doesn't exist and decrease amounts", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapper.Withdraw.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).to.not.be.undefined;
      // Withdraw should subtract amounts (start at 0, subtract = negative)
      expect(wrapper?.amount0).to.equal(-250n * TEN_TO_THE_18_BI);
      expect(wrapper?.amount1).to.equal(-125n * TEN_TO_THE_6_BI);
      expect(wrapper?.lpAmount).to.equal(-500n * TEN_TO_THE_18_BI);
    });

    it("should decrease amounts in existing ALM_LP_Wrapper entity", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing wrapper
      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      mockDb = mockDb.entities.ALM_LP_Wrapper.set({
        ...mockALMLPWrapperData,
        id: wrapperId,
      });

      const mockEvent = ALMLPWrapper.Withdraw.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Withdraw.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).to.not.be.undefined;
      expect(wrapper?.amount0).to.equal(750n * TEN_TO_THE_18_BI); // 1000 - 250
      expect(wrapper?.amount1).to.equal(375n * TEN_TO_THE_6_BI); // 500 - 125
      expect(wrapper?.lpAmount).to.equal(1500n * TEN_TO_THE_18_BI); // 2000 - 500
      expect(wrapper?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
    });

    it("should update UserStatsPerPool entity for recipient with decreased amounts", async () => {
      let mockDb = MockDb.createMockDb();

      // Pre-populate with existing user stats
      const userStatsId = `${toChecksumAddress(recipientAddress)}_${toChecksumAddress(poolAddress)}_${chainId}`;
      mockDb = mockDb.entities.UserStatsPerPool.set({
        ...mockUserStatsPerPoolData,
        id: userStatsId,
        userAddress: toChecksumAddress(recipientAddress),
        poolAddress: toChecksumAddress(poolAddress),
        almAmount0: 1000n * TEN_TO_THE_18_BI,
        almAmount1: 500n * TEN_TO_THE_6_BI,
        almLpAmount: 2000n * TEN_TO_THE_18_BI,
      });

      const mockEvent = ALMLPWrapper.Withdraw.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 500n * TEN_TO_THE_18_BI,
        amount0: 250n * TEN_TO_THE_18_BI,
        amount1: 125n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      const result = await ALMLPWrapper.Withdraw.processEvent({
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

      mockDb = mockDb.entities.UserStatsPerPool.set({
        ...mockUserStatsPerPoolData,
        id: userStatsFromId,
        userAddress: toChecksumAddress(senderAddress),
        poolAddress: toChecksumAddress(poolAddress),
        almLpAmount: 5000n * TEN_TO_THE_18_BI, // Sender has 5000 tokens
      });

      mockDb = mockDb.entities.UserStatsPerPool.set({
        ...mockUserStatsPerPoolData,
        id: userStatsToId,
        userAddress: toChecksumAddress(recipientAddress),
        poolAddress: toChecksumAddress(poolAddress),
        almLpAmount: 2000n * TEN_TO_THE_18_BI, // Recipient has 2000 tokens
      });

      const transferAmount = 1000n * TEN_TO_THE_18_BI;
      const mockEvent = ALMLPWrapper.Transfer.createMockEvent({
        from: senderAddress,
        to: recipientAddress,
        value: transferAmount,
        mockEventData,
      });

      const result = await ALMLPWrapper.Transfer.processEvent({
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
      mockDb = mockDb.entities.UserStatsPerPool.set({
        ...mockUserStatsPerPoolData,
        id: userStatsFromId,
        userAddress: toChecksumAddress(senderAddress),
        poolAddress: toChecksumAddress(poolAddress),
        almLpAmount: 3000n * TEN_TO_THE_18_BI,
      });

      const transferAmount = 500n * TEN_TO_THE_18_BI;
      const mockEvent = ALMLPWrapper.Transfer.createMockEvent({
        from: senderAddress,
        to: recipientAddress,
        value: transferAmount,
        mockEventData,
      });

      const result = await ALMLPWrapper.Transfer.processEvent({
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
  });

  describe("Edge Cases", () => {
    it("should handle zero amounts in Deposit", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 0n,
        amount0: 0n,
        amount1: 0n,
        mockEventData,
      });

      const result = await ALMLPWrapper.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).to.not.be.undefined;
      expect(wrapper?.amount0).to.equal(0n);
      expect(wrapper?.amount1).to.equal(0n);
      expect(wrapper?.lpAmount).to.equal(0n);
    });

    it("should handle multiple deposits from different users", async () => {
      const mockDb = MockDb.createMockDb();
      const recipient2 = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

      // First deposit
      let mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
        recipient: recipientAddress,
        pool: poolAddress,
        lpAmount: 1000n * TEN_TO_THE_18_BI,
        amount0: 500n * TEN_TO_THE_18_BI,
        amount1: 250n * TEN_TO_THE_6_BI,
        mockEventData,
      });

      let result = await ALMLPWrapper.Deposit.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Second deposit from different user
      mockEvent = ALMLPWrapper.Deposit.createMockEvent({
        sender: senderAddress,
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

      result = await ALMLPWrapper.Deposit.processEvent({
        event: mockEvent,
        mockDb: result,
      });

      const wrapperId = `${toChecksumAddress(lpWrapperAddress)}_${chainId}`;
      const wrapper = result.entities.ALM_LP_Wrapper.get(wrapperId);

      expect(wrapper).to.not.be.undefined;
      // Should aggregate both deposits
      expect(wrapper?.amount0).to.equal(1500n * TEN_TO_THE_18_BI); // 500 + 1000
      expect(wrapper?.amount1).to.equal(750n * TEN_TO_THE_6_BI); // 250 + 500
      expect(wrapper?.lpAmount).to.equal(3000n * TEN_TO_THE_18_BI); // 1000 + 2000

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
  });
});
