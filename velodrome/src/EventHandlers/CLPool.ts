import {
  CLPool,
  CLPool_Burn,
  CLPool_Collect,
  CLPool_CollectFees,
  CLPool_Flash,
  CLPool_IncreaseObservationCardinalityNext,
  CLPool_Initialize,
  CLPool_Mint,
  CLPool_SetFeeProtocol,
  CLPool_Swap,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { refreshTokenPrice } from "../PriceOracle";
import { normalizeTokenAmountTo1e18 } from "../Helpers";
import { multiplyBase1e18, abs } from "../Maths";
import { updateLiquidityPoolAggregator } from "../Aggregators/LiquidityPoolAggregator";
import { handlerContext, CLPool_Swap_event } from "generated/src/Types.gen";
import { fetchPoolLoaderData } from "../Pools/common";

/**
 * Updates the fee-related metrics for a Concentrated Liquidity Pool.
 * 
 * This function calculates the total fees collected in both tokens and USD value.
 * The USD values are computed by:
 * 1. Normalizing token amounts to 18 decimals
 * 2. Multiplying by the token's USD price
 * 
 * @param liquidityPoolAggregator - The current state of the liquidity pool
 * @param event - The event containing fee collection data (amount0, amount1)
 * @param token0Instance - Token instance for token0, containing decimals and price data
 * @param token1Instance - Token instance for token1, containing decimals and price data
 * 
 * @returns {Object} Updated fee metrics
 * @returns {bigint} .totalFees0 - Cumulative fees collected in token0
 * @returns {bigint} .totalFees1 - Cumulative fees collected in token1
 * @returns {bigint} .totalFeesUSD - Cumulative fees collected in USD
 */
function updateCLPoolFees(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  event: any,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined
) {

  let tokenUpdateData = {
    totalFees0: liquidityPoolAggregator.totalFees0,
    totalFees1: liquidityPoolAggregator.totalFees1,
    totalFeesUSD: liquidityPoolAggregator.totalFeesUSD,
    totalFeesUSDWhitelisted: liquidityPoolAggregator.totalFeesUSDWhitelisted,
  };

  tokenUpdateData.totalFees0 += event.params.amount0;
  tokenUpdateData.totalFees1 += event.params.amount1;

  if (token0Instance) {
    const normalizedFees0 = normalizeTokenAmountTo1e18(
      event.params.amount0,
      Number(token0Instance.decimals)
    );
    
    const token0fees = multiplyBase1e18(
      normalizedFees0,
      token0Instance.pricePerUSDNew
    );
    tokenUpdateData.totalFeesUSD += token0fees;
    tokenUpdateData.totalFeesUSDWhitelisted += (token0Instance.isWhitelisted) ? token0fees : 0n;
  }

  if (token1Instance) {
    const normalizedFees1 = normalizeTokenAmountTo1e18(
      event.params.amount1,
      Number(token1Instance.decimals)
    );
    const token1fees = multiplyBase1e18(
      normalizedFees1,
      token1Instance.pricePerUSDNew
    );
    tokenUpdateData.totalFeesUSD += token1fees;
    tokenUpdateData.totalFeesUSDWhitelisted += (token1Instance.isWhitelisted) ? token1fees : 0n;
  }

  return tokenUpdateData;
}

/**
 * Updates the liquidity-related metrics for a Concentrated Liquidity Pool.
 * 
 * This function calculates both addition and subtraction of liquidity to handle
 * various pool operations (mint, burn, collect). For each token:
 * 1. Normalizes reserve amounts to 18 decimals
 * 2. Calculates USD value using token prices
 * 3. Computes both addition and subtraction scenarios
 * 
 * @param liquidityPoolAggregator - The current state of the liquidity pool
 * @param event - The event containing liquidity change data (amount0, amount1)
 * @param token0Instance - Token instance for token0, containing decimals and price data
 * @param token1Instance - Token instance for token1, containing decimals and price data
 * 
 * @returns {Object} Updated liquidity metrics
 */
function updateCLPoolLiquidity(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  event: any,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined
) {

  let tokenUpdateData = {
    addTotalLiquidity0USD: 0n,
    subTotalLiquidity0USD: 0n,
    addTotalLiquidity1USD: 0n,
    subTotalLiquidity1USD: 0n,
    addTotalLiquidityUSD: 0n,
    subTotalLiquidityUSD: 0n,
    reserve0: 0n,
    reserve1: 0n,
    normalizedReserve0: 0n,
    normalizedReserve1: 0n,
  };

  // Return new token reserve amounts
  tokenUpdateData.reserve0 = event.params.amount0;
  tokenUpdateData.reserve1 = event.params.amount1;

  // Update liquidity amounts in USD. Computes both the addition and subtraction of liquidity
  // from event params.
  if (token0Instance) {
    const normalizedReserveAdd0 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve0 + tokenUpdateData.reserve0,
      Number(token0Instance.decimals || 18)
    );
    const normalizedReserveSub0 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve0 - tokenUpdateData.reserve0,
      Number(token0Instance.decimals || 18)
    );

    tokenUpdateData.addTotalLiquidity0USD = multiplyBase1e18(
      normalizedReserveAdd0,
      liquidityPoolAggregator.token0Price
    );

    tokenUpdateData.subTotalLiquidity0USD = multiplyBase1e18(
      normalizedReserveSub0,
      liquidityPoolAggregator.token0Price
    );
  }

  if (token1Instance) {
    const normalizedReserveAdd1 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve1 + tokenUpdateData.reserve1,
      Number(token1Instance.decimals || 18)
    );
    const normalizedReserveSub1 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve1 - tokenUpdateData.reserve1,
      Number(token1Instance.decimals || 18)
    );

    tokenUpdateData.addTotalLiquidity1USD = multiplyBase1e18(
      normalizedReserveAdd1,
      liquidityPoolAggregator.token1Price
    );

    tokenUpdateData.subTotalLiquidity1USD = multiplyBase1e18(
      normalizedReserveSub1,
      liquidityPoolAggregator.token1Price
    );
  }

  tokenUpdateData.addTotalLiquidityUSD = tokenUpdateData.addTotalLiquidity0USD + tokenUpdateData.addTotalLiquidity1USD;
  tokenUpdateData.subTotalLiquidityUSD = tokenUpdateData.subTotalLiquidity0USD + tokenUpdateData.subTotalLiquidity1USD;

  return tokenUpdateData;
}

