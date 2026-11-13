-- One pool's hourly history (the deepest pool on Ink here): TVL, volume, fees, price, staked share
WITH (SELECT pool_address FROM pools WHERE chain_id = 57073 ORDER BY tvl_usd DESC LIMIT 1) AS pool
SELECT hour, round(tvl_usd) AS tvl_usd, round(volume_usd) AS volume_usd, round(fees_usd, 2) AS fees_usd, swaps,
       round(price0_in_token1, 6) AS price0_in_token1, round(staked_share, 3) AS staked_share
FROM pool_hourly
WHERE chain_id = 57073 AND pool_address = pool
ORDER BY hour DESC
LIMIT 168;
