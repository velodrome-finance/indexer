import type { CLGaugeConfig, Token } from "envio";
import {
  PoolId,
  TEN_TO_THE_18_BI,
  TokenId,
  isKnownSinkRootPool,
} from "../Constants";
import { getSwapFee, roundBlockToInterval } from "../Effects/Index";
import { getRehydrated, getWhereRehydrated } from "../EntityTimestamps";
import type { handlerContext } from "../EntityTypes";
import type { Pool } from "../EntityTypes";
import { calculateTotalUSD, generatePoolName } from "../Helpers";
import { refreshTokenPrice } from "../PriceOracle";
import { getPoolImpliedUSD, getTrustedUSD } from "../PriceTrust";
import {
  getSnapshotEpoch,
  setPoolSnapshot,
  shouldSnapshot,
} from "../Snapshots/Index";

/**
 * USD-valued floor (1e18-base) above which a `[NEG_STAKED_RESERVE_GUARD]`
 * clamp escalates from `info` to `warn`. Issue #802.
 *
 * Background — the clamp catches two distinct populations:
 *   1. Benign rounding residue. The `divRoundNearest` per-segment math (#771)
 *      leaves a wei-scale random walk that surfaces on full-drain events. A
 *      production audit (deployed commit c9b8978, endpoint
 *      indexer.us.hyperindex.xyz/e38a72a/v1/graphql) found 2,227 clamps across
 *      447 CL pools, summing to a total of $151 across ALL clamps, with a
 *      single-event maximum of $115 (one WETH/cbBTC swap). 95.8% of clamps
 *      were sub-$0.01; median was $0.00. The residue is bounded by per-segment
 *      rounding and does NOT scale with position size.
 *   2. A gross-magnitude overshoot, which would indicate a real staked-reserve
 *      accounting break (e.g. a position whose reserves were never removed),
 *      not rounding. Kept at `warn` as a regression tripwire.
 *
 * Threshold rationale — `$1,000` in 1e18-base. Comfortably above the observed
 * benign maximum ($115, ~8.7× headroom) but below any plausible real leaked
 * position, so genuine drift still surfaces on the warn channel.
 *
 * Why USD, not raw units — a raw-unit floor is decimals-blind: the same
 * `1e7` floor would mean ~$10 for a 6-decimal stablecoin but ~$8,700 for
 * 8-decimal cbBTC, which is incoherent as a severity signal. `updatePool`
 * already loads both token entities and routes reserves through
 * `getTrustedUSD` / `calculateTotalUSD` at the snapshot epoch, so a per-field
 * USD valuation inside the (rare) clamp branch is idiomatic.
 */
const NEG_STAKED_RESERVE_WARN_FLOOR_USD = 1_000n * TEN_TO_THE_18_BI;

/**
 * Logs a `[NEG_STAKED_RESERVE_GUARD]` clamp event, choosing the log channel
 * (`warn` vs `info`) by the USD value of the discarded overshoot.
 *
 * The clamp branch is rare in production (~2,227 events across 447 CL pools
 * over the deployed indexer's history per the #802 audit), so the conditional
 * Token.get load inside this helper is acceptable hot-path cost. Untrusted /
 * missing / unpriced tokens contribute `0n` via `getTrustedUSD`, which
 * naturally degrades the level decision to `info` (an unpriced token cannot
 * be a $1k+ break).
 *
 * @param msg - Pre-formatted clamp message. Content is unchanged across both
 *   log channels per #802 AC (poolAddress, chainId, priorStakedReserve,
 *   delta, clampedTo).
 * @param overshoot - Positive raw-unit magnitude of the discarded overshoot
 *   (= `-stakedReserveSum` since `stakedReserveSum < 0n`).
 * @param tokenId - Pool's token entity ID for the field that overflowed
 *   (`token0_id` for stakedReserve0, `token1_id` for stakedReserve1).
 * @param context - Handler context for Token entity load and log emission.
 * @returns Promise that resolves once the log line is emitted.
 */
async function logNegStakedReserveGuard(
  msg: string,
  overshoot: bigint,
  tokenId: string,
  context: handlerContext,
): Promise<void> {
  const token = await getRehydrated(context.Token, "Token", tokenId);
  const overshootUSD = getTrustedUSD(overshoot, token ?? undefined);
  if (overshootUSD > NEG_STAKED_RESERVE_WARN_FLOOR_USD) {
    context.log.warn(msg);
  } else {
    context.log.info(msg);
  }
}

/**
 * Enum for pool address field types
 */
export enum PoolAddressField {
  GAUGE_ADDRESS = "gaugeAddress",
  BRIBE_VOTING_REWARD_ADDRESS = "bribeVotingRewardAddress",
  FEE_VOTING_REWARD_ADDRESS = "feeVotingRewardAddress",
}

export type DynamicFeeConfig = {
  baseFee: bigint;
  feeCap: bigint;
  scalingFactor: bigint;
};

