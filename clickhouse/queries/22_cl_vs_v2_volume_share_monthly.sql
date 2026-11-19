-- CL versus V2 share of volume per month
SELECT toStartOfMonth(day) AS month,
       round(sumIf(volume_usd, pool_type LIKE 'CL%') / sum(volume_usd), 4) AS cl_share,
       round(sum(volume_usd)) AS total_volume
FROM pool_daily
GROUP BY month
ORDER BY month;
