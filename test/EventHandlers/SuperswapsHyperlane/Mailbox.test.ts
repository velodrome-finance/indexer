import { expect } from "chai";
import { Mailbox, MockDb } from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";

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
});
