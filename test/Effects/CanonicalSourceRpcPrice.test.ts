import { HttpRequestError } from "viem";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PoolId, TokenId, toChecksumAddress } from "../../src/Constants";
import type { BlockSample } from "../../src/Effects/BlockAtTimestamp";
import {
  CANONICAL_RPC_BACKOFF_MS,
  CANONICAL_RPC_MARGIN_SECONDS,
  type CanonicalRpcDeps,
  type SourcePoolRead,
  fetchCanonicalSourceRpcPrice,
  getCanonicalRpcStats,
  getCanonicalSourceRpcPrice,
  resetCanonicalRpcState,
  selectCanonicalRpcCandidate,
} from "../../src/Effects/CanonicalSourceRpcPrice";
import {
  type CanonicalSourcePool,
  getCanonicalSourcePools,
} from "../../src/PriceOverrides";
import {
  captureReadError,
  failingViemClient,
  installRpcMocks,
  runEffect,
} from "./setup";

const OP = 10;
const BASE = 8453;
const OP_WETH = TokenId(
  OP,
  toChecksumAddress("0x4200000000000000000000000000000000000006"),
);
const OP_VELO = TokenId(
  OP,
  toChecksumAddress("0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db"),
);
const BASE_AERO = TokenId(
  BASE,
  toChecksumAddress("0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee"),
);
const WETH_POOLS = getCanonicalSourcePools(OP_WETH);
const VELO_POOLS = getCanonicalSourcePools(OP_VELO);
const AERO_POOLS = getCanonicalSourcePools(BASE_AERO);

const E18 = 10n ** 18n;
const USDC = (n: number) => BigInt(n) * 10n ** 6n;

/** Integer square root. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** sqrtPriceX96 of a USDC(6, token0) / WETH(18, token1) pool at `usd` per WETH. */
const sqrtForWeth = (usd: bigint): bigint =>
  isqrt((10n ** 12n * 2n ** 192n) / usd);

/** A CL USDC/WETH state: `usdc` USDC and the same value of WETH at `usd`. */
const wethPool = (usd: number, usdc: number): SourcePoolRead => ({
  reserve0: USDC(usdc),
  reserve1: (BigInt(usdc) * E18) / BigInt(usd),
  sqrtPriceX96: sqrtForWeth(BigInt(usd)),
});

const near = (actual: bigint, expected: bigint) => {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(diff * 10n ** 9n).toBeLessThan(expected);
};

/** 2026-11-15 09:00 UTC. */
const H = 1_794_733_200;

