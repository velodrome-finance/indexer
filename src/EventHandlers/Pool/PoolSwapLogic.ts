import type {
  LiquidityPoolAggregator,
  Pool_Swap_event,
  Token,
  handlerContext,
} from "generated";
import { updateSwapTokenData } from "../../Helpers";

export interface UserSwapDiff {
  userAddress: string;
  chainId: number;
  volumeUSD: bigint;
  timestamp: Date;
}

export interface PoolSwapResult {
  liquidityPoolDiff?: Partial<LiquidityPoolAggregator>;
  userSwapDiff?: UserSwapDiff;
  error?: string;
}

export type PoolSwapLoaderReturn =
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

export async function processPoolSwap(
  event: Pool_Swap_event,
  loaderReturn: PoolSwapLoaderReturn,
  context: handlerContext,
): Promise<PoolSwapResult> {
  // Handle different loader return types
  switch (loaderReturn._type) {
    case "success": {
      const { liquidityPoolAggregator, token0Instance, token1Instance } =
        loaderReturn;

      // Update token data
      const swapData = await updateSwapTokenData(
        token0Instance,
        token1Instance,
        event.params.amount0In + event.params.amount0Out,
        event.params.amount1In + event.params.amount1Out,
        event,
        context,
      );

      // Create liquidity pool diff
      const liquidityPoolDiff: Partial<LiquidityPoolAggregator> = {
        totalVolume0: swapData.token0NetAmount,
        totalVolume1: swapData.token1NetAmount,
        totalVolumeUSD: swapData.volumeInUSD,
        totalVolumeUSDWhitelisted: swapData.volumeInUSDWhitelisted,
        token0Price:
          swapData.token0.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
        token1Price:
          swapData.token1.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
        numberOfSwaps: 1n,
        token0IsWhitelisted: swapData.token0.isWhitelisted,
        token1IsWhitelisted: swapData.token1.isWhitelisted,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      // Create user swap diff
      const userSwapDiff: UserSwapDiff = {
        userAddress: event.params.sender,
        chainId: event.chainId,
        volumeUSD: swapData.volumeInUSD,
        timestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        liquidityPoolDiff,
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
