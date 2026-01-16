import type {
  LiquidityPoolAggregator,
  PoolTransferInTx,
  Pool_Burn_event,
  Pool_Mint_event,
  Token,
  handlerContext,
} from "generated";
import { ZERO_ADDRESS } from "../../../src/Constants";
import {
  _extractRecipientAddress,
  _findClosestPrecedingTransfer,
  _findTransferAndAttribute,
  _getPrecedingTransfers,
  _getTransfersInTx,
  processPoolLiquidityEvent,
} from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import { setupCommon } from "./common";

describe("PoolBurnAndMintLogic", () => {
  const commonData = setupCommon();
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } = commonData;

  // Shared constants
  const CHAIN_ID = 10;
  const POOL_ADDRESS = mockLiquidityPoolData.id;
  const TX_HASH =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const USER_ADDRESS = "0x1111111111111111111111111111111111111111";
  const ROUTER_ADDRESS = "0x2222222222222222222222222222222222222222";
  const ADDRESS_ONE = "0x0000000000000000000000000000000000000001";
  const AMOUNT0 = 1000n * 10n ** 18n;
  const AMOUNT1 = 2000n * 10n ** 18n;
  const LP_VALUE = 500n * 10n ** 18n;
  const BLOCK_NUMBER = 123456;
  const TIMESTAMP = 1000000;
  const TIMESTAMP_DATE = new Date(TIMESTAMP * 1000);

  // Shared mock context
  let mockContext: handlerContext;
  let mockPoolTransferInTx: PoolTransferInTx[];

  beforeEach(() => {
    mockPoolTransferInTx = [];
    mockContext = {
      log: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
      },
      PoolTransferInTx: {
        getWhere: {
          txHash: {
            eq: jest.fn(async (txHash: string) => {
              return mockPoolTransferInTx.filter((t) => t.txHash === txHash);
            }),
          },
        },
        set: jest.fn(),
      },
      LiquidityPoolAggregator: {
        get: jest.fn(),
        set: jest.fn(),
      },
      UserStatsPerPool: {
        get: jest.fn(),
        set: jest.fn(),
      },
    } as unknown as handlerContext;
  });

  // Helper to create mock transfer
  const createMockTransfer = (
    logIndex: number,
    from: string,
    to: string,
    value: bigint,
    isMint: boolean,
    isBurn: boolean,
    consumedByLogIndex?: number,
  ): PoolTransferInTx => ({
    id: `${CHAIN_ID}-${TX_HASH}-${POOL_ADDRESS}-${logIndex}`,
    chainId: CHAIN_ID,
    txHash: TX_HASH,
    pool: POOL_ADDRESS,
    logIndex,
    blockNumber: BigInt(BLOCK_NUMBER),
    from,
    to,
    value,
    isMint,
    isBurn,
    consumedByLogIndex,
    timestamp: TIMESTAMP_DATE,
  });

  // Helper to create mock Mint event
  const createMockMintEvent = (logIndex: number): Pool_Mint_event => ({
    chainId: CHAIN_ID,
    block: {
      number: BLOCK_NUMBER,
      timestamp: TIMESTAMP,
      hash: "0xblock",
    },
    logIndex,
    srcAddress: POOL_ADDRESS,
    transaction: { hash: TX_HASH },
    params: {
      sender: ROUTER_ADDRESS,
      amount0: AMOUNT0,
      amount1: AMOUNT1,
    },
  });

  // Helper to create mock Burn event
  const createMockBurnEvent = (logIndex: number): Pool_Burn_event => ({
    chainId: CHAIN_ID,
    block: {
      number: BLOCK_NUMBER,
      timestamp: TIMESTAMP,
      hash: "0xblock",
    },
    logIndex,
    srcAddress: POOL_ADDRESS,
    transaction: { hash: TX_HASH },
    params: {
      sender: ROUTER_ADDRESS,
      to: USER_ADDRESS,
      amount0: AMOUNT0,
      amount1: AMOUNT1,
    },
  });

  describe("_getTransfersInTx", () => {
    it("should filter transfers by txHash, chainId, pool, and event type", async () => {
      mockPoolTransferInTx = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          USER_ADDRESS,
          ZERO_ADDRESS,
          LP_VALUE,
          false,
          true,
        ),
        createMockTransfer(
          3,
          ZERO_ADDRESS,
          ROUTER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = await _getTransfersInTx(
        TX_HASH,
        CHAIN_ID,
        POOL_ADDRESS,
        true, // isMint
        mockContext,
      );

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.isMint === true)).toBe(true);
      expect(result.every((t) => t.txHash === TX_HASH)).toBe(true);
      expect(result.every((t) => t.chainId === CHAIN_ID)).toBe(true);
      expect(result.every((t) => t.pool === POOL_ADDRESS)).toBe(true);
    });

    it("should filter burn transfers when isMint is false", async () => {
      mockPoolTransferInTx = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          USER_ADDRESS,
          ZERO_ADDRESS,
          LP_VALUE,
          false,
          true,
        ),
      ];

      const result = await _getTransfersInTx(
        TX_HASH,
        CHAIN_ID,
        POOL_ADDRESS,
        false, // isMint
        mockContext,
      );

      expect(result).toHaveLength(1);
      expect(result[0].isBurn).toBe(true);
    });

    it("should return empty array when no transfers match", async () => {
      mockPoolTransferInTx = [];

      const result = await _getTransfersInTx(
        TX_HASH,
        CHAIN_ID,
        POOL_ADDRESS,
        true,
        mockContext,
      );

      expect(result).toHaveLength(0);
    });

    it("should filter by different txHash", async () => {
      const otherTxHash =
        "0x9999999999999999999999999999999999999999999999999999999999999999";
      mockPoolTransferInTx = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        {
          ...createMockTransfer(
            2,
            ZERO_ADDRESS,
            USER_ADDRESS,
            LP_VALUE,
            true,
            false,
          ),
          txHash: otherTxHash,
        },
      ];

      const result = await _getTransfersInTx(
        TX_HASH,
        CHAIN_ID,
        POOL_ADDRESS,
        true,
        mockContext,
      );

      expect(result).toHaveLength(1);
      expect(result[0].txHash).toBe(TX_HASH);
    });
  });

  describe("_getPrecedingTransfers", () => {
    it("should filter transfers that precede the event logIndex", () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          5,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _getPrecedingTransfers(transfers, 3);

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.logIndex < 3)).toBe(true);
      expect(result[0].logIndex).toBe(1);
      expect(result[1].logIndex).toBe(2);
    });

    it("should exclude transfers with value 0", () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(2, ZERO_ADDRESS, USER_ADDRESS, 0n, true, false),
        createMockTransfer(
          3,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _getPrecedingTransfers(transfers, 4);

      expect(result).toHaveLength(2);
      expect(result.every((t) => t.value > 0n)).toBe(true);
    });

    it("should exclude already consumed transfers", () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
          5,
        ),
        createMockTransfer(
          3,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _getPrecedingTransfers(transfers, 4);

      expect(result).toHaveLength(2);
      expect(result.every((t) => !t.consumedByLogIndex)).toBe(true);
      expect(result[0].logIndex).toBe(1);
      expect(result[1].logIndex).toBe(3);
    });

    it("should handle null consumedByLogIndex", () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        {
          ...createMockTransfer(
            2,
            ZERO_ADDRESS,
            USER_ADDRESS,
            LP_VALUE,
            true,
            false,
          ),
          consumedByLogIndex: undefined,
        },
      ];

      const result = _getPrecedingTransfers(transfers, 3);

      expect(result).toHaveLength(2);
    });

    it("should return empty array when no transfers precede", () => {
      const transfers = [
        createMockTransfer(
          5,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          6,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _getPrecedingTransfers(transfers, 3);

      expect(result).toHaveLength(0);
    });
  });

  describe("_findClosestPrecedingTransfer", () => {
    it("should return transfer with largest logIndex", () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          3,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _findClosestPrecedingTransfer(transfers);

      expect(result.logIndex).toBe(3);
    });

    it("should handle single transfer", () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _findClosestPrecedingTransfer(transfers);

      expect(result.logIndex).toBe(1);
      expect(result.to).toBe(USER_ADDRESS);
    });

    it("should handle transfers in ascending order", () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          3,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _findClosestPrecedingTransfer(transfers);

      expect(result.logIndex).toBe(3);
    });

    it("should handle transfers in descending order", () => {
      const transfers = [
        createMockTransfer(
          3,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];

      const result = _findClosestPrecedingTransfer(transfers);

      expect(result.logIndex).toBe(3);
    });
  });

  describe("_extractRecipientAddress", () => {
    it("should extract 'to' address for mint events", () => {
      const transfer = createMockTransfer(
        1,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        true,
        false,
      );
      const precedingTransfers = [transfer];

      const result = _extractRecipientAddress(
        transfer,
        precedingTransfers,
        true,
      );

      expect(result.recipient).toBe(USER_ADDRESS);
      expect(result.matchedTransfer).toBe(transfer);
    });

    it("should extract 'from' address for burn events", () => {
      const transfer = createMockTransfer(
        1,
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
        false,
        true,
      );
      const precedingTransfers = [transfer];

      const result = _extractRecipientAddress(
        transfer,
        precedingTransfers,
        false,
      );

      expect(result.recipient).toBe(USER_ADDRESS);
      expect(result.matchedTransfer).toBe(transfer);
    });

    it("should skip address(1) for mints when another mint exists", () => {
      const addressOneTransfer = createMockTransfer(
        1,
        ZERO_ADDRESS,
        ADDRESS_ONE,
        LP_VALUE,
        true,
        false,
      );
      const userTransfer = createMockTransfer(
        2,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        true,
        false,
      );
      const precedingTransfers = [addressOneTransfer, userTransfer];

      const result = _extractRecipientAddress(
        addressOneTransfer,
        precedingTransfers,
        true,
      );

      expect(result.recipient).toBe(USER_ADDRESS);
      expect(result.matchedTransfer.logIndex).toBe(2);
      expect(result.matchedTransfer.to).toBe(USER_ADDRESS);
    });

    it("should use address(1) if it's the only mint", () => {
      const addressOneTransfer = createMockTransfer(
        1,
        ZERO_ADDRESS,
        ADDRESS_ONE,
        LP_VALUE,
        true,
        false,
      );
      const precedingTransfers = [addressOneTransfer];

      const result = _extractRecipientAddress(
        addressOneTransfer,
        precedingTransfers,
        true,
      );

      expect(result.recipient).toBe(ADDRESS_ONE);
      expect(result.matchedTransfer).toBe(addressOneTransfer);
    });

    it("should handle multiple address(1) transfers and pick user transfer", () => {
      const addressOneTransfer1 = createMockTransfer(
        1,
        ZERO_ADDRESS,
        ADDRESS_ONE,
        LP_VALUE,
        true,
        false,
      );
      const addressOneTransfer2 = createMockTransfer(
        2,
        ZERO_ADDRESS,
        ADDRESS_ONE,
        LP_VALUE,
        true,
        false,
      );
      const userTransfer = createMockTransfer(
        3,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        true,
        false,
      );
      const precedingTransfers = [
        addressOneTransfer1,
        addressOneTransfer2,
        userTransfer,
      ];

      const result = _extractRecipientAddress(
        addressOneTransfer2,
        precedingTransfers,
        true,
      );

      expect(result.recipient).toBe(USER_ADDRESS);
      expect(result.matchedTransfer.logIndex).toBe(3);
    });

    it("should handle address(1) with only address(1) transfers", () => {
      const addressOneTransfer1 = createMockTransfer(
        1,
        ZERO_ADDRESS,
        ADDRESS_ONE,
        LP_VALUE,
        true,
        false,
      );
      const addressOneTransfer2 = createMockTransfer(
        2,
        ZERO_ADDRESS,
        ADDRESS_ONE,
        LP_VALUE,
        true,
        false,
      );
      const precedingTransfers = [addressOneTransfer1, addressOneTransfer2];

      const result = _extractRecipientAddress(
        addressOneTransfer2,
        precedingTransfers,
        true,
      );

      expect(result.recipient).toBe(ADDRESS_ONE);
      expect(result.matchedTransfer.logIndex).toBe(2);
    });

    it("should handle reduce comparison when other transfers have different logIndex order", () => {
      // Test case to cover curr.logIndex > prev.logIndex ? curr : prev
      // This tests both branches of the ternary in the reduce function
      const addressOneTransfer = createMockTransfer(
        3,
        ZERO_ADDRESS,
        ADDRESS_ONE,
        LP_VALUE,
        true,
        false,
      );
      const userTransfer1 = createMockTransfer(
        1,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        true,
        false,
      );
      const userTransfer2 = createMockTransfer(
        5,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        true,
        false,
      );
      // Put transfers in order that will test both branches of the reduce comparison
      const precedingTransfers = [
        addressOneTransfer,
        userTransfer1,
        userTransfer2,
      ];

      const result = _extractRecipientAddress(
        addressOneTransfer,
        precedingTransfers,
        true,
      );

      // Should pick userTransfer2 (logIndex 5) as it has the highest logIndex
      expect(result.recipient).toBe(USER_ADDRESS);
      expect(result.matchedTransfer.logIndex).toBe(5);
      expect(result.matchedTransfer.to).toBe(USER_ADDRESS);
    });
  });

  describe("_findTransferAndAttribute", () => {
    it("should find matching mint transfer and calculate USD", async () => {
      const mintTransfer = createMockTransfer(
        1,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        true,
        false,
      );
      mockPoolTransferInTx = [mintTransfer];

      const event = createMockMintEvent(2);
      const result = await _findTransferAndAttribute(
        event,
        POOL_ADDRESS,
        CHAIN_ID,
        TX_HASH,
        2,
        true,
        mockToken0Data,
        mockToken1Data,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result?.recipient).toBe(USER_ADDRESS);
      expect(result?.totalLiquidityUSD).toBeGreaterThan(0n);
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          consumedByLogIndex: 2,
        }),
      );
    });

    it("should find matching burn transfer", async () => {
      const burnTransfer = createMockTransfer(
        1,
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
        false,
        true,
      );
      mockPoolTransferInTx = [burnTransfer];

      const event = createMockBurnEvent(2);
      const result = await _findTransferAndAttribute(
        event,
        POOL_ADDRESS,
        CHAIN_ID,
        TX_HASH,
        2,
        false,
        mockToken0Data,
        mockToken1Data,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result?.recipient).toBe(USER_ADDRESS);
    });

    it("should return undefined when no matching transfer found", async () => {
      mockPoolTransferInTx = [];

      const event = createMockMintEvent(2);
      const result = await _findTransferAndAttribute(
        event,
        POOL_ADDRESS,
        CHAIN_ID,
        TX_HASH,
        2,
        true,
        mockToken0Data,
        mockToken1Data,
        mockContext,
      );

      expect(result).toBeUndefined();
      expect(mockContext.log.warn).toHaveBeenCalled();
    });

    it("should handle multiple transfers and pick closest", async () => {
      const transfers = [
        createMockTransfer(
          1,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          3,
          ZERO_ADDRESS,
          ROUTER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
        createMockTransfer(
          2,
          ZERO_ADDRESS,
          USER_ADDRESS,
          LP_VALUE,
          true,
          false,
        ),
      ];
      mockPoolTransferInTx = transfers;

      const event = createMockMintEvent(4);
      const result = await _findTransferAndAttribute(
        event,
        POOL_ADDRESS,
        CHAIN_ID,
        TX_HASH,
        4,
        true,
        mockToken0Data,
        mockToken1Data,
        mockContext,
      );

      expect(result).toBeDefined();
      // Should pick logIndex 3 (closest preceding)
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          logIndex: 3,
        }),
      );
    });
  });

  describe("processPoolLiquidityEvent", () => {
    const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
      ...mockLiquidityPoolData,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should process mint event and update pool token prices", async () => {
      const mintTransfer = createMockTransfer(
        1,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        true,
        false,
      );
      mockPoolTransferInTx = [mintTransfer];

      const event = createMockMintEvent(2);
      await processPoolLiquidityEvent(
        event,
        mockLiquidityPoolAggregator,
        POOL_ADDRESS,
        CHAIN_ID,
        mockToken0Data,
        mockToken1Data,
        mockContext,
        TIMESTAMP_DATE,
        BLOCK_NUMBER,
        true,
      );

      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalled();
    });

    it("should process burn event and update pool token prices", async () => {
      const burnTransfer = createMockTransfer(
        1,
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
        false,
        true,
      );
      mockPoolTransferInTx = [burnTransfer];

      const event = createMockBurnEvent(2);
      await processPoolLiquidityEvent(
        event,
        mockLiquidityPoolAggregator,
        POOL_ADDRESS,
        CHAIN_ID,
        mockToken0Data,
        mockToken1Data,
        mockContext,
        TIMESTAMP_DATE,
        BLOCK_NUMBER,
        false,
      );

      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalled();
    });

    it("should skip user attribution when no transfer match found", async () => {
      mockPoolTransferInTx = [];

      const event = createMockMintEvent(2);
      await processPoolLiquidityEvent(
        event,
        mockLiquidityPoolAggregator,
        POOL_ADDRESS,
        CHAIN_ID,
        mockToken0Data,
        mockToken1Data,
        mockContext,
        TIMESTAMP_DATE,
        BLOCK_NUMBER,
        true,
      );

      expect(mockContext.log.warn).toHaveBeenCalled();
    });
  });
});
