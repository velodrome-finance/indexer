import { indexer } from "envio";
import {
  processAeroNFPMIncreaseLiquidity,
  processAeroNFPMTransfer,
} from "./AeroNFPMLogic";
import { processNFPMCollect } from "./NFPMCollectLogic";
import { processNFPMDecreaseLiquidity } from "./NFPMDecreaseLiquidityLogic";

/**
 * @title Aero NonfungiblePositionManager
 * @notice Position NFTs of Aero (MetaDEX) CL pools. Same Transfer / Decrease /
 * Collect events as the legacy NFPMs; IncreaseLiquidity also carries the
 * position's tick range. See AeroNFPMLogic.ts for the position lifecycle.
 */

indexer.onEvent(
  { contract: "AeroNFPM", event: "Transfer" },
  async ({ event, context }) => {
    await processAeroNFPMTransfer(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroNFPM", event: "IncreaseLiquidity" },
  async ({ event, context }) => {
    await processAeroNFPMIncreaseLiquidity(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroNFPM", event: "DecreaseLiquidity" },
  async ({ event, context }) => {
    await processNFPMDecreaseLiquidity(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroNFPM", event: "Collect" },
  async ({ event, context }) => {
    // Credits the fees the preceding CLPool.Collect isolated to the position's
    // owner, as for the legacy NFPMs (NFPMCollectLogic.ts).
    await processNFPMCollect(event, context);
  },
);
