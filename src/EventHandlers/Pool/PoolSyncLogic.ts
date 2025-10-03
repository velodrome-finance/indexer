import type {
  LiquidityPoolAggregator,
  Pool_Sync_event,
  Token,
  handlerContext,
} from "generated";
import { updateReserveTokenData } from "../../Helpers";

export interface PoolSyncResult {
  liquidityPoolDiff?: Partial<LiquidityPoolAggregator>;
  error?: string;
}

export type PoolSyncLoaderReturn =
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

export async function processPoolSync(
  event: Pool_Sync_event,
  loaderReturn: PoolSyncLoaderReturn,
  context: handlerContext,
): Promise<PoolSyncResult> {
  // Handle different loader return types
  switch (loaderReturn._type) {
    case "success": {
      const { liquidityPoolAggregator, token0Instance, token1Instance } =
        loaderReturn;

      const reserveData = await updateReserveTokenData(
        token0Instance,
        token1Instance,
        event.params.reserve0,
        event.params.reserve1,
        event,
        context,
      );

      const liquidityPoolDiff: Partial<LiquidityPoolAggregator> = {
        reserve0: event.params.reserve0,
        reserve1: event.params.reserve1,
        totalLiquidityUSD:
          reserveData.totalLiquidityUSD ??
          liquidityPoolAggregator.totalLiquidityUSD,
        token0Price:
          reserveData.token0?.pricePerUSDNew ??
          liquidityPoolAggregator.token0Price,
        token1Price:
          reserveData.token1?.pricePerUSDNew ??
          liquidityPoolAggregator.token1Price,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        liquidityPoolDiff,
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
