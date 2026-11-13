-- A wallet's open CL positions on Ink with current amounts and value (addresses are lowercase)
SELECT chain_name, pair, pool_type, nfpm_address, token_id, tick_lower, tick_upper, in_range, is_staked,
       amount0, amount1, value_usd, last_updated
FROM positions
WHERE chain_id = 57073 AND owner = '0x19df5d96f5024f53459a282260cead38e8feb3b5' AND liquidity > 0
ORDER BY value_usd DESC
LIMIT 50;
