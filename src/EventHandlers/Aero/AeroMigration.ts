import type { AeroMigrationTotals } from "envio";
import { indexer } from "envio";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import {
  AERO_MIGRATION_EVENT_KIND,
  AERO_MIGRATION_LEGACY_TOKEN,
  AERO_ROOT_CHAIN_ID,
  AeroContractStateId,
  AeroEventId,
} from "./AeroConstants";

/**
 * Legacy-to-Aero migration (ADR 0006): AerodromeMigration on Base (veAERO
 * locks and liquid AERO v1, 1:1), VelodromeMigration on Optimism (veVELO locks
 * and liquid VELO at the fixed VELO → AERO ratio, settled on Base by Hyperlane)
 * and its Base settlement VelodromeMigrationEntrypoint. One AeroMigrationEvent
 * row per migration, and per-contract totals. Each chain records only its own
 * contract; an Optimism migration and its Base settlement are joined by
 * recipient and amount in queries (the Optimism event carries no nonce).
 */

/**
 * The legacy token a migration contract converts.
 *
 * @param chainId - Chain of the migration contract
 * @returns AERO_V1 on Base, VELO on Optimism
 */
function legacyTokenOf(chainId: number): string {
  return chainId === AERO_ROOT_CHAIN_ID
    ? AERO_MIGRATION_LEGACY_TOKEN.AERO_V1
    : AERO_MIGRATION_LEGACY_TOKEN.VELO;
}

/**
 * Applies a change to a migration contract's totals.
 *
 * @param chainId - Chain of the contract
 * @param contract - Migration contract
 * @param legacyToken - Legacy token it converts
 * @param blockTimestamp - Block time (seconds)
 * @param patch - Builds the change from the current totals
 * @param context - Handler context
 * @returns Promise that resolves once the totals are staged
 */
async function updateMigrationTotals(
  chainId: number,
  contract: string,
  legacyToken: string,
  blockTimestamp: number,
  patch: (current: AeroMigrationTotals) => Partial<AeroMigrationTotals>,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(blockTimestamp * 1000);
  const id = AeroContractStateId(chainId, contract);
  const current = (await getRehydrated(
    context.AeroMigrationTotals,
    "AeroMigrationTotals",
    id,
  )) ?? {
    id,
    chainId,
    migrationContract: contract,
    legacyToken,
    numberOfVeNFTs: 0n,
    veNFTAmountIn: 0n,
    veNFTAmountOut: 0n,
    numberOfLiquid: 0n,
    liquidAmountIn: 0n,
    liquidAmountOut: 0n,
    numberOfSettlements: 0n,
    settledAmount: 0n,
    lastUpdatedTimestamp: timestamp,
  };
  context.AeroMigrationTotals.set({
    ...current,
    ...patch(current),
    lastUpdatedTimestamp: timestamp,
  });
}

indexer.onEvent(
  { contract: "AeroMigration", event: "VeNFTMigrated" },
  async ({ event, context }) => {
    const legacyToken = legacyTokenOf(event.chainId);
    const p = event.params;
    context.AeroMigrationEvent.set({
      id: AeroEventId(event.chainId, event.transaction.hash, event.logIndex),
      migrationContract: event.srcAddress,
      kind: AERO_MIGRATION_EVENT_KIND.VENFT,
      legacyToken,
      depositor: p.depositor,
      recipient: p.recipient,
      legacyTokenId: p.v2TokenId,
      amountIn: p.amount,
      amountOut: p.out,
      isPermanent: p.permanent,
      isLiquid: p.liquid,
      nonce: undefined,
      blockNumber: BigInt(event.block.number),
      timestamp: new Date(event.block.timestamp * 1000),
      transactionHash: event.transaction.hash,
    });
    await updateMigrationTotals(
      event.chainId,
      event.srcAddress,
      legacyToken,
      event.block.timestamp,
      (c) => ({
        numberOfVeNFTs: c.numberOfVeNFTs + 1n,
        veNFTAmountIn: c.veNFTAmountIn + p.amount,
        veNFTAmountOut: c.veNFTAmountOut + p.out,
      }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMigration", event: "LiquidMigrated" },
  async ({ event, context }) => {
    const legacyToken = legacyTokenOf(event.chainId);
    const p = event.params;
    context.AeroMigrationEvent.set({
      id: AeroEventId(event.chainId, event.transaction.hash, event.logIndex),
      migrationContract: event.srcAddress,
      kind: AERO_MIGRATION_EVENT_KIND.LIQUID,
      legacyToken,
      depositor: p.depositor,
      recipient: p.recipient,
      legacyTokenId: undefined,
      amountIn: p.amountIn,
      amountOut: p.out,
      isPermanent: undefined,
      isLiquid: true,
      nonce: undefined,
      blockNumber: BigInt(event.block.number),
      timestamp: new Date(event.block.timestamp * 1000),
      transactionHash: event.transaction.hash,
    });
    await updateMigrationTotals(
      event.chainId,
      event.srcAddress,
      legacyToken,
      event.block.timestamp,
      (c) => ({
        numberOfLiquid: c.numberOfLiquid + 1n,
        liquidAmountIn: c.liquidAmountIn + p.amountIn,
        liquidAmountOut: c.liquidAmountOut + p.out,
      }),
      context,
    );
  },
);

indexer.onEvent(
  { contract: "AeroMigrationEntrypoint", event: "Migrated" },
  async ({ event, context }) => {
    const p = event.params;
    context.AeroMigrationEvent.set({
      id: AeroEventId(event.chainId, event.transaction.hash, event.logIndex),
      migrationContract: event.srcAddress,
      kind: AERO_MIGRATION_EVENT_KIND.SETTLED,
      legacyToken: AERO_MIGRATION_LEGACY_TOKEN.VELO,
      depositor: undefined,
      recipient: p.recipient,
      legacyTokenId: undefined,
      amountIn: undefined,
      amountOut: p.tokenAmount,
      isPermanent: undefined,
      isLiquid: p.isLiquid,
      nonce: p.nonce,
      blockNumber: BigInt(event.block.number),
      timestamp: new Date(event.block.timestamp * 1000),
      transactionHash: event.transaction.hash,
    });
    await updateMigrationTotals(
      event.chainId,
      event.srcAddress,
      AERO_MIGRATION_LEGACY_TOKEN.VELO,
      event.block.timestamp,
      (c) => ({
        numberOfSettlements: c.numberOfSettlements + 1n,
        settledAmount: c.settledAmount + p.tokenAmount,
      }),
      context,
    );
  },
);
