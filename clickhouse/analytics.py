#!/usr/bin/env python3
"""Install and operate the ClickHouse analytics layer on top of an envio indexer database.

    python3 clickhouse/analytics.py install            # idempotent: create, backfill what is empty, start refreshes
    python3 clickhouse/analytics.py status             # watermarks against the indexer's commit frontier
    python3 clickhouse/analytics.py verify             # prove every table equals argMax over envio's history
    python3 clickhouse/analytics.py refresh            # run every refresh now and wait
    python3 clickhouse/analytics.py rebuild            # drop the layer's tables, then install (full backfill)
    python3 clickhouse/analytics.py drop               # drop the analytics database
    python3 clickhouse/analytics.py render             # print the SQL install would run
    python3 clickhouse/analytics.py queries [file...]  # run docs queries, print rows and elapsed time
    python3 clickhouse/analytics.py history-ttl [--days N] [--apply] [--remove]
                                                       # TTL on envio's per-block aggregate history (writes to it)

Connection (no secrets in the repo; the same variables envio itself reads):
    ENVIO_CLICKHOUSE_HOST       http(s)://host:port of the ClickHouse HTTP interface
    ENVIO_CLICKHOUSE_USERNAME   a user that may read the indexer database and create the analytics one
    ENVIO_CLICKHOUSE_PASSWORD
    ENVIO_CLICKHOUSE_DATABASE   the indexer's database (the source; only history-ttl --apply writes to it)
    ANALYTICS_DATABASE          optional; default analytics_<indexer database>
CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD / CLICKHOUSE_SOURCE_DATABASE override them.

Python 3.9+ standard library only. See docs/clickhouse.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layer import ENTITIES, Entity, Resolved  # noqa: E402

HERE = Path(__file__).resolve().parent
LAYER_VERSION = "1"
# Partitioning every storage table by intDiv(_version, VERSION_BUCKET) (one partition in
# practice) puts _version into each part's min/max index, so max(_version), the refresh
# watermark, is answered from part metadata instead of a column scan.
VERSION_BUCKET = 10**12
REFRESH_EVERY = os.environ.get("ANALYTICS_REFRESH_EVERY", "1 MINUTE")
# A refresh never takes more than this many checkpoints at once, so a layer that fell far
# behind (or an indexer in backfill) catches up in bounded steps.
MAX_CHECKPOINTS_PER_REFRESH = int(os.environ.get("ANALYTICS_MAX_CHECKPOINTS_PER_REFRESH", "500000"))
# Per-chain checkpoint sequences (envio's disable_default_cross_chain): a refresh reads each
# chain's window in its own UNION ALL branch, so the checkpoint skip index prunes per chain. A
# branch is a slot, filled at refresh time with the n-th chain of envio_chains, so a chain added
# later is picked up without reinstalling, up to this many chains (status reports beyond).
CHAIN_SLOTS = int(os.environ.get("ANALYTICS_CHAIN_SLOTS", "32"))
BACKFILL_CHUNK_ROWS = int(os.environ.get("ANALYTICS_BACKFILL_CHUNK_ROWS", "2000000"))
RETRIES = int(os.environ.get("ANALYTICS_RETRIES", "30"))
VERIFY_CHUNK_ROWS = int(os.environ.get("ANALYTICS_VERIFY_CHUNK_ROWS", "3000000"))
QUERY_SETTINGS = {
    "max_memory_usage": os.environ.get("ANALYTICS_MAX_MEMORY", "1200000000"),
    "max_bytes_before_external_group_by": os.environ.get("ANALYTICS_EXTERNAL_GROUP_BY", "400000000"),
    "max_bytes_before_external_sort": os.environ.get("ANALYTICS_EXTERNAL_SORT", "400000000"),
    "max_threads": os.environ.get("ANALYTICS_MAX_THREADS", "2"),
}
# Backfill inserts: few, small blocks so a wide row (80 columns, many Int256) stays cheap.
BACKFILL_SETTINGS = {
    "max_threads": "1",
    "max_insert_threads": "1",
    "max_block_size": "16384",
    "min_insert_block_size_rows": "32768",
    "min_insert_block_size_bytes": "33554432",
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ----------------------------------------------------------------------------- HTTP client


class ClickHouseError(RuntimeError):
    pass


class CH:
    def __init__(self, url: str, user: str, password: str):
        self.url = url.rstrip("/") + "/"
        self.auth = {"X-ClickHouse-User": user, "X-ClickHouse-Key": password}

    def request(self, sql: str, settings: dict | None = None, timeout: float = 7200) -> tuple[str, dict]:
        params = {"wait_end_of_query": "1"}
        params.update(QUERY_SETTINGS)
        params.update(settings or {})
        req = urllib.request.Request(
            self.url + "?" + urllib.parse.urlencode(params),
            data=sql.encode(),
            headers=self.auth,
            method="POST",
        )
        for attempt in range(RETRIES + 1):
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    summary = json.loads(r.headers.get("X-ClickHouse-Summary") or "{}")
                    return r.read().decode(), summary
            except urllib.error.HTTPError as e:
                msg = e.read().decode().strip()
                # The server-wide memory cap is shared with other users and the indexer's own
                # merges: wait and retry. Every statement this tool sends is safe to repeat
                # (inserts go to ReplacingMergeTree tables keyed by version).
                if "(total) memory limit exceeded" in msg and attempt < RETRIES:
                    log(f"    server memory is full, retrying in {min(60, 10 * (attempt + 1))}s")
                    time.sleep(min(60, 10 * (attempt + 1)))
                    continue
                raise ClickHouseError(f"{e.code}: {msg}\n--- query ---\n{sql[:4000]}") from None
            except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
                # server restarting (e.g. a stack redeploy): wait for it
                if attempt < RETRIES:
                    log(f"    ClickHouse unreachable ({e}), retrying in 30s")
                    time.sleep(30)
                    continue
                raise
        raise AssertionError("unreachable")

    def execute(self, sql: str, settings: dict | None = None) -> dict:
        return self.request(sql, settings)[1]

    def rows(self, sql: str, settings: dict | None = None) -> list[dict]:
        body, _ = self.request(sql + "\nFORMAT JSONEachRow", settings)
        return [json.loads(line) for line in body.splitlines() if line.strip()]

    def scalar(self, sql: str, settings: dict | None = None):
        body, _ = self.request(sql + "\nFORMAT TabSeparated", settings)
        return body.strip()


def q(name: str) -> str:
    return f"`{name}`"


def lit(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def map_lit(m: dict[int, int]) -> str:
    """A Map(Int32, UInt64) literal (sequence -> checkpoint); a missing key reads as 0."""
    keys = ", ".join(str(k) for k in sorted(m))
    vals = ", ".join(str(m[k]) for k in sorted(m))
    return f"mapFromArrays(CAST([{keys}] AS Array(Int32)), CAST([{vals}] AS Array(UInt64)))"


# ----------------------------------------------------------------------------- context


class Ctx:
    def __init__(self, ch: CH, src: str, db: str):
        self.ch, self.src, self.db = ch, src, db
        self._types: dict[str, dict[str, str]] = {}
        self._per_chain: bool | None = None

    # --- checkpoint sequences ------------------------------------------------------------
    #
    # envio numbers its commits with checkpoint ids. With shared entities (the default) there is
    # one sequence for the whole indexer: a row is committed when its checkpoint is at or below
    # max(envio_chains.checkpoint_id). With every entity per-chain (disable_default_cross_chain)
    # each chain has its own sequence, ids overlap across chains, and a row is committed when its
    # checkpoint is at or below its own chain's envio_chains.checkpoint_id.
    #
    # One code path serves both: every frontier, watermark and refresh window is a map keyed by
    # the row's sequence, its *scope*. Per-chain the scope is the chain (envio's chainId on source
    # rows, chain_id in the layer's tables); shared it is the constant 0, so each map has a single
    # entry and the SQL reduces to the single-sequence logic.

    def per_chain(self) -> bool:
        """The mode, read off envio's own entity views: per-chain views pick committed rows with
        envio_frontier[chainId], shared ones with max(checkpoint_id). ANALYTICS_CHECKPOINT_SEQUENCE
        (per-chain | shared) overrides it. A source without the views (a bare copy) is shared."""
        if self._per_chain is None:
            forced = os.environ.get("ANALYTICS_CHECKPOINT_SEQUENCE", "")
            if forced:
                if forced not in ("per-chain", "shared"):
                    raise SystemExit("ANALYTICS_CHECKPOINT_SEQUENCE must be per-chain or shared")
                self._per_chain = forced == "per-chain"
            else:
                names = ", ".join(lit(e.source) for e in ENTITIES)
                views = self.ch.rows(
                    "SELECT name, position(create_table_query, 'envio_frontier[') > 0 AS per_chain FROM system.tables "
                    f"WHERE database = {lit(self.src)} AND engine = 'View' AND name IN ({names})"
                )
                kinds = {int(v["per_chain"]) for v in views}
                if len(kinds) > 1:
                    raise SystemExit(f"{self.src}: envio's views mix per-chain and shared checkpoint sequences")
                self._per_chain = kinds == {1}
        return self._per_chain

    def scope_src(self) -> str:
        """The sequence a source (envio history) row belongs to."""
        return "chainId" if self.per_chain() else "toInt32(0)"

    def scope_layer(self) -> str:
        """The sequence a layer row belongs to. chain_id is taken from envio's id, which starts with
        the chain id for every entity the layer maps (verify fails if it ever does not)."""
        return "chain_id" if self.per_chain() else "toInt32(0)"

    def scope_cols(self) -> list[str]:
        """Source columns that, with the id, identify an entity: per-chain the same id may exist on
        several chains."""
        return ["chainId"] if self.per_chain() else []

    def frontier_map_sql(self) -> str:
        """Map(Int32, UInt64): sequence -> commit frontier (highest committed checkpoint)."""
        if self.per_chain():
            return ("(SELECT mapFromArrays(groupArray(toInt32(chain_id)), groupArray(toUInt64(checkpoint_id))) "
                    f"FROM (SELECT chain_id, checkpoint_id FROM {q(self.src)}.envio_chains FINAL))")
        return f"(SELECT map(toInt32(0), toUInt64(max(checkpoint_id))) FROM {q(self.src)}.envio_chains FINAL)"

    def frontier_map(self) -> dict[int, int]:
        rows = self.ch.rows(
            f"SELECT k, v FROM (SELECT {self.frontier_map_sql()} AS m) ARRAY JOIN mapKeys(m) AS k, mapValues(m) AS v"
        )
        return {int(r["k"]): int(r["v"]) for r in rows}

    def frontier_at(self, scope: str) -> str:
        """The commit frontier of the sequence `scope` (an expression over a source row)."""
        return f"{self.frontier_map_sql()}[{scope}]"

    def instance(self) -> str:
        return self.ch.scalar(f"SELECT any(instance) FROM {q(self.src)}.envio_info")

    def hist(self, e: Entity) -> str:
        return f"envio_history_{e.source}"

    def source_types(self, e: Entity) -> dict[str, str]:
        t = self.hist(e)
        if t not in self._types:
            rows = self.ch.rows(
                f"SELECT name, type FROM system.columns WHERE database = {lit(self.src)} AND table = {lit(t)}"
            )
            self._types[t] = {r["name"]: r["type"] for r in rows}
        return self._types[t]

    def has_source(self, e: Entity) -> bool:
        return bool(self.source_types(e))

    def resolved(self, e: Entity) -> list[Resolved]:
        types = self.source_types(e)
        out = [Resolved(c, types) for c in e.columns]
        return [r for r in out if r.present or not r.col.optional]

    def render(self, sql: str) -> str:
        def col(m):
            table, column, fallback = m.group(1), m.group(2), m.group(3)
            types = self._types.get(table)
            if types is None:
                rows = self.ch.rows(
                    f"SELECT name, type FROM system.columns WHERE database = {lit(self.src)} AND table = {lit(table)}"
                )
                types = self._types[table] = {r["name"]: r["type"] for r in rows}
            return q(column) if column in types else fallback

        sql = re.sub(r"\{\{col:(\w+)\.(\w+)\|([^}]*)\}\}", col, sql)
        # {{scope:<expr>}}: the checkpoint sequence of a row whose chain is <expr>
        sql = re.sub(r"\{\{scope:([^}]*)\}\}", lambda m: m.group(1) if self.per_chain() else "toInt32(0)", sql)
        return (
            sql.replace("{{db}}", q(self.db))
            .replace("{{src}}", q(self.src))
            .replace("{{frontier}}", self.frontier_at(self.scope_src()))
        )


# ----------------------------------------------------------------------------- SQL generation


def ddl(ctx: Ctx, e: Entity) -> str:
    cols = [f"  {q(r.name)} {r.ch_type}" for r in ctx.resolved(e)]
    if e.mode != "latest":
        cols.append("  `period` DateTime('UTC')")
        types = {r.name: r.ch_type for r in ctx.resolved(e)}
        cols += [f"  {q('prev_' + f)} {types[f]} COMMENT 'value at the end of the previous period with a change (0 for the first)'"
                 for f in e.prev_fields]
    cols += [
        "  `_version` UInt64 COMMENT 'envio_checkpoint_id of the row this state was taken from'",
        "  `_deleted` UInt8 COMMENT '1 when envio deleted the entity (envio_change = DELETE)'",
        "  `_loaded_at` DateTime DEFAULT now() COMMENT 'when the layer loaded this version'",
    ]
    cols += [f"  INDEX {ix}" for ix in e.indexes]
    parts = [f"intDiv(_version, {VERSION_BUCKET})"]
    if ctx.per_chain():
        # per-chain watermarks (max(_version) per chain) are then answered from part metadata too
        parts.insert(0, "chain_id")
    if e.partition_extra:
        parts.insert(0, e.partition_extra)
    partition = parts[0] if len(parts) == 1 else f"({', '.join(parts)})"
    return (
        f"CREATE TABLE IF NOT EXISTS {q(ctx.db)}.{q(e.table)} (\n" + ",\n".join(cols) + "\n)\n"
        "ENGINE = ReplacingMergeTree(_version, _deleted)\n"
        f"PARTITION BY {partition}\n"
        f"ORDER BY ({e.order_by})\n"
        f"COMMENT {lit(e.description + ' -- maintained by clickhouse/analytics.py from ' + ctx.hist(e))}"
    )


def needed_source_columns(ctx: Ctx, e: Entity, for_verify: bool = False) -> list[str]:
    types = ctx.source_types(e)
    cols = []
    for r in ctx.resolved(e):
        for c in ([r.col.src] if r.col.src and r.present else []) + (r.verify_fields() if for_verify else []):
            if c in types and c not in cols:
                cols.append(c)
    for extra in ("chainId", "lastUpdatedTimestamp"):
        if extra in types and extra not in cols:
            cols.append(extra)
    return [c for c in cols if c != "id"]


def group_key(ctx: Ctx, e: Entity) -> str:
    """What one stored row stands for: an id (current state) or an id and a period (series),
    per chain when chains have their own sequences."""
    return ", ".join([*ctx.scope_cols(), "id"] + ([] if e.mode == "latest" else [e.period_expr]))


def rows_select(ctx: Ctx, e: Entity) -> str:
    h = f"{q(ctx.src)}.{q(ctx.hist(e))}"
    period = f", {e.period_expr} AS _period" if e.mode != "latest" else ""
    return f"SELECT *{period} FROM {h}"


def projection(ctx: Ctx, e: Entity, rows: str) -> str:
    exprs = [f"{r.expr()} AS {q(r.name)}" for r in ctx.resolved(e)]
    if e.mode == "latest":
        exprs += ["envio_checkpoint_id AS _version", "toUInt8(envio_change = 'DELETE') AS _deleted"]
    else:
        exprs += ["_period AS period", "envio_checkpoint_id AS _version", "toUInt8(0) AS _deleted"]
    return "SELECT\n  " + ",\n  ".join(exprs) + f"\nFROM (\n  {rows}\n) AS h"


def insert_into(ctx: Ctx, e: Entity) -> str:
    cols = [r.name for r in ctx.resolved(e)] + (["period"] if e.mode != "latest" else []) + ["_version", "_deleted"]
    cols += [f"prev_{f}" for f in e.prev_fields]
    return f"INSERT INTO {q(ctx.db)}.{q(e.table)} (" + ", ".join(q(c) for c in cols) + ")\n"


def zero(t: str) -> str:
    return f"CAST(0, {lit(t)})"


def series_window(e: Entity) -> str:
    return f"WINDOW __w AS (PARTITION BY {e.series_key} ORDER BY period ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)"


def with_prev_backfill(ctx: Ctx, e: Entity, proj: str) -> str:
    """Backfill: a chunk holds every period of its pools, so prev_ is the previous row's value."""
    if not e.prev_fields:
        return proj
    types = {r.name: r.ch_type for r in ctx.resolved(e)}
    lags = ", ".join(f"lagInFrame({q(f)}, 1, {zero(types[f])}) OVER __w AS {q('prev_' + f)}" for f in e.prev_fields)
    return f"SELECT *, {lags}\nFROM (\n{proj}\n)\n{series_window(e)}"


