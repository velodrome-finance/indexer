import type {
  CLPool_CollectFees_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { multiplyBase1e18 } from "../../Maths";
import { updateCLPoolLiquidity } from "./updateCLPoolLiquidity";

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
 * @returns {bigint} .totalFeesUSDWhitelisted - Cumulative fees collected in USD for whitelisted tokens
 */
function updateCLPoolFees(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  event: CLPool_CollectFees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
) {
  const tokenUpdateData = {
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
      Number(token0Instance.decimals),
    );

    const token0fees = multiplyBase1e18(
      normalizedFees0,
      token0Instance.pricePerUSDNew,
    );
    tokenUpdateData.totalFeesUSD += token0fees;
    tokenUpdateData.totalFeesUSDWhitelisted += token0Instance.isWhitelisted
      ? token0fees
      : 0n;
  }

  if (token1Instance) {
    const normalizedFees1 = normalizeTokenAmountTo1e18(
      event.params.amount1,
      Number(token1Instance.decimals),
    );
    const token1fees = multiplyBase1e18(
      normalizedFees1,
      token1Instance.pricePerUSDNew,
    );
    tokenUpdateData.totalFeesUSD += token1fees;
    tokenUpdateData.totalFeesUSDWhitelisted += token1Instance.isWhitelisted
      ? token1fees
      : 0n;
  }

  return tokenUpdateData;
}

export interface CLPoolCollectFeesResult {
  CLPoolCollectFeesEntity: {
    id: string;
    recipient: string;
    amount0: bigint;
    amount1: bigint;
    sourceAddress: string;
    timestamp: Date;
    blockNumber: number;
    logIndex: number;
    chainId: number;
    transactionHash: string;
  };
  liquidityPoolDiff?: {
    reserve0: bigint;
    reserve1: bigint;
    totalLiquidityUSD: bigint;
    totalFees0: bigint;
    totalFees1: bigint;
    totalFeesUSD: bigint;
    totalFeesUSDWhitelisted: bigint;
    lastUpdatedTimestamp: Date;
  };
  error?: string;
}

export type CLPoolCollectFeesLoaderReturn =
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

export function processCLPoolCollectFees(
  event: CLPool_CollectFees_event,
  loaderReturn: CLPoolCollectFeesLoaderReturn,
): CLPoolCollectFeesResult {
  // Create the entity
  const CLPoolCollectFeesEntity = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    recipient: event.params.recipient,
    amount0: event.params.amount0,
    amount1: event.params.amount1,
    sourceAddress: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    transactionHash: event.transaction.hash,
  };

  // Handle different loader return types
  switch (loaderReturn._type) {
    case "success": {
      const { liquidityPoolAggregator, token0Instance, token1Instance } =
        loaderReturn;

      const tokenUpdateData = updateCLPoolLiquidity(
        liquidityPoolAggregator,
        event,
        token0Instance,
        token1Instance,
      );

      const tokenUpdateFeesData = updateCLPoolFees(
        liquidityPoolAggregator,
        event,
        token0Instance,
        token1Instance,
      );

      const liquidityPoolDiff = {
        reserve0: liquidityPoolAggregator.reserve0 - tokenUpdateData.reserve0,
        reserve1: liquidityPoolAggregator.reserve1 - tokenUpdateData.reserve1,
        totalLiquidityUSD: tokenUpdateData.subTotalLiquidityUSD,
        totalFees0: tokenUpdateFeesData.totalFees0,
        totalFees1: tokenUpdateFeesData.totalFees1,
        totalFeesUSD: tokenUpdateFeesData.totalFeesUSD,
        totalFeesUSDWhitelisted: tokenUpdateFeesData.totalFeesUSDWhitelisted,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        CLPoolCollectFeesEntity,
        liquidityPoolDiff,
      };
    }
    case "TokenNotFoundError":
      return {
        CLPoolCollectFeesEntity,
        error: loaderReturn.message,
      };
    case "LiquidityPoolAggregatorNotFoundError":
      return {
        CLPoolCollectFeesEntity,
        error: loaderReturn.message,
      };
    default: {
      // This should never happen due to TypeScript's exhaustive checking
      return {
        CLPoolCollectFeesEntity,
        error: "Unknown error type",
      };
    }
  }
}
