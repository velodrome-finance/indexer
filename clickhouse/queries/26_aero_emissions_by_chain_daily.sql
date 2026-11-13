-- Aero emissions per chain and day: credited by the LeafVoter, minted on claim, forfeited; USD as indexed
-- and at Base AERO's price (xAERO on the leaf chains often has no price of its own)
SELECT day, chain_name, round(emissions_credited) AS credited, round(emissions_minted) AS minted,
       round(emissions_forfeited) AS forfeited, round(emissions_minted_usd) AS minted_usd_indexed,
       round(emissions_minted_usd_at_base_aero) AS minted_usd_at_base_aero, round(xaero_outstanding) AS xaero_outstanding
FROM aero_chain_daily
ORDER BY day DESC, minted DESC;
