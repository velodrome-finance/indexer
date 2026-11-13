-- One pool's full daily history with cumulative totals (any pool: change chain_id / pool_address)
WITH (SELECT pool_address FROM pools WHERE chain_id = 130 ORDER BY volume_usd_total DESC LIMIT 1) AS pool
SELECT day, round(tvl_usd) AS tvl_usd, round(reserve0, 4) AS reserve0, round(reserve1, 4) AS reserve1,
       round(volume_usd) AS volume_usd, round(volume_usd_total) AS volume_usd_total, round(fees_usd, 2) AS fees_usd, swaps
FROM pool_daily
WHERE chain_id = 130 AND pool_address = pool
ORDER BY day;