def with_prev_refresh(ctx: Ctx, e: Entity, proj: str) -> str:
    """Refresh: prev_ comes from the stored row of the same period (a period that continues),
    else for a pool's first new period from the end of its last stored period, else from the
    previous new period in this window."""
    if not e.prev_fields:
        return proj
    types = {r.name: r.ch_type for r in ctx.resolved(e)}
    t = f"{q(ctx.db)}.{q(e.table)}"
    lags = ", ".join(f"lagInFrame({q(f)}, 1, {zero(types[f])}) OVER __w AS {q('__lag_' + f)}" for f in e.prev_fields)
    base = [r.name for r in ctx.resolved(e)] + ["period", "_version", "_deleted"]
    k = e.series_key
    keys = [x.strip() for x in k.split(",")]
    on = " AND ".join(f"{{a}}.{c} = n.{c}" for c in keys)
    pools = f"({k}) IN (SELECT {k} FROM __new)"
    prevs = ", ".join(
        f"if(x.__has = 1, x.{q('prev_' + f)}, if(n.__rn = 1, if(o.__has = 1, o.{q('__end_' + f)}, {zero(types[f])}), n.{q('__lag_' + f)})) AS {q('prev_' + f)}"
        for f in e.prev_fields
    )
    ends = ", ".join(f"argMax({q(f)}, period) AS {q('__end_' + f)}" for f in e.prev_fields)
    xprev = ", ".join(q('prev_' + f) for f in e.prev_fields)
    return (
        f"WITH __new AS (\n  SELECT *, row_number() OVER (PARTITION BY {k} ORDER BY period) AS __rn, {lags}\n"
        f"  FROM (\n{proj}\n  )\n  {series_window(e)}\n)\n"
        f"SELECT " + ", ".join(f"n.{q(c)} AS {q(c)}" for c in base) + f", {prevs}\n"
        f"FROM __new AS n\n"
        f"LEFT JOIN (SELECT {k}, period, 1 AS __has, {xprev} FROM {t} FINAL WHERE {pools}) AS x\n"
        f"  ON {on.format(a='x')} AND x.period = n.period\n"
        f"LEFT JOIN (SELECT {k}, 1 AS __has, {ends} FROM {t} FINAL WHERE {pools} GROUP BY {k}) AS o\n"
        f"  ON {on.format(a='o')}"
    )


