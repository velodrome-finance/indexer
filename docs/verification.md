# Verifying an indexer instance against the chain

`scripts/verify/` is a harness that checks the data of one indexer instance
against ground truth that it recomputes on its own from the chain. It does not
use the indexer's code. It uses three sources:

- **Raw logs from HyperSync.** These are replayed into per-pool, per-user,
  per-NFT and per-gauge state. Each check states the rule it applies, for
  example "a V2 Burn belongs to whoever sent the LP tokens into the pool".
- **Contract state from RPC, at the pinned block.** Reserves, `totalSupply`,
  `slot0`, `liquidity`, `balanceOf`, NFPM `positions` / `ownerOf`, gauge
  balances, `decimals` / `symbol` and `getFee`. These reads are samples, and
  they also confirm that the log replay is right.
- **External price references.** Production's old oracle export (a TSV per
  chain) and DefiLlama's keyless coins API.

The harness reads the instance's own `config.yaml` (for a `--velo` target,
the instance checkout; otherwise this repository's, or `--repo <checkout>`),
so chains and contracts added there
(Ethereum, Arbitrum, the Aero deployment) are picked up with no harness
change. The registration rules are keyed by contract-name patterns
(`ROLE` in `lib/config.ts`). `*PoolFactory` → Pool, and its stability comes
from the `stable` param or a `Stable` in the name. `*CLFactory` → CLPool.
`*NFPM` → positions. `Voter` / `*LeafVoter` → gauges and voting rewards.
`*TokenRegistry` (ListingSet) → trust. ALM factories → wrappers. Contracts
that config.yaml declares with event signatures only (no ABI file, like the
Aero ones) are decoded from those signatures. The Aero (MetaDEX) contracts on
Arc, Ethereum, Arbitrum and Robinhood are therefore covered: Aero factories,
AeroNFPM, the token registry, and `Pool.deployment` (AERO exactly for pools
of `Aero*` factories). Another new contract type needs a rule in
`truth/build.ts`, plus the matching checks.
RPC: the chain's config.yaml variable, then `VERIFY_RPC_<chainId>`, then
dRPC from `ENVIO_DRPC_API_KEY` for chains without a variable (Arc,
Ethereum, Arbitrum). A new chain needs a DefiLlama
slug in `checks/tokens.ts` (`LLAMA_SLUG`) for the DefiLlama price check;
without one, that check is skipped.

## Running it

```bash
export PATH=$HOME/.local/node/current/bin:$PATH
# 1. a synced instance (dev box: see /home/dev/work-dev-box/hosting/velodrome-indexer/README.md)
velo create scratch/verify --ref <sha> --chains 1750,252,1868 --start
velo wait scratch/verify            # then stop it, so the pinned block does not move
velo stop scratch/verify
# 2. the harness (needs .env: ENVIO_API_TOKEN and the per-chain ENVIO_<CHAIN>_RPC_URL)
npx -y tsx@4.19.2 scripts/verify/run.ts --velo scratch/verify \
  --ref-prices /home/dev/work-dev-box/scratch/velo-bench/ref --out <dir>
```

Other targets: `--pg postgres://user:pass@host:5432/db [--pg-schema public]
--ch-url http://host:8123 --ch-db db --ch-user reader --ch-password-env VAR
[--metrics http://host:9898/metrics]`.

Options:

- `--chains 1750,252`: verify a subset of the instance's chains.
- `--only pool.,user.`: run only the check groups with these id prefixes.
- `--sample N`: RPC sample size per comparison (default 25).
- `--snapshot-pools N`: pools re-streamed for the snapshot-value and USD
  checks (default 8; half the busiest, half random).
- `--no-defillama`: skip the DefiLlama price check.
- `--allow-live`: accept an instance that advanced during the run.
- `--live`: read entity rows from ClickHouse history at the pinned checkpoint instead of Postgres, so a running instance is checked exactly at the pinned block (`events_processed` from `envio_checkpoints`).

