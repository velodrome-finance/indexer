import type {
  CLFactory_PoolCreated_event,
  CLGaugeConfig,
  FeeToTickSpacingMapping,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { createLiquidityPoolAggregatorEntity } from "../../Aggregators/LiquidityPoolAggregator";
import type { TokenEntityMapping } from "../../CustomTypes";
import { createTokenEntity } from "../../PriceOracle";

export interface CLFactoryPoolCreatedResult {
  liquidityPoolAggregator: LiquidityPoolAggregator;
}

export async function processCLFactoryPoolCreated(
  event: CLFactory_PoolCreated_event,
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
