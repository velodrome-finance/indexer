import { ALMDeployFactory } from "generated";
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
  if (!nonFungiblePositions || nonFungiblePositions.length === 0) {
    context.log.error(
      `NonFungiblePosition not found for transaction hash ${event.transaction.hash}. It should have been created by CLPool event handlers.`,
    );
    return;
  }

  const tokenId = nonFungiblePositions[0].tokenId;

  // Create ALM_LP_Wrapper (single entity tracks both wrapper and strategy)
  // This single entity contains both wrapper-level aggregations and strategy/position state
  context.ALM_LP_Wrapper.set({
    id: `${toChecksumAddress(lpWrapper)}_${event.chainId}`,
    chainId: event.chainId,
    pool: toChecksumAddress(pool),
    token0: toChecksumAddress(token0),
    token1: toChecksumAddress(token1),
    // Wrapper-level aggregations (updated by Deposit/Withdraw events)
    amount0: 0n,
    amount1: 0n,
    lpAmount: 0n,
    lastUpdatedTimestamp: timestamp,
    // Strategy/Position-level state (from StrategyCreated event)
    tokenId: tokenId,
    tickLower: tickLower,
    tickUpper: tickUpper,
    property: property,
    positionAmount0: 0n, // Initialize to 0 - will be updated by Rebalance events
    positionAmount1: 0n, // Initialize to 0 - will be updated by Rebalance events
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
