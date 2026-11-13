-- Top 20 pools by volume in the last 7 days of data, with fees and fee APR on average TVL
WITH (SELECT max(day) FROM chain_daily) AS last_day
SELECT chain_name, pair, pool_type, pool_address,
       round(sum(volume_usd)) AS volume_usd_7d, round(sum(fees_usd)) AS fees_usd_7d,
       round(avg(tvl_usd)) AS avg_tvl_usd,
       round(if(avg(tvl_usd) > 0, sum(fees_usd) / avg(tvl_usd) * 365 / 7, NULL), 4) AS fee_apr
FROM pool_daily
WHERE day > last_day - 7
GROUP BY chain_name, pair, pool_type, pool_address
ORDER BY volume_usd_7d DESC
LIMIT 20;
