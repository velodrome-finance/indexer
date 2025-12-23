import { CLGauge } from "../../../generated/src/TestHelpers.gen";
import { MockDb } from "../../../generated/src/TestHelpers.gen";

describe("CLGauge Event Handlers", () => {
  const mockChainId = 10;
  const mockGaugeAddress = "0x5555555555555555555555555555555555555555";
  const mockUserAddress = "0x2222222222222222222222222222222222222222";

  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  describe("Event Data Mapping", () => {
    it("should map CLGauge.Deposit event data correctly", async () => {
      const mockEvent = CLGauge.Deposit.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 100000000000000000000n, // 100 USD
        mockEventData: {
          srcAddress: mockGaugeAddress,
          chainId: mockChainId,
          block: {
            number: 100,
            timestamp: 1000000,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
        },
      });

      // Test that the event data is correctly structured
      expect(mockEvent.params.user).toBe(mockUserAddress);
      expect(mockEvent.params.liquidityToStake).toBe(100000000000000000000n);
      expect(mockEvent.params.tokenId).toBe(1n);
      expect(mockEvent.srcAddress).toBe(mockGaugeAddress);
      expect(mockEvent.chainId).toBe(mockChainId);
      expect(mockEvent.block.number).toBe(100);
      expect(mockEvent.block.timestamp).toBe(1000000);
    });

    it("should map CLGauge.Withdraw event data correctly", async () => {
      const mockEvent = CLGauge.Withdraw.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 50000000000000000000n, // 50 USD
        mockEventData: {
          srcAddress: mockGaugeAddress,
          chainId: mockChainId,
          block: {
            number: 101,
            timestamp: 1000001,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
        },
      });

      // Test that the event data is correctly structured
      expect(mockEvent.params.user).toBe(mockUserAddress);
      expect(mockEvent.params.liquidityToStake).toBe(50000000000000000000n);
      expect(mockEvent.params.tokenId).toBe(1n);
      expect(mockEvent.srcAddress).toBe(mockGaugeAddress);
      expect(mockEvent.chainId).toBe(mockChainId);
      expect(mockEvent.block.number).toBe(101);
      expect(mockEvent.block.timestamp).toBe(1000001);
    });

    it("should map CLGauge.ClaimRewards event data correctly", async () => {
      const mockEvent = CLGauge.ClaimRewards.createMockEvent({
        from: mockUserAddress,
        amount: 1000000000000000000000n, // 1000 reward tokens
        mockEventData: {
          srcAddress: mockGaugeAddress,
          chainId: mockChainId,
          block: {
            number: 102,
            timestamp: 1000002,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
        },
      });

      // Test that the event data is correctly structured
      expect(mockEvent.params.from).toBe(mockUserAddress);
      expect(mockEvent.params.amount).toBe(1000000000000000000000n);
      expect(mockEvent.srcAddress).toBe(mockGaugeAddress);
      expect(mockEvent.chainId).toBe(mockChainId);
      expect(mockEvent.block.number).toBe(102);
      expect(mockEvent.block.timestamp).toBe(1000002);
    });
  });

  describe("Handler Integration", () => {
    it("should call shared logic functions without errors for Deposit", async () => {
      const mockEvent = CLGauge.Deposit.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 100000000000000000000n,
        mockEventData: {
          srcAddress: mockGaugeAddress,
          chainId: mockChainId,
          block: {
            number: 100,
            timestamp: 1000000,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
        },
      });

      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await CLGauge.Deposit.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should call shared logic functions without errors for Withdraw", async () => {
      const mockEvent = CLGauge.Withdraw.createMockEvent({
        tokenId: 1n,
        user: mockUserAddress,
        liquidityToStake: 50000000000000000000n,
        mockEventData: {
          srcAddress: mockGaugeAddress,
          chainId: mockChainId,
          block: {
            number: 101,
            timestamp: 1000001,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
        },
      });

      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await CLGauge.Withdraw.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should call shared logic functions without errors for ClaimRewards", async () => {
      const mockEvent = CLGauge.ClaimRewards.createMockEvent({
        from: mockUserAddress,
        amount: 1000000000000000000000n,
        mockEventData: {
          srcAddress: mockGaugeAddress,
          chainId: mockChainId,
          block: {
            number: 102,
            timestamp: 1000002,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
        },
      });

      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await CLGauge.ClaimRewards.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });
  });
});