export interface PoolDiff {
  incrementalReserve0: bigint;
  incrementalReserve1: bigint;
  incrementalTotalLPSupply: bigint;
  incrementalTotalVolume0: bigint;
  incrementalTotalVolume1: bigint;
  incrementalTotalVolumeUSD: bigint;
  incrementalTotalFeesGenerated0: bigint;
  incrementalTotalFeesGenerated1: bigint;
  incrementalTotalFeesGeneratedUSD: bigint;
  incrementalTotalUnstakedFeesCollected0: bigint;
  incrementalTotalUnstakedFeesCollected1: bigint;
  incrementalTotalUnstakedFeesCollectedUSD: bigint;
  incrementalTotalStakedFeesCollected0: bigint;
  incrementalTotalStakedFeesCollected1: bigint;
  incrementalTotalStakedFeesCollectedUSD: bigint;
  incrementalNumberOfSwaps: bigint;
  incrementalTotalEmissions: bigint;
  incrementalTotalEmissionsUSD: bigint;
  incrementalTotalEmissionsRedistributed: bigint;
  incrementalTotalEmissionsForfeited: bigint;
  incrementalTotalFlashLoanFees0: bigint;
  incrementalTotalFlashLoanFees1: bigint;
  incrementalTotalFlashLoanFeesUSD: bigint;
  incrementalTotalFlashLoanVolumeUSD: bigint;
  incrementalNumberOfFlashLoans: bigint;
  incrementalNumberOfGaugeDeposits: bigint;
  incrementalNumberOfGaugeWithdrawals: bigint;
  incrementalNumberOfGaugeRewardClaims: bigint;
  incrementalTotalGaugeRewardsClaimedUSD: bigint;
  incrementalTotalGaugeRewardsClaimed: bigint;
  incrementalCurrentLiquidityStaked: bigint;
  currentTotalLiquidityUSD: bigint;
  currentLiquidityStakedUSD: bigint;
  token0Price: bigint;
  token1Price: bigint;
  gaugeIsAlive: boolean;
  gaugeAddress: string;
  bribeVotingRewardAddress: string;
  feeVotingRewardAddress: string;
  feeProtocol0: bigint;
  feeProtocol1: bigint;
  observationCardinalityNext: bigint;
  sqrtPriceX96: bigint;
  tick: bigint;
  // Absolute (replace) write of liquidityInRange — Swap is authoritative because
  // event.params.liquidity reflects the pool's post-swap on-chain liquidity()
  // (it captures any tick-crossings that happened during the swap).
  liquidityInRange: bigint;
  // Incremental (sum-with-current) write — emitted by in-range CL Mint/Burn so
  // L-changes outside swaps no longer wait for the next swap to be reflected.
  // If both are present in the same diff, the absolute write wins (see #703).
  incrementalLiquidityInRange: bigint;
  stakedLiquidityInRange: bigint;
  incrementalStakedReserve0: bigint;
  incrementalStakedReserve1: bigint;
  hasStakes: boolean;
  // Replace semantics (NOT incremental): producers — gauge deposit/withdraw,
  // NFPM liquidity change — compute the full post-edit arrays from `current.
  // stakedTickEdges` / `current.stakedTickEdgeNets` and pass them whole. The
  // aggregator writes them verbatim; there is no merge/sum path for these
  // fields the way `incrementalCurrentLiquidityStaked` & co. have. This is
  // the same "last-writer-wins" style used for `tick`, `sqrtPriceX96`, etc.
  //
  // Why replace (not incremental): the array is a sorted, dedup'd, no-zero
  // encoding of Uniswap v3's liquidityNet per tick. Splicing in a delta
  // requires a binary-search locate that only makes sense against the current
  // state — producers already do it in applyPositionToEdges, so the
  // aggregator just takes the result.
  //
  // Typed `readonly bigint[]` so callers can pass the value straight from the
  // `Pool` entity (whose array fields are readonly in
  // envio.d.ts) without a copy.
  stakedTickEdges: readonly bigint[];
  stakedTickEdgeNets: readonly bigint[];
  // Total-liquidity edge map (all positions). Same replace semantics as the
  // staked pair above: CLPool Mint/Burn compute the full post-edit arrays via
  // applyPositionToEdges and pass them whole. Drives the fee-free swap
  // reserve delta (#803).
  tickEdges: readonly bigint[];
  tickEdgeNets: readonly bigint[];
  totalVotesDeposited: bigint;
  totalVotesDepositedUSD: bigint;
  incrementalTotalBribeClaimedUSD: bigint;
  incrementalTotalFeeRewardClaimedUSD: bigint;
  veNFTamountStaked: bigint;
  baseFee: bigint;
  feeCap: bigint;
  scalingFactor: bigint;
  currentFee: bigint;
  // Nullable to allow an explicit "unset" sentinel (entity field is also nullable).
  // No clear path exists today — the module never emits a reset — but widening keeps
  // diff nullability aligned with the entity if one is ever added.
  unstakedFee: bigint | undefined;
  lastUpdatedTimestamp: Date;
  lastSnapshotTimestamp: Date;
}

export interface PoolData {
  token0Instance: Token;
  token1Instance: Token;
  liquidityPoolAggregator: Pool;
}

export enum LoadPoolDataOrRootCLPoolFailureReason {
  MAPPING_NOT_FOUND = "MAPPING_NOT_FOUND",
  MULTIPLE_MAPPINGS = "MULTIPLE_MAPPINGS",
  LEAF_POOL_NOT_FOUND = "LEAF_POOL_NOT_FOUND",
  SINK_ROOT_POOL = "SINK_ROOT_POOL",
}

export type LoadPoolDataOrRootCLPoolResult =
  | { ok: true; poolData: PoolData }
  | {
      ok: false;
      reason: LoadPoolDataOrRootCLPoolFailureReason.MAPPING_NOT_FOUND;
    }
  | {
      ok: false;
      reason: LoadPoolDataOrRootCLPoolFailureReason.MULTIPLE_MAPPINGS;
    }
  | {
      ok: false;
      reason: LoadPoolDataOrRootCLPoolFailureReason.LEAF_POOL_NOT_FOUND;
    }
  | {
      ok: false;
      reason: LoadPoolDataOrRootCLPoolFailureReason.SINK_ROOT_POOL;
    };

export function isMissingRootPoolMapping(
  result: LoadPoolDataOrRootCLPoolResult,
): result is {
  ok: false;
  reason: LoadPoolDataOrRootCLPoolFailureReason.MAPPING_NOT_FOUND;
} {
  return (
    !result.ok &&
    result.reason === LoadPoolDataOrRootCLPoolFailureReason.MAPPING_NOT_FOUND
  );
}

/**
 * Update the dynamic fee pools data from the swap module.
 * @param liquidityPoolAggregator
 * @param context
 * @param blockNumber
 * @param eventChainId
 * @returns The updated liquidity pool aggregator, or the original if chain mismatch occurs
 */
export async function updateDynamicFeePools(
  liquidityPoolAggregator: Pool,
  context: handlerContext,
  eventChainId: number,
  blockNumber: number,
): Promise<Pool> {
  const poolAddress = liquidityPoolAggregator.poolAddress;
  const chainId = liquidityPoolAggregator.chainId;

  if (chainId !== eventChainId) {
    return liquidityPoolAggregator;
  }

  const factoryAddress = liquidityPoolAggregator.factoryAddress;
  if (!factoryAddress || factoryAddress === "") {
    context.log.warn(
      `[updateDynamicFeePools] Pool ${poolAddress} on chain ${chainId} has no factoryAddress. No update to currentFee will be performed.`,
    );
    return liquidityPoolAggregator;
  }

  // Issue #749: round block to the hour boundary so the effect cache key is
  // stable within an hour. Matches the pattern getTokenPrice uses
  // (src/PriceOracle.ts) and lets preload dual-pass + re-index back-fills
  // hit the cache instead of producing a fresh slot per raw block.
  // Issue #759: clamp the rounded block up to the pool's deployment block so
  // SwapFeeModule reads never land before pool bytecode exists (would revert).
  // The `?? BigInt(blockNumber)` fallback covers legacy pools indexed before
  // the createdBlockNumber field was added (non-genesis-reindex / hot-deploy windows);
  // Number(undefined) would yield NaN and break the Math.max clamp.
  const minBlock = Number(
    liquidityPoolAggregator.createdBlockNumber ?? BigInt(blockNumber),
  );
  const currentFee = await context.effect(getSwapFee, {
    poolAddress,
    factoryAddress,
    chainId,
    blockNumber: roundBlockToInterval(blockNumber, chainId, minBlock),
  });

  if (currentFee === undefined) {
    context.log.warn(
      `[updateDynamicFeePools] Failed to fetch fee for pool ${poolAddress} on chain ${chainId}, skipping update`,
    );
    return liquidityPoolAggregator;
  }

  // Update the current fee in the pool entity
  const updatedPool = {
    ...liquidityPoolAggregator,
    currentFee,
  };

  return updatedPool;
}

