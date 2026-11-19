-- A wallet's activity in every pool on a chain: swaps, volume, fees paid, liquidity, rewards
SELECT chain_name, pair, pool_type, swaps_total, swap_volume_usd_total, fees_paid_usd_total,
       liquidity_added_usd_total, liquidity_removed_usd_total, gauge_rewards_claimed_usd_total,
       first_activity, last_activity
FROM user_pools
WHERE chain_id = 57073 AND user_address = '0xe244b3bdd6f452e03958f76d2b9c66ccd9c53288'
ORDER BY swap_volume_usd_total DESC
LIMIT 50;
