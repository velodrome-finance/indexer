import type {
  CLPool_Flash_event,
  LiquidityPoolAggregator,
  Token,
  handlerContext,
} from "generated";
import { updateTokenData } from "../../Helpers";

export interface CLPoolFlashResult {
  liquidityPoolDiff?: {
    totalFlashLoanFees0: bigint;
    totalFlashLoanFees1: bigint;
    totalFlashLoanFeesUSD: bigint;
    totalFlashLoanVolumeUSD: bigint;
    numberOfFlashLoans: bigint;
    lastUpdatedTimestamp: Date;
  };
  userFlashLoanDiff?: {
    numberOfFlashLoans: bigint;
    totalFlashLoanVolumeUSD: bigint;
    timestamp: Date;
  };
  error?: string;
}

export type CLPoolFlashLoaderReturn =
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

export async function processCLPoolFlash(
  event: CLPool_Flash_event,
  loaderReturn: CLPoolFlashLoaderReturn,
  context: handlerContext,
): Promise<CLPoolFlashResult> {
  // Handle different loader return types
  switch (loaderReturn._type) {
    case "success": {
      const { liquidityPoolAggregator, token0Instance, token1Instance } =
        loaderReturn;

      // Calculate flash loan fees in USD
      let flashLoanFeesUSD = 0n;
      if (token0Instance && event.params.paid0 > 0n) {
        const token0Data = await updateTokenData(
          token0Instance,
          event.params.paid0,
          event,
          context,
        );
        flashLoanFeesUSD += token0Data.usdValue;
      }
      if (token1Instance && event.params.paid1 > 0n) {
        const token1Data = await updateTokenData(
          token1Instance,
          event.params.paid1,
          event,
          context,
        );
        flashLoanFeesUSD += token1Data.usdValue;
      }

      // Calculate flash loan volume in USD (amount borrowed, not fees)
      let flashLoanVolumeUSD = 0n;
      if (token0Instance && event.params.amount0 > 0n) {
        const token0Data = await updateTokenData(
          token0Instance,
          event.params.amount0,
          event,
          context,
        );
        flashLoanVolumeUSD += token0Data.usdValue;
      }
      if (token1Instance && event.params.amount1 > 0n) {
        const token1Data = await updateTokenData(
          token1Instance,
          event.params.amount1,
          event,
          context,
        );
        flashLoanVolumeUSD += token1Data.usdValue;
      }

      const liquidityPoolDiff = {
        totalFlashLoanFees0: event.params.paid0,
        totalFlashLoanFees1: event.params.paid1,
        totalFlashLoanFeesUSD: flashLoanFeesUSD,
        totalFlashLoanVolumeUSD: flashLoanVolumeUSD,
        numberOfFlashLoans: 1n,
        lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
      };

      const userFlashLoanDiff = {
        numberOfFlashLoans: 1n, // Each flash event represents 1 flash loan
        totalFlashLoanVolumeUSD: flashLoanVolumeUSD,
        timestamp: new Date(event.block.timestamp * 1000),
      };

      return {
        liquidityPoolDiff,
        userFlashLoanDiff,
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
