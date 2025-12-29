import type { CLPool_Flash_event, Token } from "generated";
import { calculateTotalLiquidityUSD } from "../../Helpers";

export interface CLPoolFlashResult {
  liquidityPoolDiff: {
    totalFlashLoanFees0: bigint;
    totalFlashLoanFees1: bigint;
    totalFlashLoanFeesUSD: bigint;
    totalFlashLoanVolume0: bigint;
    totalFlashLoanVolume1: bigint;
    totalFlashLoanVolumeUSD: bigint;
    numberOfFlashLoans: bigint;
    lastUpdatedTimestamp: Date;
  };
  userFlashLoanDiff: {
    numberOfFlashLoans: bigint;
    totalFlashLoanVolume0: bigint;
    totalFlashLoanVolume1: bigint;
    totalFlashLoanVolumeUSD: bigint;
    lastActivityTimestamp: Date;
  };
}

export function processCLPoolFlash(
  event: CLPool_Flash_event,
  token0Instance: Token | undefined,
  token1Instance: Token | undefined,
): CLPoolFlashResult {
  // Calculate flash loan fees in USD using already-refreshed token prices from loadPoolData
  const flashLoanFeesUSD = calculateTotalLiquidityUSD(
    event.params.paid0,
    event.params.paid1,
    token0Instance,
    token1Instance,
  );

  // Calculate flash loan volume in USD (amount borrowed, not fees) using already-refreshed token prices
  const flashLoanVolumeUSD = calculateTotalLiquidityUSD(
    event.params.amount0,
    event.params.amount1,
    token0Instance,
    token1Instance,
  );

  const liquidityPoolDiff = {
    totalFlashLoanFees0: event.params.paid0,
    totalFlashLoanFees1: event.params.paid1,
    totalFlashLoanFeesUSD: flashLoanFeesUSD,
    totalFlashLoanVolume0: event.params.amount0,
    totalFlashLoanVolume1: event.params.amount1,
    totalFlashLoanVolumeUSD: flashLoanVolumeUSD,
    numberOfFlashLoans: 1n,
    lastUpdatedTimestamp: new Date(event.block.timestamp * 1000),
  };

  const userFlashLoanDiff = {
    numberOfFlashLoans: 1n, // Each flash event represents 1 flash loan
    totalFlashLoanVolume0: event.params.amount0,
    totalFlashLoanVolume1: event.params.amount1,
    totalFlashLoanVolumeUSD: flashLoanVolumeUSD,
    lastActivityTimestamp: new Date(event.block.timestamp * 1000),
  };

  return {
    liquidityPoolDiff,
    userFlashLoanDiff,
  };
}
