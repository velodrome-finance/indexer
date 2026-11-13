# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-chain blockchain indexer for **Velodrome V2** (Optimism) and **Aerodrome** (Base) plus superchain deployments (Celo, Soneium, Ink, Mode, Lisk, Unichain, Fraxtal, Metal, Swell), and for **Aero** (MetaDEX), the merged deployment launched 2026-10-21 on Base, Optimism, Ethereum, Arbitrum, Ink, Robinhood Chain (4663) and Arc (5042). Legacy and Aero pools share one data model (`Pool.deployment` tells them apart, ADR 0005). Built with TypeScript on the **Envio HyperIndex** platform (v3.16). This is **not** a TheGraph subgraph.

## Commands

```bash
pnpm install              # Install dependencies
pnpm envio codegen        # Generate types from schema.graphql + config.yaml (MUST run after changing either)
tsc --noEmit              # Type-check (run after any TS changes)
pnpm test                 # Run all tests with coverage (vitest)
vitest run test/path.ts   # Run a single test file
vitest run -t "pattern"   # Run tests matching a name pattern
biome check               # Lint + format check
biome check --fix --unsafe # Auto-fix lint/format issues
pnpm dev                  # Start indexer with Docker (ENVIO_TUI=false pnpm dev for CI)
pnpm envio start          # Start indexer in existing container
pnpm envio stop           # Stop the indexer
```

## Architecture

### Core Data Flow

`config.yaml` defines contracts/events per chain -> Envio generates types from `schema.graphql` -> `src/EventHandlers/*.ts` process blockchain events -> Aggregators compute derived state -> Snapshots capture hourly snapshots.

### Key Directories

- **`src/EventHandlers/`** - Event handler registrations and business logic. Top-level files (e.g. `Pool.ts`, `CLPool.ts`) register handlers; subdirectories contain the actual logic (e.g. `Pool/PoolSwapLogic.ts`, `CLPool/CLPoolSwapLogic.ts`).
- **`src/Aggregators/`** - Derived entity computations. `Pool.ts` is the central aggregator (~24KB) that computes pool-level metrics (TVL, volume, fees, votes, emissions). Other aggregators: `UserStatsPerPool.ts`, `NonFungiblePosition.ts`, `VeNFTState.ts`, `VeNFTPoolVote.ts`, `ALMLPWrapper.ts`.
- **`src/Snapshots/`** - Hourly snapshot creation for all aggregated entities. Uses `Shared.ts` for common epoch-alignment logic.
- **`src/Effects/`** - External calls (RPC, API) wrapped in Envio's Effect API for preload compatibility. `RpcGateway.ts` handles multi-chain RPC calls, `Token.ts` fetches token details (its `getTokenPrice` oracle effect is kept for scripts only — handlers never call it).
- **`src/Constants.ts`** - Chain-specific constants, factory addresses, price connectors, RPC client setup. Exports `toChecksumAddress()`, chain constants map (`CHAIN_CONSTANTS`), and precision constants. A chain's entry has a `legacy` block (legacy reward token, LpHelper, on-chain oracle; read it with `getLegacyConstants`) and/or an `aero` block (Aero reward token, start block); Aero-only chains have no `legacy` block.
- **`src/Helpers.ts`** - Shared utilities (error handling, CL position calculations using Uniswap v3 SDK, USD conversions).
- **`src/PriceOracle.ts`** - Hourly token price refresh from indexed pool state (see Pricing below), token creation, metadata heal.
- **`src/Pricing/`** - Pool-derived pricing building blocks: tiers + thresholds (`PricingConfig.ts`), candidate pools + deepest-pool selection (`PoolRoute.ts`), throttle / carry / 7-day expiry (`PriceResolution.ts`).
- **`.envio/types.d.ts`** - Auto-generated types from `pnpm envio codegen` (gitignored), surfaced through the `envio` package. Never edit manually. (There is no `generated/` directory.)

