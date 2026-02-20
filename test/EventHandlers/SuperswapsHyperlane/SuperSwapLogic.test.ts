import type {
  DispatchId_event,
  OUSDTBridgedTransaction,
  OUSDTSwaps,
  ProcessId_event,
  SuperSwap,
} from "generated";
import {
  MailboxMessageId,
  OUSDTSwapsId,
  SuperSwapId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  attemptSuperSwapCreationFromProcessId,
  buildMessageIdToProcessIdMap,
  createSuperSwapEntity,
  findDestinationSwapWithOUSDT,
  findSourceSwapWithOUSDT,
  loadDestinationSwaps,
  processCrossChainSwap,
} from "../../../src/EventHandlers/SuperswapsHyperlane/SuperSwapLogic";

describe("SuperSwapLogic", () => {
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
  const senderAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const recipientAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const tokenInAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const tokenOutAddress = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  const oUSDTAddress = toChecksumAddress(
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
  ); // oUSDT
  const oUSDTAmount = 18116811000000000000n; // 18.116811 oUSDT
  const opTokenAddress = toChecksumAddress(
    "0x4200000000000000000000000000000000000042",
  ); // OP
  const wethTokenAddress = toChecksumAddress(
    "0x4200000000000000000000000000000000000006",
  ); // WETH (e.g. Mode)

  const mockBridgedTransaction: OUSDTBridgedTransaction = {
    id: transactionHash,
    transactionHash: transactionHash,
    originChainId: BigInt(chainId),
    destinationChainId: destinationDomain,
    sender: senderAddress.toLowerCase(),
    recipient: recipientAddress.toLowerCase(),
    amount: oUSDTAmount,
  };

  function createDispatchIdEvent(
    txHash: string,
    chainIdNum: number,
    messageId: string,
  ): DispatchId_event {
    return {
      id: MailboxMessageId(txHash, chainIdNum, messageId),
      chainId: chainIdNum,
      transactionHash: txHash,
      messageId,
    };
  }

  function createProcessIdEvent(
    txHash: string,
    chainIdNum: number,
    messageId: string,
  ): ProcessId_event {
    return {
      id: MailboxMessageId(txHash, chainIdNum, messageId),
      chainId: chainIdNum,
      transactionHash: txHash,
      messageId,
    };
  }

  function createOUSDTSwap(
    txHash: string,
    chainIdNum: number,
    tokenIn: string,
    amountIn: bigint,
    tokenOut: string,
    amountOut: bigint,
  ): OUSDTSwaps {
    return {
      id: OUSDTSwapsId(
        txHash,
        chainIdNum,
        tokenIn,
        amountIn,
        tokenOut,
        amountOut,
      ),
      transactionHash: txHash,
      tokenInPool: tokenIn,
      tokenOutPool: tokenOut,
      amountIn,
      amountOut,
    };
  }

  const createMockContext = (
    processIdEvents: ProcessId_event[],
    swapEvents: OUSDTSwaps[],
  ) => {
    const processIdMap = new Map<string, ProcessId_event[]>();
    const swapMap = new Map<string, OUSDTSwaps[]>();
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
        // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
        getWhere: async (params: any) => {
          if (params.messageId?._eq)
            return processIdMap.get(params.messageId._eq) || [];
          return [];
        },
      },
      OUSDTSwaps: {
        // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
        getWhere: async (params: any) => {
          if (params.transactionHash?._eq)
            return swapMap.get(params.transactionHash._eq) || [];
          return [];
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
        createDispatchIdEvent(transactionHash, chainId, messageId1),
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
      ];

      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );
      const destinationSwap = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        oUSDTAddress,
        oUSDTAmount,
        tokenOutAddress,
        950n,
      );

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
      expect(superSwaps.size).toBe(1);

      // Find the SuperSwap by checking all entries (since ID includes swap-specific data)
      const superSwapEntries = Array.from(superSwaps.values()) as SuperSwap[];
      expect(superSwapEntries).toHaveLength(1);
      const superSwap = superSwapEntries[0];
      expect(superSwap).toBeDefined();
      expect(superSwap.originChainId).toBe(BigInt(chainId));
      expect(superSwap.destinationChainId).toBe(destinationDomain);
      expect(superSwap.sender).toBe(senderAddress.toLowerCase());
      expect(superSwap.recipient).toBe(recipientAddress.toLowerCase());
      expect(superSwap.oUSDTamount).toBe(oUSDTAmount);
      expect(superSwap.sourceChainToken).toBe(tokenInAddress);
      expect(superSwap.sourceChainTokenAmountSwapped).toBe(1000n);
      expect(superSwap.destinationChainToken).toBe(tokenOutAddress);
      expect(superSwap.destinationChainTokenAmountSwapped).toBe(950n);
      expect(superSwap.timestamp).toEqual(new Date(blockTimestamp * 1000));
    });

    it("should create single SuperSwap when multiple destination swaps exist but only one has oUSDT", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

      // Destination chain swaps: one with oUSDT, one without
      const destinationSwaps: OUSDTSwaps[] = [
        createOUSDTSwap(
          destinationTxHash,
          Number(destinationDomain),
          oUSDTAddress,
          oUSDTAmount,
          tokenOutAddress,
          950n,
        ),
        createOUSDTSwap(
          destinationTxHash,
          Number(destinationDomain),
          tokenOutAddress,
          500n,
          tokenInAddress,
          520n,
        ),
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
      expect(superSwaps.size).toBe(1);
    });

    it("should handle multiple DispatchId events with different ProcessId transactions", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
        createDispatchIdEvent(transactionHash, chainId, messageId2),
      ];

      const destinationTxHash2 =
        "0xbc775f8b651893e437547866d80e8dc8f525756291171e1bdd1331a97bd09e4a";

      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
        [
          createProcessIdEvent(
            destinationTxHash2,
            Number(destinationDomain),
            messageId2,
          ),
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

      // Destination chain swaps: only first transaction has oUSDT swap
      const swapEvents: OUSDTSwaps[] = [
        createOUSDTSwap(
          destinationTxHash,
          Number(destinationDomain),
          oUSDTAddress,
          oUSDTAmount,
          tokenOutAddress,
          950n,
        ),
        createOUSDTSwap(
          destinationTxHash2,
          Number(destinationDomain),
          tokenInAddress,
          2000n,
          tokenOutAddress,
          1900n,
        ),
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
      expect(superSwaps.size).toBe(1);
    });

    it("should warn when ProcessId event is missing for a messageId", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
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
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const processIdWarning = warnings.find(
        (w: string) =>
          w.includes(messageId1) && w.includes("No ProcessId_event found"),
      );
      expect(processIdWarning).toBeDefined();

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).toBe(0);
    });

    it("should warn when OUSDTSwaps are missing for a transaction", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

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
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const swapWarning = warnings.find((w: string) =>
        w.includes("No destination chain swap with oUSDT found"),
      );
      expect(swapWarning).toBeDefined();

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).toBe(0);
    });

    it("should match ProcessId events by messageId field, not array index", async () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
        createDispatchIdEvent(transactionHash, chainId, messageId2),
      ];

      // ProcessId results in different order than source entities
      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId2,
          ),
        ],
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
      ];

      // Source chain swap: tokenIn -> oUSDT (on Optimism transaction)
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

      // Destination chain swap: oUSDT -> tokenOut (on Mode transaction)
      // Both messageIds point to same transaction, but only one swap with oUSDT
      const destinationSwap = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        oUSDTAddress,
        oUSDTAmount,
        tokenOutAddress,
        950n,
      );

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
      expect(superSwaps.size).toBe(1);
    });

    it("should create single SuperSwap for real-world (inspired) scenario: 3 DispatchIds, 2 destination transactions, only one has oUSDT swap", async () => {
      const thirdMessageId =
        "0xTHIRD_MESSAGE_ID_ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
      // Real scenario: Optimism -> Mode
      // On Optimism: 1 transaction with 3 DispatchId events and 1 swap (OP -> oUSDT)
      // On Mode: 2 transactions - one has 2 ProcessIds (no oUSDT swaps), other has 1 ProcessId (oUSDT -> WETH swap)
      // See the inspiration from this real world scenario on https://explorer.hyperlane.xyz/?search=0x619578b63a5e7961cf7768a60bcc519a71ec53e499e1ac50f92dd91dfa5dcca4&origin=optimism&destination=mode

      // 3 DispatchId events in the same transaction
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
        createDispatchIdEvent(transactionHash, chainId, messageId2),
        createDispatchIdEvent(transactionHash, chainId, thirdMessageId),
      ];

      const destinationTxHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      // ProcessId results: first 2 messageIds go to tx1 (no swaps), third goes to tx2 (has swap)
      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash1,
            Number(destinationDomain),
            messageId1,
          ),
        ],
        [
          createProcessIdEvent(
            destinationTxHash1,
            Number(destinationDomain),
            messageId2,
          ),
        ],
        [
          createProcessIdEvent(
            destinationTxHash2,
            Number(destinationDomain),
            thirdMessageId,
          ),
        ],
      ];

      // Source chain swap: OP -> oUSDT (on Optimism transaction)
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        opTokenAddress,
        1000000000000000000n,
        oUSDTAddress,
        18116811000000000000n,
      );

      // Destination chain swaps
      // Transaction 1: Has swaps but NO oUSDT swaps
      const destinationSwapsTx1: OUSDTSwaps[] = [
        createOUSDTSwap(
          destinationTxHash1,
          Number(destinationDomain),
          "0xTOKEN_A",
          500n,
          "0xTOKEN_B",
          600n,
        ),
      ];

      // Transaction 2: Has oUSDT -> WETH swap
      const destinationSwapsTx2: OUSDTSwaps[] = [
        createOUSDTSwap(
          destinationTxHash2,
          Number(destinationDomain),
          oUSDTAddress,
          18116811000000000000n,
          wethTokenAddress,
          950000000000000000n,
        ),
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
      expect(superSwaps.size).toBe(1);

      const superSwapEntries = Array.from(superSwaps.values()) as SuperSwap[];
      const superSwap = superSwapEntries[0];

      expect(superSwap).toBeDefined();
      expect(superSwap.originChainId).toBe(BigInt(chainId));
      expect(superSwap.destinationChainId).toBe(destinationDomain);
      expect(superSwap.sender).toBe(senderAddress.toLowerCase());
      expect(superSwap.recipient).toBe(recipientAddress.toLowerCase());
      expect(superSwap.oUSDTamount).toBe(oUSDTAmount);
      // Source chain token should be OP (the non-oUSDT token from source swap)
      expect(superSwap.sourceChainToken.toLowerCase()).toBe(
        opTokenAddress.toLowerCase(),
      );
      expect(superSwap.sourceChainTokenAmountSwapped).toBe(
        1000000000000000000n,
      );
      // Destination chain token should be WETH (the non-oUSDT token from destination swap)
      expect(superSwap.destinationChainToken.toLowerCase()).toBe(
        wethTokenAddress.toLowerCase(),
      );
      expect(superSwap.destinationChainTokenAmountSwapped).toBe(
        950000000000000000n,
      );
      expect(superSwap.timestamp).toEqual(new Date(blockTimestamp * 1000));
    });
  });

  describe("buildMessageIdToProcessIdMap", () => {
    it("should build map correctly when all messageIds have ProcessId events", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
        createDispatchIdEvent(transactionHash, chainId, messageId2),
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId2,
          ),
        ],
      ];

      const context = createMockContext([], []);

      const result = buildMessageIdToProcessIdMap(
        sourceChainMessageIdEntities,
        processIdResults,
        context,
      );

      // Verify map size
      expect(result.messageIdToProcessId.size).toBe(2);

      // Verify messageId1 maps to correct ProcessId_event
      const processId1 = result.messageIdToProcessId.get(messageId1);
      expect(processId1).toBeDefined();
      expect(processId1?.messageId).toBe(messageId1);
      expect(processId1?.transactionHash).toBe(destinationTxHash);
      expect(processId1?.chainId).toBe(Number(destinationDomain));
      expect(processId1?.id).toBe(
        MailboxMessageId(
          destinationTxHash,
          Number(destinationDomain),
          messageId1,
        ),
      );

      // Verify messageId2 maps to correct ProcessId_event
      const processId2 = result.messageIdToProcessId.get(messageId2);
      expect(processId2).toBeDefined();
      expect(processId2?.messageId).toBe(messageId2);
      expect(processId2?.transactionHash).toBe(destinationTxHash);
      expect(processId2?.chainId).toBe(Number(destinationDomain));
      expect(processId2?.id).toBe(
        MailboxMessageId(
          destinationTxHash,
          Number(destinationDomain),
          messageId2,
        ),
      );

      // Verify no unexpected messageIds in map
      expect(result.messageIdToProcessId.has(messageId1)).toBe(true);
      expect(result.messageIdToProcessId.has(messageId2)).toBe(true);
      expect(result.messageIdToProcessId.size).toBe(2);

      // Verify destination transaction hashes
      expect(result.destinationTransactionHashes.size).toBe(1);
      expect(result.destinationTransactionHashes.has(destinationTxHash)).toBe(
        true,
      );
      // Verify Set contains exactly the expected transaction hash
      expect(Array.from(result.destinationTransactionHashes)).toEqual([
        destinationTxHash,
      ]);

      // Verify no warnings were logged
      expect(context.getWarnings()).toHaveLength(0);
    });

    it("should warn when messageIds have no ProcessId events", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
        createDispatchIdEvent(transactionHash, chainId, messageId2),
      ];

      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
        [], // No ProcessId for messageId2
      ];

      const context = createMockContext([], []);

      const result = buildMessageIdToProcessIdMap(
        sourceChainMessageIdEntities,
        processIdResults,
        context,
      );

      expect(result.messageIdToProcessId.size).toBe(1);
      expect(result.messageIdToProcessId.has(messageId1)).toBe(true);
      expect(result.messageIdToProcessId.has(messageId2)).toBe(false);

      const warnings = context.getWarnings();
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const processIdWarning = warnings.find(
        (w: string) =>
          w.includes(messageId2) && w.includes("No ProcessId_event found"),
      );
      expect(processIdWarning).toBeDefined();
    });

    it("should collect unique destination transaction hashes", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
        createDispatchIdEvent(transactionHash, chainId, messageId2),
      ];

      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const processIdResults: ProcessId_event[][] = [
        [
          createProcessIdEvent(
            destinationTxHash,
            Number(destinationDomain),
            messageId1,
          ),
        ],
        [
          createProcessIdEvent(
            destinationTxHash2,
            Number(destinationDomain),
            messageId2,
          ),
        ],
      ];

      const context = createMockContext([], []);

      const result = buildMessageIdToProcessIdMap(
        sourceChainMessageIdEntities,
        processIdResults,
        context,
      );

      expect(result.destinationTransactionHashes.size).toBe(2);
      expect(result.destinationTransactionHashes.has(destinationTxHash)).toBe(
        true,
      );
      expect(result.destinationTransactionHashes.has(destinationTxHash2)).toBe(
        true,
      );
    });
  });

  describe("findSourceSwapWithOUSDT", () => {
    it("should find source swap when oUSDT is tokenOutPool", async () => {
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

      const context = createMockContext([], [sourceSwap]);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).not.toBeNull();
      expect(result?.sourceChainToken).toBe(tokenInAddress);
      expect(result?.sourceChainTokenAmountSwapped).toBe(1000n);
      expect(result?.swap).toEqual(sourceSwap);
    });

    it("should find source swap when oUSDT is tokenInPool", async () => {
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        oUSDTAddress,
        oUSDTAmount,
        tokenOutAddress,
        950n,
      );

      const context = createMockContext([], [sourceSwap]);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).not.toBeNull();
      expect(result?.sourceChainToken).toBe(tokenOutAddress);
      expect(result?.sourceChainTokenAmountSwapped).toBe(950n);
      expect(result?.swap).toEqual(sourceSwap);
    });

    it("should return null and warn when no source swap with oUSDT exists", async () => {
      // Since we only store oUSDT swaps, this test checks the safety verification
      // when a non-oUSDT swap somehow exists in the database
      const swapWithoutOUSDT = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        tokenOutAddress,
        950n,
      );

      const context = createMockContext([], [swapWithoutOUSDT]);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).toBeNull();
      const warnings = context.getWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Source swap does not involve oUSDT");
      expect(warnings[0]).toContain(transactionHash);
    });

    it("should return null when no swaps exist for transaction", async () => {
      const context = createMockContext([], []);

      const result = await findSourceSwapWithOUSDT(transactionHash, context);

      expect(result).toBeNull();
      const warnings = context.getWarnings();
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const sourceWarning = warnings.find((w: string) =>
        w.includes("No source chain swap with oUSDT found"),
      );
      expect(sourceWarning).toBeDefined();
    });
  });

  describe("loadDestinationSwaps", () => {
    it("should load destination swaps for multiple transaction hashes", async () => {
      const destinationTxHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const swap1 = createOUSDTSwap(
        destinationTxHash1,
        Number(destinationDomain),
        "0xTOKEN_A",
        100n,
        "0xTOKEN_B",
        200n,
      );

      const swap2 = createOUSDTSwap(
        destinationTxHash2,
        Number(destinationDomain),
        "0xTOKEN_C",
        300n,
        "0xTOKEN_D",
        400n,
      );

      const context = createMockContext([], [swap1, swap2]);
      const destinationTransactionHashes = new Set([
        destinationTxHash1,
        destinationTxHash2,
      ]);

      const result = await loadDestinationSwaps(
        destinationTransactionHashes,
        context,
      );

      expect(result.size).toBe(2);
      expect(result.get(destinationTxHash1)).toHaveLength(1);
      expect(result.get(destinationTxHash1)?.[0]).toEqual(swap1);
      expect(result.get(destinationTxHash2)).toHaveLength(1);
      expect(result.get(destinationTxHash2)?.[0]).toEqual(swap2);
    });

    it("should handle empty transaction hashes set", async () => {
      const context = createMockContext([], []);
      const destinationTransactionHashes = new Set<string>();

      const result = await loadDestinationSwaps(
        destinationTransactionHashes,
        context,
      );

      expect(result.size).toBe(0);
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

      expect(result.size).toBe(1);
      expect(result.get(destinationTxHash)).toHaveLength(0);
    });
  });

  describe("findDestinationSwapWithOUSDT", () => {
    it("should find destination swap when oUSDT is tokenInPool", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
      ];

      const processIdEvent = createProcessIdEvent(
        destinationTxHash,
        Number(destinationDomain),
        messageId1,
      );

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      const destinationSwap = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        oUSDTAddress,
        oUSDTAmount,
        tokenOutAddress,
        950n,
      );

      const transactionHashToSwaps = new Map<string, OUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash, [destinationSwap]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).not.toBeNull();
      expect(result?.destinationSwap).toEqual(destinationSwap);
      expect(result?.matchingMessageId).toBe(messageId1);
      expect(result?.destinationChainToken).toBe(tokenOutAddress);
      expect(result?.destinationChainTokenAmountSwapped).toBe(950n);
    });

    it("should find destination swap when oUSDT is tokenOutPool", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
      ];

      const processIdEvent = createProcessIdEvent(
        destinationTxHash,
        Number(destinationDomain),
        messageId1,
      );

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      const destinationSwap = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

      const transactionHashToSwaps = new Map<string, OUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash, [destinationSwap]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).not.toBeNull();
      expect(result?.destinationSwap).toEqual(destinationSwap);
      expect(result?.matchingMessageId).toBe(messageId1);
      expect(result?.destinationChainToken).toBe(tokenInAddress);
      expect(result?.destinationChainTokenAmountSwapped).toBe(1000n);
    });

    it("should find first swap with oUSDT when multiple oUSDT swaps exist", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
      ];

      const processIdEvent = createProcessIdEvent(
        destinationTxHash,
        Number(destinationDomain),
        messageId1,
      );

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      // Since we only store oUSDT swaps, all swaps in the array should be oUSDT swaps
      const swapWithOUSDT1 = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        oUSDTAddress,
        oUSDTAmount,
        tokenOutAddress,
        950n,
      );

      const swapWithOUSDT2 = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        tokenOutAddress,
        500n,
        oUSDTAddress,
        oUSDTAmount,
      );

      const transactionHashToSwaps = new Map<string, OUSDTSwaps[]>();
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
      expect(result).not.toBeNull();
      expect(result?.destinationSwap).toEqual(swapWithOUSDT1);
      expect(result?.matchingMessageId).toBe(messageId1);
    });

    it("should return null when no destination swap with oUSDT exists", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
      ];

      const processIdEvent = createProcessIdEvent(
        destinationTxHash,
        Number(destinationDomain),
        messageId1,
      );

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent);

      // Since we only store oUSDT swaps, this test checks the safety verification
      // when a non-oUSDT swap somehow exists in the database
      const swapWithoutOUSDT = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        "0xTOKEN_A",
        100n,
        "0xTOKEN_B",
        200n,
      );

      const transactionHashToSwaps = new Map<string, OUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash, [swapWithoutOUSDT]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).toBeNull();
      const warnings = context.getWarnings();
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const destinationWarning = warnings.find((w: string) =>
        w.includes("Destination swap does not involve oUSDT"),
      );
      expect(destinationWarning).toBeDefined();
    });

    it("should find swap from correct messageId when multiple messageIds exist", () => {
      const sourceChainMessageIdEntities: DispatchId_event[] = [
        createDispatchIdEvent(transactionHash, chainId, messageId1),
        createDispatchIdEvent(transactionHash, chainId, messageId2),
      ];

      const destinationTxHash1 =
        "0x1111111111111111111111111111111111111111111111111111111111111111";
      const destinationTxHash2 =
        "0x2222222222222222222222222222222222222222222222222222222222222222";

      const processIdEvent1 = createProcessIdEvent(
        destinationTxHash1,
        Number(destinationDomain),
        messageId1,
      );

      const processIdEvent2 = createProcessIdEvent(
        destinationTxHash2,
        Number(destinationDomain),
        messageId2,
      );

      const messageIdToProcessId = new Map<string, ProcessId_event>();
      messageIdToProcessId.set(messageId1, processIdEvent1);
      messageIdToProcessId.set(messageId2, processIdEvent2);

      // Only second transaction has oUSDT swap
      const swapWithoutOUSDT = createOUSDTSwap(
        destinationTxHash1,
        Number(destinationDomain),
        "0xTOKEN_A",
        100n,
        "0xTOKEN_B",
        200n,
      );

      const swapWithOUSDT = createOUSDTSwap(
        destinationTxHash2,
        Number(destinationDomain),
        oUSDTAddress,
        oUSDTAmount,
        tokenOutAddress,
        950n,
      );

      const transactionHashToSwaps = new Map<string, OUSDTSwaps[]>();
      transactionHashToSwaps.set(destinationTxHash1, [swapWithoutOUSDT]);
      transactionHashToSwaps.set(destinationTxHash2, [swapWithOUSDT]);

      const context = createMockContext([], []);

      const result = findDestinationSwapWithOUSDT(
        sourceChainMessageIdEntities,
        messageIdToProcessId,
        transactionHashToSwaps,
        context,
      );

      expect(result).not.toBeNull();
      expect(result?.destinationSwap).toEqual(swapWithOUSDT);
      expect(result?.matchingMessageId).toBe(messageId2);
    });
  });

  describe("createSuperSwapEntity", () => {
    it("should create SuperSwap entity with correct fields", async () => {
      const context = createMockContext([], []);

      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

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
      expect(superSwaps.size).toBe(1);

      // createSuperSwapEntity builds id from sourceSwap (tokenInPool, amountIn, tokenOutPool, amountOut)
      const expectedId = SuperSwapId(
        transactionHash,
        chainId,
        destinationDomain,
        oUSDTAmount,
        messageId1,
        sourceSwap.tokenInPool,
        sourceSwap.amountIn,
        sourceSwap.tokenOutPool,
        sourceSwap.amountOut,
      );
      const superSwap = superSwaps.get(expectedId);

      expect(superSwap).toBeDefined();
      expect(superSwap?.id).toBe(expectedId);
      expect(superSwap?.originChainId).toBe(BigInt(chainId));
      expect(superSwap?.destinationChainId).toBe(destinationDomain);
      expect(superSwap?.sender).toBe(senderAddress.toLowerCase());
      expect(superSwap?.recipient).toBe(recipientAddress.toLowerCase());
      expect(superSwap?.oUSDTamount).toBe(oUSDTAmount);
      expect(superSwap?.sourceChainToken).toBe(tokenInAddress);
      expect(superSwap?.sourceChainTokenAmountSwapped).toBe(1000n);
      expect(superSwap?.destinationChainToken).toBe(tokenOutAddress);
      expect(superSwap?.destinationChainTokenAmountSwapped).toBe(950n);
      expect(superSwap?.timestamp).toEqual(new Date(blockTimestamp * 1000));
    });

    it("should skip creation if SuperSwap already exists", async () => {
      const context = createMockContext([], []);

      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

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
      expect(superSwapsAfterFirst.size).toBe(1);

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
      expect(superSwapsAfterSecond.size).toBe(1);
    });
  });

  describe("attemptSuperSwapCreationFromProcessId", () => {
    const createExtendedMockContext = (
      dispatchIdEvents: DispatchId_event[],
      processIdEvents: ProcessId_event[],
      bridgedTransactions: OUSDTBridgedTransaction[],
      swapEvents: OUSDTSwaps[],
    ) => {
      const dispatchIdByMessageId = new Map<string, DispatchId_event[]>();
      const dispatchIdByTxHash = new Map<string, DispatchId_event[]>();
      const processIdMap = new Map<string, ProcessId_event[]>();
      const bridgedTxMap = new Map<string, OUSDTBridgedTransaction[]>();
      const swapMap = new Map<string, OUSDTSwaps[]>();
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
          // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
          getWhere: async (params: any) => {
            if (params.messageId?._eq)
              return dispatchIdByMessageId.get(params.messageId._eq) || [];
            if (params.transactionHash?._eq)
              return dispatchIdByTxHash.get(params.transactionHash._eq) || [];
            return [];
          },
        },
        ProcessId_event: {
          // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
          getWhere: async (params: any) => {
            if (params.messageId?._eq)
              return processIdMap.get(params.messageId._eq) || [];
            return [];
          },
        },
        OUSDTBridgedTransaction: {
          // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
          getWhere: async (params: any) => {
            if (params.transactionHash?._eq)
              return bridgedTxMap.get(params.transactionHash._eq) || [];
            return [];
          },
        },
        OUSDTSwaps: {
          // biome-ignore lint/suspicious/noExplicitAny: test mock context needs flexibility
          getWhere: async (params: any) => {
            if (params.transactionHash?._eq)
              return swapMap.get(params.transactionHash._eq) || [];
            return [];
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
      const dispatchIdEvent = createDispatchIdEvent(
        transactionHash,
        chainId,
        messageId1,
      );

      const processIdEvent = createProcessIdEvent(
        destinationTxHash,
        Number(destinationDomain),
        messageId1,
      );

      // Source chain swap: tokenIn -> oUSDT
      const sourceSwap = createOUSDTSwap(
        transactionHash,
        chainId,
        tokenInAddress,
        1000n,
        oUSDTAddress,
        oUSDTAmount,
      );

      // Destination chain swap: oUSDT -> tokenOut
      const destinationSwap = createOUSDTSwap(
        destinationTxHash,
        Number(destinationDomain),
        oUSDTAddress,
        oUSDTAmount,
        tokenOutAddress,
        950n,
      );

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
      expect(superSwaps.size).toBe(1);

      const superSwap = Array.from(superSwaps.values())[0] as SuperSwap;
      expect(superSwap).toBeDefined();
      expect(superSwap.originChainId).toBe(BigInt(chainId));
      expect(superSwap.destinationChainId).toBe(destinationDomain);
      expect(superSwap.oUSDTamount).toBe(oUSDTAmount);
      expect(superSwap.sourceChainToken).toBe(tokenInAddress);
      expect(superSwap.destinationChainToken).toBe(tokenOutAddress);
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
      expect(superSwaps.size).toBe(0);

      const infos = context.getInfos();
      expect(infos).toHaveLength(1);
      expect(infos[0]).toContain("No matching DispatchId found for messageId");
      expect(infos[0]).toContain(
        "This is expected if source chain hasn't synced yet",
      );
    });

    it("should return early and log warn when no OUSDTBridgedTransaction is found", async () => {
      const dispatchIdEvent = createDispatchIdEvent(
        transactionHash,
        chainId,
        messageId1,
      );

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
      expect(superSwaps.size).toBe(0);

      const warnings = context.getWarnings();
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const bridgedWarning = warnings.find((w: string) =>
        w.includes("No OUSDTBridgedTransaction found for transaction"),
      );
      expect(bridgedWarning).toBeDefined();
    });

    it("should return early and log warn when no DispatchId_event entities found for transaction", async () => {
      const dispatchIdEvent = createDispatchIdEvent(
        transactionHash,
        chainId,
        messageId1,
      );

      const context = createExtendedMockContext(
        [dispatchIdEvent], // Only the one found by messageId
        [],
        [mockBridgedTransaction],
        [],
      );

      // Mock the getWhere to return dispatch event for messageId but empty for transactionHash query
      const originalGetWhere = context.DispatchId_event.getWhere;
      // biome-ignore lint/suspicious/noExplicitAny: test mock override needs flexibility
      context.DispatchId_event.getWhere = async (params: any) => {
        if (params.messageId?._eq) return originalGetWhere(params);
        if (params.transactionHash?._eq) return [];
        return [];
      };

      await attemptSuperSwapCreationFromProcessId(
        messageId1,
        blockTimestamp,
        context,
      );

      const superSwaps = context.getSuperSwaps();
      expect(superSwaps.size).toBe(0);

      const warnings = context.getWarnings();
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const dispatchWarning = warnings.find((w: string) =>
        w.includes("No DispatchId_event entities found for transaction"),
      );
      expect(dispatchWarning).toBeDefined();

      // Restore original
      context.DispatchId_event.getWhere = originalGetWhere;
    });

    it("should handle errors gracefully and log warning", async () => {
      const dispatchIdEvent = createDispatchIdEvent(
        transactionHash,
        chainId,
        messageId1,
      );

      const processIdEvent = createProcessIdEvent(
        destinationTxHash,
        Number(destinationDomain),
        messageId1,
      );

      // Create a context that will throw an error when querying OUSDTSwaps
      const context = createExtendedMockContext(
        [dispatchIdEvent],
        [processIdEvent],
        [mockBridgedTransaction],
        [],
      );

      // Override OUSDTSwaps getWhere to throw an error
      const originalGetWhere = context.OUSDTSwaps.getWhere;
      context.OUSDTSwaps.getWhere = async () => {
        throw new Error("Database connection failed");
      };

      await attemptSuperSwapCreationFromProcessId(
        messageId1,
        blockTimestamp,
        context,
      );

      const warnings = context.getWarnings();
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(
        warnings.some((w: string) =>
          w.includes(
            "Error attempting to create SuperSwap from ProcessId handler",
          ),
        ),
      ).toBe(true);

      // Restore original
      context.OUSDTSwaps.getWhere = originalGetWhere;
    });
  });
});
