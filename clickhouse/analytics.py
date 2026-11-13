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
BACKFILL_CHUNK_ROWS = int(os.environ.get("ANALYTICS_BACKFILL_CHUNK_ROWS", "20000000"))
VERIFY_CHUNK_ROWS = int(os.environ.get("ANALYTICS_VERIFY_CHUNK_ROWS", "3000000"))
QUERY_SETTINGS = {
    "max_memory_usage": os.environ.get("ANALYTICS_MAX_MEMORY", "1200000000"),
    "max_bytes_before_external_group_by": os.environ.get("ANALYTICS_EXTERNAL_GROUP_BY", "400000000"),
    "max_bytes_before_external_sort": os.environ.get("ANALYTICS_EXTERNAL_SORT", "400000000"),
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
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                summary = json.loads(r.headers.get("X-ClickHouse-Summary") or "{}")
                return r.read().decode(), summary
        except urllib.error.HTTPError as e:
            raise ClickHouseError(f"{e.code}: {e.read().decode().strip()}\n--- query ---\n{sql[:4000]}") from None

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
    cols += [
        "  `_version` UInt64 COMMENT 'envio_checkpoint_id of the row this state was taken from'",
        "  `_deleted` UInt8 COMMENT '1 when envio deleted the entity (envio_change = DELETE)'",
        "  `_loaded_at` DateTime DEFAULT now() COMMENT 'when the layer loaded this version'",
    ]
    if e.extra_ddl:
        cols += ["  " + x.strip() for x in e.extra_ddl.split(", INDEX ")]
        cols = [c if c.lstrip().startswith(("`", "INDEX")) else "  INDEX " + c.strip() for c in cols]
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


def needed_source_columns(ctx: Ctx, e: Entity) -> list[str]:
    types = ctx.source_types(e)
    cols = []
    for r in ctx.resolved(e):
        if r.col.src and r.present and r.col.src not in cols:
            cols.append(r.col.src)
    for extra in ("chainId", "lastUpdatedTimestamp"):
        if extra in types and extra not in cols:
            cols.append(extra)
    return [c for c in cols if c != "id"]


def rows_sql(ctx: Ctx, e: Entity, where: str) -> str:
    """Source rows for the projection. `where` bounds them (checkpoint window and/or id chunk)."""
    h = f"{q(ctx.src)}.{q(ctx.hist(e))}"
    if e.mode == "latest":
        return where.format(h=h)
    aggs = ",\n    ".join(f"argMax({q(c)}, envio_checkpoint_id) AS {q(c)}" for c in needed_source_columns(ctx, e))
    return (
        f"SELECT id, {e.period_expr} AS _period, max(envio_checkpoint_id) AS envio_checkpoint_id,\n    {aggs}\n"
        f"  FROM {h}\n  WHERE envio_change = 'SET' AND ({where.format(h=h, series=True)})\n"
        f"  GROUP BY id, _period"
    )


def projection(ctx: Ctx, e: Entity, rows: str) -> str:
    exprs = [f"{r.expr()} AS {q(r.name)}" for r in ctx.resolved(e)]
    if e.mode == "latest":
        exprs += ["envio_checkpoint_id AS _version", "toUInt8(envio_change = 'DELETE') AS _deleted"]
    else:
        exprs += ["_period AS period", "envio_checkpoint_id AS _version", "toUInt8(0) AS _deleted"]
    return "SELECT\n  " + ",\n  ".join(exprs) + f"\nFROM (\n  {rows}\n) AS h"


def chunk_pred(lo: str | None, hi: str | None) -> str:
    parts = []
    if lo is not None:
        parts.append(f"id >= {lit(lo)}")
    if hi is not None:
        parts.append(f"id < {lit(hi)}")
    return " AND ".join(parts) or "1"


def backfill_rows(ctx: Ctx, e: Entity, chunk: str, frontier: int) -> str:
    if e.mode == "latest":
        # Two phases: the latest checkpoint per id reads two columns; the full rows are then
        # fetched by primary key, so only the granules holding them are read.
        return rows_sql(
            ctx,
            e,
            "SELECT * FROM {h} WHERE "
            + chunk
            + " AND (id, envio_checkpoint_id) IN (SELECT id, max(envio_checkpoint_id) FROM {h} WHERE "
            + chunk
            + f" AND envio_checkpoint_id <= {frontier} GROUP BY id)",
        )
    return rows_sql(ctx, e, chunk + f" AND envio_checkpoint_id <= {frontier}")


def watermark_sql(ctx: Ctx, e: Entity) -> str:
    # max(_version) comes from part metadata (see VERSION_BUCKET). Minus one: a refresh that
    # failed half way may have landed part of the rows of its last checkpoint.
    return f"(SELECT greatest(max(_version), 1) - 1 FROM {q(ctx.db)}.{q(e.table)})"


def refresh_rows(ctx: Ctx, e: Entity, instance: str) -> str:
    wm = watermark_sql(ctx, e)
    window = (
        f"envio_checkpoint_id > {wm} AND envio_checkpoint_id <= least({ctx.frontier_sql()}, {wm} + {MAX_CHECKPOINTS_PER_REFRESH})"
        f" AND (SELECT any(instance) FROM {q(ctx.src)}.envio_info) = {lit(instance)}"
    )
    if e.mode == "latest":
        return rows_sql(ctx, e, "SELECT * FROM {h} WHERE " + window + " ORDER BY id, envio_checkpoint_id DESC LIMIT 1 BY id")
    return rows_sql(ctx, e, window)


def rmv_name(e: Entity) -> str:
    return f"_refresh_{e.key}"


def rmv_ddl(ctx: Ctx, e: Entity, instance: str) -> str:
    return (
        f"CREATE MATERIALIZED VIEW IF NOT EXISTS {q(ctx.db)}.{q(rmv_name(e))}\n"
        f"REFRESH EVERY {REFRESH_EVERY}\n"
        f"APPEND TO {q(ctx.db)}.{q(e.table)}\n"
        f"AS {projection(ctx, e, refresh_rows(ctx, e, instance))}\n"
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
    """id ranges of about target_rows source rows each, cut at primary-index marks."""
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
    for t in sorted(existing_tables(ctx)):
        if t.startswith("_refresh_"):
            ctx.ch.execute(f"DROP VIEW IF EXISTS {q(ctx.db)}.{q(t)} SYNC")
    for t in sorted(existing_tables(ctx)):
        ctx.ch.execute(f"DROP TABLE IF EXISTS {q(ctx.db)}.{q(t)} SYNC")
    if not keep_db:
        ctx.ch.execute(f"DROP DATABASE IF EXISTS {q(ctx.db)} SYNC")


def backfill(ctx: Ctx, e: Entity, frontier: int):
    t0 = time.time()
    parts = chunks(ctx, e, BACKFILL_CHUNK_ROWS)
    total_read = 0
    for i, chunk in enumerate(parts, 1):
        sql = f"INSERT INTO {q(ctx.db)}.{q(e.table)}\n" + projection(ctx, e, backfill_rows(ctx, e, chunk, frontier))
        s = ctx.ch.execute(sql, {"optimize_aggregation_in_order": "1"})
        total_read += int(s.get("read_rows", 0))
        log(f"  {e.table}: chunk {i}/{len(parts)} wrote {s.get('written_rows', '?')} rows (read {s.get('read_rows', '?')})")
    log(f"  {e.table}: backfilled up to checkpoint {frontier} in {time.time() - t0:.1f}s ({total_read} source rows read)")


VIEW_FILES = ["views.sql"]


def statements(text: str) -> list[str]:
    out, cur = [], []
    for line in text.splitlines():
        if line.strip().startswith("--") and not cur:
            continue
        cur.append(line)
        if line.rstrip().endswith(";"):
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

    present = existing_tables(ctx)
    frontier = ctx.frontier()
    log(f"source {ctx.src} instance {instance}, commit frontier checkpoint {frontier}")
    for e in ENTITIES:
        if not ctx.has_source(e):
            log(f"  {e.table}: source {ctx.hist(e)} missing, skipped")
            continue
        ch.execute(ddl(ctx, e))
        if rmv_name(e) not in present and table_rows(ctx, e.table) == 0:
            backfill(ctx, e, frontier)
        else:
            log(f"  {e.table}: present ({table_rows(ctx, e.table)} rows), refreshed incrementally")
    for e in ENTITIES:
        if ctx.has_source(e):
            ch.execute(rmv_ddl(ctx, e, instance))
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
            ctx.ch.execute(f"SYSTEM WAIT VIEW {q(ctx.db)}.{q(n)}")
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
    src_cols = needed_source_columns(ctx, e)
    if e.mode == "latest":
        key_e, key_t = "e.id", "t.id"
        expected = (
            "SELECT id, " + ", ".join(f"argMax({q(c)}, envio_checkpoint_id) AS {q(c)}" for c in src_cols)
            + f", argMax(envio_change, envio_checkpoint_id) AS _change FROM {h} WHERE {{chunk}} AND envio_checkpoint_id <= {f0}"
            + " GROUP BY id HAVING _change = 'SET'"
        )
        join_on = "e.id = t.id"
    else:
        key_e, key_t = "concat(e.id, toString(e._period))", "concat(t.id, toString(t.period))"
        expected = (
            f"SELECT id, {e.period_expr} AS _period, "
            + ", ".join(f"argMax({q(c)}, envio_checkpoint_id) AS {q(c)}" for c in src_cols)
            + f" FROM {h} WHERE {{chunk}} AND envio_checkpoint_id <= {f0} AND envio_change = 'SET' GROUP BY id, _period"
        )
        join_on = "e.id = t.id AND e._period = t.period"
    mism = ", ".join(f"countIf({p[0]} != {p[1].replace('`', '`', 1)}) AS {q('m_' + n)}" for n, p in pairs)
    # The envio-side expressions reference the expected subquery's columns: qualify them.
    mism = re.sub(r"(?<![\w.])`(\w+)`(?!\s+AS)", lambda m: f"e.`{m.group(1)}`" if not m.group(1).startswith("m_") else m.group(0), mism)
    totals: dict[str, int] = {}
    for chunk in chunks(ctx, e, VERIFY_CHUNK_ROWS):
        sql = (
            f"SELECT count() AS compared, countIf({key_t} = '' OR t.id = '') AS missing_in_layer, {mism}\n"
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
    del key_e
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
        # analysts query with the read-only user; run the same text
        t0 = time.time()
        body, summary = ctx.ch.request(sql + "\nFORMAT JSON", {"max_execution_time": "600"})
        wall = time.time() - t0
        doc = json.loads(body)
        stats = doc.get("statistics", {})
        res = {
            "query": p.name,
            "rows": doc.get("rows"),
            "elapsed_s": round(stats.get("elapsed", wall), 3),
            "read_rows": stats.get("rows_read"),
            "read_bytes": stats.get("bytes_read"),
            "first_rows": doc.get("data", [])[:3],
        }
        results.append(res)
        log(f"{p.name}: {res['rows']} rows, {res['elapsed_s']}s, read {res['read_rows']} rows / {res['read_bytes']} bytes")
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
            print("-- backfill (one statement per id chunk)\nINSERT INTO " + q(ctx.db) + "." + q(e.table) + "\n"
                  + projection(ctx, e, backfill_rows(ctx, e, "1", frontier)) + ";\n")
            print(rmv_ddl(ctx, e, instance) + ";\n")
        for s in view_statements(ctx):
            print(s + ";\n")
    elif a.command == "queries":
        res = run_queries(ctx, a.files)
        if a.json:
            print(json.dumps(res, default=str, indent=1))


if __name__ == "__main__":
    main()
