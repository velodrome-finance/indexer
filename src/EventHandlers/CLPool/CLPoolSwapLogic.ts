import type {
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { abs, multiplyBase1e18 } from "../../Maths";
import { refreshTokenPrice } from "../../PriceOracle";
import { updateCLPoolLiquidity } from "./updateCLPoolLiquidity";

export interface CLPoolSwapResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregator>;
  userSwapDiff: {
    numberOfSwaps: bigint;
    totalSwapVolumeUSD: bigint;
    timestamp: Date;
  };
}

type SwapEntityData = {
  liquidityPoolAggregator: LiquidityPoolAggregator;
  token0Instance: Token | undefined;
  token1Instance: Token | undefined;
  tokenUpdateData: {
    netAmount0: bigint;
    netAmount1: bigint;
    netVolumeToken0USD: bigint;
    netVolumeToken1USD: bigint;
    volumeInUSD: bigint;
    volumeInUSDWhitelisted: bigint;
  };
  liquidityPoolAggregatorDiff: Partial<LiquidityPoolAggregator>;
};

const updateToken0SwapData = async (
  data: SwapEntityData,
  event: CLPool_Swap_event,
  context: handlerContext,
) => {
  let {
    liquidityPoolAggregator,
    token0Instance,
    tokenUpdateData,
    liquidityPoolAggregatorDiff,
  } = data;
  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    totalVolume0: tokenUpdateData.netAmount0,
  };
  if (!token0Instance) return { ...data, liquidityPoolAggregatorDiff };

  try {
    token0Instance = await refreshTokenPrice(
      token0Instance,
      event.block.number,
      event.block.timestamp,
      event.chainId,
      context,
    );
  } catch (error) {
    context.log.error(
      `Error refreshing token price for ${token0Instance?.address} on chain ${event.chainId}: ${error}`,
    );
  }
  const normalizedAmount0 = normalizeTokenAmountTo1e18(
    abs(event.params.amount0),
    Number(token0Instance.decimals),
  );

  tokenUpdateData.netVolumeToken0USD = multiplyBase1e18(
    normalizedAmount0,
    token0Instance.pricePerUSDNew,
  );
  tokenUpdateData.volumeInUSD = tokenUpdateData.netVolumeToken0USD;

  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    token0Price:
      token0Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token0IsWhitelisted: token0Instance?.isWhitelisted ?? false,
  };

  return {
    ...data,
    liquidityPoolAggregatorDiff,
    token0Instance,
    tokenUpdateData,
  };
};

const updateToken1SwapData = async (
  data: SwapEntityData,
  event: CLPool_Swap_event,
  context: handlerContext,
) => {
  let {
    liquidityPoolAggregator,
    token1Instance,
    tokenUpdateData,
    liquidityPoolAggregatorDiff,
  } = data;
  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    totalVolume1: tokenUpdateData.netAmount1,
  };
  if (!token1Instance) return { ...data, liquidityPoolAggregatorDiff };

  try {
    token1Instance = await refreshTokenPrice(
      token1Instance,
      event.block.number,
      event.block.timestamp,
      event.chainId,
      context,
    );
  } catch (error) {
    context.log.error(
      `Error refreshing token price for ${token1Instance?.address} on chain ${event.chainId}: ${error}`,
    );
  }
  const normalizedAmount1 = normalizeTokenAmountTo1e18(
    abs(event.params.amount1),
    Number(token1Instance.decimals),
  );
  tokenUpdateData.netVolumeToken1USD = multiplyBase1e18(
    normalizedAmount1,
    token1Instance.pricePerUSDNew,
  );

  // Use volume from token 0 if it's priced, otherwise use token 1
  tokenUpdateData.volumeInUSD =
    tokenUpdateData.netVolumeToken0USD !== 0n
      ? tokenUpdateData.netVolumeToken0USD
      : tokenUpdateData.netVolumeToken1USD;

  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    totalVolume1: tokenUpdateData.netAmount1, // Only the diff, not cumulative
    token1Price:
      token1Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    token1IsWhitelisted: token1Instance?.isWhitelisted ?? false,
  };

  return {
    ...data,
    liquidityPoolAggregatorDiff,
    tokenUpdateData,
    token1Instance,
  };
};

const updateLiquidityPoolAggregatorDiffSwap = (
  data: SwapEntityData,
  reserveResult: {
    addTotalLiquidityUSD: bigint;
    reserve0: bigint;
    reserve1: bigint;
  },
  eventTimestamp: Date,
) => {
  data.liquidityPoolAggregatorDiff = {
    ...data.liquidityPoolAggregatorDiff,
    numberOfSwaps: 1n, // Only the diff, not cumulative
    reserve0: reserveResult.reserve0, // Only the diff, not cumulative
    reserve1: reserveResult.reserve1, // Only the diff, not cumulative
    totalVolumeUSD: data.tokenUpdateData.volumeInUSD, // Only the diff, not cumulative
    totalVolumeUSDWhitelisted: data.tokenUpdateData.volumeInUSDWhitelisted, // Only the diff, not cumulative
    totalLiquidityUSD: reserveResult.addTotalLiquidityUSD,
    lastUpdatedTimestamp: eventTimestamp,
  };
  return data;
};

export async function processCLPoolSwap(
  event: CLPool_Swap_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
  context: handlerContext,
): Promise<CLPoolSwapResult> {
  // Delta that will be added to the liquidity pool aggregator
  const tokenUpdateData = {
    netAmount0: abs(event.params.amount0),
    netAmount1: abs(event.params.amount1),
    netVolumeToken0USD: 0n,
    netVolumeToken1USD: 0n,
    volumeInUSD: 0n,
    volumeInUSDWhitelisted: 0n,
  };

  const liquidityPoolAggregatorDiff: Partial<LiquidityPoolAggregator> = {};

  let swapEntityData: SwapEntityData = {
    liquidityPoolAggregator,
    token0Instance,
    token1Instance,
    tokenUpdateData,
    liquidityPoolAggregatorDiff,
  };

  swapEntityData = await updateToken0SwapData(swapEntityData, event, context);
  swapEntityData = await updateToken1SwapData(swapEntityData, event, context);

  // If both tokens are whitelisted, add the volume of token0 to the whitelisted volume
  swapEntityData.tokenUpdateData.volumeInUSDWhitelisted +=
    swapEntityData.token0Instance?.isWhitelisted &&
    swapEntityData.token1Instance?.isWhitelisted
      ? swapEntityData.tokenUpdateData.netVolumeToken0USD
      : 0n;

  const reserveResult = updateCLPoolLiquidity(
    swapEntityData.liquidityPoolAggregator,
    event,
    swapEntityData.token0Instance,
    swapEntityData.token1Instance,
  );

  // Merge with previous liquidity pool aggregator values.
  swapEntityData = updateLiquidityPoolAggregatorDiffSwap(
    swapEntityData,
    reserveResult,
    new Date(event.block.timestamp * 1000),
  );

  const userSwapDiff = {
    numberOfSwaps: 1n, // Each swap event represents 1 swap
    totalSwapVolumeUSD: swapEntityData.tokenUpdateData.volumeInUSD,
    timestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff: swapEntityData.liquidityPoolAggregatorDiff,
    userSwapDiff,
  };
}
