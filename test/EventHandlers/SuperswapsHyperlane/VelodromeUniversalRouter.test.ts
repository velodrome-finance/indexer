import {
  MockDb,
  VelodromeUniversalRouter,
} from "../../../generated/src/TestHelpers.gen";
import type {
  DispatchId_event,
  OUSDTBridgedTransaction,
  OUSDTSwaps,
  ProcessId_event,
} from "../../../generated/src/Types.gen";
import {
  MailboxMessageId,
  OUSDTSwapsId,
  OUSDT_ADDRESS,
  SuperSwapId,
} from "../../../src/Constants";

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
    it("should create OUSDTBridgedTransaction entity when token is oUSDT", async () => {
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
        result.entities.OUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).toBeDefined();
      expect(bridgedTransaction?.id).toBe(transactionHash);
      expect(bridgedTransaction?.transactionHash).toBe(transactionHash);
      expect(bridgedTransaction?.originChainId).toBe(BigInt(chainId));
      expect(bridgedTransaction?.destinationChainId).toBe(
        BigInt(destinationDomain),
      );
      expect(bridgedTransaction?.sender).toBe(senderAddress.toLowerCase());
      expect(bridgedTransaction?.recipient).toBe(
        recipientAddress.toLowerCase(),
      );
      expect(bridgedTransaction?.amount).toBe(1000n * 10n ** 6n); // Raw amount: 1000 tokens with 6 decimals
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
        result.entities.OUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).toBeUndefined();
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
        result.entities.OUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).toBeDefined();
      expect(bridgedTransaction?.amount).toBe(500n * 10n ** 6n); // Raw amount: 500 tokens with 6 decimals
    });
  });

  describe("CrossChainSwap event", () => {
    const messageId =
      "0xCCE7BDDCBF46218439FDAF78B99904EDCDF012B927E95EB053B8D01461C9DF9B";
    const destinationTxHash =
      "0xdc34c918860806a2dafebad41e539cfe42f20253c0585358b91d31a11de41806";
    const tokenInAddress = "0x3333333333333333333333333333333333333333";
    const tokenOutAddress = "0x4444444444444444444444444444444444444444";

    it("should create SuperSwap entity when all required entities exist", async () => {
      let mockDb = MockDb.createMockDb();

      // Create bridged transaction entity
      const existingBridgedTransaction: OUSDTBridgedTransaction = {
        id: transactionHash,
        transactionHash: transactionHash,
        originChainId: BigInt(chainId),
        destinationChainId: BigInt(destinationDomain),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 18116811000000000000n, // 18.116811 oUSDT
      };

      // Create DispatchId event
      const dispatchIdEvent: DispatchId_event = {
        id: MailboxMessageId(transactionHash, chainId, messageId),
        chainId: chainId,
        transactionHash: transactionHash,
        messageId: messageId,
      };

      // Create ProcessId event
      const processIdEvent: ProcessId_event = {
        id: MailboxMessageId(destinationTxHash, destinationDomain, messageId),
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId,
      };

      // Create source chain oUSDTSwap entity (for transactionHash)
      const sourceSwapEvent: OUSDTSwaps = {
        id: OUSDTSwapsId(
          transactionHash,
          chainId,
          tokenInAddress,
          1000n,
          OUSDT_ADDRESS,
          existingBridgedTransaction.amount,
        ),
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: OUSDT_ADDRESS,
        amountIn: 1000n,
        amountOut: existingBridgedTransaction.amount,
      };

      // Create destination chain oUSDTSwap entity (for destinationTxHash)
      const destinationSwapEvent: OUSDTSwaps = {
        id: OUSDTSwapsId(
          destinationTxHash,
          destinationDomain,
          OUSDT_ADDRESS,
          existingBridgedTransaction.amount,
          tokenOutAddress,
          950n,
        ),
        transactionHash: destinationTxHash,
        tokenInPool: OUSDT_ADDRESS,
        tokenOutPool: tokenOutAddress,
        amountIn: existingBridgedTransaction.amount,
        amountOut: 950n,
      };

      mockDb = mockDb.entities.OUSDTBridgedTransaction.set(
        existingBridgedTransaction,
      );
      mockDb = mockDb.entities.DispatchId_event.set(dispatchIdEvent);
      mockDb = mockDb.entities.ProcessId_event.set(processIdEvent);
      mockDb = mockDb.entities.OUSDTSwaps.set(sourceSwapEvent);
      mockDb = mockDb.entities.OUSDTSwaps.set(destinationSwapEvent);

      // Track entities for getWhere queries
      const bridgedTransactions = [existingBridgedTransaction];
      const dispatchIdEvents = [dispatchIdEvent];
      const processIdEvents = [processIdEvent];
      const swapEvents = [sourceSwapEvent, destinationSwapEvent];

      // Extend mockDb to include getWhere for all entities
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          OUSDTBridgedTransaction: {
            ...mockDb.entities.OUSDTBridgedTransaction,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return bridgedTransactions.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
          DispatchId_event: {
            ...mockDb.entities.DispatchId_event,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return dispatchIdEvents.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
          ProcessId_event: {
            ...mockDb.entities.ProcessId_event,
            getWhere: {
              messageId: {
                eq: async (msgId: string) => {
                  return processIdEvents.filter(
                    (entity) => entity.messageId === msgId,
                  );
                },
              },
            },
          },
          OUSDTSwaps: {
            ...mockDb.entities.OUSDTSwaps,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return swapEvents.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      };

      const mockEvent = VelodromeUniversalRouter.CrossChainSwap.createMockEvent(
        {
          destinationDomain: BigInt(destinationDomain),
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

      // New ID format includes messageId and source swap-specific data
      const expectedSuperSwapId = SuperSwapId(
        transactionHash,
        chainId,
        BigInt(destinationDomain),
        existingBridgedTransaction.amount,
        messageId,
        sourceSwapEvent.tokenInPool,
        sourceSwapEvent.amountIn,
        sourceSwapEvent.tokenOutPool,
        sourceSwapEvent.amountOut,
      );
      const superSwap = result.entities.SuperSwap.get(expectedSuperSwapId);

      expect(superSwap).toBeDefined();
      expect(superSwap?.id).toBe(expectedSuperSwapId);
      expect(superSwap?.originChainId).toBe(BigInt(chainId));
      expect(superSwap?.destinationChainId).toBe(BigInt(destinationDomain));
      expect(superSwap?.sender).toBe(senderAddress.toLowerCase());
      expect(superSwap?.recipient).toBe(recipientAddress.toLowerCase());
      expect(superSwap?.oUSDTamount).toBe(existingBridgedTransaction.amount);
      expect(superSwap?.sourceChainToken).toBe(tokenInAddress);
      expect(superSwap?.sourceChainTokenAmountSwapped).toBe(1000n);
      expect(superSwap?.destinationChainToken).toBe(tokenOutAddress);
      expect(superSwap?.destinationChainTokenAmountSwapped).toBe(950n);
      expect(superSwap?.timestamp).toEqual(new Date(blockTimestamp * 1000));
    });

    it("should not create SuperSwap when no OUSDTBridgedTransaction exists", async () => {
      const mockDb = MockDb.createMockDb();

      // Extend mockDb to include getWhere (returning empty arrays)
      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          OUSDTBridgedTransaction: {
            ...mockDb.entities.OUSDTBridgedTransaction,
            getWhere: {
              transactionHash: {
                eq: async (_txHash: string) => {
                  return []; // No entities found
                },
              },
            },
          },
          DispatchId_event: {
            ...mockDb.entities.DispatchId_event,
            getWhere: {
              transactionHash: {
                eq: async (_txHash: string) => {
                  return [];
                },
              },
            },
          },
        },
      };

      const mockEvent = VelodromeUniversalRouter.CrossChainSwap.createMockEvent(
        {
          destinationDomain: BigInt(destinationDomain),
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

      // Verify that no SuperSwap was created when no bridged transaction exists
      expect(Array.from(result.entities.SuperSwap.getAll())).toHaveLength(0);
    });

    it("should not create SuperSwap when no DispatchId events exist", async () => {
      let mockDb = MockDb.createMockDb();

      const existingBridgedTransaction: OUSDTBridgedTransaction = {
        id: transactionHash,
        transactionHash: transactionHash,
        originChainId: BigInt(chainId),
        destinationChainId: BigInt(destinationDomain),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 18116811000000000000n,
      };

      mockDb = mockDb.entities.OUSDTBridgedTransaction.set(
        existingBridgedTransaction,
      );

      const bridgedTransactions = [existingBridgedTransaction];

      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          OUSDTBridgedTransaction: {
            ...mockDb.entities.OUSDTBridgedTransaction,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return bridgedTransactions.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
          DispatchId_event: {
            ...mockDb.entities.DispatchId_event,
            getWhere: {
              transactionHash: {
                eq: async (_txHash: string) => {
                  return []; // No DispatchId events
                },
              },
            },
          },
        },
      };

      const mockEvent = VelodromeUniversalRouter.CrossChainSwap.createMockEvent(
        {
          destinationDomain: BigInt(destinationDomain),
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

      // Verify that no SuperSwap was created when no DispatchId events exist
      expect(Array.from(result.entities.SuperSwap.getAll())).toHaveLength(0);
    });

    it("should use the first bridged transaction when multiple exist", async () => {
      let mockDb = MockDb.createMockDb();
      const anotherHash =
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef";

      // Create multiple bridged transactions with the same transaction hash
      const bridgedTransaction1: OUSDTBridgedTransaction = {
        id: transactionHash,
        transactionHash: transactionHash,
        originChainId: BigInt(chainId),
        destinationChainId: BigInt(destinationDomain),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 1000n,
      };

      const bridgedTransaction2: OUSDTBridgedTransaction = {
        id: anotherHash,
        transactionHash: transactionHash, // Same transaction hash
        originChainId: BigInt(chainId),
        destinationChainId: BigInt(destinationDomain),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 2000n,
      };

      const dispatchIdEvent: DispatchId_event = {
        id: MailboxMessageId(transactionHash, chainId, messageId),
        chainId: chainId,
        transactionHash: transactionHash,
        messageId: messageId,
      };

      const processIdEvent: ProcessId_event = {
        id: MailboxMessageId(destinationTxHash, destinationDomain, messageId),
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId,
      };

      // Create source chain oUSDTSwap entity (for transactionHash)
      const sourceSwapEvent: OUSDTSwaps = {
        id: OUSDTSwapsId(
          transactionHash,
          chainId,
          tokenInAddress,
          1000n,
          OUSDT_ADDRESS,
          bridgedTransaction1.amount,
        ),
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: OUSDT_ADDRESS,
        amountIn: 1000n,
        amountOut: bridgedTransaction1.amount,
      };

      // Create destination chain oUSDTSwap entity (for destinationTxHash)
      const destinationSwapEvent: OUSDTSwaps = {
        id: OUSDTSwapsId(
          destinationTxHash,
          destinationDomain,
          OUSDT_ADDRESS,
          bridgedTransaction1.amount,
          tokenOutAddress,
          950n,
        ),
        transactionHash: destinationTxHash,
        tokenInPool: OUSDT_ADDRESS,
        tokenOutPool: tokenOutAddress,
        amountIn: bridgedTransaction1.amount,
        amountOut: 950n,
      };

      mockDb = mockDb.entities.OUSDTBridgedTransaction.set(bridgedTransaction1);
      mockDb = mockDb.entities.OUSDTBridgedTransaction.set(bridgedTransaction2);
      mockDb = mockDb.entities.DispatchId_event.set(dispatchIdEvent);
      mockDb = mockDb.entities.ProcessId_event.set(processIdEvent);
      mockDb = mockDb.entities.OUSDTSwaps.set(sourceSwapEvent);
      mockDb = mockDb.entities.OUSDTSwaps.set(destinationSwapEvent);

      const storedBridgedTransactions = [
        bridgedTransaction1,
        bridgedTransaction2,
      ];
      const dispatchIdEvents = [dispatchIdEvent];
      const processIdEvents = [processIdEvent];
      const swapEvents = [sourceSwapEvent, destinationSwapEvent];

      const mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          OUSDTBridgedTransaction: {
            ...mockDb.entities.OUSDTBridgedTransaction,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return storedBridgedTransactions.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
          DispatchId_event: {
            ...mockDb.entities.DispatchId_event,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return dispatchIdEvents.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
          ProcessId_event: {
            ...mockDb.entities.ProcessId_event,
            getWhere: {
              messageId: {
                eq: async (msgId: string) => {
                  return processIdEvents.filter(
                    (entity) => entity.messageId === msgId,
                  );
                },
              },
            },
          },
          OUSDTSwaps: {
            ...mockDb.entities.OUSDTSwaps,
            getWhere: {
              transactionHash: {
                eq: async (txHash: string) => {
                  return swapEvents.filter(
                    (entity) => entity.transactionHash === txHash,
                  );
                },
              },
            },
          },
        },
      };

      const mockEvent = VelodromeUniversalRouter.CrossChainSwap.createMockEvent(
        {
          destinationDomain: BigInt(destinationDomain),
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

      // New ID format includes messageId and source swap-specific data
      const expectedSuperSwapId = SuperSwapId(
        transactionHash,
        chainId,
        BigInt(destinationDomain),
        bridgedTransaction1.amount,
        messageId,
        sourceSwapEvent.tokenInPool,
        sourceSwapEvent.amountIn,
        sourceSwapEvent.tokenOutPool,
        sourceSwapEvent.amountOut,
      );
      const superSwap = result.entities.SuperSwap.get(expectedSuperSwapId);

      expect(superSwap).toBeDefined();
      // Should use the first transaction (amount 1000)
      expect(superSwap?.oUSDTamount).toBe(bridgedTransaction1.amount);
    });
  });
});
