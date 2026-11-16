#!/usr/bin/env python3
"""End-to-end test of the analytics layer's state mechanism on synthetic envio databases.

    python3 clickhouse/tests/test_mechanism.py --template <envio database> [--template-per-chain <envio database>]

Uses the same connection variables as analytics.py. Each scenario creates a fake envio database
(`analytics_test_src*`, with the template's table structures) and an analytics database
(`analytics_test*`), plays the situations the layer must handle, and drops both at the end
(--keep to leave them).

Shared checkpoint sequence (--template: any envio database; the fake source has no entity views,
so the layer runs in shared mode):

  1. rows above the commit frontier are never loaded (in flight, not committed)
  2. a DELETE marker removes the entity; FINAL hides it
  3. rows a crashed batch left above the frontier are trimmed by envio on resume and replaced
     with reused checkpoint ids: the layer never shows the trimmed version
  4. a reorg rollback writes the restored state at a later checkpoint: the layer follows it
  5. the hourly series keeps the last version of each hour
  6. an indexer reset (new envio instance): refreshes stop loading, status reports STALE, and
     install rebuilds from the new history
  7. `verify` agrees with argMax over the history at every step

Per-chain checkpoint sequences (--template-per-chain: an envio database built with
disable_default_cross_chain, so every history table has envio's chainId column; the fake source
gets a view in envio's per-chain style, which is how the layer detects the mode):

  P1. chains at different checkpoints, with overlapping checkpoint ids: each chain's rows are
      loaded up to its own frontier (a row above its chain's frontier but below another chain's
      is not loaded)
  P2. one chain lagging: rows a slow chain commits after a fast chain moved far ahead are loaded
  P3. a chain added later (its sequence starts at 1) is picked up by the running refreshes
  P4. a crash trim, re-run and reorg rollback on one chain only; the other chain is untouched
  P5. hourly series per chain; status shows nothing behind or ahead; verify at every step
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analytics as A  # noqa: E402

SRC, DB = "analytics_test_src", "analytics_test"
SRC_PC, DB_PC = "analytics_test_src_pc", "analytics_test_pc"
POOL, POS = "envio_history_Pool", "envio_history_NonFungiblePosition"
TABLES = ["envio_chains", "envio_checkpoints", "envio_info"] + sorted({f"envio_history_{e.source}" for e in A.ENTITIES})
H = 3600
T0 = 1_760_000_000 // H * H


class Fake:
    """A fake envio database plus the layer context reading it."""

    def __init__(self, ch, template: str, src: str, db: str, failures: list):
        self.ch, self.template, self.src, self.db, self.failures = ch, template, src, db, failures
        self.ctx = A.Ctx(ch, src, db)

    def x(self, sql):
        self.ch.execute(sql)

    def check(self, name, got, want):
        ok = got == want
        print(f"{'ok  ' if ok else 'FAIL'} {name}: got {got!r}" + ("" if ok else f", want {want!r}"))
        if not ok:
            self.failures.append(name)

    def create(self, tables: list[str]):
        self.drop()
        self.x(f"CREATE DATABASE {self.src}")
        have = {r["name"] for r in self.ch.rows(f"SELECT name FROM system.tables WHERE database = '{self.template}'")}
        tables[:] = [t for t in tables if t in have]  # a template from an older schema lacks newer entities
        for t in tables:
            self.x(f"CREATE TABLE {self.src}.{t} AS {self.template}.{t}")

    def drop(self):
        self.x(f"DROP DATABASE IF EXISTS {self.db} SYNC")
        self.x(f"DROP DATABASE IF EXISTS {self.src} SYNC")

    def frontier(self, ckpt, version, chain=1750):
        self.x(f"INSERT INTO {self.src}.envio_chains VALUES ({chain}, {ckpt}, {version})")

    def pool_row(self, ckpt, tvl, ts, change="SET", pid="1750-0xPOOL"):
        chain = int(pid.split("-")[0])
        self.x(f"""INSERT INTO {self.src}.{POOL} SELECT * REPLACE ('{pid}' AS id, '{pid.split('-')[1]}' AS poolAddress, {chain} AS chainId,
              '{tvl}' AS totalLiquidityUSD, '{tvl * 10}' AS totalVolumeUSD, toDateTime64({ts}, 3, 'UTC') AS lastUpdatedTimestamp,
              {ckpt} AS envio_checkpoint_id, '{change}' AS envio_change)
              FROM (SELECT * FROM {self.template}.{POOL} WHERE envio_change = 'SET' LIMIT 1)""")

    def pos_row(self, ckpt, tid, change="SET", chain=1750):
        self.x(f"""INSERT INTO {self.src}.{POS} SELECT * REPLACE ('{chain}-0xNFPM-{tid}' AS id, {chain} AS chainId, {ckpt} AS envio_checkpoint_id,
              '{change}' AS envio_change, '0xNFPM' AS nfpmAddress, '{tid}' AS tokenId) FROM (SELECT * FROM {self.template}.{POS} WHERE envio_change = 'SET' LIMIT 1)""")

    def tvl(self, pid="1750-0xPOOL"):
        r = self.ch.rows(f"SELECT toString(tvl_usd) AS v, _version FROM {self.db}._pool FINAL WHERE id = '{pid}'")
        return (int(r[0]["v"]), int(r[0]["_version"])) if r else None

    def refresh(self):
        A.refresh(self.ctx)

    def verify(self):
        return A.verify(self.ctx)

    def quiet_status(self):
        """(tables with rows behind, tables with versions ahead of the frontier, warnings)."""
        st = A.status(self.ctx)
        behind = sorted(r["table"] for r in st if r.get("source_rows_behind"))
        ahead = sorted(r["table"] for r in st if r.get("ahead_of_frontier"))
        warn = [r["error"] for r in st if r.get("table") == "!"]
        return behind, ahead, warn


def shared(ch, template: str, failures: list, keep: bool, stop_after_install: bool):
    f = Fake(ch, template, SRC, DB, failures)
    tables = list(TABLES)
    f.create(tables)
    f.x(f"INSERT INTO {SRC}.envio_info VALUES (1, 'instance-A')")
    f.pool_row(50, 1, T0 + 10)
    f.pool_row(90, 2, T0 + 20)
    f.pool_row(95, 5, T0 + H + 5)  # next hour
    f.pool_row(120, 3, T0 + H + 30)  # above the frontier: in flight
    f.pos_row(60, 1)
    f.pos_row(96, 1, "DELETE")  # burned
    f.pos_row(70, 2)
    f.frontier(100, 1)

    # --- 1, 2, 5: install (backfill) at frontier 100
    A.install(f.ctx)
    f.check("0 shared sequence detected (no per-chain envio views)", f.ctx.per_chain(), False)
    f.check("1 uncommitted row not loaded (state as of checkpoint 95)", f.tvl(), (5, 95))
    f.check("2 deleted position hidden", [r["token_id"] for r in ch.rows(f"SELECT token_id FROM {DB}._position FINAL ORDER BY 1")], [2])
    hours = ch.rows(f"SELECT toUnixTimestamp(period) - {T0} AS h, toString(tvl_usd) AS v FROM {DB}._pool_hour FINAL ORDER BY period")
    f.check("5 hourly series = last version of each hour", [(int(r["h"]), int(r["v"])) for r in hours], [(0, 2), (H, 5)])
    f.check("7 verify after backfill", f.verify(), True)
    if stop_after_install:
        return

    # --- 1 again through the refresh path: frontier moves to 119, row 120 still in flight
    f.frontier(119, 2)
    f.refresh()
    f.check("1 refresh does not load past the frontier", f.tvl(), (5, 95))

    # --- 3: crash + resume: envio trims rows above the frontier and reuses the checkpoint ids
    f.x(f"ALTER TABLE {SRC}.{POOL} DELETE WHERE envio_checkpoint_id > 119 SETTINGS mutations_sync = 1")
    f.pool_row(120, 4, T0 + H + 40)  # the re-run of the batch, same checkpoint id, other state
    f.frontier(125, 10**6)
    f.refresh()
    f.check("3 trimmed version never shown; re-run version loaded", f.tvl(), (4, 120))

    # --- 4: reorg rollback: the diff restores the pre-reorg state at a new checkpoint
    # (a reorg near the head: the restored state carries a timestamp from the same hour)
    f.pool_row(130, 2, T0 + H + 10)
    f.frontier(130, 10**6 + 1)
    f.refresh()
    f.check("4 rollback diff followed", f.tvl(), (2, 130))

    # --- 5 again: two new hours in one refresh; prev_ chains across them and the stored hour
    f.pool_row(140, 6, T0 + 2 * H + 5)
    f.pool_row(141, 9, T0 + 3 * H + 5)
    f.frontier(141, 10**6 + 2)
    f.refresh()
    rows = ch.rows(f"SELECT toUnixTimestamp(period) - {T0} AS h, toString(tvl_usd) AS v, toString(prev_tvl_usd) AS p "
                   f"FROM {DB}._pool_hour FINAL ORDER BY period")
    f.check("5 hourly prev_ values chain across refreshes",
            [(int(r["h"]), int(r["v"]), int(r["p"])) for r in rows], [(0, 2, 0), (H, 2, 2), (2 * H, 6, 2), (3 * H, 9, 6)])
    f.check("7 status: nothing behind or ahead", f.quiet_status()[:2], ([], []))
    f.check("7 verify after refreshes", f.verify(), True)

    # --- 6: indexer reset: envio empties its database and starts a new instance
    before_reset = f.tvl()
    for t in tables:
        f.x(f"TRUNCATE TABLE {SRC}.{t}")
    f.x(f"INSERT INTO {SRC}.envio_info VALUES (1, 'instance-B')")
    f.pool_row(5, 7, T0 + 50)
    f.frontier(10, 2 * 10**6)
    f.refresh()
    f.check("6 refresh loads nothing from a reset indexer", f.tvl(), before_reset)
    f.check("6 status reports STALE", any("STALE" in w for w in f.quiet_status()[2]), True)
    A.install(f.ctx)
    f.check("6 install rebuilt from the new instance", f.tvl(), (7, 5))
    f.check("7 verify after rebuild", f.verify(), True)
    if not keep:
        f.drop()


def per_chain(ch, template: str, failures: list, keep: bool):
    A_, B_, C_ = "1750-0xPOOL", "34443-0xPOOL", "1135-0xPOOL"
    f = Fake(ch, template, SRC_PC, DB_PC, failures)
    tables = list(TABLES)
    f.create(tables)
    missing = [t for t in tables if t.startswith("envio_history_")
               and not ch.rows(f"SELECT 1 FROM system.columns WHERE database = '{SRC_PC}' AND table = '{t}' AND name = 'chainId'")]
    if missing:
        raise SystemExit(f"--template-per-chain {template} is not a per-chain envio database (no chainId in {missing[:3]})")
    # envio's per-chain views select committed rows with envio_frontier[chainId]; the layer reads
    # the mode off them, so the fake source gets one in that style
    f.x(f"CREATE VIEW {SRC_PC}.Pool AS WITH (SELECT map(toInt32(0), toUInt64(0))) AS envio_frontier "
        f"SELECT envio_frontier[toInt32(0)] AS checkpoint")
    f.x(f"INSERT INTO {SRC_PC}.envio_info VALUES (1, 'instance-P')")

    # --- P1: two chains, overlapping checkpoint ids, different frontiers
    f.pool_row(50, 1, T0 + 10, pid=A_)
    f.pool_row(90, 2, T0 + 20, pid=A_)
    f.pool_row(120, 3, T0 + 30, pid=A_)  # above A's frontier: in flight (committed once A reaches 150)
    f.pool_row(5, 10, T0 + 15, pid=B_)  # same checkpoint ids as A's, other sequence
    f.pool_row(8, 11, T0 + 25, pid=B_)
    f.pool_row(20, 99, T0 + H + 5, pid=B_)  # above B's frontier (10), below A's (100): in flight
    f.pos_row(5, 1, chain=1750)
    f.pos_row(5, 1, chain=34443)  # same checkpoint, other chain
    f.pos_row(7, 1, "DELETE", chain=34443)  # burned on B only
    f.frontier(100, 1, chain=1750)
    f.frontier(10, 1, chain=34443)
    A.install(f.ctx)
    f.check("P0 per-chain sequence detected from envio's view", f.ctx.per_chain(), True)
    f.check("P1 chain A loaded to its own frontier", f.tvl(A_), (2, 90))
    f.check("P1 chain B loaded to its own frontier (row 20 < A's frontier not loaded)", f.tvl(B_), (11, 8))
    f.check("P1 overlapping checkpoint ids: per-chain delete", [r["id"] for r in ch.rows(
        f"SELECT id FROM {DB_PC}._position FINAL ORDER BY id")], ["1750-0xNFPM-1"])
    f.check("P1 verify", f.verify(), True)

    # --- P2: A runs far ahead, then B commits more rows below A's checkpoints
    f.pool_row(150, 4, T0 + 2 * H + 5, pid=A_)
    f.frontier(150, 2, chain=1750)
    f.refresh()
    f.check("P2 fast chain refreshed", f.tvl(A_), (4, 150))
    f.check("P2 slow chain still at its frontier", f.tvl(B_), (11, 8))
    f.pool_row(22, 12, T0 + H + 20, pid=B_)
    f.frontier(25, 2, chain=34443)
    f.refresh()
    f.check("P2 lagging chain's new rows loaded although A is at 150", f.tvl(B_), (12, 22))
    f.check("P2 status: nothing behind or ahead", f.quiet_status()[:2], ([], []))
    f.check("P2 verify", f.verify(), True)

    # --- P3: a chain added later (envio start --chain): its sequence starts at 1
    f.pool_row(1, 30, T0 + 40, pid=C_)
    f.pool_row(3, 31, T0 + H + 40, pid=C_)
    f.frontier(3, 3, chain=1135)
    f.refresh()
    f.check("P3 added chain picked up by the refresh", f.tvl(C_), (31, 3))
    f.check("P3 other chains untouched", (f.tvl(A_), f.tvl(B_)), ((4, 150), (12, 22)))
    f.check("P3 status: nothing behind or ahead", f.quiet_status()[:2], ([], []))
    f.check("P3 verify", f.verify(), True)

    # --- P4: crash trim + re-run, then a reorg rollback, on chain B only
    f.pool_row(30, 13, T0 + H + 30, pid=B_)  # in flight
    f.refresh()
    f.check("P4 B's in-flight row not loaded", f.tvl(B_), (12, 22))
    f.x(f"ALTER TABLE {SRC_PC}.{POOL} DELETE WHERE chainId = 34443 AND envio_checkpoint_id > 25 SETTINGS mutations_sync = 1")
    f.pool_row(30, 14, T0 + H + 35, pid=B_)  # re-run, same checkpoint id
    f.frontier(30, 3, chain=34443)
    f.refresh()
    f.check("P4 B's trimmed version never shown; re-run loaded", f.tvl(B_), (14, 30))
    f.pool_row(31, 12, T0 + H + 25, pid=B_)  # rollback diff restores the earlier state
    f.frontier(31, 4, chain=34443)
    f.refresh()
    f.check("P4 B's rollback diff followed", f.tvl(B_), (12, 31))
    f.check("P4 A and C untouched", (f.tvl(A_), f.tvl(C_)), ((4, 150), (31, 3)))

    # --- P5: hourly series per chain
    hours = ch.rows(f"SELECT chain_id, toUnixTimestamp(period) - {T0} AS h, toString(tvl_usd) AS v, toString(prev_tvl_usd) AS p "
                    f"FROM {DB_PC}._pool_hour FINAL ORDER BY chain_id, period")
    f.check("P5 hourly series per chain", [(int(r["chain_id"]), int(r["h"]), int(r["v"]), int(r["p"])) for r in hours],
            [(1135, 0, 30, 0), (1135, H, 31, 30), (1750, 0, 3, 0), (1750, 2 * H, 4, 3), (34443, 0, 11, 0), (34443, H, 12, 11)])
    f.check("P5 status: nothing behind or ahead", f.quiet_status()[:2], ([], []))
    f.check("P5 verify", f.verify(), True)
    if not keep:
        f.drop()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--template", required=True, help="any envio database (shared scenario)")
    p.add_argument("--template-per-chain", help="an envio database built per-chain (per-chain scenario)")
    p.add_argument("--keep", action="store_true")
    p.add_argument("--stop-after-install", action="store_true", help="debug: stop after the first install")
    a = p.parse_args()
    env = os.environ.get
    ch = A.CH(env("CLICKHOUSE_URL") or env("ENVIO_CLICKHOUSE_HOST"), env("CLICKHOUSE_USER") or env("ENVIO_CLICKHOUSE_USERNAME"),
              env("CLICKHOUSE_PASSWORD") or env("ENVIO_CLICKHOUSE_PASSWORD") or "")
    failures: list[str] = []
    print("== shared checkpoint sequence")
    shared(ch, a.template, failures, a.keep, a.stop_after_install)
    if a.template_per_chain and not a.stop_after_install:
        print("== per-chain checkpoint sequences")
        per_chain(ch, a.template_per_chain, failures, a.keep)
    elif not a.template_per_chain:
        print("(per-chain scenario skipped: no --template-per-chain)")
    print("FAILED: " + ", ".join(failures) if failures else "all checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
