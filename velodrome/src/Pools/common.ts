import {
  LiquidityPoolAggregator,
  Token
} from "generated";
import { loaderContext } from "generated/src/Types.gen";

export type PoolLoaderSuccessType = "success";
export type PoolLoaderErrorType = "LiquidityPoolAggregatorNotFoundError" | "TokenNotFoundError";

export type PoolLoaderStatus = PoolLoaderSuccessType | PoolLoaderErrorType;

export type PoolLoaderData = {
  liquidityPoolAggregator: LiquidityPoolAggregator;
  token0Instance: Token;
  token1Instance: Token;
}

export type PoolLoaderSuccess = {
  _type: "success";
} & PoolLoaderData;

export type PoolLoaderTokenError = {
  _type: "TokenNotFoundError";
  message: string;
  available: {
    liquidityPoolAggregator: LiquidityPoolAggregator;
    token0Instance?: Token;
    token1Instance?: Token;
  }
}

export type PoolLoaderLiquidityPoolError = {
  _type: "LiquidityPoolAggregatorNotFoundError";
  message: string;
  available: Partial<PoolLoaderData>
}

export type PoolLoaderError<T extends PoolLoaderErrorType> = T extends "TokenNotFoundError" ?
  PoolLoaderTokenError : PoolLoaderLiquidityPoolError;

export type PoolLoader<T extends PoolLoaderStatus> = T extends "success" ?
  PoolLoaderSuccess :
    T extends PoolLoaderErrorType ?
      PoolLoaderError<T> : never;

/**
 * Fetches the liquidity pool aggregator and token instances for a given event.
 * 
 * @param event - The event containing the pool address
 * @param context - The context object containing the database
 * 
 * @returns {PoolLoader} - The loader return object
 */
export async function fetchPoolLoaderData(liquidityPoolAddress: string, context: loaderContext, chainId: number): Promise<PoolLoader<PoolLoaderStatus> > {
  const liquidityPoolAggregator = await context.LiquidityPoolAggregator.get(liquidityPoolAddress);
  if (!liquidityPoolAggregator) {
    return { 
      _type: "LiquidityPoolAggregatorNotFoundError", 
      message: `LiquidityPoolAggregator ${liquidityPoolAddress} not found on chain ${chainId}`,
      available: {
        liquidityPoolAggregator: undefined,
        token0Instance: undefined,
        token1Instance: undefined
      }
    };
  }
  const [token0Instance, token1Instance] =
    await Promise.all([
      context.Token.get(liquidityPoolAggregator.token0_id),
      context.Token.get(liquidityPoolAggregator.token1_id),
    ]);

  if (token0Instance == undefined || token1Instance == undefined) {
    return { 
      _type: "TokenNotFoundError", 
      message: `Token not found for pool ${liquidityPoolAddress} on chain ${chainId}`,
      available: {
        liquidityPoolAggregator,
        token0Instance,
        token1Instance
      } };
  }

  return { _type: "success", liquidityPoolAggregator, token0Instance, token1Instance };
}