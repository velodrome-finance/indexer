import type { EvmEvent, NonFungiblePosition } from "envio";
import { updateNonFungiblePosition } from "../../Aggregators/NonFungiblePosition";
import { loadPoolData } from "../../Aggregators/Pool";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import {
  AeroNFPMMintPoolId,
  NonFungiblePositionId,
  ZERO_ADDRESS,
} from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { calculateTotalUSD } from "../../Helpers";
import { isolateFees } from "../CLPool/CLPoolCollectLogic";
import {
  LiquidityChangeType,
  attributeLiquidityChangeToUserStatsPerPool,
  updateStakedPositionLiquidity,
} from "./NFPMCommonLogic";
import { processNFPMDecreaseLiquidity } from "./NFPMDecreaseLiquidityLogic";
import { handleRegularTransfer } from "./NFPMTransferLogic";

/**
 * Aero NonfungiblePositionManager positions (ADR 0005).
 *
 * The Aero NFPM's IncreaseLiquidity carries the position's tick range, so a
 * position is created from its own events instead of the legacy
 * "closest preceding CLPool.Mint" match at Transfer time. The pool is still
 * not in any NFPM event, so it comes from the CLPool.Mint the NFPM caused,
 * found by primary key on every value the two events share (AeroNFPMMintPool).
 *
 * Mint transaction, in log order:
 *   CLPool.Mint(owner = NFPM, range, L, a0, a1) -> AeroNFPMMintPool row
 *   NFPM.Transfer(0 -> recipient, tokenId)      -> AeroNFPMPendingMint row
 *   NFPM.IncreaseLiquidity(tokenId, L, a0, a1, range) -> NonFungiblePosition
 * An increase of an existing position is CLPool.Mint + IncreaseLiquidity; the
 * IncreaseLiquidity consumes (deletes) the AeroNFPMMintPool row either way.
 *
 * Fee collection: the NFPM's Collect pays principal (from DecreaseLiquidity)
 * plus fees; the principal is tracked per position (NFPMPositionPendingPrincipal)
 * so the fees are credited to the position's owner, not to the NFPM contract
 * (which is what CLPool.Collect's `owner` is for NFPM positions).
 *
 * Gauge staking (phase 2): a transfer to or from `Pool.gaugeAddress` is a
 * stake / unstake (owner kept, isStakedInGauge flipped). Aero pools have no
 * gaugeAddress until Aero gauges are indexed, so until then a staked position
 * is owned by its gauge.
 */

/** Records the pool of an Aero NFPM-routed CLPool.Mint (step 1 above).
 *
 * @param chainId - Chain of the Mint
 * @param txHash - Transaction hash
 * @param poolAddress - The CL pool (`event.srcAddress`)
 * @param nfpmAddress - The Mint's `owner` (the pool's Aero NFPM)
 * @param params - The Mint's range, liquidity and amounts
 * @param logIndex - The Mint's log index
 * @param context - Handler context
 * @returns Promise that resolves once the row is staged
 */
export async function recordAeroNFPMMint(
  chainId: number,
  txHash: string,
  poolAddress: string,
  nfpmAddress: string,
  params: {
    tickLower: bigint;
    tickUpper: bigint;
    amount: bigint;
    amount0: bigint;
    amount1: bigint;
  },
  logIndex: number,
  context: handlerContext,
): Promise<void> {
  const id = AeroNFPMMintPoolId(
    chainId,
    txHash,
    nfpmAddress,
    params.tickLower,
    params.tickUpper,
    params.amount,
    params.amount0,
    params.amount1,
  );
  const existing = await context.AeroNFPMMintPool.get(id);
  context.AeroNFPMMintPool.set({
    id,
    pools: [...(existing?.pools ?? []), poolAddress],
    mintLogIndexes: [...(existing?.mintLogIndexes ?? []), logIndex],
  });
}

/**
 * Aero NFPM Transfer: a mint parks the recipient until IncreaseLiquidity
 * creates the position; a burn deletes the position (DecreaseLiquidity and
 * Collect precede it); any other transfer moves the position's value between
 * the two users' UserStatsPerPool and updates the owner (legacy logic).
 *
 * @param event - AeroNFPM.Transfer
 * @param context - Handler context
 * @returns Promise that resolves once the pending mint, deletion or transfer is staged
 */
