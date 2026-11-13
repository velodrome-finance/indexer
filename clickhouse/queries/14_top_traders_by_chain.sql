-- Top 10 wallets by swap volume on each chain (routers and aggregators show up here)
SELECT chain_name, user_address, round(volume) AS volume_usd_all_pools, swap_count, pool_count
FROM (
  SELECT chain_name, user_address, sum(swap_volume_usd_total) AS volume, sum(swaps_total) AS swap_count, count() AS pool_count
  FROM user_pools
  GROUP BY chain_name, user_address
)
ORDER BY chain_name, volume DESC
LIMIT 10 BY chain_name;
