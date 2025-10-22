import type {
  LiquidityPoolAggregator,
  Token,
} from "../../../generated/src/Types.gen";
import {
  TEN_TO_THE_6_BI,
  TEN_TO_THE_18_BI,
  TokenIdByChain,
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
    id: "0x3333333333333333333333333333333333333333",
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
    totalFees0: 100n * TEN_TO_THE_18_BI,
    totalFees1: 200n * TEN_TO_THE_6_BI,
    totalFeesUSD: 300n * TEN_TO_THE_18_BI,
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
    numberOfVotes: 0n,
    currentVotingPower: 0n,
  };

  return {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
  };
}
