-- Data freshness per chain: last committed block, last pool change and price refresh (block time)
SELECT chain_name, wound_down, indexed_block, last_pool_change, last_price_refresh, minutes_behind_now,
       layer_checkpoint, indexed_checkpoint, layer_loaded_at
FROM freshness
ORDER BY chain_name;
