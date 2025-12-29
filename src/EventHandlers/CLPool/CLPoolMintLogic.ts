import type { CLPool_Mint_event, Token } from "generated";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolMintResult {
  liquidityPoolDiff: {
    reserve0: bigint;
    reserve1: bigint;
    totalLiquidityUSD: bigint;
    lastUpdatedTimestamp: Date;
  };
  userLiquidityDiff: {
    currentLiquidityUSD: bigint;
    currentLiquidityToken0: bigint;
    currentLiquidityToken1: bigint;
    totalLiquidityAddedUSD: bigint;
    lastActivityTimestamp: Date;
  };
}

export function processCLPoolMint(
  event: CLPool_Mint_event,
  token0Instance: Token,
  token1Instance: Token,
): CLPoolMintResult {
  // Calculate USD values using already-refreshed token prices from loadPoolData
  const totalLiquidityUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    reserve0: event.params.amount0,
    reserve1: event.params.amount1,
    totalLiquidityUSD,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userLiquidityDiff = {
    currentLiquidityUSD: totalLiquidityUSD, // For mint, we're adding liquidity
    currentLiquidityToken0: event.params.amount0, // Amount of token0 added
    currentLiquidityToken1: event.params.amount1, // Amount of token1 added
    totalLiquidityAddedUSD: totalLiquidityUSD, // Track total liquidity added
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userLiquidityDiff,
  };
}
