import { ALMDeployFactoryV1 } from "generated";
import { toChecksumAddress } from "../../Constants";

ALMDeployFactoryV1.StrategyCreated.contractRegister(({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, synthetixFarm, caller] =
    event.params.params;
  context.addALMLPWrapperV1(lpWrapper);
});

ALMDeployFactoryV1.StrategyCreated.handler(async ({ event, context }) => {
  const [pool, ammPosition, strategyParams, lpWrapper, synthetixFarm, caller] =
    event.params.params;

  const [strategyType, tickNeighborhood, tickSpacing, width] = strategyParams;

  // In DeployFactory2, ammPosition is a single tuple, not an array
  // Contract relationship: 1 LP wrapper per pool, 1 strategy per LP wrapper, 1 tokenId per strategy, 1 AMM position per tokenId
  const [token0, token1, property, tickLower, tickUpper, liquidity] =
    ammPosition;

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
    creationTimestamp: timestamp,
    strategyTransactionHash: event.transaction.hash,
  });
});
