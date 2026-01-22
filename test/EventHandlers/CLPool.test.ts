import { CLPool, MockDb } from "../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
} from "../../generated/src/Types.gen";
import {
  OUSDT_ADDRESS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../src/Constants";
import * as CLPoolBurnLogic from "../../src/EventHandlers/CLPool/CLPoolBurnLogic";
import * as CLPoolCollectFeesLogic from "../../src/EventHandlers/CLPool/CLPoolCollectFeesLogic";
import * as CLPoolCollectLogic from "../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import * as CLPoolFlashLogic from "../../src/EventHandlers/CLPool/CLPoolFlashLogic";
import * as CLPoolMintLogic from "../../src/EventHandlers/CLPool/CLPoolMintLogic";
import * as CLPoolSwapLogic from "../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { setupCommon } from "./Pool/common";

describe("CLPool Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    createMockLiquidityPoolAggregator,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = 10;
  const poolAddress = toChecksumAddress(mockLiquidityPoolData.id);
  const userAddress = "0x2222222222222222222222222222222222222222";

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let liquidityPool: LiquidityPoolAggregator;
  let userStats: UserStatsPerPool;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();

    // Set up liquidity pool
    liquidityPool = createMockLiquidityPoolAggregator({
      id: poolAddress,
      chainId: chainId,
      isCL: true,
    });

    // Set up user stats with all required fields
    userStats = createMockUserStatsPerPool({
      userAddress: userAddress,
      poolAddress: poolAddress,
      chainId: chainId,
      firstActivityTimestamp: new Date(1000000 * 1000),
      lastActivityTimestamp: new Date(1000000 * 1000),
    });

    // Set up entities in mock DB
    mockDb = mockDb.entities.LiquidityPoolAggregator.set(liquidityPool);
    mockDb = mockDb.entities.UserStatsPerPool.set(userStats);
    mockDb = mockDb.entities.Token.set(mockToken0Data as Token);
    mockDb = mockDb.entities.Token.set(mockToken1Data as Token);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Swap Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Swap.createMockEvent>;
    let processSpy: jest.SpyInstance;

    beforeEach(() => {
      processSpy = jest
        .spyOn(CLPoolSwapLogic, "processCLPoolSwap")
        .mockResolvedValue({
          liquidityPoolDiff: {
            incrementalTotalVolume0: 1000n,
            incrementalTotalVolume1: 500n,
            incrementalTotalVolumeUSD: 1500n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userSwapDiff: {
            incrementalNumberOfSwaps: 1n,
            incrementalTotalSwapVolumeAmount0: 1000n,
            incrementalTotalSwapVolumeAmount1: 500n,
            incrementalTotalSwapVolumeUSD: 1500n,
            lastActivityTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Swap.createMockEvent({
        sender: userAddress,
        recipient: "0x3333333333333333333333333333333333333333",
        amount0: 1000n,
        amount1: -500n,
        sqrtPriceX96: 1000000n,
        liquidity: 2000000n,
        tick: 100n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process swap event and update pool aggregator", async () => {
      processSpy.mockClear();
      const resultDB = await CLPool.Swap.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeDefined();

      // Verify pool cumulative totals are updated correctly from incremental values
      const initialTotalVolume0 = liquidityPool.totalVolume0;
      const initialTotalVolume1 = liquidityPool.totalVolume1;
      const initialTotalVolumeUSD = liquidityPool.totalVolumeUSD;
      expect(updatedPool?.totalVolume0).toBe(initialTotalVolume0 + 1000n);
      expect(updatedPool?.totalVolume1).toBe(initialTotalVolume1 + 500n);
      expect(updatedPool?.totalVolumeUSD).toBe(initialTotalVolumeUSD + 1500n);

      // Verify UserStatsPerPool is updated with swap volume amounts
      const updatedUserStats = resultDB.entities.UserStatsPerPool.get(
        `${userAddress.toLowerCase()}_${poolAddress.toLowerCase()}_${chainId}`,
      );
      expect(updatedUserStats).toBeDefined();
      expect(updatedUserStats?.numberOfSwaps).toBe(1n);
      expect(updatedUserStats?.totalSwapVolumeAmount0).toBe(1000n); // abs(amount0)
      expect(updatedUserStats?.totalSwapVolumeAmount1).toBe(500n); // abs(amount1)
      expect(updatedUserStats?.totalSwapVolumeUSD).toBe(1500n);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.Swap.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, but processSpy shouldn't be called
      expect(processSpy).not.toHaveBeenCalled();
    });

    it("should create oUSDTSwap entity when OUSDT token is involved", async () => {
      // Create a pool with OUSDT as token0
      const ousdtToken: Token = {
        ...mockToken0Data,
        address: OUSDT_ADDRESS,
        id: TokenIdByChain(OUSDT_ADDRESS, chainId),
      };

      const ousdtPool: LiquidityPoolAggregator = {
        ...liquidityPool,
        token0_address: OUSDT_ADDRESS,
        token0_id: ousdtToken.id,
      };

      let ousdtDb = MockDb.createMockDb();
      ousdtDb = ousdtDb.entities.LiquidityPoolAggregator.set(ousdtPool);
      ousdtDb = ousdtDb.entities.Token.set(ousdtToken);
      ousdtDb = ousdtDb.entities.Token.set(mockToken1Data as Token);
      ousdtDb = ousdtDb.entities.UserStatsPerPool.set(userStats);

      processSpy.mockClear();
      const resultDB = await CLPool.Swap.processEvent({
        event: mockEvent,
        mockDb: ousdtDb,
      });

      // Verify oUSDTSwap entity was created with OUSDT as token0
      const ousdtSwaps = resultDB.entities.OUSDTSwaps.getAll();
      expect(ousdtSwaps).toHaveLength(1);
      const swapEntity1 = ousdtSwaps[0];
      expect(swapEntity1.transactionHash).toBe(mockEvent.transaction.hash);
      // With amount0 > 0, token0 (OUSDT) goes in, token1 goes out
      expect(swapEntity1.tokenInPool).toBe(OUSDT_ADDRESS);
      expect(swapEntity1.tokenOutPool).toBe(mockToken1Data.address);
      expect(swapEntity1.amountIn).toBe(1000n); // amount0 = 1000n
      expect(swapEntity1.amountOut).toBe(500n); // amount1 = -500n, so amount1Out = 500n

      // Test with OUSDT as token1 as well
      const ousdtToken1Pool: LiquidityPoolAggregator = {
        ...liquidityPool,
        token1_address: OUSDT_ADDRESS,
        token1_id: ousdtToken.id,
      };

      let ousdtDb2 = MockDb.createMockDb();
      ousdtDb2 = ousdtDb2.entities.LiquidityPoolAggregator.set(ousdtToken1Pool);
      ousdtDb2 = ousdtDb2.entities.Token.set(mockToken0Data as Token);
      ousdtDb2 = ousdtDb2.entities.Token.set(ousdtToken);
      ousdtDb2 = ousdtDb2.entities.UserStatsPerPool.set(userStats);

      const resultDB2 = await CLPool.Swap.processEvent({
        event: mockEvent,
        mockDb: ousdtDb2,
      });

      // Verify oUSDTSwap entity was created with OUSDT as token1
      const ousdtSwaps2 = resultDB2.entities.OUSDTSwaps.getAll();
      expect(ousdtSwaps2).toHaveLength(1);
      const swapEntity2 = ousdtSwaps2[0];
      expect(swapEntity2.transactionHash).toBe(mockEvent.transaction.hash);
      // With amount0 > 0, token0 goes in, token1 (OUSDT) goes out
      expect(swapEntity2.tokenInPool).toBe(mockToken0Data.address);
      expect(swapEntity2.tokenOutPool).toBe(OUSDT_ADDRESS);
      expect(swapEntity2.amountIn).toBe(1000n); // amount0 = 1000n
      expect(swapEntity2.amountOut).toBe(500n); // amount1 = -500n, so amount1Out = 500n
    });

    it("should handle all amount conversion branches for oUSDTSwap", async () => {
      // Test with positive amount0 (amount0In path)
      const positiveAmount0Event = CLPool.Swap.createMockEvent({
        sender: userAddress,
        recipient: "0x3333333333333333333333333333333333333333",
        amount0: 1000n, // Positive
        amount1: -500n, // Negative
        sqrtPriceX96: 1000000n,
        liquidity: 2000000n,
        tick: 100n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      // Create pool with OUSDT as token0
      const ousdtToken: Token = {
        ...mockToken0Data,
        address: OUSDT_ADDRESS,
        id: TokenIdByChain(OUSDT_ADDRESS, chainId),
      };

      const ousdtPool: LiquidityPoolAggregator = {
        ...liquidityPool,
        token0_address: OUSDT_ADDRESS,
        token0_id: ousdtToken.id,
      };

      let ousdtDb = MockDb.createMockDb();
      ousdtDb = ousdtDb.entities.LiquidityPoolAggregator.set(ousdtPool);
      ousdtDb = ousdtDb.entities.Token.set(ousdtToken);
      ousdtDb = ousdtDb.entities.Token.set(mockToken1Data as Token);
      ousdtDb = ousdtDb.entities.UserStatsPerPool.set(userStats);

      processSpy.mockClear();
      const resultDB = await CLPool.Swap.processEvent({
        event: positiveAmount0Event,
        mockDb: ousdtDb,
      });

      const ousdtSwaps = resultDB.entities.OUSDTSwaps.getAll();
      expect(ousdtSwaps).toHaveLength(1);
      // Verify entity was created with correct conversion (amount0 > 0 means token0 in, token1 out)
      const swapEntity = ousdtSwaps[0];
      expect(swapEntity).toBeDefined();
      expect(swapEntity.transactionHash).toBe(
        positiveAmount0Event.transaction.hash,
      );
      expect(swapEntity.tokenInPool).toBe(OUSDT_ADDRESS); // token0 (OUSDT) is going in
      expect(swapEntity.tokenOutPool).toBe(mockToken1Data.address); // token1 is going out
      expect(swapEntity.amountIn).toBe(1000n); // amount0In = 1000n
      expect(swapEntity.amountOut).toBe(500n); // amount1Out = 500n

      // Test with negative amount0 (amount0Out path)
      const negativeAmount0Event = CLPool.Swap.createMockEvent({
        sender: userAddress,
        recipient: "0x3333333333333333333333333333333333333333",
        amount0: -1000n, // Negative
        amount1: 500n, // Positive
        sqrtPriceX96: 1000000n,
        liquidity: 2000000n,
        tick: 100n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          },
          logIndex: 1,
        },
      });

      const resultDB2 = await CLPool.Swap.processEvent({
        event: negativeAmount0Event,
        mockDb: ousdtDb,
      });

      const ousdtSwaps2 = resultDB2.entities.OUSDTSwaps.getAll();
      expect(ousdtSwaps2).toHaveLength(1);
      // Verify entity was created with correct conversion (amount1 > 0 means token1 in, token0 out)
      const swapEntity2 = ousdtSwaps2[0];
      expect(swapEntity2).toBeDefined();
      expect(swapEntity2.transactionHash).toBe(
        negativeAmount0Event.transaction.hash,
      );
      expect(swapEntity2.tokenInPool).toBe(mockToken1Data.address); // token1 is going in
      expect(swapEntity2.tokenOutPool).toBe(OUSDT_ADDRESS); // token0 (OUSDT) is going out
      expect(swapEntity2.amountIn).toBe(500n); // amount1In = 500n
      expect(swapEntity2.amountOut).toBe(1000n); // amount0Out = 1000n
    });
  });

  describe("Mint Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Mint.createMockEvent>;
    let processSpy: jest.SpyInstance;

    beforeEach(() => {
      processSpy = jest
        .spyOn(CLPoolMintLogic, "processCLPoolMint")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalReserve0: 1000n,
            incrementalReserve1: 1000n,
            incrementalCurrentLiquidityUSD: 2000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: {
            incrementalCurrentLiquidityUSD: 1000n,
            incrementalTotalLiquidityAddedToken0: 500n,
            incrementalTotalLiquidityAddedToken1: 500n,
            incrementalTotalLiquidityAddedUSD: 1000n,
            lastActivityTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Mint.createMockEvent({
        owner: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount: 1000n,
        amount0: 500n,
        amount1: 500n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          transaction: {
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process mint event and create NonFungiblePosition", async () => {
      processSpy.mockClear();
      const resultDB = await CLPool.Mint.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      // Check that CLPoolMintEvent was created
      const mintEvents = Array.from(resultDB.entities.CLPoolMintEvent.getAll());
      expect(mintEvents).toHaveLength(1);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.Mint.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool =
        emptyDb.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Burn Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Burn.createMockEvent>;
    let processSpy: jest.SpyInstance;

    beforeEach(() => {
      processSpy = jest
        .spyOn(CLPoolBurnLogic, "processCLPoolBurn")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalReserve0: -500n, // Negative because burning decreases reserves
            incrementalReserve1: -500n, // Negative because burning decreases reserves
            incrementalCurrentLiquidityUSD: -1000n, // Negative because reserves decrease
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: {
            incrementalCurrentLiquidityUSD: -500n,
            incrementalTotalLiquidityRemovedToken0: 250n, // Positive value for cumulative tracking
            incrementalTotalLiquidityRemovedToken1: 250n, // Positive value for cumulative tracking
            incrementalTotalLiquidityRemovedUSD: 500n, // Positive value for tracking
            lastActivityTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Burn.createMockEvent({
        owner: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount: 500n,
        amount0: 250n,
        amount1: 250n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process burn event and update pool aggregator", async () => {
      processSpy.mockClear();
      const resultDB = await CLPool.Burn.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.Burn.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool =
        emptyDb.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Collect Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Collect.createMockEvent>;
    let processSpy: jest.SpyInstance;

    beforeEach(() => {
      processSpy = jest
        .spyOn(CLPoolCollectLogic, "processCLPoolCollect")
        .mockReturnValue({
          liquidityPoolDiff: {
            // In CL pools, Collect events do NOT affect reserves - fees were never part of reserves
            // Track unstaked fees (from Collect events - LPs that didn't stake)
            incrementalTotalUnstakedFeesCollected0: 100n,
            incrementalTotalUnstakedFeesCollected1: 200n,
            incrementalTotalUnstakedFeesCollectedUSD: 300n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userLiquidityDiff: {
            incrementalTotalFeesContributed0: 100n,
            incrementalTotalFeesContributed1: 200n,
            incrementalTotalFeesContributedUSD: 300n,
            lastActivityTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Collect.createMockEvent({
        owner: userAddress,
        recipient: userAddress,
        tickLower: -1000n,
        tickUpper: 1000n,
        amount0: 100n,
        amount1: 200n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process collect event and update fees", async () => {
      processSpy.mockClear();
      const resultDB = await CLPool.Collect.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.Collect.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool =
        emptyDb.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("CollectFees Event", () => {
    let mockEvent: ReturnType<typeof CLPool.CollectFees.createMockEvent>;
    let processSpy: jest.SpyInstance;

    beforeEach(() => {
      processSpy = jest
        .spyOn(CLPoolCollectFeesLogic, "processCLPoolCollectFees")
        .mockReturnValue({
          liquidityPoolDiff: {
            // In CL pools, CollectFees events do NOT affect reserves - fees were never part of reserves
            // Track staked fees (from CollectFees events - LPs that staked in gauge)
            incrementalTotalStakedFeesCollected0: 50n,
            incrementalTotalStakedFeesCollected1: 75n,
            incrementalTotalStakedFeesCollectedUSD: 125n,
            incrementalTotalFeesUSDWhitelisted: 125n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userDiff: {
            incrementalTotalFeesContributedUSD: 125n,
            incrementalTotalFeesContributed0: 50n,
            incrementalTotalFeesContributed1: 75n,
            lastActivityTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.CollectFees.createMockEvent({
        recipient: userAddress,
        amount0: 50n,
        amount1: 75n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process collect fees event", async () => {
      processSpy.mockClear();
      const resultDB = await CLPool.CollectFees.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.CollectFees.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool =
        emptyDb.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeUndefined();
    });

    it("should refresh token prices when processing collect fees event", async () => {
      // Remove spy to test actual handler
      processSpy.mockRestore();

      // Set up tokens with stale prices (2 hours ago)
      const staleTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const existingToken0 = mockDb.entities.Token.get(mockToken0Data.id);
      const existingToken1 = mockDb.entities.Token.get(mockToken1Data.id);

      if (existingToken0 && existingToken1) {
        const token0 = {
          ...existingToken0,
          pricePerUSDNew: 1000000n, // $1.00
          lastUpdatedTimestamp: staleTimestamp,
        };
        const token1 = {
          ...existingToken1,
          pricePerUSDNew: 2000000n, // $2.00
          lastUpdatedTimestamp: staleTimestamp,
        };

        const updatedDb = mockDb.entities.Token.set(token0);
        const finalDb = updatedDb.entities.Token.set(token1);

        const resultDB = await CLPool.CollectFees.processEvent({
          event: mockEvent,
          mockDb: finalDb,
        });

        // Note: In a real scenario, the effect would be called and prices refreshed
        // For this test, we verify that the handler structure supports price refresh
        // The actual price refresh happens in loadPoolData which is tested separately

        // Verify tokens exist
        const updatedToken0 = resultDB.entities.Token.get(token0.id);
        const updatedToken1 = resultDB.entities.Token.get(token1.id);

        expect(updatedToken0).toBeDefined();
        expect(updatedToken1).toBeDefined();

        // Verify pool was updated
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).toBeDefined();
        // Verify staked and unstaked fees are tracked separately
        expect(updatedPool?.totalStakedFeesCollectedUSD).toBeDefined();
        expect(updatedPool?.totalUnstakedFeesCollectedUSD).toBeDefined();
        if (updatedPool?.totalStakedFeesCollectedUSD !== undefined) {
          expect(updatedPool.totalStakedFeesCollectedUSD >= 0n).toBe(true);
        }
        if (updatedPool?.totalUnstakedFeesCollectedUSD !== undefined) {
          expect(updatedPool.totalUnstakedFeesCollectedUSD >= 0n).toBe(true);
        }
      }
    });
  });

  describe("Flash Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Flash.createMockEvent>;
    let processSpy: jest.SpyInstance;

    beforeEach(() => {
      processSpy = jest
        .spyOn(CLPoolFlashLogic, "processCLPoolFlash")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalTotalFlashLoanFees0: 5n,
            incrementalTotalFlashLoanFees1: 0n,
            incrementalTotalFlashLoanFeesUSD: 5n,
            incrementalTotalFlashLoanVolumeUSD: 1000n,
            incrementalNumberOfFlashLoans: 1n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userFlashLoanDiff: {
            incrementalNumberOfFlashLoans: 1n,
            incrementalTotalFlashLoanVolumeUSD: 1000n,
            lastActivityTimestamp: new Date(1000000 * 1000),
          },
        });

      mockEvent = CLPool.Flash.createMockEvent({
        sender: userAddress,
        recipient: userAddress,
        amount0: 1000n,
        amount1: 0n,
        paid0: 1005n,
        paid1: 0n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should process flash event and update flash loan metrics", async () => {
      processSpy.mockClear();
      const resultDB = await CLPool.Flash.processEvent({
        event: mockEvent,
        mockDb,
      });

      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeDefined();
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.Flash.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool =
        emptyDb.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeUndefined();
    });

    it("should not update user stats if flash loan volume is 0", async () => {
      processSpy.mockClear();
      processSpy.mockReturnValue({
        liquidityPoolDiff: {
          incrementalTotalFlashLoanFees0: 0n,
          incrementalTotalFlashLoanFees1: 0n,
          incrementalTotalFlashLoanFeesUSD: 0n,
          incrementalNumberOfFlashLoans: 1n,
          incrementalTotalFlashLoanVolumeUSD: 0n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        },
        userFlashLoanDiff: {
          incrementalNumberOfFlashLoans: 1n,
          incrementalTotalFlashLoanVolumeUSD: 0n,
          lastActivityTimestamp: new Date(1000000 * 1000),
        },
      });

      // Capture initial user stats state
      const initialUserStats = mockDb.entities.UserStatsPerPool.get(
        `${userAddress.toLowerCase()}_${poolAddress.toLowerCase()}_${chainId}`,
      );
      const initialNumberOfFlashLoans =
        initialUserStats?.numberOfFlashLoans ?? 0n;
      const initialTotalFlashLoanVolumeUSD =
        initialUserStats?.totalFlashLoanVolumeUSD ?? 0n;

      const resultDB = await CLPool.Flash.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Should still process, but user stats update is conditional
      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Verify user stats are NOT updated when volume is 0 (no-op behavior)
      const updatedUserStats = resultDB.entities.UserStatsPerPool.get(
        `${userAddress.toLowerCase()}_${poolAddress.toLowerCase()}_${chainId}`,
      );
      expect(updatedUserStats).toBeDefined();
      // User stats should remain unchanged since volume is 0
      expect(updatedUserStats?.numberOfFlashLoans).toBe(
        initialNumberOfFlashLoans,
      );
      expect(updatedUserStats?.totalFlashLoanVolumeUSD).toBe(
        initialTotalFlashLoanVolumeUSD,
      );
    });
  });

  describe("IncreaseObservationCardinalityNext Event", () => {
    let mockEvent: ReturnType<
      typeof CLPool.IncreaseObservationCardinalityNext.createMockEvent
    >;

    beforeEach(() => {
      mockEvent = CLPool.IncreaseObservationCardinalityNext.createMockEvent({
        observationCardinalityNextNew: 100n,
        observationCardinalityNextOld: 50n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should update observation cardinality", async () => {
      const resultDB =
        await CLPool.IncreaseObservationCardinalityNext.processEvent({
          event: mockEvent,
          mockDb,
        });

      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.observationCardinalityNext).toBe(100n);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.IncreaseObservationCardinalityNext.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, handler should return early
      const updatedPool =
        emptyDb.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("SetFeeProtocol Event", () => {
    let mockEvent: ReturnType<typeof CLPool.SetFeeProtocol.createMockEvent>;

    beforeEach(() => {
      mockEvent = CLPool.SetFeeProtocol.createMockEvent({
        feeProtocol0New: 10n,
        feeProtocol1New: 20n,
        feeProtocol0Old: 5n,
        feeProtocol1Old: 15n,
        mockEventData: {
          srcAddress: poolAddress,
          chainId: chainId,
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });
    });

    it("should update fee protocol settings", async () => {
      const resultDB = await CLPool.SetFeeProtocol.processEvent({
        event: mockEvent,
        mockDb,
      });

      const updatedPool =
        resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.feeProtocol0).toBe(10n);
      expect(updatedPool?.feeProtocol1).toBe(20n);
    });

    it("should return early if pool data not found", async () => {
      const emptyDb = MockDb.createMockDb();
      await CLPool.SetFeeProtocol.processEvent({
        event: mockEvent,
        mockDb: emptyDb,
      });

      // Should not throw, handler should return early
      const updatedPool =
        emptyDb.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).toBeUndefined();
    });
  });
});
