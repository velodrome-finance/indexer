import type {
  CLFactory_PoolCreated_event,
  CLGaugeConfig,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { TokenIdByChain } from "../../Constants";
import type { TokenEntityMapping } from "../../CustomTypes";
import { generatePoolName } from "../../Helpers";
import { createTokenEntity } from "../../PriceOracle";

export interface CLFactoryPoolCreatedResult {
  liquidityPoolAggregator: LiquidityPoolAggregator;
}

export async function processCLFactoryPoolCreated(
  event: CLFactory_PoolCreated_event,
  poolToken0: Token | undefined,
  poolToken1: Token | undefined,
  CLGaugeConfig: CLGaugeConfig | undefined,
  context: handlerContext,
): Promise<CLFactoryPoolCreatedResult> {
  try {
    const poolTokenSymbols: string[] = [];
    const poolTokenAddressMappings: TokenEntityMapping[] = [
      { address: event.params.token0, tokenInstance: poolToken0 },
      { address: event.params.token1, tokenInstance: poolToken1 },
    ];

    // Handle token creation and validation
    for (const poolTokenAddressMapping of poolTokenAddressMappings) {
      if (poolTokenAddressMapping.tokenInstance === undefined) {
        try {
          poolTokenAddressMapping.tokenInstance = await createTokenEntity(
            poolTokenAddressMapping.address,
            event.chainId,
            event.block.number,
            context,
          );
          poolTokenSymbols.push(poolTokenAddressMapping.tokenInstance.symbol);
        } catch (error) {
          context.log.error(
            `Error in cl factory fetching token details for ${poolTokenAddressMapping.address} on chain ${event.chainId}: ${error}`,
          );
        }
      } else {
        poolTokenSymbols.push(poolTokenAddressMapping.tokenInstance.symbol);
      }
    }

    // Create the liquidity pool aggregator
    const liquidityPoolAggregator: LiquidityPoolAggregator = {
      id: event.params.pool,
      chainId: event.chainId,
      name: generatePoolName(
        poolTokenSymbols[0],
        poolTokenSymbols[1],
        false, // Pool is not stable
        Number(event.params.tickSpacing), // Pool is CL
      ),
      token0_id: TokenIdByChain(event.params.token0, event.chainId),
      token1_id: TokenIdByChain(event.params.token1, event.chainId),
      token0_address: event.params.token0,
      token1_address: event.params.token1,
      isStable: false,
      isCL: true,
      reserve0: 0n,
      reserve1: 0n,
      totalLiquidityUSD: 0n,
      totalVolume0: 0n,
      totalVolume1: 0n,
      totalVolumeUSD: 0n,
      totalVolumeUSDWhitelisted: 0n,
      gaugeFees0CurrentEpoch: 0n,
      gaugeFees1CurrentEpoch: 0n,
      totalUnstakedFeesCollected0: 0n,
      totalUnstakedFeesCollected1: 0n,
      totalStakedFeesCollected0: 0n,
      totalStakedFeesCollected1: 0n,
      totalUnstakedFeesCollectedUSD: 0n,
      totalStakedFeesCollectedUSD: 0n,
      totalFeesUSDWhitelisted: 0n,
      numberOfSwaps: 0n,
      token0Price: 0n,
      token1Price: 0n,
      totalVotesDeposited: 0n,
      totalVotesDepositedUSD: 0n,
      totalEmissions: 0n,
      totalEmissionsUSD: 0n,
      totalBribesUSD: 0n,
      gaugeIsAlive: false,
      token0IsWhitelisted: poolToken0?.isWhitelisted ?? false,
      token1IsWhitelisted: poolToken1?.isWhitelisted ?? false,
      lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      lastSnapshotTimestamp: new Date(event.block.timestamp * 1000),
      // CL Pool specific fields
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
      // Pool Launcher relationship (undefined for pools not launched via PoolLauncher)
      poolLauncherPoolId: undefined,
      // Voting fields
      gaugeAddress: "",
      // Set to undefined if CLGaugeConfig does not exist (i.e before the deployment of NewCLGaugeFactory which introduces emissions caps per gauge)
      // Otherwise, set to defaultEmissionCap
      gaugeEmissionsCap: CLGaugeConfig
        ? CLGaugeConfig.defaultEmissionsCap
        : undefined,
      numberOfVotes: 0n,
      currentVotingPower: 0n,
      // Dynamic Fee fields (undefined initially)
      baseFee: undefined,
      feeCap: undefined,
      scalingFactor: undefined,
      currentFee: undefined,
    };

    return {
      liquidityPoolAggregator,
    };
  } catch (error) {
    context.log.error(`Error processing CLFactory PoolCreated: ${error}`);
    // Re-throw to let the caller handle it
    throw error;
  }
}
