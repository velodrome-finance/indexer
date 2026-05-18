import type { TestIndexer } from "envio";
import type { PublicClient } from "viem";
import { vi } from "vitest";
import { CHAIN_CONSTANTS, PoolId } from "../src/Constants";
import type { Pool, handlerContext } from "../src/EntityTypes";

/** Cast string to V3 Address type for mock event data */
export const asAddress = (s: string): `0x${string}` => s as `0x${string}`;

/**
 * Full surface of `EntityOperations<T>` from V3 `EvmOnEventContext`, all as
 * vitest spies. Use {@link createMockEntityOps} to mint one with sensible
 * defaults and override individual methods per test.
 */
export type MockEntityOps = {
  get: ReturnType<typeof vi.fn>;
  getOrThrow: ReturnType<typeof vi.fn>;
  getWhere: ReturnType<typeof vi.fn>;
  getOrCreate: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  deleteUnsafe: ReturnType<typeof vi.fn>;
};

/**
 * Builds a single entity's mock op-set for a fabricated handlerContext.
 * Defaults: `get`/`getOrCreate`/`getOrThrow` resolve `undefined`, `getWhere`
 * resolves `[]`, `set`/`deleteUnsafe` are no-op spies. Pass overrides to
 * customise any of them.
 *
 * @param overrides - partial map of op-names to spy implementations
 * @returns a fresh op-set with vi.fn() for every method
 */
export function createMockEntityOps(
  overrides: Partial<MockEntityOps> = {},
): MockEntityOps {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    getOrThrow: vi.fn(),
    getWhere: vi.fn().mockResolvedValue([]),
    getOrCreate: vi.fn(),
    set: vi.fn(),
    deleteUnsafe: vi.fn(),
    ...overrides,
  };
}

/**
 * Fabricates a `handlerContext` (V3 `EvmOnEventContext`) for **Pattern B**
 * logic-direct tests — those that call handler logic functions directly
 * instead of driving them through `indexer.process(...)`.
 *
 * Per-entity ops are minted via {@link createMockEntityOps} so the result has
 * the full `{get, getOrThrow, getWhere, getOrCreate, set, deleteUnsafe}`
 * surface. The `log`/`effect`/`isPreload`/`chain` baseline is filled in with
 * vitest spies and a default chain id of 10 (Optimism); override via the
 * second arg.
 *
 * @param entities - map of entity-name to op-overrides (e.g. `{ Pool: { get: vi.fn().mockResolvedValue(seededPool) } }`)
 * @param overrides - context-level overrides (chainId, isPreload, isRealtime)
 * @returns a handlerContext usable in `as`-cast-free call sites
 */
export function createTestContext(
  entities: Record<string, Partial<MockEntityOps>> = {},
  overrides: {
    chainId?: number;
    isPreload?: boolean;
    isRealtime?: boolean;
  } = {},
): handlerContext {
  const entityOps: Record<string, MockEntityOps> = {};
  for (const [name, ops] of Object.entries(entities)) {
    entityOps[name] = createMockEntityOps(ops);
  }
  return {
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    effect: vi.fn(),
    isPreload: overrides.isPreload ?? false,
    chain: {
      id: overrides.chainId ?? 10,
      isRealtime: overrides.isRealtime ?? false,
    },
    ...entityOps,
  } as unknown as handlerContext;
}

/**
 * Thin wrapper around `indexer.process(...)` for **Pattern A** event-driven
 * tests. Dispatches a single simulate item on `chainId` and returns the
 * `changes` array from envio.
 *
 * Why a helper: the raw `{chains:{[id]:{simulate:[item]}}}` envelope is noisy
 * at every call site. V3 also requires `process` to be `await`-ed, and tests
 * forget that — the wrapper makes the await explicit.
 *
 * For multi-event sequences or multi-chain interleaving, call `indexer.process`
 * directly.
 *
 * @param indexer - the test indexer (from `createTestIndexer()`)
 * @param chainId - the chain to simulate the event on
 * @param item - one simulate item: `{contract, event, params?, block?, transaction?, srcAddress?, logIndex?}`
 * @returns the `{changes}` result from `indexer.process`
 */
export async function simulateEvent(
  indexer: TestIndexer,
  chainId: number,
  item: Record<string, unknown>,
): Promise<Awaited<ReturnType<TestIndexer["process"]>>> {
  return indexer.process({
    chains: { [chainId]: { simulate: [item] } },
  } as Parameters<TestIndexer["process"]>[0]);
}

/**
 * Mutates CHAIN_CONSTANTS for a specific chainId and returns the original value
 * along with a cleanup function to restore it.
 *
 * @param chainId - The chain ID to mutate
 * @param value - The new value to set
 * @returns An object containing the original value and a cleanup function
 */
export function mutateChainConstants(
  chainId: number,
  value: { eth_client: PublicClient; lpHelperAddress: string },
): {
  originalValue:
    | { eth_client: PublicClient; lpHelperAddress: string }
    | undefined;
  cleanup: () => void;
} {
  const chainConstants = CHAIN_CONSTANTS as Record<
    number,
    { eth_client: PublicClient; lpHelperAddress: string } | undefined
  >;
  const originalValue = chainConstants[chainId];
  chainConstants[chainId] = value;

  return {
    originalValue,
    cleanup: () => {
      if (originalValue !== undefined) {
        chainConstants[chainId] = originalValue;
      } else {
        delete chainConstants[chainId];
      }
    },
  };
}

/**
 * Helper function to set up Pool on a test indexer.
 *
 * @param indexer - the test indexer (from `createTestIndexer()`)
 * @param mockLiquidityPoolData - Base liquidity pool data
 * @param poolAddress - The pool address
 * @returns void (entity is staged on the indexer)
 */
export function setupPool(
  indexer: { Pool: { set: (e: Pool) => void } },
  mockLiquidityPoolData: Pool,
  poolAddress: string,
): void {
  const poolId = PoolId(mockLiquidityPoolData.chainId, poolAddress);
  const mockPool: Pool = {
    ...mockLiquidityPoolData,
    id: poolId,
    poolAddress: poolAddress,
    isCL: mockLiquidityPoolData.isCL ?? true,
    stakedTickEdges: [...mockLiquidityPoolData.stakedTickEdges],
    stakedTickEdgeNets: [...mockLiquidityPoolData.stakedTickEdgeNets],
  };
  indexer.Pool.set(mockPool);
}
