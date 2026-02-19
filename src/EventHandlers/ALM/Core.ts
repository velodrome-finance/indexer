import { ALMCore } from "generated";
import { updateALMLPWrapper } from "../../Aggregators/ALMLPWrapper";

ALMCore.Rebalance.handler(async ({ event, context }) => {
  const [pool, ammPositionInfo, , , , , ammPositionIdAfter] =
    event.params.rebalanceEventParams;
  const [, , property, tickLower, tickUpper, liquidity] = ammPositionInfo;

  const timestamp = new Date(event.block.timestamp * 1000);

  // Find the wrapper by pool address (1 wrapper per pool)
  const poolAddress = pool;
  const wrappers = await context.ALM_LP_Wrapper.getWhere({
    pool: { _eq: poolAddress },
  });

  if (!wrappers || wrappers.length === 0) {
    context.log.warn(
      `[ALMCore] ALM_LP_Wrapper entity not found for pool ${poolAddress}. Skipping Rebalance update.`,
    );
    return;
  }

  // Since there's exactly 1 wrapper per pool, take the first one
  const lpWrapper = wrappers[0];

  const lpWrapperDiff = {
    tokenId: ammPositionIdAfter,
    tickLower: tickLower,
    tickUpper: tickUpper,
    property: property,
    liquidity: liquidity,
    lastUpdatedTimestamp: timestamp,
  };

  await updateALMLPWrapper(lpWrapperDiff, lpWrapper, timestamp, context);
});