/**
 * Updates the state of a Pool with new data and manages snapshots.
 *
 * This function applies a set of changes (diff) to the current state of a liquidity pool
 * aggregator. It updates the last updated timestamp and, when a new epoch boundary is crossed,
 * creates a snapshot of the aggregator's state.
 *
 * @param diff - An object containing the changes to be applied to the current state.
 * @param current - The current state of the liquidity pool aggregator.
 * @param timestamp - The current timestamp when the update is applied.
 * @param context - The handler context used to store the updated state and snapshots.
 * @param eventChainId - The chain ID of the event that triggered the update.
 * @param blockNumber - The block number of the event that triggered the update.
 */
export async function updatePool(
  diff: Partial<PoolDiff>,
  current: Pool,
  timestamp: Date,
  context: handlerContext,
  eventChainId: number,
  blockNumber: number,
) {
  // Invariant check for the parallel-array pair (stakedTickEdges,
  // stakedTickEdgeNets). Writers are supposed to compute both together via
  // applyPositionToEdges (see src/Aggregators/CLStakedLiquidity.ts),
  // but there's nothing in the type system that prevents a future caller
  // from setting one and forgetting the other. Diverging lengths would
  // silently desync the sparse map the swap path binary-searches, so log
  // loudly under the [STAKED_TICK_DRIFT] tag and DROP both fields from the
  // diff — preserving the prior consistent pair is safer than writing a
  // mismatched one. Does not crash the indexer.
  const edgesSet = diff.stakedTickEdges !== undefined;
  const netsSet = diff.stakedTickEdgeNets !== undefined;
  if (edgesSet !== netsSet) {
    context.log.error(
      `[STAKED_TICK_DRIFT][updatePool] stakedTickEdges and stakedTickEdgeNets must be updated together (parallel arrays) for pool ${current.poolAddress} on chain ${current.chainId}. Got edges=${edgesSet ? "set" : "unset"}, nets=${netsSet ? "set" : "unset"}. Dropping both from this update; aggregator retains the prior consistent pair.`,
    );
    diff.stakedTickEdges = undefined;
    diff.stakedTickEdgeNets = undefined;
    // Issue #719: writer-side derivation means diff.stakedLiquidityInRange was
    // computed from the now-rejected edge pair. Drop it too so the clamp block
    // below falls back to current.stakedLiquidityInRange, preserving consistency
    // between the retained edges and the persisted counter.
    diff.stakedLiquidityInRange = undefined;
  } else if (
    edgesSet &&
    netsSet &&
    // biome-ignore lint/style/noNonNullAssertion: edgesSet/netsSet narrow above
    diff.stakedTickEdges!.length !== diff.stakedTickEdgeNets!.length
  ) {
    context.log.error(
      // biome-ignore lint/style/noNonNullAssertion: edgesSet/netsSet narrow above
      `[STAKED_TICK_DRIFT][updatePool] stakedTickEdges/stakedTickEdgeNets length mismatch for pool ${current.poolAddress} on chain ${current.chainId}: edges.length=${diff.stakedTickEdges!.length}, nets.length=${diff.stakedTickEdgeNets!.length}. Dropping both from this update; aggregator retains the prior consistent pair.`,
    );
    diff.stakedTickEdges = undefined;
    diff.stakedTickEdgeNets = undefined;
    // Issue #719: see comment above — keep counter aligned with retained edges.
    diff.stakedLiquidityInRange = undefined;
  }

  // Same invariant check for the TOTAL-liquidity parallel pair (tickEdges,
  // tickEdgeNets), added with #803. CLPool Mint/Burn always set both together
  // via applyPositionToEdges, but — as with the staked pair above — nothing in
  // the type system enforces that on a future caller. A presence/length
  // mismatch would silently desync the sparse map the swap path binary-searches
  // for the fee-free reserve geometry, so log under [TICK_EDGE_DRIFT] and drop
  // both. Unlike the staked counter, `liquidityInRange` is NOT derived from this
  // map (it comes straight from event.params.liquidity), so it is left untouched.
  const totalEdgesSet = diff.tickEdges !== undefined;
  const totalNetsSet = diff.tickEdgeNets !== undefined;
  if (totalEdgesSet !== totalNetsSet) {
    context.log.error(
      `[TICK_EDGE_DRIFT][updatePool] tickEdges and tickEdgeNets must be updated together (parallel arrays) for pool ${current.poolAddress} on chain ${current.chainId}. Got edges=${totalEdgesSet ? "set" : "unset"}, nets=${totalNetsSet ? "set" : "unset"}. Dropping both from this update; aggregator retains the prior consistent pair.`,
    );
    diff.tickEdges = undefined;
    diff.tickEdgeNets = undefined;
  } else if (
    totalEdgesSet &&
    totalNetsSet &&
    // biome-ignore lint/style/noNonNullAssertion: totalEdgesSet/totalNetsSet narrow above
    diff.tickEdges!.length !== diff.tickEdgeNets!.length
  ) {
    context.log.error(
      // biome-ignore lint/style/noNonNullAssertion: totalEdgesSet/totalNetsSet narrow above
      `[TICK_EDGE_DRIFT][updatePool] tickEdges/tickEdgeNets length mismatch for pool ${current.poolAddress} on chain ${current.chainId}: edges.length=${diff.tickEdges!.length}, nets.length=${diff.tickEdgeNets!.length}. Dropping both from this update; aggregator retains the prior consistent pair.`,
    );
    diff.tickEdges = undefined;
    diff.tickEdgeNets = undefined;
  }

  // Clamp reserve0 / reserve1 to >= 0n at the accumulator path (issue #702).
  // Reserves are LP-deposited capital and must never go negative; a Burn
  // larger than the cumulative Mint we observed would otherwise drive the
  // stored field negative permanently, breaking downstream Hasura consumers.
  // Clamp-and-continue (not skip-on-underflow) because reserves are pure
  // derived state; logged under [NEG_RESERVE_GUARD] with prior reserve,
  // delta, and clamped value.
  const reserve0Delta = diff.incrementalReserve0 ?? 0n;
  const reserve0Sum = current.reserve0 + reserve0Delta;
  const clampedReserve0 = reserve0Sum < 0n ? 0n : reserve0Sum;
  if (reserve0Sum < 0n) {
    context.log.warn(
      `[NEG_RESERVE_GUARD][updatePool] field=reserve0 poolAddress=${current.poolAddress} chainId=${current.chainId} priorReserve=${current.reserve0} delta=${reserve0Delta} clampedTo=${clampedReserve0}`,
    );
  }
  const reserve1Delta = diff.incrementalReserve1 ?? 0n;
  const reserve1Sum = current.reserve1 + reserve1Delta;
  const clampedReserve1 = reserve1Sum < 0n ? 0n : reserve1Sum;
  if (reserve1Sum < 0n) {
    context.log.warn(
      `[NEG_RESERVE_GUARD][updatePool] field=reserve1 poolAddress=${current.poolAddress} chainId=${current.chainId} priorReserve=${current.reserve1} delta=${reserve1Delta} clampedTo=${clampedReserve1}`,
    );
  }

  // Clamp totalLiquidityUSD to >= 0n at the accumulator path (issue #856).
  // CL Swap/Burn producers compute currentTotalLiquidityUSD from a synthetic
  // running newReserve0/1 (current ± delta) BEFORE the reserve clamp above,
  // so wei-scale tick-crossing drift can briefly drive that sum negative even
  // though reserves themselves end up clamped to 0n. The negative residue
  // then propagates into totalLiquidityUSD on write. Mirrors the reserve
  // clamp shape — clamp-and-log, never persist a negative.
  const tluReplacement =
    diff.currentTotalLiquidityUSD ?? current.totalLiquidityUSD;
  const clampedTotalLiquidityUSD = tluReplacement < 0n ? 0n : tluReplacement;
  if (tluReplacement < 0n) {
    context.log.warn(
      `[NEG_TLU_GUARD][updatePool] field=totalLiquidityUSD poolAddress=${current.poolAddress} chainId=${current.chainId} priorTLU=${current.totalLiquidityUSD} replacement=${tluReplacement} clampedTo=${clampedTotalLiquidityUSD}`,
    );
  }

  // Clamp stakedLiquidityInRange to >= 0n at the accumulator path (issue #719).
  // The structural fix at the three writer sites derives this field from edge
  // state on every update; this tactical clamp is the belt-and-suspenders that
  // guarantees a negative value can never persist, even if a future caller
  // bypasses derivation or supplies a poisoned diff. Mirrors PR #718's
  // reserve-clamp shape (see [NEG_RESERVE_GUARD] above) — same clamp-and-log
  // pattern, different field.
  const stakedLiqReplacement =
    diff.stakedLiquidityInRange ?? current.stakedLiquidityInRange ?? 0n;
  const clampedStakedLiquidityInRange =
    stakedLiqReplacement < 0n ? 0n : stakedLiqReplacement;
  if (stakedLiqReplacement < 0n) {
    context.log.warn(
      `[NEG_STAKED_LIQ_GUARD][updatePool] field=stakedLiquidityInRange poolAddress=${current.poolAddress} chainId=${current.chainId} priorStakedLiqInRange=${current.stakedLiquidityInRange} replacement=${stakedLiqReplacement} clampedTo=${clampedStakedLiquidityInRange}`,
    );
  }

  // Clamp stakedReserve0 / stakedReserve1 to >= 0n at the accumulator path
  // (issue #771). Per-segment deltas computed in `segmentReserveDelta`
  // are exact-when-rounded (round-half-to-nearest); the residual wei-scale
  // random walk that remains after rounding is the ONLY drift this clamp
  // catches — it is not masking real liquidity imbalance. Mirrors the
  // reserve0/1 clamp above (issue #702) and the stakedLiquidityInRange clamp
  // (issue #719). Logged under [NEG_STAKED_RESERVE_GUARD] so the residual
  // drift remains observable in logs without persisting a negative field.
  //
  // Log LEVEL is split by USD-valued overshoot magnitude (#802): the benign
  // rounding residue (≤ NEG_STAKED_RESERVE_WARN_FLOOR_USD) logs at `info` so
  // it stops spamming the warn channel, while a gross-magnitude overshoot
  // logs at `warn` as a regression tripwire. See the constant's doc comment.
  const stakedReserve0Delta = diff.incrementalStakedReserve0 ?? 0n;
  const stakedReserve0Sum =
    (current.stakedReserve0 ?? 0n) + stakedReserve0Delta;
  const clampedStakedReserve0 = stakedReserve0Sum < 0n ? 0n : stakedReserve0Sum;
  if (stakedReserve0Sum < 0n) {
    await logNegStakedReserveGuard(
      `[NEG_STAKED_RESERVE_GUARD][updatePool] field=stakedReserve0 poolAddress=${current.poolAddress} chainId=${current.chainId} priorStakedReserve=${current.stakedReserve0 ?? 0n} delta=${stakedReserve0Delta} clampedTo=${clampedStakedReserve0}`,
      -stakedReserve0Sum,
      current.token0_id,
      context,
    );
  }
  const stakedReserve1Delta = diff.incrementalStakedReserve1 ?? 0n;
  const stakedReserve1Sum =
    (current.stakedReserve1 ?? 0n) + stakedReserve1Delta;
  const clampedStakedReserve1 = stakedReserve1Sum < 0n ? 0n : stakedReserve1Sum;
  if (stakedReserve1Sum < 0n) {
    await logNegStakedReserveGuard(
      `[NEG_STAKED_RESERVE_GUARD][updatePool] field=stakedReserve1 poolAddress=${current.poolAddress} chainId=${current.chainId} priorStakedReserve=${current.stakedReserve1 ?? 0n} delta=${stakedReserve1Delta} clampedTo=${clampedStakedReserve1}`,
      -stakedReserve1Sum,
      current.token1_id,
      context,
    );
  }

  let updated: Pool = {
    ...current,
    // Handle cumulative fields by adding diff values to current values
    reserve0: clampedReserve0,
    reserve1: clampedReserve1,
    totalLPTokenSupply:
      (diff.incrementalTotalLPSupply ?? 0n) + current.totalLPTokenSupply,
    totalLiquidityUSD: clampedTotalLiquidityUSD,
    totalVolume0: (diff.incrementalTotalVolume0 ?? 0n) + current.totalVolume0,
    totalVolume1: (diff.incrementalTotalVolume1 ?? 0n) + current.totalVolume1,
    totalVolumeUSD:
      (diff.incrementalTotalVolumeUSD ?? 0n) + current.totalVolumeUSD,
    totalFeesGenerated0:
      (diff.incrementalTotalFeesGenerated0 ?? 0n) + current.totalFeesGenerated0,
    totalFeesGenerated1:
      (diff.incrementalTotalFeesGenerated1 ?? 0n) + current.totalFeesGenerated1,
    totalFeesGeneratedUSD:
      (diff.incrementalTotalFeesGeneratedUSD ?? 0n) +
      current.totalFeesGeneratedUSD,
    // Unstaked fees (from Collect events - LPs that didn't stake)
    totalUnstakedFeesCollected0:
      (diff.incrementalTotalUnstakedFeesCollected0 ?? 0n) +
      current.totalUnstakedFeesCollected0,
    totalUnstakedFeesCollected1:
      (diff.incrementalTotalUnstakedFeesCollected1 ?? 0n) +
      current.totalUnstakedFeesCollected1,
    totalUnstakedFeesCollectedUSD:
      (diff.incrementalTotalUnstakedFeesCollectedUSD ?? 0n) +
      current.totalUnstakedFeesCollectedUSD,
    // Staked fees (from CollectFees events - LPs that staked in gauge)
    totalStakedFeesCollected0:
      (diff.incrementalTotalStakedFeesCollected0 ?? 0n) +
      current.totalStakedFeesCollected0,
    totalStakedFeesCollected1:
      (diff.incrementalTotalStakedFeesCollected1 ?? 0n) +
      current.totalStakedFeesCollected1,
    totalStakedFeesCollectedUSD:
      (diff.incrementalTotalStakedFeesCollectedUSD ?? 0n) +
      current.totalStakedFeesCollectedUSD,
    numberOfSwaps:
      (diff.incrementalNumberOfSwaps ?? 0n) + current.numberOfSwaps,
    totalEmissions:
      (diff.incrementalTotalEmissions ?? 0n) + current.totalEmissions,
    totalEmissionsUSD:
      (diff.incrementalTotalEmissionsUSD ?? 0n) + current.totalEmissionsUSD,
    totalEmissionsRedistributed:
      (diff.incrementalTotalEmissionsRedistributed ?? 0n) +
      current.totalEmissionsRedistributed,
    totalEmissionsForfeited:
      (diff.incrementalTotalEmissionsForfeited ?? 0n) +
      current.totalEmissionsForfeited,
    totalFlashLoanFees0:
      (diff.incrementalTotalFlashLoanFees0 ?? 0n) +
      (current.totalFlashLoanFees0 ?? 0n),
    totalFlashLoanFees1:
      (diff.incrementalTotalFlashLoanFees1 ?? 0n) +
      (current.totalFlashLoanFees1 ?? 0n),
    totalFlashLoanFeesUSD:
      (diff.incrementalTotalFlashLoanFeesUSD ?? 0n) +
      (current.totalFlashLoanFeesUSD ?? 0n),
    totalFlashLoanVolumeUSD:
      (diff.incrementalTotalFlashLoanVolumeUSD ?? 0n) +
      (current.totalFlashLoanVolumeUSD ?? 0n),
    numberOfFlashLoans:
      (diff.incrementalNumberOfFlashLoans ?? 0n) +
      (current.numberOfFlashLoans ?? 0n),

    // Gauge fields - all cumulative
    numberOfGaugeDeposits:
      (diff.incrementalNumberOfGaugeDeposits ?? 0n) +
      current.numberOfGaugeDeposits,
    numberOfGaugeWithdrawals:
      (diff.incrementalNumberOfGaugeWithdrawals ?? 0n) +
      current.numberOfGaugeWithdrawals,
    numberOfGaugeRewardClaims:
      (diff.incrementalNumberOfGaugeRewardClaims ?? 0n) +
      current.numberOfGaugeRewardClaims,
    totalGaugeRewardsClaimedUSD:
      (diff.incrementalTotalGaugeRewardsClaimedUSD ?? 0n) +
      current.totalGaugeRewardsClaimedUSD,
    totalGaugeRewardsClaimed:
      (diff.incrementalTotalGaugeRewardsClaimed ?? 0n) +
      current.totalGaugeRewardsClaimed,
    currentLiquidityStaked:
      (diff.incrementalCurrentLiquidityStaked ?? 0n) +
      current.currentLiquidityStaked,
    currentLiquidityStakedUSD:
      diff.currentLiquidityStakedUSD ?? current.currentLiquidityStakedUSD,

    // Handle non-cumulative fields (prices, timestamps, etc.) - use diff values directly
    token0Price: diff.token0Price ?? current.token0Price,
    token1Price: diff.token1Price ?? current.token1Price,
    gaugeIsAlive: diff.gaugeIsAlive ?? current.gaugeIsAlive,
    gaugeAddress: diff.gaugeAddress ?? current.gaugeAddress,
    bribeVotingRewardAddress:
      diff.bribeVotingRewardAddress ?? current.bribeVotingRewardAddress,
    feeVotingRewardAddress:
      diff.feeVotingRewardAddress ?? current.feeVotingRewardAddress,
    feeProtocol0: diff.feeProtocol0 ?? current.feeProtocol0,
    feeProtocol1: diff.feeProtocol1 ?? current.feeProtocol1,
    observationCardinalityNext:
      diff.observationCardinalityNext ?? current.observationCardinalityNext,
    sqrtPriceX96: diff.sqrtPriceX96 ?? current.sqrtPriceX96,
    tick: diff.tick ?? current.tick,
    // Issue #703: Swap is authoritative (absolute write captures any tick
    // crossings); in-range Mint/Burn supply an incremental delta so L changes
    // are reflected without waiting for the next swap. Absolute wins if both
    // are set in the same diff. `current.liquidityInRange` is nullable on the
    // entity (see schema.graphql:50); coalesce to 0n so a pre-first-swap pool
    // can still accept Mint/Burn increments.
    liquidityInRange:
      diff.liquidityInRange ??
      (diff.incrementalLiquidityInRange ?? 0n) +
        (current.liquidityInRange ?? 0n),
    stakedLiquidityInRange: clampedStakedLiquidityInRange,
    stakedReserve0: clampedStakedReserve0,
    stakedReserve1: clampedStakedReserve1,
    // Monotonic latch: once a pool has ever been staked, hasStakes stays true
    // even if the diff doesn't explicitly re-assert it.
    hasStakes: current.hasStakes || (diff.hasStakes ?? false),
    // Replace semantics: if the diff provides a new edge list, use it directly.
    // Producers compute the post-edit arrays from `current.stakedTickEdges`/
    // `current.stakedTickEdgeNets` and must replace both together (parallel arrays).
    stakedTickEdges: diff.stakedTickEdges ?? current.stakedTickEdges,
    stakedTickEdgeNets: diff.stakedTickEdgeNets ?? current.stakedTickEdgeNets,
    tickEdges: diff.tickEdges ?? current.tickEdges,
    tickEdgeNets: diff.tickEdgeNets ?? current.tickEdgeNets,
    totalVotesDeposited:
      diff.totalVotesDeposited ?? current.totalVotesDeposited,
    totalVotesDepositedUSD:
      diff.totalVotesDepositedUSD ?? current.totalVotesDepositedUSD,

    // Voting Reward Claims - cumulative USD aggregate (raw token-unit sum dropped in #813)
    totalBribeClaimedUSD:
      (diff.incrementalTotalBribeClaimedUSD ?? 0n) +
      current.totalBribeClaimedUSD,
    totalFeeRewardClaimedUSD:
      (diff.incrementalTotalFeeRewardClaimedUSD ?? 0n) +
      current.totalFeeRewardClaimedUSD,
    veNFTamountStaked: diff.veNFTamountStaked ?? current.veNFTamountStaked,

    // Dynamic Fee fields - non-cumulative
    baseFee: diff.baseFee ?? current.baseFee,
    currentFee: diff.currentFee ?? current.currentFee,
    feeCap: diff.feeCap ?? current.feeCap,
    scalingFactor: diff.scalingFactor ?? current.scalingFactor,

    // Unstaked Fee fields - non-cumulative, last-writer-wins across UnstakedFeeModule instances
    unstakedFee: diff.unstakedFee ?? current.unstakedFee,

    lastUpdatedTimestamp: timestamp,
  };

  // Snapshot only when we've entered a new epoch (hour); use epoch-aligned timestamp so we don't drift
  if (shouldSnapshot(current.lastSnapshotTimestamp, timestamp)) {
    // Only update dynamic fees for CL pools (they use dynamic fee modules)
    // Non-CL pools have their fees fixed at a certain constant level. It can change over time, but we fetch that change
    // through events.
    if (updated.isCL) {
      updated = {
        ...updated,
        ...(await updateDynamicFeePools(
          updated,
          context,
          eventChainId,
          blockNumber,
        )),
      };

      // Compute CL staked USD from running staked reserves — O(1) instead of O(N) position scan
      const stakedReserve0 = updated.stakedReserve0 ?? 0n;
      const stakedReserve1 = updated.stakedReserve1 ?? 0n;
      if (stakedReserve0 <= 0n && stakedReserve1 <= 0n) {
        updated = { ...updated, currentLiquidityStakedUSD: 0n };
      } else {
        const [token0Instance, token1Instance] = await Promise.all([
          getRehydrated(context.Token, "Token", updated.token0_id),
          getRehydrated(context.Token, "Token", updated.token1_id),
        ]);
        updated = {
          ...updated,
          currentLiquidityStakedUSD: calculateTotalUSD(
            stakedReserve0 > 0n ? stakedReserve0 : 0n,
            stakedReserve1 > 0n ? stakedReserve1 : 0n,
            token0Instance ?? undefined,
            token1Instance ?? undefined,
          ),
        };
      }
    }

    setPoolSnapshot(updated, timestamp, context);

    // Soft invariant (issue #670): real swap fee tiers cap at ~1% of volume,
    // so totalFeesGeneratedUSD > 5% of totalVolumeUSD signals fee/volume
    // USD-path divergence (precision mismatch, double-counting, wrong fee
    // tier). Logged once per snapshot epoch (≤1/hour per pool) so the signal
    // stays visible in recent logs while the drift persists, without
    // flooding and without aborting the indexer or mutating state.
    if (
      updated.totalVolumeUSD > 0n &&
      updated.totalFeesGeneratedUSD * 20n > updated.totalVolumeUSD
    ) {
      context.log.warn(
        `[FEE_VOLUME_DIVERGENCE][updatePool] Pool ${current.poolAddress} on chain ${current.chainId} totalFeesGeneratedUSD (${updated.totalFeesGeneratedUSD}) exceeds 5% of totalVolumeUSD (${updated.totalVolumeUSD}). Real fee tiers cap at ~1%; this likely indicates a fee/volume USD-path divergence.`,
      );
    }

    // Only set lastSnapshotTimestamp when we actually created a snapshot (epoch boundary)
    updated = {
      ...updated,
      lastSnapshotTimestamp: getSnapshotEpoch(timestamp),
    };
  }

  context.Pool.set(updated);
}

