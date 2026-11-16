import type { SAeroEscrowState, SAeroPosition } from "envio";
import { ZERO_ADDRESS, toChecksumAddress } from "../../Constants";
import { getRehydrated } from "../../EntityTimestamps";
import type { handlerContext } from "../../EntityTypes";
import { getSnapshotEpoch, shouldSnapshot } from "../../Snapshots/Shared";
import {
  AERO_MAXTIME_SECONDS,
  AERO_WEEK_SECONDS,
  AeroEventId,
  AeroSnapshotId,
  SAERO_CREATED_VIA,
  SAERO_DEPOSIT_TYPE,
  SAERO_EVENT_KIND,
  SAERO_MINT_SENTINEL,
  SAeroPositionId,
} from "./AeroConstants";

/**
 * sAERO positions of the Aero VotingEscrow on Base (ADR 0006).
 *
 * A position is created at its NFT mint (Transfer from 0) with no stake, then
 * funded by Deposit(CREATE_STAKE) or, for a position minted by a
 * VoterPaymentsModule split, by the VotingEscrow.Rebalance leg that minted it.
 * Rebalance names mint legs with the sentinel tokenId `type(uint256).max`; the
 * minted ids are the last ones minted (the escrow mints them in leg order,
 * nothing else mints inside the call), so they are resolved from
 * `SAeroEscrowState.lastTokenId` without a scan. A minted leg inherits
 * permanence and unlock from the sources, as the contract does.
 *
 * Every change writes one SAeroPositionEvent row; SAeroEscrowState keeps the
 * supply, the permanent balance and the accumulator.
 */

const ZERO = toChecksumAddress(ZERO_ADDRESS);

/** Shape of a stake used for the permanent-balance bookkeeping. */
type StakeShape = Pick<SAeroPosition, "amount" | "isPermanent">;

/**
 * Reads the escrow state, or builds an empty one.
 *
 * @param chainId - Chain of the VotingEscrow
 * @param timestamp - Block time for a new row
 * @param context - Handler context
 * @returns The escrow state (not persisted)
 */
export async function loadOrCreateEscrowState(
  chainId: number,
  timestamp: Date,
  context: handlerContext,
): Promise<SAeroEscrowState> {
  const existing = await getRehydrated(
    context.SAeroEscrowState,
    "SAeroEscrowState",
    `${chainId}`,
  );
  return (
    existing ?? {
      id: `${chainId}`,
      supply: 0n,
      permanentStakeBalance: 0n,
      accumulatorAmount: 0n,
      totalBurned: 0n,
      numberOfPositions: 0,
      lastTokenId: 0n,
      lastUpdatedTimestamp: timestamp,
      lastSnapshotTimestamp: undefined,
    }
  );
}

/**
 * Stages the escrow state and its hourly snapshot (first change of each hour).
 *
 * @param escrow - Updated escrow state
 * @param timestamp - Block time of the change
 * @param context - Handler context
 * @returns Nothing; the state (and any snapshot) are staged
 */
export function persistEscrowState(
  escrow: SAeroEscrowState,
  timestamp: Date,
  context: handlerContext,
): void {
  let next: SAeroEscrowState = { ...escrow, lastUpdatedTimestamp: timestamp };
  if (shouldSnapshot(next.lastSnapshotTimestamp, timestamp)) {
    const epoch = getSnapshotEpoch(timestamp);
    context.SAeroEscrowStateSnapshot.set({
      id: AeroSnapshotId(next.id, epoch.getTime()),
      timestamp: epoch,
      supply: next.supply,
      permanentStakeBalance: next.permanentStakeBalance,
      accumulatorAmount: next.accumulatorAmount,
      numberOfPositions: next.numberOfPositions,
    });
    next = { ...next, lastSnapshotTimestamp: epoch };
  }
  context.SAeroEscrowState.set(next);
}

/**
 * Builds an empty position (no stake yet).
 *
 * @param chainId - Chain of the VotingEscrow
 * @param tokenId - tokenId
 * @param owner - NFT owner (the zero address for the accumulator)
 * @param createdVia - How it was created
 * @param timestamp - Block time
 * @param transactionHash - Transaction
 * @returns The new position (not persisted)
 */
export function createSAeroPositionEntity(
  chainId: number,
  tokenId: bigint,
  owner: string,
  createdVia: string,
  timestamp: Date,
  transactionHash: string,
): SAeroPosition {
  return {
    id: SAeroPositionId(chainId, tokenId),
    tokenId,
    owner,
    amount: 0n,
    stakeEnd: 0n,
    isPermanent: createdVia === SAERO_CREATED_VIA.ACCUMULATOR,
    createdVia,
    totalDeposited: 0n,
    totalWithdrawn: 0n,
    totalRebalancedIn: 0n,
    totalRebalancedOut: 0n,
    createdTimestamp: timestamp,
    createdTransactionHash: transactionHash,
    lastUpdatedTimestamp: timestamp,
  };
}

