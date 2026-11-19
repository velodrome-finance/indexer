import type { EvmEvent } from "envio";
import { loadPoolData } from "../../Aggregators/Pool";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import { NFPMCollectFeesInTxId, NonFungiblePositionId } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";

/**
 * NFPM fee collection (legacy NFPMs and the Aero NFPM).
 *
 * For a position held through an NFPM, CLPool.Collect's `owner` is the
 * NFPM contract and the event has no tokenId, so it cannot name the position's
 * owner. NFPM.collect calls pool.collect and then emits its own
 * Collect(tokenId, recipient, amount0, amount1) in the same tx, a few logs
 * later. So CLPool.Collect isolates the fees exactly as before (principal
 * tracked per (owner, range) by CLPool.Burn) and stages them here, and the
 * NFPM.Collect credits them to the owner of the position it names, found by
 * primary key. The user-level credit is therefore the pool-level amount, so
 * Σ users of totalUnstakedFeesCollected* still equals the Pool's.
 *
 * The NFPM's own Collect amounts are never used: the NFPM emits the amounts it
 * asked the pool for (its per-position tokensOwed), which can exceed what the
 * pool paid by a few wei (Arc tx 0x2e1346d0…: pool paid 83, NFPM says 84).
 *
 * Cost: principal is pooled per (NFPM, range), so when two positions share a
 * range, one position's pending principal can absorb another's fee-only
 * collect until the first collects; the fees then reach the first owner. Per
 * owner this can shift fees between positions of one range; totals are exact.
 */

/**
 * Stage the fees a CLPool.Collect isolated for an NFPM position, for the
 * NFPM.Collect that follows in the same tx. Adds to an unconsumed row (never
 * expected: every NFPM pool.collect is followed by its NFPM.Collect).
 *
 * @param chainId - Chain of the Collect
 * @param txHash - Transaction hash
 * @param nfpmAddress - CLPool.Collect's `owner`, the pool's NFPM
 * @param poolAddress - The CL pool (`event.srcAddress`)
 * @param fees0 - Raw token0 fees isolated by CLPool.Collect
 * @param fees1 - Raw token1 fees isolated by CLPool.Collect
 * @param feesUSD - USD value of those fees (1e18)
 * @param context - Handler context
 * @returns Promise that resolves once the hand-over row is staged
 */
export async function stageNFPMCollectFees(
  chainId: number,
  txHash: string,
  nfpmAddress: string,
  poolAddress: string,
  fees0: bigint,
  fees1: bigint,
  feesUSD: bigint,
  context: handlerContext,
): Promise<void> {
  if (fees0 === 0n && fees1 === 0n) return;
  const id = NFPMCollectFeesInTxId(chainId, txHash, nfpmAddress);
  const pending = await context.NFPMCollectFeesInTx.get(id);
  if (pending && pending.pool !== poolAddress) {
    context.log.warn(
      `[NFPMCollect] unconsumed fees of pool ${pending.pool} replaced by pool ${poolAddress} in tx ${txHash} on chain ${chainId}`,
    );
  }
  const same = pending?.pool === poolAddress;
  context.NFPMCollectFeesInTx.set({
    id,
    pool: poolAddress,
    fees0: (same ? pending.fees0 : 0n) + fees0,
    fees1: (same ? pending.fees1 : 0n) + fees1,
    feesUSD: (same ? pending.feesUSD : 0n) + feesUSD,
  });
}

/**
 * NFPM Collect (legacy or Aero): credits the fees staged by the preceding
 * CLPool.Collect to the owner of the collected position (its
 * `totalUnstakedFeesCollected*`) and deletes the hand-over. Falls back to the
 * NFPM contract when the position is unknown, so the fees are never lost from
 * the user sums.
 *
 * @param event - NFPM.Collect or AeroNFPM.Collect
 * @param context - Handler context
 * @returns Promise that resolves once the owner's fee counters are staged
 */
export async function processNFPMCollect(
  event: EvmEvent<"NFPM", "Collect"> | EvmEvent<"AeroNFPM", "Collect">,
  context: handlerContext,
): Promise<void> {
  const id = NFPMCollectFeesInTxId(
    event.chainId,
    event.transaction.hash,
    event.srcAddress,
  );
  const [pending, position] = await Promise.all([
    context.NFPMCollectFeesInTx.get(id),
    getRehydrated(
      context.NonFungiblePosition,
      "NonFungiblePosition",
      NonFungiblePositionId(
        event.chainId,
        event.srcAddress,
        event.params.tokenId,
      ),
    ),
  ]);
  if (!pending) return;
  context.NFPMCollectFeesInTx.deleteUnsafe(id);

  let owner = position?.owner;
  if (!owner || position?.pool !== pending.pool) {
    context.log.warn(
      `[NFPMCollect] position ${event.params.tokenId} of NFPM ${event.srcAddress} not found in pool ${pending.pool} (tx ${event.transaction.hash}); crediting the NFPM`,
    );
    owner = event.srcAddress;
  }

  const timestamp = new Date(event.block.timestamp * 1000);
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      pending.pool,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      owner,
      pending.pool,
      event.chainId,
      context,
      timestamp,
    ),
  ]);
  await updateUserStatsPerPool(
    {
      incrementalTotalUnstakedFeesCollected0: pending.fees0,
      incrementalTotalUnstakedFeesCollected1: pending.fees1,
      incrementalTotalUnstakedFeesCollectedUSD: pending.feesUSD,
      lastActivityTimestamp: timestamp,
    },
    userData,
    context,
    timestamp,
    event.chainId,
    poolData ?? undefined,
  );
}
