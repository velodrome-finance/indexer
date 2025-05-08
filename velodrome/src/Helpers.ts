import { TEN_TO_THE_18_BI, CHAIN_CONSTANTS } from "./Constants";

// Helper function to normalize token amounts to 1e18
export const normalizeTokenAmountTo1e18 = (
  amount: bigint,
  tokenDecimals: number
): bigint => {
  if (tokenDecimals != 0) {
    return (amount * TEN_TO_THE_18_BI) / BigInt(10 ** tokenDecimals);
  } else {
    return amount;
  }
};

// Helper function to get generate the pool name given token0 and token1 symbols and isStable boolean
export function generatePoolName(
  token0Symbol: string,
  token1Symbol: string,
  isStable: boolean,
  clTickSpacing: number
): string {
  let poolType = "";
  if (isStable) {
    poolType = "Stable";
  } else {
    poolType = "Volatile";
  }
  if (clTickSpacing != 0) {
    poolType = "CL-" + clTickSpacing;
  }
  return `${poolType} AMM - ${token0Symbol}/${token1Symbol}`;
}
