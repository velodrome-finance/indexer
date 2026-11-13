-- One pool's full daily history with cumulative totals (USDC/WETH, the busiest pool on Unichain here)
SELECT day, tvl_usd, reserve0, reserve1, volume_usd, volume_usd_total, fees_usd, swaps
FROM pool_daily
WHERE chain_id = 130 AND pool_address = '0x5438e884c621d5db08fa605b53ca04c5b33a623a'
ORDER BY day;
