import { S, createEffect } from "envio";

/**
 * The canonical source's hourly price, read from this deployment's ClickHouse
 * (ADR 0009, flow F, option 1). A leaf token with a canonical source (WETH on a
 * leaf chain → Optimism WETH, XVELO → Optimism VELO, xAERO → Base AERO; see
 * `CANONICAL_SOURCES` in src/PriceOverrides.ts) that has no qualifying local
 * pool, no live source and no seed hour asks for the source's
 * `TokenPriceSnapshot` of the last complete clock hour before its block.
 *
 * Reading ClickHouse instead of the source chain's `Token` row is what makes
 * this work in per-chain mode, where a handler cannot read another chain's
 * entities. The read is bounded by the source chain's commit frontier, the
 * same rule envio's own views apply, so it never sees rows that are not yet
 * committed.
 *
 * Environment (read once per process; see {@link readCanonicalPriceSettings}):
 *
 * - `ENVIO_CLICKHOUSE_HOST`, `ENVIO_CLICKHOUSE_DATABASE`,
 *   `ENVIO_CLICKHOUSE_USERNAME`, `ENVIO_CLICKHOUSE_PASSWORD`: envio's own
 *   ClickHouse settings, used by default (the source chain is in the same
 *   deployment).
 * - `PRICING_CANONICAL_CLICKHOUSE_URL`: another ClickHouse server for the
 *   source (an HTTP URL; credentials may be given as `user:password@`, else
 *   envio's username and password are used).
 * - `PRICING_CANONICAL_CLICKHOUSE_DATABASE`: another database for the source.
 * - `PRICING_CANONICAL_SNAPSHOT_EFFECT=false` turns the effect off.
 * - `PRICING_CANONICAL_LIVE_READ=false` turns off the live cross-chain `Token`
 *   read (ADR 0004) in src/PriceOracle.ts, so the seed and this effect are the
 *   only canonical sources, as in per-chain mode.
 */

// Local constants so this module needs no chain configuration.
const HOUR_MS = 3_600_000;

/**
 * How many blocks below the source chain's committed frontier a snapshot row
 * must be before it is used: envio's default reorg window on EVM chains is
 * 199 blocks (`max_reorg_depth`, which config.yaml does not override), and
 * effect cache rows are never rolled back, so an answer must be out of reach of
 * a source reorg before it is cached.
 */
export const CANONICAL_SNAPSHOT_FINALITY_BLOCKS = 200;

/**
 * Hours before the asked hour the lookup may fall back to when an hour has no
 * usable snapshot: the seed's two hours (ADR 0008), never forward.
 */
export const CANONICAL_SNAPSHOT_LOOKBACK_HOURS = 2;

/**
 * How far past the asked hour the read looks for a later snapshot of the
 * source, which is the proof that an empty hour is over (see
 * {@link decideCanonicalSourcePrice}).
 */
export const CANONICAL_SNAPSHOT_SCAN_AHEAD_MS = 24 * HOUR_MS;

/**
 * Source snapshot tags whose price may be passed on: a price the source chain
 * obtained in that hour. `carried` (the source is only holding an older price),
 * `unpriced`, `override` and the canonical tags (a source is never a target, and
 * passing one on would chain sources) are not: a route is only as fresh as its
 * base (ADR 0007). The seed builder takes `pool` rows only; `pinned` is
 * accepted too because a $1 pin is a fresh price by definition.
 */
export const CANONICAL_SNAPSHOT_ACCEPTED_SOURCES: ReadonlySet<string> = new Set(
  ["pool", "pinned"],
);

/** Per-request timeout for the ClickHouse read. */
export const CANONICAL_SNAPSHOT_TIMEOUT_MS = 5_000;

/**
 * After a failed ClickHouse request, further requests are skipped (answered as
 * "not yet", uncached) for this long, so an outage costs one timeout per
 * minute rather than one per token-hour.
 */
export const CANONICAL_SNAPSHOT_BACKOFF_MS = 60_000;

