-- TVL per chain at the end of each week (carry-forward of every pool's last state)
SELECT week, chain_name, round(sum(tvl)) AS tvl_end_of_week
FROM (SELECT chain_name, deployment, toStartOfWeek(day) AS week, argMax(tvl_usd, day) AS tvl
      FROM chain_daily GROUP BY chain_name, deployment, week)
GROUP BY week, chain_name
ORDER BY week, chain_name;
