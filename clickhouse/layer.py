"""Entity mappings of the analytics layer: envio history table -> typed storage table.

Every storage table is a ReplacingMergeTree(_version, _deleted) fed from an envio
`envio_history_<Entity>` table. `_version` is envio's `envio_checkpoint_id`, `_deleted` is
`envio_change = 'DELETE'`. Each column is declared once, with a *kind* that fixes three things:
its ClickHouse type, the expression that converts the envio column (String for every BigInt
above precision 38), and the expression that turns the stored value back into envio's text,
which `verify` uses to prove the table equals argMax over the history.

Kinds
  str      String / Nullable(String), unchanged
  addr     address, lowercased
  big      BigInt stored by envio as String (precision > 38) -> Int256 (exact)
  count    BigInt counter stored as String -> UInt64
  dec      BigInt with precision <= 38, stored by envio as Decimal(P, 0) -> Int64
  int32 / bool / time
           passed through (Int32, Bool, DateTime64(3, 'UTC'))
  u64list  [BigInt!]! (Array(String)) -> Array(UInt64)
  biglist / addrlist / strlist
           [BigInt!]! -> Array(Int256); [String!]! -> Array(String), addresses lowercased
  idpart   a part of the entity id (chain id, address, token id); always set, also on DELETE rows
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# An Int256 holds every integer below 5.79e76. envio's Postgres column is numeric(76, 0), so a
# value it accepted has at most 76 digits and always fits; the guard turns anything longer
# (an unbounded BigInt) into 0 instead of letting toInt256 wrap around, and `verify` reports it.
BIG = "if(length({c}) - startsWith({c}, '-') <= 76, toInt256OrZero({c}), toInt256(0))"
COUNT = "if(length({c}) <= 19, toUInt64OrZero({c}), toUInt64(0))"


@dataclass
class Col:
    name: str
    kind: str
    src: str | None = None  # envio field; None for kind idpart with a custom expression
    expr: str | None = None  # custom conversion (idpart, optional fields)
    fallback: str | None = None  # expression used when the envio column does not exist (older schema)
    # envio-side value to compare with, when not simply `src`; a template whose {field}s name
    # envio columns of the expected (argMax) side
    verify_src: str | None = None
    ch_type: str | None = None  # override of the kind's type
    optional: bool = False  # left out when the source table lacks it (mapped from schema.graphql)


@dataclass
class Entity:
    key: str  # short name
    table: str  # storage table in the analytics database
    source: str  # envio entity name; history table is envio_history_<source>
    order_by: str
    columns: list[Col]
    # 'latest': one row per id (current state). 'hour' / 'day': one row per id per period,
    # holding the last version written in that period (end-of-period state).
    mode: str = "latest"
    # Series only: fields whose value at the end of the pool's previous period is stored next to
    # the current one (prev_<field>), so a period's flow is field - prev_field without a window
    # function (ClickHouse does not push filters through window functions).
    prev_fields: list[str] = field(default_factory=list)
    period_expr: str = ""
    indexes: list[str] = field(default_factory=list)  # skipping indexes
    partition_extra: str = ""  # leading partition expression (for time series)
    description: str = ""
    nullable: set[str] = field(default_factory=set)
    # Series only: the key of one series (the id's natural key); the period is added to it.
    series_key: str = "chain_id, pool_address"


def id_part(n: int) -> str:
    return f"splitByChar('-', id)[{n}]"


def vid(n: int) -> str:
    """id part inside a verify template ({name} fields are envio columns of the expected side)."""
    return "splitByChar('-', {id})[" + str(n) + "]"


CHAIN_FROM_ID = Col("chain_id", "idpart", expr=f"toInt32OrZero({id_part(1)})", ch_type="Int32", verify_src="toInt32({chainId})")


def pool_cols() -> list[Col]:
    b = lambda n, s: Col(n, "big", s)  # noqa: E731
    c = lambda n, s: Col(n, "count", s)  # noqa: E731
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("pool_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String", verify_src="lower({poolAddress})"),
        Col("name", "str", "name"),
        Col("token0_address", "addr", "token0_address"),
        Col("token1_address", "addr", "token1_address"),
        Col("is_stable", "bool", "isStable"),
        Col("is_cl", "bool", "isCL"),
        Col("deployment", "str", "deployment", fallback="if(chainId = 8453, 'AERODROME', 'VELODROME')", ch_type="LowCardinality(String)"),
        c("created_block", "createdBlockNumber"),
        Col("tick_spacing", "dec", "tickSpacing"),
        b("reserve0", "reserve0"),
        b("reserve1", "reserve1"),
        b("total_lp_supply", "totalLPTokenSupply"),
        b("tvl_usd", "totalLiquidityUSD"),
        b("volume0", "totalVolume0"),
        b("volume1", "totalVolume1"),
        b("volume_usd", "totalVolumeUSD"),
        b("fees0", "totalFeesGenerated0"),
        b("fees1", "totalFeesGenerated1"),
        b("fees_usd", "totalFeesGeneratedUSD"),
        b("unstaked_fees_collected0", "totalUnstakedFeesCollected0"),
        b("unstaked_fees_collected1", "totalUnstakedFeesCollected1"),
        b("staked_fees_collected0", "totalStakedFeesCollected0"),
        b("staked_fees_collected1", "totalStakedFeesCollected1"),
        b("unstaked_fees_collected_usd", "totalUnstakedFeesCollectedUSD"),
        b("staked_fees_collected_usd", "totalStakedFeesCollectedUSD"),
        c("swaps", "numberOfSwaps"),
        c("swap_fee_fallbacks", "numberOfSwapFeeFallbacks"),
        b("token0_price", "token0Price"),
        b("token1_price", "token1Price"),
        # Legacy vote weight on the pool (veToken units). envio's totalVotesDeposited is not a
        # vote weight but the gauge's reward-token balance at its last DistributeReward.
        b("votes", "veNFTamountStaked"),
        b("gauge_reward_balance", "totalVotesDeposited"),
        b("gauge_reward_balance_usd", "totalVotesDepositedUSD"),
        b("emissions", "totalEmissions"),
        b("emissions_usd", "totalEmissionsUSD"),
        b("emissions_redistributed", "totalEmissionsRedistributed"),
        b("emissions_forfeited", "totalEmissionsForfeited"),
        Col("last_updated", "time", "lastUpdatedTimestamp"),
        Col("last_snapshot", "time", "lastSnapshotTimestamp"),
        b("fee_protocol0", "feeProtocol0"),
        b("fee_protocol1", "feeProtocol1"),
        c("observation_cardinality_next", "observationCardinalityNext"),
        b("sqrt_price_x96", "sqrtPriceX96"),
        Col("tick", "dec", "tick"),
        b("liquidity_in_range", "liquidityInRange"),
        b("staked_liquidity_in_range", "stakedLiquidityInRange"),
        b("staked_reserve0", "stakedReserve0"),
        b("staked_reserve1", "stakedReserve1"),
        Col("has_stakes", "bool", "hasStakes"),
        b("flash_loan_fees0", "totalFlashLoanFees0"),
        b("flash_loan_fees1", "totalFlashLoanFees1"),
        b("flash_loan_fees_usd", "totalFlashLoanFeesUSD"),
        b("flash_loan_volume_usd", "totalFlashLoanVolumeUSD"),
        c("flash_loans", "numberOfFlashLoans"),
        Col("gauge_is_alive", "bool", "gaugeIsAlive"),
        Col("gauge_address", "addr", "gaugeAddress"),
        b("gauge_emissions_cap", "gaugeEmissionsCap"),
        Col("min_stake_time", "dec", "minStakeTime"),
        c("gauge_deposits", "numberOfGaugeDeposits"),
        c("gauge_withdrawals", "numberOfGaugeWithdrawals"),
        c("gauge_reward_claims", "numberOfGaugeRewardClaims"),
        b("gauge_rewards_claimed_usd", "totalGaugeRewardsClaimedUSD"),
        b("gauge_rewards_claimed", "totalGaugeRewardsClaimed"),
        b("staked_liquidity", "currentLiquidityStaked"),
        b("staked_usd", "currentLiquidityStakedUSD"),
        Col("bribe_voting_reward_address", "addr", "bribeVotingRewardAddress"),
        b("bribes_claimed_usd", "totalBribeClaimedUSD"),
        Col("fee_voting_reward_address", "addr", "feeVotingRewardAddress"),
        b("fee_rewards_claimed_usd", "totalFeeRewardClaimedUSD"),
        b("venft_amount_staked", "veNFTamountStaked"),
        Col("base_fee", "dec", "baseFee"),
        b("fee_cap", "feeCap"),
        b("scaling_factor", "scalingFactor"),
        b("current_fee", "currentFee"),
        Col("unstaked_fee", "dec", "unstakedFee"),
        Col("pool_launcher_pool_id", "str", "poolLauncherPoolId"),
        Col("factory_address", "addr", "factoryAddress"),
        Col("nfpm_address", "addr", "nfpmAddress"),
        Col("root_pool_matching_hash", "str", "rootPoolMatchingHash"),
    ]


# Pool fields carried into the hourly / daily series: cumulative counters (deltas give the
# period's flow) and levels (the end-of-period state).
SERIES_FIELDS = [
    "id", "chain_id", "pool_address", "deployment", "is_stable", "is_cl",
    "reserve0", "reserve1", "total_lp_supply", "tvl_usd",
    "volume0", "volume1", "volume_usd", "fees0", "fees1", "fees_usd", "swaps",
    "unstaked_fees_collected_usd", "staked_fees_collected_usd",
    "token0_price", "token1_price", "votes", "gauge_reward_balance", "gauge_reward_balance_usd",
    "emissions", "emissions_usd", "gauge_rewards_claimed", "gauge_rewards_claimed_usd",
    "bribes_claimed_usd", "fee_rewards_claimed_usd",
    "flash_loan_volume_usd", "flash_loan_fees_usd", "flash_loans",
    "sqrt_price_x96", "tick", "liquidity_in_range", "staked_liquidity_in_range",
    "staked_reserve0", "staked_reserve1", "staked_liquidity", "staked_usd",
    "current_fee", "last_updated",
]


PREV_FIELDS = [
    "tvl_usd", "staked_usd", "volume_usd", "volume0", "volume1", "fees_usd", "swaps",
    "unstaked_fees_collected_usd", "staked_fees_collected_usd", "emissions", "emissions_usd",
    "gauge_rewards_claimed_usd", "bribes_claimed_usd", "fee_rewards_claimed_usd", "flash_loan_volume_usd",
]


def series_cols() -> list[Col]:
    by_name = {c.name: c for c in pool_cols()}
    return [by_name[n] for n in SERIES_FIELDS]


ROOT_PREV_FIELDS = ["emissions", "emissions_usd", "distributions"]


def root_pool_series_cols() -> list[Col]:
    """RootPool fields carried into the root pool series (id `{chainId}-{rootPoolAddress}`)."""
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("root_pool_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String",
            verify_src="lower({rootPoolAddress})"),
        Col("gauge_is_alive", "bool", "gaugeIsAlive"),
        Col("votes", "big", "veNFTamountStaked"),
        Col("emissions", "big", "totalEmissions"),
        Col("emissions_usd", "big", "totalEmissionsUSD"),
        Col("distributions", "count", "numberOfDistributions"),
        Col("last_updated", "time", "lastUpdatedTimestamp"),
    ]


def token_cols() -> list[Col]:
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("token_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String", verify_src="lower({address})"),
        Col("symbol", "str", "symbol"),
        Col("name", "str", "name"),
        Col("decimals", "count", "decimals", ch_type="UInt8", expr="toUInt8OrZero(toString(decimals))"),
        Col("price_usd", "big", "pricePerUSDNew"),
        Col("last_price_refresh", "time", "lastUpdatedTimestamp"),
        Col("last_successful_price", "time", "lastSuccessfulPriceTimestamp"),
        Col("pricing_depth_usd", "big", "pricingDepthUSD"),
        Col("is_whitelisted", "bool", "isWhitelisted"),
        Col("is_listed_on_aero", "bool", "isListedOnAero", fallback="CAST(NULL AS Nullable(Bool))", ch_type="Nullable(Bool)"),
        Col("price_trust_outcome", "str", "priceTrustOutcome", ch_type="LowCardinality(Nullable(String))"),
        Col("price_trust_reason", "str", "priceTrustReason", ch_type="LowCardinality(Nullable(String))"),
    ]


def user_pool_cols() -> list[Col]:
    b = lambda n, s: Col(n, "big", s)  # noqa: E731
    c = lambda n, s: Col(n, "count", s)  # noqa: E731
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("user_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String", verify_src="lower({userAddress})"),
        Col("pool_address", "idpart", expr=f"lower({id_part(3)})", ch_type="String", verify_src="lower({poolAddress})"),
        b("lp_balance", "lpBalance"),
        b("liquidity_added_usd", "totalLiquidityAddedUSD"),
        b("liquidity_added0", "totalLiquidityAddedToken0"),
        b("liquidity_added1", "totalLiquidityAddedToken1"),
        b("liquidity_removed_usd", "totalLiquidityRemovedUSD"),
        b("liquidity_removed0", "totalLiquidityRemovedToken0"),
        b("liquidity_removed1", "totalLiquidityRemovedToken1"),
        c("swaps", "numberOfSwaps"),
        b("swap_volume0", "totalSwapVolumeAmount0"),
        b("swap_volume1", "totalSwapVolumeAmount1"),
        b("swap_volume_usd", "totalSwapVolumeUSD"),
        b("fees_paid_usd", "totalFeesContributedUSD"),
        b("fees_paid0", "totalFeesContributed0"),
        b("fees_paid1", "totalFeesContributed1"),
        c("flash_loans", "numberOfFlashLoans"),
        b("flash_loan_volume_usd", "totalFlashLoanVolumeUSD"),
        c("gauge_deposits", "numberOfGaugeDeposits"),
        c("gauge_withdrawals", "numberOfGaugeWithdrawals"),
        c("gauge_reward_claims", "numberOfGaugeRewardClaims"),
        b("gauge_rewards_claimed_usd", "totalGaugeRewardsClaimedUSD"),
        b("gauge_rewards_claimed", "totalGaugeRewardsClaimed"),
        b("staked_fees_collected0", "totalStakedFeesCollected0"),
        b("staked_fees_collected1", "totalStakedFeesCollected1"),
        b("staked_fees_collected_usd", "totalStakedFeesCollectedUSD"),
        b("unstaked_fees_collected0", "totalUnstakedFeesCollected0"),
        b("unstaked_fees_collected1", "totalUnstakedFeesCollected1"),
        b("unstaked_fees_collected_usd", "totalUnstakedFeesCollectedUSD"),
        b("staked_liquidity", "currentLiquidityStaked"),
        b("staked_usd", "currentLiquidityStakedUSD"),
        Col("staked_cl_position_token_ids", "u64list", "stakedCLPositionTokenIds"),
        b("bribes_claimed_usd", "totalBribeClaimedUSD"),
        b("fee_rewards_claimed_usd", "totalFeeRewardClaimedUSD"),
        b("venft_amount_staked", "veNFTamountStaked"),
        Col("alm_address", "addr", "almAddress"),
        b("alm_lp_amount", "almLpAmount"),
        Col("last_alm_activity", "time", "lastAlmActivityTimestamp"),
        Col("first_activity", "time", "firstActivityTimestamp"),
        Col("last_activity", "time", "lastActivityTimestamp"),
        Col("last_snapshot", "time", "lastSnapshotTimestamp"),
    ]


def position_cols() -> list[Col]:
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("nfpm_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String", verify_src="lower({nfpmAddress})"),
        Col("token_id", "idpart", expr=f"toUInt64OrZero({id_part(3)})", ch_type="UInt64", verify_src="toUInt64({tokenId})"),
        Col("owner", "addr", "owner"),
        Col("pool_address", "addr", "pool"),
        Col("tick_lower", "dec", "tickLower"),
        Col("tick_upper", "dec", "tickUpper"),
        Col("token0_address", "addr", "token0"),
        Col("token1_address", "addr", "token1"),
        Col("liquidity", "big", "liquidity"),
        Col("mint_tx_hash", "str", "mintTransactionHash"),
        Col("mint_log_index", "int32", "mintLogIndex"),
        Col("last_updated", "time", "lastUpdatedTimestamp"),
        Col("last_snapshot", "time", "lastSnapshotTimestamp"),
        Col("is_staked", "bool", "isStakedInGauge"),
    ]


def venft_cols() -> list[Col]:
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("token_id", "idpart", expr=f"toUInt64OrZero({id_part(2)})", ch_type="UInt64", verify_src="toUInt64({tokenId})"),
        Col("owner", "addr", "owner"),
        Col("locktime", "count", "locktime"),
        Col("is_permanent", "bool", "isPermanent"),
        Col("last_updated", "time", "lastUpdatedTimestamp"),
        Col("locked_amount", "big", "totalValueLocked"),
        Col("is_alive", "bool", "isAlive"),
        Col("last_snapshot", "time", "lastSnapshotTimestamp"),
    ]


def venft_vote_cols() -> list[Col]:
    return [
        Col("id", "str", "id"),
        Col("chain_id", "idpart", expr=f"toInt32OrZero({id_part(1)})", ch_type="Int32", verify_src=f"toInt32({vid(1)})"),
        Col("token_id", "idpart", expr=f"toUInt64OrZero({id_part(2)})", ch_type="UInt64", verify_src=f"toUInt64({vid(2)})"),
        Col("pool_address", "addr", "poolAddress"),
        Col("votes", "big", "veNFTamountStaked"),
        Col("venft_id", "str", "veNFTState_id"),
        Col("last_updated", "time", "lastUpdatedTimestamp"),
    ]


def alm_cols() -> list[Col]:
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("wrapper_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String", verify_src=f"lower({vid(2)})"),
        Col("pool_address", "addr", "pool"),
        Col("token0_address", "addr", "token0"),
        Col("token1_address", "addr", "token1"),
        Col("lp_amount", "big", "lpAmount"),
        Col("last_updated", "time", "lastUpdatedTimestamp"),
        Col("token_id", "dec", "tokenId"),
        Col("tick_lower", "dec", "tickLower"),
        Col("tick_upper", "dec", "tickUpper"),
        Col("property", "dec", "property"),
        Col("liquidity", "big", "liquidity"),
        Col("strategy_type", "dec", "strategyType"),
        Col("tick_neighborhood", "dec", "tickNeighborhood"),
        Col("tick_spacing", "dec", "tickSpacing"),
        Col("position_width", "dec", "positionWidth"),
        Col("max_liquidity_ratio_deviation_x96", "big", "maxLiquidityRatioDeviationX96"),
        Col("creation_time", "time", "creationTimestamp"),
        Col("strategy_tx_hash", "str", "strategyTransactionHash"),
        Col("last_snapshot", "time", "lastSnapshotTimestamp"),
    ]


def token_price_cols() -> list[Col]:
    # Snapshot ids are {chainId}-{address}-{epochMs}; rows written before ADR 0003 end in a
    # block number instead. Both are unique per token, so the suffix is the key.
    return [
        Col("id", "str", "id"),
        CHAIN_FROM_ID,
        Col("token_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String", verify_src="lower({address})"),
        Col("snapshot_key", "idpart", expr=f"toUInt64OrZero({id_part(3)})", ch_type="UInt64", verify_src=f"toUInt64({vid(3)})"),
        Col("price_usd", "big", "pricePerUSDNew"),
        Col("is_whitelisted", "bool", "isWhitelisted"),
        Col("refreshed_at", "time", "lastUpdatedTimestamp"),
        Col("price_source", "str", "priceSource", ch_type="LowCardinality(Nullable(String))"),
        Col("pricing_pool_id", "str", "pricingPoolId"),
        Col("pricing_depth_usd", "big", "pricingDepthUSD"),
        Col("pricing_source_token_id", "str", "pricingSourceTokenId"),
    ]


ENTITIES: list[Entity] = [
    Entity("pool", "_pool", "Pool", "chain_id, pool_address", pool_cols(),
           description="current state of every pool (legacy and Aero)",
           indexes=["idx_token0 token0_address TYPE bloom_filter(0.01) GRANULARITY 1",
                    "idx_token1 token1_address TYPE bloom_filter(0.01) GRANULARITY 1"]),
    Entity("token", "_token", "Token", "chain_id, token_address", token_cols(),
           description="current state of every token (price, trust)"),
    Entity("user_pool", "_user_pool", "UserStatsPerPool", "chain_id, user_address, pool_address", user_pool_cols(),
           description="current per-user, per-pool counters",
           indexes=["idx_pool pool_address TYPE bloom_filter(0.01) GRANULARITY 1"]),
    Entity("position", "_position", "NonFungiblePosition", "chain_id, nfpm_address, token_id", position_cols(),
           description="current CL NFT positions (burned positions are deleted)",
           indexes=["idx_owner owner TYPE bloom_filter(0.01) GRANULARITY 1",
                    "idx_pool pool_address TYPE bloom_filter(0.01) GRANULARITY 1"]),
    Entity("venft", "_venft", "VeNFTState", "chain_id, token_id", venft_cols(),
           description="current veNFT locks",
           indexes=["idx_owner owner TYPE bloom_filter(0.01) GRANULARITY 1"]),
    Entity("venft_vote", "_venft_vote", "VeNFTPoolVote", "chain_id, token_id, pool_address", venft_vote_cols(),
           description="current veNFT vote allocation per pool",
           indexes=["idx_pool pool_address TYPE bloom_filter(0.01) GRANULARITY 1"]),
    Entity("alm_wrapper", "_alm_wrapper", "ALM_LP_Wrapper", "chain_id, wrapper_address", alm_cols(),
           description="current ALM LP wrappers and their strategy position"),
    Entity("token_price", "_token_price", "TokenPriceSnapshot", "chain_id, token_address, snapshot_key", token_price_cols(),
           description="hourly token price refreshes (TokenPriceSnapshot, typed and keyed per token)",
           partition_extra="toYear(refreshed_at)"),
    Entity("pool_hour", "_pool_hour", "Pool", "chain_id, pool_address, period", series_cols(), mode="hour", prev_fields=PREV_FIELDS,
           period_expr="toStartOfHour(lastUpdatedTimestamp)", partition_extra="toYear(period)",
           description="end-of-hour pool state for every hour in which the pool changed (exact, from the per-block history)"),
    Entity("pool_day", "_pool_day", "Pool", "chain_id, pool_address, period", series_cols(), mode="day", prev_fields=PREV_FIELDS,
           period_expr="toStartOfDay(lastUpdatedTimestamp)",
           description="end-of-day pool state for every day in which the pool changed (exact, from the per-block history)"),
    # Superchain root pools (ADR 0009): the vote weight and emissions of a leaf pool live on the
    # root chain. Their hourly / daily series give pool_hourly / pool_daily those numbers for
    # leaf pools (through root_leaf_pools), exactly as _pool_hour does for local pools.
    Entity("root_pool_hour", "_root_pool_hour", "RootPool", "chain_id, root_pool_address, period", root_pool_series_cols(),
           mode="hour", prev_fields=ROOT_PREV_FIELDS, period_expr="toStartOfHour(lastUpdatedTimestamp)",
           series_key="chain_id, root_pool_address",
           description="end-of-hour root pool state (votes, emissions) for every hour in which it changed"),
    Entity("root_pool_day", "_root_pool_day", "RootPool", "chain_id, root_pool_address, period", root_pool_series_cols(),
           mode="day", prev_fields=ROOT_PREV_FIELDS, period_expr="toStartOfDay(lastUpdatedTimestamp)",
           series_key="chain_id, root_pool_address",
           description="end-of-day root pool state (votes, emissions) for every day in which it changed"),
]

def _aero_entities() -> list[Entity]:
    from schema_map import auto_columns, parse_schema  # noqa: PLC0415

    types = parse_schema()
    out = []
    # (key, envio type, description): current state, one row per id, sorted by id
    # (ids start with the chain id, then the entity's own key)
    for key, src, desc in [
        ("aero_gauge", "AeroGauge", "Aero gauges: cap, weight, allocations, emissions credited / minted / forfeited, fees"),
        ("aero_gauge_factory", "AeroGaugeFactory", "Aero gauge factories: default cap, penalty, minimum stake"),
        ("aero_leaf_voter", "AeroLeafVoterState", "each chain's Aero LeafVoter: emission and allocation totals"),
        ("aero_voting_rewards_manager", "AeroVotingRewardsManager", "per-gauge rewards managers: fees and incentives for allocators"),
        ("aero_incentive_program", "AeroIncentiveProgram", "incentive programs funded on Aero gauges"),
        ("saero_position", "SAeroPosition", "sAERO positions (VotingEscrow NFTs on Base)"),
        ("saero_escrow", "SAeroEscrowState", "the sAERO VotingEscrow: supply, permanent balance, accumulator"),
        ("aero_root_allocation", "AeroRootAllocation", "root Voter (Base): power a position booked per chain"),
        ("aero_root_gauge_vote", "AeroRootGaugeVote", "root Voter (Base): last gauge split dispatched per position and chain"),
        ("aero_root_chain", "AeroRootChainState", "root Voter (Base): per-chain ledger, redemptions, buffer"),
        ("aero_leaf_token", "AeroLeafTokenState", "each LeafVoter: a position's budget and booked split"),
        ("aero_leaf_allocation", "AeroLeafAllocation", "each LeafVoter: a position's booked allocation per gauge"),
        ("aero_minter", "AeroMinterState", "the Minter on Base: rates and mint totals"),
        ("aero_migration_totals", "AeroMigrationTotals", "legacy-to-Aero migration totals per contract"),
    ]:
        if src in types:
            out.append(Entity(key, f"_{key}", src, "id", auto_columns(src, types), description=desc))
    # daily series (end-of-day state, prev_ for flows): emissions per gauge and per chain
    if "AeroGauge" in types:
        cols = [c for c in auto_columns("AeroGauge", types) if c.name in AERO_GAUGE_SERIES]
        cols.append(Col("gauge_address", "idpart", expr=f"lower({id_part(2)})", ch_type="String",
                        verify_src=f"lower({vid(2)})"))
        out.append(Entity("aero_gauge_day", "_aero_gauge_day", "AeroGauge", "chain_id, gauge_address, period", cols,
                          mode="day", period_expr="toStartOfDay(lastUpdatedTimestamp)", series_key="chain_id, gauge_address",
                          prev_fields=AERO_GAUGE_PREV,
                          description="end-of-day Aero gauge state for every day the gauge changed (from the per-block history)"))
    if "AeroLeafVoterState" in types:
        cols = [c for c in auto_columns("AeroLeafVoterState", types) if c.name in AERO_LEAF_SERIES]
        out.append(Entity("aero_leaf_voter_day", "_aero_leaf_voter_day", "AeroLeafVoterState", "chain_id, period", cols,
                          mode="day", period_expr="toStartOfDay(lastUpdatedTimestamp)", series_key="chain_id",
                          prev_fields=AERO_LEAF_PREV,
                          description="end-of-day Aero LeafVoter totals per chain (from the per-block history)"))
    return out


AERO_GAUGE_PREV = [
    "total_allocated", "total_emissions_credited", "total_cap_surplus", "total_emissions_forfeited",
    "total_emissions_minted", "total_emissions_minted_usd", "total_emissions_claimed", "total_early_withdraw_penalty",
    "total_fees_claimed0", "total_fees_claimed1", "total_fees_claimed_usd", "number_of_deposits", "number_of_withdrawals",
    "number_of_claims",
]
AERO_GAUGE_SERIES = {"id", "chain_id", "pool_address", "is_cl", "is_activated", "emission_cap", "last_gauge_weight",
                     "last_updated_timestamp", *AERO_GAUGE_PREV}
AERO_LEAF_PREV = [
    "total_emissions_credited", "total_cap_surplus", "total_idle_surplus", "total_emissions_forfeited",
    "total_emissions_minted", "total_emissions_minted_usd", "total_redeemed",
]
AERO_LEAF_SERIES = {"id", "chain_id", "receipt_token_supply", "emissions_per_vp", "total_chain_allocation",
                    "total_booked_allocation", "last_updated_timestamp", *AERO_LEAF_PREV}

ENTITIES += _aero_entities()

KIND_TYPE = {
    "str": "String",
    "addr": "String",
    "big": "Int256",
    "count": "UInt64",
    "dec": "Int64",
    "int32": "Int32",
    "bool": "Bool",
    "time": "DateTime64(3, 'UTC')",
    "u64list": "Array(UInt64)",
    "biglist": "Array(Int256)",
    "addrlist": "Array(String)",
    "strlist": "Array(String)",
}


class Resolved:
    """A column resolved against the source table's actual columns."""

    def __init__(self, col: Col, src_types: dict[str, str]):
        self.col = col
        self.name = col.name
        self.present = col.src is None or col.src in src_types
        src_type = src_types.get(col.src or "", "")
        self.nullable = src_type.startswith("Nullable") or src_type.startswith("LowCardinality(Nullable")
        # A BigInt with precision <= 38 arrives as Decimal(P, 0), not String (envio >= 3.10).
        self.decimal_source = "Decimal" in src_type
        base = col.ch_type or KIND_TYPE[col.kind]
        if self.nullable and not base.startswith("Nullable") and not base.startswith("LowCardinality(Nullable"):
            base = f"Nullable({base})"
        self.ch_type = base

    def expr(self) -> str:
        c = self.col
        if c.kind == "idpart" or (c.expr and self.present):
            return c.expr  # type: ignore[return-value]
        if not self.present:
            if c.fallback is None:
                raise KeyError(f"source column {c.src} missing and no fallback for {c.name}")
            return c.fallback
        s = f"`{c.src}`"
        if c.kind == "addr":
            return f"lower({s})"
        if c.kind in ("big", "count") and self.decimal_source:
            t = "Int256" if c.kind == "big" else "UInt64"
            return f"CAST({s} AS Nullable({t}))" if self.nullable else f"to{t}({s})"
        if c.kind == "big":
            e = BIG.format(c=s)
            return f"if({s} IS NULL, NULL, {e})" if self.nullable else e
        if c.kind == "count":
            e = COUNT.format(c=s)
            return f"if({s} IS NULL, NULL, {e})" if self.nullable else e
        if c.kind == "dec":
            return f"toInt64({s})" if not self.nullable else f"CAST({s} AS Nullable(Int64))"
        if c.kind == "u64list":
            return f"arrayMap(x -> toUInt64OrZero(x), {s})"
        if c.kind == "biglist":
            return f"arrayMap(x -> toInt256OrZero(toString(x)), {s})"
        if c.kind == "addrlist":
            return f"arrayMap(x -> lower(x), {s})"
        return s

    def verify_fields(self) -> list[str]:
        """envio columns the verify expression reads."""
        if not self.present:
            return []
        if self.col.verify_src:
            return re.findall(r"\{(\w+)\}", self.col.verify_src)
        return [self.col.src] if self.col.src else []

    def verify_pair(self, e: str = "e.", t: str = "t.") -> tuple[str, str] | None:
        """(stored value as text, envio value as text); None when there is nothing to compare."""
        c = self.col
        if not self.present:
            return None
        tv = f"{t}`{c.name}`"
        if c.verify_src:
            sv = c.verify_src.format_map(_Prefixed(e))
        elif c.src:
            sv = f"{e}`{c.src}`"
        else:
            return None
        if c.kind == "addr":
            sv = f"lower({sv})"
        if c.kind in ("u64list", "biglist"):
            return (f"toString(arrayMap(x -> toString(x), {tv}))", f"toString(arrayMap(x -> toString(x), {sv}))")
        if c.kind == "addrlist":
            return (f"toString({tv})", f"toString(arrayMap(x -> lower(x), {sv}))")
        return (f"ifNull(toString({tv}), '<null>')", f"ifNull(toString({sv}), '<null>')")


class _Prefixed(dict):
    def __init__(self, prefix: str):
        super().__init__()
        self.prefix = prefix

    def __missing__(self, key: str) -> str:
        return f"{self.prefix}`{key}`"
