import type { PublicClient } from "viem";
import ERC20_ABI from "../../../abis/ERC20.json";
import { ErrorType, getErrorType } from "../Helpers";

/**
 * Returns true when the address has non-empty deployed bytecode AND looks like
 * an ERC20 (probed via `decimals()` returning a valid uint8). Used as a gate
 * at Token-row creation sites to filter EOAs / non-contract addresses (#677)
 * and non-ERC20 contracts that have bytecode but revert on standard ERC20
 * calls (#736 — e.g. `8453-0xBd0bD2F62…5528`: 44,286 bytes of bytecode, but
 * name/symbol/decimals all revert).
 *
 * Reject conditions:
 * - `eth_getCode` returns empty bytecode (`undefined` / `"0x"`) — EOA case.
 * - `decimals()` reverts deterministically — non-ERC20 contract case. Caught
 *   here so the caller sees `false` (cacheable negative) rather than the
 *   gateway's fail-open `true`.
 * - `decimals()` returns a value outside [0, 255] or a non-numeric value —
 *   not an ERC20-shaped result.
 *
 * Transient/non-revert errors from either RPC call are propagated so
 * {@link executeRpcWithFallback} can retry and the outer effect can skip
 * caching the fail-open fallback (issue #692 policy is preserved).
 *
 * @param address - Address to query.
 * @param ethClient - Viem public client for the chain.
 * @returns True iff bytecode is non-empty and `decimals()` returns a valid uint8.
 * @throws Propagates non-revert RPC errors; caller should wrap with executeRpcWithFallback.
 */
export async function fetchHasContractBytecode(
  address: string,
  ethClient: PublicClient,
): Promise<boolean> {
  const code = await ethClient.getCode({ address: address as `0x${string}` });
  if (!code || code === "0x") {
    return false;
  }

  try {
    const decimals = await ethClient.readContract({
      address: address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
      args: [],
    });
    const n = Number(decimals);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  } catch (err) {
    if (getErrorType(err) === ErrorType.CONTRACT_REVERT) {
      return false;
    }
    throw err;
  }
}
