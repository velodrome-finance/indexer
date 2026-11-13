-- Hourly volume and active pools per chain over the last 7 days of data
WITH (SELECT max(hour) FROM chain_hourly) AS last_hour
SELECT hour, chain_name, volume_usd, swaps, active_pools, tvl_usd
FROM chain_hourly
WHERE hour > last_hour - INTERVAL 7 DAY
ORDER BY hour DESC, volume_usd DESC;
