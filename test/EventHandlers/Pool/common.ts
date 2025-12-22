import type {
  ALM_LP_Wrapper,
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
} from "../../../generated/src/Types.gen";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  TokenIdByChain,
  toChecksumAddress,
} from "../../../src/Constants";

export function setupCommon() {
  const mockToken0Data: Token = {
    id: TokenIdByChain("0x1111111111111111111111111111111111111111", 10),
    address: "0x1111111111111111111111111111111111111111",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18n,
    pricePerUSDNew: 1n * TEN_TO_THE_18_BI, // 1 USD
    chainId: 10,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockToken1Data: Token = {
    id: TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
    address: "0x2222222222222222222222222222222222222222",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6n,
    pricePerUSDNew: 1n * TEN_TO_THE_18_BI, // 1 USD
    chainId: 10,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockLiquidityPoolData: LiquidityPoolAggregator = {
    id: toChecksumAddress("0x3333333333333333333333333333333333333333"),
    chainId: 10,
    token0_id: mockToken0Data.id,
    token1_id: mockToken1Data.id,
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
    isStable: false,
    reserve0: 200n * TEN_TO_THE_18_BI,
    reserve1: 200n * TEN_TO_THE_6_BI,
    totalLiquidityUSD: 400n * TEN_TO_THE_18_BI,
    totalVolume0: 1n * TEN_TO_THE_18_BI,
    totalVolume1: 1n * TEN_TO_THE_6_BI,
    totalVolumeUSD: 10n * TEN_TO_THE_18_BI,
    totalVolumeUSDWhitelisted: 10n * TEN_TO_THE_18_BI,
    gaugeFees0CurrentEpoch: 100n * TEN_TO_THE_18_BI,
    gaugeFees1CurrentEpoch: 200n * TEN_TO_THE_6_BI,
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
    totalBribesUSD: 1n * TEN_TO_THE_18_BI,
    gaugeIsAlive: true,
    isCL: false,
    lastUpdatedTimestamp: new Date(),
    lastSnapshotTimestamp: new Date(),
    token0IsWhitelisted: true,
    token1IsWhitelisted: true,
    name: "",
    // CL Pool specific fields (set to 0 for regular pools)
    feeProtocol0: 0n,
    feeProtocol1: 0n,
    observationCardinalityNext: 0n,
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
    // Pool Launcher relationship
    poolLauncherPoolId: undefined,
    // Voting fields
    gaugeAddress: "",
    gaugeEmissionsCap: 0n,
    // Dynamic Fee fields
    baseFee: undefined,
    feeCap: undefined,
    scalingFactor: undefined,
    currentFee: undefined,
    rootPoolMatchingHash: "",
    tickSpacing: 0n,
  };

  const mockALMLPWrapperData: ALM_LP_Wrapper = {
    id: `${toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")}_${mockLiquidityPoolData.chainId}`,
    chainId: mockLiquidityPoolData.chainId,
    pool: toChecksumAddress(mockLiquidityPoolData.id),
    token0: mockToken0Data.address,
    token1: mockToken1Data.address,
    // Wrapper-level aggregations
    amount0: 1000n * TEN_TO_THE_18_BI,
    amount1: 500n * TEN_TO_THE_6_BI,
    lpAmount: 2000n * TEN_TO_THE_18_BI,
    lastUpdatedTimestamp: new Date(900000 * 1000),
    // Strategy/Position-level state
    tokenId: 1n,
    tickLower: -1000n,
    tickUpper: 1000n,
    property: 3000n, // uint24 tick spacing
    liquidity: 1000000n,
    strategyType: 1n,
    tickNeighborhood: 100n,
    tickSpacing: 60n,
    positionWidth: 2000n,
    maxLiquidityRatioDeviationX96: 79228162514264337593543950336n, // 1 * 2^96
    creationTimestamp: new Date(900000 * 1000),
    strategyTransactionHash:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    ammStateIsDerived: false, // Default to false (from on-chain AMM position), tests can override
  };

  const defaultUserAddress = "0xAbCccccccccccccccccccccccccccccccccccccc";
  const mockUserStatsPerPoolData: UserStatsPerPool = {
    id: `${toChecksumAddress(defaultUserAddress)}_${toChecksumAddress(mockLiquidityPoolData.id)}_${mockLiquidityPoolData.chainId}`,
    userAddress: toChecksumAddress(defaultUserAddress),
    poolAddress: toChecksumAddress(mockLiquidityPoolData.id),
    chainId: mockLiquidityPoolData.chainId,

    // Liquidity metrics
    currentLiquidityUSD: 0n,
    currentLiquidityToken0: 0n,
    currentLiquidityToken1: 0n,
    totalLiquidityAddedUSD: 0n,
    totalLiquidityRemovedUSD: 0n,

    // Fee metrics
    totalFeesContributedUSD: 0n,
    totalFeesContributed0: 0n,
    totalFeesContributed1: 0n,

    // Swap metrics
    numberOfSwaps: 0n,
    totalSwapVolumeAmount0: 0n,
    totalSwapVolumeAmount1: 0n,
    totalSwapVolumeUSD: 0n,

    // Flash swap metrics
    numberOfFlashLoans: 0n,
    totalFlashLoanVolumeUSD: 0n,

    // Gauge metrics
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStaked: 0n,
    currentLiquidityStakedUSD: 0n,

    // Voting metrics
    totalBribeClaimed: 0n,
    totalBribeClaimedUSD: 0n,
    totalFeeRewardClaimed: 0n,
    totalFeeRewardClaimedUSD: 0n,
    veNFTamountStaked: 0n,

    // ALM metrics - initialized to empty/zero values
    almAddress: "",
    almAmount0: 0n,
    almAmount1: 0n,
    almLpAmount: 0n,

    // Timestamps
    firstActivityTimestamp: new Date(900000 * 1000),
    lastActivityTimestamp: new Date(900000 * 1000),
    lastAlmActivityTimestamp: new Date(900000 * 1000),
  };

  /**
   * Creates a mock UserStatsPerPool entity with customizable fields.
   * All fields default to zero/empty values, allowing tests to override only what they need.
   *
   * @param overrides - Partial UserStatsPerPool to override default values
   * @returns A complete UserStatsPerPool entity
   */
  function createMockUserStatsPerPool(
    overrides: Partial<UserStatsPerPool> = {},
  ): UserStatsPerPool {
    // Calculate id if userAddress, poolAddress, or chainId are provided
    const userAddress = toChecksumAddress(
      overrides.userAddress ?? defaultUserAddress,
    );
    const poolAddress = toChecksumAddress(
      overrides.poolAddress ?? mockLiquidityPoolData.id,
    );
    const chainId = overrides.chainId ?? mockLiquidityPoolData.chainId;
    const id = `${userAddress}_${poolAddress}_${chainId}`;

    return {
      ...mockUserStatsPerPoolData,
      id,
      userAddress,
      poolAddress,
      chainId,
      ...overrides,
    };
  }

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
    const poolAddress = toChecksumAddress(
      overrides.id ?? mockLiquidityPoolData.id,
    );
    const chainId = overrides.chainId ?? mockLiquidityPoolData.chainId;

    return {
      ...mockLiquidityPoolData,
      id: poolAddress,
      chainId,
      ...overrides,
    };
  }

  return {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    mockALMLPWrapperData,
    mockUserStatsPerPoolData,
    createMockUserStatsPerPool,
    createMockLiquidityPoolAggregator,
  };
}
