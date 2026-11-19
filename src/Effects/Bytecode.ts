import { S } from "envio";
import { isAddress } from "viem";
import { toChecksumAddress } from "../Constants";
import { createRpcEffect } from "./RpcEffect";
import { executeRpc } from "./RpcGateway";
import { getTokenMetadata, metadataProvesContract } from "./TokenMetadata";
import { fetchHasContractBytecode } from "./fetchers/Bytecode";

export { fetchHasContractBytecode } from "./fetchers/Bytecode";

/**
 * Effect that returns whether `address` is an ERC20-shaped contract on
 * `chainId`. Gate at Token-row creation sites against EOAs (#677) and
 * non-ERC20 contracts (#736).
 *
 * Fast path: if {@link getTokenMetadata} (cached, and seeded from the
 * Uniswap v4 cache) already read a real name or symbol, the address is a
 * contract answering ERC20 calls and no extra RPC is made. Only when metadata
 * is all placeholders does it probe `eth_getCode` + `decimals()`.
 *
 * Fail-open: when no endpoint answers the probe it returns `hasCode: true`
 * (keeps the token) and does not cache that answer.
 *
 * `crossChain: false` because it calls the chain-scoped getTokenMetadata
 * (Envio forbids a cross-chain effect calling a chain-scoped one).
 *
 * @param input.address - Address to query.
 * @param input.chainId - Chain ID for RPC client.
 * @returns Promise resolving to `{ hasCode: boolean }`.
 */
export const hasContractBytecode = createRpcEffect(
  {
    name: "hasContractBytecode",
    input: S.schema({ address: S.string, chainId: S.number }),
    output: S.schema({ hasCode: S.boolean }),
    cache: true,
    crossChain: false,
  },
  async ({ input, context }) => {
    if (!isAddress(input.address, { strict: false })) {
      return {
        value: { hasCode: false },
        usedDefault: false,
        errorClass: undefined,
      };
    }
    const meta = await context.effect(getTokenMetadata, {
      address: toChecksumAddress(input.address),
      chainId: input.chainId,
    });
    if (metadataProvesContract(meta)) {
      return {
        value: { hasCode: true },
        usedDefault: false,
        errorClass: undefined,
      };
    }
    return executeRpc(
      context,
      {
        name: "hasContractBytecode",
        chainId: input.chainId,
        details: { address: input.address },
      },
      { hasCode: true },
      async (client) => ({
        hasCode: await fetchHasContractBytecode(input.address, client),
      }),
    );
  },
);
