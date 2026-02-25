import { S, createEffect } from "envio";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchSwapFee } from "./fetchers/SwapFee";

/**
 * Effect to get the current swap fee for a pool from the CL factory that created it.
 * Delegates to {@link rpcGateway}; on error returns undefined.
 *
 * @param input.poolAddress - Pool contract address.
 * @param input.factoryAddress - CL factory that created the pool.
 * @param input.chainId - Chain ID for RPC.
 * @param input.blockNumber - Block at which to read the fee.
 * @returns Promise resolving to swap fee (bigint) or undefined on error.
 */
export const getSwapFee = createEffect(
  {
    name: EffectType.GET_SWAP_FEE,
    input: {
      poolAddress: S.string,
      factoryAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    },
    output: S.nullable(S.bigint),
    rateLimit: false,
    cache: true,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.GET_SWAP_FEE,
      poolAddress: input.poolAddress,
      factoryAddress: input.factoryAddress,
      chainId: input.chainId,
      blockNumber: input.blockNumber,
    });
    return result.value;
  },
);
