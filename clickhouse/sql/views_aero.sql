-- Analyst views for Aero (MetaDEX) gauges, emissions and governance (ADR 0006). Installed only
-- when the indexer has the Aero gauge entities. Field meanings: docs/schema.md and the section
-- "Aero gauges, emissions and governance" of docs/querying.md.
--
-- Units: every Aero amount (emissions, caps, allocations, sAERO, migration) is 18-decimal AERO
-- or xAERO (1:1) and is divided by 1e18 here; *_usd is dollars. The typed event and snapshot
-- views (aero_*_events, aero_*_snapshots, saero_*) keep envio's raw integers (divide by 1e18).

-- Base AERO price per day (mean of the hours in which it was freshly priced). xAERO on the leaf
-- chains is redeemable 1:1 for Base AERO but often has no price of its own, so the *_at_base_aero
-- columns below value leaf-chain emissions at this price.
CREATE OR REPLACE VIEW {{db}}.base_aero_price_daily AS
SELECT toDate(refreshed_at) AS day, avg(toFloat64(price_usd) / 1e18) AS aero_usd
FROM {{db}}._token_price FINAL
WHERE chain_id = 8453 AND token_address = '0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee'
  AND ifNull(CAST(price_source AS Nullable(String)), '') IN ('pinned', 'pool', 'canonical')
GROUP BY day;

-- Aero gauges now, with their pool.
CREATE OR REPLACE VIEW {{db}}.aero_gauges AS
SELECT
  g.chain_id AS chain_id,
  d.chain_name AS chain_name,
  g.gauge_address AS gauge_address,
  g.pool_address AS pool_address,
  d.pair AS pair,
  d.pool_type AS pool_type,
  g.is_cl AS is_cl,
  g.is_activated AS is_activated,
  g.emission_cap = 0 AS is_deactivated,
  toFloat64(g.emission_cap) * 86400 / 1e18 AS emission_cap_per_day,
  toFloat64(g.last_gauge_weight) / 1e18 AS weight,
  toFloat64(g.total_allocated) / 1e18 AS allocated,
  toFloat64(g.total_emissions_credited) / 1e18 AS emissions_credited_total,
  toFloat64(g.total_emissions_minted) / 1e18 AS emissions_minted_total,
  toFloat64(g.total_emissions_minted_usd) / 1e18 AS emissions_minted_usd_total,
  toFloat64(g.total_emissions_forfeited) / 1e18 AS emissions_forfeited_total,
  toFloat64(g.total_cap_surplus) / 1e18 AS cap_surplus_total,
  toFloat64(g.total_early_withdraw_penalty) / 1e18 AS early_withdraw_penalty_total,
  toFloat64(g.total_emissions_credited - g.total_emissions_minted - g.total_emissions_forfeited) / 1e18 AS emissions_unpaid,
  toFloat64(g.total_fees_claimed_usd) / 1e18 AS staked_fees_to_voters_usd_total,
  g.number_of_deposits AS deposits_total,
  g.number_of_withdrawals AS withdrawals_total,
  g.number_of_claims AS claims_total,
  p.tvl_usd AS pool_tvl_usd,
  p.staked_usd AS pool_staked_usd,
  p.staked_share AS pool_staked_share,
  p.fees_usd_total AS pool_fees_usd_total,
  g.reward_token AS reward_token,
  g.voting_rewards_manager AS voting_rewards_manager,
  toDateTime(g.created_timestamp) AS created_at,
  toDateTime(g.last_updated_timestamp) AS last_updated
FROM {{db}}._aero_gauge AS g FINAL
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = g.chain_id AND d.pool_address = g.pool_address
LEFT JOIN (SELECT chain_id, pool_address, tvl_usd, staked_usd, staked_share, fees_usd_total FROM {{db}}.pools) AS p
  ON p.chain_id = g.chain_id AND p.pool_address = g.pool_address;

