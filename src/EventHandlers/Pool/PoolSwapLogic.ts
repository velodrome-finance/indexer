import type {
  LiquidityPoolAggregator,
  Pool_Swap_event,
  Token,
  handlerContext,
} from "generated";
import { updateSwapTokenData } from "../../Helpers";

export interface PoolSwapResult {
  PoolSwapEntity: {
    id: string;
    sender: string;
    to: string;
    amount0In: bigint;
    amount1In: bigint;
    amount0Out: bigint;
    amount1Out: bigint;
    sourceAddress: string;
    timestamp: Date;
    blockNumber: number;
    logIndex: number;
    chainId: number;
    transactionHash: string;
  };
  liquidityPoolDiff?: Partial<LiquidityPoolAggregator>;
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
  // Create the entity
  const PoolSwapEntity = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sender: event.params.sender,
    to: event.params.to,
    amount0In: event.params.amount0In,
    amount1In: event.params.amount1In,
    amount0Out: event.params.amount0Out,
    amount1Out: event.params.amount1Out,
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
        totalVolume0:
          liquidityPoolAggregator.totalVolume0 + swapData.token0NetAmount,
        totalVolume1:
          liquidityPoolAggregator.totalVolume1 + swapData.token1NetAmount,
        totalVolumeUSD:
          liquidityPoolAggregator.totalVolumeUSD + swapData.volumeInUSD,
        totalVolumeUSDWhitelisted:
          liquidityPoolAggregator.totalVolumeUSDWhitelisted +
          swapData.volumeInUSDWhitelisted,
        token0Price:
          swapData.token0.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
        token1Price:
          swapData.token1.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
        numberOfSwaps: liquidityPoolAggregator.numberOfSwaps + 1n,
        token0IsWhitelisted: swapData.token0.isWhitelisted,
        token1IsWhitelisted: swapData.token1.isWhitelisted,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        PoolSwapEntity,
        liquidityPoolDiff,
      };
    }
    case "TokenNotFoundError":
      return {
        PoolSwapEntity,
        error: loaderReturn.message,
      };
    case "LiquidityPoolAggregatorNotFoundError":
      return {
        PoolSwapEntity,
        error: loaderReturn.message,
      };
    default: {
      // This should never happen due to TypeScript's exhaustive checking
      return {
        PoolSwapEntity,
        error: "Unknown error type",
      };
    }
  }
}
