import { S, experimental_createEffect } from "envio";
import {
  SuperchainPoolFactory,
  type SuperchainPoolFactory_RootPoolCreated,
} from "generated";
import SuperchainPoolABI from "../../abis/SuperchainPoolABI.json";
import { CHAIN_CONSTANTS } from "../Constants";

const getPoolChainId = experimental_createEffect(
  {
    name: "getPoolChainId",
    input: {
      poolAddress: S.string,
      eventChainId: S.number,
    },
    output: S.number,
  },
  async ({ input }) => {
    try {
      const ethClient = CHAIN_CONSTANTS[input.eventChainId].eth_client;
      const { result } = await ethClient.simulateContract({
        address: input.poolAddress as `0x${string}`,
        abi: SuperchainPoolABI,
        functionName: "chainid",
        args: [],
      });
      return Number(result);
    } catch (error) {
      throw new Error(
        `Error getting superchain pool chain id for pool ${input.poolAddress} on chain ${input.eventChainId}.`,
        {
          cause: error,
        },
      );
    }
  },
);

SuperchainPoolFactory.RootPoolCreated.handler(async ({ event, context }) => {
  const poolChainId = await context.effect(getPoolChainId, {
    poolAddress: event.params.pool,
    eventChainId: event.chainId,
  });

  // Early return during preload phase after loading data
  if (context.isPreload) {
    return;
  }

  const entity: SuperchainPoolFactory_RootPoolCreated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    token0: event.params.token0,
    token1: event.params.token1,
    pool: event.params.pool,
    poolFactory: event.srcAddress,
    timestamp: new Date(event.block.timestamp * 1000),
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    chainId: event.chainId,
    stable: event.params.stable,
    length: event.params.length,
    transactionHash: event.transaction.hash,
    poolChainId: poolChainId,
  };

  context.SuperchainPoolFactory_RootPoolCreated.set(entity);
});