export async function processAeroNFPMTransfer(
  event: EvmEvent<"AeroNFPM", "Transfer">,
  context: handlerContext,
): Promise<void> {
  const positionId = NonFungiblePositionId(
    event.chainId,
    event.srcAddress,
    event.params.tokenId,
  );

  if (event.params.from === ZERO_ADDRESS) {
    context.AeroNFPMPendingMint.set({
      id: positionId,
      owner: event.params.to,
      transactionHash: event.transaction.hash,
    });
    return;
  }

  const position = await getRehydrated(
    context.NonFungiblePosition,
    "NonFungiblePosition",
    positionId,
  );
  if (!position) {
    context.log.error(
      `[AeroNFPM.Transfer] NonFungiblePosition ${positionId} not found in tx ${event.transaction.hash}`,
    );
    return;
  }

  if (event.params.to === ZERO_ADDRESS) {
    context.NonFungiblePosition.deleteUnsafe(position.id);
    context.NFPMPositionPendingPrincipal.deleteUnsafe(position.id);
    return;
  }

  await handleRegularTransfer(event, position, context);
}

/**
 * Aero NFPM IncreaseLiquidity: creates the position on its mint (step 3
 * above) or adds liquidity to an existing one, and credits the added amounts
 * to the owner's UserStatsPerPool.
 *
 * @param event - AeroNFPM.IncreaseLiquidity (carries tickLower / tickUpper)
 * @param context - Handler context
 * @returns Promise that resolves once the position, the consumed correlation
 *   rows and the owner's flows are staged
 */
export async function processAeroNFPMIncreaseLiquidity(
  event: EvmEvent<"AeroNFPM", "IncreaseLiquidity">,
  context: handlerContext,
): Promise<void> {
  const { tokenId, liquidity, amount0, amount1, tickLower, tickUpper } =
    event.params;
  const positionId = NonFungiblePositionId(
    event.chainId,
    event.srcAddress,
    tokenId,
  );
  const mintPoolId = AeroNFPMMintPoolId(
    event.chainId,
    event.transaction.hash,
    event.srcAddress,
    tickLower,
    tickUpper,
    liquidity,
    amount0,
    amount1,
  );
  const [existing, mintPool, pendingMint] = await Promise.all([
    getRehydrated(
      context.NonFungiblePosition,
      "NonFungiblePosition",
      positionId,
    ),
    context.AeroNFPMMintPool.get(mintPoolId),
    context.AeroNFPMPendingMint.get(positionId),
  ]);

  // Consume the matching CLPool.Mint (first in log order).
  const mintedPool = mintPool?.pools[0];
  const mintLogIndex = mintPool?.mintLogIndexes[0];
  if (mintPool) {
    if (mintPool.pools.length > 1) {
      context.AeroNFPMMintPool.set({
        id: mintPool.id,
        pools: mintPool.pools.slice(1),
        mintLogIndexes: mintPool.mintLogIndexes.slice(1),
      });
    } else {
      context.AeroNFPMMintPool.deleteUnsafe(mintPool.id);
    }
  }

  if (!existing && (!pendingMint || mintedPool === undefined)) {
    const missing = [
      pendingMint ? undefined : "no mint Transfer",
      mintedPool === undefined ? "no matching CLPool.Mint" : undefined,
    ].filter(Boolean);
    context.log.error(
      `[AeroNFPM.IncreaseLiquidity] Cannot create position ${positionId} in tx ${event.transaction.hash}: ${missing.join(", ")}`,
    );
    return;
  }
  const poolAddress = existing?.pool ?? (mintedPool as string);
  const poolData = await loadPoolData(
    poolAddress,
    event.chainId,
    context,
    event.block.number,
    event.block.timestamp,
  );

  const timestamp = new Date(event.block.timestamp * 1000);
  let position: NonFungiblePosition;
  if (existing) {
    position = existing;
  } else {
    // Created with zero liquidity; the increase below adds this event's.
    context.AeroNFPMPendingMint.deleteUnsafe(positionId);
    position = {
      id: positionId,
      chainId: event.chainId,
      tokenId,
      nfpmAddress: event.srcAddress,
      owner: (pendingMint as { owner: string }).owner,
      pool: poolAddress,
      tickLower,
      tickUpper,
      token0: poolData?.liquidityPoolAggregator.token0_address ?? "",
      token1: poolData?.liquidityPoolAggregator.token1_address ?? "",
      liquidity: 0n,
      mintTransactionHash: event.transaction.hash,
      mintLogIndex: mintLogIndex ?? event.logIndex,
      lastUpdatedTimestamp: timestamp,
      lastSnapshotTimestamp: undefined,
      isStakedInGauge: false,
    };
  }
  updateNonFungiblePosition(
    { incrementalLiquidity: liquidity, lastUpdatedTimestamp: timestamp },
    position,
    context,
    timestamp,
  );

  if (!poolData) {
    context.log.warn(
      `[AeroNFPM.IncreaseLiquidity] Pool ${position.pool} not found for position ${positionId}`,
    );
    return;
  }

  await attributeLiquidityChangeToUserStatsPerPool(
    position.owner,
    position.pool,
    poolData,
    context,
    amount0,
    amount1,
    event.block.timestamp,
    LiquidityChangeType.ADD,
  );

  if (position.isStakedInGauge) {
    await updateStakedPositionLiquidity(
      position,
      poolData,
      liquidity,
      context,
      timestamp,
      event.chainId,
      event.block.number,
    );
  }
}

