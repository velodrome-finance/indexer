import type {
  CLPool_Mint_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { updateReserveTokenData } from "../../Helpers";

export interface CLPoolMintResult {
  liquidityPoolDiff?: {
    reserve0: bigint;
    reserve1: bigint;
    totalLiquidityUSD: bigint;
    lastUpdatedTimestamp: Date;
  };
  userLiquidityDiff?: {
    netLiquidityAddedUSD: bigint;
    currentLiquidityToken0: bigint;
    currentLiquidityToken1: bigint;
    timestamp: Date;
  };
  error?: string;
}

export type CLPoolMintLoaderReturn =
  | {
      _type: "success";
      liquidityPoolAggregator: LiquidityPoolAggregator;
      token0Instance: Token;
      token1Instance: Token;
    }
  | {
      _type: "TokenNotFoundError";
      message: string;
    }
  | {
      _type: "LiquidityPoolAggregatorNotFoundError";
      message: string;
    };

export async function processCLPoolMint(
  event: CLPool_Mint_event,
  loaderReturn: CLPoolMintLoaderReturn,
  context: handlerContext,
): Promise<CLPoolMintResult> {
  // Handle different loader return types
  switch (loaderReturn._type) {
    case "success": {
      const { liquidityPoolAggregator, token0Instance, token1Instance } =
        loaderReturn;

      // Update reserve data using the same approach as Pool events
      const reserveData = await updateReserveTokenData(
        token0Instance,
        token1Instance,
        event.params.amount0,
        event.params.amount1,
        event,
        context,
      );

      const liquidityPoolDiff = {
        reserve0: event.params.amount0,
        reserve1: event.params.amount1,
        totalLiquidityUSD: reserveData.totalLiquidityUSD,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      const userLiquidityDiff = {
        netLiquidityAddedUSD: reserveData.totalLiquidityUSD, // For mint, we're adding liquidity
        currentLiquidityToken0: event.params.amount0, // Amount of token0 added
        currentLiquidityToken1: event.params.amount1, // Amount of token1 added
        timestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        liquidityPoolDiff,
        userLiquidityDiff,
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
