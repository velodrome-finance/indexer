-- A wallet's open CL positions with current amounts and value (the wallet with most open positions here)
WITH (SELECT owner FROM positions WHERE liquidity > 0 GROUP BY owner ORDER BY count() DESC LIMIT 1) AS wallet
SELECT chain_name, pair, pool_type, nfpm_address, token_id, tick_lower, tick_upper, in_range, is_staked,
       round(amount0, 6) AS amount0, round(amount1, 6) AS amount1, round(value_usd, 2) AS value_usd, last_updated
FROM positions
WHERE owner = wallet AND liquidity > 0
ORDER BY value_usd DESC
LIMIT 50;
