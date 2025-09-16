import type {
  CLPool_Mint_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { updateCLPoolLiquidity } from "./updateCLPoolLiquidity";

export interface CLPoolMintResult {
  CLPoolMintEntity: {
    id: string;
    sender: string;
    transactionHash: string;
    owner: string;
    tickLower: bigint;
    tickUpper: bigint;
    amount: bigint;
    amount0: bigint;
    amount1: bigint;
    sourceAddress: string;
    timestamp: Date;
    blockNumber: number;
    logIndex: number;
    chainId: number;
  };
  liquidityPoolDiff?: {
    reserve0: bigint;
    reserve1: bigint;
    totalLiquidityUSD: bigint;
    lastUpdatedTimestamp: Date;
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

export function processCLPoolMint(
  event: CLPool_Mint_event,
  loaderReturn: CLPoolMintLoaderReturn,
): CLPoolMintResult {
  // Create the entity
  const CLPoolMintEntity = {
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
        reserve0: liquidityPoolAggregator.reserve0 + tokenUpdateData.reserve0,
        reserve1: liquidityPoolAggregator.reserve1 + tokenUpdateData.reserve1,
        totalLiquidityUSD: tokenUpdateData.addTotalLiquidityUSD,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        CLPoolMintEntity,
        liquidityPoolDiff,
      };
    }
    case "TokenNotFoundError":
      return {
        CLPoolMintEntity,
        error: loaderReturn.message,
      };
    case "LiquidityPoolAggregatorNotFoundError":
      return {
        CLPoolMintEntity,
        error: loaderReturn.message,
      };
    default: {
      // This should never happen due to TypeScript's exhaustive checking
      return {
        CLPoolMintEntity,
        error: "Unknown error type",
      };
    }
  }
}
