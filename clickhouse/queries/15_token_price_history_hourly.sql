-- One token's hourly USD price, with where each price came from (WETH on Unichain here)
SELECT hour, round(price_usd, 4) AS price_usd, price_source, pricing_pool_id, round(pricing_depth_usd) AS depth_usd
FROM token_prices_hourly
WHERE chain_id = 130 AND token_address = '0x4200000000000000000000000000000000000006'
ORDER BY hour DESC
LIMIT 168;
