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

Connection (no secrets in the repo; the same variables envio itself reads):
    ENVIO_CLICKHOUSE_HOST       http(s)://host:port of the ClickHouse HTTP interface
    ENVIO_CLICKHOUSE_USERNAME   a user that may read the indexer database and create the analytics one
    ENVIO_CLICKHOUSE_PASSWORD
    ENVIO_CLICKHOUSE_DATABASE   the indexer's database (the source; never written)
    ANALYTICS_DATABASE          optional; default analytics_<indexer database>
CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD / CLICKHOUSE_SOURCE_DATABASE override them.

Python 3.9+ standard library only. See docs/clickhouse.md.
"""

from __future__ import annotations

import argparse
import base64
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


# ----------------------------------------------------------------------------- context


class Ctx:
    def __init__(self, ch: CH, src: str, db: str):
        self.ch, self.src, self.db = ch, src, db
        self._types: dict[str, dict[str, str]] = {}

    def frontier_sql(self) -> str:
        return f"(SELECT max(checkpoint_id) FROM {q(self.src)}.envio_chains FINAL)"

    def frontier(self) -> int:
        return int(self.ch.scalar(f"SELECT {self.frontier_sql()}") or 0)

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
        return [Resolved(c, types) for c in e.columns]

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
        return (
            sql.replace("{{db}}", q(self.db))
            .replace("{{src}}", q(self.src))
            .replace("{{frontier}}", self.frontier_sql())
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
    partition = f"intDiv(_version, {VERSION_BUCKET})"
    if e.partition_extra:
        partition = f"({e.partition_extra}, {partition})"
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


def group_key(e: Entity) -> str:
    """What one stored row stands for: an id (current state) or an id and a period (series)."""
    return "id" if e.mode == "latest" else f"id, {e.period_expr}"


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


SERIES_WINDOW = "WINDOW __w AS (PARTITION BY chain_id, pool_address ORDER BY period ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)"


def with_prev_backfill(ctx: Ctx, e: Entity, proj: str) -> str:
    """Backfill: a chunk holds every period of its pools, so prev_ is the previous row's value."""
    if not e.prev_fields:
        return proj
    types = {r.name: r.ch_type for r in ctx.resolved(e)}
    lags = ", ".join(f"lagInFrame({q(f)}, 1, {zero(types[f])}) OVER __w AS {q('prev_' + f)}" for f in e.prev_fields)
    return f"SELECT *, {lags}\nFROM (\n{proj}\n)\n{SERIES_WINDOW}"


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
    pools = "(chain_id, pool_address) IN (SELECT chain_id, pool_address FROM __new)"
    prevs = ", ".join(
        f"if(x.__has = 1, x.{q('prev_' + f)}, if(n.__rn = 1, if(o.__has = 1, o.{q('__end_' + f)}, {zero(types[f])}), n.{q('__lag_' + f)})) AS {q('prev_' + f)}"
        for f in e.prev_fields
    )
    ends = ", ".join(f"argMax({q(f)}, period) AS {q('__end_' + f)}" for f in e.prev_fields)
    xprev = ", ".join(q('prev_' + f) for f in e.prev_fields)
    return (
        f"WITH __new AS (\n  SELECT *, row_number() OVER (PARTITION BY chain_id, pool_address ORDER BY period) AS __rn, {lags}\n"
        f"  FROM (\n{proj}\n  )\n  {SERIES_WINDOW}\n)\n"
        f"SELECT " + ", ".join(f"n.{q(c)} AS {q(c)}" for c in base) + f", {prevs}\n"
        f"FROM __new AS n\n"
        f"LEFT JOIN (SELECT chain_id, pool_address, period, 1 AS __has, {xprev} FROM {t} FINAL WHERE {pools}) AS x\n"
        f"  ON x.chain_id = n.chain_id AND x.pool_address = n.pool_address AND x.period = n.period\n"
        f"LEFT JOIN (SELECT chain_id, pool_address, 1 AS __has, {ends} FROM {t} FINAL WHERE {pools} GROUP BY chain_id, pool_address) AS o\n"
        f"  ON o.chain_id = n.chain_id AND o.pool_address = n.pool_address"
    )


def chunk_pred(lo: str | None, hi: str | None) -> str:
    parts = []
    if lo is not None:
        parts.append(f"id >= {lit(lo)}")
    if hi is not None:
        parts.append(f"id < {lit(hi)}")
    return " AND ".join(parts) or "1"