/**
 * Common pool data loading and validation logic
 * Loads liquidity pool aggregator and token instances, handles errors
 * If blockNumber and blockTimestamp are provided, token prices will be refreshed
 * (refreshTokenPrice will decide internally if refresh is needed)
 *
 * @param poolAddress - The pool address
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param blockNumber - Optional block number for price refresh
 * @param blockTimestamp - Optional block timestamp for price refresh
 */
export async function loadPoolData(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  blockNumber?: number,
  blockTimestamp?: number,
): Promise<PoolData | null> {
  const poolId = PoolId(chainId, poolAddress);
  // Load liquidity pool aggregator and token instances efficiently
  const liquidityPoolAggregator = await getRehydrated(
    context.Pool,
    "Pool",
    poolId,
  );

  // Load token instances concurrently using the pool's token IDs
  const [token0Instance, token1Instance] = await Promise.all([
    liquidityPoolAggregator
      ? getRehydrated(context.Token, "Token", liquidityPoolAggregator.token0_id)
      : Promise.resolve(undefined),
    liquidityPoolAggregator
      ? getRehydrated(context.Token, "Token", liquidityPoolAggregator.token1_id)
      : Promise.resolve(undefined),
  ]);

  // Handle missing data errors
  if (!liquidityPoolAggregator) {
    context.log.error(
      `[loadPoolData] Pool ${poolId} not found on chain ${chainId}`,
    );
    return null;
  }

  if (!token0Instance || !token1Instance) {
    context.log.error(
      `[loadPoolData] Token not found for pool ${poolId} on chain ${chainId}`,
    );
    return null;
  }

  // Refresh token prices if block data is provided
  // refreshTokenPrice will decide internally if refresh is needed and handles block rounding
  let updatedToken0 = token0Instance;
  let updatedToken1 = token1Instance;
  if (blockNumber !== undefined && blockTimestamp !== undefined) {
    // Pool-implied ground-truth hints (#784/#785): each token's oracle read is
    // cross-checked against the *other* leg's trusted USD price derived from
    // pool state (sqrtPriceX96 / reserves via the stored token0Price /
    // token1Price). Inert (0n) when the counterparty fails the trust gate, so
    // pools without a trusted leg behave exactly as before.
    const token0Hint = getPoolImpliedUSD(
      liquidityPoolAggregator.token0Price,
      token1Instance,
    );
    const token1Hint = getPoolImpliedUSD(
      liquidityPoolAggregator.token1Price,
      token0Instance,
    );

    // Wrap each refresh in a promise that catches errors individually
    const token0Refresh = refreshTokenPrice(
      token0Instance,
      blockNumber,
      blockTimestamp,
      chainId,
      context,
      token0Hint,
    ).catch((error) => {
      context.log.error(
        `[loadPoolData] Error refreshing token0 price for ${token0Instance.address} on chain ${chainId}: ${error}`,
      );
      return token0Instance; // Return original on error
    });

    const token1Refresh = refreshTokenPrice(
      token1Instance,
      blockNumber,
      blockTimestamp,
      chainId,
      context,
      token1Hint,
    ).catch((error) => {
      context.log.error(
        `[loadPoolData] Error refreshing token1 price for ${token1Instance.address} on chain ${chainId}: ${error}`,
      );
      return token1Instance; // Return original on error
    });

    [updatedToken0, updatedToken1] = await Promise.all([
      token0Refresh,
      token1Refresh,
    ]);
  }

  return {
    liquidityPoolAggregator,
    token0Instance: updatedToken0,
    token1Instance: updatedToken1,
  };
}

