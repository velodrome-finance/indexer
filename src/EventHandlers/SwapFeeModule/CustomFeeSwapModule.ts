import { CustomFeeSwapModule } from "generated";
import type {
  DynamicFeeGlobalConfig,
  LiquidityPoolAggregator,
} from "generated";
import { updateLiquidityPoolAggregator } from "../../Aggregators/LiquidityPoolAggregator";
import { toChecksumAddress } from "../../Constants";

CustomFeeSwapModule.SetCustomFee.handler(async ({ event, context }) => {
  const pool = await context.LiquidityPoolAggregator.get(
    toChecksumAddress(event.params.pool),
  );

  if (!pool) {
    context.log.warn(
      `Pool ${event.params.pool} not found for SetCustomFee event`,
    );
    return;
  }

  const diff: Partial<LiquidityPoolAggregator> = {
    baseFee: BigInt(event.params.fee),
  };

  await updateLiquidityPoolAggregator(
    diff,
    pool,
    new Date(event.block.timestamp * 1000),
    context,
    event.block.number,
  );

  const configId = toChecksumAddress(event.srcAddress);

  const config: DynamicFeeGlobalConfig = {
    id: configId,
    chainId: event.chainId,
    secondsAgo: undefined, // This is only defined for DynamicFeeSwapModule.ts
  };

  context.DynamicFeeGlobalConfig.set(config);
});