-- Per gauge and day with a change: emissions credited / minted / forfeited, fees sent to
-- voters, stake activity; the pool's fees that day for fees-versus-emissions.
CREATE OR REPLACE VIEW {{db}}.aero_gauge_daily AS
SELECT
  s.chain_id AS chain_id,
  d.chain_name AS chain_name,
  s.gauge_address AS gauge_address,
  s.pool_address AS pool_address,
  d.pair AS pair,
  toDate(s.period) AS day,
  s.is_activated AS is_activated,
  toFloat64(s.emission_cap) * 86400 / 1e18 AS emission_cap_per_day,
  toFloat64(s.last_gauge_weight) / 1e18 AS weight,
  toFloat64(s.total_allocated) / 1e18 AS allocated,
  toFloat64(s.total_emissions_credited - s.prev_total_emissions_credited) / 1e18 AS emissions_credited,
  toFloat64(s.total_emissions_minted - s.prev_total_emissions_minted) / 1e18 AS emissions_minted,
  toFloat64(s.total_emissions_minted_usd - s.prev_total_emissions_minted_usd) / 1e18 AS emissions_minted_usd,
  toFloat64(s.total_emissions_minted - s.prev_total_emissions_minted) / 1e18 * bp.aero_usd AS emissions_minted_usd_at_base_aero,
  toFloat64(s.total_emissions_forfeited - s.prev_total_emissions_forfeited) / 1e18 AS emissions_forfeited,
  toFloat64(s.total_cap_surplus - s.prev_total_cap_surplus) / 1e18 AS cap_surplus,
  toFloat64(s.total_early_withdraw_penalty - s.prev_total_early_withdraw_penalty) / 1e18 AS early_withdraw_penalty,
  toFloat64(s.total_fees_claimed_usd - s.prev_total_fees_claimed_usd) / 1e18 AS staked_fees_to_voters_usd,
  toInt64(s.number_of_deposits) - toInt64(s.prev_number_of_deposits) AS deposits,
  toInt64(s.number_of_withdrawals) - toInt64(s.prev_number_of_withdrawals) AS withdrawals,
  toInt64(s.number_of_claims) - toInt64(s.prev_number_of_claims) AS claims,
  pd.fees_usd AS pool_fees_usd,
  pd.volume_usd AS pool_volume_usd,
  pd.tvl_usd AS pool_tvl_usd,
  pd.staked_usd AS pool_staked_usd,
  toFloat64(s.total_emissions_minted) / 1e18 AS emissions_minted_total
FROM {{db}}._aero_gauge_day AS s FINAL
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = s.chain_id AND d.pool_address = s.pool_address
LEFT JOIN {{db}}.base_aero_price_daily AS bp ON bp.day = toDate(s.period)
LEFT JOIN (SELECT chain_id, pool_address, day, fees_usd, volume_usd, tvl_usd, staked_usd FROM {{db}}.pool_daily) AS pd
  ON pd.chain_id = s.chain_id AND pd.pool_address = s.pool_address AND pd.day = toDate(s.period);

-- Per chain and day: the LeafVoter's emission ledger and allocation budget.
CREATE OR REPLACE VIEW {{db}}.aero_chain_daily AS
SELECT
  s.chain_id AS chain_id,
  c.chain_name AS chain_name,
  toDate(s.period) AS day,
  toFloat64(s.total_emissions_credited - s.prev_total_emissions_credited) / 1e18 AS emissions_credited,
  toFloat64(s.total_emissions_minted - s.prev_total_emissions_minted) / 1e18 AS emissions_minted,
  toFloat64(s.total_emissions_minted_usd - s.prev_total_emissions_minted_usd) / 1e18 AS emissions_minted_usd,
  toFloat64(s.total_emissions_minted - s.prev_total_emissions_minted) / 1e18 * bp.aero_usd AS emissions_minted_usd_at_base_aero,
  toFloat64(s.total_emissions_forfeited - s.prev_total_emissions_forfeited) / 1e18 AS emissions_forfeited,
  toFloat64(s.total_cap_surplus - s.prev_total_cap_surplus) / 1e18 AS cap_surplus,
  toFloat64(s.total_idle_surplus - s.prev_total_idle_surplus) / 1e18 AS idle_surplus,
  toFloat64(s.total_redeemed - s.prev_total_redeemed) / 1e18 AS redeemed,
  toFloat64(s.receipt_token_supply) / 1e18 AS xaero_outstanding,
  toFloat64(s.total_chain_allocation) / 1e18 AS chain_allocation,
  toFloat64(s.total_booked_allocation) / 1e18 AS booked_allocation,
  toFloat64(s.total_chain_allocation - s.total_booked_allocation) / 1e18 AS idle_allocation,
  toFloat64(s.emissions_per_vp) / 1e18 AS emissions_per_vp
FROM {{db}}._aero_leaf_voter_day AS s FINAL
LEFT JOIN {{db}}.chains AS c ON c.chain_id = s.chain_id
LEFT JOIN {{db}}.base_aero_price_daily AS bp ON bp.day = toDate(s.period);

-- sAERO positions now (VotingEscrow on Base), with voting power now:
-- amount if permanent, else amount * remaining lock / 4 years (as the contracts compute it).
CREATE OR REPLACE VIEW {{db}}.saero_positions AS
SELECT
  p.token_id AS token_id,
  p.owner AS owner,
  toFloat64(p.amount) / 1e18 AS amount,
  p.is_permanent AS is_permanent,
  if(p.stake_end = 0, NULL, toDateTime(toUInt32(p.stake_end))) AS stake_end,
  if(p.is_permanent, toFloat64(p.amount),
     toFloat64(p.amount) * greatest(0, toFloat64(p.stake_end) - toUnixTimestamp(now())) / 126144000) / 1e18 AS voting_power_now,
  p.created_via AS created_via,
  toFloat64(p.total_deposited) / 1e18 AS deposited_total,
  toFloat64(p.total_withdrawn) / 1e18 AS withdrawn_total,
  toDateTime(p.created_timestamp) AS created_at,
  toDateTime(p.last_updated_timestamp) AS last_updated
