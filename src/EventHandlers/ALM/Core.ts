import { ALMCore, type ALM_LP_Wrapper } from "generated";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";
import { calculatePositionAmountsFromLiquidity } from "../../Helpers";

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
      `ALM_LP_Wrapper entity not found for pool ${poolAddress}. Skipping Rebalance update.`,
    );
    return;
  }

  // Since there's exactly 1 wrapper per pool, take the first one
  const lpWrapper = wrappers[0];

  // Recalculate amount0 and amount1 from liquidity and current price
  // This ensures amounts reflect the current pool price, not stale values
  const recalculatedAmounts = calculatePositionAmountsFromLiquidity(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper,
  );

  // Update the wrapper's strategy position state with new amounts from Rebalance
  const lpWrapperDiff: Partial<ALM_LP_Wrapper> = {
    tokenId: ammPositionIdAfter,
    tickLower: tickLower,
    tickUpper: tickUpper,
    property: property,
    liquidity: liquidity,
    ammStateIsDerived: false,
    // Recalculate wrapper-level amounts from current liquidity and price
    amount0: recalculatedAmounts.amount0,
    amount1: recalculatedAmounts.amount1,
    lastUpdatedTimestamp: timestamp,
  };

  await updateALMLPWrapper(lpWrapperDiff, lpWrapper, timestamp, context);
});
