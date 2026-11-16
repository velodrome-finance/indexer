#!/usr/bin/env python3
"""Tests of the superchain root-side views (clickhouse/sql/views_superchain.sql) on a synthetic
envio database.

    python3 clickhouse/tests/test_superchain_views.py --template <envio database with RootPool>

Uses the same connection variables as analytics.py. Creates `analytics_test_src_sc` (the
template's table structures, a few hand-written rows) and `analytics_test_sc`, installs the
layer, checks root_pools, root_leaf_pools, leaf_pool_root_totals, root_pool_votes and
super_swap_legs, and drops both (--keep to leave them).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analytics as A  # noqa: E402

SRC, DB = "analytics_test_src_sc", "analytics_test_sc"
TABLES = ["envio_chains", "envio_checkpoints", "envio_info"] + sorted(
    {f"envio_history_{e.source}" for e in A.ENTITIES}
    | {f"envio_history_{t}" for t in ("RootPool", "RootPool_LeafPool", "RootPoolVote",
                                       "SuperSwapOriginLeg", "SuperSwapDestinationLeg")}
)
T = 1_760_000_000

# checksummed addresses as the indexer stores them
CL_FACTORY = "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F"
OTHER_FACTORY = "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0"
TOK0, TOK1 = "0xFc00000000000000000000000000000000000001", "0xFC00000000000000000000000000000000000006"
CL_ROOT, V2_ROOT, ORPHAN_ROOT = "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74", "0x5b0DF9c40e3b571974167E642c15564C870E2816", "0x00000000000000000000000000000000000000aA"
LEAF_CL, LEAF_CL_OTHER, LEAF_V2 = "0x3BBdBAD64b383885031c4d9C8Afe0C3327d79888", "0x00000000000000000000000000000000000000bB", "0x00000000000000000000000000000000000000cC"
HASH = f"252_{TOK0}_{TOK1}_100"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--template", required=True)
    p.add_argument("--keep", action="store_true")
    a = p.parse_args()
    env = os.environ.get
    ch = A.CH(env("CLICKHOUSE_URL") or env("ENVIO_CLICKHOUSE_HOST"), env("CLICKHOUSE_USER") or env("ENVIO_CLICKHOUSE_USERNAME"),
              env("CLICKHOUSE_PASSWORD") or env("ENVIO_CLICKHOUSE_PASSWORD") or "")
    ctx = A.Ctx(ch, SRC, DB)
    failures: list[str] = []

    def x(sql):
        ch.execute(sql)

    def check(name, got, want):
        ok = got == want
        print(f"{'ok  ' if ok else 'FAIL'} {name}: got {got!r}" + ("" if ok else f", want {want!r}"))
        if not ok:
            failures.append(name)

    def row(table, ckpt, values: dict, change="SET"):
        cols = ", ".join(f"`{k}`" for k in [*values, "envio_checkpoint_id", "envio_change"])
        vals = ", ".join(v if isinstance(v, str) and v.startswith("toDateTime64") else repr(v) if isinstance(v, str) else
                         ("1" if v is True else "0" if v is False else str(v)) for v in values.values())
        x(f"INSERT INTO {SRC}.envio_history_{table} ({cols}) VALUES ({vals}, {ckpt}, '{change}')")

    def ts(sec):
        return f"toDateTime64({sec}, 3, 'UTC')"

    x(f"DROP DATABASE IF EXISTS {DB} SYNC")
    x(f"DROP DATABASE IF EXISTS {SRC} SYNC")
    x(f"CREATE DATABASE {SRC}")
    have = {r["name"] for r in ch.rows(f"SELECT name FROM system.tables WHERE database = '{a.template}'")}
    missing = [t for t in TABLES if ("RootPool" in t or "SuperSwap" in t) and t not in have]
    if missing:
        raise SystemExit(f"template {a.template} lacks {missing}: build it from a branch with the root-side entities")
    for t in TABLES:
        if t in have:
            x(f"CREATE TABLE {SRC}.{t} AS {a.template}.{t}")
    x(f"INSERT INTO {SRC}.envio_info VALUES (1, 'instance-SC')")
    x(f"INSERT INTO {SRC}.envio_chains VALUES (10, 100, 1)")

    # leaf pools: the CL leaf (right factory), a pool with the same hash from another factory,
    # and a V2 leaf; stored fields as the cross-chain handlers fill them today
    for pid, factory, h, votes, em in ((f"252-{LEAF_CL}", CL_FACTORY, HASH, 7, 3), (f"252-{LEAF_CL_OTHER}", OTHER_FACTORY, HASH, 0, 0),
                                       (f"34443-{LEAF_V2}", "0x0000000000000000000000000000000000000001", "", 5, 2)):
        row("Pool", 10, {"id": pid, "chainId": int(pid.split("-")[0]), "poolAddress": pid.split("-")[1], "factoryAddress": factory,
                         "rootPoolMatchingHash": h, "veNFTamountStaked": str(votes), "totalEmissions": str(em),
                         "totalEmissionsUSD": str(em * 2), "lastUpdatedTimestamp": ts(T)})
    # root pools (CL, V2, and a V2 root pool no leaf mapped); CL's later version above the frontier
    row("RootPool", 20, {"id": f"10-{CL_ROOT}", "chainId": 10, "rootPoolAddress": CL_ROOT, "leafChainId": 252, "isCL": True,
                         "token0": TOK0, "token1": TOK1, "tickSpacing": 100, "rootFactoryAddress": CL_FACTORY,
                         "rootPoolMatchingHash": HASH, "gaugeAddress": "0x00000000000000000000000000000000000000Ee",
                         "gaugeIsAlive": True, "veNFTamountStaked": "7", "totalEmissions": "3", "totalEmissionsUSD": "6",
                         "numberOfDistributions": 2, "createdBlockNumber": "1", "createdTimestamp": ts(T), "lastUpdatedTimestamp": ts(T)})
    row("RootPool", 150, {"id": f"10-{CL_ROOT}", "chainId": 10, "rootPoolAddress": CL_ROOT, "leafChainId": 252, "isCL": True,
                          "token0": TOK0, "token1": TOK1, "tickSpacing": 100, "rootFactoryAddress": CL_FACTORY,
                          "rootPoolMatchingHash": HASH, "veNFTamountStaked": "999", "totalEmissions": "3",
                          "totalEmissionsUSD": "6", "numberOfDistributions": 2, "createdBlockNumber": "1",
                          "createdTimestamp": ts(T), "lastUpdatedTimestamp": ts(T)})
    for root, votes, em in ((V2_ROOT, "5", "2"), (ORPHAN_ROOT, "1", "1")):
        row("RootPool", 30, {"id": f"10-{root}", "chainId": 10, "rootPoolAddress": root, "leafChainId": 34443, "isCL": False,
                             "token0": TOK0, "token1": TOK1, "isStable": True, "rootFactoryAddress": OTHER_FACTORY,
                             "gaugeIsAlive": True, "veNFTamountStaked": votes, "totalEmissions": em, "totalEmissionsUSD": em,
                             "numberOfDistributions": 1, "createdBlockNumber": "1", "createdTimestamp": ts(T),
                             "lastUpdatedTimestamp": ts(T)})
    # mappings the leaf writes: the V2 leaf, and a CL row (the flush path) that must not count twice
    for rp, leaf_chain, leaf in ((V2_ROOT, 34443, LEAF_V2), (CL_ROOT, 252, LEAF_CL)):
        row("RootPool_LeafPool", 40, {"id": f"10-{leaf_chain}-{rp}-{leaf}", "rootChainId": 10, "rootPoolAddress": rp,
                                      "leafChainId": leaf_chain, "leafPoolAddress": leaf})
    row("RootPoolVote", 50, {"id": f"10-7-{CL_ROOT}", "chainId": 10, "rootPoolAddress": CL_ROOT, "tokenId": 7,
                             "veNFTStateId": "10-7", "veNFTamountStaked": "4", "lastUpdatedTimestamp": ts(T)})
    # SuperSwaps: tx A dispatched m1, m2 and only m2 reached a destination swap; tx B dispatched
    # m3, m4 and both did (the first in dispatch order wins); tx C's m5 never arrived
    for tx, mid, idx in (("0xA", "0xm1", 0), ("0xA", "0xm2", 1), ("0xB", "0xm3", 0), ("0xB", "0xm4", 1), ("0xC", "0xm5", 0)):
        row("SuperSwapOriginLeg", 60, {"id": f"34443-{mid}", "chainId": 34443, "messageId": mid, "dispatchIndex": idx,
                                       "transactionHash": tx, "destinationChainId": 1750, "sender": "0xS", "recipient": "0xR",
                                       "oUSDTamount": "9", "sourceChainToken": "0xWETH", "sourceChainTokenAmountSwapped": "5",
                                       "timestamp": ts(T)})
    for mid in ("0xm2", "0xm3", "0xm4"):
        row("SuperSwapDestinationLeg", 70, {"id": f"1750-{mid}", "chainId": 1750, "messageId": mid, "transactionHash": f"0xd{mid}",
                                            "destinationChainToken": "0xB", "destinationChainTokenAmountSwapped": "7",
                                            "timestamp": ts(T + 60)})

    A.install(ctx)

    def q(sql):
        return ch.rows(sql.replace("{db}", DB))

    check("root_pools: committed versions only (CL weight 7, not 999 above the frontier)",
          [(r["root_pool_address"], r["votes_raw"]) for r in q("SELECT root_pool_address, toString(votes_raw) AS votes_raw FROM {db}.root_pools ORDER BY 1")],
          sorted([(ORPHAN_ROOT.lower(), "1"), (CL_ROOT.lower(), "7"), (V2_ROOT.lower(), "5")]))
    check("root_leaf_pools: CL by hash + factory (other factory excluded), V2 by the leaf mapping, no orphan",
          [(r["kind"], r["root_pool_address"], r["leaf_chain_id"], r["leaf_pool_address"])
           for r in q("SELECT kind, root_pool_address, leaf_chain_id, leaf_pool_address FROM {db}.root_leaf_pools ORDER BY kind")],
          [("CL", CL_ROOT.lower(), 252, LEAF_CL.lower()), ("V2", V2_ROOT.lower(), 34443, LEAF_V2.lower())])
    check("leaf_pool_root_totals: root numbers next to the stored leaf fields",
          [(r["leaf_pool_address"], r["votes_raw"], r["stored_votes_raw"], r["emissions_raw"], r["stored_emissions_raw"])
           for r in q("SELECT leaf_pool_address, toString(votes_raw) AS votes_raw, toString(stored_votes_raw) AS stored_votes_raw, "
                      "toString(emissions_raw) AS emissions_raw, toString(stored_emissions_raw) AS stored_emissions_raw "
                      "FROM {db}.leaf_pool_root_totals ORDER BY 1")],
          sorted([(LEAF_CL.lower(), "7", "7", "3", "3"), (LEAF_V2.lower(), "5", "5", "2", "2")]))
    check("root_pool_votes: a veNFT's vote with its leaf pool",
          [(r["token_id"], r["leaf_pool_address"], r["votes_raw"])
           for r in q("SELECT token_id, leaf_pool_address, toString(votes_raw) AS votes_raw FROM {db}.root_pool_votes")],
          [(7, LEAF_CL.lower(), "4")])
    check("super_swap_legs: per origin tx the first dispatched message that reached a destination swap",
          [(r["origin_transaction_hash"], r["message_id"], r["destination_chain_token_amount_raw"])
           for r in q("SELECT origin_transaction_hash, message_id, toString(destination_chain_token_amount_raw) AS "
                      "destination_chain_token_amount_raw FROM {db}.super_swap_legs ORDER BY 1")],
          [("0xA", "0xm2", "7"), ("0xB", "0xm3", "7")])

    if not a.keep:
        x(f"DROP DATABASE IF EXISTS {DB} SYNC")
        x(f"DROP DATABASE IF EXISTS {SRC} SYNC")
    print("FAILED: " + ", ".join(failures) if failures else "all checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