CLPool.Burn.handlerWithLoader({
  loader: async ({ event, context }) => {
    return null;
  },
  handler: async ({ event, context, loaderReturn }) => {
    const entity: CLPool_Burn = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      owner: event.params.owner,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      amount: event.params.amount,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.CLPool_Burn.set(entity);
  },
});

CLPool.Collect.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    const entity: CLPool_Collect = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      owner: event.params.owner,
      recipient: event.params.recipient,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.CLPool_Collect.set(entity);

    switch (loaderReturn._type) {
      case "success":
        const { liquidityPoolAggregator, token0Instance, token1Instance } = loaderReturn;
        const tokenUpdateData = updateCLPoolLiquidity(
          liquidityPoolAggregator,
          event,
          token0Instance,
          token1Instance
        );

        const liquidityPoolDiff = {
          reserve0: liquidityPoolAggregator.reserve0 - tokenUpdateData.reserve0,
          reserve1: liquidityPoolAggregator.reserve1 - tokenUpdateData.reserve1,
          totalLiquidityUSD: tokenUpdateData.subTotalLiquidityUSD,
          lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        };

        updateLiquidityPoolAggregator(
          liquidityPoolDiff,
          liquidityPoolAggregator,
          liquidityPoolDiff.lastUpdatedTimestamp,
          context,
          event.block.number
        );
        return
      case "TokenNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      case "LiquidityPoolAggregatorNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      default:
        const _exhaustiveCheck: never = loaderReturn;
        return _exhaustiveCheck;
    }
  },
});

