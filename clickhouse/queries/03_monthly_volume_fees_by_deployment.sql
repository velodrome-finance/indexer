-- Monthly volume and fees by deployment (legacy Velodrome / Aerodrome, Aero), all chains
SELECT toStartOfMonth(day) AS month, deployment,
       round(sum(volume_usd)) AS volume_usd, round(sum(fees_usd)) AS fees_usd, sum(swaps) AS swaps
FROM chain_daily
GROUP BY month, deployment
ORDER BY month, deployment;
