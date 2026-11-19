import type { OUSDTSwaps } from "envio";
import { createTestIndexer } from "envio";
import {
  OUSDTSwapsId,
  OUSDT_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  SuperSwapLegId,
  TxProcessIdRegistryId,
} from "../../../src/EventHandlers/SuperswapsHyperlane/SuperSwapLegLogic";
import { seedDispatchedMessage, seedOUSDTSwap } from "../../testHelpers";

// Mailbox keeps chain-local Hyperlane bookkeeping only (ADR 0009, flow G):
// DispatchId lists the messageIds a transaction dispatched (TxDispatchIdRegistry,
// read by the origin's CrossChainSwap), ProcessId lists the messages a
// transaction processed (TxProcessIdRegistry) and writes the destination legs.
// There is no DispatchId_event / ProcessId_event row and no SuperSwap stitching.
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

  function mailboxEvent(
    event: "DispatchId" | "ProcessId",
    txHash: string,
    msgId: string,
    blockOffset = 0,
    srcAddress: string = mailboxAddress,
  ) {
    return {
      contract: "Mailbox" as const,
      event,
      srcAddress: srcAddress as `0x${string}`,
      logIndex: 1,
      block: {
        timestamp: blockTimestamp + blockOffset,
        number: blockNumber + blockOffset,
        hash: blockHash,
      },
      transaction: { hash: txHash },
      params: { messageId: msgId },
    };
  }

  describe("DispatchId event", () => {
    it("records the messageId in the transaction's TxDispatchIdRegistry", async () => {
      const indexer = createTestIndexer();
      const txHash =
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [mailboxEvent("DispatchId", txHash, messageId)],
          },
        },
      });

      expect(await indexer.TxDispatchIdRegistry.getAll()).toEqual([
        { id: txHash, chainId, messageIds: [messageId] },
      ]);
    });

    it("keeps one registry row per transaction", async () => {
      const indexer = createTestIndexer();
      const transactionHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const transactionHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              mailboxEvent("DispatchId", transactionHash1, messageId),
              mailboxEvent("DispatchId", transactionHash2, messageId, 1),
            ],
          },
        },
      });

      expect(
        (await indexer.TxDispatchIdRegistry.get(transactionHash1))?.messageIds,
      ).toEqual([messageId]);
      expect(
        (await indexer.TxDispatchIdRegistry.get(transactionHash2))?.messageIds,
      ).toEqual([messageId]);
    });

    it("lists the messageIds of one transaction in dispatch order", async () => {
      const indexer = createTestIndexer();
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
      const sharedTxHash =
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              mailboxEvent("DispatchId", sharedTxHash, messageId1),
              mailboxEvent("DispatchId", sharedTxHash, messageId2, 1),
            ],
          },
        },
      });

      const registry = await indexer.TxDispatchIdRegistry.get(sharedTxHash);
      expect(registry?.messageIds).toEqual([messageId1, messageId2]);
    });

    it("does not list a messageId twice", async () => {
      const indexer = createTestIndexer();
      const txHash =
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              mailboxEvent("DispatchId", txHash, messageId),
              mailboxEvent("DispatchId", txHash, messageId, 1),
            ],
          },
        },
      });

      expect(
        (await indexer.TxDispatchIdRegistry.get(txHash))?.messageIds,
      ).toEqual([messageId]);
    });
  });

  describe("ProcessId event", () => {
    it("records the messageId in the transaction's TxProcessIdRegistry with the block time", async () => {
      const indexer = createTestIndexer();
      const txHash =
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [mailboxEvent("ProcessId", txHash, messageId)],
          },
        },
      });

      expect(
        await indexer.TxProcessIdRegistry.get(
          TxProcessIdRegistryId(chainId, txHash),
        ),
      ).toEqual({
        id: `${chainId}-${txHash}`,
        chainId,
        messageIds: [messageId],
        timestamp: new Date(blockTimestamp * 1000),
      });
    });

    it("keeps one registry row per transaction", async () => {
      const indexer = createTestIndexer();
      const transactionHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const transactionHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              mailboxEvent("ProcessId", transactionHash1, messageId),
              mailboxEvent("ProcessId", transactionHash2, messageId, 1),
            ],
          },
        },
      });

      for (const txHash of [transactionHash1, transactionHash2]) {
        expect(
          (
            await indexer.TxProcessIdRegistry.get(
              TxProcessIdRegistryId(chainId, txHash),
            )
          )?.messageIds,
        ).toEqual([messageId]);
      }
    });

    it("lists the messages one transaction processed", async () => {
      const indexer = createTestIndexer();
      const messageId1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const messageId2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
      const sharedTxHash =
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              mailboxEvent("ProcessId", sharedTxHash, messageId1),
              mailboxEvent("ProcessId", sharedTxHash, messageId2, 1),
            ],
          },
        },
      });

      expect(
        (
          await indexer.TxProcessIdRegistry.get(
            TxProcessIdRegistryId(chainId, sharedTxHash),
          )
        )?.messageIds,
      ).toEqual([messageId1, messageId2]);
    });

    it("keys the registry by chain and transaction", async () => {
      const chainId2 = 8453 as const; // Base
      // Base runs its own Mailbox deployment.
      const baseMailboxAddress = toChecksumAddress(
        "0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D",
      );
      const sharedTxHash =
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

      const indexer = createTestIndexer();
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [mailboxEvent("ProcessId", sharedTxHash, messageId)],
          },
        },
      });
      await indexer.process({
        chains: {
          [chainId2]: {
            simulate: [
              mailboxEvent(
                "ProcessId",
                sharedTxHash,
                messageId,
                1,
                baseMailboxAddress,
              ),
            ],
          },
        },
      });

      const rows = await indexer.TxProcessIdRegistry.getAll();
      expect(rows.map((r) => [r.id, r.chainId]).sort()).toEqual([
        [`${chainId}-${sharedTxHash}`, chainId],
        [`${chainId2}-${sharedTxHash}`, chainId2],
      ]);
    });
  });

  describe("ProcessId event - SuperSwap destination leg", () => {
    const sourceChainId = 10 as const; // Optimism
    const destinationChainId = 252 as const; // Fraxtal
    // Each chain runs its own Mailbox deployment; an event only routes to a
    // contract when its source address is one configured for that chain.
    const destinationMailboxAddress = toChecksumAddress(
      "0x2f9DB5616fa3fAd1aB06cB2C906830BA63d135e3",
    );
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

    const processId = mailboxEvent(
      "ProcessId",
      destinationTransactionHash,
      testMessageId,
      0,
      destinationMailboxAddress,
    );

    it("writes the destination leg from the destination chain's rows alone, when the transaction's oUSDT swap is recorded", async () => {
      const indexer = createTestIndexer();

      // The origin chain's rows: never read from the destination, and no
      // longer consumed by a stitching step.
      await seedDispatchedMessage(
        indexer,
        sourceChainId,
        sourceTransactionHash,
        testMessageId,
      );
      indexer.OUSDTBridgedTransaction.set({
        id: sourceTransactionHash,
        chainId: sourceChainId,
        transactionHash: sourceTransactionHash,
        originChainId: BigInt(sourceChainId),
        destinationChainId: BigInt(destinationChainId),
        sender: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        recipient: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        amount: oUSDTAmount,
      });
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
      await seedOUSDTSwap(indexer, sourceSwap, sourceChainId);

      // The destination transaction's oUSDT swap (oUSDT -> tokenOut).
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
      await seedOUSDTSwap(indexer, destinationSwap, destinationChainId);

      await indexer.process({
        chains: { [destinationChainId]: { simulate: [processId] } },
      });

      expect(
        await indexer.SuperSwapDestinationLeg.get(
          SuperSwapLegId(destinationChainId, testMessageId),
        ),
      ).toEqual({
        id: `${destinationChainId}-${testMessageId}`,
        chainId: destinationChainId,
        messageId: testMessageId,
        transactionHash: destinationTransactionHash,
        destinationChainToken: tokenOutAddress,
        destinationChainTokenAmountSwapped: 950n,
        timestamp: new Date(blockTimestamp * 1000),
      });
      // The origin leg is the origin's CrossChainSwap's to write.
      expect(await indexer.SuperSwapOriginLeg.getAll()).toEqual([]);
      // The origin's staging rows stay where they are.
      expect(
        (await indexer.TxDispatchIdRegistry.get(sourceTransactionHash))
          ?.messageIds,
      ).toEqual([testMessageId]);
    });

    it("records the message but writes no leg while the transaction has no oUSDT swap", async () => {
      const indexer = createTestIndexer();

      await indexer.process({
        chains: { [destinationChainId]: { simulate: [processId] } },
      });

      expect(
        (
          await indexer.TxProcessIdRegistry.get(
            TxProcessIdRegistryId(
              destinationChainId,
              destinationTransactionHash,
            ),
          )
        )?.messageIds,
      ).toEqual([testMessageId]);
      expect(await indexer.SuperSwapDestinationLeg.getAll()).toEqual([]);
    });
  });
});