describe("selectCanonicalRpcCandidate", () => {
  it("prices WETH from a CL pool's sqrt price at the USDC side's depth", () => {
    const best = selectCanonicalRpcCandidate(OP_WETH, WETH_POOLS, [
      wethPool(2000, 3_000_000),
      undefined,
    ]);
    expect(best?.sourceId).toBe(PoolId(OP, WETH_POOLS[0].address));
    near(best?.priceUSD ?? 0n, 2000n * E18);
    expect(best?.depthUSD).toBe(3_000_000n * E18);
  });

  it("the deepest qualifying pool wins, whatever its position in the list", () => {
    const best = selectCanonicalRpcCandidate(OP_WETH, WETH_POOLS, [
      wethPool(2000, 400_000),
      wethPool(2010, 900_000),
    ]);
    expect(best?.sourceId).toBe(PoolId(OP, WETH_POOLS[1].address));
    near(best?.priceUSD ?? 0n, 2010n * E18);
  });

  it("a pool under the source chain's depth floor ($5,000 on Optimism) is no price", () => {
    expect(
      selectCanonicalRpcCandidate(OP_WETH, WETH_POOLS, [
        wethPool(2000, 4_999),
        undefined,
      ]),
    ).toBeUndefined();
  });

  it("a lopsided pool (1000× imbalance) is no price", () => {
    expect(
      selectCanonicalRpcCandidate(OP_WETH, WETH_POOLS, [
        { ...wethPool(2000, 10_000), reserve1: 100_000n * E18 },
        undefined,
      ]),
    ).toBeUndefined();
  });

  it("V2 pools: the source as token1 (USDC/VELO) and as token0 (AERO/USDC)", () => {
    const velo = selectCanonicalRpcCandidate(OP_VELO, VELO_POOLS, [
      { reserve0: USDC(500_000), reserve1: 10_000_000n * E18 },
    ]);
    expect(velo?.priceUSD).toBe(E18 / 20n);
    expect(velo?.depthUSD).toBe(500_000n * E18);
    const aero = selectCanonicalRpcCandidate(BASE_AERO, AERO_POOLS, [
      { reserve0: 20_000_000n * E18, reserve1: USDC(9_000_000) },
    ]);
    expect(aero?.priceUSD).toBe((45n * E18) / 100n);
    expect(aero?.sourceId).toBe(PoolId(BASE, AERO_POOLS[0].address));
  });

  it("an empty pool or no reads: no price", () => {
    expect(
      selectCanonicalRpcCandidate(OP_VELO, VELO_POOLS, [
        { reserve0: 0n, reserve1: 0n },
      ]),
    ).toBeUndefined();
    expect(
      selectCanonicalRpcCandidate(OP_VELO, VELO_POOLS, [undefined]),
    ).toBeUndefined();
  });
});

/** A fake 2 s chain where block 1,000,000 is at H and the head five days on. */
function fakeDeps(opts: { headBlock?: number } = {}) {
  const state = {
    head: opts.headBlock ?? 1_000_000 + 216_000,
    nowMs: 1_000_000,
    blockRequests: [] as (number | "latest")[],
    poolReads: [] as { pool: string; block: number }[],
    getBlockError: undefined as Error | undefined,
    readPool: ((pool) =>
      pool.isCL
        ? wethPool(2000, 3_000_000)
        : { reserve0: USDC(500_000), reserve1: 10_000_000n * E18 }) as (
      pool: CanonicalSourcePool,
      block: number,
    ) => SourcePoolRead | undefined,
    warnings: [] as string[],
  };
  const timestampOf = (n: number) => H + 2 * (n - 1_000_000);
  const deps: CanonicalRpcDeps = {
    getBlock: async (_chainId, block): Promise<BlockSample> => {
      state.blockRequests.push(block);
      if (state.getBlockError) throw state.getBlockError;
      const number = block === "latest" ? state.head : block;
      return { number, timestamp: timestampOf(number) };
    },
    readPool: async (_chainId, pool, block) => {
      state.poolReads.push({ pool: pool.address, block });
      return state.readPool(pool, block);
    },
    nowMs: () => state.nowMs,
    warn: (message) => state.warnings.push(message),
  };
  return { state, deps, timestampOf };
}

