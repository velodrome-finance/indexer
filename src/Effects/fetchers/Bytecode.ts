import type { PublicClient } from "viem";

/**
 * Returns true when the address has non-empty deployed bytecode.
 * Used as a gate at Token-row creation sites to filter out EOAs / non-contract
 * addresses that would otherwise persist Token rows with empty symbol/name.
 *
 * @param address - Address to query.
 * @param ethClient - Viem public client for the chain.
 * @returns True if `eth_getCode` returns non-empty bytecode, false for `0x` / undefined.
 * @throws Propagates RPC errors; caller should wrap with executeRpcWithFallback.
 */
export async function fetchHasContractBytecode(
  address: string,
  ethClient: PublicClient,
): Promise<boolean> {
  const code = await ethClient.getCode({ address: address as `0x${string}` });
  return Boolean(code) && code !== "0x";
}
