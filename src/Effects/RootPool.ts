import { S, createEffect } from "envio";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchRootPoolAddress } from "./fetchers/RootPool";

/**
 * Effect to get the root pool address for a leaf pool from the LpHelper contract.
 * Delegates to {@link rpcGateway}. The gateway handles RPC errors internally and
 * returns "" on failure (via executeRpcWithFallback); this effect returns that
 * result as-is.
 *
 * @param input.chainId - Chain ID for RPC.
 * @param input.factory - Factory contract address.
 * @param input.token0 - First token of the pair.
 * @param input.token1 - Second token of the pair.
 * @param input.type - Pool type identifier (forwarded as poolType to rpcGateway).
 * @returns Promise resolving to checksummed root pool address or "" when the gateway returns empty (e.g. RPC error).
 */
export const getRootPoolAddress = createEffect(
  {
    name: EffectType.GET_ROOT_POOL_ADDRESS,
    input: {
      chainId: S.number,
      factory: S.string,
      token0: S.string,
      token1: S.string,
      type: S.number,
    },
    output: S.string,
    rateLimit: false,
    cache: true,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.GET_ROOT_POOL_ADDRESS,
      chainId: input.chainId,
      factory: input.factory,
      token0: input.token0,
      token1: input.token1,
      poolType: input.type,
    });
    return result.value;
  },
);