/** ClickHouse connection used by the effect. */
export interface CanonicalPriceClickHouse {
  /** Base URL without credentials, e.g. `http://127.0.0.1:8123`. */
  readonly url: string;
  readonly database: string;
  readonly username?: string;
  readonly password?: string;
}

/** The pricing switches and the effect's ClickHouse connection. */
export interface CanonicalPriceSettings {
  /** Whether the live cross-chain `Token` read (ADR 0004) runs. Default true. */
  readonly liveRead: boolean;
  /** Whether the snapshot effect is called. Default true. */
  readonly snapshotEffect: boolean;
  /** Where to read; undefined when ClickHouse is not configured (effect off). */
  readonly clickhouse?: CanonicalPriceClickHouse;
}

/**
 * Parses an on/off switch: unset or empty keeps the default; `false`, `0`,
 * `off` and `no` turn it off; anything else turns it on.
 *
 * @param value - The variable's value
 * @param fallback - The default
 * @returns The switch state
 */
function parseSwitch(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["false", "0", "off", "no"].includes(value.trim().toLowerCase());
}

/**
 * Reads the canonical pricing switches and ClickHouse connection from an
 * environment (see the module comment for the variables).
 *
 * @param env - Environment variables (normally `process.env`)
 * @returns The settings; `clickhouse` is undefined unless both a URL and a
 *   database are known
 */
