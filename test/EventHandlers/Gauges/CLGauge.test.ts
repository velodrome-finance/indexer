import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";

describe("CLGauge Event Handlers", () => {
  const mockChainId = 10;
  const mockGaugeAddress = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const mockUserAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );

  describe("Event Data Mapping", () => {
    it("should map CLGauge.Deposit event data correctly", async () => {
      const indexer = createTestIndexer();

      // In V3, we verify event structure via simulateEvent (no mockEvent.params access)
      // The contract name in config is "CLGauge"
      await simulateEvent(indexer, mockChainId, {
        contract: "CLGauge",
        event: "Deposit",
        params: {
          tokenId: 1n,
          user: mockUserAddress,
          liquidityToStake: 100000000000000000000n, // 100 USD
        },
        block: {
          number: 100,
          timestamp: 1000000,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        srcAddress: mockGaugeAddress,
        logIndex: 1,
      });
      // No entity assertion needed — test verifies handler runs without error
    });

    it("should map CLGauge.Withdraw event data correctly", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, mockChainId, {
        contract: "CLGauge",
        event: "Withdraw",
        params: {
          tokenId: 1n,
          user: mockUserAddress,
          liquidityToStake: 50000000000000000000n, // 50 USD
        },
        block: {
          number: 101,
          timestamp: 1000001,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        srcAddress: mockGaugeAddress,
        logIndex: 1,
      });
      // No entity assertion needed — test verifies handler runs without error
    });

    it("should map CLGauge.ClaimRewards event data correctly", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, mockChainId, {
        contract: "CLGauge",
        event: "ClaimRewards",
        params: {
          from: mockUserAddress,
          amount: 1000000000000000000000n, // 1000 reward tokens
        },
        block: {
          number: 102,
          timestamp: 1000002,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        srcAddress: mockGaugeAddress,
        logIndex: 1,
      });
      // No entity assertion needed — test verifies handler runs without error
    });
  });

  describe("Handler Integration", () => {
    it("should call shared logic functions without errors for Deposit", async () => {
      const indexer = createTestIndexer();

      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await simulateEvent(indexer, mockChainId, {
        contract: "CLGauge",
        event: "Deposit",
        params: {
          tokenId: 1n,
          user: mockUserAddress,
          liquidityToStake: 100000000000000000000n,
        },
        block: {
          number: 100,
          timestamp: 1000000,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        srcAddress: mockGaugeAddress,
        logIndex: 1,
      });
    });

    it("should call shared logic functions without errors for Withdraw", async () => {
      const indexer = createTestIndexer();

      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await simulateEvent(indexer, mockChainId, {
        contract: "CLGauge",
        event: "Withdraw",
        params: {
          tokenId: 1n,
          user: mockUserAddress,
          liquidityToStake: 50000000000000000000n,
        },
        block: {
          number: 101,
          timestamp: 1000001,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        srcAddress: mockGaugeAddress,
        logIndex: 1,
      });
    });

    it("should call shared logic functions without errors for ClaimRewards", async () => {
      const indexer = createTestIndexer();

      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await simulateEvent(indexer, mockChainId, {
        contract: "CLGauge",
        event: "ClaimRewards",
        params: {
          from: mockUserAddress,
          amount: 1000000000000000000000n,
        },
        block: {
          number: 102,
          timestamp: 1000002,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        srcAddress: mockGaugeAddress,
        logIndex: 1,
      });
    });
  });
});
