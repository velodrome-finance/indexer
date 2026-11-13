-- One pool's last 168 hourly rows (WETH/weETH, the deepest pool on Ink here)
-- Give the pool as a literal or a scalar subquery `pool_address = (SELECT ...)`: a WITH alias
-- is not pushed down to the table's sort key and makes the query read every pool.
SELECT hour, tvl_usd, volume_usd, fees_usd, swaps, price0_in_token1, staked_share
FROM pool_hourly
WHERE chain_id = 57073 AND pool_address = '0xf9349c5af43d2abc2758e90cfb341722116fac38'
ORDER BY hour DESC
LIMIT 168;
