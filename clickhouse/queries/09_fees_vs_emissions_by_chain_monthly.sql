-- Fees generated versus emissions (USD) per chain and month: are emissions buying volume?
SELECT toStartOfMonth(day) AS month, chain_name,
       round(sum(fees_usd)) AS fees_usd, round(sum(emissions_usd)) AS emissions_usd,
       round(sum(gauge_rewards_claimed_usd)) AS gauge_rewards_claimed_usd,
       round(sum(bribes_claimed_usd) + sum(fee_rewards_claimed_usd)) AS voter_rewards_claimed_usd,
       round(if(sum(emissions_usd) > 0, sum(fees_usd) / sum(emissions_usd), NULL), 3) AS fees_per_emission_dollar
FROM chain_daily
GROUP BY month, chain_name
ORDER BY month, chain_name;