def backfill_rows(ctx: Ctx, e: Entity, chunk: str, frontier: int) -> str:
    """Rows to load: per id (or id and period), the last version at or below the frontier.

    Two phases keep memory flat: the last checkpoint per key reads three narrow columns, and
    the full rows are then fetched by primary key (id, envio_checkpoint_id), so only the
    granules holding them are read. Series skip DELETE rows (a pool is never deleted; a
    rollback that removes one leaves its earlier periods, see docs).
    """
    h = f"{q(ctx.src)}.{q(ctx.hist(e))}"
    only_set = "" if e.mode == "latest" else " AND envio_change = 'SET'"
    return (
        f"{rows_select(ctx, e)} WHERE {chunk}{only_set} AND (id, envio_checkpoint_id) IN (\n"
        f"    SELECT id, max(envio_checkpoint_id) FROM {h} WHERE {chunk}{only_set} AND envio_checkpoint_id <= {frontier}\n"
        f"    GROUP BY {group_key(e)})"
    )


def watermark_sql(ctx: Ctx, e: Entity) -> str:
    # max(_version) comes from part metadata (see VERSION_BUCKET). Minus one: a refresh that
    # failed half way may have landed part of the rows of its last checkpoint.
    return f"(SELECT toUInt64(greatest(max(_version), 1) - 1) FROM {q(ctx.db)}.{q(e.table)})"


def refresh_rows(ctx: Ctx, e: Entity, instance: str) -> str:
    wm = watermark_sql(ctx, e)
    window = (
        f"envio_checkpoint_id > {wm} AND envio_checkpoint_id <= least({ctx.frontier_sql()}, {wm} + toUInt64({MAX_CHECKPOINTS_PER_REFRESH}))"
        f" AND (SELECT any(instance) FROM {q(ctx.src)}.envio_info) = {lit(instance)}"
    )
    only_set = "" if e.mode == "latest" else " AND envio_change = 'SET'"
    key = "id" if e.mode == "latest" else "id, _period"
    return f"{rows_select(ctx, e)} WHERE {window}{only_set} ORDER BY {key}, envio_checkpoint_id DESC LIMIT 1 BY {key}"


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


def backfill(ctx: Ctx, e: Entity, frontier: int):
    t0 = time.time()
    parts = chunks(ctx, e, BACKFILL_CHUNK_ROWS)
    total_read = 0
    for i, chunk in enumerate(parts, 1):
        sql = insert_into(ctx, e) + with_prev_backfill(ctx, e, projection(ctx, e, backfill_rows(ctx, e, chunk, frontier)))
        s = ctx.ch.execute(sql, BACKFILL_SETTINGS)
        total_read += int(s.get("read_rows", 0))
        log(f"  {e.table}: chunk {i}/{len(parts)} wrote {s.get('written_rows', '?')} rows (read {s.get('read_rows', '?')})")
    log(f"  {e.table}: backfilled up to checkpoint {frontier} in {time.time() - t0:.1f}s ({total_read} source rows read)")


VIEW_FILES = ["views.sql"]


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
    out = []
    for f in VIEW_FILES:
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
    if force_rebuild:
        reasons.append("rebuild requested")
    if reasons:
        log("rebuilding: " + "; ".join(reasons))
        drop_layer_objects(ctx)
        ch.execute(META_DDL.format(db=q(ctx.db)))

    frontier = ctx.frontier()
    meta = meta_get(ctx)
    log(f"source {ctx.src} instance {instance}, commit frontier checkpoint {frontier}")
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
            meta_set(ctx, {f"backfilled:{e.table}": str(frontier), f"ddl:{e.table}": digest})
        else:
            meta_set(ctx, {f"ddl:{e.table}": digest})
            log(f"  {e.table}: backfilled at checkpoint {done}, {table_rows(ctx, e.table)} rows; refreshed incrementally")
    for e in ENTITIES:
        if ctx.has_source(e):
            ch.execute(rmv_ddl(ctx, e, instance))
            ch.execute(f"SYSTEM START VIEW {q(ctx.db)}.{q(rmv_name(e))}")  # a verify cut off leaves it stopped
    for s in view_statements(ctx):
        ch.execute(s)
    meta_set(
        ctx,
        {
            "source_database": ctx.src,
            "source_instance": instance,
            "layer_version": LAYER_VERSION,
            "installed_frontier": str(frontier),
        },
    )
    log(f"installed {ctx.db}: {len(ENTITIES)} tables, {len(view_statements(ctx))} views; refresh every {REFRESH_EVERY}")


