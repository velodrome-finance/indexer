import type { Token } from "envio";
import { createTestIndexer } from "envio";
import type { MockInstance } from "vitest";
import {
  OUSDT_ADDRESS,
  PoolId,
  TEN_TO_THE_18_BI,
  TokenId,
  UserStatsPerPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import type { Pool as PoolEntity } from "../../../src/EntityTypes";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "./common";

describe("Pool Swap Event", () => {
  let mockToken0Data: Token;
  let mockToken1Data: Token;
  let mockLiquidityPoolData: ReturnType<
    typeof setupCommon
  >["mockLiquidityPoolData"];
  let createMockToken: ReturnType<typeof setupCommon>["createMockToken"];

  const chainId = 10 as const;

  const expectations = {
    swapAmount0In: 0n,
    swapAmount1Out: 0n,
    expectedNetAmount0: 0n,
    expectedNetAmount1: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    expectedLPVolumeUSD0: 0n,
    expectedLPVolumeUSD1: 0n,
    // Min-leg pick (#699): when both legs are priced, swap volume picks the
    // smaller leg to resist scam-token oracle inflation.
    expectedLPVolumeUSDMin: 0n,
    expectedSwapVolumeUSDMin: 0n,
  };

  const eventParams = {
    sender: toChecksumAddress("0x4444444444444444444444444444444444444444"),
    to: toChecksumAddress("0x5555555555555555555555555555555555555555"),
    amount0In: 0n,
    amount1In: 0n,
    amount0Out: 0n,
    amount1Out: 0n,
  };

  const srcAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const blockTimestamp = 1000000;
  const blockNumber = 123456;
  const blockHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";

  let mockPriceOracle: MockInstance;
  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(() => {
    const setupData = setupCommon();
    mockToken0Data = setupData.mockToken0Data;
    mockToken1Data = setupData.mockToken1Data;
    mockLiquidityPoolData = setupData.mockLiquidityPoolData;
    createMockToken = setupData.createMockToken;

    expectations.swapAmount0In = 100n * 10n ** mockToken0Data.decimals;
    expectations.swapAmount1Out = 99n * 10n ** mockToken1Data.decimals;

    expectations.expectedNetAmount0 = expectations.swapAmount0In;

    expectations.expectedNetAmount1 = expectations.swapAmount1Out;

    expectations.totalVolume0 =
      mockLiquidityPoolData.totalVolume0 + expectations.swapAmount0In;
    expectations.totalVolume1 =
      mockLiquidityPoolData.totalVolume1 + expectations.swapAmount1Out;

    // The code expects pricePerUSDNew to be normalized to 1e18
    const swapVolumeUSD0 =
      expectations.expectedNetAmount0 *
      (TEN_TO_THE_18_BI / 10n ** mockToken0Data.decimals) *
      (mockToken0Data.pricePerUSDNew / TEN_TO_THE_18_BI);
    const swapVolumeUSD1 =
      expectations.expectedNetAmount1 *
      (TEN_TO_THE_18_BI / 10n ** mockToken1Data.decimals) *
      (mockToken1Data.pricePerUSDNew / TEN_TO_THE_18_BI);

    expectations.expectedLPVolumeUSD0 =
      mockLiquidityPoolData.totalVolumeUSD + swapVolumeUSD0;
    expectations.expectedLPVolumeUSD1 =
      mockLiquidityPoolData.totalVolumeUSD + swapVolumeUSD1;

    expectations.expectedSwapVolumeUSDMin =
      swapVolumeUSD0 < swapVolumeUSD1 ? swapVolumeUSD0 : swapVolumeUSD1;
    expectations.expectedLPVolumeUSDMin =
      mockLiquidityPoolData.totalVolumeUSD +
      expectations.expectedSwapVolumeUSDMin;

    mockPriceOracle = vi
      .spyOn(PriceOracle, "refreshTokenPrice")
      .mockImplementation(async (...args) => {
        return args[0]; // Return the token that was passed in
      });

    indexer = createTestIndexer();
    eventParams.amount0In = expectations.swapAmount0In;
    eventParams.amount1Out = expectations.swapAmount1Out;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when both tokens exist", () => {
    let updatedPool: PoolEntity | undefined;

    beforeEach(async () => {
      indexer.Pool.set({
        ...mockLiquidityPoolData,
        stakedTickEdges: [...mockLiquidityPoolData.stakedTickEdges],
        stakedTickEdgeNets: [...mockLiquidityPoolData.stakedTickEdgeNets],
      });
      indexer.Token.set(mockToken0Data as Token);
      indexer.Token.set(mockToken1Data as Token);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Swap",
                srcAddress: srcAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                params: { ...eventParams },
              },
            ],
          },
        },
      });

      const raw = await indexer.Pool.get(PoolId(chainId, srcAddress));
      updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
    });

    it("should update UserStatsPerPool with swap activity", async () => {
      const rawStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, eventParams.sender, srcAddress),
      );
      const userStats = rawStats
        ? rehydrateTimestamps("UserStatsPerPool", rawStats)
        : undefined;
      expect(userStats).toBeDefined();
      expect(userStats?.userAddress).toBe(eventParams.sender);
      expect(userStats?.poolAddress).toBe(srcAddress);
      expect(userStats?.chainId).toBe(chainId);
      expect(userStats?.numberOfSwaps).toBe(1n);
      // min(token0 = 100 * $1, token1 = 99 * $1) → 99 USDC-side amount
      expect(userStats?.totalSwapVolumeUSD).toBe(
        expectations.expectedSwapVolumeUSDMin,
      );
      expect(userStats?.lastActivityTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should update the Liquidity Pool aggregator", async () => {
      expect(updatedPool).toBeDefined();
      expect(updatedPool?.totalVolume0).toBe(expectations.totalVolume0);
      expect(updatedPool?.totalVolume1).toBe(expectations.totalVolume1);
      expect(updatedPool?.totalVolumeUSD).toBe(
        expectations.expectedLPVolumeUSDMin,
      );
      expect(updatedPool?.numberOfSwaps).toBe(
        mockLiquidityPoolData.numberOfSwaps + 1n,
      );
      expect(updatedPool?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
    });
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a mockDb without the pool
      indexer.Token.set(mockToken0Data as Token);
      indexer.Token.set(mockToken1Data as Token);
      // Note: We intentionally don't set the Pool

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Swap",
                srcAddress: srcAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                params: { ...eventParams },
              },
            ],
          },
        },
      });

      // Pool should not exist
      const pool = await indexer.Pool.get(PoolId(chainId, srcAddress));
      expect(pool).toBeUndefined();

      // User stats will still be created because loadOrCreateUserData is called in parallel
      // but they should have default/zero values since no swap processing occurred
      const userStats = await indexer.UserStatsPerPool.get(
        UserStatsPerPoolId(chainId, eventParams.sender, srcAddress),
      );
      expect(userStats).toBeDefined();
      // Verify no swap activity was recorded
      expect(userStats?.numberOfSwaps).toBe(0n);
      expect(userStats?.totalSwapVolumeUSD).toBe(0n);
    });
  });

  describe("when OUSDT is involved", () => {
    it("should create OUSDTSwap entity when token0 is OUSDT", async () => {
      const ousdtAddress = toChecksumAddress(OUSDT_ADDRESS);
      const ousdtToken = createMockToken({
        address: ousdtAddress,
        id: TokenId(10, ousdtAddress),
      });

      // Update pool to reference OUSDT token
      const poolWithOusdt = {
        ...mockLiquidityPoolData,
        token0_id: ousdtToken.id,
        token0_address: ousdtAddress,
        stakedTickEdges: [...mockLiquidityPoolData.stakedTickEdges],
        stakedTickEdgeNets: [...mockLiquidityPoolData.stakedTickEdgeNets],
      };

      indexer.Pool.set(poolWithOusdt);
      indexer.Token.set(ousdtToken as Token);
      indexer.Token.set(mockToken1Data as Token);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Swap",
                srcAddress: srcAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                params: {
                  ...eventParams,
                  amount0In: 100n * 10n ** 18n,
                  amount1Out: 99n * 10n ** 18n,
                },
              },
            ],
          },
        },
      });

      // Check that OUSDTSwap entity was created
      const ousdtSwaps = await indexer.OUSDTSwaps.getAll();
      expect(ousdtSwaps.length).toBe(1);
      expect(ousdtSwaps[0]?.tokenInPool).toBe(ousdtAddress);
      expect(ousdtSwaps[0]?.amountIn).toBe(100n * 10n ** 18n);
    });

    it("should create OUSDTSwap entity when token1 is OUSDT", async () => {
      const ousdtAddress = toChecksumAddress(OUSDT_ADDRESS);
      const ousdtToken = createMockToken({
        address: ousdtAddress,
        id: TokenId(10, ousdtAddress),
      });

      // Update pool to reference OUSDT token
      const poolWithOusdt = {
        ...mockLiquidityPoolData,
        token1_id: ousdtToken.id,
        token1_address: ousdtAddress,
        stakedTickEdges: [...mockLiquidityPoolData.stakedTickEdges],
        stakedTickEdgeNets: [...mockLiquidityPoolData.stakedTickEdgeNets],
      };

      indexer.Pool.set(poolWithOusdt);
      indexer.Token.set(mockToken0Data as Token);
      indexer.Token.set(ousdtToken as Token);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Swap",
                srcAddress: srcAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                params: {
                  ...eventParams,
                  amount0In: 0n, // Explicitly set to 0 to ensure token1 is the input
                  amount1In: 100n * 10n ** 18n,
                  amount0Out: 99n * 10n ** 18n,
                  amount1Out: 0n, // Explicitly set to 0
                },
              },
            ],
          },
        },
      });

      // Check that OUSDTSwap entity was created
      const ousdtSwaps = await indexer.OUSDTSwaps.getAll();
      expect(ousdtSwaps.length).toBe(1);
      expect(ousdtSwaps[0]?.tokenInPool).toBe(ousdtAddress);
      expect(ousdtSwaps[0]?.tokenOutPool).toBe(mockToken0Data.address);
      expect(ousdtSwaps[0]?.amountIn).toBe(100n * 10n ** 18n);
      expect(ousdtSwaps[0]?.amountOut).toBe(99n * 10n ** 18n);
    });

    it("should not create OUSDTSwap entity when neither token is OUSDT", async () => {
      indexer.Pool.set({
        ...mockLiquidityPoolData,
        stakedTickEdges: [...mockLiquidityPoolData.stakedTickEdges],
        stakedTickEdgeNets: [...mockLiquidityPoolData.stakedTickEdgeNets],
      });
      indexer.Token.set(mockToken0Data as Token);
      indexer.Token.set(mockToken1Data as Token);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "Pool",
                event: "Swap",
                srcAddress: srcAddress,
                logIndex: 1,
                block: {
                  timestamp: blockTimestamp,
                  number: blockNumber,
                  hash: blockHash,
                },
                params: { ...eventParams },
              },
            ],
          },
        },
      });

      // Check that no OUSDTSwap entity was created
      const ousdtSwaps = await indexer.OUSDTSwaps.getAll();
      expect(ousdtSwaps.length).toBe(0);
    });
  });
});
