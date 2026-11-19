import { S } from "envio";
import { createRpcEffect } from "./RpcEffect";
import { executeRpc } from "./RpcGateway";
import { fetchSwapFee } from "./fetchers/SwapFee";

export { fetchSwapFee } from "./fetchers/SwapFee";

/**
 * Effect to get the swap fee of a CL pool from the factory that created it,
 * at a historical block (`CLFactory.getSwapFee(pool)`).
 *
 * No handler calls this: CL swap fees are derived from each swap's own price
 * move (src/Aggregators/CLSwapFee.ts, ADR 0001 amendment). Kept for
 * `scripts/smoke-effects.ts`.
 *
 * Returns `undefined` when no endpoint answered or the call reverted; the
 * caller then keeps the pool's previous fee. An `undefined` caused by an RPC
 * failure is not cached (see {@link createRpcEffect}), so a later run retries.
 *
 * @param input.poolAddress - Pool contract address.
 * @param input.factoryAddress - CL factory that created the pool.
 * @param input.chainId - Chain ID for RPC.
 * @param input.blockNumber - Block at which to read the fee.
 * @returns Promise resolving to the swap fee, or undefined.
 */
export const getSwapFee = createRpcEffect(
  {
    name: "getSwapFee",
    input: S.schema({
      poolAddress: S.string,
      factoryAddress: S.string,
      chainId: S.number,
      blockNumber: S.number,
    }),
    output: S.optional(S.bigint),
    cache: true,
  },
  ({ input, context }) =>
    executeRpc<bigint | undefined>(
      context,
      {
        name: "getSwapFee",
        chainId: input.chainId,
        details: {
          pool: input.poolAddress,
          factory: input.factoryAddress,
          block: input.blockNumber,
        },
      },
      undefined,
      (client) =>
        fetchSwapFee(
          input.poolAddress,
          input.factoryAddress,
          input.blockNumber,
          client,
        ),
    ),
);
