-- Aero gauges: pool fees against emissions minted, last 7 days of data (top 20 by emissions)
WITH (SELECT max(day) FROM aero_gauge_daily) AS last_day
SELECT chain_name, pair, gauge_address, round(sum(emissions_minted)) AS aero_minted,
       round(sum(emissions_minted_usd_at_base_aero)) AS minted_usd, round(sum(pool_fees_usd)) AS pool_fees_7d,
       round(sum(pool_fees_usd) / nullIf(sum(emissions_minted_usd_at_base_aero), 0), 3) AS fees_per_emission_dollar
FROM aero_gauge_daily
WHERE day > last_day - 7
GROUP BY chain_name, pair, gauge_address
ORDER BY aero_minted DESC
LIMIT 20;
