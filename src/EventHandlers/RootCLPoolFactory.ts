import { indexer } from "envio";
import type { RootPool_LeafPool } from "envio";
import { getWhereRehydrated } from "../EntityTimestamps";

import {
  PendingRootPoolMappingId,
  RootPoolLeafPoolId,
  rootPoolMatchingHash,
} from "../Constants";
import { logPerChainStubOnce } from "../PerChainStubs";
import { isLeafPoolOfRootFactory } from "./CLFactory/CLFactoryPoolCreatedLogic";
import { flushPendingVotesAndDistributionsForRootPool } from "./Voter/CrossChainPendingResolution";

indexer.onEvent(
  { contract: "RootCLPoolFactory", event: "RootPoolCreated" },
  async ({ event, context }) => {
    const rootChainId = event.chainId;
    const leafChainId = Number(event.params.chainid);
    const rootPoolAddress = event.params.pool;
    const rootFactoryAddress = event.srcAddress;
    const token0 = event.params.token0;
    const token1 = event.params.token1;
    const tickSpacing = BigInt(event.params.tickSpacing);

    const hash = rootPoolMatchingHash(leafChainId, token0, token1, tickSpacing);

    // A leaf chain can host several CL factories, each able to create a pool
    // for the same (token0, token1, tickSpacing) — Ink has two USD₮0/WETH
    // CL100 pools. The root pool's leaf pool is the one created by the leaf
    // CLFactory deployed at the root factory's own address
    // (scripts/verify-root-leaf-factory.ts), so only that pool may match.
    const pools = await getWhereRehydrated(context.Pool, "Pool", {
      rootPoolMatchingHash: { _eq: hash },
    });
    const leafPools = pools.filter((pool) =>
      isLeafPoolOfRootFactory(pool.factoryAddress, rootFactoryAddress),
    );

    if (leafPools.length === 0) {
      // TODO(ADR 0009, flow C): per-chain, the leaf chain's Pools are never
      // visible here, so every root pool is stored as a PendingRootPoolMapping
      // (a root-chain row keyed by the root pool, carrying the matching hash)
      // and joined to the leaf pool in ClickHouse.
      logPerChainStubOnce(
        context.log,
        "C",
        "RootPoolCreated: leaf pools are not visible; stored as PendingRootPoolMapping on the root chain.",
      );
      // Chains are not processed in time order during backfill, so the leaf
      // pool may simply not exist yet; CLFactory.PoolCreated on the leaf chain
      // resolves this entry (only from the matching factory).
      context.PendingRootPoolMapping.set({
        id: PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        rootChainId,
        rootPoolAddress,
        rootFactoryAddress,
        leafChainId,
        token0,
        token1,
        tickSpacing,
        rootPoolMatchingHash: hash,
      });
      context.log.warn(
        `RootPoolCreated: no Pool from factory ${rootFactoryAddress} found for hash ${hash}${pools.length > 0 ? ` (ignored ${pools.length} pool(s) from other factories: ${pools.map((p) => `${p.poolAddress}@${p.factoryAddress}`).join(", ")})` : ""}. PendingRootPoolMapping stored for later reconciliation.`,
      );
      return;
    }

    if (leafPools.length !== 1) {
      // One factory cannot create two pools with the same tokens and tick
      // spacing, so this indicates corrupt state.
      context.log.error(
        `Expected exactly one matching Pool from factory ${rootFactoryAddress} for RootPoolCreated: token0=${token0}, token1=${token1}, chainId=${leafChainId}, tickSpacing=${tickSpacing}; found ${leafPools.length}`,
      );
      return;
    }
    const matchingPool = leafPools[0];

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
    await flushPendingVotesAndDistributionsForRootPool(
      context,
      rootPoolAddress,
      "[RootPoolCreated]",
    );
  },
);
