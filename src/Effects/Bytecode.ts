import { S, createEffect } from "envio";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchHasContractBytecode } from "./fetchers/Bytecode";

/**
 * Effect that returns whether `address` has deployed bytecode on `chainId`.
 * Used as a gate at Token-row creation sites to filter EOAs / non-contract
 * addresses (e.g. Lisk 0x1847…34CA) that would otherwise persist Token rows
 * with empty `symbol`/`name` from the static fallback in {@link getTokenDetails}.
 *
 * Caching is disabled because {@link handleHasContractBytecode} fails open
 * (returns `hasCode: true` on transient RPC failure), and a cached `true` would
 * defeat the gate for that address permanently. The Token row itself acts as
 * the natural cache: callers `context.Token.get` first and only invoke this
 * effect for addresses not yet persisted, so at most one `eth_getCode` per
 * new token address per indexer run.
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
    cache: false,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.HAS_CONTRACT_BYTECODE,
      address: input.address,
      chainId: input.chainId,
    });

    return { hasCode: result.hasCode };
  },
);
