import { indexer } from "envio";
import { updatePool } from "../Aggregators/Pool";
import {
  PoolId,
  ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
  RootPoolLeafPoolId,
  legacyPoolDeployment,
} from "../Constants";
import { getRootPoolAddress } from "../Effects/RootPool";
import { getRehydrated } from "../EntityTimestamps";
import type { Pool } from "../EntityTypes";
import { logPerChainStubOnce } from "../PerChainStubs";
import { createV2PoolFromFactory } from "./PoolFactory/PoolFactoryPoolCreatedLogic";
import {
  recordV2DefaultFee,
  resolveCustomSwapFee,
} from "./SwapFeeModule/CustomSwapFeeSharedLogic";

indexer.contractRegister(
  { contract: "PoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Pool.add(event.params.pool);
  },
);

indexer.onEvent(
  { contract: "PoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    // Pool + pricing registration, shared with the Aero factories. Done before
    // the leaf-chain root-pool lookup below, whose failure paths return early.
    await createV2PoolFromFactory(
      {
        chainId: event.chainId,
        factoryAddress: event.srcAddress,
        pool: event.params.pool,
        token0: event.params.token0,
        token1: event.params.token1,
        isStable: event.params.stable,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
        deployment: legacyPoolDeployment(event.chainId),
      },
      context,
    );

    // For non-Optimism and non-Base pools, set the RootPool_LeafPool entity
    // Mapping RootPool (on optimism) to Pool (on superchain)
    // This is only need for non-CL pools
    // The mapping between RootCLPool and CLPool is made in RootCLPoolFactory.ts without the need of a RPC call
    // RPC call is needed here because RootPoolCreated event for non-CL pools doesn't have leafChainId
    const chainId: number = event.chainId;
    if (chainId !== 10 && chainId !== 8453) {
      let rootPoolAddress: string | null = null;
      try {
        rootPoolAddress = await context.effect(getRootPoolAddress, {
          chainId: chainId,
          factory: ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
          token0: event.params.token0,
          token1: event.params.token1,
          type: event.params.stable ? 0 : -1, // -1 for vAMM pools, 0 for sAMM pools, or the tick spacing value for CL pools
        });
      } catch (error) {
        context.log.error(
          `Error fetching root pool address for pool ${event.params.pool} on chain ${chainId}: ${error}`,
        );
        // Continue execution - pool is already created, just skip RootPool_LeafPool creation
        return;
      }

      if (rootPoolAddress) {
        // Flow D (ADR 0009): the leaf learns its root pool through the RPC
        // effect (a call, not a cross-chain entity read) and writes the
        // mapping on its own chain; ClickHouse joins it to the root chain's
        // vote and emission rows.
        context.RootPool_LeafPool.set({
          id: RootPoolLeafPoolId(
            10,
            chainId,
            rootPoolAddress,
            event.params.pool,
          ),
          rootChainId: 10,
          rootPoolAddress: rootPoolAddress,
          leafChainId: chainId,
          leafPoolAddress: event.params.pool,
        });
        // TODO(ADR 0009, flow D): the flush read Optimism's PendingVote /
        // PendingDistribution rows, which a leaf handler can no longer see.
        logPerChainStubOnce(
          context,
          "D",
          "V2 leaf PoolCreated: RootPool_LeafPool written on the leaf chain; pending root votes / distributions are not flushed (they stay on the root chain).",
        );
      } else {
        context.log.error(
          `[PoolFactory.PoolCreated] Failed to get root pool address for pool ${event.params.pool} on chain ${chainId}`,
        );
        return;
      }
    }
  },
);

indexer.onEvent(
  { contract: "PoolFactory", event: "SetCustomFee" },
  async ({ event, context }) => {
    const poolId = PoolId(event.chainId, event.params.pool);
    const poolEntity = await getRehydrated(context.Pool, "Pool", poolId);

    if (!poolEntity) {
      context.log.warn(`Pool ${poolId} not found for SetCustomFee event`);
      return;
    }

    // V2 SetCustomFee carries the fee in basis points. Store what the factory
    // charges, in FEE_SCALE (1e6): 420 is the zero-fee indicator, 0 resets to
    // the stable/volatile default, anything else is lifted ×100 (issue #812).
    const chargedFee = await resolveCustomSwapFee(
      BigInt(event.params.fee),
      poolEntity,
      false,
      context,
    );
    if (chargedFee === undefined) {
      return;
    }
    const diff: Partial<Pool> = {
      baseFee: chargedFee,
      currentFee: chargedFee, // When custom fee is set, both baseFee and currentFee are updated
    };

    await updatePool(
      diff,
      poolEntity,
      new Date(event.block.timestamp * 1000),
      context,
      event.chainId,
      event.block.number,
    );
  },
);

// SetDefaultFee(bool indexed stable, uint256 fee): superchain leaf PoolFactory
// only; the Optimism / Base PoolFactory hard-codes its 5 / 30 bps defaults.
// Emitted at deployment on every leaf chain and never since (HyperSync scan,
// 2026-11-13). Pools created afterwards start at it (getV2DefaultFee); an
// existing pool on the default keeps its stored fee until its next swap
// re-derives it from the Fees event.
indexer.onEvent(
  { contract: "PoolFactory", event: "SetDefaultFee" },
  async ({ event, context }) => {
    recordV2DefaultFee(
      event.chainId,
      event.srcAddress,
      event.params.stable,
      event.params.fee,
      event.block.timestamp,
      context,
    );
  },
);
