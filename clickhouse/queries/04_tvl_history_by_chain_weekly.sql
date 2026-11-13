-- TVL per chain at the end of each week (carry-forward of every pool's last state)
SELECT toStartOfWeek(day) AS week, chain_name, round(argMax(tvl_usd, day)) AS tvl_usd
FROM chain_daily
GROUP BY week, chain_name
ORDER BY week, chain_name;