describe("fetchCanonicalSourceRpcPrice", () => {
  beforeEach(() => resetCanonicalRpcState());

  it("reads the pools at the block ten minutes before the hour", async () => {
    const { state, deps, timestampOf } = fakeDeps();
    const decision = await fetchCanonicalSourceRpcPrice(
      { sourceTokenId: OP_WETH, hourMs: H * 1000 },
      deps,
    );
    const block = 1_000_000 - CANONICAL_RPC_MARGIN_SECONDS / 2;
    expect(decision).toMatchObject({
      kind: "price",
      poolAddress: WETH_POOLS[0].address,
      depthUSD: 3_000_000n * E18,
      block: { number: block, timestamp: timestampOf(block) },
    });
    expect(state.poolReads).toEqual(
      WETH_POOLS.map((pool) => ({ pool: pool.address, block })),
    );
    // Calibration (head + one sample) and one lookup.
    expect(state.blockRequests).toHaveLength(3);
  });

  it("costs one block request per further hour, and none for another source in the same hour", async () => {
    const { state, deps } = fakeDeps();
    for (let h = 0; h < 24; h++) {
      const decision = await fetchCanonicalSourceRpcPrice(
        { sourceTokenId: OP_WETH, hourMs: (H + h * 3600) * 1000 },
        deps,
      );
      expect(decision.kind).toBe("price");
    }
    expect(state.blockRequests).toHaveLength(2 + 24);
    const before = state.blockRequests.length;
    const velo = await fetchCanonicalSourceRpcPrice(
      { sourceTokenId: OP_VELO, hourMs: (H + 5 * 3600) * 1000 },
      deps,
    );
    expect(velo).toMatchObject({ kind: "price", priceUSD: E18 / 20n });
    expect(state.blockRequests).toHaveLength(before);
    expect(getCanonicalRpcStats()).toMatchObject({
      blockRequests: 26,
      poolReads: 24 * 2 + 1,
    });
  });

  it("a pool without state at the block (not deployed yet) leaves the other pool", async () => {
    const { state, deps } = fakeDeps();
    state.readPool = (pool) =>
      pool.address === WETH_POOLS[0].address
        ? undefined
        : wethPool(1990, 800_000);
    const decision = await fetchCanonicalSourceRpcPrice(
      { sourceTokenId: OP_WETH, hourMs: H * 1000 },
      deps,
    );
    expect(decision).toMatchObject({
      kind: "price",
      poolAddress: WETH_POOLS[1].address,
    });
  });

  it("no qualifying pool at a final block: a settled 'none'", async () => {
    const { state, deps } = fakeDeps();
    state.readPool = () => undefined;
    expect(
      await fetchCanonicalSourceRpcPrice(
        { sourceTokenId: OP_WETH, hourMs: H * 1000 },
        deps,
      ),
    ).toMatchObject({ kind: "none" });
    expect(state.warnings).toEqual([]);
  });

  it("a source head that has not reached the hour: pending, pools not read", async () => {
    // Head 100 s before the hour: the block ten minutes back exists, but the
    // hour itself has not started on the source chain.
    const { state, deps } = fakeDeps({ headBlock: 1_000_000 - 50 });
    const decision = await fetchCanonicalSourceRpcPrice(
      { sourceTokenId: OP_WETH, hourMs: H * 1000 },
      deps,
    );
    expect(decision.kind).toBe("pending");
    expect(state.poolReads).toEqual([]);
    // Once the head passes the hour the same request is answered.
    state.head = 1_000_000 + 10;
    expect(
      (
        await fetchCanonicalSourceRpcPrice(
          { sourceTokenId: OP_WETH, hourMs: H * 1000 },
          deps,
        )
      ).kind,
    ).toBe("price");
  });

  it("an RPC failure: pending, logged, and no requests during the backoff", async () => {
    const { state, deps } = fakeDeps();
    state.getBlockError = new Error("rpc down");
    const input = { sourceTokenId: OP_WETH, hourMs: H * 1000 };
    expect((await fetchCanonicalSourceRpcPrice(input, deps)).kind).toBe(
      "pending",
    );
    expect(state.warnings).toHaveLength(1);
    const requests = state.blockRequests.length;

    state.getBlockError = undefined;
    state.nowMs += CANONICAL_RPC_BACKOFF_MS - 1;
    expect(await fetchCanonicalSourceRpcPrice(input, deps)).toEqual({
      kind: "pending",
      reason: "RPC backoff after an error",
    });
    expect(state.blockRequests).toHaveLength(requests);

    // After the backoff the failed calibration is redone and the read succeeds.
    state.nowMs += 1;
    expect((await fetchCanonicalSourceRpcPrice(input, deps)).kind).toBe(
      "price",
    );
  });

  it("a failed pool read: pending, never 'none'", async () => {
    const { state, deps } = fakeDeps();
    state.readPool = () => {
      throw new Error("timeout");
    };
    expect(
      (
        await fetchCanonicalSourceRpcPrice(
          { sourceTokenId: OP_WETH, hourMs: H * 1000 },
          deps,
        )
      ).kind,
    ).toBe("pending");
    expect(state.warnings).toHaveLength(1);
  });

  it("a source without pools, or an input that is not an hour: 'none' without requests", async () => {
    const { state, deps } = fakeDeps();
    expect(
      await fetchCanonicalSourceRpcPrice(
        {
          sourceTokenId: TokenId(1, OP_WETH.slice(3)),
          hourMs: H * 1000,
        },
        deps,
      ),
    ).toMatchObject({ kind: "none" });
    expect(
      await fetchCanonicalSourceRpcPrice(
        { sourceTokenId: OP_WETH, hourMs: H * 1000 + 1 },
        deps,
      ),
    ).toMatchObject({ kind: "none" });
    expect(state.blockRequests).toEqual([]);
  });
});

