/**
 * NonFungiblePosition rows and ALM wrappers.
 */
import { Check } from "../lib/report";
import { big, lc, sample } from "../lib/util";
import { ALM_WRAPPER_ABI, NFPM_ABI } from "../lib/viewAbis";
import type { CheckContext } from "./context";

/**
 * NFT positions: the set of live NFTs, and per NFT pool / ticks / liquidity / owner / staked flag.
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkPositions(ctx: CheckContext): Promise<void> {
  const c = new Check(
    "position.nft",
    ctx.chainId,
    "NonFungiblePosition rows are exactly the NFTs minted and not burned up to the pinned block; per NFT: pool, tickLower/Upper (from the CL Mint the NFPM made in the mint transaction), liquidity (Σ IncreaseLiquidity − Σ DecreaseLiquidity), owner (last transfer recipient, ignoring transfers to and from the pool's gauge, which the handler does not apply) and isStakedInGauge (held by a gauge now). A sample is checked against positions() / ownerOf() at the pinned block.",
    "Exact.",
  );
  const rows = await ctx.idx.rowsForChain("NonFungiblePosition", ctx.chainId);
  const byKey = new Map<string, Record<string, string | null>>();
  for (const r of rows) byKey.set(`${lc(r.nfpmAddress)}|${r.tokenId}`, r);
  let live = 0;
  for (const [k, n] of ctx.truth.nfts) {
    const r = byKey.get(k);
    const det = { mintTx: n.mintTx, mintBlock: n.mintBlock };
    if (n.burned) {
      if (r)
        c.add({ key: k, indexed: "present", truth: "burned", detail: det }, 3);
      continue;
    }
    live++;
    if (!r) {
      c.add(
        {
          key: k,
          indexed: "missing",
          truth: `live NFT (liquidity ${n.liquidity})`,
          detail: det,
        },
        5,
      );
      continue;
    }
    c.eq(`${k}.pool`, lc(r.pool), n.pool ?? "?", det);
    c.eq(`${k}.tickLower`, r.tickLower, n.tickLower ?? "?", det);
    c.eq(`${k}.tickUpper`, r.tickUpper, n.tickUpper ?? "?", det);
    c.cmp(`${k}.liquidity`, big(r.liquidity), n.liquidity, {}, det);
    c.eq(`${k}.owner`, lc(r.owner), n.ownerExGauge, det);
    c.eq(
      `${k}.isStakedInGauge`,
      r.isStakedInGauge === "t",
      ctx.truth.gauges.has(n.owner),
      det,
    );
  }
  for (const k of byKey.keys())
    if (!ctx.truth.nfts.has(k))
      c.add(
        {
          key: k,
          indexed: "present",
          truth: "never minted by a configured NFPM",
        },
        3,
      );
  if (ctx.rpc) {
    const sp = sample(
      [...ctx.truth.nfts.values()].filter(
        (n) => !n.burned && byKey.has(`${n.nfpm}|${n.tokenId}`),
      ),
      ctx.opts.sample,
      `nftrpc-${ctx.chainId}`,
    );
    const res = await ctx.rpc.calls(
      ctx.truth.pinnedBlock,
      sp.flatMap((n) => [
        { to: n.nfpm, abi: NFPM_ABI, fn: "positions", args: [n.tokenId] },
        { to: n.nfpm, abi: NFPM_ABI, fn: "ownerOf", args: [n.tokenId] },
      ]),
    );
    sp.forEach((n, i) => {
      const pos = res[2 * i] as readonly unknown[] | Error;
      const own = res[2 * i + 1] as string | Error;
      const r = byKey.get(`${n.nfpm}|${n.tokenId}`);
      if (!r || pos instanceof Error || own instanceof Error) return;
      const k = `${n.nfpm}|${n.tokenId}`;
      c.cmp(
        `${k}.liquidity vs positions()`,
        big(r.liquidity),
        pos[7] as bigint,
        {},
        { block: ctx.truth.pinnedBlock },
      );
      const chainOwner = own.toLowerCase();
      if (!ctx.truth.gauges.has(chainOwner))
        c.eq(`${k}.owner vs ownerOf()`, lc(r.owner), chainOwner);
    });
  }
  ctx.results.push(
    c.done(
      `chain ${live} live NFTs (${ctx.truth.nfts.size} minted), indexed ${rows.length}`,
    ),
  );
}

/**
 * ALM wrappers: lpAmount vs Deposit/Withdraw and totalSupply().
 * @param ctx - Check context
 * @returns Promise resolving when done
 */
export async function checkAlmWrappers(ctx: CheckContext): Promise<void> {
  const c = new Check(
    "alm.wrapper",
    ctx.chainId,
    "Each ALM StrategyCreated wrapper has an ALM_LP_Wrapper row for its pool; lpAmount equals Σ Deposit.lpAmount − Σ Withdraw.lpAmount and the wrapper's totalSupply() (Transfer replay; on-chain for a sample).",
    "Exact.",
  );
  if (ctx.truth.wrappers.size === 0) {
    ctx.results.push(c.skip("no ALM wrappers on this chain").done(""));
    return;
  }
  const rows = await ctx.idx.rowsForChain("ALM_LP_Wrapper", ctx.chainId);
  const byAddr = new Map(rows.map((r) => [lc(String(r.id).split("-")[1]), r]));
  const supplies = ctx.rpc
    ? await ctx.rpc.calls(
        ctx.truth.pinnedBlock,
        [...ctx.truth.wrappers.values()].map((w) => ({
          to: w.address,
          abi: ALM_WRAPPER_ABI,
          fn: "totalSupply",
        })),
      )
    : [];
  [...ctx.truth.wrappers.values()].forEach((w, i) => {
    const r = byAddr.get(w.address);
    const det = { tx: w.created.tx, block: w.created.block };
    if (!r) {
      c.add(
        {
          key: w.address,
          indexed: "missing",
          truth: `wrapper for ${w.pool}`,
          detail: det,
        },
        5,
      );
      return;
    }
    c.eq(`${w.address}.pool`, lc(r.pool), w.pool, det);
    c.cmp(
      `${w.address}.lpAmount vs deposits − withdrawals`,
      big(r.lpAmount),
      w.depositLp - w.withdrawLp,
      {},
      det,
    );
    c.cmp(
      `${w.address}.lpAmount vs supply (Transfer replay)`,
      big(r.lpAmount),
      w.totalSupplyFromTransfers,
      {},
      det,
    );
    const s = supplies[i];
    if (s !== undefined && !(s instanceof Error))
      c.cmp(
        `${w.address}.lpAmount vs totalSupply()`,
        big(r.lpAmount),
        s as bigint,
        {},
        det,
      );
  });
  ctx.results.push(
    c.done(
      `${ctx.truth.wrappers.size} wrappers on chain, ${rows.length} indexed`,
    ),
  );
}
