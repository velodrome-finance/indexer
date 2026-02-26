import type { PublicClient } from "viem";
import CL_FACTORY_ABI from "../../../abis/CLFactory.json";

/**
 * Fetches the current swap fee for a pool from the CL factory that created it.
 * Pure RPC; use RpcGateway for retry and fallback.
 *
 * @param poolAddress - Pool contract address.
 * @param factoryAddress - CL factory contract that created the pool (exposes getSwapFee).
 * @param blockNumber - Block at which to read the fee.
 * @param ethClient - Viem public client for the chain.
 * @returns The swap fee as bigint (non-bigint contract results are coerced via BigInt(String(result))).
 * @throws Propagates RPC/contract errors; caller should use executeRpcWithFallback.
 */
export async function fetchSwapFee(
  poolAddress: string,
  factoryAddress: string,
  blockNumber: number,
  ethClient: PublicClient,
): Promise<bigint> {
  const result = await ethClient.readContract({
    address: factoryAddress as `0x${string}`,
    abi: CL_FACTORY_ABI,
    functionName: "getSwapFee",
    args: [poolAddress as `0x${string}`],
    blockNumber: BigInt(blockNumber),
  });

  return typeof result === "bigint" ? result : BigInt(String(result));
}