describe("getCanonicalSourceRpcPrice (effect)", () => {
  let restore: () => void = () => {};
  let revert: unknown;
  beforeAll(async () => {
    revert = await captureReadError(
      failingViemClient({ code: -32000, message: "execution reverted" }),
    );
  });
  beforeEach(() => resetCanonicalRpcState());
  afterEach(() => restore());

  const HEAD = 1_000_000 + 216_000;
  const getBlock = vi.fn(
    async (args: { blockTag?: string; blockNumber?: bigint }) => {
      const number = args.blockNumber ?? BigInt(HEAD);
      return {
        number,
        timestamp: BigInt(H) + 2n * (number - 1_000_000n),
      };
    },
  );
  const input = { sourceTokenId: OP_WETH, hourMs: H * 1000 };

  it("returns the price with the pool, depth and source block", async () => {
    const readContract = vi.fn(
      async (args: {
        address: string;
        functionName: string;
        args?: readonly string[];
        blockNumber: bigint;
      }) => {
        expect(args.blockNumber).toBe(999_700n);
        if (args.functionName === "slot0") return [sqrtForWeth(2000n), 0];
        // balanceOf(pool) on USDC / WETH
        return args.address === WETH_POOLS[0].token0.address
          ? USDC(3_000_000)
          : 1_500n * E18;
      },
    );
    restore = installRpcMocks(OP, { getBlock, readContract } as never);
    const { output, context } = await runEffect<{
      priceUSD: bigint;
      depthUSD: bigint;
      poolAddress: string;
      sourceBlock: number;
      sourceTimestamp: number;
    }>(getCanonicalSourceRpcPrice, input);
    near(output.priceUSD, 2000n * E18);
    expect(output).toMatchObject({
      depthUSD: 3_000_000n * E18,
      sourceBlock: 999_700,
      sourceTimestamp: H - 600,
    });
    expect(WETH_POOLS.map((p) => p.address)).toContain(output.poolAddress);
    expect(context.cache).toBe(true);
    // Two CL pools: slot0 + two balances each.
    expect(readContract).toHaveBeenCalledTimes(6);
  });

  it("pools that revert at the block (not deployed): a cacheable 'no price'", async () => {
    const readContract = vi.fn(async () => {
      throw revert;
    });
    restore = installRpcMocks(OP, { getBlock, readContract } as never);
    const { output, context } = await runEffect(
      getCanonicalSourceRpcPrice,
      input,
    );
    expect(output).toMatchObject({ priceUSD: 0n, poolAddress: "" });
    expect(context.cache).toBe(true);
  });

  it("a transient RPC failure throws, so envio stores nothing", async () => {
    const readContract = vi.fn(async () => {
      throw new HttpRequestError({ status: 503, url: "https://x" });
    });
    restore = installRpcMocks(OP, { getBlock, readContract } as never);
    await expect(runEffect(getCanonicalSourceRpcPrice, input)).rejects.toThrow(
      /no canonical RPC price yet/,
    );
    expect(getCanonicalRpcStats().pending).toBe(1);
  });
});
