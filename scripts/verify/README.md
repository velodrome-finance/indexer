# scripts/verify: ground-truth verification harness

This harness compares one indexer instance (its Postgres and ClickHouse) with
values it recomputes from raw logs (HyperSync) and from contract state at the
pinned block (RPC). It writes a report and exits 1 when a check fails. The
full reference is `docs/verification.md`.

## Run

```bash
export PATH=$HOME/.local/node/current/bin:$PATH
# needs .env with ENVIO_API_TOKEN and ENVIO_<CHAIN>_RPC_URL (or ENVIO_DRPC_API_KEY)
velo stop scratch/<inst>              # a stopped instance gives an exact pin (or pass --live)
npx -y tsx@4.19.2 scripts/verify/run.ts --velo scratch/<inst> [--chains 1750,252] \
  [--ref-prices /home/dev/work-dev-box/scratch/velo-bench/ref] [--out DIR] [--only pool.,user.] [--live]
npx -y tsx@4.19.2 scripts/verify/diff.ts --a scratch/x --b scratch/y [--chains ..] [--block N]   # determinism
npx -y tsx@4.19.2 scripts/verify/truth-cli.ts --chains 1750 --selfcheck [--repo <checkout>]       # replay vs chain state
npx vitest run --config scripts/verify/vitest.config.ts && npx tsc -p scripts/verify/tsconfig.json
```

- The harness reads the instance's own `config.yaml` (for `--velo`, the
  instance checkout), so new chains and contracts are picked up, Aero ones
  included.
- Each chain is pinned to `envio_chains.progress_block`.
- `--live` reads entity rows from ClickHouse history at the pinned
  checkpoint, so a running instance can be checked too.
- Output: `report.md`, `report.json` and `rpc-ledger.tsv` in `--out`.

## What each check group proves

| group | proves | tolerance |
|---|---|---|
| `completeness.*` | Every pool, gauge, voting reward, ALM wrapper and Aero rewards manager created on-chain is registered at its creation block, with nothing extra. Pool metadata (and `deployment`) and gauge links match. `events_processed` equals the on-chain log count. The per-event counters equal the on-chain counts. | exact |
| `pool.v2.*` | Swaps and volumes, reserves (last Sync), LP supply (`totalSupply()`), fees (Fees logs), fees collected (Claim), price ratio, fee rate (`getFee`) and the rate the last swap actually paid | exact; ratio rel 1e-9 |
| `pool.cl.*` | Swaps and volumes, price, tick and in-range liquidity (replayed positions, `liquidity()`), reserves (principal the positions hold, with the balance decomposed), fees (Σmint − Σburn + Σswap − principal), collected fees, flash loans | exact; reserves/fees 3 units per event + 1 per position or rel 1e-6 |
| `gauge.*` | Gauge counters, staked liquidity (V2 `totalSupply()`; CL NFTs deposited and still held), staked in-range liquidity and staked reserves | exact; staked reserves: 1 unit per swap or rel 1e-3 |
| `user.*` | Per (user, pool): swaps by tx.from, V2 fees, LP balance (`balanceOf()`), V2 liquidity attribution, gauge stake, ALM balance. Users sum to the pool. No amounts on protocol-contract rows. | exact |
| `position.nft`, `alm.*` | Live NFTs with pool, ticks, liquidity and owner (`positions()` / `ownerOf()`); ALM wrapper supply and position | exact; ALM liquidity rel 1e-3 |
| `token.*`, `price.*` | Decimals and symbol from chain; whitelist and Aero listing; price coverage; prices against production's oracle export and DefiLlama | exact; prices: median error ≤ 5% |
| `usd.*` | USD volume and V2 fee USD re-derived per swap from the indexer's own hourly prices | rel 0.5% |
| `snapshot.*` | A snapshot for every active hour; values equal the state before or after the hour's first log; monotonic; no rewrites | exact |
| `store.*` | Postgres rows equal the latest ClickHouse versions; snapshot ids well formed | exact |
| `rewards.*` | Leaf emissions (needs Optimism in the instance); pending cross-chain rows; voting-claim presence | informational where noted |
