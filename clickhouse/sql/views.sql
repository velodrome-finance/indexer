-- Analyst views of the ClickHouse analytics layer (installed by clickhouse/analytics.py).
--
-- Placeholders: {{db}} = analytics database, {{src}} = the indexer's database (read only),
-- {{frontier}} = the commit frontier (highest committed checkpoint) of a row of an envio history
-- table: the indexer's, or the row's chain's when chains have their own checkpoint sequences.
-- {{scope:<chain expr>}} = the checkpoint sequence of a row of that chain (the chain when
-- per-chain, 0 when shared).
-- {{col:<envio table>.<column>|<fallback>}} = the column when the indexer's schema has it,
-- otherwise the fallback expression (older schemas).
--
-- Conventions for every view:
--   * addresses are lowercase 0x-hex; chain_id is the EVM chain id; chain_name is a label
--   * *_usd columns are US dollars (Float64); token amounts are whole tokens (Float64, divided
--     by the token's decimals); *_raw columns are the exact integers envio stored
--   * cumulative counters end in _total; hourly / daily views give the change in the period
--   * timestamps are DateTime in UTC
-- Storage tables (names starting with _) hold exact integers; read them only for exact work.

-- Chain dimension. legacy_deployment is what Pool.deployment says for legacy pools there.
CREATE OR REPLACE VIEW {{db}}.chains AS
SELECT * FROM VALUES(
  'chain_id Int32, chain_name String, legacy_deployment String, has_aero Bool, wound_down Bool',
  (10, 'Optimism', 'VELODROME', true, false),
  (8453, 'Base', 'AERODROME', true, false),
  (42220, 'Celo', 'VELODROME', false, false),
  (1868, 'Soneium', 'VELODROME', false, false),
  (57073, 'Ink', 'VELODROME', true, false),
  (34443, 'Mode', 'VELODROME', false, false),
  (1135, 'Lisk', 'VELODROME', false, true),
  (130, 'Unichain', 'VELODROME', false, false),
  (252, 'Fraxtal', 'VELODROME', false, false),
  (1750, 'Metal', 'VELODROME', false, false),
  (5330, 'Superseed', 'VELODROME', false, true),
  (1923, 'Swell', 'VELODROME', false, true),
  (1, 'Ethereum', '', true, false),
  (42161, 'Arbitrum', '', true, false),
  (4663, 'Robinhood Chain', '', true, false),
  (5042, 'Arc', '', true, false)
);

-- Known ranges where the indexed data is wrong or incomplete. Join on chain_id and time.
CREATE OR REPLACE VIEW {{db}}.known_data_issues AS
SELECT * FROM VALUES(
  'chain_id Int32, from_block UInt64, to_block UInt64, approx_from DateTime, approx_to DateTime, issue String',
  (5330, 10313359, 10521629, toDateTime('2025-05-08 00:00:00'), toDateTime('2025-05-13 00:00:00'),
   'HyperSync served a non-canonical fork for these 208,271 Superseed blocks: mints and liquidity events are missing, so Superseed pool, position and user figures are wrong from here on'),
  (1135, 39746606, 39746606, toDateTime('2026-10-13 00:00:00'), toDateTime('2026-10-13 00:00:00'),
   'Lisk is wound down: indexed up to its end_block only'),
  (5330, 32854188, 32854188, toDateTime('2026-10-13 00:00:00'), toDateTime('2026-10-13 00:00:00'),
   'Superseed is wound down: indexed up to its end_block only (HyperSync stopped serving it on 2026-10-13)'),
  (1923, 27851500, 27851500, toDateTime('2026-10-13 00:00:00'), toDateTime('2026-10-13 00:00:00'),
   'Swell is wound down: indexed up to its end_block only')
);

-- Tokens: current price and trust. price_usd is the indexer's pool-derived price (ADR 0003);
-- 0 when no qualifying pool priced it in the last 7 days.
CREATE OR REPLACE VIEW {{db}}.tokens AS
SELECT
  t.chain_id AS chain_id,
  c.chain_name AS chain_name,
  t.token_address AS token_address,
  t.symbol AS symbol,
  t.name AS name,
  t.decimals AS decimals,
  toFloat64(t.price_usd) / 1e18 AS price_usd,
  t.price_usd = 0 AS is_unpriced,
  toDateTime(t.last_successful_price) AS price_updated_at,
  toDateTime(t.last_price_refresh) AS price_checked_at,
  toFloat64(t.pricing_depth_usd) / 1e18 AS pricing_depth_usd,
  t.is_whitelisted AS is_whitelisted,
  t.is_listed_on_aero AS is_listed_on_aero,
  t.price_trust_outcome AS price_trust_outcome,
  t.price_trust_reason AS price_trust_reason,
  (t.is_whitelisted OR ifNull(t.is_listed_on_aero, false) OR ifNull(t.price_trust_reason, '') = 'CONNECTOR')
    AND ifNull(t.price_trust_reason, '') != 'BLACKLISTED' AS is_price_trusted,
  t.price_usd AS price_usd_raw,
  t.id AS envio_id
FROM {{db}}._token AS t FINAL
LEFT JOIN {{db}}.chains AS c ON c.chain_id = t.chain_id;

-- Static facts per pool (pair, tokens, decimals), the dimension the series views join to.
CREATE OR REPLACE VIEW {{db}}.pool_dim AS
SELECT
  p.chain_id AS chain_id,
  c.chain_name AS chain_name,
  p.deployment AS deployment,
  p.pool_address AS pool_address,
  concat(if(t0.symbol = '', '?', t0.symbol), '/', if(t1.symbol = '', '?', t1.symbol)) AS pair,
  multiIf(p.is_cl, concat('CL', toString(p.tick_spacing)), p.is_stable, 'sAMM', 'vAMM') AS pool_type,
  p.is_cl AS is_cl,
  p.is_stable AS is_stable,
  p.token0_address AS token0_address,
  p.token1_address AS token1_address,
  t0.symbol AS token0_symbol,
  t1.symbol AS token1_symbol,
  if(t0.token_address = '', NULL, t0.decimals) AS token0_decimals,
  if(t1.token_address = '', NULL, t1.decimals) AS token1_decimals,
  p.created_block AS created_block
FROM {{db}}._pool AS p FINAL
LEFT JOIN {{db}}.chains AS c ON c.chain_id = p.chain_id
LEFT JOIN (SELECT chain_id, token_address, symbol, decimals FROM {{db}}._token FINAL) AS t0
  ON t0.chain_id = p.chain_id AND t0.token_address = p.token0_address
LEFT JOIN (SELECT chain_id, token_address, symbol, decimals FROM {{db}}._token FINAL) AS t1
  ON t1.chain_id = p.chain_id AND t1.token_address = p.token1_address;

-- Root-side numbers of superchain leaf pools (ADR 0009). Since the per-chain flip a superchain
-- leaf pool's vote weight and emissions are stored only on the root chain (RootPool); the leaf
-- Pool's veNFTamountStaked / totalEmissions / totalEmissionsUSD stay 0. pools, pool_hourly and
-- pool_daily take a mapped leaf pool's votes and emissions from these views. They are empty
-- here; views_superchain.sql replaces them when the indexer has RootPool.
CREATE OR REPLACE VIEW {{db}}.leaf_pool_root_totals AS
SELECT toInt32(0) AS leaf_chain_id, '' AS leaf_pool_address, '' AS kind, toInt32(0) AS root_chain_id,
  '' AS root_pool_address, CAST(NULL AS Nullable(String)) AS root_gauge_address, false AS root_gauge_is_alive,
  toInt256(0) AS votes_raw, toFloat64(0) AS votes, toInt256(0) AS emissions_raw, toFloat64(0) AS emissions_total,
  toInt256(0) AS emissions_usd_raw, toFloat64(0) AS emissions_usd_total, toUInt64(0) AS distributions_total
WHERE 0;

CREATE OR REPLACE VIEW {{db}}.leaf_pool_root_hourly AS
SELECT toInt32(0) AS leaf_chain_id, '' AS leaf_pool_address, '' AS root_pool_address,
  toDateTime(0, 'UTC') AS period, toInt256(0) AS votes_raw, toInt256(0) AS emissions_raw,
  toInt256(0) AS emissions_usd_raw, toInt256(0) AS emissions_flow_raw, toInt256(0) AS emissions_usd_flow_raw
WHERE 0;

CREATE OR REPLACE VIEW {{db}}.leaf_pool_root_daily AS
SELECT * FROM {{db}}.leaf_pool_root_hourly;

-- Pools: current state, one row per pool. A superchain leaf pool's votes and emissions are its
-- root pool's (leaf_pool_root_totals); root_pool_address says which.
CREATE OR REPLACE VIEW {{db}}.pools AS
SELECT
  d.chain_id AS chain_id,
  d.chain_name AS chain_name,
  d.deployment AS deployment,
  d.pool_address AS pool_address,
  d.pair AS pair,
  d.pool_type AS pool_type,
  p.name AS pool_name,
  d.is_cl AS is_cl,
  d.is_stable AS is_stable,
  d.token0_address AS token0_address,
  d.token0_symbol AS token0_symbol,
  d.token0_decimals AS token0_decimals,
  d.token1_address AS token1_address,
  d.token1_symbol AS token1_symbol,
  d.token1_decimals AS token1_decimals,
  toFloat64(p.tvl_usd) / 1e18 AS tvl_usd,
  toFloat64(p.reserve0) / pow(10, d.token0_decimals) AS reserve0,
  toFloat64(p.reserve1) / pow(10, d.token1_decimals) AS reserve1,
  toFloat64(p.staked_usd) / 1e18 AS staked_usd,
  if(p.tvl_usd > 0, toFloat64(p.staked_usd) / toFloat64(p.tvl_usd), NULL) AS staked_share,
  toFloat64(p.staked_reserve0) / pow(10, d.token0_decimals) AS staked_reserve0,
  toFloat64(p.staked_reserve1) / pow(10, d.token1_decimals) AS staked_reserve1,
  toFloat64(p.volume_usd) / 1e18 AS volume_usd_total,
  toFloat64(p.volume0) / pow(10, d.token0_decimals) AS volume0_total,
  toFloat64(p.volume1) / pow(10, d.token1_decimals) AS volume1_total,
  toFloat64(p.fees_usd) / 1e18 AS fees_usd_total,
  toFloat64(p.fees0) / 1e18 AS fees0_total,
  toFloat64(p.fees1) / 1e18 AS fees1_total,
  p.swaps AS swaps_total,
  toFloat64(p.unstaked_fees_collected_usd) / 1e18 AS unstaked_fees_collected_usd_total,
  toFloat64(p.staked_fees_collected_usd) / 1e18 AS staked_fees_collected_usd_total,
  toFloat64(if(rt.leaf_pool_address != '', rt.emissions_raw, p.emissions)) / 1e18 AS emissions_total,
  toFloat64(if(rt.leaf_pool_address != '', rt.emissions_usd_raw, p.emissions_usd)) / 1e18 AS emissions_usd_total,
  toFloat64(p.gauge_rewards_claimed) / 1e18 AS gauge_rewards_claimed_total,
  toFloat64(p.gauge_rewards_claimed_usd) / 1e18 AS gauge_rewards_claimed_usd_total,
  toFloat64(p.bribes_claimed_usd) / 1e18 AS bribes_claimed_usd_total,
  toFloat64(p.fee_rewards_claimed_usd) / 1e18 AS fee_rewards_claimed_usd_total,
  toFloat64(if(rt.leaf_pool_address != '', rt.votes_raw, p.votes)) / 1e18 AS votes,
  toFloat64(p.gauge_reward_balance) / 1e18 AS gauge_reward_balance,
  toFloat64(p.gauge_reward_balance_usd) / 1e18 AS gauge_reward_balance_usd,
  toFloat64(p.flash_loan_volume_usd) / 1e18 AS flash_loan_volume_usd_total,
  toFloat64(p.flash_loan_fees_usd) / 1e18 AS flash_loan_fees_usd_total,
  toFloat64(p.base_fee) / 1e4 AS base_fee_pct,
  toFloat64(p.current_fee) / 1e4 AS current_fee_pct,
  toFloat64(p.token0_price) / 1e18 AS price0_in_token1,
  toFloat64(p.token1_price) / 1e18 AS price1_in_token0,
  p.tick AS tick,
  p.gauge_is_alive AS gauge_is_alive,
  p.gauge_address AS gauge_address,
  p.fee_voting_reward_address AS fee_voting_reward_address,
  p.bribe_voting_reward_address AS bribe_voting_reward_address,
  p.factory_address AS factory_address,
  p.nfpm_address AS nfpm_address,
  p.created_block AS created_block,
  toDateTime(p.last_updated) AS last_updated,
  p.reserve0 AS reserve0_raw,
  p.reserve1 AS reserve1_raw,
  p.tvl_usd AS tvl_usd_raw,
  p.volume_usd AS volume_usd_raw,
  p.fees_usd AS fees_usd_raw,
  p.id AS envio_id,
  nullIf(rt.root_pool_address, '') AS root_pool_address
FROM {{db}}._pool AS p FINAL
INNER JOIN {{db}}.pool_dim AS d ON d.chain_id = p.chain_id AND d.pool_address = p.pool_address
LEFT JOIN {{db}}.leaf_pool_root_totals AS rt ON rt.leaf_chain_id = p.chain_id AND rt.leaf_pool_address = p.pool_address;

-- One row per (user, pool): cumulative activity and current balances.
CREATE OR REPLACE VIEW {{db}}.user_pools AS
SELECT
  u.chain_id AS chain_id,
  d.chain_name AS chain_name,
  d.deployment AS deployment,
  u.user_address AS user_address,
  u.pool_address AS pool_address,
  d.pair AS pair,
  d.pool_type AS pool_type,
  toFloat64(u.lp_balance) / 1e18 AS lp_balance,
  u.swaps AS swaps_total,
  toFloat64(u.swap_volume_usd) / 1e18 AS swap_volume_usd_total,
  toFloat64(u.swap_volume0) / pow(10, d.token0_decimals) AS swap_volume0_total,
  toFloat64(u.swap_volume1) / pow(10, d.token1_decimals) AS swap_volume1_total,
  toFloat64(u.fees_paid_usd) / 1e18 AS fees_paid_usd_total,
  toFloat64(u.liquidity_added_usd) / 1e18 AS liquidity_added_usd_total,
  toFloat64(u.liquidity_removed_usd) / 1e18 AS liquidity_removed_usd_total,
  toFloat64(u.liquidity_added0) / pow(10, d.token0_decimals) AS liquidity_added0_total,
  toFloat64(u.liquidity_added1) / pow(10, d.token1_decimals) AS liquidity_added1_total,
  toFloat64(u.liquidity_removed0) / pow(10, d.token0_decimals) AS liquidity_removed0_total,
  toFloat64(u.liquidity_removed1) / pow(10, d.token1_decimals) AS liquidity_removed1_total,
  toFloat64(u.unstaked_fees_collected_usd) / 1e18 AS unstaked_fees_collected_usd_total,
  toFloat64(u.staked_fees_collected_usd) / 1e18 AS staked_fees_collected_usd_total,
  toFloat64(u.gauge_rewards_claimed_usd) / 1e18 AS gauge_rewards_claimed_usd_total,
  toFloat64(u.gauge_rewards_claimed) / 1e18 AS gauge_rewards_claimed_total,
  toFloat64(u.bribes_claimed_usd) / 1e18 AS bribes_claimed_usd_total,
  toFloat64(u.fee_rewards_claimed_usd) / 1e18 AS fee_rewards_claimed_usd_total,
  toFloat64(u.staked_liquidity) AS staked_liquidity,
  toFloat64(u.staked_usd) / 1e18 AS staked_usd_as_of_last_activity,
  u.staked_cl_position_token_ids AS staked_cl_position_token_ids,
  toFloat64(u.venft_amount_staked) / 1e18 AS venft_votes,
  u.alm_address AS alm_address,
  toFloat64(u.alm_lp_amount) / 1e18 AS alm_lp_amount,
  u.gauge_deposits AS gauge_deposits_total,
  u.gauge_withdrawals AS gauge_withdrawals_total,
  u.flash_loans AS flash_loans_total,
  toDateTime(u.first_activity) AS first_activity,
  toDateTime(u.last_activity) AS last_activity,
  u.id AS envio_id
FROM {{db}}._user_pool AS u FINAL
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = u.chain_id AND d.pool_address = u.pool_address;

-- CL NFT positions that exist now (burned ones are gone), valued at the pool's current price.
-- amount0 / amount1 / value_usd are computed here from liquidity, the range and the pool's
-- current sqrtPriceX96 (Uniswap v3 maths in Float64): approximate, not indexed values.
CREATE OR REPLACE VIEW {{db}}.positions AS
SELECT
  x.chain_id AS chain_id,
  d.chain_name AS chain_name,
  d.deployment AS deployment,
  x.nfpm_address AS nfpm_address,
  x.token_id AS token_id,
  x.owner AS owner,
  x.is_staked AS is_staked,
  x.pool_address AS pool_address,
  d.pair AS pair,
  d.pool_type AS pool_type,
  x.tick_lower AS tick_lower,
  x.tick_upper AS tick_upper,
  pl.tick AS pool_tick,
  ifNull(pl.tick >= x.tick_lower AND pl.tick < x.tick_upper, false) AS in_range,
  toFloat64(x.liquidity) AS liquidity,
  multiIf(pl.tick IS NULL, NULL,
          pl.tick < x.tick_lower, L * (1 / sa - 1 / sb),
          pl.tick >= x.tick_upper, 0,
          L * (1 / sp - 1 / sb)) / pow(10, d.token0_decimals) AS amount0,
  multiIf(pl.tick IS NULL, NULL,
          pl.tick < x.tick_lower, 0,
          pl.tick >= x.tick_upper, L * (sb - sa),
          L * (sp - sa)) / pow(10, d.token1_decimals) AS amount1,
  amount0 * t0.price_usd + amount1 * t1.price_usd AS value_usd,
  x.mint_tx_hash AS mint_tx_hash,
  toDateTime(x.last_updated) AS last_updated,
  x.id AS envio_id
FROM (
  SELECT *, toFloat64(liquidity) AS L, pow(1.0001, tick_lower / 2) AS sa, pow(1.0001, tick_upper / 2) AS sb
  FROM {{db}}._position FINAL
) AS x
LEFT JOIN (SELECT chain_id, pool_address, tick, toFloat64(sqrt_price_x96) / pow(2, 96) AS sp FROM {{db}}._pool FINAL) AS pl
  ON pl.chain_id = x.chain_id AND pl.pool_address = x.pool_address
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = x.chain_id AND d.pool_address = x.pool_address
LEFT JOIN (SELECT chain_id, token_address, toFloat64(price_usd) / 1e18 AS price_usd FROM {{db}}._token FINAL) AS t0
  ON t0.chain_id = x.chain_id AND t0.token_address = d.token0_address
LEFT JOIN (SELECT chain_id, token_address, toFloat64(price_usd) / 1e18 AS price_usd FROM {{db}}._token FINAL) AS t1
  ON t1.chain_id = x.chain_id AND t1.token_address = d.token1_address;

-- veNFT locks (legacy VELO / AERO voting escrow; Optimism and Base only).
CREATE OR REPLACE VIEW {{db}}.venfts AS
SELECT
  v.chain_id AS chain_id,
  c.chain_name AS chain_name,
  v.token_id AS token_id,
  v.owner AS owner,
  toFloat64(v.locked_amount) / 1e18 AS locked_amount,
  v.is_permanent AS is_permanent,
  if(v.is_permanent OR v.locktime = 0, NULL, toDateTime(v.locktime)) AS lock_end,
  v.is_alive AS is_alive,
  toDateTime(v.last_updated) AS last_updated,
  v.id AS envio_id
FROM {{db}}._venft AS v FINAL
LEFT JOIN {{db}}.chains AS c ON c.chain_id = v.chain_id;

-- Current vote weight of each veNFT on each pool.
CREATE OR REPLACE VIEW {{db}}.venft_votes AS
SELECT
  v.chain_id AS chain_id,
  v.token_id AS token_id,
  v.pool_address AS pool_address,
  d.pair AS pair,
  toFloat64(v.votes) / 1e18 AS votes,
  toDateTime(v.last_updated) AS last_updated
FROM {{db}}._venft_vote AS v FINAL
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = v.chain_id AND d.pool_address = v.pool_address
WHERE v.votes != 0;

-- ALM LP wrappers and the strategy position each manages.
CREATE OR REPLACE VIEW {{db}}.alm_wrappers AS
SELECT
  a.chain_id AS chain_id,
  d.chain_name AS chain_name,
  a.wrapper_address AS wrapper_address,
  a.pool_address AS pool_address,
  d.pair AS pair,
  toFloat64(a.lp_amount) / 1e18 AS lp_amount,
  a.token_id AS position_token_id,
  a.tick_lower AS tick_lower,
  a.tick_upper AS tick_upper,
  toFloat64(a.liquidity) AS liquidity,
  a.strategy_type AS strategy_type,
  a.tick_neighborhood AS tick_neighborhood,
  a.position_width AS position_width,
  toDateTime(a.creation_time) AS created_at,
  toDateTime(a.last_updated) AS last_updated
FROM {{db}}._alm_wrapper AS a FINAL
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = a.chain_id AND d.pool_address = a.pool_address;

-- Token prices, one row per token per clock hour in which the indexer refreshed the price
-- (TokenPriceSnapshot). price_source: pinned / pool / canonical = priced this hour; carried =
-- last price kept (< 7 days old); unpriced / override = 0. Older rows may say rebind, fresh,
-- pool-implied or nothing.
CREATE OR REPLACE VIEW {{db}}.token_prices_hourly AS
SELECT
  p.chain_id AS chain_id,
  p.token_address AS token_address,
  t.symbol AS symbol,
  toStartOfHour(p.refreshed_at) AS hour,
  toFloat64(p.price_usd) / 1e18 AS price_usd,
  p.price_source AS price_source,
  ifNull(CAST(p.price_source AS Nullable(String)), '') IN ('pinned', 'pool', 'canonical') AS is_fresh,
  p.pricing_pool_id AS pricing_pool_id,
  p.pricing_source_token_id AS pricing_source_token_id,
  toFloat64(p.pricing_depth_usd) / 1e18 AS pricing_depth_usd,
  p.is_whitelisted AS is_whitelisted,
  toDateTime(p.refreshed_at) AS refreshed_at
FROM {{db}}._token_price AS p FINAL
LEFT JOIN (SELECT chain_id, token_address, symbol FROM {{db}}._token FINAL) AS t
  ON t.chain_id = p.chain_id AND t.token_address = p.token_address;

-- Pool series. One row per pool per hour (day) in which the pool changed; the state is the
-- one after the pool's last change in that period (exact, from envio's per-block history).
-- Flows (volume, fees, swaps, rewards) are the change of the cumulative counter since the
-- pool's previous row (stored with it as prev_*, so no window function is needed and filters
-- on chain_id / pool_address / hour reach the table's sort key). A period without a row had
-- no change. Levels (tvl, reserves, staked) are end-of-period; carry the last row forward for
-- periods without one. For a superchain leaf pool, votes (end of period) and emissions (in the
-- period) are its root pool's, and a period in which only the root pool changed has a row too,
-- with pool_changed = 0, the leaf pool's levels carried from its last change and no leaf flows.
CREATE OR REPLACE VIEW {{db}}.pool_hourly AS
SELECT
  s.chain_id AS chain_id,
  d.chain_name AS chain_name,
  s.deployment AS deployment,
  s.pool_address AS pool_address,
  d.pair AS pair,
  d.pool_type AS pool_type,
  s.period AS hour,
  toFloat64(s.tvl_usd) / 1e18 AS tvl_usd,
  toFloat64((s.tvl_usd - s.prev_tvl_usd)) / 1e18 AS tvl_usd_change,
  toFloat64(s.reserve0) / pow(10, d.token0_decimals) AS reserve0,
  toFloat64(s.reserve1) / pow(10, d.token1_decimals) AS reserve1,
  toFloat64(s.staked_usd) / 1e18 AS staked_usd,
  toFloat64((s.staked_usd - s.prev_staked_usd)) / 1e18 AS staked_usd_change,
  if(s.tvl_usd > 0, toFloat64(s.staked_usd) / toFloat64(s.tvl_usd), NULL) AS staked_share,
  toFloat64((s.volume_usd - s.prev_volume_usd)) / 1e18 AS volume_usd,
  toFloat64((s.volume0 - s.prev_volume0)) / pow(10, d.token0_decimals) AS volume0,
  toFloat64((s.volume1 - s.prev_volume1)) / pow(10, d.token1_decimals) AS volume1,
  toFloat64((s.fees_usd - s.prev_fees_usd)) / 1e18 AS fees_usd,
  toInt64(s.swaps) - toInt64(s.prev_swaps) AS swaps,
  toFloat64((s.unstaked_fees_collected_usd - s.prev_unstaked_fees_collected_usd)) / 1e18 AS unstaked_fees_collected_usd,
  toFloat64((s.staked_fees_collected_usd - s.prev_staked_fees_collected_usd)) / 1e18 AS staked_fees_collected_usd,
  toFloat64(if(r.leaf_pool_address != '', if(r.period = s.period, r.emissions_flow_raw, toInt256(0)),
               s.emissions - s.prev_emissions)) / 1e18 AS emissions,
  toFloat64(if(r.leaf_pool_address != '', if(r.period = s.period, r.emissions_usd_flow_raw, toInt256(0)),
               s.emissions_usd - s.prev_emissions_usd)) / 1e18 AS emissions_usd,
  toFloat64((s.gauge_rewards_claimed_usd - s.prev_gauge_rewards_claimed_usd)) / 1e18 AS gauge_rewards_claimed_usd,
  toFloat64((s.bribes_claimed_usd - s.prev_bribes_claimed_usd)) / 1e18 AS bribes_claimed_usd,
  toFloat64((s.fee_rewards_claimed_usd - s.prev_fee_rewards_claimed_usd)) / 1e18 AS fee_rewards_claimed_usd,
  toFloat64(ifNull(s.flash_loan_volume_usd, 0) - ifNull(s.prev_flash_loan_volume_usd, 0)) / 1e18 AS flash_loan_volume_usd,
  toFloat64(if(r.leaf_pool_address != '', r.votes_raw, s.votes)) / 1e18 AS votes,
  toFloat64(s.gauge_reward_balance) / 1e18 AS gauge_reward_balance,
  toFloat64(s.gauge_reward_balance_usd) / 1e18 AS gauge_reward_balance_usd,
  toFloat64(s.current_fee) / 1e4 AS current_fee_pct,
  toFloat64(s.token0_price) / 1e18 AS price0_in_token1,
  s.tick AS tick,
  toFloat64(s.volume_usd) / 1e18 AS volume_usd_total,
  toFloat64(s.fees_usd) / 1e18 AS fees_usd_total,
  s.swaps AS swaps_total,
  toDateTime(s.last_updated) AS last_change_at,
  s.pool_changed AS pool_changed
