#!/usr/bin/env python3
"""Tests of the superchain root-side views (clickhouse/sql/views_superchain.sql) on a synthetic
envio database.

    python3 clickhouse/tests/test_superchain_views.py --template <envio database with RootPool>

Uses the same connection variables as analytics.py. Creates `analytics_test_src_sc` (the
template's table structures, a few hand-written rows) and `analytics_test_sc`, installs the
layer, checks root_pools, root_leaf_pools, leaf_pool_root_totals, root_pool_votes, leaf_pool_user_votes,
super_swap_legs, and the root-side votes and emissions of leaf pools in pools, pool_hourly,
pool_daily and chain_daily, and drops both (--keep to leave them). The template may be a shared
or a per-chain envio database: rows get envio's chainId wherever the table has that column, and
every chain gets an envio_chains row (the same frontier, so both modes see the same rows).
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
OWNER_A, OWNER_B = "0x00000000000000000000000000000000000A11cE", "0x0000000000000000000000000000000000000B0b"


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
        if has_chain.get(f"envio_history_{table}") and "chainId" not in values:
            values = {**values, "chainId": int(values["id"].split("-")[0])}
        elif not has_chain.get(f"envio_history_{table}"):
            values = {k: v for k, v in values.items() if k != "chainId"}
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
    chain_cols = [r["name"] for r in ch.rows(f"SELECT name FROM system.columns WHERE database = '{SRC}' AND table = 'envio_chains' ORDER BY position")]
    for c in (10, 252, 34443, 1750):
        vals = {"chain_id": c, "checkpoint_id": 100}
        x(f"INSERT INTO {SRC}.envio_chains ({', '.join(vals)}) VALUES ({', '.join(str(v) for v in vals.values())})")
    has_chain = {t: int(ch.scalar(f"SELECT count() FROM system.columns WHERE database = '{SRC}' AND table = '{t}' AND name = 'chainId'") or 0) > 0
                 for t in TABLES if t in have}
    print(f"template {a.template}: envio_chains columns {chain_cols}; per-chain views: {A.Ctx(ch, a.template, 'x').per_chain()}")

    # leaf pools: the CL leaf (right factory), a pool with the same hash from another factory,
    # and a V2 leaf. Their own vote and emission fields are 0 (not filled since the per-chain
    # flip), except the other-factory pool, which keeps what it stores (it has no root pool).
    for pid, factory, h, votes, em in ((f"252-{LEAF_CL}", CL_FACTORY, HASH, 0, 0), (f"252-{LEAF_CL_OTHER}", OTHER_FACTORY, HASH, 11, 13),
                                       (f"34443-{LEAF_V2}", "0x0000000000000000000000000000000000000001", "", 0, 0)):
        row("Pool", 10, {"id": pid, "chainId": int(pid.split("-")[0]), "poolAddress": pid.split("-")[1], "factoryAddress": factory,
                         "rootPoolMatchingHash": h, "veNFTamountStaked": str(votes), "totalEmissions": str(em),
                         "totalEmissionsUSD": str(em * 2), "totalLiquidityUSD": str(10**18), "totalVolumeUSD": "5",
                         "deployment": "VELODROME", "lastUpdatedTimestamp": ts(T)})
    # root pools (CL, V2, and a V2 root pool no leaf mapped); CL's later version above the frontier
    row("RootPool", 20, {"id": f"10-{CL_ROOT}", "chainId": 10, "rootPoolAddress": CL_ROOT, "leafChainId": 252, "isCL": True,
                         "token0": TOK0, "token1": TOK1, "tickSpacing": 100, "rootFactoryAddress": CL_FACTORY,
                         "rootPoolMatchingHash": HASH, "gaugeAddress": "0x00000000000000000000000000000000000000Ee",
                         "gaugeIsAlive": True, "veNFTamountStaked": "7", "totalEmissions": "3", "totalEmissionsUSD": "6",
                         "numberOfDistributions": 2, "createdBlockNumber": "1", "createdTimestamp": ts(T), "lastUpdatedTimestamp": ts(T)})
    # two hours later the CL root pool gets a distribution and more votes; the leaf pool does not
    # change in that hour, so pool_hourly / pool_daily need a root-only row for it
    row("RootPool", 25, {"id": f"10-{CL_ROOT}", "chainId": 10, "rootPoolAddress": CL_ROOT, "leafChainId": 252, "isCL": True,
                         "token0": TOK0, "token1": TOK1, "tickSpacing": 100, "rootFactoryAddress": CL_FACTORY,
                         "rootPoolMatchingHash": HASH, "gaugeAddress": "0x00000000000000000000000000000000000000Ee",
                         "gaugeIsAlive": True, "veNFTamountStaked": "8", "totalEmissions": "5", "totalEmissionsUSD": "10",
                         "numberOfDistributions": 3, "createdBlockNumber": "1", "createdTimestamp": ts(T),
                         "lastUpdatedTimestamp": ts(T + 7200)})
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
    # mappings the leaf writes: the V2 leaf, and a CL row (as a shared-mode database still has
    # them from the removed flush path) that must not count twice. Written by the leaf chain.
    for rp, leaf_chain, leaf in ((V2_ROOT, 34443, LEAF_V2), (CL_ROOT, 252, LEAF_CL)):
        row("RootPool_LeafPool", 40, {"id": f"10-{leaf_chain}-{rp}-{leaf}", "chainId": leaf_chain, "rootChainId": 10,
                                      "rootPoolAddress": rp, "leafChainId": leaf_chain, "leafPoolAddress": leaf})
    row("RootPoolVote", 50, {"id": f"10-7-{CL_ROOT}", "chainId": 10, "rootPoolAddress": CL_ROOT, "tokenId": 7,
                             "veNFTStateId": "10-7", "veNFTamountStaked": "4", "lastUpdatedTimestamp": ts(T)})
    # a second veNFT of the same owner on the same root pool, one of another owner, one veNFT
    # voting for the orphan root pool (no leaf pool), and a vote that went back to 0
    for token, root, votes in ((8, CL_ROOT, "6"), (9, CL_ROOT, "1"), (8, ORPHAN_ROOT, "2"), (9, V2_ROOT, "0")):
        row("RootPoolVote", 51, {"id": f"10-{token}-{root}", "chainId": 10, "rootPoolAddress": root, "tokenId": token,
                                 "veNFTStateId": f"10-{token}", "veNFTamountStaked": votes, "lastUpdatedTimestamp": ts(T)})
    for token, owner in ((7, OWNER_A), (8, OWNER_A), (9, OWNER_B)):
        row("VeNFTState", 52, {"id": f"10-{token}", "chainId": 10, "tokenId": token, "owner": owner, "isAlive": True,
                               "lastUpdatedTimestamp": ts(T)})
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

    check("root_pools: committed versions only (CL weight 8, not 999 above the frontier)",
          [(r["root_pool_address"], r["votes_raw"]) for r in q("SELECT root_pool_address, toString(votes_raw) AS votes_raw FROM {db}.root_pools ORDER BY 1")],
          sorted([(ORPHAN_ROOT.lower(), "1"), (CL_ROOT.lower(), "8"), (V2_ROOT.lower(), "5")]))
    check("root_leaf_pools: CL by hash + factory (other factory excluded), V2 by the leaf mapping, no orphan",
          [(r["kind"], r["root_pool_address"], r["leaf_chain_id"], r["leaf_pool_address"])
           for r in q("SELECT kind, root_pool_address, leaf_chain_id, leaf_pool_address FROM {db}.root_leaf_pools ORDER BY kind")],
          [("CL", CL_ROOT.lower(), 252, LEAF_CL.lower()), ("V2", V2_ROOT.lower(), 34443, LEAF_V2.lower())])
    check("leaf_pool_root_totals: the root pool's numbers per leaf pool",
          [(r["leaf_pool_address"], r["votes_raw"], r["emissions_raw"], r["emissions_usd_raw"])
           for r in q("SELECT leaf_pool_address, toString(votes_raw) AS votes_raw, toString(emissions_raw) AS emissions_raw, "
                      "toString(emissions_usd_raw) AS emissions_usd_raw FROM {db}.leaf_pool_root_totals ORDER BY 1")],
          sorted([(LEAF_CL.lower(), "8", "5", "10"), (LEAF_V2.lower(), "5", "2", "2")]))
    check("pools: a mapped leaf pool shows its root pool's votes and emissions, an unmapped one its own",
          [(r["pool_address"], r["votes"], r["emissions_total"], r["emissions_usd_total"], r["root_pool_address"])
           for r in q("SELECT pool_address, votes * 1e18 AS votes, emissions_total * 1e18 AS emissions_total, "
                      "emissions_usd_total * 1e18 AS emissions_usd_total, root_pool_address FROM {db}.pools ORDER BY 1")],
          sorted([(LEAF_CL.lower(), 8.0, 5.0, 10.0, CL_ROOT.lower()), (LEAF_CL_OTHER.lower(), 11.0, 13.0, 26.0, None),
                  (LEAF_V2.lower(), 5.0, 2.0, 2.0, V2_ROOT.lower())]))
    h0, h2 = T - T % 3600, T - T % 3600 + 7200
    check("pool_hourly: root emissions and votes per hour, a root-only hour with the leaf state carried",
          [(r["hour"], r["pool_changed"], r["votes"], r["emissions"], r["emissions_usd"], r["tvl_usd"], r["tvl_usd_change"], r["volume_usd"])
           for r in q(f"SELECT toUnixTimestamp(hour) AS hour, pool_changed, votes * 1e18 AS votes, emissions * 1e18 AS emissions, "
                      f"emissions_usd * 1e18 AS emissions_usd, tvl_usd, tvl_usd_change, volume_usd * 1e18 AS volume_usd "
                      f"FROM {{db}}.pool_hourly WHERE pool_address = '{LEAF_CL.lower()}' ORDER BY hour")],
          [(h0, 1, 7.0, 3.0, 6.0, 1.0, 1.0, 5.0), (h2, 0, 8.0, 2.0, 4.0, 1.0, 0.0, 0.0)])
    check("pool_daily: one day, both root changes",
          [(r["pool_changed"], r["votes"], r["emissions"]) for r in
           q(f"SELECT pool_changed, votes * 1e18 AS votes, emissions * 1e18 AS emissions FROM {{db}}.pool_daily "
             f"WHERE pool_address = '{LEAF_CL.lower()}'")],
          [(1, 8.0, 5.0)] if h0 // 86400 == h2 // 86400 else [(1, 7.0, 3.0), (0, 8.0, 2.0)])
    check("chain_hourly: a root-only hour is not an active pool",
          [(r["hour"], r["active_pools"]) for r in
           q("SELECT toUnixTimestamp(hour) AS hour, active_pools FROM {db}.chain_hourly WHERE chain_id = 252 ORDER BY hour")],
          [(h0, 2), (h2, 0)])
    check("root_pool_votes: a veNFT's vote with its leaf pool (none for the orphan root pool)",
          [(r["token_id"], r["root_pool_address"], r["leaf_pool_address"], r["votes_raw"])
           for r in q("SELECT token_id, root_pool_address, leaf_pool_address, toString(votes_raw) AS votes_raw "
                      "FROM {db}.root_pool_votes ORDER BY token_id, root_pool_address")],
          sorted([(7, CL_ROOT.lower(), LEAF_CL.lower(), "4"), (8, CL_ROOT.lower(), LEAF_CL.lower(), "6"),
                  (8, ORPHAN_ROOT.lower(), "", "2"), (9, CL_ROOT.lower(), LEAF_CL.lower(), "1"),
                  (9, V2_ROOT.lower(), LEAF_V2.lower(), "0")]))
    check("leaf_pool_user_votes: per owner and leaf pool, summed over the owner's veNFTs; no zero votes, no orphan",
          [(r["leaf_chain_id"], r["leaf_pool_address"], r["user_address"], r["votes_raw"], r["venfts"])
           for r in q("SELECT leaf_chain_id, leaf_pool_address, user_address, toString(votes_raw) AS votes_raw, venfts "
                      "FROM {db}.leaf_pool_user_votes ORDER BY user_address")],
          sorted([(252, LEAF_CL.lower(), OWNER_A.lower(), "10", 2), (252, LEAF_CL.lower(), OWNER_B.lower(), "1", 1)],
                 key=lambda r: r[2]))
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
