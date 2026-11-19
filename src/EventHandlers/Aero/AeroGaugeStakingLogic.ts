import { loadPoolData, updatePool } from "../../Aggregators/Pool";
import {
  loadOrCreateUserData,
  updateUserStatsPerPool,
} from "../../Aggregators/UserStatsPerPool";
import type { handlerContext } from "../../EntityTypes";
import {
  type GaugeEventData,
  computeCLStakedReservesOnGaugeEvent,
  computeNonCLStakedUSDIfAvailable,
} from "../Gauges/GaugeSharedLogic";
import {
  AERO_STAKE_EVENT_KIND,
  AeroEventId,
  type AeroStakeEventKind,
} from "./AeroConstants";
import { loadAeroGauge, persistAeroGauge } from "./AeroGaugeLogic";

/**
 * Aero gauge staking (ADR 0006). A Deposit / Withdraw / EmergencyWithdraw of
 * an Aero gauge moves the staked liquidity of the gauge's pool exactly as the
 * legacy gauges do: `Pool.currentLiquidityStaked*`, the CL staked tick map and
 * staked reserves (so `stakedLiquidityInRange` follows swaps), and the
 * account's `UserStatsPerPool.currentLiquidityStaked` /
 * `stakedCLPositionTokenIds`. The NFPM's transfer to / from the gauge flips
 * `NonFungiblePosition.isStakedInGauge` and keeps the real owner, through the
 * `Pool.gaugeAddress` check in NFPMTransferLogic.
 *
 * The pool comes from the AeroGauge row by primary key; the legacy path's
 * gauge → pool `getWhere` and root-gauge scan are not used.
 */

/** Event fields of an Aero gauge stake change. */
export interface AeroStakeEventData {
  chainId: number;
  gaugeAddress: string;
  kind: AeroStakeEventKind;
  account: string;
  caller: string | undefined;
  tokenId: bigint | undefined;
  amount: bigint;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
  logIndex: number;
}

/**
 * Applies a stake (`direction` 1n) or unstake (-1n) to the gauge's pool and
 * the account's per-pool stats, with the legacy gauge path's arithmetic
 * (computeCLStakedReservesOnGaugeEvent / computeNonCLStakedUSDIfAvailable).
 * An unstake larger than the recorded stake is logged and skipped, as on
 * legacy gauges.
 *
 * @param poolAddress - The gauge's pool
 * @param data - Stake change
 * @param direction - 1n to stake, -1n to unstake
 * @param context - Handler context
 * @returns Promise that resolves once the Pool and UserStatsPerPool updates are staged
 */
