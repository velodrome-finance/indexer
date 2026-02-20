import { NewCLGaugeFactory } from "generated";

NewCLGaugeFactory.SetDefaultCap.handler(async ({ event, context }) => {
  context.CLGaugeConfig.set({
    id: event.srcAddress,
    defaultEmissionsCap: event.params._newDefaultCap,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  });

  context.log.info(
    `Default emissions cap set to ${event.params._newDefaultCap} for CLGaugeFactory ${event.srcAddress}`,
  );
});

NewCLGaugeFactory.SetEmissionCap.handler(async ({ event, context }) => {
  const poolEntityList = await context.LiquidityPoolAggregator.getWhere({
    gaugeAddress: { _eq: event.params._gauge },
  });

  if (!poolEntityList || poolEntityList.length === 0) {
    context.log.error(`Pool entity not found for gauge ${event.params._gauge}`);
    return;
  }

  if (poolEntityList.length > 1) {
    context.log.warn(
      `[NewCLGaugeFactory] Multiple pools found for gauge ${event.params._gauge}, using first match`,
    );
  }

  const poolEntity = poolEntityList[0];

  context.LiquidityPoolAggregator.set({
    ...poolEntity,
    gaugeEmissionsCap: event.params._newEmissionCap,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  });

  context.log.info(
    `Emissions cap set to ${event.params._newEmissionCap} for gauge ${event.params._gauge}`,
  );
});