/**
 * Attempts to load pool data, and if not found, checks if it's a RootCLPool
 * and loads the corresponding leaf pool data instead.
 *
 * @param poolAddress - The pool address to load
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param blockNumber - Optional block number for price refresh
 * @param blockTimestamp - Optional block timestamp for price refresh
 * @returns Discriminated result: ok + poolData, or ok false with reason (MAPPING_NOT_FOUND, MULTIPLE_MAPPINGS, LEAF_POOL_NOT_FOUND)
 */
export async function loadPoolDataOrRootCLPool(
  poolAddress: string,
  chainId: number,
  context: handlerContext,
  blockNumber?: number,
  blockTimestamp?: number,
): Promise<LoadPoolDataOrRootCLPoolResult> {
  if (isKnownSinkRootPool(chainId, poolAddress)) {
    return {
      ok: false,
      reason: LoadPoolDataOrRootCLPoolFailureReason.SINK_ROOT_POOL,
    };
  }

  const rootPoolLeafPools =
    (await context.RootPool_LeafPool.getWhere({
      rootPoolAddress: { _eq: poolAddress },
    })) ?? [];

  if (rootPoolLeafPools.length === 0) {
    const poolData = await loadPoolData(
      poolAddress,
      chainId,
      context,
      blockNumber,
      blockTimestamp,
    );

    if (poolData) {
      return { ok: true, poolData };
    }

    return {
      ok: false,
      reason: LoadPoolDataOrRootCLPoolFailureReason.MAPPING_NOT_FOUND,
    };
  }

  if (rootPoolLeafPools.length !== 1) {
    context.log.error(
      `[loadPoolDataOrRootCLPool] Expected exactly one RootPool_LeafPool for pool ${poolAddress} on chain ${chainId}`,
    );
    return {
      ok: false,
      reason: LoadPoolDataOrRootCLPoolFailureReason.MULTIPLE_MAPPINGS,
    };
  }

  const rootPoolLeafPool = rootPoolLeafPools[0];
  const leafPoolAddress = rootPoolLeafPool.leafPoolAddress;
  const leafChainId = rootPoolLeafPool.leafChainId;
  // Don't pass blockNumber/blockTimestamp: they belong to the caller's chain
  // and cannot be used for RPC queries on the leaf chain.
  const leafPoolData = await loadPoolData(
    leafPoolAddress,
    leafChainId,
    context,
  );

  if (!leafPoolData) {
    context.log.error(
      `[loadPoolDataOrRootCLPool] Leaf pool data not found for pool ${leafPoolAddress} on chain ${leafChainId}`,
    );
    return {
      ok: false,
      reason: LoadPoolDataOrRootCLPoolFailureReason.LEAF_POOL_NOT_FOUND,
    };
  }

  return { ok: true, poolData: leafPoolData };
}

