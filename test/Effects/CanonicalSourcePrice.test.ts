import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_SNAPSHOT_BACKOFF_MS,
  CANONICAL_SNAPSHOT_FINALITY_BLOCKS,
  type CanonicalPriceClickHouse,
  type FetchLike,
  type SourceSnapshotRow,
  buildCanonicalSourcePriceQuery,
  decideCanonicalSourcePrice,
  fetchCanonicalSourcePrice,
  getCanonicalSourcePrice,
  readCanonicalPriceSettings,
  resetCanonicalPriceSettings,
} from "../../src/Effects/CanonicalSourcePrice";
import { runEffect } from "./setup";

const SRC = "10-0x4200000000000000000000000000000000000006";
const HOUR = 3_600_000;
const H = 1_794_733_200_000; // 2026-11-15 09:00 UTC
const M = CANONICAL_SNAPSHOT_FINALITY_BLOCKS;
/** Source blocks: 1800 per hour (2 s blocks); the row of hour h at its start. */
const blockAt = (hourMs: number): number => 100_000 + (hourMs - H) / 2000;

function row(
  hourMs: number,
  priceSource: string | null = "pool",
  price = "2000000000000000000000",
  extra: Partial<SourceSnapshotRow> = {},
): SourceSnapshotRow {
  return {
    id: `${SRC}-${hourMs}`,
    priceSource,
    pricePerUSDNew: price,
    envio_change: "SET",
    block: blockAt(hourMs),
    frontier_block: null,
    ...extra,
  };
}

describe("decideCanonicalSourcePrice", () => {
  const decide = (rows: SourceSnapshotRow[], frontier: number | null) =>
    decideCanonicalSourcePrice(SRC, H, rows, frontier);

  it("source frontier before the hour: pending", () => {
    // Hours H-2 and H-1 exist, H has not been reached.
    const rows = [row(H - 2 * HOUR), row(H - HOUR)];
    expect(decide(rows, blockAt(H) - 10).kind).toBe("pending");
  });

  it("the hour's row inside the reorg margin: pending", () => {
    const rows = [row(H - HOUR), row(H)];
    expect(decide(rows, blockAt(H) + M - 1)).toMatchObject({
      kind: "pending",
    });
  });

  it("the hour's row past the margin: its price, even before the hour ends", () => {
    const rows = [row(H - HOUR), row(H, "pool", "2100")];
    expect(decide(rows, blockAt(H) + M)).toEqual({
      kind: "price",
      priceUSD: 2100n,
      sourceHourMs: H,
    });
  });

  it("missing hour: looks back once the source has left the hour beyond the margin", () => {
    const rows = [row(H - HOUR, "pool", "1900"), row(H + HOUR)];
    // H+1's row exists but is still inside the margin: H may yet get a row.
    expect(decide(rows, blockAt(H + HOUR) + M - 1).kind).toBe("pending");
    expect(decide(rows, blockAt(H + HOUR) + M)).toEqual({
      kind: "price",
      priceUSD: 1900n,
      sourceHourMs: H - HOUR,
    });
  });

  it("looks back at most two hours, never forward", () => {
    const rows = [
      row(H - 3 * HOUR, "pool", "1700"),
      row(H + HOUR, "pool", "2200"),
    ];
    expect(decide(rows, blockAt(H + 5 * HOUR))).toEqual({ kind: "none" });
    const twoBack = [row(H - 2 * HOUR, "pool", "1800"), row(H + HOUR)];
    expect(decide(twoBack, blockAt(H + 5 * HOUR))).toEqual({
      kind: "price",
      priceUSD: 1800n,
      sourceHourMs: H - 2 * HOUR,
    });
  });

  it("a carried source hour is not passed on: the hour before is used", () => {
    const rows = [row(H - HOUR, "pool", "1950"), row(H, "carried", "1950")];
    expect(decide(rows, blockAt(H) + M)).toEqual({
      kind: "price",
      priceUSD: 1950n,
      sourceHourMs: H - HOUR,
    });
  });

  it.each([
    ["carried", "1950"],
    ["unpriced", "0"],
    ["canonical-seed", "1950"],
    ["canonical", "1950"],
    ["override", "0"],
    [null, "1950"],
  ])("a source with only %s rows has no price (final: none)", (tag, price) => {
    const rows = [
      row(H - 2 * HOUR, tag, price),
      row(H - HOUR, tag, price),
      row(H, tag, price),
    ];
    expect(decide(rows, blockAt(H + 3 * HOUR))).toEqual({ kind: "none" });
  });

  it("accepts pinned rows and rejects a zero pool price", () => {
    expect(decide([row(H, "pinned", "1")], blockAt(H) + M).kind).toBe("price");
    const zero = [row(H - HOUR, "pool", "5"), row(H, "pool", "0")];
    expect(decide(zero, blockAt(H) + M)).toMatchObject({
      sourceHourMs: H - HOUR,
    });
  });

  it("ignores deleted rows and rows of another id shape", () => {
    const rows = [
      row(H, "pool", "2100", { envio_change: "DELETE" }),
      { ...row(H - HOUR, "pool", "1900"), id: `${SRC}-143801012` },
      row(H + HOUR),
    ];
    // H deleted → empty, H-1 not a snapshot id → empty, H-2 empty → none.
    expect(decide(rows, blockAt(H + 2 * HOUR))).toEqual({ kind: "none" });
  });

  it("a row whose checkpoint has no block is never final", () => {
    expect(decide([row(H, "pool", "1", { block: null })], 10 ** 9).kind).toBe(
      "pending",
    );
  });

  it("no frontier: pending", () => {
    expect(decide([row(H)], null).kind).toBe("pending");
  });
});

