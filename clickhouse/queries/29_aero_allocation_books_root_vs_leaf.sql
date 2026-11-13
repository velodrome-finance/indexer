-- Allocation books per chain: what the root Voter on Base booked against what each LeafVoter holds
SELECT chain_id, chain_name, count() AS positions, round(sum(root_booked)) AS root_booked, round(sum(leaf_budget)) AS leaf_budget,
       round(sum(leaf_booked_on_gauges)) AS leaf_on_gauges, round(sum(leaf_idle)) AS leaf_idle,
       countIf(abs(root_minus_leaf) > 1e-9) AS positions_out_of_step
FROM aero_allocation_books
GROUP BY chain_id, chain_name
ORDER BY chain_id;
