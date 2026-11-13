#!/usr/bin/env python3
"""End-to-end test of the analytics layer's state mechanism on a synthetic envio database.

    python3 clickhouse/tests/test_mechanism.py --template <an envio database to copy table structures from>

Uses the same connection variables as analytics.py. Creates `analytics_test_src` (a fake envio
database with the template's table structures) and `analytics_test`, plays the situations the
layer must handle, and drops both at the end (--keep to leave them):

  1. rows above the commit frontier are never loaded (in flight, not committed)
  2. a DELETE marker removes the entity; FINAL hides it
  3. rows a crashed batch left above the frontier are trimmed by envio on resume and replaced
     with reused checkpoint ids: the layer never shows the trimmed version
  4. a reorg rollback writes the restored state at a later checkpoint: the layer follows it
  5. the hourly series keeps the last version of each hour
  6. an indexer reset (new envio instance): refreshes stop loading, status reports STALE, and
     install rebuilds from the new history
  7. `verify` agrees with argMax over the history at every step
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analytics as A  # noqa: E402

SRC, DB = "analytics_test_src", "analytics_test"
POOL, POS = "envio_history_Pool", "envio_history_NonFungiblePosition"
TABLES = ["envio_chains", "envio_checkpoints", "envio_info"] + sorted({f"envio_history_{e.source}" for e in A.ENTITIES})
H = 3600


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--template", required=True)
    p.add_argument("--keep", action="store_true")
    p.add_argument("--stop-after-install", action="store_true", help="debug: stop after the first install")
    a = p.parse_args()
    env = os.environ.get
    ch = A.CH(env("CLICKHOUSE_URL") or env("ENVIO_CLICKHOUSE_HOST"), env("CLICKHOUSE_USER") or env("ENVIO_CLICKHOUSE_USERNAME"),
              env("CLICKHOUSE_PASSWORD") or env("ENVIO_CLICKHOUSE_PASSWORD") or "")
    ctx = A.Ctx(ch, SRC, DB)
    failures = []

    def check(name, got, want):
        ok = got == want
        print(f"{'ok  ' if ok else 'FAIL'} {name}: got {got!r}" + ("" if ok else f", want {want!r}"))
        if not ok:
            failures.append(name)

    def x(sql):
        ch.execute(sql)

    def frontier(ckpt, version):
        x(f"INSERT INTO {SRC}.envio_chains VALUES (1750, {ckpt}, {version})")

    def pool_row(ckpt, tvl, ts, change="SET", pid="1750-0xPOOL"):
        x(f"""INSERT INTO {SRC}.{POOL} SELECT * REPLACE ('{pid}' AS id, '{pid.split('-')[1]}' AS poolAddress, 1750 AS chainId,
              '{tvl}' AS totalLiquidityUSD, '{tvl * 10}' AS totalVolumeUSD, toDateTime64({ts}, 3, 'UTC') AS lastUpdatedTimestamp,
              {ckpt} AS envio_checkpoint_id, '{change}' AS envio_change)
              FROM (SELECT * FROM {a.template}.{POOL} WHERE envio_change = 'SET' LIMIT 1)""")

    def pos_row(ckpt, tid, change="SET"):
        x(f"""INSERT INTO {SRC}.{POS} SELECT * REPLACE ('1750-0xNFPM-{tid}' AS id, 1750 AS chainId, {ckpt} AS envio_checkpoint_id,
              '{change}' AS envio_change, '0xNFPM' AS nfpmAddress, '{tid}' AS tokenId) FROM (SELECT * FROM {a.template}.{POS} WHERE envio_change = 'SET' LIMIT 1)""")

    def tvl():
        r = ch.rows(f"SELECT toString(tvl_usd) AS v, _version FROM {DB}._pool FINAL WHERE id = '1750-0xPOOL'")
        return (int(r[0]["v"]), int(r[0]["_version"])) if r else None

    def refresh():
        A.refresh(ctx)

    # --- fake envio database
    x(f"DROP DATABASE IF EXISTS {DB} SYNC")
    x(f"DROP DATABASE IF EXISTS {SRC} SYNC")
    x(f"CREATE DATABASE {SRC}")
    have = {r["name"] for r in ch.rows(f"SELECT name FROM system.tables WHERE database = '{a.template}'")}
    TABLES[:] = [t for t in TABLES if t in have]  # a template from an older schema lacks newer entities
    for t in TABLES:
        x(f"CREATE TABLE {SRC}.{t} AS {a.template}.{t}")
    x(f"INSERT INTO {SRC}.envio_info VALUES (1, 'instance-A')")
    t0 = 1_760_000_000 // H * H
    pool_row(50, 1, t0 + 10)
    pool_row(90, 2, t0 + 20)
    pool_row(95, 5, t0 + H + 5)  # next hour
    pool_row(120, 3, t0 + H + 30)  # above the frontier: in flight
    pos_row(60, 1)
    pos_row(96, 1, "DELETE")  # burned
    pos_row(70, 2)
    frontier(100, 1)

    # --- 1, 2, 5: install (backfill) at frontier 100
    A.install(ctx)
    check("1 uncommitted row not loaded (state as of checkpoint 95)", tvl(), (5, 95))
    check("2 deleted position hidden", [r["token_id"] for r in ch.rows(f"SELECT token_id FROM {DB}._position FINAL ORDER BY 1")], [2])
    hours = ch.rows(f"SELECT toUnixTimestamp(period) - {t0} AS h, toString(tvl_usd) AS v FROM {DB}._pool_hour FINAL ORDER BY period")
    check("5 hourly series = last version of each hour", [(int(r["h"]), int(r["v"])) for r in hours], [(0, 2), (H, 5)])
    check("7 verify after backfill", A.verify(ctx), True)
    if a.stop_after_install:
        sys.exit(1 if failures else 0)

    # --- 1 again through the refresh path: frontier moves to 119, row 120 still in flight
    frontier(119, 2)
    refresh()
    check("1 refresh does not load past the frontier", tvl(), (5, 95))

    # --- 3: crash + resume: envio trims rows above the frontier and reuses the checkpoint ids
    x(f"ALTER TABLE {SRC}.{POOL} DELETE WHERE envio_checkpoint_id > 119 SETTINGS mutations_sync = 1")
    pool_row(120, 4, t0 + H + 40)  # the re-run of the batch, same checkpoint id, other state
    frontier(125, 10**6)
    refresh()
    check("3 trimmed version never shown; re-run version loaded", tvl(), (4, 120))

    # --- 4: reorg rollback: the diff restores the pre-reorg state at a new checkpoint
    # (a reorg near the head: the restored state carries a timestamp from the same hour)
    pool_row(130, 2, t0 + H + 10)
    frontier(130, 10**6 + 1)
    refresh()
    check("4 rollback diff followed", tvl(), (2, 130))

    # --- 5 again: two new hours in one refresh; prev_ chains across them and the stored hour
    pool_row(140, 6, t0 + 2 * H + 5)
    pool_row(141, 9, t0 + 3 * H + 5)
    frontier(141, 10**6 + 2)
    refresh()
    rows = ch.rows(f"SELECT toUnixTimestamp(period) - {t0} AS h, toString(tvl_usd) AS v, toString(prev_tvl_usd) AS p "
                   f"FROM {DB}._pool_hour FINAL ORDER BY period")
    check("5 hourly prev_ values chain across refreshes",
          [(int(r["h"]), int(r["v"]), int(r["p"])) for r in rows], [(0, 2, 0), (H, 2, 2), (2 * H, 6, 2), (3 * H, 9, 6)])
    check("7 verify after refreshes", A.verify(ctx), True)

    # --- 6: indexer reset: envio empties its database and starts a new instance
    before_reset = tvl()
    for t in TABLES:
        x(f"TRUNCATE TABLE {SRC}.{t}")
    x(f"INSERT INTO {SRC}.envio_info VALUES (1, 'instance-B')")
    pool_row(5, 7, t0 + 50)
    frontier(10, 2 * 10**6)
    refresh()
    check("6 refresh loads nothing from a reset indexer", tvl(), before_reset)
    stale = [r for r in A.status(ctx) if r.get("table") == "!"]
    check("6 status reports STALE", bool(stale), True)
    A.install(ctx)
    check("6 install rebuilt from the new instance", tvl(), (7, 5))
    check("7 verify after rebuild", A.verify(ctx), True)

    if not a.keep:
        x(f"DROP DATABASE IF EXISTS {DB} SYNC")
        x(f"DROP DATABASE IF EXISTS {SRC} SYNC")
    print("FAILED: " + ", ".join(failures) if failures else "all checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
