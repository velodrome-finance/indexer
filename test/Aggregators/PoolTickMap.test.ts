import type { PoolTickMap } from "envio";
import {
  loadPoolTickMap,
  setPoolTickMap,
} from "../../src/Aggregators/PoolTickMap";
import type { handlerContext } from "../../src/EntityTypes";

describe("PoolTickMap", () => {
  const poolId = "10-0x1234567890123456789012345678901234567890";
  const stored: PoolTickMap = {
    id: poolId,
    tickEdges: [100n, 200n],
    tickEdgeNets: [500n, -500n],
    stakedTickEdges: [100n, 200n],
    stakedTickEdgeNets: [50n, -50n],
  };
  const makeContext = (existing?: PoolTickMap) =>
    ({
      PoolTickMap: {
        get: vi.fn().mockResolvedValue(existing),
        set: vi.fn(),
      },
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    }) as unknown as handlerContext;

  it("loads the stored map, or empty maps when none exists", async () => {
    expect(await loadPoolTickMap(poolId, makeContext(stored))).toBe(stored);
    expect(await loadPoolTickMap(poolId, makeContext())).toEqual({
      id: poolId,
      tickEdges: [],
      tickEdgeNets: [],
      stakedTickEdges: [],
      stakedTickEdgeNets: [],
    });
  });

  it("replaces only the pair it is given", () => {
    const ctx = makeContext();
    const next = setPoolTickMap(
      stored,
      { tickEdges: [100n, 200n, 300n], tickEdgeNets: [500n, -200n, -300n] },
      ctx,
    );
    expect(next).toEqual({
      ...stored,
      tickEdges: [100n, 200n, 300n],
      tickEdgeNets: [500n, -200n, -300n],
    });
    expect(ctx.PoolTickMap.set).toHaveBeenCalledWith(next);
  });

  // #803 / #719 lockstep guard, moved here from updatePool: a half-written or
  // length-mismatched pair would desync the map the swap path binary-searches.
  it.each([
    ["presence", { tickEdges: [100n, 200n, 300n] }, "[TICK_EDGE_DRIFT]"],
    [
      "length",
      { tickEdges: [100n, 200n, 300n], tickEdgeNets: [500n, -500n] },
      "[TICK_EDGE_DRIFT]",
    ],
    [
      "staked presence",
      { stakedTickEdgeNets: [1n, -1n] },
      "[STAKED_TICK_DRIFT]",
    ],
  ])(
    "drops a pair with a %s mismatch, logs it and writes nothing",
    (_label, update, tag) => {
      const ctx = makeContext();
      const next = setPoolTickMap(stored, update, ctx);
      expect(next).toBe(stored);
      expect(ctx.PoolTickMap.set).not.toHaveBeenCalled();
      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining(tag));
    },
  );

  it("keeps a valid pair when the other pair is broken", () => {
    const ctx = makeContext();
    const next = setPoolTickMap(
      stored,
      {
        tickEdges: [1n],
        stakedTickEdges: [100n, 300n],
        stakedTickEdgeNets: [50n, -50n],
      },
      ctx,
    );
    expect(next.tickEdges).toEqual(stored.tickEdges);
    expect(next.stakedTickEdges).toEqual([100n, 300n]);
    expect(ctx.PoolTickMap.set).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for an empty update", () => {
    const ctx = makeContext();
    expect(setPoolTickMap(stored, {}, ctx)).toBe(stored);
    expect(ctx.PoolTickMap.set).not.toHaveBeenCalled();
  });
});
