import type {
  LiquidityPoolAggregator,
  Pool_Burn_event,
  Pool_Mint_event,
  Token,
  handlerContext,
} from "generated";
import { updateReserveTokenData } from "../../Helpers";

export interface UserLiquidityDiff {
  userAddress: string;
  chainId: number;
  netLiquidityAddedUSD: bigint; // Positive for added, negative for removed
  amount0: bigint;
  amount1: bigint;
  timestamp: Date;
}

export interface PoolLiquidityResult {
  liquidityPoolDiff: Partial<LiquidityPoolAggregator>;
  userLiquidityDiff?: UserLiquidityDiff;
}

/**
 * Common logic for mint and burn events
 * Updates reserve data and creates liquidity pool diff
 */
export async function processPoolLiquidityEvent(
  event: Pool_Mint_event | Pool_Burn_event,
  liquidityPoolAggregator: LiquidityPoolAggregator,
  token0Instance: Token,
  token1Instance: Token,
  amount0: bigint,
  amount1: bigint,
  context: handlerContext,
): Promise<PoolLiquidityResult> {
  // Update reserve data
  const reserveData = await updateReserveTokenData(
    token0Instance,
    token1Instance,
    amount0,
    amount1,
    event,
    context,
  );

  // Create liquidity pool diff
  const liquidityPoolDiff: Partial<LiquidityPoolAggregator> = {
    // Update token prices
    token0Price:
      reserveData.token0?.pricePerUSDNew ?? liquidityPoolAggregator.token0Price,
    token1Price:
      reserveData.token1?.pricePerUSDNew ?? liquidityPoolAggregator.token1Price,
    // Update whitelist status
    token0IsWhitelisted:
      reserveData.token0?.isWhitelisted ??
      liquidityPoolAggregator.token0IsWhitelisted,
    token1IsWhitelisted:
      reserveData.token1?.isWhitelisted ??
      liquidityPoolAggregator.token1IsWhitelisted,
    // Update total liquidity USD if available
    totalLiquidityUSD:
      reserveData.totalLiquidityUSD ??
      liquidityPoolAggregator.totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  // Create user liquidity diff for tracking user activity
  // Check if this is a mint event by looking for 'to' parameter (burn events have 'to', mint events don't)
  const isMintEvent = !("to" in event.params);
  const userLiquidityDiff: UserLiquidityDiff = {
    userAddress: event.params.sender,
    chainId: event.chainId,
    netLiquidityAddedUSD: isMintEvent
      ? reserveData.totalLiquidityUSD
      : -reserveData.totalLiquidityUSD,
    amount0,
    amount1,
    timestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