export async function applyAeroStakeToPool(
  poolAddress: string,
  data: AeroStakeEventData,
  direction: 1n | -1n,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(data.timestamp * 1000);
  const [poolData, userData] = await Promise.all([
    loadPoolData(poolAddress, data.chainId, context),
    loadOrCreateUserData(
      data.account,
      poolAddress,
      data.chainId,
      context,
      timestamp,
    ),
  ]);
  if (!poolData) {
    context.log.warn(
      `[AeroGauge.${data.kind}] pool ${poolAddress} of gauge ${data.gaugeAddress} not found on chain ${data.chainId}`,
    );
    return;
  }
  const pool = poolData.liquidityPoolAggregator;
  const delta = direction * data.amount;
  const newPoolStake = pool.currentLiquidityStaked + delta;
  if (direction === -1n) {
    const newUserStake = userData.currentLiquidityStaked + delta;
    if (newPoolStake < 0n || newUserStake < 0n) {
      context.log.error(
        `[AeroGauge.${data.kind}] unstake of ${data.amount} exceeds the recorded stake for pool ${poolAddress} user ${data.account} on chain ${data.chainId}. Skipping update.`,
      );
      return;
    }
  }

  const gaugeData: GaugeEventData = {
    gaugeAddress: data.gaugeAddress,
    userAddress: data.account,
    chainId: data.chainId,
    blockNumber: data.blockNumber,
    timestamp: data.timestamp,
    amount: data.amount,
    tokenId: data.tokenId,
  };

  let poolStakedUSD: bigint | undefined;
  let stakedLiquidityInRange: bigint | undefined;
  let incrementalStakedReserve0: bigint | undefined;
  let incrementalStakedReserve1: bigint | undefined;
  let stakedTickEdges: readonly bigint[] | undefined;
  if (pool.isCL) {
    const clResult = await computeCLStakedReservesOnGaugeEvent(
      gaugeData,
      pool,
      poolData,
      context,
      direction,
    );
    poolStakedUSD = clResult.poolStakedUSD;
    stakedLiquidityInRange = clResult.stakedLiquidityInRange;
    incrementalStakedReserve0 = clResult.incrementalStakedReserve0;
    incrementalStakedReserve1 = clResult.incrementalStakedReserve1;
    stakedTickEdges = clResult.stakedTickEdges;
  } else {
    poolStakedUSD = computeNonCLStakedUSDIfAvailable(
      newPoolStake,
      pool,
      poolData,
      context,
      data.chainId,
    );
  }

  const existingTokenIds = userData.stakedCLPositionTokenIds ?? [];
  let stakedCLPositionTokenIds: bigint[] | undefined;
  if (pool.isCL && data.tokenId !== undefined) {
    stakedCLPositionTokenIds =
      direction === 1n
        ? [...existingTokenIds, data.tokenId]
        : existingTokenIds.filter((id) => id !== data.tokenId);
  }

  await Promise.all([
    updatePool(
      {
        incrementalNumberOfGaugeDeposits: direction === 1n ? 1n : 0n,
        incrementalNumberOfGaugeWithdrawals: direction === -1n ? 1n : 0n,
        incrementalCurrentLiquidityStaked: delta,
        currentLiquidityStakedUSD: poolStakedUSD,
        stakedLiquidityInRange,
        incrementalStakedReserve0,
        incrementalStakedReserve1,
        // First-deposit latch for the per-swap staked-tick sweep (see
        // processGaugeDeposit): only once an edge list exists.
        hasStakes:
          direction === 1n &&
          pool.isCL &&
          !pool.hasStakes &&
          stakedTickEdges !== undefined &&
          stakedTickEdges.length > 0
            ? true
            : undefined,
        lastUpdatedTimestamp: timestamp,
      },
      pool,
      timestamp,
      context,
      data.chainId,
      data.blockNumber,
    ),
    updateUserStatsPerPool(
      {
        incrementalNumberOfGaugeDeposits: direction === 1n ? 1n : 0n,
        incrementalNumberOfGaugeWithdrawals: direction === -1n ? 1n : 0n,
        incrementalCurrentLiquidityStaked: delta,
        stakedCLPositionTokenIds,
        lastActivityTimestamp: timestamp,
      },
      userData,
      context,
      timestamp,
      data.chainId,
      poolData,
    ),
  ]);
}

/**
 * Handles one Aero gauge Deposit / Withdraw / EmergencyWithdraw: writes the
 * AeroGaugeStakeEvent row, counts it on the gauge and applies it to the pool
 * and the account.
 *
 * @param data - Stake change
 * @param context - Handler context
 * @returns Promise that resolves once the row, gauge and pool updates are staged
 */
export async function processAeroGaugeStake(
  data: AeroStakeEventData,
  context: handlerContext,
): Promise<void> {
  const gauge = await loadAeroGauge(data.chainId, data.gaugeAddress, context);
  if (!gauge) {
    context.log.warn(
      `[AeroGauge.${data.kind}] unknown gauge ${data.gaugeAddress} on chain ${data.chainId}`,
    );
    return;
  }
  const timestamp = new Date(data.timestamp * 1000);
  const isDeposit = data.kind === AERO_STAKE_EVENT_KIND.DEPOSIT;
  context.AeroGaugeStakeEvent.set({
    id: AeroEventId(data.chainId, data.transactionHash, data.logIndex),
    kind: data.kind,
    gaugeAddress: data.gaugeAddress,
    poolAddress: gauge.poolAddress,
    isCL: gauge.isCL,
    account: data.account,
    caller: data.caller,
    tokenId: data.tokenId,
    amount: data.amount,
    blockNumber: BigInt(data.blockNumber),
    timestamp,
    transactionHash: data.transactionHash,
  });
  persistAeroGauge(
    {
      ...gauge,
      numberOfDeposits: gauge.numberOfDeposits + (isDeposit ? 1n : 0n),
      numberOfWithdrawals: gauge.numberOfWithdrawals + (isDeposit ? 0n : 1n),
    },
    timestamp,
    context,
  );
  await applyAeroStakeToPool(
    gauge.poolAddress,
    data,
    isDeposit ? 1n : -1n,
    context,
  );
}
