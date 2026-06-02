import type {
  DispatchId_event,
  OUSDTBridgedTransaction,
  OUSDTSwaps,
  ProcessId_event,
} from "envio";
import { createTestIndexer } from "envio";
import {
  MailboxMessageId,
  OUSDTSwapsId,
  OUSDT_ADDRESS,
  SuperSwapId,
  toChecksumAddress,
} from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";

describe("VelodromeUniversalRouter Event Handlers", () => {
  const chainId = 10 as const; // Optimism
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const senderAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const recipientAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const destinationDomain = 8453; // Base chain ID
  const tokenAmount = 1000n * 10n ** 6n; // 1000 tokens with 6 decimals
  const blockTimestamp = 1000000;

  describe("UniversalRouterBridge event", () => {
    it("should create OUSDTBridgedTransaction entity when token is oUSDT", async () => {
      const indexer = createTestIndexer();

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "UniversalRouterBridge",
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: 123456,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  token: OUSDT_ADDRESS,
                  domain: BigInt(destinationDomain),
                  sender: senderAddress,
                  recipient: recipientAddress,
                  amount: tokenAmount,
                },
              },
            ],
          },
        },
      });

      const bridgedTransaction =
        await indexer.OUSDTBridgedTransaction.get(transactionHash);

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

    it("should resolve a divergent Hyperlane domain to its chainId (Metal 1000001750 -> 1750)", async () => {
      const indexer = createTestIndexer();
      const metalHyperlaneDomain = 1000001750n; // Metal's Hyperlane domainId
      const metalChainId = 1750n; // Metal's EVM chainId

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "UniversalRouterBridge",
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: 123456,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  token: OUSDT_ADDRESS,
                  domain: metalHyperlaneDomain,
                  sender: senderAddress,
                  recipient: recipientAddress,
                  amount: tokenAmount,
                },
              },
            ],
          },
        },
      });

      const bridgedTransaction =
        await indexer.OUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).toBeDefined();
      // Must store the resolved chainId (1750), not the raw Hyperlane domain (1000001750).
      expect(bridgedTransaction?.destinationChainId).toBe(metalChainId);
    });

    it("should not create entity when token is not oUSDT", async () => {
      const indexer = createTestIndexer();
      const otherTokenAddress = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "UniversalRouterBridge",
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: 123456,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  token: otherTokenAddress,
                  domain: BigInt(destinationDomain),
                  sender: senderAddress,
                  recipient: recipientAddress,
                  amount: tokenAmount,
                },
              },
            ],
          },
        },
      });

      const bridgedTransaction =
        await indexer.OUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).toBeUndefined();
    });

    it("should normalize amount correctly using OUSDT_DECIMALS constant", async () => {
      const indexer = createTestIndexer();
      const testAmount = 500n * 10n ** 6n; // 500 tokens with 6 decimals

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "UniversalRouterBridge",
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: 123456,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  token: OUSDT_ADDRESS,
                  domain: BigInt(destinationDomain),
                  sender: senderAddress,
                  recipient: recipientAddress,
                  amount: testAmount,
                },
              },
            ],
          },
        },
      });

      const bridgedTransaction =
        await indexer.OUSDTBridgedTransaction.get(transactionHash);

      expect(bridgedTransaction).toBeDefined();
      expect(bridgedTransaction?.amount).toBe(500n * 10n ** 6n); // Raw amount: 500 tokens with 6 decimals
    });
  });

  describe("CrossChainSwap event", () => {
    const messageId =
      "0xCCE7BDDCBF46218439FDAF78B99904EDCDF012B927E95EB053B8D01461C9DF9B";
    const destinationTxHash =
      "0xdc34c918860806a2dafebad41e539cfe42f20253c0585358b91d31a11de41806";
    const tokenInAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );
    const tokenOutAddress = toChecksumAddress(
      "0x4444444444444444444444444444444444444444",
    );

    it("should create SuperSwap entity when all required entities exist", async () => {
      const indexer = createTestIndexer();

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

      // Seed all required entities so native getWhere finds them
      indexer.OUSDTBridgedTransaction.set(existingBridgedTransaction);
      indexer.DispatchId_event.set(dispatchIdEvent);
      indexer.ProcessId_event.set(processIdEvent);
      indexer.OUSDTSwaps.set(sourceSwapEvent);
      indexer.OUSDTSwaps.set(destinationSwapEvent);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "CrossChainSwap",
                logIndex: 2,
                block: {
                  timestamp: blockTimestamp,
                  number: 123457,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  destinationDomain: BigInt(destinationDomain),
                },
              },
            ],
          },
        },
      });

      const expectedSuperSwapId = SuperSwapId(messageId);
      const rawSuperSwap = await indexer.SuperSwap.get(expectedSuperSwapId);
      const superSwap = rawSuperSwap
        ? rehydrateTimestamps("SuperSwap", rawSuperSwap)
        : undefined;

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

    it("should store the resolved chainId on SuperSwap for a Metal-destined CrossChainSwap (domain 1000001750 -> 1750)", async () => {
      const indexer = createTestIndexer();
      const metalHyperlaneDomain = 1000001750n; // Metal's Hyperlane domainId
      const metalChainId = 1750; // Metal's EVM chainId

      // Bridged transaction already carries the resolved chainId (post-fix producer).
      const existingBridgedTransaction: OUSDTBridgedTransaction = {
        id: transactionHash,
        transactionHash: transactionHash,
        originChainId: BigInt(chainId),
        destinationChainId: BigInt(metalChainId),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 18116811000000000000n,
      };

      const dispatchIdEvent: DispatchId_event = {
        id: MailboxMessageId(transactionHash, chainId, messageId),
        chainId: chainId,
        transactionHash: transactionHash,
        messageId: messageId,
      };

      const processIdEvent: ProcessId_event = {
        id: MailboxMessageId(destinationTxHash, metalChainId, messageId),
        chainId: metalChainId,
        transactionHash: destinationTxHash,
        messageId: messageId,
      };

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

      const destinationSwapEvent: OUSDTSwaps = {
        id: OUSDTSwapsId(
          destinationTxHash,
          metalChainId,
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

      indexer.OUSDTBridgedTransaction.set(existingBridgedTransaction);
      indexer.DispatchId_event.set(dispatchIdEvent);
      indexer.ProcessId_event.set(processIdEvent);
      indexer.OUSDTSwaps.set(sourceSwapEvent);
      indexer.OUSDTSwaps.set(destinationSwapEvent);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "CrossChainSwap",
                logIndex: 2,
                block: {
                  timestamp: blockTimestamp,
                  number: 123457,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  destinationDomain: metalHyperlaneDomain,
                },
              },
            ],
          },
        },
      });

      const superSwap = await indexer.SuperSwap.get(SuperSwapId(messageId));

      expect(superSwap).toBeDefined();
      expect(superSwap?.originChainId).toBe(BigInt(chainId));
      // SuperSwap must store the resolved chainId, not the raw Hyperlane domain.
      expect(superSwap?.destinationChainId).toBe(BigInt(metalChainId));
    });

    it("should not create SuperSwap when no OUSDTBridgedTransaction exists", async () => {
      const indexer = createTestIndexer();
      // No entities seeded — native getWhere returns []

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "CrossChainSwap",
                logIndex: 2,
                block: {
                  timestamp: blockTimestamp,
                  number: 123457,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  destinationDomain: BigInt(destinationDomain),
                },
              },
            ],
          },
        },
      });

      // Verify that no SuperSwap was created when no bridged transaction exists
      const superSwaps = await indexer.SuperSwap.getAll();
      expect(superSwaps).toHaveLength(0);
    });

    it("should not create SuperSwap when no DispatchId events exist", async () => {
      const indexer = createTestIndexer();

      const existingBridgedTransaction: OUSDTBridgedTransaction = {
        id: transactionHash,
        transactionHash: transactionHash,
        originChainId: BigInt(chainId),
        destinationChainId: BigInt(destinationDomain),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: 18116811000000000000n,
      };

      indexer.OUSDTBridgedTransaction.set(existingBridgedTransaction);
      // No DispatchId_event seeded → native getWhere returns []

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "CrossChainSwap",
                logIndex: 2,
                block: {
                  timestamp: blockTimestamp,
                  number: 123457,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  destinationDomain: BigInt(destinationDomain),
                },
              },
            ],
          },
        },
      });

      // Verify that no SuperSwap was created when no DispatchId events exist
      const superSwaps = await indexer.SuperSwap.getAll();
      expect(superSwaps).toHaveLength(0);
    });

    it("should use the first bridged transaction when multiple exist", async () => {
      const indexer = createTestIndexer();
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

      indexer.OUSDTBridgedTransaction.set(bridgedTransaction1);
      indexer.OUSDTBridgedTransaction.set(bridgedTransaction2);
      indexer.DispatchId_event.set(dispatchIdEvent);
      indexer.ProcessId_event.set(processIdEvent);
      indexer.OUSDTSwaps.set(sourceSwapEvent);
      indexer.OUSDTSwaps.set(destinationSwapEvent);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "VelodromeUniversalRouter",
                event: "CrossChainSwap",
                logIndex: 2,
                block: {
                  timestamp: blockTimestamp,
                  number: 123457,
                  hash: transactionHash,
                },
                transaction: {
                  hash: transactionHash,
                },
                params: {
                  destinationDomain: BigInt(destinationDomain),
                },
              },
            ],
          },
        },
      });

      const expectedSuperSwapId = SuperSwapId(messageId);
      const superSwap = await indexer.SuperSwap.get(expectedSuperSwapId);

      expect(superSwap).toBeDefined();
      // Should use the first transaction (amount 1000)
      expect(superSwap?.oUSDTamount).toBe(bridgedTransaction1.amount);
    });
  });
});
