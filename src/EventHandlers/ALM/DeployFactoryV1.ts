import { ALMDeployFactoryV1 } from "generated";
import { toChecksumAddress } from "../../Constants";
import { getSqrtPriceX96 } from "../../Effects/Index";
import { calculatePositionAmountsFromLiquidity } from "../../Helpers";

ALMDeployFactoryV1.StrategyCreated.contractRegister(({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, synthetixFarm, caller] =
    event.params.params;
  context.addALMLPWrapperV1(lpWrapper);
});

ALMDeployFactoryV1.StrategyCreated.handler(async ({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, synthetixFarm, caller] =
    event.params.params;

  const [strategyType, tickNeighborhood, tickSpacing, width] = strategyParams;

  // In DeployFactoryV1, ammPosition is a single tuple (V2 uses an array)
  // Contract relationship: 1 LP wrapper per pool, 1 strategy per LP wrapper, 1 tokenId per strategy, 1 AMM position per tokenId
  const [token0, token1, property, tickLower, tickUpper, liquidity] =
    ammPosition;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Query NonFungiblePosition by mintTransactionHash (already stored in position)
  const nonFungiblePositions =
    await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
      event.transaction.hash,
    );

  // Filter by matching fields
  const matchingPositions =
    nonFungiblePositions?.filter(
      (pos) =>
        pos.chainId === event.chainId &&
        pos.tickLower === tickLower &&
        pos.tickUpper === tickUpper &&
        pos.liquidity === liquidity &&
        pos.token0 === token0 &&
        pos.token1 === token1,
    ) ?? [];

  if (matchingPositions.length === 0) {
    context.log.error(
      `[ALMDeployFactoryV1] NonFungiblePosition not found for transaction hash ${event.transaction.hash} matching tickLower ${tickLower}, tickUpper ${tickUpper}, liquidity ${liquidity}. It should have been created by CLPool event handlers.`,
    );
    return;
  }

  if (matchingPositions.length > 1) {
    context.log.warn(
      `[ALMDeployFactoryV1] Multiple NonFungiblePositions found for transaction hash ${event.transaction.hash} with the same tick lower ${tickLower}, tick upper ${tickUpper}, liquidity ${liquidity}, token0 ${token0} and token1 ${token1}. Using the first match.`,
    );
  }

  // there should, in principle, one unique non fungible position that has
  // simultaneously the same transaction hash,tickLower, tickUpper, liquidity and token0 and token1
  const position = matchingPositions[0];
  const tokenId = position.tokenId;

  // Compute amount0/amount1 from liquidity + sqrtPriceX96 + ticks (amount0/amount1 removed from schema)
  // Fetch sqrtPriceX96 from pool aggregator or RPC
  const liquidityPoolAggregator = await context.LiquidityPoolAggregator.get(
    toChecksumAddress(pool),
  );
  let sqrtPriceX96: bigint | undefined =
    liquidityPoolAggregator?.sqrtPriceX96 ?? undefined;

  if (!sqrtPriceX96) {
    // Fallback to RPC
    sqrtPriceX96 = await context.effect(getSqrtPriceX96, {
      poolAddress: toChecksumAddress(pool),
      chainId: event.chainId,
      blockNumber: event.block.number,
    });
  }

  let amount0 = 0n;
  let amount1 = 0n;
  if (sqrtPriceX96) {
    const amounts = calculatePositionAmountsFromLiquidity(
      liquidity,
      sqrtPriceX96,
      tickLower,
      tickUpper,
    );
    amount0 = amounts.amount0;
    amount1 = amounts.amount1;
  } else {
    context.log.warn(
      `[ALMDeployFactoryV1] Could not fetch sqrtPriceX96 for pool ${pool} to compute amount0/amount1, using 0`,
    );
  }

  // In DeployFactoryV1, lpWrapper.initialize() receives position.liquidity as initialTotalSupply
  // and mints that amount as LP tokens. So the initial LP token supply equals the liquidity value.
  // Note: Unlike V2, V1 doesn't emit TotalSupplyLimitUpdated event, so we use liquidity directly.
  const initialTotalSupplyLPTokens = liquidity;

  // Create ALM_LP_Wrapper (single entity tracks both wrapper and strategy)
  // This single entity contains both wrapper-level aggregations and strategy/position state
  // Note: DeployFactoryV1 doesn't have maxLiquidityRatioDeviationX96 in strategyParams,
  // so we set it to 0n as a default value (required by schema)
  context.ALM_LP_Wrapper.set({
    id: `${toChecksumAddress(lpWrapper)}_${event.chainId}`,
    chainId: event.chainId,
    pool: toChecksumAddress(pool),
    token0: toChecksumAddress(token0),
    token1: toChecksumAddress(token1),

    amount0: amount0,
    amount1: amount1,
    lpAmount: initialTotalSupplyLPTokens,
    lastUpdatedTimestamp: timestamp,

    tokenId: tokenId,
    tickLower: tickLower,
    tickUpper: tickUpper,
    property: property,
    liquidity: liquidity,
    strategyType: strategyType,
    tickNeighborhood: tickNeighborhood,
    tickSpacing: tickSpacing,
    positionWidth: width,
    maxLiquidityRatioDeviationX96: 0n, // Not present in DeployFactoryV1 strategyParams, defaulting to 0
    ammStateIsDerived: false, // State comes from on-chain AMM position (StrategyCreated event), not derived from amounts
    creationTimestamp: timestamp,
    strategyTransactionHash: event.transaction.hash,
  });
});
