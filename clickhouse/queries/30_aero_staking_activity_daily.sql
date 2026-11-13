-- Aero gauge staking per chain and day: deposits, withdrawals and distinct stakers (from the stake events)
SELECT toDate(timestamp) AS day, chain_id, countIf(kind = 'DEPOSIT') AS deposits,
       countIf(kind != 'DEPOSIT') AS withdrawals, uniqExact(account) AS stakers
FROM aero_gauge_stake_events
GROUP BY day, chain_id
ORDER BY day DESC, deposits DESC;
