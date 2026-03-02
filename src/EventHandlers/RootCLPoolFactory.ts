import { RootCLPoolFactory } from "generated";
import type { RootPool_LeafPool } from "generated";

import {
  PendingRootPoolMappingId,
  RootPoolLeafPoolId,
  rootPoolMatchingHash,
} from "../Constants";
import { processAllPendingVotesForRootPool } from "./Voter/PendingVoteProcessing";

RootCLPoolFactory.RootPoolCreated.handler(async ({ event, context }) => {
  const rootChainId = event.chainId;
  const leafChainId = Number(event.params.chainid);
  const rootPoolAddress = event.params.pool;
  const token0 = event.params.token0;
  const token1 = event.params.token1;
  const tickSpacing = BigInt(event.params.tickSpacing);

  const hash = rootPoolMatchingHash(leafChainId, token0, token1, tickSpacing);

  const pools = await context.LiquidityPoolAggregator.getWhere({
    rootPoolMatchingHash: { _eq: hash },
  });

  if (pools.length === 0) {
    context.PendingRootPoolMapping.set({
      id: PendingRootPoolMappingId(rootChainId, rootPoolAddress),
      rootChainId,
      rootPoolAddress,
      leafChainId,
      token0,
      token1,
      tickSpacing,
      rootPoolMatchingHash: hash,
    });
    context.log.warn(
      `RootPoolCreated: no LiquidityPoolAggregator found for hash ${hash}. PendingRootPoolMapping stored for later reconciliation.`,
    );
    return;
  }

  if (pools.length !== 1) {
    context.log.error(
      `Expected exactly one matching LiquidityPoolAggregator for RootPoolCreated: token0=${token0}, token1=${token1}, chainId=${leafChainId}, tickSpacing=${tickSpacing}`,
    );
    return;
  }
  const matchingPool = pools[0];

  const leafPoolAddress = matchingPool.poolAddress;
  const rootPoolLeafPoolId = RootPoolLeafPoolId(
    rootChainId,
    leafChainId,
    rootPoolAddress,
    leafPoolAddress,
  );

  const rootPoolLeafPool: RootPool_LeafPool = {
    id: rootPoolLeafPoolId,
    rootChainId,
    rootPoolAddress,
    leafChainId,
    leafPoolAddress,
  };

  context.RootPool_LeafPool.set(rootPoolLeafPool);
  try {
    await processAllPendingVotesForRootPool(context, rootPoolAddress);
  } catch (error) {
    context.log.error(
      `[RootPoolCreated] processAllPendingVotesForRootPool failed for rootPoolAddress ${rootPoolAddress}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});
