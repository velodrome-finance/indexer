-- TVL now, by chain and deployment
SELECT chain_name, deployment, count() AS pools, countIf(tvl_usd > 0) AS pools_with_tvl,
       round(sum(tvl_usd)) AS tvl, round(sum(staked_usd)) AS staked
FROM pools
GROUP BY chain_name, deployment
ORDER BY tvl DESC;