### Contract Domains

The indexer tracks these protocol domains, each with its own event handlers:
- **Pools**: V2 AMM (`Pool`) and Concentrated Liquidity (`CLPool`) with separate swap/mint/burn/sync logic
- **Factories**: `PoolFactory`, `CLFactory`, `RootCLPoolFactory`, `FactoryRegistry`
- **Gauges**: `Gauge` (V2) and `CLGauge` (CL) for staking rewards
- **Voting**: `Voter`, `SuperchainLeafVoter`, fee/bribe/incentive `VotingReward` contracts
- **veNFT**: Vote-escrowed NFT tracking (deposits, withdrawals, merges, splits)
- **NFPM**: Non-Fungible Position Manager for CL positions
- **ALM**: Automated Liquidity Management (DeployFactory, Core, LPWrapper v1/v2)
- **Pool Launcher**: `CLPoolLauncher`, `V2PoolLauncher` for emerging token launches
- **Superswaps/Hyperlane**: Cross-chain swap tracking (`VelodromeUniversalRouter`, `Mailbox`)
- **Swap Fee Modules**: `DynamicSwapFeeModule`, `CustomSwapFeeModule` (CL); `V2CustomFeeModule` (each superchain leaf `PoolFactory.feeModule()` and the Aero V2 CustomFeeModules)
- **Aero (MetaDEX)**: `AeroCLFactory` (same ABI as `CLFactory`), `AeroStablePoolFactory` / `AeroVolatilePoolFactory` (V2; stability = emitting factory), `AeroNFPM`, `DynamicSwapFeeHook` (CL fee config), `V2CustomFeeModule` (V2 custom fees, shared with the leaf chains), `AeroTokenRegistry` (Aero token list → `Token.isListedOnAero`, a price-trust signal). Their pools register into the shared `Pool` / `CLPool` contracts. Arc also has the earlier "lite launch" factories / NFPM / hook, listed under the same contract names.
- **Aero gauges, emissions and governance** (`src/EventHandlers/Aero/`, ADR 0006): `AeroGaugeManager`, `AeroCLGaugeFactory` / `AeroV2GaugeFactory` (register the dynamic `AeroCLGauge` / `AeroV2Gauge`), `AeroLeafVoter` (same address on every chain, Base included: gauge lifecycle, emission ledger, redemptions, leaf allocations), `AeroVotingRewardsManager` (dynamic, one per gauge), `AeroUnstakedFeeModule`; Base only: `AeroVotingEscrow` (sAERO), `AeroVoter` (root allocations, redemptions), `AeroMinter`, `AeroRootEmissionsHandler`, `AeroMigration` / `AeroMigrationEntrypoint` (also `AeroMigration` on Optimism).

### Deployments (legacy vs Aero)

`Pool.deployment` (`VELODROME` / `AERODROME` / `AERO`, `POOL_DEPLOYMENT` in `src/Constants.ts`) is set at PoolCreated from the config contract that emitted it, and copied to `PoolSnapshot`. Rules for Aero pools (docs/adr/0005-one-data-model-for-legacy-and-aero-pools.md):

- Never give an existing field a second meaning: a legacy-only field stays at its creation default (or null) on an AERO pool, and the schema comment says so.
- AERO pools are never superchain leaf pools: `rootPoolMatchingHash` is null and the Aero handlers skip the root-pool reconciliation and the leaf `getRootPoolAddress` RPC.
- `FeeToTickSpacingMapping` is per CL factory (`{chainId}-{factory}-{tickSpacing}`).
- Aero NFPM positions are created at `IncreaseLiquidity` (which carries the range); the pool comes from the CLPool.Mint by primary key (`AeroNFPMMintPool`), the owner from the mint Transfer (`AeroNFPMPendingMint`). Aero NFPM `Collect` credits fees to the position owner (`NFPMPositionPendingPrincipal`), so `CLPool.Collect` on an Aero pool does not credit the NFPM contract.