/**
 * Applies the permanent-balance and accumulator effect of a position change
 * to the escrow state, as the VotingEscrow's `_commit` does.
 *
 * @param escrow - Escrow state before the change
 * @param tokenId - Position changed
 * @param before - Stake before
 * @param after - Stake after
 * @returns The escrow state after the change (not persisted)
 */
export function applyStakeChange(
  escrow: SAeroEscrowState,
  tokenId: bigint,
  before: StakeShape,
  after: StakeShape,
): SAeroEscrowState {
  const oldPermanent = before.isPermanent ? before.amount : 0n;
  const newPermanent = after.isPermanent ? after.amount : 0n;
  return {
    ...escrow,
    permanentStakeBalance:
      escrow.permanentStakeBalance - oldPermanent + newPermanent,
    accumulatorAmount: tokenId === 0n ? after.amount : escrow.accumulatorAmount,
  };
}

/** Common fields of one VotingEscrow event. */
export interface SAeroEventContext {
  chainId: number;
  blockNumber: number;
  timestamp: number;
  transactionHash: string;
  logIndex: number;
}

/**
 * Writes one SAeroPositionEvent row.
 *
 * @param ev - Event coordinates
 * @param kind - Change kind
 * @param position - Position after the change
 * @param amount - AERO moved by the change
 * @param counterparty - Previous owner / provider, when relevant
 * @param supplyAfter - Escrow supply after the change, when the change emits one
 * @param context - Handler context
 * @param leg - Leg index for multi-row events (Rebalance)
 * @returns Nothing; the row is staged
 */
export function writeSAeroEvent(
  ev: SAeroEventContext,
  kind: string,
  position: SAeroPosition,
  amount: bigint,
  counterparty: string | undefined,
  supplyAfter: bigint | undefined,
  context: handlerContext,
  leg?: number,
): void {
  context.SAeroPositionEvent.set({
    id: AeroEventId(ev.chainId, ev.transactionHash, ev.logIndex, leg),
    kind,
    tokenId: position.tokenId,
    owner: position.owner,
    counterparty,
    amount,
    amountAfter: position.amount,
    stakeEndAfter: position.stakeEnd,
    isPermanentAfter: position.isPermanent,
    supplyAfter,
    blockNumber: BigInt(ev.blockNumber),
    timestamp: new Date(ev.timestamp * 1000),
    transactionHash: ev.transactionHash,
  });
}

/**
 * Loads a position, creating an empty one (with a warning) when its mint was
 * not indexed, so a change is never lost.
 *
 * @param ev - Event coordinates
 * @param tokenId - Position
 * @param context - Handler context
 * @returns The position (not persisted)
 */
async function loadPosition(
  ev: SAeroEventContext,
  tokenId: bigint,
  context: handlerContext,
): Promise<SAeroPosition> {
  const existing = await getRehydrated(
    context.SAeroPosition,
    "SAeroPosition",
    SAeroPositionId(ev.chainId, tokenId),
  );
  if (existing) return existing;
  if (tokenId !== 0n) {
    context.log.warn(
      `[AeroVotingEscrow] position ${tokenId} on chain ${ev.chainId} changed before its mint was indexed`,
    );
  }
  return createSAeroPositionEntity(
    ev.chainId,
    tokenId,
    ZERO,
    tokenId === 0n
      ? SAERO_CREATED_VIA.ACCUMULATOR
      : SAERO_CREATED_VIA.MINT_PENDING,
    new Date(ev.timestamp * 1000),
    ev.transactionHash,
  );
}

/**
 * Transfer: a mint creates the position (owner, no stake); any other transfer
 * moves ownership. The VotingEscrow never burns its NFTs (a withdrawn position
 * keeps its tokenId and owner at zero stake).
 *
 * @param ev - Event coordinates
 * @param from - Previous owner (zero on mint)
 * @param to - New owner
 * @param tokenId - Position
 * @param context - Handler context
 * @returns Promise that resolves once the position, escrow and row are staged
 */