CLPool.CollectFees.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    const entity: CLPool_CollectFees = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      recipient: event.params.recipient,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.CLPool_CollectFees.set(entity);

    switch (loaderReturn._type) {
      case "success":
        const { liquidityPoolAggregator, token0Instance, token1Instance } = loaderReturn;

        const tokenUpdateData = updateCLPoolLiquidity(
          liquidityPoolAggregator,
          event,
          token0Instance,
          token1Instance
        );

        const tokenUpdateFeesData = updateCLPoolFees(
          liquidityPoolAggregator,
          event,
          token0Instance,
          token1Instance
        );

        let liquidityPoolDiff = {
          reserve0: liquidityPoolAggregator.reserve0 - tokenUpdateData.reserve0,
          reserve1: liquidityPoolAggregator.reserve1 - tokenUpdateData.reserve1,
          totalLiquidityUSD: tokenUpdateData.subTotalLiquidityUSD,
          lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        };

        liquidityPoolDiff = {
          ...liquidityPoolDiff,
          ...tokenUpdateFeesData,
        };

        updateLiquidityPoolAggregator(
          liquidityPoolDiff,
          liquidityPoolAggregator,
          new Date(event.block.timestamp * 1000),
          context,
          event.block.number
        );
        return
      case "TokenNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      case "LiquidityPoolAggregatorNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      default:
        const _exhaustiveCheck: never = loaderReturn;
        return _exhaustiveCheck;
    }
  },
});

CLPool.Flash.handler(async ({ event, context }) => {
  const entity: CLPool_Flash = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender: event.params.sender,
    recipient: event.params.recipient,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    paid0: event.params.paid0,
    paid1: event.params.paid1,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash
  };

  context.CLPool_Flash.set(entity);
});

CLPool.IncreaseObservationCardinalityNext.handler(
  async ({ event, context }) => {
    const entity: CLPool_IncreaseObservationCardinalityNext = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      observationCardinalityNextOld: event.params.observationCardinalityNextOld,
      observationCardinalityNextNew: event.params.observationCardinalityNextNew,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.CLPool_IncreaseObservationCardinalityNext.set(entity);
  }
);

CLPool.Initialize.handler(async ({ event, context }) => {
  const entity: CLPool_Initialize = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sqrtPriceX96: event.params.sqrtPriceX96,
    tick: event.params.tick,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash
  };

  context.CLPool_Initialize.set(entity);
});

CLPool.Mint.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    const entity: CLPool_Mint = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      sender: event.params.sender,
      transactionHash: event.transaction.hash,
      owner: event.params.owner,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      amount: event.params.amount,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sourceAddress: event.srcAddress,
      timestamp: new Date(event.block.timestamp * 1000),
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
    };

    context.CLPool_Mint.set(entity);

    switch (loaderReturn._type) {
      case "success":
        const { liquidityPoolAggregator, token0Instance, token1Instance } = loaderReturn;

        const tokenUpdateData = updateCLPoolLiquidity(
          liquidityPoolAggregator,
          event,
          token0Instance,
          token1Instance
        );

        const liquidityPoolDiff = {
          reserve0: liquidityPoolAggregator.reserve0 + tokenUpdateData.reserve0,
          reserve1: liquidityPoolAggregator.reserve1 + tokenUpdateData.reserve1,
          totalLiquidityUSD: tokenUpdateData.addTotalLiquidityUSD,
          lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
        };

        updateLiquidityPoolAggregator(
          liquidityPoolDiff,
          liquidityPoolAggregator,
          liquidityPoolDiff.lastUpdatedTimestamp,
          context,
          event.block.number
        );
        return;
      case "TokenNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      case "LiquidityPoolAggregatorNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      default:
        const _exhaustiveCheck: never = loaderReturn;
        return _exhaustiveCheck;
    }
  },
});

