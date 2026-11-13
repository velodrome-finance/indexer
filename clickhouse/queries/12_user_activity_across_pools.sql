-- A wallet's activity in every pool: swaps, volume, fees paid, liquidity, rewards
WITH (SELECT user_address FROM user_pools ORDER BY swap_volume_usd_total DESC LIMIT 1) AS wallet
SELECT chain_name, pair, pool_type, swaps_total, round(swap_volume_usd_total) AS swap_volume_usd,
       round(fees_paid_usd_total, 2) AS fees_paid_usd, round(liquidity_added_usd_total) AS liquidity_added_usd,
       round(liquidity_removed_usd_total) AS liquidity_removed_usd, round(gauge_rewards_claimed_usd_total, 2) AS rewards_usd,
       first_activity, last_activity
FROM user_pools
WHERE user_address = wallet
ORDER BY swap_volume_usd DESC
LIMIT 50;
