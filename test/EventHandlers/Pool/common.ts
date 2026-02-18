import { TickMath } from "@uniswap/v3-sdk";
import type {
  ALM_LP_Wrapper,
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
  VeNFTPoolVote,
  VeNFTState,
} from "../../../generated/src/Types.gen";
import {
  ALMLPWrapperId,
  PoolId,
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  TokenId,
  UserStatsPerPoolId,
  VeNFTId,
  VeNFTPoolVoteId,
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
    address: TOKEN0_ADDRESS,
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
    address: TOKEN1_ADDRESS,
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
    token0_address: mockToken0Data.address,
    token1_address: mockToken1Data.address,
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
    // Pool Launcher relationship
    poolLauncherPoolId: undefined,
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

  const mockALMLPWrapperData: ALM_LP_Wrapper = {
    id: ALMLPWrapperId(
      CHAIN_ID,
      toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ),
    chainId: CHAIN_ID,
    pool: POOL_ADDRESS,
    token0: mockToken0Data.address,
    token1: mockToken1Data.address,
    lpAmount: 2000n * TEN_TO_THE_18_BI,
    lastUpdatedTimestamp: new Date(900000 * 1000),
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
  };

  const defaultUserAddress = "0xAbCccccccccccccccccccccccccccccccccccccc";
  const normalizedDefaultUserAddress = toChecksumAddress(defaultUserAddress);
  const mockUserStatsPerPoolData: UserStatsPerPool = {
    id: UserStatsPerPoolId(
      CHAIN_ID,
      normalizedDefaultUserAddress,
      POOL_ADDRESS,
    ),
    userAddress: normalizedDefaultUserAddress,
    poolAddress: POOL_ADDRESS,
    chainId: CHAIN_ID,

    // Liquidity metrics
    currentLiquidityUSD: 0n,
    totalLiquidityAddedUSD: 0n,
    totalLiquidityAddedToken0: 0n,
    totalLiquidityAddedToken1: 0n,
    totalLiquidityRemovedUSD: 0n,
    totalLiquidityRemovedToken0: 0n,
    totalLiquidityRemovedToken1: 0n,
    lpBalance: 0n,

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
    totalStakedFeesCollected0: 0n,
    totalStakedFeesCollected1: 0n,
    totalStakedFeesCollectedUSD: 0n,
    totalUnstakedFeesCollected0: 0n,
    totalUnstakedFeesCollected1: 0n,
    totalUnstakedFeesCollectedUSD: 0n,
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
    almLpAmount: 0n,

    // Timestamps
    firstActivityTimestamp: new Date(900000 * 1000),
    lastActivityTimestamp: new Date(900000 * 1000),
    lastAlmActivityTimestamp: new Date(900000 * 1000),
  };

  const mockVeNFTStateData: VeNFTState = {
    id: VeNFTId(CHAIN_ID, 1n),
    chainId: CHAIN_ID,
    tokenId: 1n,
    owner: normalizedDefaultUserAddress,
    locktime: 0n,
    lastUpdatedTimestamp: new Date(900000 * 1000),
    totalValueLocked: 0n,
    isAlive: true,
  };

  const mockVeNFTPoolVoteData: VeNFTPoolVote = {
    id: VeNFTPoolVoteId(CHAIN_ID, 1n, POOL_ADDRESS),
    poolAddress: POOL_ADDRESS,
    veNFTamountStaked: 0n,
    veNFTState_id: mockVeNFTStateData.id,
    lastUpdatedTimestamp: new Date(900000 * 1000),
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
      overrides.poolAddress ?? POOL_ADDRESS,
    );
    const chainId = overrides.chainId ?? CHAIN_ID;
    const id = UserStatsPerPoolId(chainId, userAddress, poolAddress);

    return {
      ...mockUserStatsPerPoolData,
      ...overrides,
      id,
      userAddress,
      poolAddress,
      chainId,
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
   * Creates a mock VeNFTState entity with customizable fields.
   */
  function createMockVeNFTState(
    overrides: Partial<VeNFTState> = {},
  ): VeNFTState {
    const chainId = overrides.chainId ?? CHAIN_ID;
    const tokenId = overrides.tokenId ?? 1n;
    const id = overrides.id ?? VeNFTId(chainId, tokenId);

    return {
      ...mockVeNFTStateData,
      ...overrides,
      id,
      chainId,
      tokenId,
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
   * Creates a mock VeNFTPoolVote entity with customizable fields.
   */
  function createMockVeNFTPoolVote(
    overrides: Partial<VeNFTPoolVote> = {},
  ): VeNFTPoolVote {
    const veNFTStateId = overrides.veNFTState_id ?? mockVeNFTStateData.id;
    const [chainIdPart, tokenIdPart] = veNFTStateId.split("-");
    const chainId = chainIdPart ? Number(chainIdPart) : CHAIN_ID;
    const tokenId = tokenIdPart ? BigInt(tokenIdPart) : 1n;
    const poolAddress = toChecksumAddress(
      overrides.poolAddress ?? POOL_ADDRESS,
    );
    const id = overrides.id ?? VeNFTPoolVoteId(chainId, tokenId, poolAddress);

    return {
      ...mockVeNFTPoolVoteData,
      ...overrides,
      id,
      poolAddress,
      veNFTState_id: veNFTStateId,
    };
  }

  return {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    mockALMLPWrapperData,
    mockUserStatsPerPoolData,
    mockVeNFTStateData,
    mockVeNFTPoolVoteData,
    createMockToken,
    createMockUserStatsPerPool,
    createMockLiquidityPoolAggregator,
    createMockVeNFTState,
    createMockVeNFTPoolVote,
  };
}
