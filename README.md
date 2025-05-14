## Multi-chain indexer for Velodrome V2 and Aerodrome

This repo contains the indexer for [Velodrome V2](https://velodrome.finance/) and
[Aerodrome](https://aerodrome.finance/) across multiple chains.
The indexer is written in TypeScript using the Envio indexing platform.

## Project Structure

- `config.yaml` - Defines contracts to index and events to track across multiple chains
- `schema.graphql` - Defines the entity structure for the database
- `src/EventHandlers/*.ts` - Contains the business logic for processing blockchain events
- `src/cache.ts` - Implements caching for blockchain data to reduce RPC calls
- `.env` - Contains configuration variables (copy from `.env.example` and customize)

## Key Files in `src/`

- `Constants.ts` - Contains chain-specific constants and configurations
- `Erc20.ts` - Helpers for working with ERC20 tokens
- `PriceOracle.ts` - Functions for fetching and managing token prices
- `Store.ts` - Functions for managing pool address mappings

## Installation

Make sure you have [pnpm](https://pnpm.io/) installed (version 9.x+ recommended).

```bash
pnpm install
```

## Running the Indexer

Envio provides a simple development workflow:

```bash
# Generate code based on your schema and config
pnpm envio codegen

# Start the indexer (automatically sets up docker containers and starts indexing)
pnpm envio dev
```

To stop the indexer:

```bash
pnpm envio stop
```

## Testing

To run tests:

```bash
pnpm test
```

## Documentation

For comprehensive documentation on the Envio indexing platform, please refer to:

- [Envio Documentation](https://llm-docs.envio.dev/docs/HyperIndex/contract-state)
- [Event Handlers Documentation](https://docs.envio.dev/docs/event-handlers)
- [Dynamic Contracts Documentation](https://docs.envio.dev/docs/dynamic-contracts)
