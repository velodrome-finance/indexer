-- Superchain root-side views (ADR 0009 step 2), installed by clickhouse/analytics.py when the
-- indexer has RootPool. Placeholders as in views.sql.
--
-- A superchain leaf pool's votes and emissions happen on the root chain (Optimism) against a
-- placeholder root pool. The indexer stores them on the root chain only (RootPool,
-- RootPoolVote; per-chain entities, ADR 0009) and these views join them to the leaf pool. They
-- replace the empty leaf_pool_root_* views of views.sql, through which pools, pool_hourly and
-- pool_daily show a leaf pool's root-side votes and emissions.
--
-- Big integers are exact Int256 (*_raw, as envio stored them) with Float64 companions in whole
-- units (/ 1e18) like the other views.

-- Current state of every root pool (RootPool), committed rows only.
CREATE OR REPLACE VIEW {{db}}.root_pools AS
SELECT
  chainId AS root_chain_id,
  lower(rootPoolAddress) AS root_pool_address,
  leafChainId AS leaf_chain_id,
  isCL AS is_cl,
  lower(token0) AS token0_address,
  lower(token1) AS token1_address,
  toInt32OrNull(toString(tickSpacing)) AS tick_spacing,
  isStable AS is_stable,
  lower(rootFactoryAddress) AS root_factory_address,
  rootPoolMatchingHash AS root_pool_matching_hash,
  lower(gaugeAddress) AS gauge_address,
  gaugeIsAlive AS gauge_is_alive,
  toInt256OrZero(toString(veNFTamountStaked)) AS votes_raw,
  toFloat64(toInt256OrZero(toString(veNFTamountStaked))) / 1e18 AS votes,
  toInt256OrZero(toString(totalEmissions)) AS emissions_raw,
  toFloat64(toInt256OrZero(toString(totalEmissions))) / 1e18 AS emissions_total,
  toInt256OrZero(toString(totalEmissionsUSD)) AS emissions_usd_raw,
  toFloat64(toInt256OrZero(toString(totalEmissionsUSD))) / 1e18 AS emissions_usd_total,
  toUInt64OrZero(toString(numberOfDistributions)) AS distributions_total,
  toDateTime(createdTimestamp) AS created_at,
  toDateTime(lastUpdatedTimestamp) AS last_updated
FROM (
  SELECT * FROM {{src}}.envio_history_RootPool
  WHERE envio_checkpoint_id <= {{frontier}}
  ORDER BY id, envio_checkpoint_id DESC
  LIMIT 1 BY id
)
WHERE envio_change = 'SET';

-- Root pool <-> leaf pool. CL: the leaf Pool with the root pool's matching hash
-- ({leafChainId}_{token0}_{token1}_{tickSpacing}) whose factory is the leaf CLFactory deployed at
-- the root factory's address. V2: the leaf's RootPool_LeafPool row (the leaf chain's LpHelper
-- answer, written by the leaf chain), for root pools the V2 RootPoolFactory created.
CREATE OR REPLACE VIEW {{db}}.root_leaf_pools AS
SELECT
  r.root_chain_id AS root_chain_id,
  r.root_pool_address AS root_pool_address,
  p.chain_id AS leaf_chain_id,
  p.pool_address AS leaf_pool_address,
  'CL' AS kind
FROM {{db}}.root_pools AS r
INNER JOIN (SELECT chain_id, pool_address, factory_address, root_pool_matching_hash FROM {{db}}._pool FINAL
            WHERE root_pool_matching_hash IS NOT NULL AND root_pool_matching_hash != '') AS p
  ON p.root_pool_matching_hash = r.root_pool_matching_hash AND p.factory_address = r.root_factory_address
     AND p.chain_id = r.leaf_chain_id
WHERE r.is_cl
UNION ALL
SELECT
  r.root_chain_id,
  r.root_pool_address,
  m.leaf_chain_id,
  m.leaf_pool_address,
  'V2'
FROM {{db}}.root_pools AS r
INNER JOIN (
  SELECT rootChainId AS root_chain_id, lower(rootPoolAddress) AS root_pool_address,
         leafChainId AS leaf_chain_id, lower(leafPoolAddress) AS leaf_pool_address
  FROM (
    SELECT * FROM {{src}}.envio_history_RootPool_LeafPool
    WHERE envio_checkpoint_id <= {{frontier}}
    ORDER BY id, envio_checkpoint_id DESC
    LIMIT 1 BY id
  )
  WHERE envio_change = 'SET'
) AS m ON m.root_chain_id = r.root_chain_id AND m.root_pool_address = r.root_pool_address
WHERE NOT r.is_cl AND (r.leaf_chain_id IS NULL OR r.leaf_chain_id = m.leaf_chain_id);

-- Every leaf pool with a root pool: the root-side vote weight and emissions (what the leaf Pool
-- stored before the per-chain flip).
CREATE OR REPLACE VIEW {{db}}.leaf_pool_root_totals AS
SELECT
  m.leaf_chain_id AS leaf_chain_id,
  m.leaf_pool_address AS leaf_pool_address,
  m.kind AS kind,
  m.root_chain_id AS root_chain_id,
  m.root_pool_address AS root_pool_address,
  r.gauge_address AS root_gauge_address,
  r.gauge_is_alive AS root_gauge_is_alive,
  r.votes_raw AS votes_raw,
  r.votes AS votes,
  r.emissions_raw AS emissions_raw,
  r.emissions_total AS emissions_total,
  r.emissions_usd_raw AS emissions_usd_raw,
  r.emissions_usd_total AS emissions_usd_total,
  r.distributions_total AS distributions_total
