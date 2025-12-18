import { ALMDeployFactory } from "generated";
import { ALM_TotalSupplyLimitUpdated_event } from "generated/src/db/Entities.res";
import { toChecksumAddress } from "../../Constants";

ALMDeployFactory.StrategyCreated.contractRegister(({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, caller] =
    event.params.params;
  context.addALMLPWrapper(lpWrapper);
});

ALMDeployFactory.StrategyCreated.handler(async ({ event, context }) => {
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

  // Fetching tokenId from NonFungiblePosition entity created by CL Pool event handlers
  const nonFungiblePositions =
    await context.NonFungiblePosition.getWhere.mintTransactionHash.eq(
      event.transaction.hash,
    );
  const matchingNonFungiblePositions =
    nonFungiblePositions?.filter(
      (pos) =>
        pos.tickLower === tickLower &&
        pos.tickUpper === tickUpper &&
        pos.liquidity === liquidity &&
        pos.token0 === token0 &&
        pos.token1 === token1,
    ) ?? [];

  if (matchingNonFungiblePositions.length === 0) {
    context.log.error(
      `NonFungiblePosition not found for transaction hash ${event.transaction.hash} matching tickLower ${tickLower}, tickUpper ${tickUpper}, liquidity ${liquidity}. It should have been created by CLPool event handlers.`,
    );
    return;
  }

  if (matchingNonFungiblePositions.length > 1) {
    context.log.warn(
      `Multiple NonFungiblePositions found for transaction hash ${event.transaction.hash} with the same tick lower ${tickLower}, tick upper ${tickUpper}, liquidity ${liquidity}, token0 ${token0} and token1 ${token1}. Using the first match.`,
    );
  }

  // there should, in principle, one unique non fungible position that has
  // simultaneously the same transaction hash,tickLower, tickUpper, liquidity and token0 and token1
  const tokenId = matchingNonFungiblePositions[0].tokenId;
  const amount0 = matchingNonFungiblePositions[0].amount0;
  const amount1 = matchingNonFungiblePositions[0].amount1;

  // Fetching LP tokens supply from TotalSupplyLimitUpdated event
  const ALM_TotalSupplyLimitUpdated_event =
    await context.ALM_TotalSupplyLimitUpdated_event.get(
      `${lpWrapper}_${event.chainId}`,
    );

  if (
    !ALM_TotalSupplyLimitUpdated_event ||
    ALM_TotalSupplyLimitUpdated_event.transactionHash !== event.transaction.hash
  ) {
    context.log.error(
      `ALM_TotalSupplyLimitUpdated_event not found for lpWrapper ${toChecksumAddress(lpWrapper)} and chainId ${event.chainId} or transaction hash ${event.transaction.hash} does not match. It should have been created by ALMLPWrapper event handlers.`,
    );
    return;
  }

  const currentTotalSupplyLPTokens =
    ALM_TotalSupplyLimitUpdated_event.currentTotalSupplyLPTokens;

  // Create ALM_LP_Wrapper (single entity tracks both wrapper and strategy)
  // This single entity contains both wrapper-level aggregations and strategy/position state
  context.ALM_LP_Wrapper.set({
    id: `${toChecksumAddress(lpWrapper)}_${event.chainId}`,
    chainId: event.chainId,
    pool: toChecksumAddress(pool),
    token0: toChecksumAddress(token0),
    token1: toChecksumAddress(token1),

    amount0: amount0,
    amount1: amount1,
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
  });
});
