import { S, createEffect } from "envio";
import { ErrorType } from "./Helpers";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchHasContractBytecode } from "./fetchers/Bytecode";

/**
 * Effect that returns whether `address` is an ERC20-compliant contract on
 * `chainId`. Used as a gate at Token-row creation sites to filter EOAs /
 * non-contract addresses (e.g. Lisk 0x1847…34CA — issue #677) and contracts
 * that have bytecode but don't implement ERC20 (e.g. Base 0xBd0bD2F62…5528:
 * 44,286 bytes of bytecode but `decimals()` reverts — issue #736). Without
 * the gate, both cases persist Token rows with empty `symbol`/`name` and the
 * default `decimals = 18` from the static fallback in {@link getTokenDetails}.
 *
 * The underlying fetcher does two probes: `eth_getCode` for bytecode and a
 * `decimals()` read to check ERC20-shape compliance. See
 * {@link fetchHasContractBytecode} for the reject conditions.
 *
 * Caching is enabled so positive results amortise across runs (one pair of
 * RPC calls per address per cache lifetime). The fail-open path — where
 * {@link handleHasContractBytecode} returns `hasCode: true` after both primary
 * and fallback RPCs are exhausted — is detected via the gateway's `usedDefault`
 * flag (issue #691). Caching is only skipped when the failure was transient
 * (network/rate-limit, issue #692); a deterministic `CONTRACT_REVERT` fallback
 * stays cached because re-fetching at the same block produces the same revert.
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

    if (result.usedDefault && result.errorClass !== ErrorType.CONTRACT_REVERT) {
      context.cache = false;
    }

    return { hasCode: result.hasCode };
  },
);
