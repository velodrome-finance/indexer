-- A wallet's hourly snapshots on one chain (parameterized view; any address case works)
SELECT hour, pool_address, swaps_total, round(swap_volume_usd_total) AS swap_volume_usd_total,
       round(liquidity_added_usd_total) AS liquidity_added_usd_total, round(lp_balance, 6) AS lp_balance
FROM user_pool_snapshots(chain_id = 57073, user = '0x9dCe5C4fDBb1AFe68f2a0e7D3C3f8c95a2f5cE8D')
ORDER BY hour DESC
LIMIT 100;
