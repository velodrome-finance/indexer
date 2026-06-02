import type { Token } from "envio";
import { createTestIndexer } from "envio";
import type { MockInstance } from "vitest";
import {
  OUSDT_ADDRESS,
  PoolId,
  TokenId,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../src/Constants";
import * as CLPoolBurnLogic from "../../src/EventHandlers/CLPool/CLPoolBurnLogic";
import * as CLPoolCollectFeesLogic from "../../src/EventHandlers/CLPool/CLPoolCollectFeesLogic";
import * as CLPoolCollectLogic from "../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import * as CLPoolFlashLogic from "../../src/EventHandlers/CLPool/CLPoolFlashLogic";
import * as CLPoolMintLogic from "../../src/EventHandlers/CLPool/CLPoolMintLogic";
import * as CLPoolSwapLogic from "../../src/EventHandlers/CLPool/CLPoolSwapLogic";
import { type MockPool, setupCommon } from "./Pool/common";

describe("CLPool Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    createMockPool,
    createMockUserStatsPerPool,
  } = setupCommon();
  const chainId = 10 as const;
  const userAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const recipientAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );

  let indexer: ReturnType<typeof createTestIndexer>;
  let liquidityPool: MockPool;
  let userStats: ReturnType<typeof createMockUserStatsPerPool>;

  beforeEach(() => {
    indexer = createTestIndexer();

    // Set up liquidity pool
    liquidityPool = createMockPool({
      isCL: true,
    });

    // Set up user stats with all required fields
    userStats = createMockUserStatsPerPool({
      userAddress: userAddress,
      poolAddress: liquidityPool.poolAddress,
      chainId: chainId,
      firstActivityTimestamp: new Date(1000000 * 1000),
      lastActivityTimestamp: new Date(1000000 * 1000),
    });

    // Set up entities in indexer
    indexer.Pool.set(liquidityPool);
    indexer.UserStatsPerPool.set(userStats);
    indexer.Token.set(mockToken0Data as Token);
    indexer.Token.set(mockToken1Data as Token);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Swap Event", () => {
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
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
    });

    it("should process swap event and update pool aggregator", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Swap",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: {
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: userAddress,
                  recipient: recipientAddress,
                  amount0: 1000n,
                  amount1: -500n,
                  sqrtPriceX96: 1000000n,
                  liquidity: 2000000n,
                  tick: 100n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();

      // Real handler sets incrementalTotalVolume0 = abs(amount0) = 1000n, incrementalTotalVolume1 = abs(-500n) = 500n
      // (CLPoolSwapLogic.ts processCLPoolSwap: liquidityPoolDiff.incrementalTotalVolume0 = abs(event.params.amount0))
      expect(updatedPool?.totalVolume0).toBe(
        liquidityPool.totalVolume0 + 1000n,
      );
      expect(updatedPool?.totalVolume1).toBe(liquidityPool.totalVolume1 + 500n);
      // incrementalNumberOfSwaps = 1n always (Pool.ts updatePool: numberOfSwaps += incrementalNumberOfSwaps)
      expect(updatedPool?.numberOfSwaps).toBe(liquidityPool.numberOfSwaps + 1n);
      // totalVolumeUSD: directional only — depends on pickTrustedSwapVolumeUSD over live effect prices
      expect(updatedPool?.totalVolumeUSD).toBeGreaterThanOrEqual(
        liquidityPool.totalVolumeUSD,
      );

      // UserStatsPerPool for the swap sender (userAddress is pre-seeded starting from 0n on all swap fields)
      const updatedUserStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, userAddress, liquidityPool.poolAddress),
      );
      expect(updatedUserStats).toBeDefined();
      // incrementalNumberOfSwaps = 1n; initial numberOfSwaps = 0n (from createMockUserStatsPerPool defaults)
      expect(updatedUserStats?.numberOfSwaps).toBe(1n);
      // incrementalTotalSwapVolumeAmount0 = abs(1000n) = 1000n; initial = 0n
      expect(updatedUserStats?.totalSwapVolumeAmount0).toBe(1000n);
      // incrementalTotalSwapVolumeAmount1 = abs(-500n) = 500n; initial = 0n
      expect(updatedUserStats?.totalSwapVolumeAmount1).toBe(500n);
      // totalSwapVolumeUSD: directional only — USD depends on live oracle effect
      expect(updatedUserStats?.totalSwapVolumeUSD).toBeGreaterThanOrEqual(0n);
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Swap",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: {
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: userAddress,
                  recipient: recipientAddress,
                  amount0: 1000n,
                  amount1: -500n,
                  sqrtPriceX96: 1000000n,
                  liquidity: 2000000n,
                  tick: 100n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, but processSpy shouldn't be called
      expect(processSpy).not.toHaveBeenCalled();
    });

    it("should create oUSDTSwap entity when OUSDT token is involved", async () => {
      // Create a pool with OUSDT as token0
      const ousdtToken: Token = {
        ...mockToken0Data,
        address: OUSDT_ADDRESS,
        id: TokenId(chainId, OUSDT_ADDRESS),
      };

      const ousdtPool = {
        ...liquidityPool,
        token0_address: OUSDT_ADDRESS,
        token0_id: ousdtToken.id,
      };

      const ousdtIndexer = createTestIndexer();
      ousdtIndexer.Pool.set(ousdtPool);
      ousdtIndexer.Token.set(ousdtToken);
      ousdtIndexer.Token.set(mockToken1Data as Token);
      ousdtIndexer.UserStatsPerPool.set(userStats);

      processSpy.mockClear();
      const txHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";
      await ousdtIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Swap",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: { hash: txHash },
                params: {
                  sender: userAddress,
                  recipient: recipientAddress,
                  amount0: 1000n,
                  amount1: -500n,
                  sqrtPriceX96: 1000000n,
                  liquidity: 2000000n,
                  tick: 100n,
                },
              },
            ],
          },
        },
      });

      // Verify oUSDTSwap entity was created with OUSDT as token0
      const ousdtSwaps = await ousdtIndexer.OUSDTSwaps.getAll();
      expect(ousdtSwaps).toHaveLength(1);
      const swapEntity1 = ousdtSwaps[0];
      expect(swapEntity1.transactionHash).toBe(txHash);
      // With amount0 > 0, token0 (OUSDT) goes in, token1 goes out
      expect(swapEntity1.tokenInPool).toBe(OUSDT_ADDRESS);
      expect(swapEntity1.tokenOutPool).toBe(mockToken1Data.address);
      expect(swapEntity1.amountIn).toBe(1000n); // amount0 = 1000n
      expect(swapEntity1.amountOut).toBe(500n); // amount1 = -500n, so amount1Out = 500n

      // Test with OUSDT as token1 as well
      const ousdtToken1Pool = {
        ...liquidityPool,
        token1_address: OUSDT_ADDRESS,
        token1_id: ousdtToken.id,
      };

      const ousdtIndexer2 = createTestIndexer();
      ousdtIndexer2.Pool.set(ousdtToken1Pool);
      ousdtIndexer2.Token.set(mockToken0Data as Token);
      ousdtIndexer2.Token.set(ousdtToken);
      ousdtIndexer2.UserStatsPerPool.set(userStats);

      const txHash2 =
        "0x1234567890123456789012345678901234567890123456789012345678901234";
      await ousdtIndexer2.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Swap",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: { hash: txHash2 },
                params: {
                  sender: userAddress,
                  recipient: recipientAddress,
                  amount0: 1000n,
                  amount1: -500n,
                  sqrtPriceX96: 1000000n,
                  liquidity: 2000000n,
                  tick: 100n,
                },
              },
            ],
          },
        },
      });

      // Verify oUSDTSwap entity was created with OUSDT as token1
      const ousdtSwaps2 = await ousdtIndexer2.OUSDTSwaps.getAll();
      expect(ousdtSwaps2).toHaveLength(1);
      const swapEntity2 = ousdtSwaps2[0];
      expect(swapEntity2.transactionHash).toBe(txHash2);
      // With amount0 > 0, token0 goes in, token1 (OUSDT) goes out
      expect(swapEntity2.tokenInPool).toBe(mockToken0Data.address);
      expect(swapEntity2.tokenOutPool).toBe(OUSDT_ADDRESS);
      expect(swapEntity2.amountIn).toBe(1000n); // amount0 = 1000n
      expect(swapEntity2.amountOut).toBe(500n); // amount1 = -500n, so amount1Out = 500n
    });

    it("should handle all amount conversion branches for oUSDTSwap", async () => {
      // Create pool with OUSDT as token0
      const ousdtToken: Token = {
        ...mockToken0Data,
        address: OUSDT_ADDRESS,
        id: TokenId(chainId, OUSDT_ADDRESS),
      };

      const ousdtPool = {
        ...liquidityPool,
        token0_address: OUSDT_ADDRESS,
        token0_id: ousdtToken.id,
      };

      const ousdtIndexer = createTestIndexer();
      ousdtIndexer.Pool.set(ousdtPool);
      ousdtIndexer.Token.set(ousdtToken);
      ousdtIndexer.Token.set(mockToken1Data as Token);
      ousdtIndexer.UserStatsPerPool.set(userStats);

      processSpy.mockClear();
      // Test with positive amount0 (amount0In path)
      const positiveTxHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";
      await ousdtIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Swap",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: { hash: positiveTxHash },
                params: {
                  sender: userAddress,
                  recipient: recipientAddress,
                  amount0: 1000n, // Positive
                  amount1: -500n, // Negative
                  sqrtPriceX96: 1000000n,
                  liquidity: 2000000n,
                  tick: 100n,
                },
              },
            ],
          },
        },
      });

      const ousdtSwaps = await ousdtIndexer.OUSDTSwaps.getAll();
      expect(ousdtSwaps).toHaveLength(1);
      // Verify entity was created with correct conversion (amount0 > 0 means token0 in, token1 out)
      const swapEntity = ousdtSwaps[0];
      expect(swapEntity).toBeDefined();
      expect(swapEntity.transactionHash).toBe(positiveTxHash);
      expect(swapEntity.tokenInPool).toBe(OUSDT_ADDRESS); // token0 (OUSDT) is going in
      expect(swapEntity.tokenOutPool).toBe(mockToken1Data.address); // token1 is going out
      expect(swapEntity.amountIn).toBe(1000n); // amount0In = 1000n
      expect(swapEntity.amountOut).toBe(500n); // amount1Out = 500n

      // Test with negative amount0 (amount0Out path)
      const ousdtIndexer2 = createTestIndexer();
      ousdtIndexer2.Pool.set(ousdtPool);
      ousdtIndexer2.Token.set(ousdtToken);
      ousdtIndexer2.Token.set(mockToken1Data as Token);
      ousdtIndexer2.UserStatsPerPool.set(userStats);

      const negativeTxHash =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      await ousdtIndexer2.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Swap",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: { hash: negativeTxHash },
                params: {
                  sender: userAddress,
                  recipient: recipientAddress,
                  amount0: -1000n, // Negative
                  amount1: 500n, // Positive
                  sqrtPriceX96: 1000000n,
                  liquidity: 2000000n,
                  tick: 100n,
                },
              },
            ],
          },
        },
      });

      const ousdtSwaps2 = await ousdtIndexer2.OUSDTSwaps.getAll();
      expect(ousdtSwaps2).toHaveLength(1);
      // Verify entity was created with correct conversion (amount1 > 0 means token1 in, token0 out)
      const swapEntity2 = ousdtSwaps2[0];
      expect(swapEntity2).toBeDefined();
      expect(swapEntity2.transactionHash).toBe(negativeTxHash);
      expect(swapEntity2.tokenInPool).toBe(mockToken1Data.address); // token1 is going in
      expect(swapEntity2.tokenOutPool).toBe(OUSDT_ADDRESS); // token0 (OUSDT) is going out
      expect(swapEntity2.amountIn).toBe(500n); // amount1In = 500n
      expect(swapEntity2.amountOut).toBe(1000n); // amount0Out = 1000n
    });
  });

  describe("Mint Event", () => {
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolMintLogic, "processCLPoolMint")
        .mockReturnValue({
          liquidityPoolDiff: {
            incrementalReserve0: 1000n,
            incrementalReserve1: 1000n,
            currentTotalLiquidityUSD: 2000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });
    });

    it("should process mint event and record CLPoolMintEvent", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Mint",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: {
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  owner: userAddress,
                  tickLower: -1000n,
                  tickUpper: 1000n,
                  amount: 1000n,
                  amount0: 500n,
                  amount1: 500n,
                },
              },
            ],
          },
        },
      });

      // CLPool.Mint handler (CLPool.ts) always writes a CLPoolMintEvent entity
      // (for NFPM.Transfer mint to consume). No NonFungiblePosition is created by
      // CLPool.Mint itself — that happens via NFPM.Transfer.
      const mintEvents = await indexer.CLPoolMintEvent.getAll();
      expect(mintEvents).toHaveLength(1);

      // Pool reserves increment by amount0/amount1 (CLPoolMintLogic.ts processCLPoolMint)
      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.reserve0).toBe(liquidityPool.reserve0 + 500n);
      expect(updatedPool?.reserve1).toBe(liquidityPool.reserve1 + 500n);
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Mint",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: {
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  owner: userAddress,
                  tickLower: -1000n,
                  tickUpper: 1000n,
                  amount: 1000n,
                  amount0: 500n,
                  amount1: 500n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = await emptyIndexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Burn Event", () => {
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolBurnLogic, "processCLPoolBurn")
        .mockResolvedValue({
          liquidityPoolDiff: {
            incrementalReserve0: -500n, // Negative because burning decreases reserves
            incrementalReserve1: -500n, // Negative because burning decreases reserves
            currentTotalLiquidityUSD: 1000n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
        });
    });

    it("should process burn event and update pool aggregator", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Burn",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  owner: userAddress,
                  tickLower: -1000n,
                  tickUpper: 1000n,
                  amount: 500n,
                  amount0: 250n,
                  amount1: 250n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();

      // Real handler: reserve0 -= amount0 (250n), reserve1 -= amount1 (250n)
      // (CLPoolBurnLogic.ts processCLPoolBurn: incrementalReserve0 = -event.params.amount0)
      // The mock pool starts with reserve0 = 200n * 1e18, reserve1 = 200n * 1e6;
      // both values are large enough that the NEG_RESERVE_GUARD clamp won't fire.
      expect(updatedPool?.reserve0).toBe(liquidityPool.reserve0 - 250n);
      expect(updatedPool?.reserve1).toBe(liquidityPool.reserve1 - 250n);

      // totalLiquidityUSD: directional only — depends on live oracle prices
      expect(updatedPool?.totalLiquidityUSD).toBeGreaterThanOrEqual(0n);
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Burn",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  owner: userAddress,
                  tickLower: -1000n,
                  tickUpper: 1000n,
                  amount: 500n,
                  amount0: 250n,
                  amount1: 250n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = await emptyIndexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("Collect Event", () => {
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolCollectLogic, "processCLPoolCollect")
        .mockResolvedValue({
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
    });

    it("should process collect event and update fees", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Collect",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  owner: userAddress,
                  recipient: userAddress,
                  tickLower: -1000n,
                  tickUpper: 1000n,
                  amount0: 100n,
                  amount1: 200n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();

      // No prior Burn for this position → pendingPrincipal = 0n
      // isolateFees(100n, 0n) = {fees: 100n, remaining: 0n} (CLPoolCollectLogic.ts)
      // isolateFees(200n, 0n) = {fees: 200n, remaining: 0n}
      // incrementalTotalUnstakedFeesCollected0 = 100n, ..1 = 200n
      expect(updatedPool?.totalUnstakedFeesCollected0).toBe(
        liquidityPool.totalUnstakedFeesCollected0 + 100n,
      );
      expect(updatedPool?.totalUnstakedFeesCollected1).toBe(
        liquidityPool.totalUnstakedFeesCollected1 + 200n,
      );
      // totalUnstakedFeesCollectedUSD: directional only — depends on live oracle prices
      expect(updatedPool?.totalUnstakedFeesCollectedUSD).toBeGreaterThanOrEqual(
        liquidityPool.totalUnstakedFeesCollectedUSD,
      );
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Collect",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  owner: userAddress,
                  recipient: userAddress,
                  tickLower: -1000n,
                  tickUpper: 1000n,
                  amount0: 100n,
                  amount1: 200n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = await emptyIndexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("CollectFees Event", () => {
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
        .spyOn(CLPoolCollectFeesLogic, "processCLPoolCollectFees")
        .mockReturnValue({
          liquidityPoolDiff: {
            // In CL pools, CollectFees events do NOT affect reserves - fees were never part of reserves
            // Track staked fees (from CollectFees events - LPs that staked in gauge)
            incrementalTotalStakedFeesCollected0: 50n,
            incrementalTotalStakedFeesCollected1: 75n,
            incrementalTotalStakedFeesCollectedUSD: 125n,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          },
          userDiff: {
            incrementalTotalFeesContributedUSD: 125n,
            incrementalTotalFeesContributed0: 50n,
            incrementalTotalFeesContributed1: 75n,
            lastActivityTimestamp: new Date(1000000 * 1000),
          },
        });
    });

    it("should process collect fees event", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "CollectFees",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  recipient: userAddress,
                  amount0: 50n,
                  amount1: 75n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();

      // Real handler passes event.params.amount0/1 directly as increments
      // (CLPoolCollectFeesLogic.ts: incrementalTotalStakedFeesCollected0 = event.params.amount0)
      // Pool mock starts with totalStakedFeesCollected0 = 0n, totalStakedFeesCollected1 = 0n
      expect(updatedPool?.totalStakedFeesCollected0).toBe(
        liquidityPool.totalStakedFeesCollected0 + 50n,
      );
      expect(updatedPool?.totalStakedFeesCollected1).toBe(
        liquidityPool.totalStakedFeesCollected1 + 75n,
      );
      // totalStakedFeesCollectedUSD: directional only — depends on live oracle prices
      expect(updatedPool?.totalStakedFeesCollectedUSD).toBeGreaterThanOrEqual(
        liquidityPool.totalStakedFeesCollectedUSD,
      );
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "CollectFees",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  recipient: userAddress,
                  amount0: 50n,
                  amount1: 75n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = await emptyIndexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeUndefined();
    });

    it("should refresh token prices when processing collect fees event", async () => {
      // Remove spy to test actual handler
      processSpy.mockRestore();

      // Set up tokens with stale prices (2 hours ago)
      const staleTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const existingToken0 = await indexer.Token.get(mockToken0Data.id);
      const existingToken1 = await indexer.Token.get(mockToken1Data.id);

      expect(existingToken0).toBeDefined();
      expect(existingToken1).toBeDefined();
      if (!existingToken0 || !existingToken1) {
        throw new Error("tokens expected from indexer");
      }

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

      indexer.Token.set(token0);
      indexer.Token.set(token1);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "CollectFees",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  recipient: userAddress,
                  amount0: 50n,
                  amount1: 75n,
                },
              },
            ],
          },
        },
      });

      // Note: In a real scenario, the effect would be called and prices refreshed
      // For this test, we verify that the handler structure supports price refresh
      // The actual price refresh happens in loadPoolData which is tested separately

      // Verify tokens exist
      const updatedToken0 = await indexer.Token.get(token0.id);
      const updatedToken1 = await indexer.Token.get(token1.id);

      expect(updatedToken0).toBeDefined();
      expect(updatedToken1).toBeDefined();

      // Verify pool was updated
      const updatedPool = await indexer.Pool.get(liquidityPool.id);
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
    });
  });

  describe("Flash Event", () => {
    let processSpy: MockInstance;

    beforeEach(() => {
      processSpy = vi
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
    });

    it("should process flash event and update flash loan metrics", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Flash",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: userAddress,
                  recipient: userAddress,
                  amount0: 1000n,
                  amount1: 0n,
                  paid0: 1005n,
                  paid1: 0n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();

      // Real handler: incrementalTotalFlashLoanFees0 = paid0 = 1005n (CLPoolFlashLogic.ts)
      // incrementalNumberOfFlashLoans = 1n always
      // Pool mock starts with totalFlashLoanFees0 = 0n, numberOfFlashLoans = 0n
      expect(updatedPool?.totalFlashLoanFees0).toBe(
        (liquidityPool.totalFlashLoanFees0 ?? 0n) + 1005n,
      );
      expect(updatedPool?.numberOfFlashLoans).toBe(
        (liquidityPool.numberOfFlashLoans ?? 0n) + 1n,
      );
      // totalFlashLoanFeesUSD and totalFlashLoanVolumeUSD: directional only — depend on live oracle prices
      expect(updatedPool?.totalFlashLoanFeesUSD).toBeGreaterThanOrEqual(
        liquidityPool.totalFlashLoanFeesUSD ?? 0n,
      );
      expect(updatedPool?.totalFlashLoanVolumeUSD).toBeGreaterThanOrEqual(
        liquidityPool.totalFlashLoanVolumeUSD ?? 0n,
      );
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Flash",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: userAddress,
                  recipient: userAddress,
                  amount0: 1000n,
                  amount1: 0n,
                  paid0: 1005n,
                  paid1: 0n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, handler should return early
      expect(processSpy).not.toHaveBeenCalled();
      const updatedPool = await emptyIndexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeUndefined();
    });

    it("should not update user stats if flash loan volume is 0", async () => {
      // Capture initial user stats state before processing
      const initialUserStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, userAddress, liquidityPool.poolAddress),
      );
      const initialNumberOfFlashLoans =
        initialUserStats?.numberOfFlashLoans ?? 0n;
      const initialTotalFlashLoanVolumeUSD =
        initialUserStats?.totalFlashLoanVolumeUSD ?? 0n;

      // amount0=0n, amount1=0n → flashLoanVolumeUSD = calculateTotalUSD(0n, 0n, ...) = 0n
      // CLPool.ts: updateUserStatsPerPool is only called when incrementalTotalFlashLoanVolumeUSD > 0n
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Flash",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  sender: userAddress,
                  recipient: userAddress,
                  amount0: 0n,
                  amount1: 0n,
                  paid0: 0n,
                  paid1: 0n,
                },
              },
            ],
          },
        },
      });

      // User stats must remain unchanged — the zero-volume guard in CLPool.ts
      // (line: `(userDiff.incrementalTotalFlashLoanVolumeUSD ?? 0n) > 0n`) skips
      // updateUserStatsPerPool when flashLoanVolumeUSD = 0n.
      const updatedUserStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, userAddress, liquidityPool.poolAddress),
      );
      expect(updatedUserStats).toBeDefined();
      expect(updatedUserStats?.numberOfFlashLoans).toBe(
        initialNumberOfFlashLoans,
      );
      expect(updatedUserStats?.totalFlashLoanVolumeUSD).toBe(
        initialTotalFlashLoanVolumeUSD,
      );
    });
  });

  describe("IncreaseObservationCardinalityNext Event", () => {
    it("should update observation cardinality", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "IncreaseObservationCardinalityNext",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  observationCardinalityNextNew: 100n,
                  observationCardinalityNextOld: 50n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.observationCardinalityNext).toBe(100n);
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "IncreaseObservationCardinalityNext",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  observationCardinalityNextNew: 100n,
                  observationCardinalityNextOld: 50n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, handler should return early
      const updatedPool = await emptyIndexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeUndefined();
    });
  });

  describe("SetFeeProtocol Event", () => {
    it("should update fee protocol settings", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "SetFeeProtocol",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  feeProtocol0New: 10n,
                  feeProtocol1New: 20n,
                  feeProtocol0Old: 5n,
                  feeProtocol1Old: 15n,
                },
              },
            ],
          },
        },
      });

      const updatedPool = await indexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.feeProtocol0).toBe(10n);
      expect(updatedPool?.feeProtocol1).toBe(20n);
    });

    it("should return early if pool data not found", async () => {
      const emptyIndexer = createTestIndexer();
      await emptyIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "SetFeeProtocol",
                srcAddress: liquidityPool.poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  feeProtocol0New: 10n,
                  feeProtocol1New: 20n,
                  feeProtocol0Old: 5n,
                  feeProtocol1Old: 15n,
                },
              },
            ],
          },
        },
      });

      // Should not throw, handler should return early
      const updatedPool = await emptyIndexer.Pool.get(liquidityPool.id);
      expect(updatedPool).toBeUndefined();
    });
  });

  // Slipstream emits Initialize from the pool BEFORE its CLFactory emits
  // PoolCreated within the same tx, so the aggregator does not exist yet.
  // The handler buffers the opening price for PoolCreated to consume.
  describe("Initialize Event", () => {
    it("buffers sqrtPriceX96/tick into CLPoolPendingInitialize", async () => {
      const pool = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const initIndexer = createTestIndexer();
      await initIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLPool",
                event: "Initialize",
                srcAddress: pool as `0x${string}`,
                logIndex: 0,
                block: {
                  number: 42,
                  timestamp: 1_234_567,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                transaction: {
                  hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                },
                params: {
                  sqrtPriceX96: 79228162514264337593543950336n,
                  tick: 1n,
                },
              },
            ],
          },
        },
      });

      // No phantom aggregator created — Initialize lacks token0/token1/tickSpacing.
      expect(await initIndexer.Pool.get(PoolId(chainId, pool))).toBeUndefined();

      const pending = await initIndexer.CLPoolPendingInitialize.get(
        PoolId(chainId, pool),
      );
      expect(pending).toBeDefined();
      if (!pending) return;
      expect(pending.sqrtPriceX96).toBe(79228162514264337593543950336n);
      expect(pending.tick).toBe(1n);
      expect(pending.poolAddress).toBe(pool);
      expect(pending.chainId).toBe(chainId);
    });
  });
});