describe("buildCanonicalSourcePriceQuery", () => {
  const base = { database: "velo_x", sourceTokenId: SRC, hourMs: H };

  it("reads a primary-key range of the source's snapshots below the shared frontier", () => {
    const sql = buildCanonicalSourcePriceQuery({ ...base, perChain: false });
    expect(sql).toContain(`id >= '${SRC}-${H - 2 * HOUR}'`);
    expect(sql).toContain(`id <= '${SRC}-${H + 24 * HOUR}'`);
    expect(sql).toContain("chainId = 10");
    expect(sql).toContain(
      "(SELECT max(checkpoint_id) FROM `velo_x`.envio_chains FINAL) AS fr",
    );
    expect(sql).toContain("envio_checkpoint_id <= fr");
    expect(sql).toContain("LIMIT 1 BY id");
    expect(sql).toContain("FROM `velo_x`.envio_history_TokenPriceSnapshot");
    expect(sql).not.toMatch(/SETTINGS/);
  });

  it("uses the source chain's own frontier per chain", () => {
    const sql = buildCanonicalSourcePriceQuery({ ...base, perChain: true });
    expect(sql).toContain(
      "(SELECT checkpoint_id FROM `velo_x`.envio_chains FINAL WHERE chain_id = 10) AS fr",
    );
  });

  it("refuses a malformed source id", () => {
    expect(() =>
      buildCanonicalSourcePriceQuery({
        ...base,
        sourceTokenId: "x",
        perChain: false,
      }),
    ).toThrow();
  });
});

