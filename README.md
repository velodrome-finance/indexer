## Multi-chain indexer for Velodrome V2 and Aerodrome

This repo contains the indexer for [Velodrome V2](https://velodrome.finance/) and
[Aerodrome](https://aerodrome.finance/) across multiple chains.
The indexer is written in TypeScript.

### Overview of user-defined files

- `config.yaml`
  - Outlines which contracts should be indexed from which blockchains into the database.
  - For each contract listed, users have to define the specific events that should be ingested by the indexer.
  - Allows the same contract & event structure to be shared across two different chains (Optimism and Base for Velodrome V2 and Aerodrome respectively)
  - Defines the entities (i.e. tables) that should be loaded for each event.
  - For specific deployments of a contract on specific chains, allows users to define the address of the contract.
  - Contracts without an `address` field in the file are dynamically registered - read [here](https://docs.envio.dev/docs/dynamic-contracts) for further information on dynamic contracts.
  - To index any other events from other smart contracts, add them initially here.
- `schema.graphql`
  - Outlines the shape of data to be saved in Postgres database from the indexer, in form of entity tables.
  - For each entity, its field properties and their types are outlined.
  - Some entities are linked to other entities - for example, each `LiquidityPool` entity has 2 `Token` entities linked to it.
- `src/EventHandlers.ts`
  - Outlines how each event should be used to update the entities that are outlined in the `schema.graphql` file.
  - The event handlers are written in TypeScript for Velodrome indexer.
  - Consists of a `loader` and a `handler` function for each event - see [here](https://docs.envio.dev/docs/event-handlers) for detailed explanation of the purpose of the two functions.
  - Makes use of custom helper functions and types in `/src` directory - these have been added to minimize code duplication and refactored to increase readability of the overall codebase.
- `.env`
  - Remove `.example` from `.env` and add variables to customize secrets in the handlers and configuration.
  - `.env` variables will be included using the [dotenv](https://www.dotenv.org/docs/) library.
  - Assert in deployment that the variables are included if they are necessary for the project.

### Development

To develop the indexer further, refer to the [Envio documentation](https://docs.envio.dev/docs/overview) for additional guidelines. It is expected to run the
indexer with [pnpm](https://pnpm.io/).

### Installation

To install the necessary packages and dependencies, run pnpm's installation. The current system
is running with pnpm version 9.11.0.

```bash
pnpm i
```

#### Notable Envio CLI commands

This command will generate the `generated` folder for the repo based on the latest `config.yaml` and `schema.graphql` files.

```bash
pnpm envio codegen
```

During local testing, this command will drop all the existing information in the database and create new tables for a new local run.

```bash
pnpm envio local db-migrate setup
```

### Running the indexer

Clone this repo and then run (this single command will spin up the required docker images, run DB migrations, perform codegen for any changes and start the indexer)

```bash
pnpm envio dev
```

> Make sure you have Docker application running

To stop the indexer, run

```bash
pnpm envio stop
```
### Hydra-mode

Hydra is a postgres based database that exposes the same postgres api but stores the data in a columnlar layout which is optimised for analytic type queries that aggregate data across large numbers of rows on large datasets.

To run this indexer against hydra (rather than standard postgres) first run `pnpm enable-hydra`.

Once that completes without error, run `pnpm start`. 

NOTE: it is advised not to run `envio dev` when in hydra mode. This creates risk that the indexer will revert to standard postgres mode. While developing, rather just use standard postgres, and switch to hydra once you are happy with the logic in the indexer.


### Deploying Local Docker Environment

The local docker environment deploys all the containers needed to run a containerized Envio Indexer environment:

- postgres database
- hasura graphql engine (optional)
- envio indexer

To begin, in the root folder, simply run `make start` (note if you have run `envio dev` prior, ensure you have removed the dev environment from docker by running `envio local docker down`)

To hard restart run `make hard-restart` (this brings down all the docker images, volumes and removes any generated code and node_modules, prompting a full rebuild of the environment)

You can turn the terminal UI off by setting the environment variable TUI_OFF before running any of the make commands (`export TUI_OFF=true; make start`) however, if you'd like the TUI and to see the indexer logs in the terminal, you can run `export TUI_OFF=false; make start` and then `make indexer-logs` to see the container logs of the indexer.


To push the Envio indexer container to a container registry login to the registry and run:

`make build-push-indexer TAG=<your_image_tag> ARCH=<desired_architecture>`

example: `make build-push-indexer TAG="velodrome-indexer-prod-1" ARCH="linux/amd64"`


### Hydra setup

Similar to the above, but uses a hydra postgres instance with no hasura.

Setup files:

- `docker-compose-hydra.yaml`
- `Dockerfile-hydra`
- `envio-entrypoint-hydra.sh`

Make commands:
- `make start-hydra`
- `make hard-stop-hydra`
- `make hard-restart-hydra`

### Testing

To run the tests inside `/test` directory, run

```bash
pnpm test
```