def chunk_pred(lo: str | None, hi: str | None) -> str:
    parts = []
    if lo is not None:
        parts.append(f"id >= {lit(lo)}")
    if hi is not None:
        parts.append(f"id < {lit(hi)}")
    return " AND ".join(parts) or "1"


def backfill_rows(ctx: Ctx, e: Entity, chunk: str, frontier: dict[int, int]) -> str:
    """Rows to load: per id (or id and period), the last version at or below its sequence's
    frontier (`frontier`: sequence -> checkpoint, see Ctx.per_chain).

    Two phases keep memory flat: the last checkpoint per key reads three narrow columns, and
    the full rows are then fetched by primary key (id, envio_checkpoint_id), so only the
    granules holding them are read. Series skip DELETE rows (a pool is never deleted; a
    rollback that removes one leaves its earlier periods, see docs).
    """
    h = f"{q(ctx.src)}.{q(ctx.hist(e))}"
    only_set = "" if e.mode == "latest" else " AND envio_change = 'SET'"
    tup = ", ".join([*ctx.scope_cols(), "id", "envio_checkpoint_id"])
    sel = ", ".join([*ctx.scope_cols(), "id", "max(envio_checkpoint_id)"])
    return (
        f"{rows_select(ctx, e)} WHERE {chunk}{only_set} AND ({tup}) IN (\n"
        f"    SELECT {sel} FROM {h} WHERE {chunk}{only_set}\n"
        f"      AND envio_checkpoint_id <= {map_lit(frontier)}[{ctx.scope_src()}]\n"
        f"    GROUP BY {group_key(ctx, e)})"
    )


