import type { createTestIndexer } from "envio";
import {
  SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST,
  SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST,
  VOTER_CLPOOLS_FACTORY_LIST,
  VOTER_NONCL_POOLS_FACTORY_LIST,
  toChecksumAddress,
} from "../src/Constants";

/**
 * Registration helpers for the indexer's dynamic contracts.
 *
 * `Pool`, `CLPool`, `Gauge`, `CLGauge`, the voting rewards and the ALM LP
 * wrappers carry no `address:` list in config.yaml — a factory handler's
 * `contractRegister` puts their addresses on the chain at runtime. Since envio
 * v3.3.0 the test indexer routes a simulate item only to an address it has
 * actually registered, and `process()` throws for any item that never reaches a
 * handler ("simulate: N items ... never reached a handler"). Before that
 * version the item was routed regardless, so tests could simulate a `Pool`
 * `Swap` on an arbitrary address.
 *
 * Each helper replays the factory event that registers the address, at the
 * chain's start block, so the simulate items in the test's own
 * `process()` call route as they did before.
 *
 * The replay also runs the factory's `onEvent` handler, which creates entities
 * (a `Pool` row for `PoolFactory.PoolCreated`, for instance). Call these before
 * seeding fixtures so the test's own `set()` calls win.
 */

type TestIndexer = ReturnType<typeof createTestIndexer>;

const ZERO_ADDRESS = toChecksumAddress(
  "0x0000000000000000000000000000000000000000",
);

/**
 * The replay runs at the chain's configured start block. `process()` advances
 * the chain's progress block, and a later call cannot revisit a block it has
 * already passed — so registering at the earliest block the chain will accept
 * keeps every fixture block still reachable.
 */
function registrationBlock(indexer: TestIndexer, chainId: number): number {
  // biome-ignore lint/suspicious/noExplicitAny: chains is keyed by literal chain id, indexed here with a runtime value
  const chain = (indexer as any).chains[chainId];
  return chain?.startBlock ?? 0;
}

async function replay(
  indexer: TestIndexer,
  chainId: number,
  // biome-ignore lint/suspicious/noExplicitAny: simulate items are built per contract here, outside the per-chain generic
  buildSimulate: (block: { number: number; timestamp: number }) => any[],
): Promise<void> {
  const number = registrationBlock(indexer, chainId);
  const chains = {
    [chainId]: { simulate: buildSimulate({ number, timestamp: 1 }) },
    // biome-ignore lint/suspicious/noExplicitAny: chainId is a runtime value, not a literal type
  } as any;
  await indexer.process({ chains });
}

/** Register V2 `Pool` addresses via `PoolFactory.PoolCreated`. */
export async function registerPools(
  indexer: TestIndexer,
  chainId: number,
  poolAddresses: string[],
  opts: { token0?: string; token1?: string; stable?: boolean } = {},
): Promise<void> {
  await replay(indexer, chainId, (block) =>
    poolAddresses.map((pool) => ({
      contract: "PoolFactory",
      event: "PoolCreated",
      block,
      params: {
        token0: opts.token0 ?? ZERO_ADDRESS,
        token1: opts.token1 ?? ZERO_ADDRESS,
        stable: opts.stable ?? false,
        pool,
        unnamed: 0n,
      },
    })),
  );
}

/** Register a single V2 `Pool` address. */
export async function registerPool(
  indexer: TestIndexer,
  chainId: number,
  poolAddress: string,
  opts: { token0?: string; token1?: string; stable?: boolean } = {},
): Promise<void> {
  await registerPools(indexer, chainId, [poolAddress], opts);
}

/** Register `CLPool` addresses via `CLFactory.PoolCreated`. */
export async function registerCLPools(
  indexer: TestIndexer,
  chainId: number,
  poolAddresses: string[],
  opts: { token0?: string; token1?: string; tickSpacing?: bigint } = {},
): Promise<void> {
  await replay(indexer, chainId, (block) =>
    poolAddresses.map((pool) => ({
      contract: "CLFactory",
      event: "PoolCreated",
      block,
      params: {
        token0: opts.token0 ?? ZERO_ADDRESS,
        token1: opts.token1 ?? ZERO_ADDRESS,
        tickSpacing: opts.tickSpacing ?? 1n,
        pool,
      },
    })),
  );
}

/** Register a single `CLPool` address. */
export async function registerCLPool(
  indexer: TestIndexer,
  chainId: number,
  poolAddress: string,
  opts: { token0?: string; token1?: string; tickSpacing?: bigint } = {},
): Promise<void> {
  await registerCLPools(indexer, chainId, [poolAddress], opts);
}

