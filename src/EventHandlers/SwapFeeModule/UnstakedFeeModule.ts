import { indexer } from "envio";
import { applyUnstakedFee } from "./UnstakedFeeModuleSharedLogic";

indexer.onEvent(
  { contract: "UnstakedFeeModule", event: "CustomFeeSet" },
  async ({ event, context }) => {
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
  },
);
