import { CLGaugeFactoryV2 } from "generated";

CLGaugeFactoryV2.SetDefaultCap.handler(async ({ event, context }) => {
  context.CLGaugeConfig.set({
    id: String(event.chainId),
    defaultEmissionsCap: event.params._newDefaultCap,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  });
});

CLGaugeFactoryV2.SetEmissionCap.handler(async ({ event, context }) => {
  const poolEntityList = await context.LiquidityPoolAggregator.getWhere({
    gaugeAddress: { _eq: event.params._gauge },
  });

  if (!poolEntityList || poolEntityList.length === 0) {
    context.log.error(`Pool entity not found for gauge ${event.params._gauge}`);
    return;
  }

  if (poolEntityList.length > 1) {
    context.log.warn(
      `[CLGaugeFactoryV2] Multiple pools found for gauge ${event.params._gauge}, using first match`,
    );
  }

  const poolEntity = poolEntityList[0];

  context.LiquidityPoolAggregator.set({
    ...poolEntity,
    gaugeEmissionsCap: event.params._newEmissionCap,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  });
});
