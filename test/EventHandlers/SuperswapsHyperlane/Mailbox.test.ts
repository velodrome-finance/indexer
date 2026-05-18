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
import { simulateEvent } from "../../testHelpers";

describe("Mailbox Events", () => {
  const mailboxAddress = toChecksumAddress(
    "0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D",
  );
  const chainId = 10; // Optimism
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
        "0x0000000000000000000000000000000000000000000000000000000000000001";

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "DispatchId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: txHash,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
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

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "DispatchId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: transactionHash1,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "DispatchId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber + 1,
          hash: blockHash,
        },
        transaction: {
          hash: transactionHash2,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
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
      const txHash1 =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      const txHash2 =
        "0x0000000000000000000000000000000000000000000000000000000000000002";
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "DispatchId",
        params: {
          messageId: messageId1,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: txHash1,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "DispatchId",
        params: {
          messageId: messageId2,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber + 1,
          hash: blockHash,
        },
        transaction: {
          hash: txHash2,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      const expectedId1 = MailboxMessageId(txHash1, chainId, messageId1);
      const expectedId2 = MailboxMessageId(txHash2, chainId, messageId2);

      // Assert - check both entities were created with different messageIds
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
        "0x0000000000000000000000000000000000000000000000000000000000000001";

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: txHash,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
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

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: transactionHash1,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber + 1,
          hash: blockHash,
        },
        transaction: {
          hash: transactionHash2,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

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
      const txHash1 =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      const txHash2 =
        "0x0000000000000000000000000000000000000000000000000000000000000002";
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: messageId1,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: txHash1,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      await simulateEvent(indexer, chainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: messageId2,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber + 1,
          hash: blockHash,
        },
        transaction: {
          hash: txHash2,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      const expectedId1 = MailboxMessageId(txHash1, chainId, messageId1);
      const expectedId2 = MailboxMessageId(txHash2, chainId, messageId2);

      // Assert - check both entities were created with different messageIds
      const entity1 = await indexer.ProcessId_event.get(expectedId1);
      const entity2 = await indexer.ProcessId_event.get(expectedId2);

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();
      expect(entity1?.messageId).toBe(messageId1);
      expect(entity2?.messageId).toBe(messageId2);
    });

    it("should handle different chainIds correctly", async () => {
      // Setup
      const indexer = createTestIndexer();
      const chainId1 = 10; // Optimism
      const chainId2 = 8453; // Base
      const txHash1 =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      const txHash2 =
        "0x0000000000000000000000000000000000000000000000000000000000000002";

      await simulateEvent(indexer, chainId1, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: txHash1,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      await simulateEvent(indexer, chainId2, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: messageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber + 1,
          hash: blockHash,
        },
        transaction: {
          hash: txHash2,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
      });

      // Assert - check both entities were created with different chainIds
      const expectedId1 = MailboxMessageId(txHash1, chainId1, messageId);
      const expectedId2 = MailboxMessageId(txHash2, chainId2, messageId);
      const entity1 = await indexer.ProcessId_event.get(expectedId1);
      const entity2 = await indexer.ProcessId_event.get(expectedId2);

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();
      expect(entity1?.chainId).toBe(chainId1);
      expect(entity2?.chainId).toBe(chainId2);
    });
  });

  describe("ProcessId event - SuperSwap creation integration", () => {
    const sourceChainId = 10; // Optimism
    const destinationChainId = 252; // Lisk
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
      await simulateEvent(indexer, destinationChainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: testMessageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: destinationTransactionHash,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
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
      const superSwap = Array.from(
        await indexer.SuperSwap.getAll(),
      ) as SuperSwap[];
      expect(superSwap).toHaveLength(1);

      const swap = superSwap[0];
      expect(swap.originChainId).toBe(BigInt(sourceChainId));
      expect(swap.destinationChainId).toBe(BigInt(destinationChainId));
      expect(swap.oUSDTamount).toBe(oUSDTAmount);
      expect(swap.sourceChainToken).toBe(tokenInAddress);
      expect(swap.destinationChainToken).toBe(tokenOutAddress);
      expect(swap.sourceChainTokenAmountSwapped).toBe(1000n);
      expect(swap.destinationChainTokenAmountSwapped).toBe(950n);
    });

    it("should create ProcessId_event but not SuperSwap when DispatchId is missing", async () => {
      // Setup: Create ProcessId event without DispatchId
      const indexer = createTestIndexer();

      await simulateEvent(indexer, destinationChainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: testMessageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: destinationTransactionHash,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
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
      const superSwaps = Array.from(await indexer.SuperSwap.getAll());
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

      await simulateEvent(indexer, destinationChainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: testMessageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: destinationTransactionHash,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
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
      const superSwaps = Array.from(await indexer.SuperSwap.getAll());
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

      await simulateEvent(indexer, destinationChainId, {
        contract: "Mailbox",
        event: "ProcessId",
        params: {
          messageId: testMessageId,
        },
        block: {
          timestamp: blockTimestamp,
          number: blockNumber,
          hash: blockHash,
        },
        transaction: {
          hash: destinationTransactionHash,
        },
        srcAddress: mailboxAddress,
        logIndex: 1,
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
      const superSwaps = Array.from(await indexer.SuperSwap.getAll());
      expect(superSwaps).toHaveLength(0);
    });
  });
});