def refresh(ctx: Ctx):
    for e in ENTITIES:
        if ctx.has_source(e):
            ctx.ch.execute(f"SYSTEM REFRESH VIEW {q(ctx.db)}.{q(rmv_name(e))}")
    for e in ENTITIES:
        if ctx.has_source(e):
            ctx.ch.execute(f"SYSTEM WAIT VIEW {q(ctx.db)}.{q(rmv_name(e))}")


def status(ctx: Ctx) -> list[dict]:
    frontier = ctx.frontier()
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
        wm = int(ctx.ch.scalar(f"SELECT max(_version) FROM {q(ctx.db)}.{q(e.table)}") or 0)
        lag_rows = int(
            ctx.ch.scalar(
                f"SELECT count() FROM {q(ctx.src)}.{q(ctx.hist(e))} WHERE envio_checkpoint_id > {wm} AND envio_checkpoint_id <= {frontier}"
            )
            or 0
        )
        r = refreshes.get(rmv_name(e), {})
        out.append(
            {
                "table": e.table,
                "rows": table_rows(ctx, e.table),
                "watermark": wm,
                "frontier": frontier,
                "source_rows_behind": lag_rows,
                "refresh": r.get("status", "missing"),
                "last_success": r.get("last_success_time"),
                "error": (r.get("exception") or "")[:200],
            }
        )
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
    f0 = int(ctx.ch.scalar(f"SELECT max(_version) FROM {q(ctx.db)}.{q(e.table)}") or 0)
    h = f"{q(ctx.src)}.{q(ctx.hist(e))}"
    pairs = [(r.name, r.verify_pair()) for r in ctx.resolved(e)]
    pairs = [(n, p) for n, p in pairs if p]
    src_cols = needed_source_columns(ctx, e, for_verify=True)
    if e.mode == "latest":
        aggs = ", ".join(f"tupleElement(argMax(tuple({q(c)}), envio_checkpoint_id), 1) AS {q('__' + c)}" for c in src_cols)
        renamed = ", ".join(f"{q('__' + c)} AS {q(c)}" for c in src_cols)
        expected = (
            f"SELECT id, {renamed} FROM (SELECT id, {aggs}, argMax(envio_change, envio_checkpoint_id) AS __change"
            f" FROM {h} WHERE {{chunk}} AND envio_checkpoint_id <= {f0} GROUP BY id) WHERE __change = 'SET'"
        )
        join_on = "e.id = t.id"
    else:
        aggs = ", ".join(f"tupleElement(argMax(tuple({q(c)}), envio_checkpoint_id), 1) AS {q('__' + c)}" for c in src_cols)
        renamed = ", ".join(f"{q('__' + c)} AS {q(c)}" for c in src_cols)
        expected = (
            f"SELECT id, _period, {renamed} FROM (SELECT id, {e.period_expr} AS _period, {aggs}"
            f" FROM {h} WHERE {{chunk}} AND envio_checkpoint_id <= {f0} AND envio_change = 'SET' GROUP BY id, _period)"
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
        f"  verify {e.table} at checkpoint {f0}: {totals.get('compared', 0)} "
        f"{'ids' if e.mode == 'latest' else 'id-periods'} compared over {len(pairs)} columns "
        f"in {time.time() - t0:.1f}s -> {'OK' if not bad else 'MISMATCH ' + json.dumps(bad)}"
    )
    return not bad


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
    p.add_argument("command", choices=["install", "rebuild", "refresh", "status", "verify", "drop", "render", "queries"])
    p.add_argument("files", nargs="*", help="queries: .sql files to run (default clickhouse/queries/*.sql); verify: entity keys")
    p.add_argument("--url")
    p.add_argument("--source", help="indexer database (default ENVIO_CLICKHOUSE_DATABASE)")
    p.add_argument("--db", help="analytics database (default analytics_<source>)")
    p.add_argument("--json", action="store_true", help="machine-readable output")
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
        frontier = ctx.frontier()
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
    elif a.command == "queries":
        res = run_queries(ctx, a.files)
        if a.json:
            print(json.dumps(res, default=str, indent=1))


if __name__ == "__main__":
    main()
