import { expect } from "chai";
import {
  MockDb,
  VelodromeUniversalRouter,
} from "../../../generated/src/TestHelpers.gen";
import type {
  SuperSwap,
  oUSDTBridgedTransaction,
} from "../../../generated/src/Types.gen";
import { OUSDT_ADDRESS } from "../../../src/Constants";

describe("VelodromeUniversalRouter Event Handlers", () => {
  const chainId = 10; // Optimism
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const senderAddress = "0x1111111111111111111111111111111111111111";
  const recipientAddress = "0x2222222222222222222222222222222222222222";
  const destinationDomain = 8453; // Base chain ID
  const tokenAmount = 1000n * 10n ** 6n; // 1000 tokens with 6 decimals
  const blockTimestamp = 1000000;

  describe("UniversalRouterBridge event", () => {
    it("should create oUSDTBridgedTransaction entity when token is oUSDT", async () => {
      const mockDb = MockDb.createMockDb();

      const mockEvent =
        VelodromeUniversalRouter.UniversalRouterBridge.createMockEvent({
          token: OUSDT_ADDRESS,
          domain: BigInt(destinationDomain),
          sender: senderAddress,
          recipient: recipientAddress,
          amount: tokenAmount,
          mockEventData: {
            block: {
              timestamp: blockTimestamp,
              number: 123456,
              hash: transactionHash,
            },
            chainId,
            logIndex: 1,
            transaction: {
              hash: transactionHash,
            },
          },
        });

      const result =
        await VelodromeUniversalRouter.UniversalRouterBridge.processEvent({
          event: mockEvent,
          mockDb,
        });

      const bridgedTransaction =
        result.entities.oUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).to.not.be.undefined;
      expect(bridgedTransaction?.id).to.equal(transactionHash);
      expect(bridgedTransaction?.transaction_hash).to.equal(transactionHash);
      expect(bridgedTransaction?.originChainId).to.equal(chainId);
      expect(bridgedTransaction?.destinationChainId).to.equal(
        destinationDomain,
      );
      expect(bridgedTransaction?.sender).to.equal(senderAddress.toLowerCase());
      expect(bridgedTransaction?.recipient).to.equal(
        recipientAddress.toLowerCase(),
      );
      expect(bridgedTransaction?.amount).to.equal(1000); // Normalized: 1000 * 10^6 / 10^6 = 1000
    });

    it("should not create entity when token is not oUSDT", async () => {
      const mockDb = MockDb.createMockDb();
      const otherTokenAddress = "0x9999999999999999999999999999999999999999";

      const mockEvent =
        VelodromeUniversalRouter.UniversalRouterBridge.createMockEvent({
          token: otherTokenAddress,
          domain: BigInt(destinationDomain),
          sender: senderAddress,
          recipient: recipientAddress,
          amount: tokenAmount,
          mockEventData: {
            block: {
              timestamp: blockTimestamp,
              number: 123456,
              hash: transactionHash,
            },
            chainId,
            logIndex: 1,
            transaction: {
              hash: transactionHash,
            },
          },
        });

      const result =
        await VelodromeUniversalRouter.UniversalRouterBridge.processEvent({
          event: mockEvent,
          mockDb,
        });

      const bridgedTransaction =
        result.entities.oUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).to.be.undefined;
    });

    it("should normalize amount correctly using OUSDT_DECIMALS constant", async () => {
      const mockDb = MockDb.createMockDb();
      const testAmount = 500n * 10n ** 6n; // 500 tokens with 6 decimals

      const mockEvent =
        VelodromeUniversalRouter.UniversalRouterBridge.createMockEvent({
          token: OUSDT_ADDRESS,
          domain: BigInt(destinationDomain),
          sender: senderAddress,
          recipient: recipientAddress,
          amount: testAmount,
          mockEventData: {
            block: {
              timestamp: blockTimestamp,
              number: 123456,
              hash: transactionHash,
            },
            chainId,
            logIndex: 1,
            transaction: {
              hash: transactionHash,
            },
          },
        });

      const result =
        await VelodromeUniversalRouter.UniversalRouterBridge.processEvent({
          event: mockEvent,
          mockDb,
        });

      const bridgedTransaction =
        result.entities.oUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).to.not.be.undefined;
      expect(bridgedTransaction?.amount).to.equal(500); // Normalized: 500 * 10^6 / 10^6 = 500
    });
  });

  describe("CrossChainSwap event", () => {
    it("should create SuperSwap entity when oUSDTBridgedTransaction exists", async () => {
      let mockDb = MockDb.createMockDb();

      // First, create a bridged transaction entity
      const existingBridgedTransaction: oUSDTBridgedTransaction = {
        id: transactionHash,
        transaction_hash: transactionHash,
        originChainId: chainId,
        destinationChainId: destinationDomain,
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 1000,
      };

      mockDb = mockDb.entities.oUSDTBridgedTransaction.set(
        existingBridgedTransaction,
      );

      // Track entities for getWhere query
      const storedEntities = [existingBridgedTransaction];

      // Extend mockDb to include getWhere for oUSDTBridgedTransaction
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          oUSDTBridgedTransaction: {
            ...mockDb.entities.oUSDTBridgedTransaction,
            getWhere: {
              transaction_hash: {
                eq: async (txHash: string) => {
                  // Find all entities with matching transaction_hash
                  return storedEntities.filter(
                    (entity) => entity.transaction_hash === txHash,
                  );
                },
              },
            },
          },
        },
      };

      const mockEvent = VelodromeUniversalRouter.CrossChainSwap.createMockEvent(
        {
          mockEventData: {
            block: {
              timestamp: blockTimestamp,
              number: 123457,
              hash: transactionHash,
            },
            chainId,
            logIndex: 2,
            transaction: {
              hash: transactionHash,
            },
          },
        },
      );

      const result = await VelodromeUniversalRouter.CrossChainSwap.processEvent(
        {
          event: mockEvent,
          mockDb: mockDbWithGetWhere as typeof mockDb,
        },
      );

      const superSwap = result.entities.SuperSwap.get(transactionHash);

      expect(superSwap).to.not.be.undefined;
      expect(superSwap?.id).to.equal(transactionHash);
      expect(superSwap?.originChainId).to.equal(chainId);
      expect(superSwap?.destinationChainId).to.equal(destinationDomain);
      expect(superSwap?.sender).to.equal(senderAddress.toLowerCase());
      expect(superSwap?.recipient).to.equal(recipientAddress.toLowerCase());
      expect(superSwap?.amount).to.equal(1000);
      expect(superSwap?.timestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should not create SuperSwap when no oUSDTBridgedTransaction exists", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning empty array)
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          oUSDTBridgedTransaction: {
            ...mockDb.entities.oUSDTBridgedTransaction,
            getWhere: {
              transaction_hash: {
                eq: async (_txHash: string) => {
                  return []; // No entities found
                },
              },
            },
          },
        },
      };

      const mockEvent = VelodromeUniversalRouter.CrossChainSwap.createMockEvent(
        {
          mockEventData: {
            block: {
              timestamp: blockTimestamp,
              number: 123457,
              hash: transactionHash,
            },
            chainId,
            logIndex: 2,
            transaction: {
              hash: transactionHash,
            },
          },
        },
      );

      const result = await VelodromeUniversalRouter.CrossChainSwap.processEvent(
        {
          event: mockEvent,
          mockDb: mockDbWithGetWhere as typeof mockDb,
        },
      );

      const superSwap = result.entities.SuperSwap.get(transactionHash);

      // Verify that no SuperSwap was created when no bridged transaction exists
      expect(superSwap).to.be.undefined;
    });

    it("should use the first bridged transaction when multiple exist", async () => {
      let mockDb = MockDb.createMockDb();
      const anotherHash =
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef";

      // Create multiple bridged transactions with the same transaction hash
      // (This shouldn't happen in practice, but we test the code handles it)
      const bridgedTransaction1: oUSDTBridgedTransaction = {
        id: transactionHash,
        transaction_hash: transactionHash,
        originChainId: chainId,
        destinationChainId: destinationDomain,
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 1000,
      };

      const bridgedTransaction2: oUSDTBridgedTransaction = {
        id: anotherHash,
        transaction_hash: transactionHash, // Same transaction hash
        originChainId: chainId,
        destinationChainId: destinationDomain,
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 2000,
      };

      mockDb = mockDb.entities.oUSDTBridgedTransaction.set(bridgedTransaction1);
      mockDb = mockDb.entities.oUSDTBridgedTransaction.set(bridgedTransaction2);

      // Track entities for getWhere query
      const storedEntities = [bridgedTransaction1, bridgedTransaction2];

      // Extend mockDb to include getWhere for oUSDTBridgedTransaction
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          oUSDTBridgedTransaction: {
            ...mockDb.entities.oUSDTBridgedTransaction,
            getWhere: {
              transaction_hash: {
                eq: async (txHash: string) => {
                  // Find all entities with matching transaction_hash
                  return storedEntities.filter(
                    (entity) => entity.transaction_hash === txHash,
                  );
                },
              },
            },
          },
        },
      };

      const mockEvent = VelodromeUniversalRouter.CrossChainSwap.createMockEvent(
        {
          mockEventData: {
            block: {
              timestamp: blockTimestamp,
              number: 123457,
              hash: transactionHash,
            },
            chainId,
            logIndex: 2,
            transaction: {
              hash: transactionHash,
            },
          },
        },
      );

      const result = await VelodromeUniversalRouter.CrossChainSwap.processEvent(
        {
          event: mockEvent,
          mockDb: mockDbWithGetWhere as typeof mockDb,
        },
      );

      const superSwap = result.entities.SuperSwap.get(transactionHash);

      expect(superSwap).to.not.be.undefined;
      // Should use the first transaction (amount 1000)
      expect(superSwap?.amount).to.equal(1000);
    });
  });
});