/**
 * Generic function to find a pool by any indexed address field
 * @param address - The address to search for
 * @param chainId - The chain ID
 * @param context - The handler context
 * @param field - The field to search by
 * @returns The pool entity if found, null otherwise
 */
export async function findPoolByField(
  address: string,
  chainId: number,
  context: handlerContext,
  field: PoolAddressField,
): Promise<Pool | null> {
  const pools = await getWhereRehydrated(context.Pool, "Pool", {
    [field]: { _eq: address },
  });

  const matchingPool = (pools ?? []).find(
    (pool: Pool) => pool.chainId === chainId,
  );
  return matchingPool ?? null;
}

/**
 * Find a pool by its gauge address using direct database query
 * @param gaugeAddress - The gauge address to search for
 * @param chainId - The chain ID
 * @param context - The handler context
 * @returns The pool entity if found, null otherwise
 */
export async function findPoolByGaugeAddress(
  gaugeAddress: string,
  chainId: number,
  context: handlerContext,
): Promise<Pool | null> {
  return findPoolByField(
    gaugeAddress,
    chainId,
    context,
    PoolAddressField.GAUGE_ADDRESS,
  );
}

/**
 * Creates a new Pool entity with default values
 * @param params - Parameters for creating the pool entity
 * @returns A new Pool entity
 */