### Aero gauges and governance (ADR 0006)

- **Reused fields**: an Aero gauge sets `Pool.gaugeAddress` (the NFPM transfer seam then keeps the real owner of staked positions) and `Pool.gaugeIsAlive` (= activated and emission cap > 0; a cap of 0 is the only deactivation). Aero Deposit / Withdraw / EmergencyWithdraw go through the legacy gauge arithmetic (`computeCLStakedReservesOnGaugeEvent`, `computeNonCLStakedUSDIfAvailable` from `Gauges/GaugeSharedLogic.ts`), the pool found by primary key from `AeroGauge`. Legacy emission / vote fields stay at their defaults on AERO pools.
- **New entities**: `AeroGauge` mirrors the LeafVoter's per-gauge `ceiling` / `claimed` / `surplus` (credited / minted / forfeited); `AeroLeafVoterState` per chain; sAERO in `SAeroPosition` / `SAeroEscrowState`; allocations in `AeroRootAllocation` + `AeroRootGaugeVote` (root Voter, Base) and `AeroLeafTokenState` + `AeroLeafAllocation` (each LeafVoter); rewards in `AeroVotingRewardsManager` / `AeroIncentiveProgram`; `AeroMinterState`; `AeroMigrationTotals`. Event rows (ClickHouse only): `AeroGaugeStakeEvent`, `AeroEmissionsEvent`, `AeroAllocationEvent`, `SAeroPositionEvent`, `AeroVotingRewardsEvent`, `AeroRedemptionEvent`, `AeroMinterEvent`, `AeroMigrationEvent`; hourly `AeroGaugeSnapshot`, `AeroLeafVoterStateSnapshot`, `SAeroEscrowStateSnapshot`, `AeroMinterSnapshot`.
- **Units**: emission amounts in the chain's reward token (AERO on Base, xAERO elsewhere, 18 decimals, 1:1), USD at its stored price on the event's chain; caps in wei per second; allocations undecayed AERO.
- **Same-chain only**: no Aero handler reads or writes another chain's rows; root and leaf allocation books are joined in queries. The leaf booking rule (registered, activated, cap > 0 unless the position may vote for zero-cap gauges) is replayed from same-chain state.
- **Volume**: on Base the gauge and emissions streams are several times the swap volume. Settlements, mints, forfeits, Base-internal redemptions and Minter mints only update totals and hourly snapshots; per-user actions get rows. Keep it that way.

### V2 swap fees

A V2 pool emits `Fees` (fee per input token) before `Sync` and `Swap` in the same tx, and no `Fees` when the fee is 0. The Fees handler stages the amounts in `V2SwapFeesInTx` (`{chainId}-{txHash}-{pool}`); the Swap handler reads and deletes it, values the fee from those amounts and writes the effective rate to `currentFee`. Never value a V2 swap's fee from the stored rate alone: fee modules the indexer does not follow change it (ADR 0001, 2026-11-13 amendment). `baseFee` comes from `PoolFactoryDefaultFee` (SetDefaultFee) or the latest `SetCustomFee`.

### Pricing

Token USD prices (`Token.pricePerUSDNew`, 1e18-scaled) are derived from indexed pool state — no RPC (ADR `docs/adr/0003-pool-derived-token-prices.md`).