FROM {{db}}.root_leaf_pools AS m
INNER JOIN {{db}}.root_pools AS r
  ON r.root_chain_id = m.root_chain_id AND r.root_pool_address = m.root_pool_address;

-- A leaf pool's root pool series, per hour / day in which the root pool changed: end-of-period
-- vote weight and cumulative emissions, and the emissions in the period (from the layer's
-- _root_pool_hour / _root_pool_day, exact like _pool_hour).
CREATE OR REPLACE VIEW {{db}}.leaf_pool_root_hourly AS
SELECT
  m.leaf_chain_id AS leaf_chain_id,
  m.leaf_pool_address AS leaf_pool_address,
  m.root_pool_address AS root_pool_address,
  h.period AS period,
  h.votes AS votes_raw,
  h.emissions AS emissions_raw,
  h.emissions_usd AS emissions_usd_raw,
  h.emissions - h.prev_emissions AS emissions_flow_raw,
  h.emissions_usd - h.prev_emissions_usd AS emissions_usd_flow_raw
FROM {{db}}.root_leaf_pools AS m
INNER JOIN (SELECT * FROM {{db}}._root_pool_hour FINAL) AS h
  ON h.chain_id = m.root_chain_id AND h.root_pool_address = m.root_pool_address;

CREATE OR REPLACE VIEW {{db}}.leaf_pool_root_daily AS
SELECT
  m.leaf_chain_id AS leaf_chain_id,
  m.leaf_pool_address AS leaf_pool_address,
  m.root_pool_address AS root_pool_address,
  h.period AS period,
  h.votes AS votes_raw,
  h.emissions AS emissions_raw,
  h.emissions_usd AS emissions_usd_raw,
  h.emissions - h.prev_emissions AS emissions_flow_raw,
  h.emissions_usd - h.prev_emissions_usd AS emissions_usd_flow_raw
FROM {{db}}.root_leaf_pools AS m
INNER JOIN (SELECT * FROM {{db}}._root_pool_day FINAL) AS h
  ON h.chain_id = m.root_chain_id AND h.root_pool_address = m.root_pool_address;

-- One veNFT's current vote on a root pool (RootPoolVote), with the leaf pool it stands for.
CREATE OR REPLACE VIEW {{db}}.root_pool_votes AS
SELECT
  v.chainId AS root_chain_id,
  toUInt64OrZero(toString(v.tokenId)) AS token_id,
  lower(v.rootPoolAddress) AS root_pool_address,
  m.leaf_chain_id AS leaf_chain_id,
  m.leaf_pool_address AS leaf_pool_address,
  toInt256OrZero(toString(v.veNFTamountStaked)) AS votes_raw,
  toFloat64(toInt256OrZero(toString(v.veNFTamountStaked))) / 1e18 AS votes,
  toDateTime(v.lastUpdatedTimestamp) AS last_updated
FROM (
  SELECT * FROM {{src}}.envio_history_RootPoolVote
  WHERE envio_checkpoint_id <= {{frontier}}
  ORDER BY id, envio_checkpoint_id DESC
  LIMIT 1 BY id
) AS v
LEFT JOIN {{db}}.root_leaf_pools AS m
  ON m.root_chain_id = v.chainId AND m.root_pool_address = lower(v.rootPoolAddress)
WHERE v.envio_change = 'SET';

-- SuperSwaps stitched from the two legs each chain writes for itself (SuperSwapOriginLeg,
-- SuperSwapDestinationLeg), by message id: the replacement of the SuperSwap entity (removed at
-- the per-chain flip, ADR 0009), which it reproduces field for field, plus the SuperSwaps the
-- handler-side stitching lost when the origin chain was processed before the destination. Like
-- the entity: per origin transaction, the first dispatched message (dispatch_index) that
-- reached a destination oUSDT swap. The entity's single `timestamp` is origin_timestamp or
-- destination_timestamp (it took whichever side the indexer processed last).
CREATE OR REPLACE VIEW {{db}}.super_swap_legs AS
SELECT
  o.messageId AS message_id,
  o.chainId AS origin_chain_id,
  toInt64OrZero(toString(o.destinationChainId)) AS destination_chain_id,
  d.chainId AS destination_leg_chain_id,
  lower(o.sender) AS sender,
  lower(o.recipient) AS recipient,
  toInt256OrZero(toString(o.oUSDTamount)) AS ousdt_amount_raw,
  lower(o.sourceChainToken) AS source_chain_token,
  toInt256OrZero(toString(o.sourceChainTokenAmountSwapped)) AS source_chain_token_amount_raw,
  lower(d.destinationChainToken) AS destination_chain_token,
  toInt256OrZero(toString(d.destinationChainTokenAmountSwapped)) AS destination_chain_token_amount_raw,
  o.transactionHash AS origin_transaction_hash,
  d.transactionHash AS destination_transaction_hash,
  toDateTime(o.timestamp) AS origin_timestamp,
  toDateTime(d.timestamp) AS destination_timestamp
FROM (
  SELECT * FROM {{src}}.envio_history_SuperSwapOriginLeg
  WHERE envio_checkpoint_id <= {{frontier}}
  ORDER BY id, envio_checkpoint_id DESC
  LIMIT 1 BY id
) AS o
INNER JOIN (
  SELECT * FROM {{src}}.envio_history_SuperSwapDestinationLeg
  WHERE envio_checkpoint_id <= {{frontier}}
  ORDER BY id, envio_checkpoint_id DESC
  LIMIT 1 BY id
) AS d ON d.messageId = o.messageId
WHERE o.envio_change = 'SET' AND d.envio_change = 'SET'
ORDER BY o.chainId, o.transactionHash, o.dispatchIndex
LIMIT 1 BY o.chainId, o.transactionHash;