/**
 * Aero NFPM DecreaseLiquidity: the legacy decrease (liquidity, owner's
 * removed flows, staked edges) plus the principal now owed to the position,
 * which its next Collect pays out together with its fees.
 *
 * @param event - AeroNFPM.DecreaseLiquidity
 * @param context - Handler context
 * @returns Promise that resolves once the decrease and the principal tracker are staged
 */
export async function processAeroNFPMDecreaseLiquidity(
  event: EvmEvent<"AeroNFPM", "DecreaseLiquidity">,
  context: handlerContext,
): Promise<void> {
  const positionId = NonFungiblePositionId(
    event.chainId,
    event.srcAddress,
    event.params.tokenId,
  );
  const tracker = await context.NFPMPositionPendingPrincipal.get(positionId);
  if (event.params.amount0 !== 0n || event.params.amount1 !== 0n) {
    context.NFPMPositionPendingPrincipal.set({
      id: positionId,
      pendingPrincipal0:
        (tracker?.pendingPrincipal0 ?? 0n) + event.params.amount0,
      pendingPrincipal1:
        (tracker?.pendingPrincipal1 ?? 0n) + event.params.amount1,
    });
  }
  await processNFPMDecreaseLiquidity(event, context);
}

/**
 * Aero NFPM Collect: splits the collected amounts into principal (tracked
 * from DecreaseLiquidity) and fees, and credits the fees to the position
 * owner's `totalUnstakedFeesCollected*`. Pool-level totals are written by
 * CLPool.Collect, which skips the NFPM contract as a user for Aero pools.
 *
 * @param event - AeroNFPM.Collect
 * @param context - Handler context
 * @returns Promise that resolves once the tracker and the owner's fee counters are staged
 */
export async function processAeroNFPMCollect(
  event: EvmEvent<"AeroNFPM", "Collect">,
  context: handlerContext,
): Promise<void> {
  const positionId = NonFungiblePositionId(
    event.chainId,
    event.srcAddress,
    event.params.tokenId,
  );
  const [position, tracker] = await Promise.all([
    getRehydrated(
      context.NonFungiblePosition,
      "NonFungiblePosition",
      positionId,
    ),
    context.NFPMPositionPendingPrincipal.get(positionId),
  ]);

  const { fees: fees0, remainingPrincipal: remaining0 } = isolateFees(
    event.params.amount0,
    tracker?.pendingPrincipal0 ?? 0n,
  );
  const { fees: fees1, remainingPrincipal: remaining1 } = isolateFees(
    event.params.amount1,
    tracker?.pendingPrincipal1 ?? 0n,
  );
  if (tracker) {
    if (remaining0 === 0n && remaining1 === 0n) {
      context.NFPMPositionPendingPrincipal.deleteUnsafe(positionId);
    } else {
      context.NFPMPositionPendingPrincipal.set({
        ...tracker,
        pendingPrincipal0: remaining0,
        pendingPrincipal1: remaining1,
      });
    }
  }

  if (!position) {
    context.log.error(
      `[AeroNFPM.Collect] NonFungiblePosition ${positionId} not found in tx ${event.transaction.hash}`,
    );
    return;
  }
  if (fees0 === 0n && fees1 === 0n) return;

  const timestamp = new Date(event.block.timestamp * 1000);
  const [poolData, userData] = await Promise.all([
    loadPoolData(
      position.pool,
      event.chainId,
      context,
      event.block.number,
      event.block.timestamp,
    ),
    loadOrCreateUserData(
      position.owner,
      position.pool,
      event.chainId,
      context,
      timestamp,
    ),
  ]);
  if (!poolData) return;

  const feesUSD = calculateTotalUSD(
    fees0,
    fees1,
    poolData.token0Instance,
    poolData.token1Instance,
  );
  await updateUserStatsPerPool(
    {
      incrementalTotalUnstakedFeesCollected0: fees0,
      incrementalTotalUnstakedFeesCollected1: fees1,
      incrementalTotalUnstakedFeesCollectedUSD: feesUSD,
      lastActivityTimestamp: timestamp,
    },
    userData,
    context,
    timestamp,
    poolData,
  );
}
