import type { OUSDTBridgedTransaction, OUSDTSwaps } from "envio";
import { createTestIndexer } from "envio";
import {
  OUSDTSwapsId,
  OUSDT_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import { SuperSwapLegId } from "../../../src/EventHandlers/SuperswapsHyperlane/SuperSwapLegLogic";
import {
  type WithChain,
  seedDispatchedMessage,
  seedOUSDTSwap,
} from "../../testHelpers";

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

  // The origin side of a SuperSwap (ADR 0009, flow G): CrossChainSwap writes
  // one SuperSwapOriginLeg per message its transaction dispatched, from this
  // chain's rows only. The destination leg is the destination chain's
  // (Mailbox.ProcessId); the analytics layer joins the two on the message id.
  describe("CrossChainSwap event", () => {
    const messageId =
      "0xCCE7BDDCBF46218439FDAF78B99904EDCDF012B927E95EB053B8D01461C9DF9B";
    const messageId2 =
      "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
    const tokenInAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );
    const oUSDTAmount = 18116811000000000000n; // 18.116811 oUSDT

    function bridge(
      overrides: Partial<OUSDTBridgedTransaction> = {},
    ): WithChain<OUSDTBridgedTransaction> {
      return {
        id: transactionHash,
        chainId,
        transactionHash,
        originChainId: BigInt(chainId),
        destinationChainId: BigInt(destinationDomain),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        amount: oUSDTAmount,
        ...overrides,
      };
    }

    const sourceSwap: OUSDTSwaps = {
      id: OUSDTSwapsId(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        OUSDT_ADDRESS,
        oUSDTAmount,
      ),
      transactionHash,
      tokenInPool: tokenInAddress,
      tokenOutPool: OUSDT_ADDRESS,
      amountIn: 1000n,
      amountOut: oUSDTAmount,
    };

    function crossChainSwap(destination: bigint) {
      return {
        contract: "VelodromeUniversalRouter" as const,
        event: "CrossChainSwap" as const,
        logIndex: 2,
        block: {
          timestamp: blockTimestamp,
          number: 123457,
          hash: transactionHash,
        },
        transaction: { hash: transactionHash },
        params: { destinationDomain: destination },
      };
    }

    it("writes one SuperSwapOriginLeg per dispatched message, with the bridge and the transaction's first oUSDT swap", async () => {
      const indexer = createTestIndexer();
      indexer.OUSDTBridgedTransaction.set(bridge());
      await seedDispatchedMessage(indexer, chainId, transactionHash, messageId);
      await seedDispatchedMessage(
        indexer,
        chainId,
        transactionHash,
        messageId2,
      );
      await seedOUSDTSwap(indexer, sourceSwap, chainId);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [crossChainSwap(BigInt(destinationDomain))],
          },
        },
      });

      const expectedLeg = {
        chainId,
        transactionHash,
        destinationChainId: BigInt(destinationDomain),
        sender: senderAddress.toLowerCase(),
        recipient: recipientAddress.toLowerCase(),
        oUSDTamount: oUSDTAmount,
        sourceChainToken: tokenInAddress,
        sourceChainTokenAmountSwapped: 1000n,
        timestamp: new Date(blockTimestamp * 1000),
      };
      expect(
        await indexer.SuperSwapOriginLeg.get(
          SuperSwapLegId(chainId, messageId),
        ),
      ).toEqual({
        ...expectedLeg,
        id: `${chainId}-${messageId}`,
        messageId,
        dispatchIndex: 0,
      });
      expect(
        await indexer.SuperSwapOriginLeg.get(
          SuperSwapLegId(chainId, messageId2),
        ),
      ).toEqual({
        ...expectedLeg,
        id: `${chainId}-${messageId2}`,
        messageId: messageId2,
        dispatchIndex: 1,
      });
      expect(await indexer.SuperSwapDestinationLeg.getAll()).toEqual([]);
    });

    it("stores the resolved chainId on the origin leg for a Metal-destined CrossChainSwap (domain 1000001750 -> 1750)", async () => {
      const indexer = createTestIndexer();
      const metalHyperlaneDomain = 1000001750n; // Metal's Hyperlane domainId
      const metalChainId = 1750n; // Metal's EVM chainId

      indexer.OUSDTBridgedTransaction.set(
        bridge({ destinationChainId: metalChainId }),
      );
      await seedDispatchedMessage(indexer, chainId, transactionHash, messageId);
      await seedOUSDTSwap(indexer, sourceSwap, chainId);

      await indexer.process({
        chains: {
          [chainId]: { simulate: [crossChainSwap(metalHyperlaneDomain)] },
        },
      });

      const leg = await indexer.SuperSwapOriginLeg.get(
        SuperSwapLegId(chainId, messageId),
      );
      // The leg must store the resolved chainId, not the raw Hyperlane domain.
      expect(leg?.destinationChainId).toBe(metalChainId);
    });

    it("writes no leg when no OUSDTBridgedTransaction exists", async () => {
      const indexer = createTestIndexer();
      await seedDispatchedMessage(indexer, chainId, transactionHash, messageId);
      await seedOUSDTSwap(indexer, sourceSwap, chainId);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [crossChainSwap(BigInt(destinationDomain))],
          },
        },
      });

      expect(await indexer.SuperSwapOriginLeg.getAll()).toEqual([]);
    });

    it("writes no leg when the transaction dispatched no message", async () => {
      const indexer = createTestIndexer();
      indexer.OUSDTBridgedTransaction.set(bridge());
      await seedOUSDTSwap(indexer, sourceSwap, chainId);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [crossChainSwap(BigInt(destinationDomain))],
          },
        },
      });

      expect(await indexer.SuperSwapOriginLeg.getAll()).toEqual([]);
    });

    it("uses the bridge row of its own transaction (keyed by the transaction hash)", async () => {
      const indexer = createTestIndexer();
      const anotherHash =
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef";
      indexer.OUSDTBridgedTransaction.set(bridge({ amount: 1000n }));
      // Another row naming the same transaction under a different id.
      indexer.OUSDTBridgedTransaction.set(
        bridge({ id: anotherHash, amount: 2000n }),
      );
      await seedDispatchedMessage(indexer, chainId, transactionHash, messageId);
      await seedOUSDTSwap(indexer, sourceSwap, chainId);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [crossChainSwap(BigInt(destinationDomain))],
          },
        },
      });

      const leg = await indexer.SuperSwapOriginLeg.get(
        SuperSwapLegId(chainId, messageId),
      );
      expect(leg?.oUSDTamount).toBe(1000n);
    });
  });
});
