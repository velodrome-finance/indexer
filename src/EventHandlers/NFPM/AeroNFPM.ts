import { indexer } from "envio";
import {
  processAeroNFPMCollect,
  processAeroNFPMDecreaseLiquidity,
  processAeroNFPMIncreaseLiquidity,
  processAeroNFPMTransfer,
} from "./AeroNFPMLogic";

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
    await processAeroNFPMDecreaseLiquidity(event, context);
  },
);

indexer.onEvent(
  { contract: "AeroNFPM", event: "Collect" },
  async ({ event, context }) => {
    await processAeroNFPMCollect(event, context);
  },
);
