import type {
  DispatchId_event,
  OUSDTBridgedTransaction,
  OUSDTSwaps,
  ProcessId_event,
  SuperSwap,
} from "envio";
import { createTestIndexer } from "envio";
import {
  MailboxMessageId,
  OUSDTSwapsId,
  OUSDT_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";

describe("Mailbox Events", () => {
  const mailboxAddress = toChecksumAddress(
    "0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D",
  );
  const chainId = 10 as const; // Optimism
  const blockTimestamp = 1000000;
  const blockNumber = 123456;
  const blockHash =
    "0x9876543210987654321098765432109876543210987654321098765432109876";
  const messageId =
    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef";

  describe("DispatchId event", () => {
    it("should create DispatchId_event entity with correct fields", async () => {
      // Setup
      const indexer = createTestIndexer();
      const txHash =
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "DispatchId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  messageId: messageId,
                },
              },
            ],
          },
        },
      });

      // Assert - check DispatchId_event was created
      const expectedId = MailboxMessageId(txHash, chainId, messageId);
      const entity = await indexer.DispatchId_event.get(expectedId);
      expect(entity).toBeDefined();
      expect(entity?.id).toBe(expectedId);
      expect(entity?.chainId).toBe(chainId);
      expect(entity?.transactionHash).toBe(txHash);
      expect(entity?.messageId).toBe(messageId);
    });

    it("should create DispatchId_event with unique id per transaction", async () => {
      // Setup
      const indexer = createTestIndexer();
      const transactionHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const transactionHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "DispatchId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: transactionHash1,
                },
                params: {
                  messageId: messageId,
                },
              },
              {
                contract: "Mailbox",
                event: "DispatchId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber + 1,
                  hash: blockHash,
                },
                transaction: {
                  hash: transactionHash2,
                },
                params: {
                  messageId: messageId,
                },
              },
            ],
          },
        },
      });

      // Assert - check both entities were created with different IDs
      const expectedId1 = MailboxMessageId(
        transactionHash1,
        chainId,
        messageId,
      );
      const expectedId2 = MailboxMessageId(
        transactionHash2,
        chainId,
        messageId,
      );
      const entity1 = await indexer.DispatchId_event.get(expectedId1);
      const entity2 = await indexer.DispatchId_event.get(expectedId2);

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();
      expect(entity1?.id).toBe(expectedId1);
      expect(entity2?.id).toBe(expectedId2);
      expect(entity1?.id).not.toBe(entity2?.id);
    });

    it("should handle different messageIds correctly", async () => {
      // Setup
      const indexer = createTestIndexer();
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
      const sharedTxHash =
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "DispatchId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: sharedTxHash,
                },
                params: {
                  messageId: messageId1,
                },
              },
              {
                contract: "Mailbox",
                event: "DispatchId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber + 1,
                  hash: blockHash,
                },
                transaction: {
                  hash: sharedTxHash,
                },
                params: {
                  messageId: messageId2,
                },
              },
            ],
          },
        },
      });

      const expectedId1 = MailboxMessageId(sharedTxHash, chainId, messageId1);

      // Assert - check both entities were created with different messageIds
      const expectedId2 = MailboxMessageId(sharedTxHash, chainId, messageId2);
      const entity1 = await indexer.DispatchId_event.get(expectedId1);
      const entity2 = await indexer.DispatchId_event.get(expectedId2);

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();
      expect(entity1?.messageId).toBe(messageId1);
      expect(entity2?.messageId).toBe(messageId2);
    });
  });

  describe("ProcessId event", () => {
    it("should create ProcessId_event entity with correct fields", async () => {
      // Setup
      const indexer = createTestIndexer();
      const txHash =
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: txHash,
                },
                params: {
                  messageId: messageId,
                },
              },
            ],
          },
        },
      });

      // Assert - check ProcessId_event was created
      const expectedId = MailboxMessageId(txHash, chainId, messageId);
      const entity = await indexer.ProcessId_event.get(expectedId);
      expect(entity).toBeDefined();
      expect(entity?.id).toBe(expectedId);
      expect(entity?.chainId).toBe(chainId);
      expect(entity?.transactionHash).toBe(txHash);
      expect(entity?.messageId).toBe(messageId);
    });

    it("should create ProcessId_event with unique id per transaction", async () => {
      // Setup
      const indexer = createTestIndexer();
      const transactionHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const transactionHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: transactionHash1,
                },
                params: {
                  messageId: messageId,
                },
              },
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber + 1,
                  hash: blockHash,
                },
                transaction: {
                  hash: transactionHash2,
                },
                params: {
                  messageId: messageId,
                },
              },
            ],
          },
        },
      });

      const expectedId1 = MailboxMessageId(
        transactionHash1,
        chainId,
        messageId,
      );

      // Assert - check both entities were created with different IDs
      const expectedId2 = MailboxMessageId(
        transactionHash2,
        chainId,
        messageId,
      );
      const entity1 = await indexer.ProcessId_event.get(expectedId1);
      const entity2 = await indexer.ProcessId_event.get(expectedId2);

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();
      expect(entity1?.id).toBe(expectedId1);
      expect(entity2?.id).toBe(expectedId2);
      expect(entity1?.id).not.toBe(entity2?.id);
    });

    it("should handle different messageIds correctly", async () => {
      // Setup
      const indexer = createTestIndexer();
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
      const sharedTxHash =
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      // Execute
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: sharedTxHash,
                },
                params: {
                  messageId: messageId1,
                },
              },
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber + 1,
                  hash: blockHash,
                },
                transaction: {
                  hash: sharedTxHash,
                },
                params: {
                  messageId: messageId2,
                },
              },
            ],
          },
        },
      });

      const expectedId1 = MailboxMessageId(sharedTxHash, chainId, messageId1);

      // Assert - check both entities were created with different messageIds
      const expectedId2 = MailboxMessageId(sharedTxHash, chainId, messageId2);
      const entity1 = await indexer.ProcessId_event.get(expectedId1);
      const entity2 = await indexer.ProcessId_event.get(expectedId2);

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();
      expect(entity1?.messageId).toBe(messageId1);
      expect(entity2?.messageId).toBe(messageId2);
    });

    it("should handle different chainIds correctly", async () => {
      // Setup
      const chainId1 = 10 as const; // Optimism
      const chainId2 = 8453 as const; // Base
      const sharedTxHash =
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

      // processEvents does not support multiple chainIds in one call, so use separate indexers
      const indexer1 = createTestIndexer();
      await indexer1.process({
        chains: {
          [chainId1]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: sharedTxHash,
                },
                params: {
                  messageId: messageId,
                },
              },
            ],
          },
        },
      });

      const expectedId1 = MailboxMessageId(sharedTxHash, chainId1, messageId);
      const entity1 = await indexer1.ProcessId_event.get(expectedId1);

      // Seed entity1 into indexer2 so the multi-chain assertion can see both
      const indexer2 = createTestIndexer();
      if (entity1) {
        indexer2.ProcessId_event.set(entity1);
      }

      await indexer2.process({
        chains: {
          [chainId2]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber + 1,
                  hash: blockHash,
                },
                transaction: {
                  hash: sharedTxHash,
                },
                params: {
                  messageId: messageId,
                },
              },
            ],
          },
        },
      });

      // Assert - check both entities were created with different chainIds
      const expectedId2 = MailboxMessageId(sharedTxHash, chainId2, messageId);
      const entityFromIndexer1 =
        await indexer1.ProcessId_event.get(expectedId1);
      const entityFromIndexer2 =
        await indexer2.ProcessId_event.get(expectedId2);

      expect(entityFromIndexer1).toBeDefined();
      expect(entityFromIndexer2).toBeDefined();
      expect(entityFromIndexer1?.chainId).toBe(chainId1);
      expect(entityFromIndexer2?.chainId).toBe(chainId2);
    });
  });

  describe("ProcessId event - SuperSwap creation integration", () => {
    const sourceChainId = 10 as const; // Optimism
    const destinationChainId = 252 as const; // Lisk
    const sourceTransactionHash =
      "0x1234567890123456789012345678901234567890123456789012345678901234";
    const destinationTransactionHash =
      "0xdc34c918860806a2dafebad41e539cfe42f20253c0585358b91d31a11de41806";
    const testMessageId =
      "0xCCE7BDDCBF46218439FDAF78B99904EDCDF012B927E95EB053B8D01461C9DF9B";
    const tokenInAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );
    const tokenOutAddress = toChecksumAddress(
      "0x4444444444444444444444444444444444444444",
    );
    const oUSDTAmount = 18116811000000000000n; // 18.116811 oUSDT

    it("should create SuperSwap when ProcessId is processed and all required data exists", async () => {
      // Setup: Create all required entities
      const indexer = createTestIndexer();

      // 1. Create DispatchId_event (source chain)
      const dispatchIdEvent: DispatchId_event = {
        id: MailboxMessageId(
          sourceTransactionHash,
          sourceChainId,
          testMessageId,
        ),
        chainId: sourceChainId,
        transactionHash: sourceTransactionHash,
        messageId: testMessageId,
      };
      indexer.DispatchId_event.set(dispatchIdEvent);

      // 2. Create OUSDTBridgedTransaction
      const bridgedTransaction: OUSDTBridgedTransaction = {
        id: sourceTransactionHash,
        transactionHash: sourceTransactionHash,
        originChainId: BigInt(sourceChainId),
        destinationChainId: BigInt(destinationChainId),
        sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        recipient: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        amount: oUSDTAmount,
      };
      indexer.OUSDTBridgedTransaction.set(bridgedTransaction);

      // 3. Create ProcessId_event (destination chain) - this will be created by the handler
      // But we also need it for the lookup
      const processIdEvent: ProcessId_event = {
        id: MailboxMessageId(
          destinationTransactionHash,
          destinationChainId,
          testMessageId,
        ),
        chainId: destinationChainId,
        transactionHash: destinationTransactionHash,
        messageId: testMessageId,
      };
      indexer.ProcessId_event.set(processIdEvent);

      // 4. Create source chain swap (tokenIn -> oUSDT)
      const sourceSwap: OUSDTSwaps = {
        id: OUSDTSwapsId(
          sourceTransactionHash,
          sourceChainId,
          tokenInAddress,
          1000n,
          OUSDT_ADDRESS,
          oUSDTAmount,
        ),
        transactionHash: sourceTransactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: OUSDT_ADDRESS,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };
      indexer.OUSDTSwaps.set(sourceSwap);

      // 5. Create destination chain swap (oUSDT -> tokenOut)
      const destinationSwap: OUSDTSwaps = {
        id: OUSDTSwapsId(
          destinationTransactionHash,
          destinationChainId,
          OUSDT_ADDRESS,
          oUSDTAmount,
          tokenOutAddress,
          950n,
        ),
        transactionHash: destinationTransactionHash,
        tokenInPool: OUSDT_ADDRESS,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };
      indexer.OUSDTSwaps.set(destinationSwap);

      // Execute: Process ProcessId event
      await indexer.process({
        chains: {
          [destinationChainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: destinationTransactionHash,
                },
                params: {
                  messageId: testMessageId,
                },
              },
            ],
          },
        },
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = MailboxMessageId(
        destinationTransactionHash,
        destinationChainId,
        testMessageId,
      );
      const processIdEntity =
        await indexer.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).toBeDefined();
      expect(processIdEntity?.messageId).toBe(testMessageId);

      // Assert: SuperSwap was created
      const superSwapsRaw = await indexer.SuperSwap.getAll();
      const superSwaps = superSwapsRaw.map((s) =>
        rehydrateTimestamps("SuperSwap", s),
      ) as SuperSwap[];
      expect(superSwaps).toHaveLength(1);

      const superSwap = superSwaps[0];
      expect(superSwap.originChainId).toBe(BigInt(sourceChainId));
      expect(superSwap.destinationChainId).toBe(BigInt(destinationChainId));
      expect(superSwap.oUSDTamount).toBe(oUSDTAmount);
      expect(superSwap.sourceChainToken).toBe(tokenInAddress);
      expect(superSwap.destinationChainToken).toBe(tokenOutAddress);
      expect(superSwap.sourceChainTokenAmountSwapped).toBe(1000n);
      expect(superSwap.destinationChainTokenAmountSwapped).toBe(950n);
    });

    it("should create ProcessId_event but not SuperSwap when DispatchId is missing", async () => {
      // Setup: Create ProcessId event without DispatchId
      const indexer = createTestIndexer();

      await indexer.process({
        chains: {
          [destinationChainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: destinationTransactionHash,
                },
                params: {
                  messageId: testMessageId,
                },
              },
            ],
          },
        },
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = MailboxMessageId(
        destinationTransactionHash,
        destinationChainId,
        testMessageId,
      );
      const processIdEntity =
        await indexer.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).toBeDefined();

      // Assert: No SuperSwap was created (DispatchId missing)
      const superSwaps = await indexer.SuperSwap.getAll();
      expect(superSwaps).toHaveLength(0);
    });

    it("should create ProcessId_event but not SuperSwap when OUSDTBridgedTransaction is missing", async () => {
      // Setup: Create DispatchId but no bridged transaction
      const indexer = createTestIndexer();

      const dispatchIdEvent: DispatchId_event = {
        id: MailboxMessageId(
          sourceTransactionHash,
          sourceChainId,
          testMessageId,
        ),
        chainId: sourceChainId,
        transactionHash: sourceTransactionHash,
        messageId: testMessageId,
      };
      indexer.DispatchId_event.set(dispatchIdEvent);

      await indexer.process({
        chains: {
          [destinationChainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: destinationTransactionHash,
                },
                params: {
                  messageId: testMessageId,
                },
              },
            ],
          },
        },
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = MailboxMessageId(
        destinationTransactionHash,
        destinationChainId,
        testMessageId,
      );
      const processIdEntity =
        await indexer.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).toBeDefined();

      // Assert: No SuperSwap was created (bridged transaction missing)
      const superSwaps = await indexer.SuperSwap.getAll();
      expect(superSwaps).toHaveLength(0);
    });

    it("should handle ProcessId event gracefully when source chain swaps are missing", async () => {
      // Setup: Create all entities except source swap
      const indexer = createTestIndexer();

      const dispatchIdEvent: DispatchId_event = {
        id: MailboxMessageId(
          sourceTransactionHash,
          sourceChainId,
          testMessageId,
        ),
        chainId: sourceChainId,
        transactionHash: sourceTransactionHash,
        messageId: testMessageId,
      };
      indexer.DispatchId_event.set(dispatchIdEvent);

      const bridgedTransaction: OUSDTBridgedTransaction = {
        id: sourceTransactionHash,
        transactionHash: sourceTransactionHash,
        originChainId: BigInt(sourceChainId),
        destinationChainId: BigInt(destinationChainId),
        sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        recipient: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        amount: oUSDTAmount,
      };
      indexer.OUSDTBridgedTransaction.set(bridgedTransaction);

      const processIdEvent: ProcessId_event = {
        id: MailboxMessageId(
          destinationTransactionHash,
          destinationChainId,
          testMessageId,
        ),
        chainId: destinationChainId,
        transactionHash: destinationTransactionHash,
        messageId: testMessageId,
      };
      indexer.ProcessId_event.set(processIdEvent);

      // Note: No source swap created

      await indexer.process({
        chains: {
          [destinationChainId]: {
            simulate: [
              {
                contract: "Mailbox",
                event: "ProcessId",
                srcAddress: mailboxAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                transaction: {
                  hash: destinationTransactionHash,
                },
                params: {
                  messageId: testMessageId,
                },
              },
            ],
          },
        },
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = MailboxMessageId(
        destinationTransactionHash,
        destinationChainId,
        testMessageId,
      );
      const processIdEntity =
        await indexer.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).toBeDefined();

      // Assert: No SuperSwap was created (source swap missing)
      const superSwaps = await indexer.SuperSwap.getAll();
      expect(superSwaps).toHaveLength(0);
    });
  });
});
