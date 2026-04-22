import { CustomUnstakedFeeModule } from "generated";
import { applyUnstakedFee } from "./UnstakedFeeModuleSharedLogic";

CustomUnstakedFeeModule.SetCustomFee.handler(async ({ event, context }) => {
  await applyUnstakedFee(
    {
      poolAddress: event.params.pool,
      fee: BigInt(event.params.fee),
      chainId: event.chainId,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      logContext: "CustomUnstakedFeeModule.SetCustomFee",
    },
    context,
  );
});
