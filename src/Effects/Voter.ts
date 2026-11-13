import { S } from "envio";
import { createRpcEffect } from "./RpcEffect";
import { executeRpc } from "./RpcGateway";
import { fetchTokensDeposited } from "./fetchers/Voter";

export { fetchTokensDeposited } from "./fetchers/Voter";

/**
 * Effect to get the balance of reward tokens held by a gauge at a block
 * (`ERC20.balanceOf(gauge)`).
 *
 * Returns `undefined` when no endpoint answered or the call reverted; an
 * RPC-failure `undefined` is not cached (see {@link createRpcEffect}).
 *
 * @param input.rewardTokenAddress - ERC20 reward token address.
 * @param input.gaugeAddress - Gauge contract address.
 * @param input.blockNumber - Block at which to read.
 * @param input.eventChainId - Chain ID for the RPC client.
 * @returns Promise resolving to the deposited balance, or undefined.
 */
export const getTokensDeposited = createRpcEffect(
  {
    name: "getTokensDeposited",
    input: S.schema({
      rewardTokenAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      eventChainId: S.number,
    }),
    output: S.optional(S.bigint),
    cache: true,
  },
  ({ input, context }) =>
    executeRpc<bigint | undefined>(
      context,
      {
        name: "getTokensDeposited",
        chainId: input.eventChainId,
        details: {
          gauge: input.gaugeAddress,
          token: input.rewardTokenAddress,
          block: input.blockNumber,
        },
      },
      undefined,
      (client) =>
        fetchTokensDeposited(
          input.rewardTokenAddress,
          input.gaugeAddress,
          input.blockNumber,
          client,
        ),
    ),
);
