import { S, createEffect } from "envio";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchHasContractBytecode } from "./fetchers/Bytecode";

/**
 * Effect that returns whether `address` has deployed bytecode on `chainId`.
 * Used as a gate at Token-row creation sites to filter EOAs / non-contract
 * addresses (e.g. Lisk 0x1847…34CA) that would otherwise persist Token rows
 * with empty `symbol`/`name` from the static fallback in {@link getTokenDetails}.
 *
 * Caches positive results (bytecode existence is effectively permanent for
 * deployed contracts); skips caching `false` so transient RPC failures retry.
 *
 * @param input.address - Address to query.
 * @param input.chainId - Chain ID for RPC client.
 * @returns Promise resolving to `{ hasCode: boolean }`.
 */
export const hasContractBytecode = createEffect(
  {
    name: EffectType.HAS_CONTRACT_BYTECODE,
    input: {
      address: S.string,
      chainId: S.number,
    },
    output: {
      hasCode: S.boolean,
    },
    rateLimit: false,
    cache: true,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.HAS_CONTRACT_BYTECODE,
      address: input.address,
      chainId: input.chainId,
    });

    if (!result.hasCode) {
      context.cache = false;
    }

    return { hasCode: result.hasCode };
  },
);
