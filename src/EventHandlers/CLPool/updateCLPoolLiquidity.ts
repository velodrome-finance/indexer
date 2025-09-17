import type {
  CLPool_CollectFees_event,
  CLPool_Collect_event,
  CLPool_Mint_event,
  CLPool_Swap_event,
  LiquidityPoolAggregator,
  Token,
} from "generated";
import { normalizeTokenAmountTo1e18 } from "../../Helpers";
import { multiplyBase1e18 } from "../../Maths";

export interface TokenUpdateData {
  addTotalLiquidity0USD: bigint;
  subTotalLiquidity0USD: bigint;
  addTotalLiquidity1USD: bigint;
  subTotalLiquidity1USD: bigint;
  addTotalLiquidityUSD: bigint;
  subTotalLiquidityUSD: bigint;
  reserve0: bigint;
  reserve1: bigint;
  normalizedReserve0: bigint;
  normalizedReserve1: bigint;
}

export function updateCLPoolLiquidity(
  liquidityPoolAggregator: LiquidityPoolAggregator,
  event:
    | CLPool_Swap_event
    | CLPool_Mint_event
    | CLPool_Collect_event
    | CLPool_CollectFees_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): TokenUpdateData {
  const tokenUpdateData: TokenUpdateData = {
    addTotalLiquidity0USD: 0n,
    subTotalLiquidity0USD: 0n,
    addTotalLiquidity1USD: 0n,
    subTotalLiquidity1USD: 0n,
    addTotalLiquidityUSD: 0n,
    subTotalLiquidityUSD: 0n,
    reserve0: 0n,
    reserve1: 0n,
    normalizedReserve0: 0n,
    normalizedReserve1: 0n,
  };

  // Return new token reserve amounts
  tokenUpdateData.reserve0 = event.params.amount0;
  tokenUpdateData.reserve1 = event.params.amount1;

  // Update liquidity amounts in USD. Computes both the addition and subtraction of liquidity
  // from event params.
  if (token0Instance) {
    const normalizedReserveAdd0 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve0 + tokenUpdateData.reserve0,
      Number(token0Instance.decimals || 18),
    );
    const normalizedReserveSub0 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve0 - tokenUpdateData.reserve0,
      Number(token0Instance.decimals || 18),
    );

    tokenUpdateData.addTotalLiquidity0USD = multiplyBase1e18(
      normalizedReserveAdd0,
      liquidityPoolAggregator.token0Price,
    );

    tokenUpdateData.subTotalLiquidity0USD = multiplyBase1e18(
      normalizedReserveSub0,
      liquidityPoolAggregator.token0Price,
    );
  }

  if (token1Instance) {
    const normalizedReserveAdd1 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve1 + tokenUpdateData.reserve1,
      Number(token1Instance.decimals || 18),
    );
    const normalizedReserveSub1 = normalizeTokenAmountTo1e18(
      liquidityPoolAggregator.reserve1 - tokenUpdateData.reserve1,
      Number(token1Instance.decimals || 18),
    );

    tokenUpdateData.addTotalLiquidity1USD = multiplyBase1e18(
      normalizedReserveAdd1,
      liquidityPoolAggregator.token1Price,
    );

    tokenUpdateData.subTotalLiquidity1USD = multiplyBase1e18(
      normalizedReserveSub1,
      liquidityPoolAggregator.token1Price,
    );
  }

  tokenUpdateData.addTotalLiquidityUSD =
    tokenUpdateData.addTotalLiquidity0USD +
    tokenUpdateData.addTotalLiquidity1USD;
  tokenUpdateData.subTotalLiquidityUSD =
    tokenUpdateData.subTotalLiquidity0USD +
    tokenUpdateData.subTotalLiquidity1USD;

  return tokenUpdateData;
}
