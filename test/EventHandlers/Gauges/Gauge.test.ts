import { expect } from "chai";
import { Gauge } from "../../../generated/src/TestHelpers.gen";
import { MockDb } from "../../../generated/src/TestHelpers.gen";

describe("Gauge Event Handlers", () => {
  const mockChainId = 10;
  const mockGaugeAddress = "0x5555555555555555555555555555555555555555";
  const mockUserAddress = "0x2222222222222222222222222222222222222222";

  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  describe("Event Data Mapping", () => {
    it("should map Gauge.Deposit event data correctly", async () => {
      const mockEvent = Gauge.Deposit.createMockEvent({
        from: mockUserAddress,
        amount: 100000000000000000000n, // 100 USD
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
      expect(mockEvent.params.from).to.equal(mockUserAddress);
      expect(mockEvent.params.amount).to.equal(100000000000000000000n);
      expect(mockEvent.srcAddress).to.equal(mockGaugeAddress);
      expect(mockEvent.chainId).to.equal(mockChainId);
      expect(mockEvent.block.number).to.equal(100);
      expect(mockEvent.block.timestamp).to.equal(1000000);
    });

    it("should map Gauge.Withdraw event data correctly", async () => {
      const mockEvent = Gauge.Withdraw.createMockEvent({
        from: mockUserAddress,
        amount: 50000000000000000000n, // 50 USD
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
      expect(mockEvent.params.from).to.equal(mockUserAddress);
      expect(mockEvent.params.amount).to.equal(50000000000000000000n);
      expect(mockEvent.srcAddress).to.equal(mockGaugeAddress);
      expect(mockEvent.chainId).to.equal(mockChainId);
      expect(mockEvent.block.number).to.equal(101);
      expect(mockEvent.block.timestamp).to.equal(1000001);
    });

    it("should map Gauge.ClaimRewards event data correctly", async () => {
      const mockEvent = Gauge.ClaimRewards.createMockEvent({
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
      expect(mockEvent.params.from).to.equal(mockUserAddress);
      expect(mockEvent.params.amount).to.equal(1000000000000000000000n);
      expect(mockEvent.srcAddress).to.equal(mockGaugeAddress);
      expect(mockEvent.chainId).to.equal(mockChainId);
      expect(mockEvent.block.number).to.equal(102);
      expect(mockEvent.block.timestamp).to.equal(1000002);
    });
  });

  describe("Handler Integration", () => {
    it("should call shared logic functions without errors for Deposit", async () => {
      const mockEvent = Gauge.Deposit.createMockEvent({
        from: mockUserAddress,
        amount: 100000000000000000000n,
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
      await Gauge.Deposit.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should call shared logic functions without errors for Withdraw", async () => {
      const mockEvent = Gauge.Withdraw.createMockEvent({
        from: mockUserAddress,
        amount: 50000000000000000000n,
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
      await Gauge.Withdraw.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should call shared logic functions without errors for ClaimRewards", async () => {
      const mockEvent = Gauge.ClaimRewards.createMockEvent({
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
      await Gauge.ClaimRewards.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });
  });
});
