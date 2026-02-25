import type { PublicClient } from "viem";
import lpHelperABI from "../../../abis/LpHelper.json";
import { ZERO_ADDRESS, toChecksumAddress } from "../../Constants";

/**
 * Fetches the root pool address for a given factory and token pair from the LpHelper contract.
 * Handles array or single-value contract return; normalizes empty to "" and addresses to checksum.
 * Pure RPC; use RpcGateway for retry and fallback.
 *
 * @param ethClient - Viem public client for the chain.
 * @param lpHelperAddress - LpHelper contract address (exposes root_lp_address).
 * @param factory - Factory contract address.
 * @param token0 - First token of the pair.
 * @param token1 - Second token of the pair.
 * @param type - Pool type identifier passed to root_lp_address.
 * @returns Checksummed root pool address, or "" if the result is null/undefined/empty.
 * @throws Propagates RPC/contract errors; caller should use executeRpcWithFallback.
 */
export async function fetchRootPoolAddress(
  ethClient: PublicClient,
  lpHelperAddress: string,
  factory: string,
  token0: string,
  token1: string,
  type: number,
): Promise<string> {
  const result = await ethClient.readContract({
    address: lpHelperAddress as `0x${string}`,
    abi: lpHelperABI,
    functionName: "root_lp_address",
    args: [factory, token0, token1, type],
  });

  const address = Array.isArray(result) ? result[0] : result;
  const normalized = String(address ?? "");

  if (!normalized || normalized === ZERO_ADDRESS) {
    return "";
  }

  return toChecksumAddress(normalized);
}
