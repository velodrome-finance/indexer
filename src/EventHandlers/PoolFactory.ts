import { PoolFactory, type PoolFactory_SetCustomFee } from "generated";
import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { TokenIdByChain } from "../Constants";
import { createTokenEntity } from "../PriceOracle";
import type { TokenEntityMapping } from "./../CustomTypes";
import { generatePoolName } from "./../Helpers";
import type {
  LiquidityPoolAggregator,
  PoolFactory_PoolCreated,
} from "./../src/Types.gen";

PoolFactory.PoolCreated.contractRegister(({ event, context }) => {
  context.addPool(event.params.pool);
});

PoolFactory.PoolCreated.handler(async ({ event, context }) => {
  // Load token instances efficiently
  const [poolToken0, poolToken1] = await Promise.all([
    context.Token.get(TokenIdByChain(event.params.token0, event.chainId)),
    context.Token.get(TokenIdByChain(event.params.token1, event.chainId)),
  ]);

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const entity: PoolFactory_PoolCreated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    poolFactory: event.srcAddress,
    token0: TokenIdByChain(event.params.token0, event.chainId),
    token1: TokenIdByChain(event.params.token1, event.chainId),
    stable: event.params.stable,
    pool: event.params.pool,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.PoolFactory_PoolCreated.set(entity);

  const poolTokenSymbols: string[] = [];
  const poolTokenAddressMappings: TokenEntityMapping[] = [
    { address: event.params.token0, tokenInstance: poolToken0 },
    { address: event.params.token1, tokenInstance: poolToken1 },
  ];

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
          `Error in pool factory fetching token details for ${poolTokenAddressMapping.address} on chain ${event.chainId}: ${error}`,
        );
      }
    } else {
      poolTokenSymbols.push(poolTokenAddressMapping.tokenInstance.symbol);
    }
  }

  const pool: LiquidityPoolAggregator = {
    id: event.params.pool,
    chainId: event.chainId,
    isCL: false,
    name: generatePoolName(
      poolTokenSymbols[0],
      poolTokenSymbols[1],
      event.params.stable,
      0, // Pool is not CL
    ),
    token0_id: TokenIdByChain(event.params.token0, event.chainId),
    token1_id: TokenIdByChain(event.params.token1, event.chainId),
    token0_address: event.params.token0,
    token1_address: event.params.token1,
    isStable: event.params.stable,
    reserve0: 0n,
    reserve1: 0n,
    totalLiquidityUSD: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalVolumeUSDWhitelisted: 0n,
    gaugeFees0CurrentEpoch: 0n,
    gaugeFees1CurrentEpoch: 0n,
    totalFees0: 0n,
    totalFees1: 0n,
    totalFeesUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
    numberOfSwaps: 0n,
    token0Price: 0n,
    token1Price: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalBribesUSD: 0n,
    totalVotesDeposited: 0n,
    totalVotesDepositedUSD: 0n,
    gaugeIsAlive: false,
    token0IsWhitelisted: poolToken0?.isWhitelisted ?? false,
    token1IsWhitelisted: poolToken1?.isWhitelisted ?? false,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
    lastSnapshotTimestamp: new Date(event.block.timestamp * 1000),
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
    currentLiquidityStakedUSD: 0n,
  };

  updateLiquidityPoolAggregator(
    pool,
    pool,
    pool.lastUpdatedTimestamp,
    context,
    event.block.number,
  );
});

PoolFactory.SetCustomFee.handler(async ({ event, context }) => {
  const entity: PoolFactory_SetCustomFee = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    pool: event.params.pool,
    fee: event.params.fee,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  context.PoolFactory_SetCustomFee.set(entity);
});