export async function processSAeroTransfer(
  ev: SAeroEventContext,
  from: string,
  to: string,
  tokenId: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  if (from === ZERO) {
    const [escrow, existing] = await Promise.all([
      loadOrCreateEscrowState(ev.chainId, timestamp, context),
      getRehydrated(
        context.SAeroPosition,
        "SAeroPosition",
        SAeroPositionId(ev.chainId, tokenId),
      ),
    ]);
    const position =
      existing ??
      createSAeroPositionEntity(
        ev.chainId,
        tokenId,
        to,
        SAERO_CREATED_VIA.MINT_PENDING,
        timestamp,
        ev.transactionHash,
      );
    const minted = { ...position, owner: to, lastUpdatedTimestamp: timestamp };
    context.SAeroPosition.set(minted);
    persistEscrowState(
      {
        ...escrow,
        numberOfPositions: escrow.numberOfPositions + (existing ? 0 : 1),
        lastTokenId:
          tokenId > escrow.lastTokenId ? tokenId : escrow.lastTokenId,
      },
      timestamp,
      context,
    );
    writeSAeroEvent(
      ev,
      SAERO_EVENT_KIND.MINT,
      minted,
      0n,
      undefined,
      undefined,
      context,
    );
    return;
  }
  const position = await loadPosition(ev, tokenId, context);
  const moved = { ...position, owner: to, lastUpdatedTimestamp: timestamp };
  context.SAeroPosition.set(moved);
  writeSAeroEvent(
    ev,
    SAERO_EVENT_KIND.TRANSFER,
    moved,
    0n,
    from,
    undefined,
    context,
  );
}

/**
 * Deposit: createStake / reviveStake (fund the position; unlock 0 =
 * permanent), increaseStakeAmount (add), increaseStakingPeriod (new unlock,
 * decaying). Supply grows by `value` (the transaction's Supply event follows).
 *
 * @param ev - Event coordinates
 * @param provider - Funder
 * @param tokenId - Position
 * @param depositType - VotingEscrow DepositType
 * @param value - AERO deposited (0 for a period extension)
 * @param unstakeTime - Unlock time after the deposit
 * @param context - Handler context
 * @returns Promise that resolves once the position, escrow and row are staged
 */
export async function processSAeroDeposit(
  ev: SAeroEventContext,
  provider: string,
  tokenId: bigint,
  depositType: bigint,
  value: bigint,
  unstakeTime: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const [escrow, position] = await Promise.all([
    loadOrCreateEscrowState(ev.chainId, timestamp, context),
    loadPosition(ev, tokenId, context),
  ]);
  let updated: SAeroPosition;
  let kind: string;
  switch (depositType) {
    case SAERO_DEPOSIT_TYPE.CREATE_STAKE:
    case SAERO_DEPOSIT_TYPE.REVIVE_STAKE:
      kind =
        depositType === SAERO_DEPOSIT_TYPE.CREATE_STAKE
          ? SAERO_EVENT_KIND.CREATE_STAKE
          : SAERO_EVENT_KIND.REVIVE_STAKE;
      updated = {
        ...position,
        amount: position.amount + value,
        stakeEnd: unstakeTime,
        isPermanent: unstakeTime === 0n,
        createdVia:
          position.createdVia === SAERO_CREATED_VIA.MINT_PENDING
            ? SAERO_CREATED_VIA.CREATE_STAKE
            : position.createdVia,
      };
      break;
    case SAERO_DEPOSIT_TYPE.INCREASE_STAKE_AMOUNT:
      kind = SAERO_EVENT_KIND.INCREASE_AMOUNT;
      updated = { ...position, amount: position.amount + value };
      break;
    default:
      kind = SAERO_EVENT_KIND.INCREASE_PERIOD;
      updated = { ...position, stakeEnd: unstakeTime, isPermanent: false };
      break;
  }
  updated = {
    ...updated,
    totalDeposited: position.totalDeposited + value,
    lastUpdatedTimestamp: timestamp,
  };
  context.SAeroPosition.set(updated);
  const supplyAfter = escrow.supply + value;
  persistEscrowState(
    {
      ...applyStakeChange(escrow, tokenId, position, updated),
      supply: supplyAfter,
    },
    timestamp,
    context,
  );
  writeSAeroEvent(ev, kind, updated, value, provider, supplyAfter, context);
}

/**
 * Withdraw: an expired stake is paid out; the position stays at zero stake.
 *
 * @param ev - Event coordinates
 * @param provider - Owner that withdrew
 * @param tokenId - Position
 * @param value - AERO withdrawn
 * @param context - Handler context
 * @returns Promise that resolves once the position, escrow and row are staged
 */
