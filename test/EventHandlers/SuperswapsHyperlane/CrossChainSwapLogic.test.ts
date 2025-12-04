import { expect } from "chai";
import type {
  DispatchId_event,
  ProcessId_event,
  SuperSwap,
  oUSDTBridgedTransaction,
  oUSDTSwaps,
} from "../../../generated/src/Types.gen";
import {
  attemptSuperSwapCreationFromProcessId,
  buildMessageIdToProcessIdMap,
  createSuperSwapEntity,
  findDestinationSwapWithOUSDT,
  findSourceSwapWithOUSDT,
  loadDestinationSwaps,
  processCrossChainSwap,
} from "../../../src/EventHandlers/SuperswapsHyperlane/CrossChainSwapLogic";

describe("CrossChainSwapLogic", () => {
  const chainId = 10; // Optimism
  const destinationDomain = 3444334443n; // Mode Network
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const destinationTxHash =
    "0xdc34c918860806a2dafebad41e539cfe42f20253c0585358b91d31a11de41806";
  const messageId1 =
    "0xCCE7BDDCBF46218439FDAF78B99904EDCDF012B927E95EB053B8D01461C9DF9B";
  const messageId2 =
    "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
  const blockTimestamp = 1000000;
  const senderAddress = "0x1111111111111111111111111111111111111111";
  const recipientAddress = "0x2222222222222222222222222222222222222222";
  const tokenInAddress = "0x3333333333333333333333333333333333333333";
  const tokenOutAddress = "0x4444444444444444444444444444444444444444";
  const oUSDTAddress = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189"; // oUSDT
  const oUSDTAmount = 18116811000000000000n; // 18.116811 oUSDT

  const mockBridgedTransaction: oUSDTBridgedTransaction = {
    id: transactionHash,
    transactionHash: transactionHash,
    originChainId: BigInt(chainId),
    destinationChainId: destinationDomain,
    sender: senderAddress.toLowerCase(),
    recipient: recipientAddress.toLowerCase(),
    amount: oUSDTAmount,
  };

  const createMockContext = (
    processIdEvents: ProcessId_event[],
    swapEvents: oUSDTSwaps[],
  ) => {
    const processIdMap = new Map<string, ProcessId_event[]>();
    const swapMap = new Map<string, oUSDTSwaps[]>();
    const logWarnings: string[] = [];
    const superSwaps = new Map<string, SuperSwap>();

    // Group ProcessId events by messageId
    for (const event of processIdEvents) {
      const existing = processIdMap.get(event.messageId) || [];
      processIdMap.set(event.messageId, [...existing, event]);
    }

    // Group swap events by transactionHash
    for (const event of swapEvents) {
      const existing = swapMap.get(event.transactionHash) || [];
      swapMap.set(event.transactionHash, [...existing, event]);
    }

    return {
      ProcessId_event: {
        getWhere: {
          messageId: {
            eq: async (msgId: string) => processIdMap.get(msgId) || [],
          },
        },
      },
      oUSDTSwaps: {
        getWhere: {
          transactionHash: {
            eq: async (txHash: string) => swapMap.get(txHash) || [],
          },
        },
      },
      SuperSwap: {
        set: (entity: SuperSwap) => {
          superSwaps.set(entity.id, entity);
        },
        get: (id: string) => {
          return superSwaps.get(id);
        },
      },
      log: {
        warn: (message: string) => {
          logWarnings.push(message);
        },
        error: () => {},
        info: () => {},
        debug: () => {},
      },
      getWarnings: () => logWarnings,
      getSuperSwaps: () => superSwaps,
      // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
    } as any;
  };

  describe("processCrossChainSwap", () => {
    it("should create SuperSwap entities when all data is present", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      // Destination chain swap: oUSDT -> tokenOut (on Mode transaction)
      const destinationSwap: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: destinationTxHash,
        tokenInPool: oUSDTAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };

      const context = createMockContext(processIdResults.flat(), [
        sourceSwap,
        destinationSwap,
      ]);

      await processCrossChainSwap(
        sourceChainMessageIdEntities,
        processIdResults,
        mockBridgedTransaction,
        transactionHash,
        chainId,
        destinationDomain,
        blockTimestamp,
        context,
      );

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(1);

      // Find the SuperSwap by checking all entries (since ID includes swap-specific data)
      const superSwapEntries = Array.from(superSwaps.values()) as SuperSwap[];
      expect(superSwapEntries.length).to.equal(1);
      const superSwap = superSwapEntries[0];
      expect(superSwap).to.not.be.undefined;
      expect(superSwap.originChainId).to.equal(BigInt(chainId));
      expect(superSwap.destinationChainId).to.equal(destinationDomain);
      expect(superSwap.sender).to.equal(senderAddress.toLowerCase());
      expect(superSwap.recipient).to.equal(recipientAddress.toLowerCase());
      expect(superSwap.oUSDTamount).to.equal(oUSDTAmount);
      expect(superSwap.sourceChainToken).to.equal(tokenInAddress);
      expect(superSwap.sourceChainTokenAmountSwapped).to.equal(1000n);
      expect(superSwap.destinationChainToken).to.equal(tokenOutAddress);
      expect(superSwap.destinationChainTokenAmountSwapped).to.equal(950n);
      expect(superSwap.timestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should create single SuperSwap when multiple destination swaps exist but only one has oUSDT", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      // Destination chain swaps: one with oUSDT, one without
      const destinationSwaps: oUSDTSwaps[] = [
        {
          id: `${destinationTxHash}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
          transactionHash: destinationTxHash,
          tokenInPool: oUSDTAddress,
          tokenOutPool: tokenOutAddress,
          amountIn: oUSDTAmount,
          amountOut: 950n,
        },
        {
          id: `${destinationTxHash}_${destinationDomain}_${tokenOutAddress}_500_${tokenInAddress}_520`,
          transactionHash: destinationTxHash,
          tokenInPool: tokenOutAddress,
          tokenOutPool: tokenInAddress,
          amountIn: 500n,
          amountOut: 520n,
        },
      ];

      const context = createMockContext(processIdResults.flat(), [
        sourceSwap,
        ...destinationSwaps,
      ]);

      await processCrossChainSwap(
        sourceChainMessageIdEntities,
        processIdResults,
        mockBridgedTransaction,
        transactionHash,
        chainId,
        destinationDomain,
        blockTimestamp,
        context,
      );

      // Should create only 1 SuperSwap (the one with oUSDT)
      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(1);
    });

    it("should handle multiple DispatchId events with different ProcessId transactions", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId2}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId2,
        },
      ];

      const destinationTxHash2 =
        "0xbc775f8b651893e437547866d80e8dc8f525756291171e1bdd1331a97bd09e4a";

      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
        [
          {
            id: `${destinationTxHash2}_${destinationDomain}_${messageId2}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash2,
            messageId: messageId2,
          },
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      // Destination chain swaps: only first transaction has oUSDT swap
      const swapEvents: oUSDTSwaps[] = [
        {
          id: `${destinationTxHash}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
          transactionHash: destinationTxHash,
          tokenInPool: oUSDTAddress,
          tokenOutPool: tokenOutAddress,
          amountIn: oUSDTAmount,
          amountOut: 950n,
        },
        {
          id: `${destinationTxHash2}_${destinationDomain}_${tokenInAddress}_2000_${tokenOutAddress}_1900`,
          transactionHash: destinationTxHash2,
          tokenInPool: tokenInAddress,
          tokenOutPool: tokenOutAddress,
          amountIn: 2000n,
          amountOut: 1900n,
        },
      ];

      const context = createMockContext(processIdResults.flat(), [
        sourceSwap,
        ...swapEvents,
      ]);

      await processCrossChainSwap(
        sourceChainMessageIdEntities,
        processIdResults,
        mockBridgedTransaction,
        transactionHash,
        chainId,
        destinationDomain,
        blockTimestamp,
        context,
      );

      // Should create 1 SuperSwap (only for the messageId with oUSDT swap)
      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(1);
    });

    it("should warn when ProcessId event is missing for a messageId", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdResults: ProcessId_event[][] = [[]]; // Empty result

      const context = createMockContext([], []);

      await processCrossChainSwap(
        sourceChainMessageIdEntities,
        processIdResults,
        mockBridgedTransaction,
        transactionHash,
        chainId,
        destinationDomain,
        blockTimestamp,
        context,
      );

      const warnings = context.getWarnings();
      expect(warnings.length).to.be.greaterThan(0);
      expect(warnings[0]).to.include(messageId1);
      expect(warnings[0]).to.include("No ProcessId_event found");

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(0);
    });

    it("should warn when oUSDTSwaps are missing for a transaction", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      const context = createMockContext(processIdResults.flat(), [sourceSwap]); // No destination swaps

      await processCrossChainSwap(
        sourceChainMessageIdEntities,
        processIdResults,
        mockBridgedTransaction,
        transactionHash,
        chainId,
        destinationDomain,
        blockTimestamp,
        context,
      );

      const warnings = context.getWarnings();
      expect(warnings.length).to.be.greaterThan(0);
      const swapWarning = warnings.find((w: string) =>
        w.includes("No destination chain swap with oUSDT found"),
      );
      expect(swapWarning).to.not.be.undefined;

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(0);
    });

    it("should match ProcessId events by messageId field, not array index", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId2}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId2,
        },
      ];

      // ProcessId results in different order than source entities
      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId2}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId2, // Different order
          },
        ],
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      // Destination chain swap: oUSDT -> tokenOut (on Mode transaction)
      // Both messageIds point to same transaction, but only one swap with oUSDT
      const destinationSwap: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: destinationTxHash,
        tokenInPool: oUSDTAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };

      const context = createMockContext(processIdResults.flat(), [
        sourceSwap,
        destinationSwap,
      ]);

      await processCrossChainSwap(
        sourceChainMessageIdEntities,
        processIdResults,
        mockBridgedTransaction,
        transactionHash,
        chainId,
        destinationDomain,
        blockTimestamp,
        context,
      );

      // Should create 1 SuperSwap entity (only one has oUSDT swap)
      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(1);
    });

    it("should create single SuperSwap for real-world (inspired) scenario: 3 DispatchIds, 2 destination transactions, only one has oUSDT swap", async () => {
      // Real scenario: Optimism -> Mode
      // On Optimism: 1 transaction with 3 DispatchId events and 1 swap (OP -> oUSDT)
      // On Mode: 2 transactions - one has 2 ProcessIds (no oUSDT swaps), other has 1 ProcessId (oUSDT -> WETH swap)
      // See the inspiration from this real world scenario on https://explorer.hyperlane.xyz/?search=0x619578b63a5e7961cf7768a60bcc519a71ec53e499e1ac50f92dd91dfa5dcca4&origin=optimism&destination=mode

      const opTokenAddress = "0x4200000000000000000000000000000000000042"; // OP token
      const wethTokenAddress = "0x4200000000000000000000000000000000000006"; // WETH on Mode
      const oUSDTAddress = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189"; // oUSDT

      // 3 DispatchId events in the same transaction
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId2}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId2,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId1}`, // Using messageId1 again for third
          chainId: chainId,
          transactionHash: transactionHash,
          messageId:
            "0xTHIRD_MESSAGE_ID_ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
        },
      ];

      const destinationTxHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      // ProcessId results: first 2 messageIds go to tx1 (no swaps), third goes to tx2 (has swap)
      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash1}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash1,
            messageId: messageId1,
          },
        ],
        [
          {
            id: `${destinationTxHash1}_${destinationDomain}_${messageId2}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash1,
            messageId: messageId2,
          },
        ],
        [
          {
            id: `${destinationTxHash2}_${destinationDomain}_THIRD_MESSAGE_ID`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash2,
            messageId:
              "0xTHIRD_MESSAGE_ID_ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
          },
        ],
      ];

      // Source chain swap: OP -> oUSDT (on Optimism transaction)
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${opTokenAddress}_1000000000000000000_${oUSDTAddress}_18116811000000000000`,
        transactionHash: transactionHash,
        tokenInPool: opTokenAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000000000000000000n, // 1 OP
        amountOut: 18116811000000000000n, // oUSDT amount
      };

      // Destination chain swaps
      // Transaction 1: Has swaps but NO oUSDT swaps
      const destinationSwapsTx1: oUSDTSwaps[] = [
        {
          id: `${destinationTxHash1}_${destinationDomain}_TOKEN_A_500_TOKEN_B_600`,
          transactionHash: destinationTxHash1,
          tokenInPool: "0xTOKEN_A",
          tokenOutPool: "0xTOKEN_B",
          amountIn: 500n,
          amountOut: 600n,
        },
      ];

      // Transaction 2: Has oUSDT -> WETH swap
      const destinationSwapsTx2: oUSDTSwaps[] = [
        {
          id: `${destinationTxHash2}_${destinationDomain}_${oUSDTAddress}_18116811000000000000_${wethTokenAddress}_950000000000000000`,
          transactionHash: destinationTxHash2,
          tokenInPool: oUSDTAddress,
          tokenOutPool: wethTokenAddress,
          amountIn: 18116811000000000000n, // oUSDT in
          amountOut: 950000000000000000n, // WETH out
        },
      ];

      const context = createMockContext(processIdResults.flat(), [
        sourceSwap,
        ...destinationSwapsTx1,
        ...destinationSwapsTx2,
      ]);

      await processCrossChainSwap(
        sourceChainMessageIdEntities,
        processIdResults,
        mockBridgedTransaction,
        transactionHash,
        chainId,
        destinationDomain,
        blockTimestamp,
        context,
      );

      // Should create exactly 1 SuperSwap entity
      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(1);

      const superSwapEntries = Array.from(superSwaps.values()) as SuperSwap[];
      const superSwap = superSwapEntries[0];

      expect(superSwap).to.not.be.undefined;
      expect(superSwap.originChainId).to.equal(BigInt(chainId));
      expect(superSwap.destinationChainId).to.equal(destinationDomain);
      expect(superSwap.sender).to.equal(senderAddress.toLowerCase());
      expect(superSwap.recipient).to.equal(recipientAddress.toLowerCase());
      expect(superSwap.oUSDTamount).to.equal(oUSDTAmount);
      // Source chain token should be OP (the non-oUSDT token from source swap)
      expect(superSwap.sourceChainToken.toLowerCase()).to.equal(
        opTokenAddress.toLowerCase(),
      );
      expect(superSwap.sourceChainTokenAmountSwapped).to.equal(
        1000000000000000000n,
      );
      // Destination chain token should be WETH (the non-oUSDT token from destination swap)
      expect(superSwap.destinationChainToken.toLowerCase()).to.equal(
        wethTokenAddress.toLowerCase(),
      );
      expect(superSwap.destinationChainTokenAmountSwapped).to.equal(
        950000000000000000n,
      );
      expect(superSwap.timestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
    });
  });

  describe("buildMessageIdToProcessIdMap", () => {
    it("should build map correctly when all messageIds have ProcessId events", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId2}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId2,
        },
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId2}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId2,
          },
        ],
      ];

      const context = createMockContext([], []);

      const result = buildMessageIdToProcessIdMap(
        sourceChainMessageIdEntities,
        processIdResults,
        context,
      );

      // Verify map size
      expect(result.messageIdToProcessId.size).to.equal(2);

      // Verify messageId1 maps to correct ProcessId_event
      const processId1 = result.messageIdToProcessId.get(messageId1);
      expect(processId1).to.not.be.undefined;
      expect(processId1?.messageId).to.equal(messageId1);
      expect(processId1?.transactionHash).to.equal(destinationTxHash);
      expect(processId1?.chainId).to.equal(Number(destinationDomain));
      expect(processId1?.id).to.equal(
        `${destinationTxHash}_${destinationDomain}_${messageId1}`,
      );

      // Verify messageId2 maps to correct ProcessId_event
      const processId2 = result.messageIdToProcessId.get(messageId2);
      expect(processId2).to.not.be.undefined;
      expect(processId2?.messageId).to.equal(messageId2);
      expect(processId2?.transactionHash).to.equal(destinationTxHash);
      expect(processId2?.chainId).to.equal(Number(destinationDomain));
      expect(processId2?.id).to.equal(
        `${destinationTxHash}_${destinationDomain}_${messageId2}`,
      );

      // Verify no unexpected messageIds in map
      const allMessageIds = Array.from(result.messageIdToProcessId.keys());
      expect(allMessageIds).to.have.members([messageId1, messageId2]);

      // Verify destination transaction hashes
      expect(result.destinationTransactionHashes.size).to.equal(1);
      expect(result.destinationTransactionHashes.has(destinationTxHash)).to.be
        .true;
      // Verify Set contains exactly the expected transaction hash
      expect(Array.from(result.destinationTransactionHashes)).to.deep.equal([
        destinationTxHash,
      ]);

      // Verify no warnings were logged
      expect(context.getWarnings().length).to.equal(0);
    });

    it("should warn when messageIds have no ProcessId events", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId2}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId2,
        },
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
        [], // No ProcessId for messageId2
      ];

      const context = createMockContext([], []);

      const result = buildMessageIdToProcessIdMap(
        sourceChainMessageIdEntities,
        processIdResults,
        context,
      );

      expect(result.messageIdToProcessId.size).to.equal(1);
      expect(result.messageIdToProcessId.has(messageId1)).to.be.true;
      expect(result.messageIdToProcessId.has(messageId2)).to.be.false;

      const warnings = context.getWarnings();
      expect(warnings.length).to.equal(1);
      expect(warnings[0]).to.include(messageId2);
      expect(warnings[0]).to.include("No ProcessId_event found");
    });

    it("should collect unique destination transaction hashes", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId2}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId2,
        },
      ];

      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const processIdResults: ProcessId_event[][] = [
        [
          {
            id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash,
            messageId: messageId1,
          },
        ],
        [
          {
            id: `${destinationTxHash2}_${destinationDomain}_${messageId2}`,
            chainId: Number(destinationDomain),
            transactionHash: destinationTxHash2,
            messageId: messageId2,
          },
        ],
      ];

      const context = createMockContext([], []);

      const result = buildMessageIdToProcessIdMap(
        sourceChainMessageIdEntities,
        processIdResults,
        context,
      );

      expect(result.destinationTransactionHashes.size).to.equal(2);
      expect(result.destinationTransactionHashes.has(destinationTxHash)).to.be
        .true;
      expect(result.destinationTransactionHashes.has(destinationTxHash2)).to.be
        .true;
    });
  });

  describe("findSourceSwapWithOUSDT", () => {
    it("should find source swap when oUSDT is tokenOutPool", async () => {
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      const context = createMockContext([], [sourceSwap]);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).to.not.be.null;
      expect(result?.sourceChainToken).to.equal(tokenInAddress);
      expect(result?.sourceChainTokenAmountSwapped).to.equal(1000n);
      expect(result?.swap).to.deep.equal(sourceSwap);
    });

    it("should find source swap when oUSDT is tokenInPool", async () => {
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: transactionHash,
        tokenInPool: oUSDTAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };

      const context = createMockContext([], [sourceSwap]);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).to.not.be.null;
      expect(result?.sourceChainToken).to.equal(tokenOutAddress);
      expect(result?.sourceChainTokenAmountSwapped).to.equal(950n);
      expect(result?.swap).to.deep.equal(sourceSwap);
    });

    it("should return null and warn when no source swap with oUSDT exists", async () => {
      // Since we only store oUSDT swaps, this test checks the safety verification
      // when a non-oUSDT swap somehow exists in the database
      const swapWithoutOUSDT: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${tokenOutAddress}_950`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: 1000n,
        amountOut: 950n,
      };

      const context = createMockContext([], [swapWithoutOUSDT]);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).to.be.null;
      const warnings = context.getWarnings();
      expect(warnings.length).to.be.greaterThan(0);
      expect(warnings[0]).to.include("Source swap does not involve oUSDT");
      expect(warnings[0]).to.include(transactionHash);
    });

    it("should return null when no swaps exist for transaction", async () => {
      const context = createMockContext([], []);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).to.be.null;
      const warnings = context.getWarnings();
      expect(warnings.length).to.be.greaterThan(0);
      expect(warnings[0]).to.include("No source chain swap with oUSDT found");
    });
  });

  describe("loadDestinationSwaps", () => {
    it("should load destination swaps for multiple transaction hashes", async () => {
      const destinationTxHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const swap1: oUSDTSwaps = {
        id: `${destinationTxHash1}_${destinationDomain}_TOKEN_A_100_TOKEN_B_200`,
        transactionHash: destinationTxHash1,
        tokenInPool: "0xTOKEN_A",
        tokenOutPool: "0xTOKEN_B",
        amountIn: 100n,
        amountOut: 200n,
      };

      const swap2: oUSDTSwaps = {
        id: `${destinationTxHash2}_${destinationDomain}_TOKEN_C_300_TOKEN_D_400`,
        transactionHash: destinationTxHash2,
        tokenInPool: "0xTOKEN_C",
        tokenOutPool: "0xTOKEN_D",
        amountIn: 300n,
        amountOut: 400n,
      };

      const context = createMockContext([], [swap1, swap2]);
      const destinationTransactionHashes = new Set([
        destinationTxHash1,
        destinationTxHash2,
      ]);

      const result = await loadDestinationSwaps(
        destinationTransactionHashes,
        context,
      );

      expect(result.size).to.equal(2);
      expect(result.get(destinationTxHash1)?.length).to.equal(1);
      expect(result.get(destinationTxHash1)?.[0]).to.deep.equal(swap1);
      expect(result.get(destinationTxHash2)?.length).to.equal(1);
      expect(result.get(destinationTxHash2)?.[0]).to.deep.equal(swap2);
    });

    it("should handle empty transaction hashes set", async () => {
      const context = createMockContext([], []);
      const destinationTransactionHashes = new Set<string>();

      const result = await loadDestinationSwaps(
        destinationTransactionHashes,
        context,
      );

      expect(result.size).to.equal(0);
    });

    it("should handle transaction hashes with no swaps", async () => {
      const destinationTxHash =
        "0x3333333333333333333333333333333333333333333333333333333333333333";
      const context = createMockContext([], []);
      const destinationTransactionHashes = new Set([destinationTxHash]);

      const result = await loadDestinationSwaps(
        destinationTransactionHashes,
        context,
      );

      expect(result.size).to.equal(1);
      expect(result.get(destinationTxHash)?.length).to.equal(0);
    });
  });

  describe("findDestinationSwapWithOUSDT", () => {
    it("should find destination swap when oUSDT is tokenInPool", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdEvent: ProcessId_event = {
        id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId1,
      };

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      const destinationSwap: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: destinationTxHash,
        tokenInPool: oUSDTAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };

      const transactionHashToSwaps = new Map<string, oUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash, [destinationSwap]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).to.not.be.null;
      expect(result?.destinationSwap).to.deep.equal(destinationSwap);
      expect(result?.matchingMessageId).to.equal(messageId1);
      expect(result?.destinationChainToken).to.equal(tokenOutAddress);
      expect(result?.destinationChainTokenAmountSwapped).to.equal(950n);
    });

    it("should find destination swap when oUSDT is tokenOutPool", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdEvent: ProcessId_event = {
        id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId1,
      };

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      const destinationSwap: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: destinationTxHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      const transactionHashToSwaps = new Map<string, oUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash, [destinationSwap]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).to.not.be.null;
      expect(result?.destinationSwap).to.deep.equal(destinationSwap);
      expect(result?.matchingMessageId).to.equal(messageId1);
      expect(result?.destinationChainToken).to.equal(tokenInAddress);
      expect(result?.destinationChainTokenAmountSwapped).to.equal(1000n);
    });

    it("should find first swap with oUSDT when multiple oUSDT swaps exist", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdEvent: ProcessId_event = {
        id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId1,
      };

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      // Since we only store oUSDT swaps, all swaps in the array should be oUSDT swaps
      const swapWithOUSDT1: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: destinationTxHash,
        tokenInPool: oUSDTAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };

      const swapWithOUSDT2: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_${tokenOutAddress}_500_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: destinationTxHash,
        tokenInPool: tokenOutAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 500n,
        amountOut: oUSDTAmount,
      };

      const transactionHashToSwaps = new Map<string, oUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash, [
        swapWithOUSDT1,
        swapWithOUSDT2,
      ]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      // Should return the first swap (swapWithOUSDT1)
      expect(result).to.not.be.null;
      expect(result?.destinationSwap).to.deep.equal(swapWithOUSDT1);
      expect(result?.matchingMessageId).to.equal(messageId1);
    });

    it("should return null when no destination swap with oUSDT exists", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
      ];

      const processIdEvent: ProcessId_event = {
        id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId1,
      };

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      // Since we only store oUSDT swaps, this test checks the safety verification
      // when a non-oUSDT swap somehow exists in the database
      const swapWithoutOUSDT: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_TOKEN_A_100_TOKEN_B_200`,
        transactionHash: destinationTxHash,
        tokenInPool: "0xTOKEN_A",
        tokenOutPool: "0xTOKEN_B",
        amountIn: 100n,
        amountOut: 200n,
      };

      const transactionHashToSwaps = new Map<string, oUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash, [swapWithoutOUSDT]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).to.be.null;
      const warnings = context.getWarnings();
      expect(warnings.length).to.be.greaterThan(0);
      expect(warnings[0]).to.include("Destination swap does not involve oUSDT");
    });

    it("should find swap from correct messageId when multiple messageIds exist", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        {
          id: `${transactionHash}_${chainId}_${messageId1}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId1,
        },
        {
          id: `${transactionHash}_${chainId}_${messageId2}`,
          chainId: chainId,
          transactionHash: transactionHash,
          messageId: messageId2,
        },
      ];

      const destinationTxHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const processIdEvent1: ProcessId_event = {
        id: `${destinationTxHash1}_${destinationDomain}_${messageId1}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash1,
        messageId: messageId1,
      };

      const processIdEvent2: ProcessId_event = {
        id: `${destinationTxHash2}_${destinationDomain}_${messageId2}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash2,
        messageId: messageId2,
      };

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent1);
      messageIdToProcessId.set(messageId2, processIdEvent2);

      // Only second transaction has oUSDT swap
      const swapWithoutOUSDT: oUSDTSwaps = {
        id: `${destinationTxHash1}_${destinationDomain}_TOKEN_A_100_TOKEN_B_200`,
        transactionHash: destinationTxHash1,
        tokenInPool: "0xTOKEN_A",
        tokenOutPool: "0xTOKEN_B",
        amountIn: 100n,
        amountOut: 200n,
      };

      const swapWithOUSDT: oUSDTSwaps = {
        id: `${destinationTxHash2}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: destinationTxHash2,
        tokenInPool: oUSDTAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };

      const transactionHashToSwaps = new Map<string, oUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash1, [swapWithoutOUSDT]);
      transactionHashToSwaps.set(destinationTxHash2, [swapWithOUSDT]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).to.not.be.null;
      expect(result?.destinationSwap).to.deep.equal(swapWithOUSDT);
      expect(result?.matchingMessageId).to.equal(messageId2);
    });
  });

  describe("createSuperSwapEntity", () => {
    it("should create SuperSwap entity with correct fields", async () => {
      const context = createMockContext([], []);

      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      await createSuperSwapEntity(
        transactionHash,
        chainId,
        destinationDomain,
        mockBridgedTransaction,
        messageId1,
        sourceSwap,
        tokenInAddress,
        1000n,
        tokenOutAddress,
        950n,
        blockTimestamp,
        context,
      );

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(1);

      const expectedId = `${transactionHash}_${BigInt(chainId)}_${destinationDomain}_${oUSDTAmount}_${messageId1}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`;
      const superSwap = superSwaps.get(expectedId);

      expect(superSwap).to.not.be.undefined;
      expect(superSwap?.id).to.equal(expectedId);
      expect(superSwap?.originChainId).to.equal(BigInt(chainId));
      expect(superSwap?.destinationChainId).to.equal(destinationDomain);
      expect(superSwap?.sender).to.equal(senderAddress.toLowerCase());
      expect(superSwap?.recipient).to.equal(recipientAddress.toLowerCase());
      expect(superSwap?.oUSDTamount).to.equal(oUSDTAmount);
      expect(superSwap?.sourceChainToken).to.equal(tokenInAddress);
      expect(superSwap?.sourceChainTokenAmountSwapped).to.equal(1000n);
      expect(superSwap?.destinationChainToken).to.equal(tokenOutAddress);
      expect(superSwap?.destinationChainTokenAmountSwapped).to.equal(950n);
      expect(superSwap?.timestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should skip creation if SuperSwap already exists", async () => {
      const context = createMockContext([], []);

      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      // Create SuperSwap first time
      await createSuperSwapEntity(
        transactionHash,
        chainId,
        destinationDomain,
        mockBridgedTransaction,
        messageId1,
        sourceSwap,
        tokenInAddress,
        1000n,
        tokenOutAddress,
        950n,
        blockTimestamp,
        context,
      );

      const superSwapsAfterFirst = context.getSuperSwaps();
      expect(superSwapsAfterFirst.size).to.equal(1);

      // Try to create again - should skip
      await createSuperSwapEntity(
        transactionHash,
        chainId,
        destinationDomain,
        mockBridgedTransaction,
        messageId1,
        sourceSwap,
        tokenInAddress,
        1000n,
        tokenOutAddress,
        950n,
        blockTimestamp,
        context,
      );

      // Should still be only 1 entity (not duplicated)
      const superSwapsAfterSecond = context.getSuperSwaps();
      expect(superSwapsAfterSecond.size).to.equal(1);
    });
  });

  describe("attemptSuperSwapCreationFromProcessId", () => {
    const createExtendedMockContext = (
      dispatchIdEvents: DispatchId_event[],
      processIdEvents: ProcessId_event[],
      bridgedTransactions: oUSDTBridgedTransaction[],
      swapEvents: oUSDTSwaps[],
    ) => {
      const dispatchIdByMessageId = new Map<string, DispatchId_event[]>();
      const dispatchIdByTxHash = new Map<string, DispatchId_event[]>();
      const processIdMap = new Map<string, ProcessId_event[]>();
      const bridgedTxMap = new Map<string, oUSDTBridgedTransaction[]>();
      const swapMap = new Map<string, oUSDTSwaps[]>();
      const logWarnings: string[] = [];
      const logInfos: string[] = [];
      const superSwaps = new Map<string, SuperSwap>();

      // Group DispatchId events by messageId and transactionHash
      for (const event of dispatchIdEvents) {
        const existingByMsgId =
          dispatchIdByMessageId.get(event.messageId) || [];
        dispatchIdByMessageId.set(event.messageId, [...existingByMsgId, event]);

        const existingByTxHash =
          dispatchIdByTxHash.get(event.transactionHash) || [];
        dispatchIdByTxHash.set(event.transactionHash, [
          ...existingByTxHash,
          event,
        ]);
      }

      // Group ProcessId events by messageId
      for (const event of processIdEvents) {
        const existing = processIdMap.get(event.messageId) || [];
        processIdMap.set(event.messageId, [...existing, event]);
      }

      // Group bridged transactions by transactionHash
      for (const tx of bridgedTransactions) {
        const existing = bridgedTxMap.get(tx.transactionHash) || [];
        bridgedTxMap.set(tx.transactionHash, [...existing, tx]);
      }

      // Group swap events by transactionHash
      for (const event of swapEvents) {
        const existing = swapMap.get(event.transactionHash) || [];
        swapMap.set(event.transactionHash, [...existing, event]);
      }

      return {
        DispatchId_event: {
          getWhere: {
            messageId: {
              eq: async (msgId: string) =>
                dispatchIdByMessageId.get(msgId) || [],
            },
            transactionHash: {
              eq: async (txHash: string) =>
                dispatchIdByTxHash.get(txHash) || [],
            },
          },
        },
        ProcessId_event: {
          getWhere: {
            messageId: {
              eq: async (msgId: string) => processIdMap.get(msgId) || [],
            },
          },
        },
        oUSDTBridgedTransaction: {
          getWhere: {
            transactionHash: {
              eq: async (txHash: string) => bridgedTxMap.get(txHash) || [],
            },
          },
        },
        oUSDTSwaps: {
          getWhere: {
            transactionHash: {
              eq: async (txHash: string) => swapMap.get(txHash) || [],
            },
          },
        },
        SuperSwap: {
          set: (entity: SuperSwap) => {
            superSwaps.set(entity.id, entity);
          },
          get: (id: string) => {
            return superSwaps.get(id);
          },
        },
        log: {
          warn: (message: string) => {
            logWarnings.push(message);
          },
          info: (message: string) => {
            logInfos.push(message);
          },
          error: () => {},
          debug: () => {},
        },
        getWarnings: () => logWarnings,
        getInfos: () => logInfos,
        getSuperSwaps: () => superSwaps,
        // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
      } as any;
    };

    it("should create SuperSwap when all data is present", async () => {
      const dispatchIdEvent: DispatchId_event = {
        id: `${transactionHash}_${chainId}_${messageId1}`,
        chainId: chainId,
        transactionHash: transactionHash,
        messageId: messageId1,
      };

      const processIdEvent: ProcessId_event = {
        id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId1,
      };

      // Source chain swap: tokenIn -> oUSDT
      const sourceSwap: oUSDTSwaps = {
        id: `${transactionHash}_${chainId}_${tokenInAddress}_1000_${oUSDTAddress}_${oUSDTAmount}`,
        transactionHash: transactionHash,
        tokenInPool: tokenInAddress,
        tokenOutPool: oUSDTAddress,
        amountIn: 1000n,
        amountOut: oUSDTAmount,
      };

      // Destination chain swap: oUSDT -> tokenOut
      const destinationSwap: oUSDTSwaps = {
        id: `${destinationTxHash}_${destinationDomain}_${oUSDTAddress}_${oUSDTAmount}_${tokenOutAddress}_950`,
        transactionHash: destinationTxHash,
        tokenInPool: oUSDTAddress,
        tokenOutPool: tokenOutAddress,
        amountIn: oUSDTAmount,
        amountOut: 950n,
      };

      const context = createExtendedMockContext(
        [dispatchIdEvent],
        [processIdEvent],
        [mockBridgedTransaction],
        [sourceSwap, destinationSwap],
      );

      await attemptSuperSwapCreationFromProcessId(
        messageId1,
        blockTimestamp,
        context,
      );

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(1);

      const superSwap = Array.from(superSwaps.values())[0] as SuperSwap;
      expect(superSwap).to.not.be.undefined;
      expect(superSwap.originChainId).to.equal(BigInt(chainId));
      expect(superSwap.destinationChainId).to.equal(destinationDomain);
      expect(superSwap.oUSDTamount).to.equal(oUSDTAmount);
      expect(superSwap.sourceChainToken).to.equal(tokenInAddress);
      expect(superSwap.destinationChainToken).to.equal(tokenOutAddress);
    });

    it("should return early and log info when no DispatchId_event is found", async () => {
      const context = createExtendedMockContext(
        [], // No DispatchId events
        [],
        [],
        [],
      );

      await attemptSuperSwapCreationFromProcessId(
        messageId1,
        blockTimestamp,
        context,
      );

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(0);

      const infos = context.getInfos();
      expect(infos.length).to.equal(1);
      expect(infos[0]).to.include("No matching DispatchId found for messageId");
      expect(infos[0]).to.include(
        "This is expected if source chain hasn't synced yet",
      );
    });

    it("should return early and log warn when no oUSDTBridgedTransaction is found", async () => {
      const dispatchIdEvent: DispatchId_event = {
        id: `${transactionHash}_${chainId}_${messageId1}`,
        chainId: chainId,
        transactionHash: transactionHash,
        messageId: messageId1,
      };

      const context = createExtendedMockContext(
        [dispatchIdEvent],
        [],
        [], // No bridged transactions
        [],
      );

      await attemptSuperSwapCreationFromProcessId(
        messageId1,
        blockTimestamp,
        context,
      );

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(0);

      const warnings = context.getWarnings();
      expect(warnings.length).to.equal(1);
      expect(warnings[0]).to.include(
        "No oUSDTBridgedTransaction found for transaction",
      );
    });

    it("should return early and log warn when no DispatchId_event entities found for transaction", async () => {
      const dispatchIdEvent: DispatchId_event = {
        id: `${transactionHash}_${chainId}_${messageId1}`,
        chainId: chainId,
        transactionHash: transactionHash,
        messageId: messageId1,
      };

      const context = createExtendedMockContext(
        [dispatchIdEvent], // Only the one found by messageId
        [],
        [mockBridgedTransaction],
        [],
      );

      // Mock the transactionHash query to return empty (simulating no other DispatchId events for this transaction)
      const originalEq = context.DispatchId_event.getWhere.transactionHash.eq;
      context.DispatchId_event.getWhere.transactionHash.eq = async () => [];

      await attemptSuperSwapCreationFromProcessId(
        messageId1,
        blockTimestamp,
        context,
      );

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).to.equal(0);

      const warnings = context.getWarnings();
      expect(warnings.length).to.equal(1);
      expect(warnings[0]).to.include(
        "No DispatchId_event entities found for transaction",
      );

      // Restore original
      context.DispatchId_event.getWhere.transactionHash.eq = originalEq;
    });

    it("should handle errors gracefully and log warning", async () => {
      const dispatchIdEvent: DispatchId_event = {
        id: `${transactionHash}_${chainId}_${messageId1}`,
        chainId: chainId,
        transactionHash: transactionHash,
        messageId: messageId1,
      };

      const processIdEvent: ProcessId_event = {
        id: `${destinationTxHash}_${destinationDomain}_${messageId1}`,
        chainId: Number(destinationDomain),
        transactionHash: destinationTxHash,
        messageId: messageId1,
      };

      // Create a context that will throw an error when querying oUSDTSwaps
      const context = createExtendedMockContext(
        [dispatchIdEvent],
        [processIdEvent],
        [mockBridgedTransaction],
        [],
      );

      // Override oUSDTSwaps query to throw an error
      const originalEq = context.oUSDTSwaps.getWhere.transactionHash.eq;
      context.oUSDTSwaps.getWhere.transactionHash.eq = async () => {
        throw new Error("Database connection failed");
      };

      await attemptSuperSwapCreationFromProcessId(
        messageId1,
        blockTimestamp,
        context,
      );

      const warnings = context.getWarnings();
      expect(warnings.length).to.be.greaterThan(0);
      expect(
        warnings.some((w: string) =>
          w.includes(
            "Error attempting to create SuperSwap from ProcessId handler",
          ),
        ),
      ).to.be.true;

      // Restore original
      context.oUSDTSwaps.getWhere.transactionHash.eq = originalEq;
    });
  });
});
