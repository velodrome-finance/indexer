import { expect } from "chai";
import { Mailbox, MockDb } from "../../../generated/src/TestHelpers.gen";
import type {
  DispatchId_event,
  ProcessId_event,
  SuperSwap,
  oUSDTBridgedTransaction,
  oUSDTSwaps,
} from "../../../generated/src/Types.gen";
import { OUSDT_ADDRESS, toChecksumAddress } from "../../../src/Constants";

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
      const mockDb = MockDb.createMockDb();
      const mockEvent = Mailbox.DispatchId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      // Execute
      const result = await Mailbox.DispatchId.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check DispatchId_event was created
      const expectedId = `${mockEvent.transaction.hash}_${chainId}_${messageId}`;
      const entity = result.entities.DispatchId_event.get(expectedId);
      expect(entity).to.not.be.undefined;
      expect(entity?.id).to.equal(expectedId);
      expect(entity?.chainId).to.equal(chainId);
      expect(entity?.transactionHash).to.equal(mockEvent.transaction.hash);
      expect(entity?.messageId).to.equal(messageId);
    });

    it("should create DispatchId_event with unique id per transaction", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const transactionHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const transactionHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const mockEvent1 = Mailbox.DispatchId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: transactionHash1,
          },
        },
      });

      const mockEvent2 = Mailbox.DispatchId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber + 1,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: transactionHash2,
          },
        },
      });

      // Execute
      const result1 = await Mailbox.DispatchId.processEvent({
        event: mockEvent1,
        mockDb,
      });

      // Merge entities from result1 into a new mockDb
      let updatedMockDb = MockDb.createMockDb();
      const entity1FromResult1 = result1.entities.DispatchId_event.get(
        `${transactionHash1}_${chainId}_${messageId}`,
      );
      if (entity1FromResult1) {
        updatedMockDb =
          updatedMockDb.entities.DispatchId_event.set(entity1FromResult1);
      }

      const result2 = await Mailbox.DispatchId.processEvent({
        event: mockEvent2,
        mockDb: updatedMockDb,
      });

      // Assert - check both entities were created with different IDs
      const expectedId1 = `${transactionHash1}_${chainId}_${messageId}`;
      const expectedId2 = `${transactionHash2}_${chainId}_${messageId}`;
      const entity1 = result2.entities.DispatchId_event.get(expectedId1);
      const entity2 = result2.entities.DispatchId_event.get(expectedId2);

      expect(entity1).to.not.be.undefined;
      expect(entity2).to.not.be.undefined;
      expect(entity1?.id).to.equal(expectedId1);
      expect(entity2?.id).to.equal(expectedId2);
      expect(entity1?.id).to.not.equal(entity2?.id);
    });

    it("should handle different messageIds correctly", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const mockEvent1 = Mailbox.DispatchId.createMockEvent({
        messageId: messageId1,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      const mockEvent2 = Mailbox.DispatchId.createMockEvent({
        messageId: messageId2,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber + 1,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      // Execute
      const result1 = await Mailbox.DispatchId.processEvent({
        event: mockEvent1,
        mockDb,
      });

      // Merge entities from result1 into a new mockDb
      let updatedMockDb = MockDb.createMockDb();
      const expectedId1 = `${mockEvent1.transaction.hash}_${chainId}_${messageId1}`;
      const entity1FromResult1 =
        result1.entities.DispatchId_event.get(expectedId1);
      if (entity1FromResult1) {
        updatedMockDb =
          updatedMockDb.entities.DispatchId_event.set(entity1FromResult1);
      }

      const result2 = await Mailbox.DispatchId.processEvent({
        event: mockEvent2,
        mockDb: updatedMockDb,
      });

      // Assert - check both entities were created with different messageIds
      const expectedId2 = `${mockEvent2.transaction.hash}_${chainId}_${messageId2}`;
      const entity1 = result2.entities.DispatchId_event.get(expectedId1);
      const entity2 = result2.entities.DispatchId_event.get(expectedId2);

      expect(entity1).to.not.be.undefined;
      expect(entity2).to.not.be.undefined;
      expect(entity1?.messageId).to.equal(messageId1);
      expect(entity2?.messageId).to.equal(messageId2);
    });
  });

  describe("ProcessId event", () => {
    it("should create ProcessId_event entity with correct fields", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const mockEvent = Mailbox.ProcessId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      // Execute
      const result = await Mailbox.ProcessId.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check ProcessId_event was created
      const expectedId = `${mockEvent.transaction.hash}_${chainId}_${messageId}`;
      const entity = result.entities.ProcessId_event.get(expectedId);
      expect(entity).to.not.be.undefined;
      expect(entity?.id).to.equal(expectedId);
      expect(entity?.chainId).to.equal(chainId);
      expect(entity?.transactionHash).to.equal(mockEvent.transaction.hash);
      expect(entity?.messageId).to.equal(messageId);
    });

    it("should create ProcessId_event with unique id per transaction", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const transactionHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const transactionHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const mockEvent1 = Mailbox.ProcessId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: transactionHash1,
          },
        },
      });

      const mockEvent2 = Mailbox.ProcessId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber + 1,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: transactionHash2,
          },
        },
      });

      // Execute
      const result1 = await Mailbox.ProcessId.processEvent({
        event: mockEvent1,
        mockDb,
      });

      // Merge entities from result1 into a new mockDb
      let updatedMockDb = MockDb.createMockDb();
      const expectedId1 = `${transactionHash1}_${chainId}_${messageId}`;
      const entity1FromResult1 =
        result1.entities.ProcessId_event.get(expectedId1);
      if (entity1FromResult1) {
        updatedMockDb =
          updatedMockDb.entities.ProcessId_event.set(entity1FromResult1);
      }

      const result2 = await Mailbox.ProcessId.processEvent({
        event: mockEvent2,
        mockDb: updatedMockDb,
      });

      // Assert - check both entities were created with different IDs
      const expectedId2 = `${transactionHash2}_${chainId}_${messageId}`;
      const entity1 = result2.entities.ProcessId_event.get(expectedId1);
      const entity2 = result2.entities.ProcessId_event.get(expectedId2);

      expect(entity1).to.not.be.undefined;
      expect(entity2).to.not.be.undefined;
      expect(entity1?.id).to.equal(expectedId1);
      expect(entity2?.id).to.equal(expectedId2);
      expect(entity1?.id).to.not.equal(entity2?.id);
    });

    it("should handle different messageIds correctly", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const mockEvent1 = Mailbox.ProcessId.createMockEvent({
        messageId: messageId1,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      const mockEvent2 = Mailbox.ProcessId.createMockEvent({
        messageId: messageId2,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber + 1,
            hash: blockHash,
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      // Execute
      const result1 = await Mailbox.ProcessId.processEvent({
        event: mockEvent1,
        mockDb,
      });

      // Merge entities from result1 into a new mockDb
      let updatedMockDb = MockDb.createMockDb();
      const expectedId1 = `${mockEvent1.transaction.hash}_${chainId}_${messageId1}`;
      const entity1FromResult1 =
        result1.entities.ProcessId_event.get(expectedId1);
      if (entity1FromResult1) {
        updatedMockDb =
          updatedMockDb.entities.ProcessId_event.set(entity1FromResult1);
      }

      const result2 = await Mailbox.ProcessId.processEvent({
        event: mockEvent2,
        mockDb: updatedMockDb,
      });

      // Assert - check both entities were created with different messageIds
      const expectedId2 = `${mockEvent2.transaction.hash}_${chainId}_${messageId2}`;
      const entity1 = result2.entities.ProcessId_event.get(expectedId1);
      const entity2 = result2.entities.ProcessId_event.get(expectedId2);

      expect(entity1).to.not.be.undefined;
      expect(entity2).to.not.be.undefined;
      expect(entity1?.messageId).to.equal(messageId1);
      expect(entity2?.messageId).to.equal(messageId2);
    });

    it("should handle different chainIds correctly", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const chainId1 = 10; // Optimism
      const chainId2 = 8453; // Base

      const mockEvent1 = Mailbox.ProcessId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: chainId1,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      const mockEvent2 = Mailbox.ProcessId.createMockEvent({
        messageId: messageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber + 1,
            hash: blockHash,
          },
          chainId: chainId2,
          logIndex: 1,
          srcAddress: mailboxAddress,
        },
      });

      // Execute
      const result1 = await Mailbox.ProcessId.processEvent({
        event: mockEvent1,
        mockDb,
      });

      // Merge entities from result1 into a new mockDb
      let updatedMockDb = MockDb.createMockDb();
      const expectedId1 = `${mockEvent1.transaction.hash}_${chainId1}_${messageId}`;
      const entity1FromResult1 =
        result1.entities.ProcessId_event.get(expectedId1);
      if (entity1FromResult1) {
        updatedMockDb =
          updatedMockDb.entities.ProcessId_event.set(entity1FromResult1);
      }

      const result2 = await Mailbox.ProcessId.processEvent({
        event: mockEvent2,
        mockDb: updatedMockDb,
      });

      // Assert - check both entities were created with different chainIds
      const expectedId2 = `${mockEvent2.transaction.hash}_${chainId2}_${messageId}`;
      const entity1 = result2.entities.ProcessId_event.get(expectedId1);
      const entity2 = result2.entities.ProcessId_event.get(expectedId2);

      expect(entity1).to.not.be.undefined;
      expect(entity2).to.not.be.undefined;
      expect(entity1?.chainId).to.equal(chainId1);
      expect(entity2?.chainId).to.equal(chainId2);
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
    const tokenInAddress = "0x3333333333333333333333333333333333333333";
    const tokenOutAddress = "0x4444444444444444444444444444444444444444";
    const oUSDTAmount = 18116811000000000000n; // 18.116811 oUSDT

    it("should create SuperSwap when ProcessId is processed and all required data exists", async () => {
      // Setup: Create all required entities
      let mockDb = MockDb.createMockDb();

      // 1. Create DispatchId_event (source chain)
      const dispatchIdEvent: DispatchId_event = {
        id: `${sourceTransactionHash}_${sourceChainId}_${testMessageId}`,
        chainId: sourceChainId,
        transactionHash: sourceTransactionHash,
        messageId: testMessageId,
      };
      mockDb = mockDb.entities.DispatchId_event.set(dispatchIdEvent);

      // 2. Create oUSDTBridgedTransaction
      const bridgedTransaction: oUSDTBridgedTransaction = {
        id: sourceTransactionHash,
        transactionHash: sourceTransactionHash,
        originChainId: BigInt(sourceChainId),
        destinationChainId: BigInt(destinationChainId),
        sender: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
        amount: oUSDTAmount,
      };
      mockDb = mockDb.entities.oUSDTBridgedTransaction.set(bridgedTransaction);

      // 3. Create ProcessId_event (destination chain) - this will be created by the handler
      // But we also need it for the lookup
      const processIdEvent: ProcessId_event = {
        id: `${destinationTransactionHash}_${destinationChainId}_${testMessageId}`,
        chainId: destinationChainId,
        transactionHash: destinationTransactionHash,
        messageId: testMessageId,
      };
      mockDb = mockDb.entities.ProcessId_event.set(processIdEvent);

      // 4. Create source chain swap (tokenIn -> oUSDT)
      const sourceSwap: oUSDTSwaps = {
        id: `${sourceTransactionHash}_${sourceChainId}_${tokenInAddress}_1000_${OUSDT_ADDRESS}_${oUSDTAmount}`,
        transactionHash: sourceTransactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: OUSDT_ADDRESS,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };
      mockDb = mockDb.entities.oUSDTSwaps.set(sourceSwap);

      // 5. Create destination chain swap (oUSDT -> tokenOut)
      const destinationSwap: oUSDTSwaps = {
        id: `${destinationTransactionHash}_${destinationChainId}_${OUSDT_ADDRESS}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: destinationTransactionHash,
        tokenInPool: OUSDT_ADDRESS,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };
      mockDb = mockDb.entities.oUSDTSwaps.set(destinationSwap);

      // Execute: Process ProcessId event
      const processIdMockEvent = Mailbox.ProcessId.createMockEvent({
        messageId: testMessageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: destinationChainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: destinationTransactionHash,
          },
        },
      });

      const result = await Mailbox.ProcessId.processEvent({
        event: processIdMockEvent,
        mockDb,
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = `${destinationTransactionHash}_${destinationChainId}_${testMessageId}`;
      const processIdEntity =
        result.entities.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).to.not.be.undefined;
      expect(processIdEntity?.messageId).to.equal(testMessageId);

      // Assert: SuperSwap was created
      const superSwaps = Array.from(
        result.entities.SuperSwap.getAll(),
      ) as SuperSwap[];
      expect(superSwaps.length).to.equal(1);

      const superSwap = superSwaps[0];
      expect(superSwap.originChainId).to.equal(BigInt(sourceChainId));
      expect(superSwap.destinationChainId).to.equal(BigInt(destinationChainId));
      expect(superSwap.oUSDTamount).to.equal(oUSDTAmount);
      expect(superSwap.sourceChainToken).to.equal(tokenInAddress);
      expect(superSwap.destinationChainToken).to.equal(tokenOutAddress);
      expect(superSwap.sourceChainTokenAmountSwapped).to.equal(1000n);
      expect(superSwap.destinationChainTokenAmountSwapped).to.equal(950n);
    });

    it("should create ProcessId_event but not SuperSwap when DispatchId is missing", async () => {
      // Setup: Create ProcessId event without DispatchId
      const mockDb = MockDb.createMockDb();

      const processIdMockEvent = Mailbox.ProcessId.createMockEvent({
        messageId: testMessageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: destinationChainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: destinationTransactionHash,
          },
        },
      });

      const result = await Mailbox.ProcessId.processEvent({
        event: processIdMockEvent,
        mockDb,
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = `${destinationTransactionHash}_${destinationChainId}_${testMessageId}`;
      const processIdEntity =
        result.entities.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).to.not.be.undefined;

      // Assert: No SuperSwap was created (DispatchId missing)
      const superSwaps = Array.from(result.entities.SuperSwap.getAll());
      expect(superSwaps.length).to.equal(0);
    });

    it("should create ProcessId_event but not SuperSwap when oUSDTBridgedTransaction is missing", async () => {
      // Setup: Create DispatchId but no bridged transaction
      let mockDb = MockDb.createMockDb();

      const dispatchIdEvent: DispatchId_event = {
        id: `${sourceTransactionHash}_${sourceChainId}_${testMessageId}`,
        chainId: sourceChainId,
        transactionHash: sourceTransactionHash,
        messageId: testMessageId,
      };
      mockDb = mockDb.entities.DispatchId_event.set(dispatchIdEvent);

      const processIdMockEvent = Mailbox.ProcessId.createMockEvent({
        messageId: testMessageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: destinationChainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: destinationTransactionHash,
          },
        },
      });

      const result = await Mailbox.ProcessId.processEvent({
        event: processIdMockEvent,
        mockDb,
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = `${destinationTransactionHash}_${destinationChainId}_${testMessageId}`;
      const processIdEntity =
        result.entities.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).to.not.be.undefined;

      // Assert: No SuperSwap was created (bridged transaction missing)
      const superSwaps = Array.from(result.entities.SuperSwap.getAll());
      expect(superSwaps.length).to.equal(0);
    });

    it("should handle ProcessId event gracefully when source chain swaps are missing", async () => {
      // Setup: Create all entities except source swap
      let mockDb = MockDb.createMockDb();

      const dispatchIdEvent: DispatchId_event = {
        id: `${sourceTransactionHash}_${sourceChainId}_${testMessageId}`,
        chainId: sourceChainId,
        transactionHash: sourceTransactionHash,
        messageId: testMessageId,
      };
      mockDb = mockDb.entities.DispatchId_event.set(dispatchIdEvent);

      const bridgedTransaction: oUSDTBridgedTransaction = {
        id: sourceTransactionHash,
        transactionHash: sourceTransactionHash,
        originChainId: BigInt(sourceChainId),
        destinationChainId: BigInt(destinationChainId),
        sender: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
        amount: oUSDTAmount,
      };
      mockDb = mockDb.entities.oUSDTBridgedTransaction.set(bridgedTransaction);

      const processIdEvent: ProcessId_event = {
        id: `${destinationTransactionHash}_${destinationChainId}_${testMessageId}`,
        chainId: destinationChainId,
        transactionHash: destinationTransactionHash,
        messageId: testMessageId,
      };
      mockDb = mockDb.entities.ProcessId_event.set(processIdEvent);

      // Note: No source swap created

      const processIdMockEvent = Mailbox.ProcessId.createMockEvent({
        messageId: testMessageId,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: blockNumber,
            hash: blockHash,
          },
          chainId: destinationChainId,
          logIndex: 1,
          srcAddress: mailboxAddress,
          transaction: {
            hash: destinationTransactionHash,
          },
        },
      });

      const result = await Mailbox.ProcessId.processEvent({
        event: processIdMockEvent,
        mockDb,
      });

      // Assert: ProcessId_event was created
      const processIdEntityId = `${destinationTransactionHash}_${destinationChainId}_${testMessageId}`;
      const processIdEntity =
        result.entities.ProcessId_event.get(processIdEntityId);
      expect(processIdEntity).to.not.be.undefined;

      // Assert: No SuperSwap was created (source swap missing)
      const superSwaps = Array.from(result.entities.SuperSwap.getAll());
      expect(superSwaps.length).to.equal(0);
    });
  });
});
