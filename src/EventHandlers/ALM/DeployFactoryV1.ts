import { ALMDeployFactoryV1 } from "generated";
import { ALMLPWrapperId } from "../../Constants";

ALMDeployFactoryV1.StrategyCreated.contractRegister(({ event, context }) => {
  const [, , , lpWrapper, ,] = event.params.params;
  context.addALMLPWrapperV1(lpWrapper);
});

ALMDeployFactoryV1.StrategyCreated.handler(async ({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, ,] = event.params.params;

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

  // In DeployFactoryV1, lpWrapper.initialize() receives position.liquidity as initialTotalSupply
  // and mints that amount as LP tokens. So the initial LP token supply equals the liquidity value.
  // Note: Unlike V2, V1 doesn't emit TotalSupplyLimitUpdated event, so we use liquidity directly.
  const initialTotalSupplyLPTokens = liquidity;

  // Create ALM_LP_Wrapper (single entity tracks both wrapper and strategy)
  // amount0/amount1 are derived at snapshot time from liquidity + sqrtPriceX96 + ticks
  context.ALM_LP_Wrapper.set({
    id: ALMLPWrapperId(event.chainId, lpWrapper),
    chainId: event.chainId,
    pool: pool,
    token0: token0,
    token1: token1,

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
    creationTimestamp: timestamp,
    strategyTransactionHash: event.transaction.hash,
    lastSnapshotTimestamp: undefined,
  });
});
