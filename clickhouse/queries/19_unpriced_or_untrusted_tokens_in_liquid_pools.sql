-- Tokens that are unpriced (price 0) or untrusted but sit in pools with swaps: USD figures miss them
SELECT t.chain_name, t.symbol, t.token_address, t.is_unpriced, t.is_price_trusted, t.price_trust_reason,
       t.price_updated_at, count() AS pool_count, sum(p.swaps_total) AS swap_count
FROM tokens AS t
INNER JOIN pools AS p ON p.chain_id = t.chain_id AND (p.token0_address = t.token_address OR p.token1_address = t.token_address)
WHERE t.is_unpriced OR NOT t.is_price_trusted
GROUP BY t.chain_name, t.symbol, t.token_address, t.is_unpriced, t.is_price_trusted, t.price_trust_reason, t.price_updated_at
ORDER BY swap_count DESC
LIMIT 25;