describe("readCanonicalPriceSettings", () => {
  it("defaults: the snapshot effect on, envio's ClickHouse", () => {
    expect(
      readCanonicalPriceSettings({
        ENVIO_CLICKHOUSE_HOST: "http://127.0.0.1:8160",
        ENVIO_CLICKHOUSE_DATABASE: "velo_a",
        ENVIO_CLICKHOUSE_USERNAME: "velo",
        ENVIO_CLICKHOUSE_PASSWORD: "pw",
      }),
    ).toEqual({
      snapshotEffect: true,
      rpcEffect: true,
      clickhouse: {
        url: "http://127.0.0.1:8160",
        database: "velo_a",
        username: "velo",
        password: "pw",
      },
    });
  });

  it("overrides the server (credentials from the URL) and the database", () => {
    const s = readCanonicalPriceSettings({
      ENVIO_CLICKHOUSE_HOST: "http://127.0.0.1:8160",
      ENVIO_CLICKHOUSE_DATABASE: "velo_a",
      ENVIO_CLICKHOUSE_USERNAME: "velo",
      ENVIO_CLICKHOUSE_PASSWORD: "pw",
      PRICING_CANONICAL_CLICKHOUSE_URL:
        "http://reader:s%40cret@127.0.0.1:8150/",
      PRICING_CANONICAL_CLICKHOUSE_DATABASE: "velo_optimism",
    });
    expect(s.clickhouse).toEqual({
      url: "http://127.0.0.1:8150",
      database: "velo_optimism",
      username: "reader",
      password: "s@cret",
    });
  });

  it("a URL override without credentials keeps envio's", () => {
    const s = readCanonicalPriceSettings({
      ENVIO_CLICKHOUSE_HOST: "http://a:1",
      ENVIO_CLICKHOUSE_DATABASE: "d",
      ENVIO_CLICKHOUSE_USERNAME: "u",
      ENVIO_CLICKHOUSE_PASSWORD: "p",
      PRICING_CANONICAL_CLICKHOUSE_URL: "b:2",
    });
    expect(s.clickhouse).toMatchObject({
      url: "http://b:2",
      username: "u",
      password: "p",
    });
  });

  it("switch off; no ClickHouse without host and database", () => {
    expect(
      readCanonicalPriceSettings({
        PRICING_CANONICAL_SNAPSHOT_EFFECT: "0",
        ENVIO_CLICKHOUSE_HOST: "http://a:1",
      }),
    ).toEqual({ snapshotEffect: false, rpcEffect: true });
  });

  it("the RPC effect: on by default, off under a test runner unless set", () => {
    const rpc = (env: Record<string, string>) =>
      readCanonicalPriceSettings(env).rpcEffect;
    expect(rpc({})).toBe(true);
    expect(rpc({ PRICING_CANONICAL_RPC_EFFECT: "false" })).toBe(false);
    expect(rpc({ VITEST: "true" })).toBe(false);
    expect(rpc({ NODE_ENV: "test" })).toBe(false);
    expect(rpc({ VITEST: "true", PRICING_CANONICAL_RPC_EFFECT: "true" })).toBe(
      true,
    );
  });
});

