import { TickMath } from "@uniswap/v3-sdk";
import type { LiquidityPoolAggregator, Token, handlerContext } from "generated";
import {
  PoolId,
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import { calculateTokenAmountUSD } from "../../../src/Helpers";

export function setupCommon() {
  const CHAIN_ID = 10;
  const POOL_ADDRESS = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const POOL_ID = PoolId(CHAIN_ID, POOL_ADDRESS);

  const TOKEN0_ADDRESS = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const TOKEN1_ADDRESS = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );

  const mockToken0Data: Token = {
    id: TokenId(CHAIN_ID, TOKEN0_ADDRESS),
    address: TOKEN0_ADDRESS as `0x${string}`,
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18n,
    pricePerUSDNew: 1n * TEN_TO_THE_18_BI, // 1 USD
    chainId: CHAIN_ID,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockToken1Data: Token = {
    id: TokenId(CHAIN_ID, TOKEN1_ADDRESS),
    address: TOKEN1_ADDRESS as `0x${string}`,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
    pricePerUSDNew: 1n * TEN_TO_THE_18_BI, // 1 USD
    chainId: CHAIN_ID,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockLiquidityPoolData: LiquidityPoolAggregator = {
    id: POOL_ID,
    poolAddress: POOL_ADDRESS,
    chainId: CHAIN_ID,
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address as `0x${string}`,
    token1_address: mockToken1Data.address as `0x${string}`,
    isStable: false,
    reserve0: 200n * TEN_TO_THE_18_BI,
    reserve1: 200n * TEN_TO_THE_6_BI,
    totalLPTokenSupply: 0n,
    totalLiquidityUSD: 400n * TEN_TO_THE_18_BI,
    totalVolume0: 1n * TEN_TO_THE_18_BI,
    totalVolume1: 1n * TEN_TO_THE_6_BI,
    totalVolumeUSD: 10n * TEN_TO_THE_18_BI,
    totalVolumeUSDWhitelisted: 10n * TEN_TO_THE_18_BI,
    totalFeesGenerated0: 100n * TEN_TO_THE_18_BI,
    totalFeesGenerated1: 200n * TEN_TO_THE_6_BI,
    // Calculate totalFeesGeneratedUSD using the same logic as calculateTotalUSD:
    // token0: calculateTokenAmountUSD(100n * 10^18, 18, 1n * 10^18) = 100n * 10^18 USD
    // token1: calculateTokenAmountUSD(200n * 10^6, 6, 1n * 10^18) = 200n * 10^18 USD
    // total = 100n * 10^18 + 200n * 10^18 = 300n * 10^18 USD
    totalFeesGeneratedUSD:
      calculateTokenAmountUSD(
        100n * TEN_TO_THE_18_BI,
        18,
        mockToken0Data.pricePerUSDNew,
      ) +
      calculateTokenAmountUSD(
        200n * TEN_TO_THE_6_BI,
        6,
        mockToken1Data.pricePerUSDNew,
      ),
    totalUnstakedFeesCollected0: 100n * TEN_TO_THE_18_BI,
    totalUnstakedFeesCollected1: 200n * TEN_TO_THE_6_BI,
    totalStakedFeesCollected0: 0n,
    totalStakedFeesCollected1: 0n,
    totalUnstakedFeesCollectedUSD: 300n * TEN_TO_THE_18_BI,
    totalStakedFeesCollectedUSD: 0n,
    totalFeesUSDWhitelisted: 300n * TEN_TO_THE_18_BI,
    numberOfSwaps: 1n,
    token0Price: 1n * TEN_TO_THE_18_BI,
    token1Price: 1n * TEN_TO_THE_18_BI,
    totalVotesDeposited: 1n,
    totalVotesDepositedUSD: 1n * TEN_TO_THE_18_BI,
    totalEmissions: 1n,
    totalEmissionsUSD: 1n * TEN_TO_THE_18_BI,
    gaugeIsAlive: true,
    isCL: false,
    lastUpdatedTimestamp: new Date(),
    lastSnapshotTimestamp: new Date(),
    name: "",
    // CL Pool specific fields (set to 0 for regular pools)
    feeProtocol0: 0n,
    feeProtocol1: 0n,
    observationCardinalityNext: 0n,
    // Calculate sqrtPriceX96 from tick 0 (middle of range) to get both amount0 and amount1
    sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(0).toString()),
    tick: 0n,
    totalFlashLoanFees0: 0n,
    totalFlashLoanFees1: 0n,
    totalFlashLoanFeesUSD: 0n,
    totalFlashLoanVolumeUSD: 0n,
    numberOfFlashLoans: 0n,
    // Gauge fields
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStaked: 0n,
    currentLiquidityStakedUSD: 0n,

    // Voting Reward fields
    bribeVotingRewardAddress: "",
    totalBribeClaimed: 0n,
    totalBribeClaimedUSD: 0n,
    feeVotingRewardAddress: "",
    totalFeeRewardClaimed: 0n,
    totalFeeRewardClaimedUSD: 0n,
    veNFTamountStaked: 0n,
    // Address of the factory that created this pool (e.g. CLFactory for CL pools)
    factoryAddress: "",
    // Voting fields
    gaugeAddress: "",
    gaugeEmissionsCap: 0n,
    // Dynamic Fee fields
    baseFee: 0n,
    feeCap: undefined,
    scalingFactor: undefined,
    currentFee: 0n,
    rootPoolMatchingHash: "",
    tickSpacing: 0n,
  };

  /**
   * Creates a mock LiquidityPoolAggregator entity with customizable fields.
   * All fields default to values from mockLiquidityPoolData, allowing tests to override only what they need.
   *
   * @param overrides - Partial LiquidityPoolAggregator to override default values
   * @returns A complete LiquidityPoolAggregator entity
   */
  function createMockLiquidityPoolAggregator(
    overrides: Partial<LiquidityPoolAggregator> = {},
  ): LiquidityPoolAggregator {
    // Calculate id if poolAddress or chainId are provided
    const chainId = overrides.chainId ?? CHAIN_ID;
    const poolAddress = toChecksumAddress(
      overrides.poolAddress ?? POOL_ADDRESS,
    );
    const id = overrides.id ?? PoolId(chainId, poolAddress);

    return {
      ...mockLiquidityPoolData,
      ...overrides,
      poolAddress,
      chainId,
      id,
    };
  }

  /**
   * Creates a mock Token with customizable fields. Use for token variants (e.g. different decimals).
   * @param overrides - Partial Token to override default values
   * @param base - Base token to copy from (defaults to mockToken0Data)
   */
  function createMockToken(
    overrides: Partial<Token> = {},
    base: Token = mockToken0Data,
  ): Token {
    return { ...base, ...overrides };
  }

  /**
   * Builds a minimal handlerContext with only the given entities.
   * Each key is an entity name (e.g. "VeNFTStateSnapshot"); each value is an object with the methods to mock (e.g. { set: vi.fn() }).
   * Use for snapshot tests and any test that only needs to spy on entity methods.
   */
  function createMockContext(
    entities: Record<string, Record<string, unknown>>,
  ): handlerContext {
    return { ...entities } as unknown as handlerContext;
  }

  return {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    createMockToken,
    createMockLiquidityPoolAggregator,
    createMockContext,
  };
}
