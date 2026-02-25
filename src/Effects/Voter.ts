import { S, createEffect } from "envio";
import { EffectType, callRpcGateway } from "./RpcGateway";

export { fetchTokensDeposited } from "./fetchers/Voter";

/**
 * Effect to get the balance of reward tokens deposited in a gauge.
 * Delegates to {@link rpcGateway} with type "getTokensDeposited"; errors are logged and return undefined.
 *
 * @param input.rewardTokenAddress - ERC20 reward token address.
 * @param input.gaugeAddress - Gauge contract address.
 * @param input.blockNumber - Block at which to read.
 * @param input.eventChainId - Chain ID for the RPC client (e.g. event chain).
 * @returns Promise resolving to the deposited balance (bigint) or undefined on error.
 */
export const getTokensDeposited = createEffect(
  {
    name: EffectType.GET_TOKENS_DEPOSITED,
    input: {
      rewardTokenAddress: S.string,
      gaugeAddress: S.string,
      blockNumber: S.number,
      eventChainId: S.number,
    },
    output: S.nullable(S.bigint),
    rateLimit: false,
    cache: true,
  },
  async ({ input, context }) => {
    const result = await callRpcGateway(context, {
      type: EffectType.GET_TOKENS_DEPOSITED,
      rewardTokenAddress: input.rewardTokenAddress,
      gaugeAddress: input.gaugeAddress,
      blockNumber: input.blockNumber,
      chainId: input.eventChainId,
    });
    return result.value;
  },
);
