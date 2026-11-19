import { indexer } from "envio";
import { createRootPool } from "./Voter/RootPoolLogic";

// Superchain RootCLPoolFactory (Optimism): a CL root pool. Written from this
// event alone (ADR 0009, flow C): the RootPool carries the leaf chain, the pair,
// the tick spacing, the root factory and the leaf Pool's rootPoolMatchingHash.
// The analytics layer joins it to the leaf Pool (root_leaf_pools: matching hash
// and the leaf pool's factoryAddress equal to the root factory's address, the
// leaf CLFactory being deployed at the same address).
indexer.onEvent(
  { contract: "RootCLPoolFactory", event: "RootPoolCreated" },
  async ({ event, context }) => {
    await createRootPool(
      {
        chainId: event.chainId,
        rootPoolAddress: event.params.pool,
        leafChainId: Number(event.params.chainid),
        isCL: true,
        token0: event.params.token0,
        token1: event.params.token1,
        tickSpacing: BigInt(event.params.tickSpacing),
        rootFactoryAddress: event.srcAddress,
        blockNumber: event.block.number,
        timestamp: new Date(event.block.timestamp * 1000),
      },
      context,
    );
  },
);