The run writes `report.md` (per chain and per check: pass / fail / warn /
skip, both sides' numbers, the worst offenders with ids, blocks and tx hashes)
and `report.json` to `--out`. It also writes `rpc-ledger.tsv` there, one line
per RPC batch. The exit code is 0 when nothing failed, 1 when a check failed
(or the instance moved), and 2 on a harness error.

**Pinning.** Each chain is pinned to `envio_chains.progress_block`. Ground
truth is built up to and including that block, and contract state is read at
it. ClickHouse reads are limited to the chain's last checkpoint at or below
that block. Postgres holds only the current state, so stop the instance
first. Otherwise the harness warns, and exits 1 without `--allow-live`.

**Cost.** HyperSync does all log reads: Metal takes about 10 s, Fraxtal (26M
logs) about 11 min. RPC is used only for state at the pinned block: about
100–400 calls per chain at `--sample 25`, with a hard budget of 10,000 per
process (`VERIFY_RPC_BUDGET`). Calls that a pruned node answers with
"insufficient changesets" are retried.

Other tools:

- `scripts/verify/truth-cli.ts --chains 1750 --selfcheck`: builds the ground
  truth with no indexer and checks the replay itself against contract state
  (V2 reserves and supply, CL `slot0`, in-range liquidity and token
  balances, NFT positions and owners, V2 gauge supply). Use it to test the
  harness.
- `scripts/verify/diff.ts --a scratch/x --b scratch/y [--chains ..]
  [--tables ..]`: the determinism diff. For each chain it takes the lower of
  the two instances' progress blocks and rebuilds every entity table of both
  at that block from ClickHouse history (latest version per id at or below
  the chain's checkpoint for that block). It then diffs the tables row by
  row and column by column. The same code on the same chain must give
  identical rows. This works while both instances are live.
- Unit tests of the harness: `npx vitest run --config
  scripts/verify/vitest.config.ts`. Type check: `npx tsc -p
  scripts/verify/tsconfig.json`.

## Checks and tolerances

All amounts are compared in integers. "Exact" means equal.

### Completeness
| id | what | tolerance |
|---|---|---|
| `completeness.pools` | Pool rows equal the PoolCreated logs of the configured factories (none missing, none extra); tokens, type, tick spacing, factory, creation block, and deployment = AERO exactly for Aero factories | exact |
| `completeness.registrations` | `envio_addresses` holds every pool, gauge, voting reward and ALM wrapper the factories created, under the right contract and at the creation block. Gauges of unknown pool factories are listed, because they can never be indexed | exact |
| `completeness.gauge-links` | Pool.gaugeAddress, fee/bribe reward addresses and gaugeIsAlive equal the latest GaugeCreated / Killed / Revived | exact |
| `completeness.tick-spacing-fees` | FeeToTickSpacingMapping equals the TickSpacingEnabled logs (per chain, or per CL factory when ids carry the factory) | exact |
| `completeness.events-processed` | `envio_chains.events_processed` equals the number of logs of configured events from all indexed addresses up to the pinned block | exact; the count persists across restarts |
| `completeness.event-counters` | per event type, on-chain count equals Σ of the indexer's counters (numberOfSwaps, numberOfFlashLoans, gauge counters) | exact |
| `completeness.handler-metrics` | `envio_processing_handler_total` per contract and event equals the on-chain counts | exact, but informational: needs a running process that never restarted and whose chains were all verified |

### Pools
| id | what | tolerance |
|---|---|---|
| `pool.v2.swaps-volume` | numberOfSwaps, totalVolume0/1 = count and Σ(in+out) of Swap logs | exact |
| `pool.v2.reserves` | reserve0/1 = last Sync | exact |
| `pool.v2.lp-supply` | totalLPTokenSupply = Σ mint − Σ burn Transfers, and `totalSupply()` (sample) | exact |
| `pool.v2.fees` | totalFeesGenerated0/1 = Σ Fees, 1e18-normalised with on-chain decimals | exact (≤ 18 decimals) |
| `pool.v2.fees-collected` | staked / unstaked fees collected = Σ Claim split by sender == gauge | exact |
| `pool.v2.price-ratio` | token0Price/token1Price = spot price of the last Sync reserves (volatile ratio; stable: slope of x³y+xy³) | relative 1e-9 |
| `pool.v2.fee-rate` | baseFee, currentFee = `PoolFactory.getFee(pool, stable)` × 100 at the pinned block | exact |
| `pool.v2.fee-paid` | currentFee = the rate the last swap of ≥ 1e7 input units paid (Fees / amountIn, whole bps) × 100 | exact after rounding to whole bps |
| `pool.cl.swaps-volume` | numberOfSwaps, totalVolume0/1 = count and Σ\|amount\| | exact |
| `pool.cl.price-tick-liquidity` | sqrtPriceX96, tick = last Swap/Initialize; liquidityInRange = Σ L of in-range replayed positions = `liquidity()` (sample) | exact |
| `pool.cl.price-ratio` | token0Price/token1Price from sqrtPriceX96 | relative 1e-9 |
| `pool.cl.reserves` | reserve0/1 = principal held by all positions at the current price (a full burn of every position, rounded down). For a sample, `balanceOf(pool)` is decomposed into reserve + burned-but-uncollected principal + unclaimed LP/gauge fees + donations | 3 wei per Mint/Burn/Swap + 1 per position, or relative 1e-6 (pool rounding in its own favour; the indexer integrates swaps over its own tick map) |
| `pool.cl.fees` | totalFeesGenerated0/1 = Σ Mint − Σ Burn + Σ Swap (signed) − principal held, i.e. the fees the swaps paid; numberOfSwapFeeFallbacks = 0 | 3 units per Swap + 1 per position, or relative 1e-6 |
| `pool.cl.fees-collected` | unstaked = Σ Collect above the position's pending burned principal; staked = Σ CollectFees | exact |
| `pool.cl.flash` | flash count and Σ paid | exact |

### Gauges, rewards
| id | what | tolerance |
|---|---|---|
| `gauge.counters` | gauge deposit / withdraw / claim counts and Σ rewards claimed per pool, over every gauge of the pool | exact |
| `gauge.staked` | currentLiquidityStaked: V2 Σ Deposit − Σ Withdraw = `totalSupply()` (sample); CL Σ L of NFTs the gauge holds. CL stakedLiquidityInRange and stakedReserve0/1 recomputed from those NFTs | liquidity exact; staked reserves 2 wei per NFT or relative 1e-6 |
| `rewards.emissions` | root chains: Pool.totalEmissions = Σ DistributeReward to the pool's gauges; leaf chains: skipped with Σ NotifyReward shown (a leaf pool's emissions are on its RootPool on Optimism since ADR 0009) | exact |
| `rewards.voting-claims` | pools with fee / bribe claims on-chain have non-zero claimed USD (token amounts are not stored) | informational |
| `usd.volume` | for the sample pools, totalVolumeUSD = Σ min trusted leg, priced with the token's TokenPriceSnapshot of the swap's hour | relative 0.5% |
| `usd.v2-fees` | for the sample V2 pools, totalFeesGeneratedUSD = Σ (fee the pool took / amountIn) × the handler's base leg | relative 0.5% |

### Users and positions
| id | what | tolerance |
|---|---|---|
| `user.swaps` | per (user, pool): swaps and volumes grouped by tx.from | exact |
| `user.fees-contributed` | V2 per-user fees = Σ Fees by tx.from; Σ over users = pool (all pools) | exact |
| `user.lp-balance` | V2 lpBalance = Transfer replay balance (gauge excluded), and `balanceOf()` (sample) | exact |
| `user.v2-liquidity-attribution` | added/removed token amounts go to the LP: recipient of the minted LP / sender of the LP that was burned | exact |
| `user.gauge` | per-user stake and gauge counters (V2: Gauge.balanceOf() sample; CL: NFTs the user deposited that the gauge still holds) | exact |
| `user.sums-equal-pool` | Σ over users equals the pool for swaps, volumes, fees, collected fees, gauge deposits | exact |
| `user.protocol-addresses` | no row keyed by a pool, NFPM, gauge, voting reward or ALM wrapper carries swap, liquidity or fee-collection amounts | exact (zero) |
| `user.alm` | almLpAmount = wrapper Transfer replay and `balanceOf()` (sample) | exact |
| `position.nft` | the live NFTs, with pool, ticks, liquidity, owner (ignoring gauge transfers) and isStakedInGauge; `positions()` / `ownerOf()` (sample) | exact |
| `alm.wrapper`, `alm.position-link` | wrapper lpAmount = `totalSupply()` (Transfer replay and on-chain); ticks and liquidity = the strategy's NFT | exact; liquidity relative 1e-3 |

### Tokens and prices
| id | what | tolerance |
|---|---|---|
| `token.metadata` | every pool token has a Token row with decimals and symbol = `decimals()` / `symbol()` (bytes32 symbols decoded) | exact |
| `token.whitelist` | isWhitelisted = last WhitelistToken; isListedOnAero = last token-registry ListingSet | exact |
| `price.coverage` | share of token-hours with pool activity that have a positive price; tokens with ≥ $10k of priced counterparty liquidity but no price now | informational (unpriced below the $1,000 depth floor is by design) |
| `price.vs-prod-oracle` | hourly prices vs production's oracle export (before 2026-11-03), per token with ≥ 24 shared hours | median relative error ≤ 5% |
| `price.vs-defillama` | daily DefiLlama prices vs the indexed price of the same hour | median ≤ 5% |

### Snapshots and stores
| id | what | tolerance |
|---|---|---|
| `snapshot.pool-presence` | a PoolSnapshot for every hour in which the pool (or its gauge) emitted a log that updates the Pool row. Extra snapshot hours (other triggers) are counted | exact |
| `snapshot.pool-values` | for re-streamed sample pools, each snapshot of hour E equals the state just before or just after the pool's first handled log at or after E | exact (set membership) |
| `snapshot.pool-monotonic` | cumulative snapshot fields never decrease; the last snapshot is ≤ the Pool row | exact |
| `snapshot.rewrites` | one ClickHouse version per snapshot id (a second version means the hour was snapshotted twice) | exact |
| `snapshot.user-presence` | for the sample pools, every (swapper, hour) has a UserStatsPerPoolSnapshot | exact |
| `store.pg-vs-clickhouse` | every entity stored in both: latest ClickHouse version = Postgres row, column by column; deletes agree | exact after normalising representations |
| `store.clickhouse-only-counts` | snapshot rows per table and chain; ids hour-aligned; no foreign chains | exact (structure), counts reported |

## What this cannot verify, and why

- **Votes and emissions on leaf chains.** These originate on Optimism (votes,
  DistributeReward, root pools). With Optimism outside the instance they are
  0 by construction. The harness shows the on-chain NotifyReward totals that
  the leaf gauges received, for when Optimism is synced. veNFT state is
  likewise only on Optimism and Base.
- **Exact USD values.** Prices come from the indexer's own pool-derived
  oracle. The harness checks them against two external references with a 5%
  median tolerance. It checks USD aggregation exactly against the indexer's
  own hourly prices, so a wrong price shows up in the price checks and a
  wrong aggregation in the `usd.*` checks.
- **Voting-reward claim amounts.** Only USD totals are stored, so there are
  no token amounts to compare with the ClaimRewards logs. The harness checks
  presence only.
- **CL per-user liquidity added/removed and per-user fee collection on
  NFPM-managed positions.** The indexer values NFT transfers at the current
  pool price, so the harness does not recompute these per user. It flags
  protocol-contract rows instead (`user.protocol-addresses`) and checks that
  users sum to the pool.
- **CL `currentFee` and `baseFee`.** `currentFee` is the rate of the last
  sizeable swap, derived over the indexer's tick map, and dynamic-fee pools
  move it every swap. `baseFee` would need the fee modules' full history.
  CL fees are checked in total (`pool.cl.fees`) instead.
- **Postgres-only internal state** (PoolTickMap, pending principal, mint
  registries) is covered only indirectly, through the fields it feeds.