- **Tiers** (`getPricingTier`): 0 = destination token + stablecoins, pinned at exactly $1; 1 = the chain's WETH; 2 = other price connectors (`src/constants/price_connectors.json`) and the reward token; 3 = everything else. A token is only ever priced through a counterparty in a strictly lower tier, so pricing is acyclic and recursion is at most three deep.
- **Candidates**: `TokenPricingPools` (Postgres-only, internal) lists, per token, the pools it may be priced through. `registerPricingPool` appends at V2 `PoolFactory` / CL `CLFactory` `PoolCreated` when the counterparty is in a lower tier.
- **Refresh** (`refreshTokenPrice`): at most once per token per clock hour, no bypasses. Order: blacklist → 0; tier 0 → $1; else refresh due counterparties, then take the deepest candidate that passes the per-chain depth floor, the 1000× value-imbalance bound and the $1M ceiling; else carry the last price, dropping to 0 once the last success is 7 days old.
- **Candidates**: each local pool (price = pool ratio × counterparty price, depth = counterparty reserve in USD) plus, for a token with a canonical source in `PriceOverrides.ts` (WETH on ETH-equivalent leaf chains and on Ethereum / Arbitrum / Robinhood / Arc → Optimism WETH, XVELO → Optimism VELO, xAERO on every Aero leaf chain → Base AERO, …), that source's stored price at its stored `Token.pricingDepthUSD`, only while the source's last success is within ±2 h of the block (ADR `docs/adr/0004-canonical-cross-chain-price-candidates.md`). The source is read, never refreshed.
- **Trust** (`src/PriceTrust.ts`, ADR 0002): a token's USD counts only if it is legacy-whitelisted (`isWhitelisted`), listed in the Aero TokenRegistry (`isListedOnAero`, `AeroTokenRegistry.ListingSet`) or a price connector, and not blacklisted.
- **Reward tokens**: tier 2 includes every legacy reward token (`legacy.rewardToken`, both ends of its block range) and the Aero reward token (`aero.rewardToken`: AERO on Base, xAERO elsewhere). On Base both AERO v1 (legacy) and AERO (Aero) are connectors; the legacy reward token stays AERO v1 at every block.
- **Ratios** (`src/PoolPriceRatio.ts`): CL from `sqrtPriceX96`, V2 volatile from the reserve ratio, V2 stable from the `x³y + xy³` curve's marginal price; decimals are folded in exactly (0-decimal tokens included).
- Every refresh writes one `TokenPriceSnapshot` (id keyed by the hour) tagged with `priceSource` and, for `pool` / `canonical` prices, `pricingPoolId` or `pricingSourceTokenId` plus `pricingDepthUSD`.

### Entity ID Conventions

- Pool IDs: `{chainId}-{poolAddress}`
- Token IDs: `{chainId}-{tokenAddress}`
- Snapshot IDs: `{entityId}-{epochMs}`
- Use `toChecksumAddress()` from `src/Constants.ts` for all addresses

## Envio-Specific Patterns

- **Entity updates**: Always spread the existing entity (`{ ...existing, field: newValue }`) — entities are read-only/immutable.
- **External calls**: Must use the Effect API (`createEffect` + `context.effect()`) because handlers run twice during preload. See `src/Effects/`.
- **Dynamic contracts**: Many contracts (Pool, CLPool, Gauge, etc.) have empty `address:` arrays in `config.yaml` — they are registered dynamically at runtime via factory events using `context.ContractName.addAddress()`.
- **Relationships**: Use `entity_id` string fields (e.g. `token0_id: String!`), not direct object references. No entity arrays.
- **Timestamps**: Always cast to BigInt: `BigInt(event.block.timestamp)`.
- **Addresses**: Use lowercase keys in config objects for `.toLowerCase()` lookups. Always checksum addresses for entity storage.
- **Amount normalization**: Always normalize token amounts to a common decimal base before arithmetic across different tokens.

## Storage

Postgres and ClickHouse are both enabled (envio 3.16). The `storage:` block in `config.yaml` marks both backends with `default: true`, so an entity with no `@storage` directive is written to both and read by handlers from Postgres. Three groups are routed explicitly in `schema.graphql`:

