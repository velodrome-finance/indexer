import { indexer } from "envio";
import {
  createRootPool,
  deriveV2RootPoolLeafChain,
} from "./Voter/RootPoolLogic";

// Superchain V2 RootPoolFactory (Optimism): a V2 root pool. The event does not
// carry the leaf chain; it is recovered from the pool's CREATE2 address
// (deriveV2RootPoolLeafChain), so no other chain's rows and no RPC are needed.
indexer.onEvent(
  { contract: "RootPoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    const { token0, token1, stable, pool } = event.params;
    const leafChainId = deriveV2RootPoolLeafChain(
      event.srcAddress,
      pool,
      token0,
      token1,
      stable,
    );
    if (leafChainId === undefined) {
      context.log.warn(
        `[RootPoolFactory.PoolCreated] leaf chain of V2 root pool ${pool} not derivable from its address (no known leaf chain matches)`,
      );
    }
    await createRootPool(
      {
        chainId: event.chainId,
        rootPoolAddress: pool,
        leafChainId,
        isCL: false,
        token0,
        token1,
        isStable: stable,
        rootFactoryAddress: event.srcAddress,
        blockNumber: event.block.number,
        timestamp: new Date(event.block.timestamp * 1000),
      },
      context,
    );
  },
);
