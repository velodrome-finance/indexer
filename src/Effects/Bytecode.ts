import { S, createEffect } from "envio";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchHasContractBytecode } from "./fetchers/Bytecode";

/**
 * Effect that returns whether `address` has deployed bytecode on `chainId`.
 * Used as a gate at Token-row creation sites to filter EOAs / non-contract
 * addresses (e.g. Lisk 0x1847…34CA) that would otherwise persist Token rows
 * with empty `symbol`/`name` from the static fallback in {@link getTokenDetails}.
 *
 * Caching is enabled so positive bytecode results amortise across runs (one
 * `eth_getCode` per address per cache lifetime). The fail-open path — where
 * {@link handleHasContractBytecode} returns `hasCode: true` after both primary
 * and fallback RPCs are exhausted — is detected via the gateway's `usedDefault`
 * flag (issue #691) and skips caching so a transient RPC failure can be retried
 * on the next run instead of being pinned to `true` until the cache evicts.
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

    if (result.usedDefault) {
      context.cache = false;
    }

    return { hasCode: result.hasCode };
  },
);
