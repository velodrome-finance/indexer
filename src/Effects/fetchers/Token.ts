import type { PublicClient } from "viem";
import SpotPriceAggregatorABI from "../../../abis/SpotPriceAggregator.json";
import PriceOracleABI from "../../../abis/VeloPriceOracleABI.json";
import { PriceOracleType, getLegacyConstants } from "../../Constants";

/**
 * Fetches token price in USD from the chain's price oracle (V2, V3, or V4).
 * Chooses oracle and connector path from CHAIN_CONSTANTS; retries and error handling are in RpcGateway.
 *
 * @param tokenAddress - Token to price.
 * @param usdcAddress - USDC address used as quote by the oracle.
 * @param systemTokenAddress - System/reward token address for the oracle (chain-dependent).
 * @param wethAddress - WETH address for the oracle.
 * @param connectors - Additional token addresses used as oracle connectors (excluding the token and standard addresses).
 * @param chainId - Chain ID for oracle and constants lookup.
 * @param blockNumber - Block at which to read the price.
 * @param ethClient - Viem public client for RPC calls.
 * @returns Object with pricePerUSDNew (bigint) and priceOracleType (string).
 * @throws Propagates oracle/RPC errors; caller should use executeRpcWithFallback for retry + fallback.
 */
export async function fetchTokenPrice(
  tokenAddress: string,
  usdcAddress: string,
  systemTokenAddress: string,
  wethAddress: string,
  connectors: string[],
  chainId: number,
  blockNumber: number,
  ethClient: PublicClient,
): Promise<{ pricePerUSDNew: bigint; priceOracleType: string }> {
  const { oracle } = getLegacyConstants(chainId);
  const priceOracleType = oracle.getType(blockNumber);
  const priceOracleAddress = oracle.getAddress(priceOracleType);

  if (
    priceOracleType === PriceOracleType.V3 ||
    priceOracleType === PriceOracleType.V4
  ) {
    const tokenAddressArray = [
      ...connectors,
      systemTokenAddress,
      wethAddress,
      usdcAddress,
    ];
    const args = [[tokenAddress], usdcAddress, false, tokenAddressArray, 10];
    const result = await ethClient.readContract({
      address: priceOracleAddress as `0x${string}`,
      abi: SpotPriceAggregatorABI,
      functionName: "getManyRatesWithCustomConnectors",
      args,
      blockNumber: BigInt(blockNumber),
    });
    const arr = result as readonly bigint[];
    if (!Array.isArray(arr) || arr.length === 0 || arr[0] === undefined) {
      throw new Error(
        `Oracle (${priceOracleType}) returned empty or invalid result for token ${tokenAddress} at block ${blockNumber}`,
      );
    }
    return {
      pricePerUSDNew: BigInt(arr[0]),
      priceOracleType,
    };
  }

  const tokenAddressArray = [
    tokenAddress,
    ...connectors,
    systemTokenAddress,
    wethAddress,
    usdcAddress,
  ];
  const args = [1, tokenAddressArray];
  const result = await ethClient.readContract({
    address: priceOracleAddress as `0x${string}`,
    abi: PriceOracleABI,
    functionName: "getManyRatesWithConnectors",
    args,
    blockNumber: BigInt(blockNumber),
  });
  const arr = result as readonly bigint[];
  if (!Array.isArray(arr) || arr.length === 0 || arr[0] === undefined) {
    throw new Error(
      `Oracle (${priceOracleType}) returned empty or invalid result for token ${tokenAddress} at block ${blockNumber}`,
    );
  }
  return {
    pricePerUSDNew: BigInt(arr[0]),
    priceOracleType: priceOracleType,
  };
}
