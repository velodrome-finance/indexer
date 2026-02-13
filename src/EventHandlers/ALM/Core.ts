import { ALMCore, type ALM_LP_Wrapper } from "generated";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";

ALMCore.Rebalance.handler(async ({ event, context }) => {
  const [
    pool,
    ammPositionInfo,
    sqrtPriceX96,
    amount0,
    amount1,
    ammPositionIdBefore,
    ammPositionIdAfter,
  ] = event.params.rebalanceEventParams;
  const [token0, token1, property, tickLower, tickUpper, liquidity] =
    ammPositionInfo;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Find the wrapper by pool address (1 wrapper per pool)
  const poolAddress = pool;
  const wrappers = await context.ALM_LP_Wrapper.getWhere.pool.eq(poolAddress);

  if (!wrappers || wrappers.length === 0) {
    context.log.warn(
      `[ALMCore] ALM_LP_Wrapper entity not found for pool ${poolAddress}. Skipping Rebalance update.`,
    );
    return;
  }

  // Since there's exactly 1 wrapper per pool, take the first one
  const lpWrapper = wrappers[0];

  // Update the wrapper's strategy position state with new amounts from Rebalance (amount0/amount1 from event)
  const lpWrapperDiff: Partial<ALM_LP_Wrapper> = {
    tokenId: ammPositionIdAfter,
    tickLower: tickLower,
    tickUpper: tickUpper,
    property: property,
    liquidity: liquidity,
    ammStateIsDerived: false,
    amount0: amount0,
    amount1: amount1,
    lastUpdatedTimestamp: timestamp,
  };

  await updateALMLPWrapper(lpWrapperDiff, lpWrapper, timestamp, context);
});
