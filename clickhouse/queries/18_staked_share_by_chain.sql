-- Share of TVL staked in gauges, per chain, now and 30 days before the last day of data
WITH (SELECT max(day) FROM chain_daily) AS last_day
SELECT chain_name,
       round(sum(staked_usd) / sum(tvl_usd), 4) AS staked_share_now,
       round((SELECT sum(staked) / sum(tvl) FROM (
                SELECT argMax(staked_usd, day) AS staked, argMax(tvl_usd, day) AS tvl FROM chain_daily c
                WHERE c.chain_name = p.chain_name AND day <= last_day - 30 GROUP BY deployment)), 4) AS staked_share_30d_ago
FROM pools AS p
GROUP BY chain_name
ORDER BY sum(tvl_usd) DESC;
