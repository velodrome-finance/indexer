-- Daily open / high / low / close of a token's hourly prices (fresh prices only)
SELECT toDate(hour) AS day, any(symbol) AS token,
       argMin(price_usd, hour) AS open, max(price_usd) AS high, min(price_usd) AS low, argMax(price_usd, hour) AS close,
       count() AS fresh_hours
FROM token_prices_hourly
WHERE chain_id = 130 AND token_address = '0x4200000000000000000000000000000000000006' AND is_fresh
GROUP BY day
ORDER BY day DESC
LIMIT 60;
