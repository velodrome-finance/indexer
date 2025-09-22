import type {
  CLPool_Collect_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { updateCLPoolLiquidity } from "./updateCLPoolLiquidity";

export interface CLPoolCollectResult {
  CLPoolCollectEntity: {
    id: string;
    owner: string;
    recipient: string;
    tickLower: bigint;
    tickUpper: bigint;
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
    lastUpdatedTimestamp: Date;
  };
  error?: string;
}

export type CLPoolCollectLoaderReturn =
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

export function processCLPoolCollect(
  event: CLPool_Collect_event,
  loaderReturn: CLPoolCollectLoaderReturn,
): CLPoolCollectResult {
  // Create the entity
  const CLPoolCollectEntity = {
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

      const liquidityPoolDiff = {
        reserve0: liquidityPoolAggregator.reserve0 - tokenUpdateData.reserve0,
        reserve1: liquidityPoolAggregator.reserve1 - tokenUpdateData.reserve1,
        totalLiquidityUSD: tokenUpdateData.subTotalLiquidityUSD,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        CLPoolCollectEntity,
        liquidityPoolDiff,
      };
    }
    case "TokenNotFoundError":
      return {
        CLPoolCollectEntity,
        error: loaderReturn.message,
      };
    case "LiquidityPoolAggregatorNotFoundError":
      return {
        CLPoolCollectEntity,
        error: loaderReturn.message,
      };
    default: {
      // This should never happen due to TypeScript's exhaustive checking
      return {
        CLPoolCollectEntity,
        error: "Unknown error type",
      };
    }
  }
}
