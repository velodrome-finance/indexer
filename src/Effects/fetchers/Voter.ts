import type { PublicClient } from "viem";
import ERC20_ABI from "../../../abis/ERC20.json";

/**
 * Fetches the balance of a reward token held by a gauge (tokens deposited in the gauge).
 * Uses ERC20 balanceOf(rewardToken, gauge). Pure RPC; use RpcGateway for retry and fallback.
 *
 * @param rewardTokenAddress - ERC20 reward token contract address.
 * @param gaugeAddress - Gauge contract address (balanceOf target).
 * @param blockNumber - Block at which to read the balance.
 * @param ethClient - Viem public client for the chain.
 * @returns The token balance as bigint; 0n if result is null/undefined.
 * @throws Propagates RPC/contract errors; caller should use executeRpcWithFallback.
 */
export async function fetchTokensDeposited(
  rewardTokenAddress: string,
  gaugeAddress: string,
  blockNumber: number,
  ethClient: PublicClient,
): Promise<bigint> {
  const result = await ethClient.readContract({
    address: rewardTokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [gaugeAddress],
    blockNumber: BigInt(blockNumber),
  });

  const balance =
    result === null || result === undefined
      ? 0n
      : typeof result === "bigint"
        ? result
        : BigInt(result as string | number | bigint);

  return balance;
}