export function createPoolEntity(params: {
  poolAddress: string;
  chainId: number;
  isCL: boolean;
  isStable: boolean;
  token0Address: string;
  token1Address: string;
  token0Symbol: string;
  token1Symbol: string;
  timestamp: Date;
  tickSpacing?: number; // For CL pools
  CLGaugeConfig?: CLGaugeConfig | null; // For CL pools
  factoryAddress: string; // Address of the factory that created this pool (e.g. CLFactory for CL pools)
  // Address of the NFPM contract that mints positions for this pool (CL only; null for V2).
  // Resolved by nfpmForCLPool() at the PoolCreated handler; threaded here so downstream
  // consumers (gauges, user-stats, NFPM handlers) can look up positions without a separate scan.
  nfpmAddress?: string | null;
  baseFee: bigint;
  currentFee: bigint;
  // Block at which the pool was deployed (PoolCreated.event.block.number).
  // Stamped once at creation and used by updateDynamicFeePools to clamp
  // hour-rounded SwapFeeModule reads above the pool's bytecode boundary (#759).
  createdBlockNumber: bigint;
}): Pool {
  const {
    poolAddress,
    chainId,
    isCL,
    isStable,
    token0Address,
    token1Address,
    token0Symbol,
    token1Symbol,
    timestamp,
    tickSpacing,
    CLGaugeConfig,
    factoryAddress,
    nfpmAddress,
    baseFee,
    currentFee,
    createdBlockNumber,
  } = params;

  return {
    id: PoolId(chainId, poolAddress),
    poolAddress: poolAddress,
    chainId: chainId,
    isCL: isCL,
    name: generatePoolName(
      token0Symbol,
      token1Symbol,
      isStable,
      isCL ? (tickSpacing ?? 0) : 0,
    ),
    token0_id: TokenId(chainId, token0Address),
    token1_id: TokenId(chainId, token1Address),
    token0_address: token0Address,
    token1_address: token1Address,
    isStable: isStable,
    createdBlockNumber: createdBlockNumber,
    tickSpacing: tickSpacing ? BigInt(tickSpacing) : 0n, // 0 for non-CL pools
    reserve0: 0n,
    reserve1: 0n,
    totalLPTokenSupply: 0n,
    totalLiquidityUSD: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalFeesGenerated0: 0n,
    totalFeesGenerated1: 0n,
    totalFeesGeneratedUSD: 0n,
    totalUnstakedFeesCollected0: 0n,
    totalUnstakedFeesCollected1: 0n,
    totalStakedFeesCollected0: 0n,
    totalStakedFeesCollected1: 0n,
    totalUnstakedFeesCollectedUSD: 0n,
    totalStakedFeesCollectedUSD: 0n,
    numberOfSwaps: 0n,
    token0Price: 0n,
    token1Price: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalEmissionsRedistributed: 0n,
    totalEmissionsForfeited: 0n,
    totalVotesDeposited: 0n,
    totalVotesDepositedUSD: 0n,
    gaugeIsAlive: false,
    lastUpdatedTimestamp: timestamp,
    // Epoch 0 so first update in any hour triggers a snapshot (shouldSnapshot sees "never snapshotted" for this epoch)
    lastSnapshotTimestamp: new Date(0),
    // CL Pool specific fields (set to 0 for regular pools)
    feeProtocol0: 0n,
    feeProtocol1: 0n,
    observationCardinalityNext: 0n,
    sqrtPriceX96: 0n,
    tick: 0n,
    liquidityInRange: 0n,
    stakedLiquidityInRange: 0n,
    stakedReserve0: 0n,
    stakedReserve1: 0n,
    hasStakes: false,
    stakedTickEdges: [],
    stakedTickEdgeNets: [],
    tickEdges: [],
    tickEdgeNets: [],
    totalFlashLoanFees0: 0n,
    totalFlashLoanFees1: 0n,
    totalFlashLoanFeesUSD: 0n,
    totalFlashLoanVolumeUSD: 0n,
    numberOfFlashLoans: 0n,
    // Gauge fields
    numberOfGaugeDeposits: 0n,
    numberOfGaugeWithdrawals: 0n,
    numberOfGaugeRewardClaims: 0n,
    totalGaugeRewardsClaimedUSD: 0n,
    totalGaugeRewardsClaimed: 0n,
    currentLiquidityStaked: 0n,
    currentLiquidityStakedUSD: 0n,
    // Voting Reward fields
    bribeVotingRewardAddress: "",
    totalBribeClaimedUSD: 0n,
    feeVotingRewardAddress: "",
    totalFeeRewardClaimedUSD: 0n,
    veNFTamountStaked: 0n,
    // Pool Launcher relationship (undefined for pools not launched via PoolLauncher)
    poolLauncherPoolId: undefined,
    // Address of the factory that created this pool (e.g. CLFactory for CL pools)
    factoryAddress: factoryAddress,
    // Address of the NFPM for this CL pool (null for V2). See nfpmForCLPool in Constants.ts.
    nfpmAddress: nfpmAddress ?? undefined,
    // Voting fields
    gaugeAddress: "",
    // Set to undefined if CLGaugeConfig does not exist (i.e before the deployment of CLGaugeFactoryV2 which introduces emissions caps per gauge).
    // Otherwise, set to defaultEmissionsCap (the chain-wide default captured at pool creation time).
    gaugeEmissionsCap: CLGaugeConfig
      ? CLGaugeConfig.defaultEmissionsCap
      : isCL
        ? undefined
        : 0n,
    // Seed per-pool min stake lockup from the chain-wide default; 0 before CLGaugeFactoryV3's SetDefaultMinStakeTime has fired.
    // SetPoolMinStakeTime can override this per-pool later.
    minStakeTime: CLGaugeConfig?.defaultMinStakeTime ?? 0n,
    // Dynamic Fee fields
    baseFee: baseFee,
    feeCap: undefined,
    scalingFactor: undefined,
    currentFee: currentFee,
    // Unstaked Fee fields - populated by UnstakedFeeModule / CustomUnstakedFeeModule events.
    unstakedFee: undefined,
    rootPoolMatchingHash: `${chainId}_${token0Address}_${token1Address}_${(tickSpacing ? BigInt(tickSpacing) : 0n).toString()}`,
  };
}
