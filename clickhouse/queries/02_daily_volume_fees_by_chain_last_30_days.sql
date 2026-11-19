-- Daily volume, fees and swaps per chain over the last 30 days of data
-- (in production replace last_day with today())
WITH (SELECT max(day) FROM chain_daily) AS last_day
SELECT day, chain_name, deployment, round(volume_usd) AS volume, round(fees_usd) AS fees, swaps, active_pools
FROM chain_daily
WHERE day > last_day - 30
ORDER BY day DESC, volume DESC;
