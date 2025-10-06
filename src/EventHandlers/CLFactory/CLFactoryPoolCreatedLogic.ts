import type {
  CLFactory_PoolCreated_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { TokenIdByChain } from "../../Constants";
import type { TokenEntityMapping } from "../../CustomTypes";
import { generatePoolName } from "../../Helpers";
import { createTokenEntity } from "../../PriceOracle";

export interface CLFactoryPoolCreatedResult {
  CLFactoryPoolCreatedEntity: {
    id: string;
    poolFactory: string;
    token0: string;
    token1: string;
    tickSpacing: bigint;
    pool: string;
    timestamp: Date;
    blockNumber: number;
    logIndex: number;
    chainId: number;
    transactionHash: string;
  };
  liquidityPoolAggregator?: LiquidityPoolAggregator;
  error?: string;
}

export interface CLFactoryPoolCreatedLoaderReturn {
  poolToken0: Token | undefined;
  poolToken1: Token | undefined;
}

export async function processCLFactoryPoolCreated(
  event: CLFactory_PoolCreated_event,
  loaderReturn: CLFactoryPoolCreatedLoaderReturn,
  context: handlerContext,
): Promise<CLFactoryPoolCreatedResult> {
  // Create the entity
  const CLFactoryPoolCreatedEntity = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    poolFactory: event.srcAddress,
    token0: TokenIdByChain(event.params.token0, event.chainId),
    token1: TokenIdByChain(event.params.token1, event.chainId),
    tickSpacing: event.params.tickSpacing,
    pool: event.params.pool,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  try {
    const { poolToken0, poolToken1 } = loaderReturn;
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
      totalFees0: 0n,
      totalFees1: 0n,
      gaugeFees0CurrentEpoch: 0n,
      gaugeFees1CurrentEpoch: 0n,
      totalFeesUSD: 0n,
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
    };

    return {
      CLFactoryPoolCreatedEntity,
      liquidityPoolAggregator,
    };
  } catch (error) {
    return {
      CLFactoryPoolCreatedEntity,
      error: `Error processing CLFactory PoolCreated: ${error}`,
    };
  }
}