FROM (
  SELECT *, toUInt8(1) AS pool_changed FROM {{db}}._pool_hour FINAL
  UNION ALL
  -- periods in which only the root pool of a superchain leaf pool changed (a vote or an emission
  -- on the root chain): the leaf pool's state carried from its last change, no leaf flows
  SELECT l.* REPLACE (
      r.period AS period,
      l.tvl_usd AS prev_tvl_usd,
      l.staked_usd AS prev_staked_usd,
      l.volume_usd AS prev_volume_usd,
      l.volume0 AS prev_volume0,
      l.volume1 AS prev_volume1,
      l.fees_usd AS prev_fees_usd,
      l.swaps AS prev_swaps,
      l.unstaked_fees_collected_usd AS prev_unstaked_fees_collected_usd,
      l.staked_fees_collected_usd AS prev_staked_fees_collected_usd,
      l.emissions AS prev_emissions,
      l.emissions_usd AS prev_emissions_usd,
      l.gauge_rewards_claimed_usd AS prev_gauge_rewards_claimed_usd,
      l.bribes_claimed_usd AS prev_bribes_claimed_usd,
      l.fee_rewards_claimed_usd AS prev_fee_rewards_claimed_usd,
      l.flash_loan_volume_usd AS prev_flash_loan_volume_usd
    ), toUInt8(0) AS pool_changed
  FROM {{db}}.leaf_pool_root_hourly AS r
  LEFT JOIN (SELECT chain_id, pool_address, period FROM {{db}}._pool_hour FINAL
                  WHERE (chain_id, pool_address) IN (SELECT leaf_chain_id, leaf_pool_address FROM {{db}}.leaf_pool_root_hourly)) AS e
    ON e.chain_id = r.leaf_chain_id AND e.pool_address = r.leaf_pool_address AND e.period = r.period
  ASOF INNER JOIN (SELECT * FROM {{db}}._pool_hour FINAL
                   WHERE (chain_id, pool_address) IN (SELECT leaf_chain_id, leaf_pool_address FROM {{db}}.leaf_pool_root_hourly)) AS l
    ON l.chain_id = r.leaf_chain_id AND l.pool_address = r.leaf_pool_address AND l.period <= r.period
  WHERE e.pool_address = ''  -- no leaf row in that period (LEFT ANTI JOIN returned nothing here, CH 26.2)
) AS s
ASOF LEFT JOIN {{db}}.leaf_pool_root_hourly AS r
  ON r.leaf_chain_id = s.chain_id AND r.leaf_pool_address = s.pool_address AND r.period <= s.period
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = s.chain_id AND d.pool_address = s.pool_address;