describe("fetchCanonicalSourcePrice", () => {
  const clickhouse: CanonicalPriceClickHouse = {
    url: "http://ch.test:8123",
    database: "velo_x",
    username: "reader",
    password: "pw",
  };
  let now = 1_000_000;
  const warn = vi.fn();

  /** A fake ClickHouse: mode query → `perChain`, snapshot query → `rows`. */
  function fakeClickHouse(opts: {
    perChain?: boolean;
    rows?: SourceSnapshotRow[];
    fail?: "http" | "throw";
  }) {
    const bodies: string[] = [];
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      bodies.push(init.body);
      expect(url).toBe("http://ch.test:8123/");
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("reader:pw").toString("base64")}`,
      );
      if (opts.fail === "throw") throw new Error("timeout");
      if (opts.fail === "http") {
        return { ok: false, status: 500, text: async () => "Code: 60" };
      }
      const lines = init.body.includes("system.tables")
        ? [{ per_chain: opts.perChain ? 1 : 0 }]
        : (opts.rows ?? []);
      return {
        ok: true,
        status: 200,
        text: async () => lines.map((l) => JSON.stringify(l)).join("\n"),
      };
    });
    return { fetchImpl, bodies };
  }
  const run = (fetchImpl: FetchLike, hourMs = H) =>
    fetchCanonicalSourcePrice(
      { sourceTokenId: SRC, hourMs },
      { clickhouse, fetchImpl, nowMs: () => now, warn },
    );

  beforeEach(() => {
    resetCanonicalPriceSettings();
    warn.mockClear();
    now = 1_000_000;
  });

  it("detects the checkpoint mode once and reads the snapshots", async () => {
    const frontier = blockAt(H) + M;
    const ch = fakeClickHouse({
      perChain: true,
      rows: [
        { ...row(H - HOUR), frontier_block: frontier },
        { ...row(H, "pool", "2100"), frontier_block: frontier },
      ],
    });
    expect(await run(ch.fetchImpl)).toEqual({
      kind: "price",
      priceUSD: 2100n,
      sourceHourMs: H,
    });
    await run(ch.fetchImpl, H + HOUR);
    expect(ch.bodies.filter((b) => b.includes("system.tables"))).toHaveLength(
      1,
    );
    expect(ch.bodies[1]).toContain("WHERE chain_id = 10) AS fr");
  });

  it("no rows: pending", async () => {
    const ch = fakeClickHouse({ rows: [] });
    expect((await run(ch.fetchImpl)).kind).toBe("pending");
  });

  it.each(["http", "throw"] as const)(
    "a ClickHouse error (%s) is pending, logged, and backs off",
    async (fail) => {
      const ch = fakeClickHouse({ fail });
      expect((await run(ch.fetchImpl)).kind).toBe("pending");
      expect(warn).toHaveBeenCalledTimes(1);
      const calls = ch.fetchImpl.mock.calls.length;
      now += CANONICAL_SNAPSHOT_BACKOFF_MS - 1;
      expect((await run(ch.fetchImpl)).kind).toBe("pending");
      expect(ch.fetchImpl.mock.calls.length).toBe(calls);
      now += 1;
      await run(ch.fetchImpl);
      expect(ch.fetchImpl.mock.calls.length).toBeGreaterThan(calls);
    },
  );

  it("not configured: pending without a request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const out = await fetchCanonicalSourcePrice(
      { sourceTokenId: SRC, hourMs: H },
      { clickhouse: undefined, fetchImpl, nowMs: () => now, warn },
    );
    expect(out.kind).toBe("pending");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("getCanonicalSourcePrice effect", () => {
  beforeEach(() => {
    vi.stubEnv("ENVIO_CLICKHOUSE_HOST", "http://ch.test:8123");
    vi.stubEnv("ENVIO_CLICKHOUSE_DATABASE", "velo_x");
    resetCanonicalPriceSettings();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetCanonicalPriceSettings();
  });

  function serve(rows: SourceSnapshotRow[] | "error") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        if (rows === "error") throw new Error("connect ECONNREFUSED");
        const lines = init.body.includes("system.tables")
          ? [{ per_chain: 0 }]
          : rows;
        return {
          ok: true,
          status: 200,
          text: async () => lines.map((l) => JSON.stringify(l)).join("\n"),
        };
      }),
    );
  }
  const input = {
    sourceTokenId: SRC,
    hourMs: H,
    requesterTokenId: "34443-0x4200000000000000000000000000000000000006",
  };

  it("caches a settled price", async () => {
    serve([{ ...row(H, "pool", "2100"), frontier_block: blockAt(H) + M }]);
    const { output, context } = await runEffect(getCanonicalSourcePrice, input);
    expect(output).toEqual({ priceUSD: 2100n, sourceHourMs: H });
    expect(context.cache).toBe(true);
  });

  it("caches a settled 'no price'", async () => {
    const f = blockAt(H + 3 * HOUR);
    serve([
      { ...row(H - 2 * HOUR, "carried"), frontier_block: f },
      { ...row(H - HOUR, "carried"), frontier_block: f },
      { ...row(H, "carried"), frontier_block: f },
    ]);
    const { output, context } = await runEffect(getCanonicalSourcePrice, input);
    expect(output).toEqual({ priceUSD: 0n, sourceHourMs: 0 });
    expect(context.cache).toBe(true);
  });

  it.each([
    ["the hour is not settled", [{ ...row(H), frontier_block: blockAt(H) }]],
    ["ClickHouse fails", "error" as const],
  ])("does not cache when %s", async (_, rows) => {
    serve(rows);
    const { output, context } = await runEffect(getCanonicalSourcePrice, input);
    expect(output).toEqual({ priceUSD: 0n, sourceHourMs: 0 });
    expect(context.cache).toBe(false);
  });
});
