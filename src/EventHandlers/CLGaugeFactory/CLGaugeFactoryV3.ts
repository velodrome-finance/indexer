import { CLGaugeFactoryV3 } from "generated";
import {
  applySetDefaultCap,
  applySetEmissionCap,
} from "./CLGaugeFactorySharedLogic";

CLGaugeFactoryV3.SetDefaultCap.handler(async ({ event, context }) => {
  await applySetDefaultCap(
    event.chainId,
    event.params._newDefaultCap,
    event.block.timestamp,
    context,
  );
});

CLGaugeFactoryV3.SetEmissionCap.handler(async ({ event, context }) => {
  await applySetEmissionCap(
    event.params._gauge,
    event.params._newEmissionCap,
    event.block.timestamp,
    "CLGaugeFactoryV3",
    context,
  );
});