def watermark_map_sql(ctx: Ctx, e: Entity) -> str:
    """Map(Int32, UInt64): sequence -> the table's refresh watermark.

    max(_version) per sequence comes from part metadata (the partition key holds _version's
    bucket, and chain_id when per-chain). Minus one: a refresh that failed half way may have
    landed part of the rows of its last checkpoint. A sequence with no rows yet reads as 0.
    """
    t = f"{q(ctx.db)}.{q(e.table)}"
    if not ctx.per_chain():
        return f"(SELECT map(toInt32(0), toUInt64(greatest(max(_version), 1) - 1)) FROM {t})"
    return (
        "(SELECT mapFromArrays(groupArray(toInt32(k)), groupArray(w)) FROM "
        f"(SELECT {ctx.scope_layer()} AS k, toUInt64(greatest(max(_version), 1) - 1) AS w FROM {t} GROUP BY k))"
    )


def refresh_rows(ctx: Ctx, e: Entity, instance: str) -> str:
    """The rows one refresh loads: per sequence, the last version of each key in
    (watermark, min(frontier, watermark + MAX_CHECKPOINTS_PER_REFRESH)].

    Each sequence gets its own UNION ALL branch whose bounds are scalar subqueries, i.e.
    constants when ClickHouse plans the read, so the history's checkpoint skip index prunes per
    sequence. (A single branch comparing envio_checkpoint_id with a per-row map lookup would
    read the whole table: per-chain sequences overlap, so no constant bound fits every chain.)
    Shared: one branch, the sequence 0. Per-chain: CHAIN_SLOTS branches, the n-th taking the
    n-th chain of envio_chains; an unused branch has frontier 0 and reads nothing.
    """
    only_set = "" if e.mode == "latest" else " AND envio_change = 'SET'"
    period = f", {e.period_expr} AS _period" if e.mode != "latest" else ""
    h = f"{q(ctx.src)}.{q(ctx.hist(e))}"
    alive = f"(SELECT any(instance) FROM {q(ctx.src)}.envio_info) = {lit(instance)}"
    slots = CHAIN_SLOTS if ctx.per_chain() else 1
    branches = []
    for i in range(1, slots + 1):
        c = f"__chains[{i}]"
        branches.append(
            f"  SELECT *{period} FROM {h}\n"
            f"  WHERE {ctx.scope_src()} = {c} AND envio_checkpoint_id > __wm[{c}]\n"
            f"    AND envio_checkpoint_id <= least(__fr[{c}], __wm[{c}] + toUInt64({MAX_CHECKPOINTS_PER_REFRESH})){only_set}\n"
            f"    AND {alive}"
        )
    key = ", ".join([*ctx.scope_cols(), "id"] + ([] if e.mode == "latest" else ["_period"]))
    return (
        f"WITH {ctx.frontier_map_sql()} AS __fr, {watermark_map_sql(ctx, e)} AS __wm,\n"
        f"  arraySort(mapKeys(__fr)) AS __chains\n"
        f"SELECT * FROM (\n" + "\n  UNION ALL\n".join(branches) + "\n)\n"
        f"ORDER BY {key}, envio_checkpoint_id DESC LIMIT 1 BY {key}"
    )


def rmv_name(e: Entity) -> str:
    return f"_refresh_{e.key}"


def rmv_ddl(ctx: Ctx, e: Entity, instance: str) -> str:
    return (
        f"CREATE MATERIALIZED VIEW IF NOT EXISTS {q(ctx.db)}.{q(rmv_name(e))}\n"
        f"REFRESH EVERY {REFRESH_EVERY}\n"
        f"APPEND TO {q(ctx.db)}.{q(e.table)}\n"
        f"AS {with_prev_refresh(ctx, e, projection(ctx, e, refresh_rows(ctx, e, instance)))}\n"
        "ORDER BY _version\n"
        "SETTINGS max_insert_threads = 1\n"
        f"COMMENT {lit('incremental refresh of ' + e.table + ' from ' + ctx.hist(e) + ' (rows up to the commit frontier only)')}"
    )


META_DDL = """CREATE TABLE IF NOT EXISTS {db}._meta (
  key String, value String, updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at) ORDER BY key
COMMENT 'analytics layer bookkeeping: source database, source instance, layer version'"""


# ----------------------------------------------------------------------------- operations


