import type {
  CLFactory_PoolCreated_event,
  CLGaugeConfig,
  FeeToTickSpacingMapping,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { createLiquidityPoolAggregatorEntity } from "../../Aggregators/LiquidityPoolAggregator";
import { RootPoolLeafPoolId, rootPoolMatchingHash } from "../../Constants";
import type { TokenEntityMapping } from "../../CustomTypes";
import { createTokenEntity } from "../../PriceOracle";
import { processAllPendingVotesForRootPool } from "../Voter/PendingVoteProcessing";

export interface CLFactoryPoolCreatedResult {
  liquidityPoolAggregator: LiquidityPoolAggregator;
}

export async function processCLFactoryPoolCreated(
  event: CLFactory_PoolCreated_event,
  factoryAddress: string,
  poolToken0: Token | undefined,
  poolToken1: Token | undefined,
  CLGaugeConfig: CLGaugeConfig | undefined,
  feeToTickSpacingMapping: FeeToTickSpacingMapping,
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
    const liquidityPoolAggregator = createLiquidityPoolAggregatorEntity({
      poolAddress: event.params.pool,
      chainId: event.chainId,
      isCL: true,
      isStable: false,
      token0Address: event.params.token0,
      token1Address: event.params.token1,
      token0Symbol: poolTokenSymbols[0],
      token1Symbol: poolTokenSymbols[1],
      timestamp: new Date(event.block.timestamp * 1000),
      tickSpacing: Number(event.params.tickSpacing),
      CLGaugeConfig: CLGaugeConfig,
      factoryAddress: factoryAddress,
      // From what I've researched, there's always a TickSpacingEnabled event
      // with the appropriate tick spacing <-> fee mapping before a CL pool with the same tick spacing is created
      // CLFactoryPool constructor calls enableTickSpacing which emits TickSpacingEnabled event
      baseFee: feeToTickSpacingMapping.fee,
      currentFee: feeToTickSpacingMapping.fee,
    });

    return {
      liquidityPoolAggregator,
    };
  } catch (error) {
    context.log.error(`Error processing CLFactory PoolCreated: ${error}`);
    // Re-throw to let the caller handle it
    throw error;
  }
}

/**
 * If a PendingRootPoolMapping exists for this leaf pool's (token0, token1, tickSpacing),
 * creates the RootPool_LeafPool mapping, deletes the pending mapping, and flushes any
 * pending votes for that root pool.
 * @param context - The handler context
 * @param leafChainId - The chain ID of the leaf pool
 * @param token0 - The address of token0
 * @param token1 - The address of token1
 * @param tickSpacing - The tick spacing of the pool
 * @param leafPoolAddress - The address of the leaf pool
 * @returns void
 */
export async function flushPendingRootPoolMappingAndVotes(
  context: handlerContext,
  leafChainId: number,
  token0: string,
  token1: string,
  tickSpacing: bigint | number,
  leafPoolAddress: string,
): Promise<void> {
  const hash = rootPoolMatchingHash(leafChainId, token0, token1, tickSpacing);
  const pendingMappings =
    (await context.PendingRootPoolMapping.getWhere({
      rootPoolMatchingHash: { _eq: hash },
    })) ?? [];
  if (pendingMappings.length === 0) {
    context.log.info(
      `[flushPendingRootPoolMappingAndVotes] No PendingRootPoolMapping for rootPoolMatchingHash ${hash}.`,
    );
    return;
  }

  if (pendingMappings.length > 1) {
    context.log.warn(
      `[flushPendingRootPoolMappingAndVotes] Multiple PendingRootPoolMapping entries for rootPoolMatchingHash ${hash}. Processing first only.`,
    );
  }

  const pending = pendingMappings[0];
  context.RootPool_LeafPool.set({
    id: RootPoolLeafPoolId(
      pending.rootChainId,
      leafChainId,
      pending.rootPoolAddress,
      leafPoolAddress,
    ),
    rootChainId: pending.rootChainId,
    rootPoolAddress: pending.rootPoolAddress,
    leafChainId,
    leafPoolAddress,
  });
  context.PendingRootPoolMapping.deleteUnsafe(pending.id);
  try {
    await processAllPendingVotesForRootPool(context, pending.rootPoolAddress);
  } catch (error) {
    context.log.error(
      `[flushPendingRootPoolMappingAndVotes] processAllPendingVotesForRootPool failed for rootPoolAddress ${pending.rootPoolAddress}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
