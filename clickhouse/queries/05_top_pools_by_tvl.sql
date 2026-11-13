-- Top 20 pools by TVL now
SELECT chain_name, deployment, pair, pool_type, pool_address, round(tvl_usd) AS tvl_usd,
       round(staked_share, 3) AS staked_share, round(volume_usd_total) AS volume_usd_total,
       current_fee_pct
FROM pools
ORDER BY tvl_usd DESC
LIMIT 20;
