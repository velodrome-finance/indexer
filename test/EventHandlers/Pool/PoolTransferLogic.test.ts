import type {
  LiquidityPoolAggregator,
  Pool_Transfer_event,
  UserStatsPerPool,
  handlerContext,
} from "generated";
import { ZERO_ADDRESS } from "../../../src/Constants";
import {
  processPoolTransfer,
  storeTransferForMatching,
  updatePoolTotalSupply,
  updateUserLpBalances,
} from "../../../src/EventHandlers/Pool/PoolTransferLogic";
import { setupCommon } from "./common";

describe("PoolTransferLogic", () => {
  const commonData = setupCommon();
  const { mockLiquidityPoolData } = commonData;

  // Shared constants
  const CHAIN_ID = 10;
  const POOL_ADDRESS = mockLiquidityPoolData.poolAddress;
  const USER_ADDRESS = "0x1111111111111111111111111111111111111111";
  const RECIPIENT_ADDRESS = "0x2222222222222222222222222222222222222222";
  const TX_HASH =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const LP_VALUE = 500n * 10n ** 18n;
  const BLOCK_NUMBER = 123456;
  const TIMESTAMP = 1000000;
  const TIMESTAMP_DATE = new Date(TIMESTAMP * 1000);
  const LOG_INDEX = 1;

  // Shared mock context
  let mockContext: handlerContext;
  let mockLiquidityPoolAggregator: LiquidityPoolAggregator;
  let updateLiquidityPoolAggregatorSpy: jest.SpyInstance;
  let updateUserStatsPerPoolSpy: jest.SpyInstance;
  let loadOrCreateUserDataSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockLiquidityPoolAggregator = {
      ...mockLiquidityPoolData,
      totalLPTokenSupply: 1000n * 10n ** 18n,
    };

    mockContext = {
      log: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
      },
      LiquidityPoolAggregator: {
        get: jest.fn(),
        set: jest.fn(),
      },
      UserStatsPerPool: {
        get: jest.fn(),
        set: jest.fn(),
      },
      PoolTransferInTx: {
        set: jest.fn(),
      },
    } as unknown as handlerContext;

    // Set up spies with mocks
    const liquidityPoolAggregator = await import(
      "../../../src/Aggregators/LiquidityPoolAggregator"
    );
    const userStatsPerPool = await import(
      "../../../src/Aggregators/UserStatsPerPool"
    );

    updateLiquidityPoolAggregatorSpy = jest
      .spyOn(liquidityPoolAggregator, "updateLiquidityPoolAggregator")
      .mockResolvedValue(undefined);

    loadOrCreateUserDataSpy = jest
      .spyOn(userStatsPerPool, "loadOrCreateUserData")
      .mockResolvedValue({
        ...commonData.mockUserStatsPerPoolData,
      } as UserStatsPerPool);

    updateUserStatsPerPoolSpy = jest
      .spyOn(userStatsPerPool, "updateUserStatsPerPool")
      .mockImplementation(async () => {
        return commonData.mockUserStatsPerPoolData;
      });
  });

  afterEach(() => {
    updateLiquidityPoolAggregatorSpy.mockClear();
    updateUserStatsPerPoolSpy.mockClear();
    loadOrCreateUserDataSpy.mockClear();
  });

  // Helper to create mock Transfer event
  const createMockTransferEvent = (
    from: string,
    to: string,
    value: bigint,
    logIndex: number = LOG_INDEX,
  ): Pool_Transfer_event => ({
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
      from,
      to,
      value,
    },
  });

  describe("updatePoolTotalSupply", () => {
    it("should increment totalLPTokenSupply for mint transfers", async () => {
      await updatePoolTotalSupply(
        true, // isMint
        false, // isBurn
        LP_VALUE,
        mockLiquidityPoolAggregator,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );

      expect(updateLiquidityPoolAggregatorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalTotalLPSupply: LP_VALUE,
        }),
        mockLiquidityPoolAggregator,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );
    });

    it("should decrement totalLPTokenSupply for burn transfers", async () => {
      await updatePoolTotalSupply(
        false, // isMint
        true, // isBurn
        LP_VALUE,
        mockLiquidityPoolAggregator,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );

      expect(updateLiquidityPoolAggregatorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalTotalLPSupply: -LP_VALUE,
        }),
        mockLiquidityPoolAggregator,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );
    });

    it("should not update for regular transfers", async () => {
      await updatePoolTotalSupply(
        false, // isMint
        false, // isBurn
        LP_VALUE,
        mockLiquidityPoolAggregator,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );

      expect(updateLiquidityPoolAggregatorSpy).not.toHaveBeenCalled();
    });
  });

  describe("updateUserLpBalances", () => {
    it("should add LP balance to recipient for mint", async () => {
      await updateUserLpBalances(
        true, // isMint
        false, // isBurn
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: LP_VALUE,
        }),
        expect.anything(),
        mockContext,
      );
    });

    it("should subtract LP balance from sender for burn", async () => {
      await updateUserLpBalances(
        false, // isMint
        true, // isBurn
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: -LP_VALUE,
        }),
        expect.anything(),
        mockContext,
      );
    });

    it("should update both sender and recipient for regular transfers", async () => {
      await updateUserLpBalances(
        false, // isMint
        false, // isBurn
        USER_ADDRESS,
        RECIPIENT_ADDRESS,
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(2);
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: -LP_VALUE,
        }),
        expect.anything(),
        mockContext,
      );
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: LP_VALUE,
        }),
        expect.anything(),
        mockContext,
      );
    });

    it("should handle self-transfers (from === to) by updating only once with zero balance change", async () => {
      await updateUserLpBalances(
        false, // isMint
        false, // isBurn
        USER_ADDRESS,
        USER_ADDRESS, // Same address (self-transfer)
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      // Should only call loadOrCreateUserData once for self-transfer
      expect(loadOrCreateUserDataSpy).toHaveBeenCalledTimes(1);
      expect(loadOrCreateUserDataSpy).toHaveBeenCalledWith(
        USER_ADDRESS,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      // Should only call updateUserStatsPerPool once with zero balance change
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(1);
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: 0n,
          lastActivityTimestamp: TIMESTAMP_DATE,
        }),
        expect.anything(),
        mockContext,
      );
    });
  });

  describe("storeTransferForMatching", () => {
    it("should store mint transfers", () => {
      storeTransferForMatching(
        true, // isMint
        false, // isBurn
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
        BLOCK_NUMBER,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        TIMESTAMP_DATE,
        mockContext,
      );

      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `${CHAIN_ID}-${TX_HASH}-${POOL_ADDRESS}-${LOG_INDEX}`,
          chainId: CHAIN_ID,
          txHash: TX_HASH,
          pool: POOL_ADDRESS,
          logIndex: LOG_INDEX,
          from: ZERO_ADDRESS,
          to: USER_ADDRESS,
          value: LP_VALUE,
          isMint: true,
          isBurn: false,
          consumedByLogIndex: undefined,
        }),
      );
    });

    it("should store burn transfers", () => {
      storeTransferForMatching(
        false, // isMint
        true, // isBurn
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
        BLOCK_NUMBER,
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
        TIMESTAMP_DATE,
        mockContext,
      );

      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isMint: false,
          isBurn: true,
          from: USER_ADDRESS,
          to: ZERO_ADDRESS,
        }),
      );
    });

    it("should not store regular transfers", () => {
      storeTransferForMatching(
        false, // isMint
        false, // isBurn
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
        BLOCK_NUMBER,
        USER_ADDRESS,
        RECIPIENT_ADDRESS,
        LP_VALUE,
        TIMESTAMP_DATE,
        mockContext,
      );

      expect(mockContext.PoolTransferInTx.set).not.toHaveBeenCalled();
    });
  });

  describe("processPoolTransfer", () => {
    it("should process mint transfer and update totalLPTokenSupply, user balance, and store for matching", async () => {
      const event = createMockTransferEvent(
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
      );
      loadOrCreateUserDataSpy.mockResolvedValue({
        ...commonData.mockUserStatsPerPoolData,
        userAddress: USER_ADDRESS,
      } as UserStatsPerPool);

      await processPoolTransfer(
        event,
        mockLiquidityPoolAggregator,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateLiquidityPoolAggregatorSpy).toHaveBeenCalled();
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalled();
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalled();
    });

    it("should process burn transfer", async () => {
      const event = createMockTransferEvent(
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
      );
      loadOrCreateUserDataSpy.mockResolvedValue({
        ...commonData.mockUserStatsPerPoolData,
        userAddress: USER_ADDRESS,
      } as UserStatsPerPool);

      await processPoolTransfer(
        event,
        mockLiquidityPoolAggregator,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateLiquidityPoolAggregatorSpy).toHaveBeenCalled();
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalled();
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalled();
    });

    it("should process regular transfer without storing for matching", async () => {
      const event = createMockTransferEvent(
        USER_ADDRESS,
        RECIPIENT_ADDRESS,
        LP_VALUE,
      );

      await processPoolTransfer(
        event,
        mockLiquidityPoolAggregator,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(2); // Both sender and recipient
      expect(mockContext.PoolTransferInTx.set).not.toHaveBeenCalled();
    });
  });
});