CREATE OR REPLACE VIEW {{db}}.pool_daily AS
SELECT
  s.chain_id AS chain_id,
  d.chain_name AS chain_name,
  s.deployment AS deployment,
  s.pool_address AS pool_address,
  d.pair AS pair,
  d.pool_type AS pool_type,
  toDate(s.period) AS day,
  toFloat64(s.tvl_usd) / 1e18 AS tvl_usd,
  toFloat64((s.tvl_usd - s.prev_tvl_usd)) / 1e18 AS tvl_usd_change,
  toFloat64(s.reserve0) / pow(10, d.token0_decimals) AS reserve0,
  toFloat64(s.reserve1) / pow(10, d.token1_decimals) AS reserve1,
  toFloat64(s.staked_usd) / 1e18 AS staked_usd,
  toFloat64((s.staked_usd - s.prev_staked_usd)) / 1e18 AS staked_usd_change,
  if(s.tvl_usd > 0, toFloat64(s.staked_usd) / toFloat64(s.tvl_usd), NULL) AS staked_share,
  toFloat64((s.volume_usd - s.prev_volume_usd)) / 1e18 AS volume_usd,
  toFloat64((s.volume0 - s.prev_volume0)) / pow(10, d.token0_decimals) AS volume0,
  toFloat64((s.volume1 - s.prev_volume1)) / pow(10, d.token1_decimals) AS volume1,
  toFloat64((s.fees_usd - s.prev_fees_usd)) / 1e18 AS fees_usd,
  toInt64(s.swaps) - toInt64(s.prev_swaps) AS swaps,
  toFloat64((s.unstaked_fees_collected_usd - s.prev_unstaked_fees_collected_usd)) / 1e18 AS unstaked_fees_collected_usd,
  toFloat64((s.staked_fees_collected_usd - s.prev_staked_fees_collected_usd)) / 1e18 AS staked_fees_collected_usd,
  toFloat64(if(r.leaf_pool_address != '', if(r.period = s.period, r.emissions_flow_raw, toInt256(0)),
               s.emissions - s.prev_emissions)) / 1e18 AS emissions,
  toFloat64(if(r.leaf_pool_address != '', if(r.period = s.period, r.emissions_usd_flow_raw, toInt256(0)),
               s.emissions_usd - s.prev_emissions_usd)) / 1e18 AS emissions_usd,
  toFloat64((s.gauge_rewards_claimed_usd - s.prev_gauge_rewards_claimed_usd)) / 1e18 AS gauge_rewards_claimed_usd,
  toFloat64((s.bribes_claimed_usd - s.prev_bribes_claimed_usd)) / 1e18 AS bribes_claimed_usd,
  toFloat64((s.fee_rewards_claimed_usd - s.prev_fee_rewards_claimed_usd)) / 1e18 AS fee_rewards_claimed_usd,
  toFloat64(ifNull(s.flash_loan_volume_usd, 0) - ifNull(s.prev_flash_loan_volume_usd, 0)) / 1e18 AS flash_loan_volume_usd,
  toFloat64(if(r.leaf_pool_address != '', r.votes_raw, s.votes)) / 1e18 AS votes,
  toFloat64(s.gauge_reward_balance) / 1e18 AS gauge_reward_balance,
  toFloat64(s.gauge_reward_balance_usd) / 1e18 AS gauge_reward_balance_usd,
  toFloat64(s.current_fee) / 1e4 AS current_fee_pct,
  toFloat64(s.token0_price) / 1e18 AS price0_in_token1,
  s.tick AS tick,
  toFloat64(s.volume_usd) / 1e18 AS volume_usd_total,
  toFloat64(s.fees_usd) / 1e18 AS fees_usd_total,
  s.swaps AS swaps_total,
  toDateTime(s.last_updated) AS last_change_at,
  s.pool_changed AS pool_changed