type GaugeRegistration = {
  /** Gauge address. Registered as `CLGauge` when `isCL`, else as `Gauge`. */
  gauge?: string;
  /** Pool the gauge is for. */
  pool?: string;
  /** `FeesVotingReward` address to register alongside the gauge. */
  feeVotingReward?: string;
  /** `BribesVotingReward` address (Voter chains only). */
  bribeVotingReward?: string;
  /** `SuperchainIncentiveVotingReward` address (leaf-voter chains only). */
  incentiveVotingReward?: string;
  /** Pick the CL or the non-CL pool factory, which decides `CLGauge` vs `Gauge`. */
  isCL?: boolean;
};

/**
 * Register a gauge and its voting rewards via `Voter.GaugeCreated`.
 * `Voter` is configured on Optimism (10) and Base (8453); the other chains use
 * {@link registerLeafVoterGauge}.
 */
export async function registerVoterGauge(
  indexer: TestIndexer,
  chainId: number,
  reg: GaugeRegistration,
): Promise<void> {
  const poolFactory = reg.isCL
    ? VOTER_CLPOOLS_FACTORY_LIST[0]
    : VOTER_NONCL_POOLS_FACTORY_LIST[0];
  await replay(indexer, chainId, (block) => [
    {
      contract: "Voter",
      event: "GaugeCreated",
      block,
      params: {
        poolFactory,
        votingRewardsFactory: ZERO_ADDRESS,
        gaugeFactory: ZERO_ADDRESS,
        pool: reg.pool ?? ZERO_ADDRESS,
        bribeVotingReward: reg.bribeVotingReward ?? ZERO_ADDRESS,
        feeVotingReward: reg.feeVotingReward ?? ZERO_ADDRESS,
        gauge: reg.gauge ?? ZERO_ADDRESS,
        creator: ZERO_ADDRESS,
      },
    },
  ]);
}

/**
 * Register a gauge and its voting rewards via `SuperchainLeafVoter.GaugeCreated`,
 * used on every chain other than Optimism and Base.
 */
export async function registerLeafVoterGauge(
  indexer: TestIndexer,
  chainId: number,
  reg: GaugeRegistration,
): Promise<void> {
  const poolFactory = reg.isCL
    ? SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST[0]
    : SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST[0];
  await replay(indexer, chainId, (block) => [
    {
      contract: "SuperchainLeafVoter",
      event: "GaugeCreated",
      block,
      params: {
        poolFactory,
        votingRewardsFactory: ZERO_ADDRESS,
        gaugeFactory: ZERO_ADDRESS,
        pool: reg.pool ?? ZERO_ADDRESS,
        incentiveVotingReward: reg.incentiveVotingReward ?? ZERO_ADDRESS,
        feeVotingReward: reg.feeVotingReward ?? ZERO_ADDRESS,
        gauge: reg.gauge ?? ZERO_ADDRESS,
      },
    },
  ]);
}

/** Register an `ALMLPWrapperV1` address via `ALMDeployFactoryV1.StrategyCreated`. */
export async function registerALMLPWrapperV1(
  indexer: TestIndexer,
  chainId: number,
  lpWrapper: string,
  opts: { pool?: string } = {},
): Promise<void> {
  await replay(indexer, chainId, (block) => [
    {
      contract: "ALMDeployFactoryV1",
      event: "StrategyCreated",
      block,
      params: {
        params: {
          pool: opts.pool ?? ZERO_ADDRESS,
          ammPosition: {
            token0: ZERO_ADDRESS,
            token1: ZERO_ADDRESS,
            property: 0n,
            tickLower: 0n,
            tickUpper: 0n,
            liquidity: 0n,
          },
          strategyParams: {
            strategyType: 0n,
            tickNeighborhood: 0n,
            tickSpacing: 0n,
            width: 0n,
          },
          lpWrapper,
          synthetixFarm: ZERO_ADDRESS,
          caller: ZERO_ADDRESS,
        },
      },
    },
  ]);
}

/** Register an `ALMLPWrapperV2` address via `ALMDeployFactoryV2.StrategyCreated`. */
export async function registerALMLPWrapperV2(
  indexer: TestIndexer,
  chainId: number,
  lpWrapper: string,
  opts: { pool?: string } = {},
): Promise<void> {
  await replay(indexer, chainId, (block) => [
    {
      contract: "ALMDeployFactoryV2",
      event: "StrategyCreated",
      block,
      params: {
        params: {
          pool: opts.pool ?? ZERO_ADDRESS,
          // The V2 StrategyCreated handler reads `ammPosition[0]`, so the
          // replay needs one entry even though its values are unused here.
          ammPosition: [
            {
              token0: ZERO_ADDRESS,
              token1: ZERO_ADDRESS,
              property: 0n,
              tickLower: 0n,
              tickUpper: 0n,
              liquidity: 0n,
            },
          ],
          strategyParams: {
            strategyType: 0n,
            tickNeighborhood: 0n,
            tickSpacing: 0n,
            width: 0n,
            maxLiquidityRatioDeviationX96: 0n,
          },
          lpWrapper,
          caller: ZERO_ADDRESS,
        },
      },
    },
  ]);
}
