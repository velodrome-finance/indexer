-- Legacy-to-Aero migration so far: veNFTs and liquid tokens migrated, per contract
SELECT chain_id, legacy_token, migration_contract, venfts_migrated, round(venft_amount_in) AS venft_in, round(venft_amount_out) AS venft_out,
       liquid_migrations, round(liquid_amount_in) AS liquid_in, round(liquid_amount_out) AS liquid_out, settlements, round(settled_amount) AS settled
FROM aero_migration
ORDER BY chain_id, legacy_token;
