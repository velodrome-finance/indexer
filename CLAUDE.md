# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-chain blockchain indexer for **Velodrome V2** (Optimism) and **Aerodrome** (Base) plus superchain deployments (Celo, Soneium, Ink, Mode, Lisk, Unichain, Fraxtal, Metal, Swell). Built with TypeScript on the **Envio HyperIndex** platform (v3 alpha). This is **not** a TheGraph subgraph.

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
pnpm dev                  # Start indexer with Docker (TUI_OFF=true pnpm dev for CI)
pnpm envio start          # Start indexer in existing container
pnpm envio stop           # Stop the indexer
```

## Architecture

### Core Data Flow

`config.yaml` defines contracts/events per chain -> Envio generates types from `schema.graphql` -> `src/EventHandlers/*.ts` process blockchain events -> Aggregators compute derived state -> Snapshots capture hourly snapshots.

### Key Directories

- **`src/EventHandlers/`** - Event handler registrations and business logic. Top-level files (e.g. `Pool.ts`, `CLPool.ts`) register handlers; subdirectories contain the actual logic (e.g. `Pool/PoolSwapLogic.ts`, `CLPool/CLPoolSwapLogic.ts`).
- **`src/Aggregators/`** - Derived entity computations. `LiquidityPoolAggregator.ts` is the central aggregator (~24KB) that computes pool-level metrics (TVL, volume, fees, votes, emissions). Other aggregators: `UserStatsPerPool.ts`, `NonFungiblePosition.ts`, `VeNFTState.ts`, `VeNFTPoolVote.ts`, `ALMLPWrapper.ts`.
- **`src/Snapshots/`** - Hourly snapshot creation for all aggregated entities. Uses `Shared.ts` for common epoch-alignment logic.
- **`src/Effects/`** - External calls (RPC, API) wrapped in Envio's Effect API for preload compatibility. `RpcGateway.ts` handles multi-chain RPC calls, `Token.ts` fetches token details/prices.
- **`src/Constants.ts`** - Chain-specific constants, factory addresses, price connectors, RPC client setup. Exports `toChecksumAddress()`, chain constants map (`CHAIN_CONSTANTS`), and precision constants.
- **`src/Helpers.ts`** - Shared utilities (error handling, CL position calculations using Uniswap v3 SDK, USD conversions).
- **`src/PriceOracle.ts`** - Token price fetching with hourly refresh intervals.
- **`generated/`** - Auto-generated code from `pnpm envio codegen`. Never edit manually.

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
- **Swap Fee Modules**: `DynamicSwapFeeModule`, `CustomSwapFeeModule`

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

Match the style already in `src/Aggregators/LiquidityPoolAggregator.ts`, `src/EventHandlers/Gauges/GaugeSharedLogic.ts`, and `src/EventHandlers/CLGaugeFactory/CLGaugeFactorySharedLogic.ts`.

## Testing

Tests live in `test/` mirroring the `src/` structure. Uses Vitest with threaded parallelism and 120s timeout.

- **Shared test harness**: `test/EventHandlers/Pool/common.ts` provides `setupCommon()` with mock entities, builders (`createMock*`), and `createMockContext`. Use it instead of constructing entities from scratch.
- **Handler registration**: Test files calling `mockDb.processEvents()` must import the registration module (`import "../eventHandlersRegistration"` or `"../../eventHandlersRegistration"`).
- **Mock events**: Use generated mock API (e.g. `Pool.Swap.createMockEvent({ ... })`).
- **Addresses in tests**: Must be checksummed via `toChecksumAddress()`.

## Lint/Format

Uses Biome (not Prettier/ESLint). Space indentation, double quotes, organized imports. Run `biome check` before committing.
