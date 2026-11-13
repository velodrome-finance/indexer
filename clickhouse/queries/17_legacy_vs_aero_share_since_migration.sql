-- Legacy versus Aero share of volume, fees and TVL per day since the Aero launch (2026-10-21)
SELECT day,
       round(sumIf(volume_usd, deployment = 'AERO') / sum(volume_usd), 4) AS aero_volume_share,
       round(sumIf(fees_usd, deployment = 'AERO') / sum(fees_usd), 4) AS aero_fee_share,
       round(sumIf(tvl_usd, deployment = 'AERO') / sum(tvl_usd), 4) AS aero_tvl_share,
       round(sum(volume_usd)) AS total_volume_usd
FROM chain_daily
WHERE day >= '2026-10-21'
GROUP BY day
ORDER BY day;