export function readCanonicalPriceSettings(
  env: Readonly<Record<string, string | undefined>>,
): CanonicalPriceSettings {
  const liveRead = parseSwitch(env.PRICING_CANONICAL_LIVE_READ, true);
  const snapshotEffect = parseSwitch(
    env.PRICING_CANONICAL_SNAPSHOT_EFFECT,
    true,
  );
  const rawUrl =
    env.PRICING_CANONICAL_CLICKHOUSE_URL?.trim() ||
    env.ENVIO_CLICKHOUSE_HOST?.trim();
  const database =
    env.PRICING_CANONICAL_CLICKHOUSE_DATABASE?.trim() ||
    env.ENVIO_CLICKHOUSE_DATABASE?.trim();
  if (!rawUrl || !database) return { liveRead, snapshotEffect };

  // fetch() refuses URLs with credentials: move them to the auth header.
  const parsed = new URL(
    /^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`,
  );
  const fromUrl = parsed.username !== "";
  const username = fromUrl
    ? decodeURIComponent(parsed.username)
    : env.ENVIO_CLICKHOUSE_USERNAME;
  const password = fromUrl
    ? decodeURIComponent(parsed.password)
    : env.ENVIO_CLICKHOUSE_PASSWORD;
  parsed.username = "";
  parsed.password = "";
  return {
    liveRead,
    snapshotEffect,
    clickhouse: {
      url: parsed.toString().replace(/\/$/, ""),
      database,
      username: username || undefined,
      password: password || undefined,
    },
  };
}

let cachedSettings: CanonicalPriceSettings | undefined;

/**
 * The process's canonical pricing settings, read from `process.env` on first
 * use. Handlers call this on the pricing path, so it must stay cheap.
 *
 * @returns The settings
 */
export function getCanonicalPriceSettings(): CanonicalPriceSettings {
  if (!cachedSettings) cachedSettings = readCanonicalPriceSettings(process.env);
  return cachedSettings;
}

/**
 * Forgets the settings and connection state read so far (tests change the
 * environment between cases).
 *
 * @returns void
 */
export function resetCanonicalPriceSettings(): void {
  cachedSettings = undefined;
  perChainByDatabase.clear();
  backoffUntilMs = 0;
}

/** One committed source snapshot near the asked hour, as read from ClickHouse. */
export interface SourceSnapshotRow {
  /** Snapshot id, `{sourceTokenId}-{hourMs}`. */
  readonly id: string;
  readonly priceSource: string | null;
  /** 1e18 USD, as a decimal string. */
  readonly pricePerUSDNew: string;
  /** `SET`, or `DELETE` when the latest committed change removed the row. */
  readonly envio_change: string;
  /** Source block of the row's checkpoint; null when the checkpoint is unknown. */
  readonly block: number | null;
  /** The source chain's highest committed block. */
  readonly frontier_block: number | null;
}

/** What the effect decided for one source hour. */
export type CanonicalSourcePriceDecision =
  | {
      readonly kind: "price";
      readonly priceUSD: bigint;
      /** The source hour whose snapshot was used (≤ the asked hour). */
      readonly sourceHourMs: number;
    }
  /** Every hour of the lookback is final and none has a usable price. */
  | { readonly kind: "none" }
  /** The source chain has not settled the hours needed yet; ask again later. */
  | { readonly kind: "pending"; readonly reason: string };

/**
 * The snapshot's clock hour, from its id (`{sourceTokenId}-{hourMs}`).
 *
 * @param sourceTokenId - Source token id
 * @param id - Snapshot id
 * @returns The hour in ms, or undefined for an id of another shape (rows
 *   written before ADR 0003 were keyed by block number)
 */
function snapshotHourMs(sourceTokenId: string, id: string): number | undefined {
  const prefix = `${sourceTokenId}-`;
  if (!id.startsWith(prefix)) return undefined;
  const suffix = id.slice(prefix.length);
  if (!/^\d{13}$/.test(suffix)) return undefined;
  const ms = Number(suffix);
  return ms % HOUR_MS === 0 ? ms : undefined;
}

/**
 * Decides the source's price for clock hour `hourMs` from its committed
 * snapshots (pure).
 *
 * A source token's snapshot for an hour is written once, at its first price
 * refresh in that hour, so it is final as soon as its block is
 * {@link CANONICAL_SNAPSHOT_FINALITY_BLOCKS} below the source's committed
 * frontier. Walking back from `hourMs` at most
 * {@link CANONICAL_SNAPSHOT_LOOKBACK_HOURS} hours:
 *
 * - a final row with an accepted tag and a positive price is the answer;
 * - a final row with another tag (`carried`, …) has no usable price for that
 *   hour: look one hour back, as the seed does for an empty hour;
 * - a row that is not final yet: pending;
 * - no row: the hour is empty only once a later snapshot of the source is
 *   final (the source chain has left the hour beyond the reorg window); then
 *   look one hour back, else pending.
 *
 * Anything other than pending is a fact about final rows, so it may be
 * cached: the same hour always gets the same answer, whenever and by whichever
 * worker it is computed.
 *
 * @param sourceTokenId - Source token id (`{chainId}-{address}`)
 * @param hourMs - Start of the asked hour, in ms
 * @param rows - The source's committed snapshots from `hourMs` minus the
 *   lookback onwards (see {@link buildCanonicalSourcePriceQuery})
 * @param frontierBlock - The source chain's highest committed block
 * @returns The decision
 */
export function decideCanonicalSourcePrice(
  sourceTokenId: string,
  hourMs: number,
  rows: readonly SourceSnapshotRow[],
  frontierBlock: number | null,
): CanonicalSourcePriceDecision {
  if (frontierBlock === null) {
    return { kind: "pending", reason: "source chain has no checkpoint" };
  }
  const isFinal = (block: number | null): boolean =>
    block !== null &&
    block + CANONICAL_SNAPSHOT_FINALITY_BLOCKS <= frontierBlock;

  const byHour = new Map<number, SourceSnapshotRow>();
  for (const row of rows) {
    const hour = snapshotHourMs(sourceTokenId, row.id);
    if (hour !== undefined && row.envio_change === "SET") byHour.set(hour, row);
  }
  const hasFinalRowAfter = (hour: number): boolean => {
    for (const [h, row] of byHour) {
      if (h > hour && isFinal(row.block)) return true;
    }
    return false;
  };

  for (let back = 0; back <= CANONICAL_SNAPSHOT_LOOKBACK_HOURS; back++) {
    const hour = hourMs - back * HOUR_MS;
    const row = byHour.get(hour);
    if (row) {
      if (!isFinal(row.block)) {
        return {
          kind: "pending",
          reason: `snapshot ${hour} not ${CANONICAL_SNAPSHOT_FINALITY_BLOCKS} blocks deep`,
        };
      }
      const price = /^\d+$/.test(row.pricePerUSDNew)
        ? BigInt(row.pricePerUSDNew)
        : 0n;
      if (
        row.priceSource !== null &&
        CANONICAL_SNAPSHOT_ACCEPTED_SOURCES.has(row.priceSource) &&
        price > 0n
      ) {
        return { kind: "price", priceUSD: price, sourceHourMs: hour };
      }
      continue;
    }
    if (!hasFinalRowAfter(hour)) {
      return { kind: "pending", reason: `hour ${hour} not over at the source` };
    }
  }
  return { kind: "none" };
}

/** Quotes a string literal for ClickHouse SQL. */
function lit(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Quotes an identifier for ClickHouse SQL. */
function ident(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/**
 * The SQL that tells envio's checkpoint mode for a database: per-chain views
 * select committed rows with `envio_frontier[chainId]`, shared ones with
 * `max(checkpoint_id)` (the same test as `Ctx.per_chain` in
 * clickhouse/analytics.py).
 *
 * @param database - The database holding the source chain's tables
 * @returns SQL returning one row `{per_chain: 0|1}`, or none without the view
 */
export function buildCheckpointModeQuery(database: string): string {
  return [
    "SELECT toUInt8(position(create_table_query, 'envio_frontier[') > 0) AS per_chain",
    `FROM system.tables WHERE database = ${lit(database)}`,
    "AND name = 'TokenPriceSnapshot' AND engine = 'View' FORMAT JSONEachRow",
  ].join(" ");
}

/**
 * The read behind the effect: the source's latest committed version of every
 * snapshot from `hourMs - lookback` to `hourMs + scan-ahead` (a primary-key
 * range on `envio_history_TokenPriceSnapshot`, ordered by `(id,
 * envio_checkpoint_id)`), each with the block of its checkpoint, plus the
 * source chain's highest committed block.
 *
 * The commit frontier is `max(checkpoint_id)` of `envio_chains` with shared
 * entities (one sequence for every chain) and the source chain's own
 * `checkpoint_id` per chain (each chain has its own sequence); checkpoints map
 * to blocks through `envio_checkpoints`, ordered by `(chain_id, id)`.
 *
 * @param params.database - Database holding the source chain's tables
 * @param params.perChain - Whether envio runs per-chain checkpoint sequences
 * @param params.sourceTokenId - Source token id (`{chainId}-{address}`)
 * @param params.hourMs - Start of the asked hour, in ms
 * @returns SQL returning {@link SourceSnapshotRow}s as JSONEachRow
 */
export function buildCanonicalSourcePriceQuery(params: {
  database: string;
  perChain: boolean;
  sourceTokenId: string;
  hourMs: number;
}): string {
  const { database, perChain, sourceTokenId, hourMs } = params;
  const chainId = Number.parseInt(sourceTokenId, 10);
  if (!Number.isInteger(chainId)) {
    throw new Error(`bad source token id ${sourceTokenId}`);
  }
  const db = ident(database);
  const lo = `${sourceTokenId}-${hourMs - CANONICAL_SNAPSHOT_LOOKBACK_HOURS * HOUR_MS}`;
  const hi = `${sourceTokenId}-${hourMs + CANONICAL_SNAPSHOT_SCAN_AHEAD_MS}`;
  const frontier = perChain
    ? `(SELECT checkpoint_id FROM ${db}.envio_chains FINAL WHERE chain_id = ${chainId})`
    : `(SELECT max(checkpoint_id) FROM ${db}.envio_chains FINAL)`;
  return [
    "WITH",
    `  ${frontier} AS fr,`,
    "  snaps AS (",
    "    SELECT id, priceSource, pricePerUSDNew, envio_change, envio_checkpoint_id AS cp",
    `    FROM ${db}.envio_history_TokenPriceSnapshot`,
    `    WHERE id >= ${lit(lo)} AND id <= ${lit(hi)} AND chainId = ${chainId} AND envio_checkpoint_id <= fr`,
    "    ORDER BY id, envio_checkpoint_id DESC LIMIT 1 BY id",
    "  )",
    "SELECT s.id AS id, s.priceSource AS priceSource, s.pricePerUSDNew AS pricePerUSDNew,",
    // Without join_use_nulls (a setting a readonly=1 user may not change) an
    // unmatched checkpoint reads as id 0; checkpoint ids start at 1.
    "  toString(s.envio_change) AS envio_change, if(c.id = 0, NULL, c.block_number) AS block,",
    `  (SELECT block_number FROM ${db}.envio_checkpoints WHERE chain_id = ${chainId} AND id <= fr ORDER BY id DESC LIMIT 1) AS frontier_block`,
    "FROM snaps AS s",
    `LEFT JOIN (SELECT id, block_number FROM ${db}.envio_checkpoints WHERE chain_id = ${chainId} AND id IN (SELECT cp FROM snaps)) AS c ON c.id = s.cp`,
    "ORDER BY id",
    "FORMAT JSONEachRow",
  ].join("\n");
}

/** The `fetch` subset the client uses (injected in tests). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * Runs one read-only query over ClickHouse's HTTP interface and parses its
 * JSONEachRow output.
 *
 * @param clickhouse - Connection
 * @param sql - The query (must end in `FORMAT JSONEachRow`)
 * @param fetchImpl - fetch implementation
 * @returns The rows
 */
async function queryRows<T>(
  clickhouse: CanonicalPriceClickHouse,
  sql: string,
  fetchImpl: FetchLike,
): Promise<T[]> {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (clickhouse.username !== undefined) {
    headers.Authorization = `Basic ${Buffer.from(
      `${clickhouse.username}:${clickhouse.password ?? ""}`,
    ).toString("base64")}`;
  }
  // No settings in the URL or the query: a readonly=1 user may not set any.
  const response = await fetchImpl(`${clickhouse.url}/`, {
    method: "POST",
    headers,
    body: sql,
    signal: AbortSignal.timeout(CANONICAL_SNAPSHOT_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `ClickHouse HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  return body
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

/** Checkpoint mode per `url|database`, learned once per process. */
const perChainByDatabase = new Map<string, boolean>();
/** Requests are skipped until this time after a failure. */
let backoffUntilMs = 0;

/**
 * Reads the source's snapshots around `hourMs` and decides its price (the
 * effect's body, separated for tests). Never throws: a ClickHouse failure is
 * logged and answered as pending (not cached), and further requests are
 * skipped for {@link CANONICAL_SNAPSHOT_BACKOFF_MS}.
 *
 * @param input.sourceTokenId - Source token id (`{chainId}-{address}`)
 * @param input.hourMs - Start of the asked clock hour, in ms
 * @param deps.clickhouse - Connection, or undefined when not configured
 * @param deps.fetchImpl - fetch implementation
 * @param deps.nowMs - Wall clock for the backoff
 * @param deps.warn - Logger for failures
 * @returns The decision
 */
export async function fetchCanonicalSourcePrice(
  input: { sourceTokenId: string; hourMs: number },
  deps: {
    clickhouse: CanonicalPriceClickHouse | undefined;
    fetchImpl: FetchLike;
    nowMs: () => number;
    warn: (message: string) => void;
  },
): Promise<CanonicalSourcePriceDecision> {
  const { clickhouse } = deps;
  if (!clickhouse) {
    return { kind: "pending", reason: "ClickHouse not configured" };
  }
  if (deps.nowMs() < backoffUntilMs) {
    return { kind: "pending", reason: "ClickHouse backoff after an error" };
  }
  try {
    const key = `${clickhouse.url}|${clickhouse.database}`;
    let perChain = perChainByDatabase.get(key);
    if (perChain === undefined) {
      const mode = await queryRows<{ per_chain: number }>(
        clickhouse,
        buildCheckpointModeQuery(clickhouse.database),
        deps.fetchImpl,
      );
      if (mode.length === 0) {
        throw new Error(
          `no TokenPriceSnapshot view in database ${clickhouse.database}`,
        );
      }
      perChain = Number(mode[0].per_chain) === 1;
      perChainByDatabase.set(key, perChain);
    }
    const rows = await queryRows<SourceSnapshotRow>(
      clickhouse,
      buildCanonicalSourcePriceQuery({
        database: clickhouse.database,
        perChain,
        sourceTokenId: input.sourceTokenId,
        hourMs: input.hourMs,
      }),
      deps.fetchImpl,
    );
    // The frontier comes as a column of every row; with no snapshot in the
    // window nothing can be decided (and nothing proves the hour is over).
    if (rows.length === 0) {
      return {
        kind: "pending",
        reason: "no committed source snapshot near the hour",
      };
    }
    const frontierBlock =
      rows[0].frontier_block === null ? null : Number(rows[0].frontier_block);
    return decideCanonicalSourcePrice(
      input.sourceTokenId,
      input.hourMs,
      rows.map((row) => ({
        ...row,
        block: row.block === null ? null : Number(row.block),
      })),
      frontierBlock,
    );
  } catch (error) {
    backoffUntilMs = deps.nowMs() + CANONICAL_SNAPSHOT_BACKOFF_MS;
    deps.warn(
      `[getCanonicalSourcePrice] ClickHouse read failed for ${input.sourceTokenId} hour ${input.hourMs}; not cached, retried on a later refresh: ${error}`,
    );
    return { kind: "pending", reason: "ClickHouse error" };
  }
}

/**
 * Cross-chain cached effect: the canonical source's USD price (1e18) for a
 * complete clock hour, from its `TokenPriceSnapshot` in ClickHouse, or
 * `priceUSD = 0n` when there is none.
 *
 * `requesterTokenId` (the leaf token asking) is part of the input so that a
 * "not yet" answer, which envio keeps in memory for the process (uncached
 * outputs are only dropped under memory pressure), cannot be served to another
 * leaf chain asking the same hour later. A leaf token asks each hour once (the
 * refresh is hourly), so the in-memory copy only serves the preload pass and
 * the run proper of the same refresh. Answers stay shared across worker
 * processes through the cache table.
 *
 * Caching: a price, and a final "no price" (every hour of the lookback settled
 * without a usable row), are cached; "not yet" and ClickHouse errors are not
 * (`context.cache = false`). Cache rows are never rolled back, which is why
 * only rows below the source's reorg window are used.
 *
 * @param input.sourceTokenId - Canonical source token id (`{chainId}-{address}`)
 * @param input.hourMs - Start of the asked clock hour, in ms (the last complete
 *   hour before the leaf's block)
 * @param input.requesterTokenId - The leaf token asking
 * @returns `{ priceUSD, sourceHourMs }`; `priceUSD = 0n` means no answer
 */
export const getCanonicalSourcePrice = createEffect(
  {
    name: "getCanonicalSourcePrice",
    input: S.schema({
      sourceTokenId: S.string,
      hourMs: S.number,
      requesterTokenId: S.string,
    }),
    output: S.schema({ priceUSD: S.bigint, sourceHourMs: S.number }),
    rateLimit: false,
    cache: true,
    crossChain: true,
  },
  async ({ input, context }) => {
    const decision = await fetchCanonicalSourcePrice(input, {
      clickhouse: getCanonicalPriceSettings().clickhouse,
      fetchImpl: fetch as unknown as FetchLike,
      nowMs: Date.now,
      warn: (message) => context.log.warn(message),
    });
    context.log.info(
      `[getCanonicalSourcePrice] ${input.requesterTokenId} <- ${input.sourceTokenId} hour ${new Date(input.hourMs).toISOString()}: ${decision.kind}${decision.kind === "price" ? ` ${decision.priceUSD} from ${new Date(decision.sourceHourMs).toISOString()}` : decision.kind === "pending" ? ` (${decision.reason})` : ""}`,
    );
    if (decision.kind === "price") {
      return {
        priceUSD: decision.priceUSD,
        sourceHourMs: decision.sourceHourMs,
      };
    }
    if (decision.kind === "pending") context.cache = false;
    return { priceUSD: 0n, sourceHourMs: 0 };
  },
);