export async function processSAeroWithdraw(
  ev: SAeroEventContext,
  provider: string,
  tokenId: bigint,
  value: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const [escrow, position] = await Promise.all([
    loadOrCreateEscrowState(ev.chainId, timestamp, context),
    loadPosition(ev, tokenId, context),
  ]);
  const updated: SAeroPosition = {
    ...position,
    amount: 0n,
    stakeEnd: 0n,
    isPermanent: false,
    totalWithdrawn: position.totalWithdrawn + value,
    lastUpdatedTimestamp: timestamp,
  };
  context.SAeroPosition.set(updated);
  const supplyAfter = escrow.supply - value;
  persistEscrowState(
    {
      ...applyStakeChange(escrow, tokenId, position, updated),
      supply: supplyAfter,
    },
    timestamp,
    context,
  );
  writeSAeroEvent(
    ev,
    SAERO_EVENT_KIND.WITHDRAW,
    updated,
    value,
    provider,
    supplyAfter,
    context,
  );
}

/**
 * UpgradeToPermanentStake / DowngradeFromPermanentStake. A downgrade restarts
 * decay with a full four-year unlock, week-aligned, as the contract computes it.
 *
 * @param ev - Event coordinates
 * @param tokenId - Position
 * @param toPermanent - True for an upgrade, false for a downgrade
 * @param ts - The event's `ts` (block time)
 * @param context - Handler context
 * @returns Promise that resolves once the position, escrow and row are staged
 */
export async function processSAeroPermanence(
  ev: SAeroEventContext,
  tokenId: bigint,
  toPermanent: boolean,
  ts: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const [escrow, position] = await Promise.all([
    loadOrCreateEscrowState(ev.chainId, timestamp, context),
    loadPosition(ev, tokenId, context),
  ]);
  const updated: SAeroPosition = {
    ...position,
    isPermanent: toPermanent,
    stakeEnd: toPermanent
      ? 0n
      : ((ts + AERO_MAXTIME_SECONDS) / AERO_WEEK_SECONDS) * AERO_WEEK_SECONDS,
    lastUpdatedTimestamp: timestamp,
  };
  context.SAeroPosition.set(updated);
  persistEscrowState(
    applyStakeChange(escrow, tokenId, position, updated),
    timestamp,
    context,
  );
  writeSAeroEvent(
    ev,
    toPermanent
      ? SAERO_EVENT_KIND.UPGRADE_PERMANENT
      : SAERO_EVENT_KIND.DOWNGRADE_PERMANENT,
    updated,
    0n,
    undefined,
    undefined,
    context,
  );
}

/**
 * Rebalance: a VoterPaymentsModule moved stake between positions. Sources
 * lose their amounts (shape kept); destinations gain them: tokenId 0 is the
 * permanent protocol accumulator, the mint sentinel is a freshly minted
 * position (inheriting permanence, else the latest source unlock), anything
 * else an existing position. Supply is unchanged. Reads every touched
 * position by primary key in parallel (legs are bounded by the call).
 *
 * @param ev - Event coordinates
 * @param sources - Source legs (tokenId, amount)
 * @param destinations - Destination legs (tokenId or sentinel, amount)
 * @param context - Handler context
 * @returns Promise that resolves once positions, escrow and rows are staged
 */
