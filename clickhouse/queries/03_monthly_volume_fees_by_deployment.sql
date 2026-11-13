-- Monthly volume and fees by deployment (legacy Velodrome / Aerodrome, Aero), all chains
SELECT toStartOfMonth(day) AS month, deployment,
       round(sum(volume_usd)) AS volume, round(sum(fees_usd)) AS fees, sum(swaps) AS swap_count
FROM chain_daily
GROUP BY month, deployment
ORDER BY month, deployment;
