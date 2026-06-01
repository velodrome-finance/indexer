import { indexer } from "envio";
import {
  applySetDefaultCap,
  applySetEmissionCap,
} from "./CLGaugeFactorySharedLogic";

indexer.onEvent(
  { contract: "CLGaugeFactoryV2", event: "SetDefaultCap" },
  async ({ event, context }) => {
    await applySetDefaultCap(
      event.chainId,
      event.params._newDefaultCap,
      event.block.timestamp,
      context,
    );
  },
);

indexer.onEvent(
  { contract: "CLGaugeFactoryV2", event: "SetEmissionCap" },
  async ({ event, context }) => {
    await applySetEmissionCap(
      event.params._gauge,
      event.params._newEmissionCap,
      event.block.timestamp,
      "CLGaugeFactoryV2",
      context,
    );
  },
);