- **ClickHouse only** (`@storage(postgres: false, clickhouse: true)`): the `*Snapshot` entities and the Aero append-only event rows (`Aero*Event`, `SAeroPositionEvent`). Handlers only ever write them. They are not served over GraphQL.
- **Postgres only, hidden from the API** (`@storage(postgres: true, clickhouse: false) @internal`): handler working state that has no analytical value, i.e. the mint/transfer correlation entities (including the Aero NFPM ones: `AeroNFPMMintPool`, `AeroNFPMPendingMint`, `NFPMPositionPendingPrincipal`), the V2 swap-fee hand-over `V2SwapFeesInTx`, the Hyperlane staging entities, `PoolTickMap`, `TokenPricingPools` and `AeroGaugePendingReferral`.
- **Both** (no directive): everything else, including the aggregates handlers read and update (`Pool`, `UserStatsPerPool`, `Token`, `NonFungiblePosition`, `VeNFTState`, `VeNFTPoolVote`).

When adding an entity: if no handler reads it back, make it ClickHouse-only; if it is scratch state, make it Postgres-only and `@internal`. Do not make an entity that handlers read and update ClickHouse-only: a load from ClickHouse scans every stored version of each id, and ClickHouse keeps one version per block in which the entity changed.

ClickHouse env vars (Envio Hosted ClickHouse in production, placeholders in `.env.example`):

- `ENVIO_CLICKHOUSE_HOST`
- `ENVIO_CLICKHOUSE_DATABASE`
- `ENVIO_CLICKHOUSE_USERNAME`
- `ENVIO_CLICKHOUSE_PASSWORD`

Docs: https://docs.envio.dev/docs/HyperIndex/configuration-file#storage

## Conventions

### File naming under `src/EventHandlers/`

Files use PascalCase with a descriptive suffix that reflects what the file does:

- `*Logic.ts` — event-specific logic (e.g. `CLFactoryPoolCreatedLogic.ts`, `PoolSwapLogic.ts`)
- `*SharedLogic.ts` / `*CommonLogic.ts` — helpers shared across multiple handlers in the same domain (e.g. `GaugeSharedLogic.ts`, `VoterCommonLogic.ts`, `CLGaugeFactorySharedLogic.ts`)

Avoid bare names like `shared.ts`, `utils.ts`, or `helpers.ts` inside `src/EventHandlers/` — prefix them with the contract/domain they belong to so grep and imports stay self-documenting.

### JSDoc on exported functions

Every exported function in `src/**/*.ts` carries a JSDoc block with:

- A one-line summary (plus a longer paragraph when behavior is non-obvious — side effects, ordering constraints, last-writer-wins semantics, etc.)
- `@param name - description` for every parameter
- `@returns description` — even for `Promise<void>`, summarize what was staged/written (e.g. "Promise that resolves once the upsert is staged")

Match the style already in `src/Aggregators/Pool.ts`, `src/EventHandlers/Gauges/GaugeSharedLogic.ts`, and `src/EventHandlers/CLGaugeFactory/CLGaugeFactorySharedLogic.ts`.

## Testing

Tests live in `test/` mirroring the `src/` structure. Uses Vitest with threaded parallelism and 120s timeout.

- **Shared test harness**: `test/EventHandlers/Pool/common.ts` provides `setupCommon()` with mock entities, builders (`createMock*`), and `createMockContext`. Use it instead of constructing entities from scratch.
- **Handler registration**: The test indexer loads every handler listed in `config.yaml` by itself. Never import a handler module (`src/EventHandlers/*.ts`) from a test: its handlers are then registered twice and run twice per event, silently (enviodev/hyperindex#1820). `test/eventHandlersRegistration.ts` is an empty module kept for the tests that still import it.
- **Mock events**: Simulate events inline through `createTestIndexer()` (from the `envio` package): `indexer.process({ chains: { [chainId]: { simulate: [{ contract, event, params, block, ... }] } } })`. There is no `generated/` mock-event API.
- **Addresses in tests**: Must be checksummed via `toChecksumAddress()`.

## Lint/Format

Uses Biome (not Prettier/ESLint). Space indentation, double quotes, organized imports. Run `biome check` before committing.

## Agent skills

### Issue tracker

Issues live as GitHub issues at `velodrome-finance/indexer`; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
