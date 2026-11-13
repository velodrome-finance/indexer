-- How token prices were obtained per chain in the last 30 days of data: fresh vs carried vs unpriced
WITH (SELECT max(hour) FROM token_prices_hourly) AS last_hour
SELECT c.chain_name, ifNull(p.price_source, '(none)') AS price_source, count() AS token_hours,
       round(count() / sum(count()) OVER (PARTITION BY c.chain_name), 4) AS share
FROM token_prices_hourly AS p
INNER JOIN chains AS c ON c.chain_id = p.chain_id
WHERE p.hour > last_hour - INTERVAL 30 DAY
GROUP BY c.chain_name, price_source
ORDER BY c.chain_name, token_hours DESC;