FROM {{db}}._saero_position AS p FINAL;

-- Allocation books, root against leaf, per position and chain. The root Voter on Base books
-- what a position sent to a chain (AeroRootAllocation); the chain's LeafVoter books what it
-- received and how it split it (AeroLeafTokenState). They are separate truths (a dispatch can be
-- in flight, expire or be rejected) and are only joined here. target_chain_id 0 = CHAIN0 (idle).
CREATE OR REPLACE VIEW {{db}}.aero_allocation_books AS
SELECT
  coalesce(r.token_id, l.token_id) AS token_id,
  coalesce(r.target_chain_id, l.chain_id) AS chain_id,
  c.chain_name AS chain_name,
  r.root_booked AS root_booked,
  l.leaf_budget AS leaf_budget,
  l.leaf_booked_on_gauges AS leaf_booked_on_gauges,
  l.leaf_idle AS leaf_idle,
  ifNull(r.root_booked, 0) - ifNull(l.leaf_budget, 0) AS root_minus_leaf
FROM (
  SELECT toUInt64(token_id) AS token_id, target_chain_id, toFloat64(amount) / 1e18 AS root_booked
  FROM {{db}}._aero_root_allocation FINAL
) AS r
FULL OUTER JOIN (
  SELECT toUInt64(token_id) AS token_id, chain_id, toFloat64(chain_allocation) / 1e18 AS leaf_budget,
         toFloat64(arraySum(allocations)) / 1e18 AS leaf_booked_on_gauges, toFloat64(idle_allocation) / 1e18 AS leaf_idle
  FROM {{db}}._aero_leaf_token FINAL
) AS l ON l.token_id = r.token_id AND l.chain_id = r.target_chain_id
LEFT JOIN {{db}}.chains AS c ON c.chain_id = coalesce(r.target_chain_id, l.chain_id)
SETTINGS join_use_nulls = 1;

-- A position's booked allocation per gauge (LeafVoter books), with the pool.
CREATE OR REPLACE VIEW {{db}}.aero_gauge_allocations AS
SELECT
  a.chain_id AS chain_id,
  toUInt64(a.token_id) AS token_id,
  a.gauge_address AS gauge_address,
  a.pool_address AS pool_address,
  d.pair AS pair,
  toFloat64(a.allocated) / 1e18 AS allocated,
  toDateTime(a.last_updated_timestamp) AS last_updated
FROM {{db}}._aero_leaf_allocation AS a FINAL
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = a.chain_id AND d.pool_address = a.pool_address
WHERE a.allocated != 0;

-- Rewards managers: pool fees of staked liquidity and incentives, collected and claimed.
CREATE OR REPLACE VIEW {{db}}.aero_voting_rewards AS
SELECT
  m.chain_id AS chain_id,
  m.address AS voting_rewards_manager,
  m.gauge_address AS gauge_address,
  m.pool_address AS pool_address,
  d.pair AS pair,
  toFloat64(m.total_fees_collected_usd) / 1e18 AS fees_collected_usd_total,
  toFloat64(m.total_fees_claimed_usd) / 1e18 AS fees_claimed_usd_total,
  toFloat64(m.total_incentives_funded_usd) / 1e18 AS incentives_funded_usd_total,
  toFloat64(m.total_incentives_claimed_usd) / 1e18 AS incentives_claimed_usd_total,
  m.number_of_incentive_programs AS incentive_programs_total,
  toDateTime(m.last_updated_timestamp) AS last_updated
FROM {{db}}._aero_voting_rewards_manager AS m FINAL
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = m.chain_id AND d.pool_address = m.pool_address;

-- Legacy-to-Aero migration totals per contract.
CREATE OR REPLACE VIEW {{db}}.aero_migration AS
SELECT
  m.chain_id AS chain_id,
  m.migration_contract AS migration_contract,
  m.legacy_token AS legacy_token,
  m.number_of_ve_nf_ts AS venfts_migrated,
  toFloat64(m.ve_nft_amount_in) / 1e18 AS venft_amount_in,
  toFloat64(m.ve_nft_amount_out) / 1e18 AS venft_amount_out,
  m.number_of_liquid AS liquid_migrations,
  toFloat64(m.liquid_amount_in) / 1e18 AS liquid_amount_in,
  toFloat64(m.liquid_amount_out) / 1e18 AS liquid_amount_out,
  m.number_of_settlements AS settlements,
  toFloat64(m.settled_amount) / 1e18 AS settled_amount,
  toDateTime(m.last_updated_timestamp) AS last_updated
FROM {{db}}._aero_migration_totals AS m FINAL;
