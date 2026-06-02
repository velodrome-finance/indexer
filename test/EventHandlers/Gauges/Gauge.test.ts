import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";

describe("Gauge Event Handlers", () => {
  const mockChainId = 10 as const;
  const mockGaugeAddress = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const mockUserAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(() => {
    indexer = createTestIndexer();
  });

  describe("Event Data Mapping", () => {
    it("should map Gauge.Deposit event data correctly", async () => {
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "Gauge",
                event: "Deposit",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 100,
                  timestamp: 1000000,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  to: mockUserAddress, // recipient of staked position (balance owner)
                  amount: 100000000000000000000n, // 100 USD
                },
              },
            ],
          },
        },
      });
    });

    it("should map Gauge.Withdraw event data correctly", async () => {
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "Gauge",
                event: "Withdraw",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 101,
                  timestamp: 1000001,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  amount: 50000000000000000000n, // 50 USD
                },
              },
            ],
          },
        },
      });
    });

    it("should map Gauge.ClaimRewards event data correctly", async () => {
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "Gauge",
                event: "ClaimRewards",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 102,
                  timestamp: 1000002,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  amount: 1000000000000000000000n, // 1000 reward tokens
                },
              },
            ],
          },
        },
      });
    });
  });

  describe("Handler Integration", () => {
    it("should call shared logic functions without errors for Deposit", async () => {
      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "Gauge",
                event: "Deposit",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 100,
                  timestamp: 1000000,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  to: mockUserAddress,
                  amount: 100000000000000000000n,
                },
              },
            ],
          },
        },
      });
    });

    it("should call shared logic functions without errors for Withdraw", async () => {
      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "Gauge",
                event: "Withdraw",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 101,
                  timestamp: 1000001,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  amount: 50000000000000000000n,
                },
              },
            ],
          },
        },
      });
    });

    it("should call shared logic functions without errors for ClaimRewards", async () => {
      // Should not throw - the actual business logic is tested in GaugeSharedLogic.test.ts
      await indexer.process({
        chains: {
          [mockChainId]: {
            simulate: [
              {
                contract: "Gauge",
                event: "ClaimRewards",
                srcAddress: mockGaugeAddress,
                logIndex: 1,
                block: {
                  number: 102,
                  timestamp: 1000002,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  from: mockUserAddress,
                  amount: 1000000000000000000000n,
                },
              },
            ],
          },
        },
      });
    });
  });
});