CLPool.SetFeeProtocol.handler(async ({ event, context }) => {
  const entity: CLPool_SetFeeProtocol = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    feeProtocol0Old: event.params.feeProtocol0Old,
    feeProtocol1Old: event.params.feeProtocol1Old,
    feeProtocol0New: event.params.feeProtocol0New,
    feeProtocol1New: event.params.feeProtocol1New,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash
  };

  context.CLPool_SetFeeProtocol.set(entity);
});

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
}

const updateToken0SwapData = async (data: SwapEntityData, event: CLPool_Swap_event, context: handlerContext) => {
  let { liquidityPoolAggregator, token0Instance, tokenUpdateData, liquidityPoolAggregatorDiff } = data;
  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    totalVolume0: liquidityPoolAggregator.totalVolume0 + tokenUpdateData.netAmount0,
  };
  if (!token0Instance) return { ...data, liquidityPoolAggregatorDiff };
  
  try {
    token0Instance = await refreshTokenPrice(token0Instance, event.block.number, event.block.timestamp, event.chainId, context);
  } catch (error) {
    context.log.error(`Error refreshing token price for ${token0Instance?.address} on chain ${event.chainId}: ${error}`);
  }
  const normalizedAmount0 = normalizeTokenAmountTo1e18(
    abs(event.params.amount0),
    Number(token0Instance.decimals)
  );

  tokenUpdateData.netVolumeToken0USD = multiplyBase1e18(
    normalizedAmount0,
    token0Instance.pricePerUSDNew
  );
  tokenUpdateData.volumeInUSD = tokenUpdateData.netVolumeToken0USD;

  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    token0Price:
      token0Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token0IsWhitelisted: token0Instance?.isWhitelisted ?? false,
  };

  return { ...data, liquidityPoolAggregatorDiff, token0Instance, tokenUpdateData };
}
const updateToken1SwapData = async (data: SwapEntityData, event: CLPool_Swap_event, context: handlerContext) => {
  let { liquidityPoolAggregator, token1Instance, tokenUpdateData, liquidityPoolAggregatorDiff } = data;
  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    totalVolume1: liquidityPoolAggregator.totalVolume1 + tokenUpdateData.netAmount1,
  };
  if (!token1Instance) return { ...data, liquidityPoolAggregatorDiff };

  try {
    token1Instance = await refreshTokenPrice(token1Instance, event.block.number, event.block.timestamp, event.chainId, context);
  } catch (error) {
    context.log.error(`Error refreshing token price for ${token1Instance?.address} on chain ${event.chainId}: ${error}`);
  }
  const normalizedAmount1 = normalizeTokenAmountTo1e18(
    abs(event.params.amount1),
    Number(token1Instance.decimals)
  );
  tokenUpdateData.netVolumeToken1USD = multiplyBase1e18(
    normalizedAmount1,
    token1Instance.pricePerUSDNew
  );

  // Use volume from token 0 if it's priced, otherwise use token 1
  tokenUpdateData.volumeInUSD =
    tokenUpdateData.netVolumeToken0USD != 0n
      ? tokenUpdateData.netVolumeToken0USD
      : tokenUpdateData.netVolumeToken1USD;

  liquidityPoolAggregatorDiff = {
    ...liquidityPoolAggregatorDiff,
    totalVolume1:
      liquidityPoolAggregator.totalVolume1 + tokenUpdateData.netAmount1,
    token1Price:
      token1Instance?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    token1IsWhitelisted: token1Instance?.isWhitelisted ?? false,
  };

  return { ...data, liquidityPoolAggregatorDiff, tokenUpdateData, token1Instance };
}

