-- Share of TVL staked in gauges per chain, now and at the end of each of the last 6 months of data
SELECT chain_name, 'now' AS at, round(sum(staked_usd) / sum(tvl_usd), 4) AS staked_frac
FROM pools GROUP BY chain_name
UNION ALL
SELECT chain_name, toString(month) AS at, round(sum(staked) / sum(tvl), 4) AS staked_frac
FROM (SELECT chain_name, deployment, toStartOfMonth(day) AS month, argMax(staked_usd, day) AS staked, argMax(tvl_usd, day) AS tvl
      FROM chain_daily GROUP BY chain_name, deployment, month)
WHERE month > (SELECT max(day) FROM chain_daily) - INTERVAL 6 MONTH
GROUP BY chain_name, month
ORDER BY chain_name, at;
