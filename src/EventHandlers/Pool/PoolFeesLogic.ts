import type {
  LiquidityPoolAggregator,
  Pool_Fees_event,
  Token,
  handlerContext,
} from "generated";
import { updateFeeTokenData } from "../../Helpers";

export interface UserDiff {
  userAddress: string;
  chainId: number;
  feesContributedUSD: bigint;
  feesContributed0: bigint;
  feesContributed1: bigint;
  timestamp: Date;
}

export interface PoolFeesResult {
  liquidityPoolDiff?: Partial<LiquidityPoolAggregator>;
  userDiff?: UserDiff;
  error?: string;
}

export type PoolFeesLoaderReturn =
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

export async function processPoolFees(
  event: Pool_Fees_event,
  loaderReturn: PoolFeesLoaderReturn,
  context: handlerContext,
): Promise<PoolFeesResult> {
  // Handle different loader return types
  switch (loaderReturn._type) {
    case "success": {
      const { liquidityPoolAggregator, token0Instance, token1Instance } =
        loaderReturn;

      // Use existing helper function for fee token data updates
      const feeData = await updateFeeTokenData(
        token0Instance,
        token1Instance,
        event.params.amount0,
        event.params.amount1,
        event,
        context,
      );

      // Create liquidity pool diff
      const liquidityPoolDiff: Partial<LiquidityPoolAggregator> = {
        totalFees0: event.params.amount0,
        totalFees1: event.params.amount1,
        totalFeesUSD: feeData.totalFeesUSD,
        totalFeesUSDWhitelisted: feeData.totalFeesUSDWhitelisted,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      // Prepare user diff data
      const userDiff: UserDiff = {
        userAddress: event.params.sender,
        chainId: event.chainId,
        feesContributedUSD: feeData.totalFeesUSD,
        feesContributed0: event.params.amount0,
        feesContributed1: event.params.amount1,
        timestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        liquidityPoolDiff,
        userDiff,
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
