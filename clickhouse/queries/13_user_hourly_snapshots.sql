-- A wallet's hourly snapshots on one chain (parameterized view; any address case works)
SELECT hour, pool_address, swaps_total, swap_volume_usd_total, liquidity_added_usd_total, lp_balance
FROM user_pool_snapshots(chain_id = 57073, user = '0xE244B3BDD6F452E03958F76D2B9C66CCD9C53288')
ORDER BY hour DESC
LIMIT 100;
