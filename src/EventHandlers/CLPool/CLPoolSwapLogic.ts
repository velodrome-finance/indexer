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
  liquidityPoolDiff?: Partial<LiquidityPoolAggregator>;
  userSwapDiff?: {
    numberOfSwaps: bigint;
    totalSwapVolumeUSD: bigint;
    timestamp: Date;
  };
  error?: string;
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

export type CLPoolSwapLoaderReturn =
  | {
      _type: "success";
      liquidityPoolAggregator: LiquidityPoolAggregator;
      token0Instance: Token | undefined;
      token1Instance: Token | undefined;
    }
  | {
      _type: "TokenNotFoundError";
      message: string;
    }
  | {
      _type: "LiquidityPoolAggregatorNotFoundError";
      message: string;
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
      1000000n,
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
      1000000n,
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
  loaderReturn: CLPoolSwapLoaderReturn,
  context: handlerContext,
): Promise<CLPoolSwapResult> {
  // Handle different loader return types
  switch (loaderReturn._type) {
    case "success": {
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

      let successSwapEntityData: SwapEntityData = {
        liquidityPoolAggregator: loaderReturn.liquidityPoolAggregator,
        token0Instance: loaderReturn.token0Instance,
        token1Instance: loaderReturn.token1Instance,
        tokenUpdateData,
        liquidityPoolAggregatorDiff,
      };

      successSwapEntityData = await updateToken0SwapData(
        successSwapEntityData,
        event,
        context,
      );
      successSwapEntityData = await updateToken1SwapData(
        successSwapEntityData,
        event,
        context,
      );

      // If both tokens are whitelisted, add the volume of token0 to the whitelisted volume
      successSwapEntityData.tokenUpdateData.volumeInUSDWhitelisted +=
        successSwapEntityData.token0Instance?.isWhitelisted &&
        successSwapEntityData.token1Instance?.isWhitelisted
          ? successSwapEntityData.tokenUpdateData.netVolumeToken0USD
          : 0n;

      const successReserveResult = updateCLPoolLiquidity(
        successSwapEntityData.liquidityPoolAggregator,
        event,
        successSwapEntityData.token0Instance,
        successSwapEntityData.token1Instance,
      );

      // Merge with previous liquidity pool aggregator values.
      successSwapEntityData = updateLiquidityPoolAggregatorDiffSwap(
        successSwapEntityData,
        successReserveResult,
        new Date(event.block.timestamp * 1000),
      );

      const userSwapDiff = {
        numberOfSwaps: 1n, // Each swap event represents 1 swap
        totalSwapVolumeUSD: successSwapEntityData.tokenUpdateData.volumeInUSD,
        timestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        liquidityPoolDiff: successSwapEntityData.liquidityPoolAggregatorDiff,
        userSwapDiff,
      };
    }
    case "TokenNotFoundError":
      return {
        error: loaderReturn.message,
      };
    case "LiquidityPoolAggregatorNotFoundError":
      return {
        error: loaderReturn.message,
      };
    default: {
      // This should never happen due to TypeScript's exhaustive checking
      return {
        error: "Unknown error type",
      };
    }
  }
}