const updateLiquidityPoolAggregatorDiffSwap = (data: SwapEntityData, reserveResult: any) => {
  data.liquidityPoolAggregatorDiff = {
    ...data.liquidityPoolAggregatorDiff,
    numberOfSwaps: data.liquidityPoolAggregator.numberOfSwaps + 1n,
    reserve0: data.liquidityPoolAggregator.reserve0 + reserveResult.reserve0,
    reserve1: data.liquidityPoolAggregator.reserve1 + reserveResult.reserve1,
    totalVolumeUSD: data.liquidityPoolAggregator.totalVolumeUSD + data.tokenUpdateData.volumeInUSD,
    totalVolumeUSDWhitelisted: data.liquidityPoolAggregator.totalVolumeUSDWhitelisted + data.tokenUpdateData.volumeInUSDWhitelisted,
    totalLiquidityUSD: reserveResult.addTotalLiquidityUSD,
  };
  return data;
};

CLPool.Swap.handlerWithLoader({
  loader: async ({ event, context }) => {
    return fetchPoolLoaderData(event.srcAddress, context, event.chainId);
  },
  handler: async ({ event, context, loaderReturn }) => {
    const blockDatetime = new Date(event.block.timestamp * 1000);
    const entity: CLPool_Swap = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      sender: event.params.sender,
      recipient: event.params.recipient,
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      sqrtPriceX96: event.params.sqrtPriceX96,
      liquidity: event.params.liquidity,
      tick: event.params.tick,
      sourceAddress: event.srcAddress,
      timestamp: blockDatetime,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      chainId: event.chainId,
      transactionHash: event.transaction.hash
    };

    context.CLPool_Swap.set(entity);

    // Delta that will be added to the liquidity pool aggregator
    let tokenUpdateData = {
      netAmount0: abs(event.params.amount0),
      netAmount1: abs(event.params.amount1),
      netVolumeToken0USD: 0n,
      netVolumeToken1USD: 0n,
      volumeInUSD: 0n,
      volumeInUSDWhitelisted: 0n,
    };

    let liquidityPoolAggregatorDiff: Partial<LiquidityPoolAggregator> = {}

    switch (loaderReturn._type) {
      case "success":
        let successSwapEntityData: SwapEntityData = {
          liquidityPoolAggregator: loaderReturn.liquidityPoolAggregator,
          token0Instance: loaderReturn.token0Instance,
          token1Instance: loaderReturn.token1Instance,
          tokenUpdateData,
          liquidityPoolAggregatorDiff,
        }

        successSwapEntityData = await updateToken0SwapData(successSwapEntityData, event, context);
        successSwapEntityData = await updateToken1SwapData(successSwapEntityData, event, context);

        // If both tokens are whitelisted, add the volume of token0 to the whitelisted volume
        successSwapEntityData.tokenUpdateData.volumeInUSDWhitelisted += (successSwapEntityData.token0Instance?.isWhitelisted && successSwapEntityData.token1Instance?.isWhitelisted)
          ? successSwapEntityData.tokenUpdateData.netVolumeToken0USD : 0n;
        
        let successReserveResult = updateCLPoolLiquidity(
          successSwapEntityData.liquidityPoolAggregator,
          event,
          successSwapEntityData.token0Instance,
          successSwapEntityData.token1Instance
        );

        // Merge with previous liquidity pool aggregator values.
        successSwapEntityData = updateLiquidityPoolAggregatorDiffSwap(successSwapEntityData, successReserveResult);

        updateLiquidityPoolAggregator(
          successSwapEntityData.liquidityPoolAggregatorDiff,
          successSwapEntityData.liquidityPoolAggregator,
          blockDatetime,
          context,
          event.block.number
        );
        return;
      case "TokenNotFoundError":
        context.log.error(loaderReturn.message);
        return;
      case "LiquidityPoolAggregatorNotFoundError":
        context.log.error(loaderReturn.message);
        return;

      default:
        const _exhaustiveCheck: never = loaderReturn;
        return _exhaustiveCheck;
    }
  },
});
