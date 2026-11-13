-- Pools whose numbers need care: swap-fee fallbacks, swaps but no USD, staked > TVL
SELECT p.chain_name, p.pair, p.pool_address, p.swaps_total, round(p.volume_usd_total) AS volume_usd_total,
       round(p.tvl_usd) AS tvl_usd, round(p.staked_share, 3) AS staked_share, s.swap_fee_fallbacks
FROM pools AS p
INNER JOIN (SELECT chain_id, pool_address, swap_fee_fallbacks FROM _pool FINAL) AS s USING (chain_id, pool_address)
WHERE s.swap_fee_fallbacks > 0 OR (p.swaps_total > 100 AND p.volume_usd_total = 0) OR p.staked_share > 1.01
ORDER BY p.swaps_total DESC
LIMIT 25;