def chunks(ctx: Ctx, e: Entity, target_rows: int) -> list[str]:
    """id ranges of about target_rows source rows each, cut at primary-index marks.

    envio sorts history tables by (id, envio_checkpoint_id) unless the entity sets
    @storage(clickhouse: {orderBy}); for those, chunks are hash buckets of the id (each chunk
    then scans the table, but every version of an id stays in one chunk).
    """
    key = ctx.ch.scalar(
        f"SELECT sorting_key FROM system.tables WHERE database = {lit(ctx.src)} AND name = {lit(ctx.hist(e))}"
    )
    if not key.startswith("id"):
        total = table_rows_src(ctx, ctx.hist(e))
        n = max(1, -(-total // target_rows))
        return [f"cityHash64(id) % {n} = {i}" for i in range(n)]
    marks = ctx.ch.rows(
        f"SELECT id, rows_in_granule AS n FROM mergeTreeIndex({lit(ctx.src)}, {lit(ctx.hist(e))}) ORDER BY id"
    )
    bounds: list[str] = []
    acc = 0
    for m in marks:
        acc += int(m["n"])
        if acc >= target_rows:
            if not bounds or bounds[-1] != m["id"]:
                bounds.append(m["id"])
            acc = 0
    edges = [None, *bounds, None]
    return [chunk_pred(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]


def table_rows_src(ctx: Ctx, table: str) -> int:
    return int(
        ctx.ch.scalar(
            f"SELECT sum(rows) FROM system.parts WHERE database = {lit(ctx.src)} AND table = {lit(table)} AND active"
        )
        or 0
    )


def meta_get(ctx: Ctx) -> dict[str, str]:
    try:
        rows = ctx.ch.rows(f"SELECT key, argMax(value, updated_at) AS value FROM {q(ctx.db)}._meta GROUP BY key")
    except ClickHouseError:
        return {}
    return {r["key"]: r["value"] for r in rows}


def meta_set(ctx: Ctx, values: dict[str, str]):
    rows = ", ".join(f"({lit(k)}, {lit(v)})" for k, v in values.items())
    ctx.ch.execute(f"INSERT INTO {q(ctx.db)}._meta (key, value) VALUES {rows}")


def existing_tables(ctx: Ctx) -> set[str]:
    rows = ctx.ch.rows(f"SELECT name FROM system.tables WHERE database = {lit(ctx.db)}")
    return {r["name"] for r in rows}


def table_rows(ctx: Ctx, table: str) -> int:
    return int(
        ctx.ch.scalar(
            f"SELECT sum(rows) FROM system.parts WHERE database = {lit(ctx.db)} AND table = {lit(table)} AND active"
        )
        or 0
    )


def drop_layer_objects(ctx: Ctx, keep_db=True):
    objs = ctx.ch.rows(f"SELECT name, engine FROM system.tables WHERE database = {lit(ctx.db)}")
    # views first: a table that a view reads cannot be dropped before it
    for o in sorted(objs, key=lambda o: (o["engine"] not in ("View", "MaterializedView"), o["name"])):
        kind = "VIEW" if o["engine"] in ("View", "MaterializedView") else "TABLE"
        ctx.ch.execute(f"DROP {kind} IF EXISTS {q(ctx.db)}.{q(o['name'])} SYNC")
    if not keep_db:
        ctx.ch.execute(f"DROP DATABASE IF EXISTS {q(ctx.db)} SYNC")


def backfill(ctx: Ctx, e: Entity, frontier: dict[int, int]):
    t0 = time.time()
    parts = chunks(ctx, e, BACKFILL_CHUNK_ROWS)
    total_read = 0
    for i, chunk in enumerate(parts, 1):
        sql = insert_into(ctx, e) + with_prev_backfill(ctx, e, projection(ctx, e, backfill_rows(ctx, e, chunk, frontier)))
        s = ctx.ch.execute(sql, BACKFILL_SETTINGS)
        total_read += int(s.get("read_rows", 0))
        log(f"  {e.table}: chunk {i}/{len(parts)} wrote {s.get('written_rows', '?')} rows (read {s.get('read_rows', '?')})")
    log(f"  {e.table}: backfilled up to {fmt_map(frontier)} in {time.time() - t0:.1f}s ({total_read} source rows read)")


def fmt_map(m: dict[int, int]) -> str:
    """A frontier / watermark map for logs: 'checkpoint N' (shared) or 'chain:checkpoint ...'."""
    if set(m) <= {0}:
        return f"checkpoint {m.get(0, 0)}"
    return "checkpoints " + " ".join(f"{k}:{v}" for k, v in sorted(m.items()))


# (file, storage table the file needs): Aero views only where the indexer has Aero gauges
VIEW_FILES = [("views.sql", "_pool"), ("views_aero.sql", "_aero_gauge")]

# ClickHouse-only, append-only Aero entities (events and hourly snapshots): typed views read
# straight from envio's history table (no copy).
APPEND_ONLY = [
    "AeroGaugeStakeEvent", "AeroEmissionsEvent", "AeroAllocationEvent", "SAeroPositionEvent",
    "AeroVotingRewardsEvent", "AeroRedemptionEvent", "AeroMinterEvent", "AeroMigrationEvent",
    "AeroGaugeSnapshot", "AeroLeafVoterStateSnapshot", "SAeroEscrowStateSnapshot", "AeroMinterSnapshot",
]


def append_only_view(ctx: Ctx, type_name: str) -> str | None:
    """Typed view over an append-only envio table.

    Each id is written once, except around a reorg: the rollback writes a DELETE at a later
    checkpoint, and the re-included event may come back under the same id. So a row counts
    when it is committed and, for the (rare) ids that ever had a DELETE, when it is the id's
    latest version.
    """
    from layer import Entity  # noqa: PLC0415
    from schema_map import auto_columns, snake  # noqa: PLC0415

    hist = f"envio_history_{type_name}"
    e = Entity(snake(type_name), "", type_name, "id", auto_columns(type_name))
    if not ctx.has_source(e):
        return None
    exprs = []
    for r in ctx.resolved(e):
        exprs.append(f"{r.expr()} AS {q(r.name)}")
        if r.col.kind == "big" and r.name.endswith("_usd"):
            exprs[-1] = f"{r.expr()} AS {q(r.name + '_raw')}"
            exprs.append(f"toFloat64({r.expr()}) / 1e18 AS {q(r.name)}")
        if r.col.kind == "time":
            exprs[-1] = f"toDateTime({r.expr()}) AS {q(r.name)}"
    h = f"{q(ctx.src)}.{q(hist)}"
    f = ctx.frontier_at(ctx.scope_src())
    k = ", ".join([*ctx.scope_cols(), "id"])
    name = snake(type_name).replace("s_aero_", "saero_") + "s"
    return (
        f"CREATE OR REPLACE VIEW {q(ctx.db)}.{q(name)} AS\nSELECT\n  " + ",\n  ".join(exprs) + "\n"
        f"FROM {h}\n"
        f"WHERE envio_change = 'SET' AND envio_checkpoint_id <= {f}\n"
        f"  AND (({k}) NOT IN (SELECT {k} FROM {h} WHERE envio_change = 'DELETE')\n"
        f"       OR ({k}, envio_checkpoint_id) IN (SELECT {k}, max(envio_checkpoint_id) FROM {h}\n"
        f"           WHERE envio_checkpoint_id <= {f} AND ({k}) IN (SELECT {k} FROM {h} WHERE envio_change = 'DELETE') GROUP BY {k}))"
    )


def statements(text: str) -> list[str]:
    out, cur = [], []
    for line in text.splitlines():
        is_comment = line.strip().startswith("--")
        if is_comment and not cur:
            continue
        cur.append(line)
        if not is_comment and line.rstrip().endswith(";"):
            stmt = "\n".join(cur).strip().rstrip(";").strip()
            if stmt:
                out.append(stmt)
            cur = []
    tail = "\n".join(cur).strip()
    if tail:
        out.append(tail)
    return out


def view_statements(ctx: Ctx) -> list[str]:
    present = existing_tables(ctx)
    out = []
    for t in APPEND_ONLY:
        v = append_only_view(ctx, t)
        if v:
            out.append(v)
    for f, needs in VIEW_FILES:
        if needs in present:
            out += [ctx.render(s) for s in statements((HERE / "sql" / f).read_text())]
    return out


def install(ctx: Ctx, force_rebuild=False):
    ch = ctx.ch
    if not ch.scalar(f"SELECT count() FROM system.tables WHERE database = {lit(ctx.src)} AND name = 'envio_chains'") == "1":
        raise SystemExit(f"{ctx.src} is not an envio ClickHouse database (no envio_chains table)")
    instance = ctx.instance()
    if not instance:
        raise SystemExit(f"{ctx.src} has no envio_info row yet: start the indexer once before installing")
    ch.execute(f"CREATE DATABASE IF NOT EXISTS {q(ctx.db)}")
    ch.execute(META_DDL.format(db=q(ctx.db)))
    meta = meta_get(ctx)
    reasons = []
    if meta.get("source_database") and meta["source_database"] != ctx.src:
        raise SystemExit(f"{ctx.db} was built from {meta['source_database']}, not {ctx.src}; use another --db")
    if meta.get("source_instance") and meta["source_instance"] != instance:
        reasons.append(f"the indexer was reset (instance {meta['source_instance']} -> {instance})")
    if meta.get("layer_version") and meta["layer_version"] != LAYER_VERSION:
        reasons.append(f"layer version changed ({meta['layer_version']} -> {LAYER_VERSION})")
    mode_now = "per-chain" if ctx.per_chain() else "shared"
    if meta.get("checkpoint_sequence") and meta["checkpoint_sequence"] != mode_now:
        reasons.append(f"checkpoint sequence changed ({meta['checkpoint_sequence']} -> {mode_now})")
    if force_rebuild:
        reasons.append("rebuild requested")
    if reasons:
        log("rebuilding: " + "; ".join(reasons))
        drop_layer_objects(ctx)
        ch.execute(META_DDL.format(db=q(ctx.db)))

    frontier = ctx.frontier_map()
    meta = meta_get(ctx)
    mode = "per-chain" if ctx.per_chain() else "shared"
    log(f"source {ctx.src} instance {instance}, {mode} checkpoint sequence, commit frontier {fmt_map(frontier)}")
    for e in ENTITIES:
        if not ctx.has_source(e):
            log(f"  {e.table}: source {ctx.hist(e)} missing, skipped")
            continue
        table_ddl = ddl(ctx, e)
        digest = hashlib.sha1(table_ddl.encode()).hexdigest()
        if meta.get(f"ddl:{e.table}") not in (None, digest):
            # The layer's definition of this table changed: rebuild this table only.
            log(f"  {e.table}: definition changed, rebuilding it")
            ch.execute(f"DROP VIEW IF EXISTS {q(ctx.db)}.{q(rmv_name(e))} SYNC")
            ch.execute(f"DROP TABLE IF EXISTS {q(ctx.db)}.{q(e.table)} SYNC")
            meta.pop(f"backfilled:{e.table}", None)
        ch.execute(table_ddl)
        done = meta.get(f"backfilled:{e.table}")
        if done is None:
            # Not backfilled to completion (new table, or a run cut off half way): start over.
            ch.execute(f"DROP VIEW IF EXISTS {q(ctx.db)}.{q(rmv_name(e))} SYNC")
            ch.execute(f"TRUNCATE TABLE {q(ctx.db)}.{q(e.table)}")
            backfill(ctx, e, frontier)
            meta_set(ctx, {f"backfilled:{e.table}": json.dumps(frontier), f"ddl:{e.table}": digest})
        else:
            meta_set(ctx, {f"ddl:{e.table}": digest})
            log(f"  {e.table}: backfilled at checkpoint {done}, {table_rows(ctx, e.table)} rows; refreshed incrementally")
    for e in ENTITIES:
        if ctx.has_source(e):
            # CREATE ... IF NOT EXISTS keeps an existing refresh as it was: replace it when its
            # definition changed (a new layer version, or the indexer switched sequence mode)
            view_ddl = rmv_ddl(ctx, e, instance)
            view_digest = hashlib.sha1(view_ddl.encode()).hexdigest()
            if meta.get(f"rmv:{e.table}") != view_digest:
                ch.execute(f"DROP VIEW IF EXISTS {q(ctx.db)}.{q(rmv_name(e))} SYNC")
            ch.execute(view_ddl)
            meta_set(ctx, {f"rmv:{e.table}": view_digest})
            ch.execute(f"SYSTEM START VIEW {q(ctx.db)}.{q(rmv_name(e))}")  # a verify cut off leaves it stopped
    for s in view_statements(ctx):
        ch.execute(s)
    meta_set(
        ctx,
        {
            "source_database": ctx.src,
            "source_instance": instance,
            "layer_version": LAYER_VERSION,
            "installed_frontier": json.dumps(frontier),
            "checkpoint_sequence": mode,
        },
    )
    n_tables = sum(1 for e in ENTITIES if ctx.has_source(e))
    log(f"installed {ctx.db}: {n_tables} tables, {len(view_statements(ctx))} views; refresh every {REFRESH_EVERY}")


def refresh(ctx: Ctx):
    for e in ENTITIES:
        if ctx.has_source(e):
            ctx.ch.execute(f"SYSTEM REFRESH VIEW {q(ctx.db)}.{q(rmv_name(e))}")
    for e in ENTITIES:
        if ctx.has_source(e):
            ctx.ch.execute(f"SYSTEM WAIT VIEW {q(ctx.db)}.{q(rmv_name(e))}")


def layer_versions(ctx: Ctx, e: Entity) -> dict[int, int]:
    """sequence -> max(_version) in the layer table (the watermark before the minus one)."""
    rows = ctx.ch.rows(
        f"SELECT toInt32({ctx.scope_layer()}) AS k, max(_version) AS v FROM {q(ctx.db)}.{q(e.table)} GROUP BY k"
    )
    return {int(r["k"]): int(r["v"]) for r in rows}


def rows_between(ctx: Ctx, e: Entity, lo: dict[int, int], hi: dict[int, int]) -> int:
    """Source rows with lo[seq] < envio_checkpoint_id <= hi[seq], one constant range per
    sequence so the checkpoint skip index applies."""
    total = 0
    for k in sorted(set(lo) | set(hi)):
        a, b = lo.get(k, 0), hi.get(k, 0)
        if b <= a:
            continue
        total += int(ctx.ch.scalar(
            f"SELECT count() FROM {q(ctx.src)}.{q(ctx.hist(e))} "
            f"WHERE {ctx.scope_src()} = {k} AND envio_checkpoint_id > {a} AND envio_checkpoint_id <= {b}"
        ) or 0)
    return total


def status(ctx: Ctx) -> list[dict]:
    frontier = ctx.frontier_map()
    meta = meta_get(ctx)
    instance = ctx.instance()
    refreshes = {
        r["view"]: r
        for r in ctx.ch.rows(
            "SELECT view, status, last_success_time, last_refresh_time, next_refresh_time, exception "
            f"FROM system.view_refreshes WHERE database = {lit(ctx.db)}"
        )
    }
    out = []
    for e in ENTITIES:
        if e.table not in existing_tables(ctx):
            continue
        wm = layer_versions(ctx, e)
        lag_rows = rows_between(ctx, e, wm, frontier)
        # a version above its sequence's frontier was loaded before envio committed it
        ahead = sorted(k for k, v in wm.items() if v > frontier.get(k, 0))
        r = refreshes.get(rmv_name(e), {})
        out.append(
            {
                "table": e.table,
                "rows": table_rows(ctx, e.table),
                "watermark": wm if ctx.per_chain() else wm.get(0, 0),
                "frontier": frontier if ctx.per_chain() else frontier.get(0, 0),
                "source_rows_behind": lag_rows,
                "ahead_of_frontier": ahead,
                "refresh": r.get("status", "missing"),
                "last_success": r.get("last_success_time"),
                "error": (r.get("exception") or "")[:200],
            }
        )
    if ctx.per_chain() and len(frontier) > CHAIN_SLOTS:
        out.append({"table": "!", "error": f"{len(frontier)} chains but ANALYTICS_CHAIN_SLOTS={CHAIN_SLOTS}: chains beyond are not refreshed; raise it and run install"})
    if meta.get("source_instance") and meta.get("source_instance") != instance:
        out.append({"table": "!", "error": f"STALE: indexer reset since install ({meta['source_instance']} -> {instance}); run install"})
    return out


def verify(ctx: Ctx, only: list[str] | None = None) -> bool:
    """Compare every storage table with argMax over envio's history at the table's watermark.

    The expected side is computed independently of the layer's conversion code: argMax of each
    raw envio column by envio_checkpoint_id (per id, or per id and period for the series),
    keeping ids whose latest change is a SET; the actual side is the storage table read with
    FINAL. Both are compared as text, so any loss in the typed conversion shows up as a mismatch.
    Refreshes are stopped while it runs so the watermark does not move.
    """
    ok = True
    names = [rmv_name(e) for e in ENTITIES if ctx.has_source(e)]
    for n in names:
        ctx.ch.execute(f"SYSTEM STOP VIEW {q(ctx.db)}.{q(n)}")
    try:
        for n in names:
            try:  # a refresh the STOP cancelled reports "Refresh failed: cancelled"
                ctx.ch.execute(f"SYSTEM WAIT VIEW {q(ctx.db)}.{q(n)}")
            except ClickHouseError as err:
                if "cancelled" not in str(err):
                    raise
        for e in ENTITIES:
            if only and e.key not in only:
                continue
            if not ctx.has_source(e):
                continue
            ok &= verify_entity(ctx, e)
    finally:
        for n in names:
            ctx.ch.execute(f"SYSTEM START VIEW {q(ctx.db)}.{q(n)}")
    return ok


def verify_entity(ctx: Ctx, e: Entity) -> bool:
    t0 = time.time()
    # Per sequence: the table's watermark, capped at the commit frontier, so a version loaded
    # before envio committed it shows up as a mismatch (it is not in the expected state).
    frontier = ctx.frontier_map()
    loaded = layer_versions(ctx, e)
    f0 = {k: min(v, frontier.get(k, 0)) for k, v in loaded.items()}
    cut = f"envio_checkpoint_id <= {map_lit(f0)}[{ctx.scope_src()}]"
    key = ", ".join([*ctx.scope_cols(), "id"])
    h = f"{q(ctx.src)}.{q(ctx.hist(e))}"
    pairs = [(r.name, r.verify_pair()) for r in ctx.resolved(e)]
    pairs = [(n, p) for n, p in pairs if p]
    src_cols = needed_source_columns(ctx, e, for_verify=True)
    if e.mode == "latest":
        aggs = ", ".join(f"tupleElement(argMax(tuple({q(c)}), envio_checkpoint_id), 1) AS {q('__' + c)}" for c in src_cols)
        renamed = ", ".join(f"{q('__' + c)} AS {q(c)}" for c in src_cols)
        expected = (
            f"SELECT id, {renamed} FROM (SELECT id, {aggs}, argMax(envio_change, envio_checkpoint_id) AS __change"
            f" FROM {h} WHERE {{chunk}} AND {cut} GROUP BY {key}) WHERE __change = 'SET'"
        )
        join_on = "e.id = t.id"
    else:
        aggs = ", ".join(f"tupleElement(argMax(tuple({q(c)}), envio_checkpoint_id), 1) AS {q('__' + c)}" for c in src_cols)
        renamed = ", ".join(f"{q('__' + c)} AS {q(c)}" for c in src_cols)
        expected = (
            f"SELECT id, _period, {renamed} FROM (SELECT id, {e.period_expr} AS _period, {aggs}"
            f" FROM {h} WHERE {{chunk}} AND {cut} AND envio_change = 'SET' GROUP BY {key}, _period)"
        )
        join_on = "e.id = t.id AND e._period = t.period"
        # prev_<f>: the value at the end of the pool's previous period (0 for the first)
        by_name = {r.name: r for r in ctx.resolved(e)}
        lags = ", ".join(
            f"lagInFrame(toNullable(toString({q(by_name[f].col.src)})), 1, toNullable('0')) "
            f"OVER (PARTITION BY id ORDER BY _period ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS {q('__prev_' + f)}"
            for f in e.prev_fields
        )
        expected = f"SELECT *, {lags} FROM ({expected})"
        pairs += [
            (f"prev_{f}", (f"ifNull(toString(t.{q('prev_' + f)}), '<null>')", f"ifNull(e.{q('__prev_' + f)}, '<null>')"))
            for f in e.prev_fields
        ]
    mism = ", ".join(f"countIf({p[0]} != {p[1]}) AS {q('m_' + n)}" for n, p in pairs)
    totals: dict[str, int] = {}
    # series compare every version of a pool-period and sort them for prev_: smaller chunks
    for chunk in chunks(ctx, e, VERIFY_CHUNK_ROWS if e.mode == "latest" else VERIFY_CHUNK_ROWS // 4):
        sql = (
            f"SELECT count() AS compared, countIf(t.id = '') AS missing_in_layer, {mism}\n"
            f"FROM ({expected.format(chunk=chunk)}) AS e\n"
            f"LEFT JOIN (SELECT * FROM {q(ctx.db)}.{q(e.table)} FINAL WHERE {chunk}) AS t ON {join_on}"
        )
        extra_sql = (
            f"SELECT count() FROM (SELECT id{', period' if e.mode != 'latest' else ''} FROM {q(ctx.db)}.{q(e.table)} FINAL WHERE {chunk}) AS t "
            f"LEFT ANTI JOIN ({expected.format(chunk=chunk)}) AS e ON {join_on}"
        )
        row = ctx.ch.rows(sql, {"join_use_nulls": "0"})[0]
        row["extra_in_layer"] = ctx.ch.scalar(extra_sql)
        for k, v in row.items():
            totals[k] = totals.get(k, 0) + int(v)
    bad = {k: v for k, v in totals.items() if k != "compared" and v}
    log(
        f"  verify {e.table} at {fmt_map(f0)}: {totals.get('compared', 0)} "
        f"{'ids' if e.mode == 'latest' else 'id-periods'} compared over {len(pairs)} columns "
        f"in {time.time() - t0:.1f}s -> {'OK' if not bad else 'MISMATCH ' + json.dumps(bad)}"
    )
    return not bad


# Dual-stored aggregates (Postgres serves the handlers) whose ClickHouse history is one row per
# block in which they changed: the tables a short TTL shrinks. Column = the block time of the change.
TTL_TABLES = {
    "Pool": "lastUpdatedTimestamp", "UserStatsPerPool": "lastActivityTimestamp", "Token": "lastUpdatedTimestamp",
    "NonFungiblePosition": "lastUpdatedTimestamp", "ALM_LP_Wrapper": "lastUpdatedTimestamp",
    "VeNFTState": "lastUpdatedTimestamp", "VeNFTPoolVote": "lastUpdatedTimestamp",
    "AeroGauge": "lastUpdatedTimestamp", "AeroLeafVoterState": "lastUpdatedTimestamp",
    "AeroRootChainState": "lastUpdatedTimestamp", "AeroMinterState": "lastUpdatedTimestamp",
    "AeroLeafTokenState": "lastUpdatedTimestamp", "AeroRootAllocation": "lastUpdatedTimestamp",
}


def history_ttl(ctx: Ctx, days: int, apply: bool, remove: bool):
    """Print (or apply) a TTL on envio's per-block history of the dual-stored aggregates.

    This is the one command that writes to the indexer's database, and only with --apply. It
    refuses unless every layer table is caught up with the commit frontier, because rows that
    expire before the layer read them are lost to it. Apply it once the indexer is at the head:
    a TTL declared in schema.graphql would also fire during a resync, on rows whose block time is
    old, within seconds of their insert (measured: the layer then misses most of the state).
    envio's own entity views (Pool, Token, ...) become incomplete once versions expire; read the
    layer instead. An indexer reset recreates the tables without the TTL.
    """
    stmts = []
    for entity, col in TTL_TABLES.items():
        table = f"envio_history_{entity}"
        cols = ctx.ch.rows(f"SELECT name FROM system.columns WHERE database = {lit(ctx.src)} AND table = {lit(table)}")
        if col not in {c["name"] for c in cols}:
            continue
        if remove:
            stmts.append(f"ALTER TABLE {q(ctx.src)}.{q(table)} REMOVE TTL")
        else:
            stmts.append(
                f"ALTER TABLE {q(ctx.src)}.{q(table)} MODIFY TTL toDateTime({q(col)}) + INTERVAL {days} DAY "
                "WHERE envio_change = 'SET' SETTINGS materialize_ttl_after_modify = 0"
            )
    if not apply:
        print(";\n".join(stmts) + ";")
        print("-- dry run; add --apply to run. Then reclaim space now with ALTER TABLE ... MATERIALIZE TTL, or let merges do it.",
              file=sys.stderr)
        return
    if not remove:
        behind = [r for r in status(ctx) if r.get("source_rows_behind", 0) > 0 or r.get("table") == "!"]
        if behind:
            raise SystemExit("refusing: the layer is not caught up with the indexer: "
                             + ", ".join(f"{r['table']} ({r.get('source_rows_behind')})" for r in behind))
    for st in stmts:
        log(st)
        ctx.ch.execute(st)


def run_queries(ctx: Ctx, files: list[str]):
    qdir = HERE / "queries"
    paths = [Path(f) for f in files] if files else sorted(qdir.glob("*.sql"))
    results = []
    for p in paths:
        sql = ctx.render(p.read_text()).strip().rstrip(";")
        res = {"query": p.name}
        try:
            for run in ("first", "second"):  # the second run shows the warm-cache time
                t0 = time.time()
                body, _ = ctx.ch.request(sql + "\nFORMAT JSON", {"max_execution_time": "600", "database": ctx.db})
                doc = json.loads(body)
                stats = doc.get("statistics", {})
                res[f"elapsed_{run}_s"] = round(stats.get("elapsed", time.time() - t0), 3)
            res.update(
                rows=doc.get("rows"),
                elapsed_s=min(res["elapsed_first_s"], res["elapsed_second_s"]),
                read_rows=stats.get("rows_read"),
                read_bytes=stats.get("bytes_read"),
                first_rows=doc.get("data", [])[:3],
            )
            log(f"{p.name}: {res['rows']} rows, {res['elapsed_first_s']}s / {res['elapsed_second_s']}s, "
                f"read {res['read_rows']} rows / {res['read_bytes']} bytes")
        except ClickHouseError as e:
            res["error"] = str(e).splitlines()[0]
            log(f"{p.name}: ERROR {res['error']}")
        results.append(res)
    return results


# ----------------------------------------------------------------------------- CLI


def connect(args) -> Ctx:
    env = os.environ.get
    url = args.url or env("CLICKHOUSE_URL") or env("ENVIO_CLICKHOUSE_HOST")
    user = env("CLICKHOUSE_USER") or env("ENVIO_CLICKHOUSE_USERNAME") or "default"
    password = env("CLICKHOUSE_PASSWORD") or env("ENVIO_CLICKHOUSE_PASSWORD") or ""
    src = args.source or env("CLICKHOUSE_SOURCE_DATABASE") or env("ENVIO_CLICKHOUSE_DATABASE")
    if not url or not src:
        raise SystemExit("set ENVIO_CLICKHOUSE_HOST and ENVIO_CLICKHOUSE_DATABASE (or --url / --source)")
    if not url.startswith("http"):
        url = "http://" + url
    db = args.db or env("ANALYTICS_DATABASE") or f"analytics_{src}"
    if db == src:
        raise SystemExit("the analytics database must differ from the indexer's: envio empties its own database on reset")
    return Ctx(CH(url, user, password), src, db)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["install", "rebuild", "refresh", "status", "verify", "drop", "render", "queries", "history-ttl"])
    p.add_argument("files", nargs="*", help="queries: .sql files to run (default clickhouse/queries/*.sql); verify: entity keys")
    p.add_argument("--url")
    p.add_argument("--source", help="indexer database (default ENVIO_CLICKHOUSE_DATABASE)")
    p.add_argument("--db", help="analytics database (default analytics_<source>)")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.add_argument("--days", type=int, default=30, help="history-ttl: days of per-block history to keep")
    p.add_argument("--apply", action="store_true", help="history-ttl: run the statements (default: print them)")
    p.add_argument("--remove", action="store_true", help="history-ttl: remove the TTL again")
    a = p.parse_args(argv)
    ctx = connect(a)
    if a.command == "install":
        install(ctx)
    elif a.command == "rebuild":
        install(ctx, force_rebuild=True)
    elif a.command == "refresh":
        refresh(ctx)
        for r in status(ctx):
            print(json.dumps(r, default=str))
    elif a.command == "status":
        for r in status(ctx):
            print(json.dumps(r, default=str))
    elif a.command == "verify":
        sys.exit(0 if verify(ctx, a.files or None) else 1)
    elif a.command == "drop":
        drop_layer_objects(ctx, keep_db=False)
    elif a.command == "render":
        instance = ctx.instance() or "<instance>"
        frontier = ctx.frontier_map()
        print(META_DDL.format(db=q(ctx.db)) + ";\n")
        for e in ENTITIES:
            if not ctx.has_source(e):
                continue
            print(ddl(ctx, e) + ";\n")
            print("-- backfill (one statement per id chunk)\n" + insert_into(ctx, e)
                  + with_prev_backfill(ctx, e, projection(ctx, e, backfill_rows(ctx, e, "1", frontier))) + ";\n")
            print(rmv_ddl(ctx, e, instance) + ";\n")
        for s in view_statements(ctx):
            print(s + ";\n")
    elif a.command == "history-ttl":
        history_ttl(ctx, a.days, a.apply, a.remove)
    elif a.command == "queries":
        res = run_queries(ctx, a.files)
        if a.json:
            print(json.dumps(res, default=str, indent=1))


if __name__ == "__main__":
    main()
