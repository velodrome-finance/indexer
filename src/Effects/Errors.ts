import { http, type Chain, type PublicClient, createPublicClient } from "viem";
import {
  base,
  celo,
  fraxtal,
  ink,
  lisk,
  metalL2,
  mode,
  optimism,
  soneium,
  swellchain,
  unichain,
} from "viem/chains";
import { getDefaultRPCByChainId } from "../Constants";

// Map chain IDs to their corresponding viem chain objects
const chainIdToChain: Record<number, Chain> = {
  10: optimism,
  8453: base,
  1135: lisk,
  34443: mode,
  42220: celo,
  1868: soneium,
  130: unichain,
  252: fraxtal,
  57073: ink,
  1750: metalL2,
  1923: swellchain,
};

/**
 * Creates a fallback PublicClient using public RPC for the given chain
 */
export function createFallbackClient(chainId: number): PublicClient | null {
  const publicRpcUrl = getDefaultRPCByChainId(chainId);
  if (!publicRpcUrl) {
    return null;
  }

  const chain = chainIdToChain[chainId];
  if (!chain) {
    return null;
  }

  return createPublicClient({
    chain: chain satisfies Chain as Chain,
    transport: http(publicRpcUrl, { batch: true }),
  });
}

/**
 * Checks if the error should trigger a fallback to public RPC
 * This includes historical state errors and temporary RPC errors
 */
export function shouldUseFallbackRPC(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Check for historical state not available (various phrasings)
  // The error message can contain these in different parts (Details section, etc.)
  const isHistoricalStateError =
    (errorMessage.includes("historical state") &&
      errorMessage.includes("not available")) ||
    errorMessage.includes("state histories haven't been fully indexed") ||
    errorMessage.includes("state histories") ||
    errorMessage.includes("haven't been fully indexed") ||
    (errorMessage.includes("Missing or invalid parameters") &&
      (errorMessage.includes("state histories") ||
        errorMessage.includes("haven't been fully indexed")));

  // Check for temporary RPC errors
  const isTemporaryRpcError =
    errorMessage.includes("Temporary internal error") ||
    errorMessage.includes("RPC Request failed") ||
    errorMessage.includes("Please retry");

  // Check for rate limiting or timeout errors
  const isRateLimitError =
    errorMessage.includes("rate limit") ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("ETIMEDOUT");

  return isHistoricalStateError || isTemporaryRpcError || isRateLimitError;
}
