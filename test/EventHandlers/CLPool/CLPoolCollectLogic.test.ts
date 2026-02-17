import type {
  CLPool_Collect_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { processCLPoolCollect } from "../../../src/EventHandlers/CLPool/CLPoolCollectLogic";
import { setupCommon } from "../Pool/common";

describe("CLPoolCollectLogic", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const mockEvent: CLPool_Collect_event = {
    params: {
      owner: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      tickLower: 100000n,
      tickUpper: 200000n,
      amount0: 1000000000000000000n, // 1 token
      amount1: 2000000000000000000n, // 2 tokens
    },
    block: {
      timestamp: 1000000,
      number: 123456,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    },
    chainId: 10,
    logIndex: 1,
    srcAddress: "0x3333333333333333333333333333333333333333",
    transaction: {
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
  } as CLPool_Collect_event;

  const mockLiquidityPoolAggregator: LiquidityPoolAggregator = {
    ...mockLiquidityPoolData,
    id: "0x1234567890123456789012345678901234567890",
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    isCL: true,
    reserve0: 10000000n,
    reserve1: 6000000n,
    totalLiquidityUSD: 10000000n,
    token0Price: 1000000000000000000n,
    token1Price: 2000000000000000000n,
    gaugeIsAlive: false,
    totalUnstakedFeesCollected0: 0n,
    totalUnstakedFeesCollected1: 0n,
    totalUnstakedFeesCollectedUSD: 0n,
    totalStakedFeesCollected0: 0n,
    totalStakedFeesCollected1: 0n,
    totalStakedFeesCollectedUSD: 0n,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
    lastSnapshotTimestamp: new Date(1000000 * 1000),
  };

  const mockToken0: Token = {
    ...mockToken0Data,
    id: "token0_id",
    address: "0xtoken0",
    symbol: "TOKEN0",
    name: "Token 0",
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  const mockToken1: Token = {
    ...mockToken1Data,
    id: "token1_id",
    address: "0xtoken1",
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: 2000000000000000000n,
    isWhitelisted: false,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  };

  describe("processCLPoolCollect", () => {
    it("should process collect event successfully with valid data", () => {
      const result = processCLPoolCollect(mockEvent, mockToken0, mockToken1);

      // Check unstaked fees in liquidity pool diff
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(1000000000000000000n); // amount0
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(2000000000000000000n); // amount1
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(5000000000000000000n); // 5 USD in 18 decimals

      // Check user unstaked fees collected diff with exact values
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(1000000000000000000n); // amount0
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(2000000000000000000n); // amount1
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(5000000000000000000n); // 5 USD in 18 decimals
    });

    it("should handle different token decimals correctly", () => {
      const tokenWithDifferentDecimals: Token = {
        ...mockToken0,
        decimals: 6n, // USDC-like token
      };

      const result = processCLPoolCollect(
        mockEvent,
        tokenWithDifferentDecimals,
        mockToken1,
      );

      expect(result.liquidityPoolDiff).toBeDefined();
      expect(result.userLiquidityDiff).toBeDefined();
    });

    it("should handle zero amounts correctly", () => {
      const eventWithZeroAmounts: CLPool_Collect_event = {
        ...mockEvent,
        params: {
          ...mockEvent.params,
          amount0: 0n,
          amount1: 0n,
        },
      };

      const result = processCLPoolCollect(
        eventWithZeroAmounts,
        mockToken0,
        mockToken1,
      );

      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(0n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(0n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(0n);
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(0n);
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(0n);
      expect(
        result.userLiquidityDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(0n);
    });

    it("should only track unstaked fees, not staked fees", () => {
      const result = processCLPoolCollect(mockEvent, mockToken0, mockToken1);

      // Collect events should only update unstaked fees
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected0,
      ).toBe(1000000000000000000n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollected1,
      ).toBe(2000000000000000000n);
      expect(
        result.liquidityPoolDiff.incrementalTotalUnstakedFeesCollectedUSD,
      ).toBe(5000000000000000000n);
      // Neither mock token is whitelisted, so whitelisted increment is 0n
      expect(result.liquidityPoolDiff.incrementalTotalFeesUSDWhitelisted).toBe(
        0n,
      );

      // Staked fees should not be present in the diff (they're undefined, not 0)
      // The aggregator will handle the addition, but the diff only contains unstaked fees
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalTotalStakedFeesCollected0",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalTotalStakedFeesCollected1",
      );
      expect(result.liquidityPoolDiff).not.toHaveProperty(
        "incrementalTotalStakedFeesCollectedUSD",
      );
    });
  });
});
