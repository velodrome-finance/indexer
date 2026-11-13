import { keccak256, slice, toHex } from "viem";
import {
  CHAIN_CONSTANTS,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../Constants";

/**
 * Constants, id builders and value sets of the Aero (MetaDEX) gauge,
 * emissions and governance indexing (phases 2 and 3, ADR 0006).
 *
 * Every Aero entity is keyed by the chain its events come from; no Aero
 * handler reads or writes another chain's rows.
 */

/** Base: the root chain (root Voter, VotingEscrow, Minter). */
export const AERO_ROOT_CHAIN_ID = 8453;

/**
 * The LeafVoter's idle sink (`ZERO_GAUGE` in ProtocolConstants.sol): weight
 * parked on no gauge, or aimed at an unroutable one. It is settled like a
 * gauge (GaugeCapSettled with a zero cap), so all its accrual is surplus.
 */
export const AERO_ZERO_GAUGE = toChecksumAddress(ZERO_ADDRESS);

/**
 * The deallocation sentinel of a gauge allocation (`DEALLOC_GAUGE`,
 * `address(uint160(uint256(keccak256('DROMOS_DEALLOC_GAUGE'))))`): weight
 * listed against it is returned to the root Voter's CHAIN0 and never booked.
 */
export const AERO_DEALLOC_GAUGE = toChecksumAddress(
  slice(keccak256(toHex("DROMOS_DEALLOC_GAUGE")), 12),
);

/**
 * Base's RootEmissionsHandler (leaf-base.json `emissionsHandler`). On Base the
 * LeafVoter mints the receipt token to it and it redeems at once, so every
 * Base claim produces a `Redeemed` from this address. Those are counted but
 * get no AeroRedemptionEvent row.
 */
export const AERO_ROOT_EMISSIONS_HANDLER = toChecksumAddress(
  "0x8C37F30F3c8fd48bEddb14086fa5148291D422C3",
);

/** sAERO maximum staking period (`MAXTIME`, 4 × 365 days) in seconds. */
export const AERO_MAXTIME_SECONDS = 126_144_000n;

/** Pips denominator (`MAX_PIPS`): penalty rates and referral shares. */
export const AERO_MAX_PIPS = 1_000_000n;

/** `AeroGaugeStakeEvent.kind` values. */
export const AERO_STAKE_EVENT_KIND = {
  DEPOSIT: "DEPOSIT",
  WITHDRAW: "WITHDRAW",
  EMERGENCY_WITHDRAW: "EMERGENCY_WITHDRAW",
} as const;
export type AeroStakeEventKind =
  (typeof AERO_STAKE_EVENT_KIND)[keyof typeof AERO_STAKE_EVENT_KIND];

/** `AeroEmissionsEvent.kind` values. */
export const AERO_EMISSIONS_EVENT_KIND = {
  CLAIMED: "CLAIMED",
  DEFERRED: "DEFERRED",
  DEFERRED_CLAIMED: "DEFERRED_CLAIMED",
  REFERRAL_DEFERRED: "REFERRAL_DEFERRED",
  REFERRAL_CLAIMED: "REFERRAL_CLAIMED",
  EARLY_WITHDRAW_PENALTY: "EARLY_WITHDRAW_PENALTY",
} as const;
export type AeroEmissionsEventKind =
  (typeof AERO_EMISSIONS_EVENT_KIND)[keyof typeof AERO_EMISSIONS_EVENT_KIND];

/** `AeroRedemptionEvent.kind` values. */
export const AERO_REDEMPTION_EVENT_KIND = {
  INITIATED: "INITIATED",
  PROCESSED: "PROCESSED",
  DEFERRED: "DEFERRED",
  BUFFER_DRAWN: "BUFFER_DRAWN",
  DONATED: "DONATED",
  SURPLUS_SPENT: "SURPLUS_SPENT",
} as const;

/** `AeroVotingRewardsEvent.kind` values. */
export const AERO_VOTING_REWARDS_EVENT_KIND = {
  FEES_COLLECTED: "FEES_COLLECTED",
  FEES_CLAIMED: "FEES_CLAIMED",
  INCENTIVE_CREATED: "INCENTIVE_CREATED",
  INCENTIVE_CLAIMED: "INCENTIVE_CLAIMED",
  INCENTIVE_SWEPT: "INCENTIVE_SWEPT",
} as const;

/**
 * Token an Aero gauge's LPs receive on a chain: AERO on Base, the chain's
 * xAERO receipt token elsewhere (CHAIN_CONSTANTS[chainId].aero.rewardToken).
 *
 * @param chainId - Chain of the gauge
 * @returns Checksummed reward token address, or the zero address when the chain has no Aero deployment
 */
export function aeroRewardToken(chainId: number): string {
  const token = CHAIN_CONSTANTS[chainId]?.aero?.rewardToken;
  return token ? toChecksumAddress(token) : AERO_ZERO_GAUGE;
}

/**
 * Id of an Aero gauge: `{chainId}-{gaugeAddress}`.
 *
 * @param chainId - Chain of the gauge
 * @param gauge - Checksummed gauge address
 * @returns AeroGauge id
 */
export const AeroGaugeId = (chainId: number, gauge: string) =>
  `${chainId}-${gauge}`;

/**
 * Id of an Aero gauge factory: `{chainId}-{factoryAddress}`.
 *
 * @param chainId - Chain of the factory
 * @param factory - Checksummed factory address
 * @returns AeroGaugeFactory id
 */
export const AeroGaugeFactoryId = (chainId: number, factory: string) =>
  `${chainId}-${factory}`;

/**
 * Id of an Aero VotingRewardsManager: `{chainId}-{address}`.
 *
 * @param chainId - Chain of the manager
 * @param manager - Checksummed manager address
 * @returns AeroVotingRewardsManager id
 */
export const AeroVotingRewardsManagerId = (chainId: number, manager: string) =>
  `${chainId}-${manager}`;

/**
 * Id of a chain's LeafVoter state: `{chainId}`.
 *
 * @param chainId - Chain of the LeafVoter
 * @returns AeroLeafVoterState id
 */
export const AeroLeafVoterStateId = (chainId: number) => `${chainId}`;

/**
 * Id of an append-only Aero event row: `{chainId}-{txHash}-{logIndex}`, with
 * `-{index}` appended for the n-th row an array-carrying event produces.
 *
 * @param chainId - Chain of the event
 * @param txHash - Transaction hash
 * @param logIndex - Log index
 * @param index - Position within the event's array, when the event yields several rows
 * @returns Event row id
 */
export function AeroEventId(
  chainId: number,
  txHash: string,
  logIndex: number,
  index?: number,
): string {
  const base = `${chainId}-${txHash}-${logIndex}`;
  return index === undefined ? base : `${base}-${index}`;
}

/**
 * Id of an hourly Aero snapshot: `{entityId}-{epochMs}`.
 *
 * @param entityId - Id of the snapshotted entity
 * @param epochMs - Snapshot epoch (hour) in milliseconds
 * @returns Snapshot id
 */
export const AeroSnapshotId = (entityId: string, epochMs: number) =>
  `${entityId}-${epochMs}`;
