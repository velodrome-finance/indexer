import { indexer } from "envio";
import { applyUnstakedFee } from "../SwapFeeModule/UnstakedFeeModuleSharedLogic";

/**
 * Aero CustomUnstakedFeeModule (Slipstream V3, same address on every Aero
 * chain plus Arc's lite launch): the share of an Aero CL pool's swap fees
 * taken from unstaked liquidity and given to the gauge. Same event and
 * semantics as the legacy UnstakedFeeModule (0 = factory default, 420 = 0%,
 * else 1e6-scaled), so it writes `Pool.unstakedFee` through the same logic.
 */
indexer.onEvent(
  { contract: "AeroUnstakedFeeModule", event: "CustomFeeSet" },
  async ({ event, context }) => {
    await applyUnstakedFee(
      {
        poolAddress: event.params.pool,
        fee: BigInt(event.params.fee),
        chainId: event.chainId,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
        logContext: "AeroUnstakedFeeModule.CustomFeeSet",
      },
      context,
    );
  },
);