FROM (
  SELECT *, toUInt8(1) AS pool_changed FROM {{db}}._pool_day FINAL
  UNION ALL
  -- periods in which only the root pool of a superchain leaf pool changed (a vote or an emission
  -- on the root chain): the leaf pool's state carried from its last change, no leaf flows
  SELECT l.* REPLACE (
      r.period AS period,
      l.tvl_usd AS prev_tvl_usd,
      l.staked_usd AS prev_staked_usd,
      l.volume_usd AS prev_volume_usd,
      l.volume0 AS prev_volume0,
      l.volume1 AS prev_volume1,
      l.fees_usd AS prev_fees_usd,
      l.swaps AS prev_swaps,
      l.unstaked_fees_collected_usd AS prev_unstaked_fees_collected_usd,
      l.staked_fees_collected_usd AS prev_staked_fees_collected_usd,
      l.emissions AS prev_emissions,
      l.emissions_usd AS prev_emissions_usd,
      l.gauge_rewards_claimed_usd AS prev_gauge_rewards_claimed_usd,
      l.bribes_claimed_usd AS prev_bribes_claimed_usd,
      l.fee_rewards_claimed_usd AS prev_fee_rewards_claimed_usd,
      l.flash_loan_volume_usd AS prev_flash_loan_volume_usd
    ), toUInt8(0) AS pool_changed
  FROM {{db}}.leaf_pool_root_daily AS r
  LEFT JOIN (SELECT chain_id, pool_address, period FROM {{db}}._pool_day FINAL
                  WHERE (chain_id, pool_address) IN (SELECT leaf_chain_id, leaf_pool_address FROM {{db}}.leaf_pool_root_daily)) AS e
    ON e.chain_id = r.leaf_chain_id AND e.pool_address = r.leaf_pool_address AND e.period = r.period
  ASOF INNER JOIN (SELECT * FROM {{db}}._pool_day FINAL
                   WHERE (chain_id, pool_address) IN (SELECT leaf_chain_id, leaf_pool_address FROM {{db}}.leaf_pool_root_daily)) AS l
    ON l.chain_id = r.leaf_chain_id AND l.pool_address = r.leaf_pool_address AND l.period <= r.period
  WHERE e.pool_address = ''  -- no leaf row in that period (LEFT ANTI JOIN returned nothing here, CH 26.2)
) AS s
ASOF LEFT JOIN {{db}}.leaf_pool_root_daily AS r
  ON r.leaf_chain_id = s.chain_id AND r.leaf_pool_address = s.pool_address AND r.period <= s.period
