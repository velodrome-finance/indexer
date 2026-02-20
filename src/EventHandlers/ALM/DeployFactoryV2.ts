import { ALMDeployFactoryV2, type NonFungiblePosition } from "generated";
import { ALMLPWrapperId } from "../../Constants";

ALMDeployFactoryV2.StrategyCreated.contractRegister(({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, caller] =
    event.params.params;
  context.addALMLPWrapperV2(lpWrapper);
});

ALMDeployFactoryV2.StrategyCreated.handler(async ({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, caller] =
    event.params.params;

  const [
    strategyType,
    tickNeighborhood,
    tickSpacing,
    width,
    maxLiquidityRatioDeviationX96,
  ] = strategyParams;

  // Contract relationship: 1 LP wrapper per pool, 1 strategy per LP wrapper, 1 tokenId per strategy, 1 AMM position per tokenId
  // Therefore ammPosition array should have exactly 1 element (not a loop)
  const [token0, token1, property, tickLower, tickUpper, liquidity] =
    ammPosition[0];

  const timestamp = new Date(event.block.timestamp * 1000);

  // Query NonFungiblePosition by mintTransactionHash (already stored in position)
  const nonFungiblePositions = await context.NonFungiblePosition.getWhere({
    mintTransactionHash: { _eq: event.transaction.hash },
  });

  // Filter by matching fields
  const matchingPositions =
    nonFungiblePositions?.filter(
      (pos: NonFungiblePosition) =>
        pos.chainId === event.chainId &&
        pos.tickLower === tickLower &&
        pos.tickUpper === tickUpper &&
        pos.liquidity === liquidity &&
        pos.token0 === token0 &&
        pos.token1 === token1,
    ) ?? [];

  if (matchingPositions.length === 0) {
    context.log.error(
      `[ALMDeployFactoryV2] NonFungiblePosition not found for transaction hash ${event.transaction.hash} (chainId: ${event.chainId}, pool: ${pool}) matching tickLower ${tickLower}, tickUpper ${tickUpper}, liquidity ${liquidity}. It should have been created by CLPool event handlers.`,
    );
    return;
  }

  if (matchingPositions.length > 1) {
    context.log.warn(
      `[ALMDeployFactoryV2] Multiple NonFungiblePositions found for transaction hash ${event.transaction.hash} with the same tick lower ${tickLower}, tick upper ${tickUpper}, liquidity ${liquidity}, token0 ${token0} and token1 ${token1}. Using the first match.`,
    );
  }

  // there should, in principle, one unique non fungible position that has
  // simultaneously the same transaction hash,tickLower, tickUpper, liquidity and token0 and token1
  const position = matchingPositions[0];
  const tokenId = position.tokenId;

  // Fetching LP tokens supply from TotalSupplyLimitUpdated event
  const totalSupplyEvent = await context.ALM_TotalSupplyLimitUpdated_event.get(
    ALMLPWrapperId(event.chainId, lpWrapper),
  );

  if (
    !totalSupplyEvent ||
    totalSupplyEvent.transactionHash !== event.transaction.hash
  ) {
    context.log.error(
      `[ALMDeployFactoryV2] ALM_TotalSupplyLimitUpdated_event not found for lpWrapper ${lpWrapper} and chainId ${event.chainId} or transaction hash ${event.transaction.hash} does not match. It should have been created by ALMLPWrapper event handlers.`,
    );
    return;
  }

  const currentTotalSupplyLPTokens =
    totalSupplyEvent.currentTotalSupplyLPTokens;

  // Create ALM_LP_Wrapper (single entity tracks both wrapper and strategy)
  // amount0/amount1 are derived at snapshot time from liquidity + sqrtPriceX96 + ticks
  context.ALM_LP_Wrapper.set({
    id: ALMLPWrapperId(event.chainId, lpWrapper),
    chainId: event.chainId,
    pool: pool,
    token0: token0,
    token1: token1,

    lpAmount: currentTotalSupplyLPTokens,
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
    maxLiquidityRatioDeviationX96: maxLiquidityRatioDeviationX96,
    creationTimestamp: timestamp,
    strategyTransactionHash: event.transaction.hash,
    lastSnapshotTimestamp: undefined,
  });
});