export async function processSAeroRebalance(
  ev: SAeroEventContext,
  sources: readonly { tokenId: bigint; amount: bigint }[],
  destinations: readonly { tokenId: bigint; amount: bigint }[],
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  let escrow = await loadOrCreateEscrowState(ev.chainId, timestamp, context);

  // Mint legs, in leg order, got the last `mintCount` ids.
  const mintCount = destinations.filter(
    (d) => d.tokenId === SAERO_MINT_SENTINEL,
  ).length;
  let nextMintId = escrow.lastTokenId - BigInt(mintCount) + 1n;
  const resolvedDestinations = destinations.map((d) => {
    if (d.tokenId !== SAERO_MINT_SENTINEL) return { ...d, isMint: false };
    const id = nextMintId;
    nextMintId += 1n;
    return { tokenId: id, amount: d.amount, isMint: true };
  });

  const ids = [
    ...new Set([
      ...sources.map((s) => s.tokenId),
      ...resolvedDestinations.map((d) => d.tokenId),
    ]),
  ];
  const loaded = await Promise.all(
    ids.map((id) => loadPosition(ev, id, context)),
  );
  const positions = new Map<bigint, SAeroPosition>(
    ids.map((id, i) => [id, loaded[i]]),
  );

  // Latest source unlock; a permanent source makes every mint permanent.
  let anyPermanentSource = false;
  let maxSourceEnd = 0n;
  for (const s of sources) {
    const p = positions.get(s.tokenId) as SAeroPosition;
    if (p.isPermanent) anyPermanentSource = true;
    else if (p.stakeEnd > maxSourceEnd) maxSourceEnd = p.stakeEnd;
  }

  let leg = 0;
  for (const s of sources) {
    const before = positions.get(s.tokenId) as SAeroPosition;
    const after: SAeroPosition = {
      ...before,
      amount: before.amount - s.amount,
      totalRebalancedOut: before.totalRebalancedOut + s.amount,
      lastUpdatedTimestamp: timestamp,
    };
    escrow = applyStakeChange(escrow, s.tokenId, before, after);
    positions.set(s.tokenId, after);
    writeSAeroEvent(
      ev,
      SAERO_EVENT_KIND.REBALANCE_OUT,
      after,
      s.amount,
      undefined,
      undefined,
      context,
      leg++,
    );
  }
  for (const d of resolvedDestinations) {
    const before = positions.get(d.tokenId) as SAeroPosition;
    let after: SAeroPosition = {
      ...before,
      amount: before.amount + d.amount,
      totalRebalancedIn: before.totalRebalancedIn + d.amount,
      lastUpdatedTimestamp: timestamp,
    };
    if (d.tokenId === 0n) {
      after = { ...after, isPermanent: true, stakeEnd: 0n };
    } else if (d.isMint) {
      after = {
        ...after,
        isPermanent: anyPermanentSource,
        stakeEnd: anyPermanentSource ? 0n : maxSourceEnd,
        createdVia: SAERO_CREATED_VIA.REBALANCE,
      };
    }
    escrow = applyStakeChange(escrow, d.tokenId, before, after);
    positions.set(d.tokenId, after);
    writeSAeroEvent(
      ev,
      SAERO_EVENT_KIND.REBALANCE_IN,
      after,
      d.amount,
      undefined,
      undefined,
      context,
      leg++,
    );
  }
  for (const p of positions.values()) context.SAeroPosition.set(p);
  persistEscrowState(escrow, timestamp, context);
}

/**
 * Burn: protocol accumulator AERO destroyed. The VotingEscrow emits `Supply`
 * (already net of the burn) just before `Burn` in the same transaction, so
 * the escrow's supply is left as that event set it; subtracting the amount
 * again would count the burn twice until the next `Supply`.
 *
 * @param ev - Event coordinates
 * @param amount - AERO burned
 * @param context - Handler context
 * @returns Promise that resolves once the accumulator, escrow and row are staged
 */
export async function processSAeroBurn(
  ev: SAeroEventContext,
  amount: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const [escrow, accumulator] = await Promise.all([
    loadOrCreateEscrowState(ev.chainId, timestamp, context),
    loadPosition(ev, 0n, context),
  ]);
  const updated: SAeroPosition = {
    ...accumulator,
    amount: accumulator.amount - amount,
    isPermanent: true,
    stakeEnd: 0n,
    lastUpdatedTimestamp: timestamp,
  };
  context.SAeroPosition.set(updated);
  const supplyAfter = escrow.supply;
  persistEscrowState(
    {
      ...applyStakeChange(escrow, 0n, accumulator, updated),
      totalBurned: escrow.totalBurned + amount,
    },
    timestamp,
    context,
  );
  writeSAeroEvent(
    ev,
    SAERO_EVENT_KIND.BURN,
    updated,
    amount,
    undefined,
    supplyAfter,
    context,
  );
}

/**
 * Supply: the VotingEscrow's total after a deposit, withdrawal or burn. For
 * deposits and withdrawals the handlers above already moved the supply by the
 * same amount. A burn's `Supply` comes before its `Burn`, so a shortfall of
 * at most the accumulator's balance is that burn, not drift. The contract's
 * value is authoritative; any other drift is logged.
 *
 * @param ev - Event coordinates
 * @param supply - Total supply after the change
 * @param context - Handler context
 * @returns Promise that resolves once the escrow state is staged
 */
export async function processSAeroSupply(
  ev: SAeroEventContext,
  supply: bigint,
  context: handlerContext,
): Promise<void> {
  const timestamp = new Date(ev.timestamp * 1000);
  const escrow = await loadOrCreateEscrowState(ev.chainId, timestamp, context);
  const drift = escrow.supply - supply;
  const pendingBurn = drift > 0n && drift <= escrow.accumulatorAmount;
  if (drift !== 0n && !pendingBurn) {
    context.log.warn(
      `[AeroVotingEscrow.Supply] tracked supply ${escrow.supply} != emitted ${supply} on chain ${ev.chainId} (tx ${ev.transactionHash})`,
    );
  }
  persistEscrowState({ ...escrow, supply }, timestamp, context);
}