LEFT JOIN {{db}}.pool_dim AS d ON d.chain_id = s.chain_id AND d.pool_address = s.pool_address;

-- Chain x deployment totals per day / hour. tvl_usd and staked_usd carry every pool's last
-- known value forward (running sum of the pools' changes), so a day on which a pool did not
-- change still counts its liquidity. Days on which no pool of that chain and deployment
-- changed have no row. emissions_usd includes superchain leaf pools' root-side emissions; a
-- period in which only a root pool changed does not count as an active pool.
CREATE OR REPLACE VIEW {{db}}.chain_daily AS
SELECT
  chain_id,
  any(chain_name) AS chain_name,
  deployment,
  day,
  sum(volume_usd) AS volume_usd,
  sum(fees_usd) AS fees_usd,
  sum(swaps) AS swaps,
  countIf(pool_changed = 1) AS active_pools,
  sum(sum(tvl_usd_change)) OVER (PARTITION BY chain_id, deployment ORDER BY day ROWS UNBOUNDED PRECEDING) AS tvl_usd,
  sum(sum(staked_usd_change)) OVER (PARTITION BY chain_id, deployment ORDER BY day ROWS UNBOUNDED PRECEDING) AS staked_usd,
  sum(unstaked_fees_collected_usd) AS unstaked_fees_collected_usd,
  sum(staked_fees_collected_usd) AS staked_fees_collected_usd,
  sum(emissions_usd) AS emissions_usd,
  sum(gauge_rewards_claimed_usd) AS gauge_rewards_claimed_usd,
  sum(bribes_claimed_usd) AS bribes_claimed_usd,
  sum(fee_rewards_claimed_usd) AS fee_rewards_claimed_usd
FROM {{db}}.pool_daily
GROUP BY chain_id, deployment, day;

CREATE OR REPLACE VIEW {{db}}.chain_hourly AS
SELECT
  chain_id,
  any(chain_name) AS chain_name,
  deployment,
  hour,
  sum(volume_usd) AS volume_usd,
  sum(fees_usd) AS fees_usd,
  sum(swaps) AS swaps,
  countIf(pool_changed = 1) AS active_pools,
  sum(sum(tvl_usd_change)) OVER (PARTITION BY chain_id, deployment ORDER BY hour ROWS UNBOUNDED PRECEDING) AS tvl_usd,
  sum(sum(staked_usd_change)) OVER (PARTITION BY chain_id, deployment ORDER BY hour ROWS UNBOUNDED PRECEDING) AS staked_usd
FROM {{db}}.pool_hourly
GROUP BY chain_id, deployment, hour;

-- A user's hourly snapshots in every pool on one chain (parameterized view):
--   SELECT * FROM user_pool_snapshots(chain_id = 10, user = '0xAbC...')   -- any letter case
-- Reads only that user's slice of envio's snapshot table: its ids start with
-- {chainId}-{checksummed user}, so the address is checksummed here (EIP-55) to seek on the id.
-- Rows are written only in hours in which the user was active.
CREATE OR REPLACE VIEW {{db}}.user_pool_snapshots AS
SELECT
  chainId AS chain_id,
  lower(userAddress) AS user_address,
  lower(poolAddress) AS pool_address,
  toDateTime(timestamp) AS hour,
  toFloat64(toInt256OrZero(lpBalance)) / 1e18 AS lp_balance,
  toUInt64OrZero(numberOfSwaps) AS swaps_total,
  toFloat64(toInt256OrZero(totalSwapVolumeUSD)) / 1e18 AS swap_volume_usd_total,
  toFloat64(toInt256OrZero(totalFeesContributedUSD)) / 1e18 AS fees_paid_usd_total,
  toFloat64(toInt256OrZero(totalLiquidityAddedUSD)) / 1e18 AS liquidity_added_usd_total,
  toFloat64(toInt256OrZero(totalLiquidityRemovedUSD)) / 1e18 AS liquidity_removed_usd_total,
  toFloat64(toInt256OrZero(totalUnstakedFeesCollectedUSD)) / 1e18 AS unstaked_fees_collected_usd_total,
  toFloat64(toInt256OrZero(totalStakedFeesCollectedUSD)) / 1e18 AS staked_fees_collected_usd_total,
  toFloat64(toInt256OrZero(totalGaugeRewardsClaimedUSD)) / 1e18 AS gauge_rewards_claimed_usd_total,
  toFloat64(toInt256OrZero(currentLiquidityStaked)) AS staked_liquidity,
  toFloat64(toInt256OrZero(currentLiquidityStakedUSD)) / 1e18 AS staked_usd_as_of_last_activity,
  toDateTime(lastActivityTimestamp) AS last_activity
FROM (
  SELECT *
  FROM {{src}}.envio_history_UserStatsPerPoolSnapshot
  WHERE startsWith(id, concat(toString({chain_id:Int32}), '-0x', arrayStringConcat(arrayMap(
          (ch, hx) -> if(ch >= 'a' AND hx >= '8', upper(ch), ch),
          splitByString('', substring(lower({user:String}), 3)),
          splitByString('', substring(lower(hex(keccak256(substring(lower({user:String}), 3)))), 1, 40))))))
    AND envio_checkpoint_id <= {{frontier}}
  ORDER BY id, envio_checkpoint_id DESC
  LIMIT 1 BY id
)
WHERE envio_change = 'SET';

-- Data freshness per chain: the last block the indexer committed, and the last time a pool or
-- a token price changed there (block time). Compare indexed_block with the chain head.
CREATE OR REPLACE VIEW {{db}}.freshness AS
SELECT
  c.chain_id AS chain_id,
  c.chain_name AS chain_name,
  c.wound_down AS wound_down,
  b.block_number AS indexed_block,
  b.checkpoint_id AS indexed_checkpoint,
  ev.last_pool_change AS last_pool_change,
  ev.last_price_refresh AS last_price_refresh,
  dateDiff('minute', greatest(ev.last_pool_change, ev.last_price_refresh), now()) AS minutes_behind_now,
  ly.layer_checkpoint AS layer_checkpoint,
  ly.layer_loaded_at AS layer_loaded_at
FROM {{db}}.chains AS c
INNER JOIN (
  SELECT f.chain_id AS chain_id, f.checkpoint_id AS checkpoint_id, k.block_number AS block_number
  FROM (SELECT chain_id, checkpoint_id FROM {{src}}.envio_chains FINAL) AS f
  LEFT JOIN (
    SELECT chain_id, id, block_number FROM {{src}}.envio_checkpoints
    WHERE (chain_id, id) IN (SELECT chain_id, checkpoint_id FROM {{src}}.envio_chains FINAL)
  ) AS k ON k.chain_id = f.chain_id AND k.id = f.checkpoint_id
) AS b ON b.chain_id = c.chain_id
LEFT JOIN (
  SELECT chain_id, max(lp) AS last_pool_change, max(lr) AS last_price_refresh FROM (
    SELECT chain_id, toDateTime(max(last_updated)) AS lp, toDateTime(0) AS lr FROM {{db}}._pool FINAL GROUP BY chain_id
    UNION ALL
    SELECT chain_id, toDateTime(0), toDateTime(max(last_price_refresh)) FROM {{db}}._token FINAL GROUP BY chain_id
  ) GROUP BY chain_id
) AS ev ON ev.chain_id = c.chain_id
LEFT JOIN (
  -- per checkpoint sequence: the whole indexer when shared, each chain when per-chain
  SELECT {{scope:chain_id}} AS scope, max(_version) AS layer_checkpoint, max(_loaded_at) AS layer_loaded_at
  FROM {{db}}._pool GROUP BY scope
) AS ly ON ly.scope = {{scope:c.chain_id}};
