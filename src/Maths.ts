import { TEN_TO_THE_18_BI } from "./Constants";

// Helper function to perform multiplication for base 1e18 numbers
export const multiplyBase1e18 = (a: bigint, b: bigint): bigint => {
  return (a * b) / TEN_TO_THE_18_BI;
};

// Helper function to perform division for base 1e18 numbers
export const divideBase1e18 = (a: bigint, b: bigint): bigint => {
  return (a * TEN_TO_THE_18_BI) / b;
};

export const abs = (n: bigint): bigint => {
  return n === -0n || n < 0n ? -n : n;
};
