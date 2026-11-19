-- New pools per month and chain (first day with a pool change = creation day)
SELECT toStartOfMonth(first_day) AS month, chain_name, family, count() AS new_pools
FROM (
  SELECT chain_name, pool_address, if(pool_type LIKE 'CL%', 'CL', 'V2') AS family, min(day) AS first_day
  FROM pool_daily GROUP BY chain_name, pool_address, family
)
GROUP BY month, chain_name, family
ORDER BY month, chain_name, family;
