import { UnstakedFeeModule } from "generated";
import { applyUnstakedFee } from "./UnstakedFeeModuleSharedLogic";

UnstakedFeeModule.CustomFeeSet.handler(async ({ event, context }) => {
  await applyUnstakedFee(
    {
      poolAddress: event.params.pool,
      fee: BigInt(event.params.fee),
      chainId: event.chainId,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      logContext: "UnstakedFeeModule.CustomFeeSet",
    },
    context,
  );
});
