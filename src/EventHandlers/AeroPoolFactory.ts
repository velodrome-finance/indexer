import { indexer } from "envio";
import { POOL_DEPLOYMENT } from "../Constants";
import { createV2PoolFromFactory } from "./PoolFactory/PoolFactoryPoolCreatedLogic";

// Aero (MetaDEX) V2 pools come from two factories, one per pool type, whose
// PoolCreated carries no `stable` flag: stability is the emitting factory.
// The pools emit the same Swap / Sync / Fees / Burn as legacy V2 pools, the
// 4-argument Mint (MintWithRecipient) and the account-carrying Claim
// (ClaimWithAccount), all handled by the shared Pool contract.
//
// Unlike the legacy PoolFactory on a leaf chain, there is no root pool to look
// up: Aero has no Optimism root pools (ADR 0005).

indexer.contractRegister(
  { contract: "AeroStablePoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Pool.add(event.params.pool);
  },
);

indexer.contractRegister(
  { contract: "AeroVolatilePoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    context.chain.Pool.add(event.params.pool);
  },
);

indexer.onEvent(
  { contract: "AeroStablePoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    await createV2PoolFromFactory(
      {
        chainId: event.chainId,
        factoryAddress: event.srcAddress,
        pool: event.params.pool,
        token0: event.params.token0,
        token1: event.params.token1,
        isStable: true,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
        deployment: POOL_DEPLOYMENT.AERO,
      },
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroVolatilePoolFactory", event: "PoolCreated" },
  async ({ event, context }) => {
    await createV2PoolFromFactory(
      {
        chainId: event.chainId,
        factoryAddress: event.srcAddress,
        pool: event.params.pool,
        token0: event.params.token0,
        token1: event.params.token1,
        isStable: false,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
        deployment: POOL_DEPLOYMENT.AERO,
      },
      context,
    );
  },
);
