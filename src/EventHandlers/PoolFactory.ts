import { indexer } from "envio";
import { updatePool } from "../Aggregators/Pool";
import {
  PoolId,
  ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
  RootPoolLeafPoolId,
  legacyPoolDeployment,
} from "../Constants";
import { getRehydrated } from "../EntityTimestamps";
import type { Pool } from "../EntityTypes";
import { createV2PoolFromFactory } from "./PoolFactory/PoolFactoryPoolCreatedLogic";
import {
  recordV2DefaultFee,
  resolveCustomSwapFee,
} from "./SwapFeeModule/CustomSwapFeeSharedLogic";
import {
  SUPERCHAIN_LEAF_CHAIN_IDS,
  SUPERCHAIN_ROOT_CHAIN_ID,
  predictV2RootPoolAddress,
} from "./Voter/RootPoolLogic";

indexer.contractRegister(
  { contract: "PoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Pool.add(event.params.pool);
  },
);

indexer.onEvent(
  { contract: "PoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    // Pool + pricing registration, shared with the Aero factories.
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

    // A superchain leaf V2 pool records its root pool on its own chain
    // (ADR 0009, flow D). The root pool's address is the V2 RootPoolFactory's
    // CREATE2 address for (this chain, token0, token1, stable), the value the
    // leaf LpHelper returns (equal on all 480 cached LpHelper answers of the ten
    // leaf chains), so no RPC and no other chain's rows are needed.
    const chainId = event.chainId;
    if (SUPERCHAIN_LEAF_CHAIN_IDS.includes(chainId)) {
      const rootPoolAddress = predictV2RootPoolAddress(
        ROOT_POOL_FACTORY_ADDRESS_OPTIMISM,
        chainId,
        event.params.token0,
        event.params.token1,
        event.params.stable,
      );
      context.RootPool_LeafPool.set({
        id: RootPoolLeafPoolId(
          SUPERCHAIN_ROOT_CHAIN_ID,
          chainId,
          rootPoolAddress,
          event.params.pool,
        ),
        rootChainId: SUPERCHAIN_ROOT_CHAIN_ID,
        rootPoolAddress,
        leafChainId: chainId,
        leafPoolAddress: event.params.pool,
      });
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
      event.chainId,
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
