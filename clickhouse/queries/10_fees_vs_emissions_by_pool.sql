-- Pools ranked by lifetime emissions (USD) against the fees they generated
SELECT chain_name, pair, pool_address, round(emissions_usd_total) AS emissions_usd, round(fees_usd_total) AS fees_usd,
       round(gauge_rewards_claimed_usd_total) AS gauge_rewards_claimed_usd,
       round(if(emissions_usd_total > 0, fees_usd_total / emissions_usd_total, NULL), 3) AS fees_per_emission_dollar
FROM pools
WHERE emissions_usd_total > 0 OR gauge_rewards_claimed_usd_total > 0
ORDER BY emissions_usd DESC, gauge_rewards_claimed_usd DESC
LIMIT 20;
