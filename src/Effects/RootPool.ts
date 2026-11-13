import { S } from "envio";
import { CHAIN_CONSTANTS } from "../Constants";
import { RpcConfigError } from "./RpcConfig";
import { createRpcEffect } from "./RpcEffect";
import { executeRpc } from "./RpcGateway";
import { fetchRootPoolAddress } from "./fetchers/RootPool";

export { fetchRootPoolAddress } from "./fetchers/RootPool";

/**
 * Effect to get the root pool address for a leaf pool from the LpHelper contract.
 *
 * Returns "" when the helper has no root pool (a real, cacheable answer) or
 * when no endpoint answered. The latter is NOT cached, so the mapping is not
 * lost forever in the effect cache; the caller (PoolFactory) still skips the
 * RootPool_LeafPool write for this event, see the RPC report for the
 * remaining handler-side gap.
 *
 * @param input.chainId - Chain ID for RPC.
 * @param input.factory - Factory contract address.
 * @param input.token0 - First token of the pair.
 * @param input.token1 - Second token of the pair.
 * @param input.type - Pool type identifier (-1 vAMM, 0 sAMM, tick spacing for CL).
 * @returns Promise resolving to the checksummed root pool address or "".
 */
export const getRootPoolAddress = createRpcEffect(
  {
    name: "getRootPoolAddress",
    input: S.schema({
      chainId: S.number,
      factory: S.string,
      token0: S.string,
      token1: S.string,
      type: S.number,
    }),
    output: S.string,
    cache: true,
  },
  ({ input, context }) => {
    const chain = CHAIN_CONSTANTS[input.chainId];
    if (!chain) {
      throw new RpcConfigError(`Unsupported chainId: ${input.chainId}`);
    }
    return executeRpc(
      context,
      {
        name: "getRootPoolAddress",
        chainId: input.chainId,
        details: {
          factory: input.factory,
          token0: input.token0,
          token1: input.token1,
          type: input.type,
        },
      },
      "",
      (client) =>
        fetchRootPoolAddress(
          client,
          chain.lpHelperAddress,
          input.factory,
          input.token0,
          input.token1,
          input.type,
        ),
    );
  },
);
