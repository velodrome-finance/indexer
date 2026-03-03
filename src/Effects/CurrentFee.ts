import { S, createEffect } from "envio";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchSwapFee } from "./fetchers/SwapFee";

/**
 * Effect to get the current swap fee for a pool from the CL factory that created it.
 * Delegates to {@link rpcGateway}. RPC/contract errors are handled by the gateway and yield undefined.
 * Other errors (e.g. invalid chainId) may propagate.
 *
 * @param input.poolAddress - Pool contract address.
 * @param input.factoryAddress - CL factory that created the pool.
 * @param input.chainId - Chain ID for RPC.
 * @param input.blockNumber - Block at which to read the fee.
 * @returns Promise resolving to swap fee (bigint) or undefined when the gateway handles an RPC/contract error.
 */
export const getCurrentFee = createEffect(
  {
    name: EffectType.GET_CURRENT_FEE,
    input: {
      poolAddress: S.string,
      factoryAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    output: S.optional(S.bigint),
    rateLimit: false,
    cache: true,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.GET_CURRENT_FEE,
      poolAddress: input.poolAddress,
      factoryAddress: input.factoryAddress,
      chainId: input.chainId,
      blockNumber: input.blockNumber,
    });
    return result.value;
  },
);
