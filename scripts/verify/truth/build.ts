/**
 * Builds a chain's ground truth from raw logs.
 *
 * Phase 1 streams the static contracts of config.yaml (factories, voters,
 * NFPMs, ...) to discover what the protocol created. Phase 2 streams each
 * family of discovered contracts (V2 pools, CL pools, gauges, voting rewards,
 * ALM wrappers) on its own, in block/log order, and folds every log into
 * per-contract and per-user aggregates. Cross-family joins (NFT -> pool) are
 * resolved afterwards by transaction hash.
 */
import {
  type AbiRegistry,
  type Decoded,
  type EventDef,
  decodeLog,
} from "../lib/abi";
import type { ChainSpec } from "../lib/config";
import { ROLE, addressesWithRole, staticContracts } from "../lib/config";
import {
  type HsLog,
  type HsPage,
  LOG_FIELDS,
  hypersyncBlockTimestamp,
  hypersyncStreamParallel,
  hypersyncUrl,
  parseHsTimestamp,
} from "../lib/hypersync";
import type {
  Addr,
  ChainTruth,
  GaugeTruth,
  LogRef,
  NftTruth,
  PoolTruth,
  UserPoolTruth,
  VotingRewardTruth,
  WrapperTruth,
} from "./types";
import { userKey } from "./types";

const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS_ONE = "0x0000000000000000000000000000000000000001";

export interface BuildOptions {
  /** Inclusive last block. */
  pinnedBlock: number;
  segments?: number;
  log?: (msg: string) => void;
}

interface Ctx {
  chain: ChainSpec;
  reg: AbiRegistry;
  url: string;
  truth: ChainTruth;
  log: (m: string) => void;
  segments: number;
  blockTs: Map<number, number>;
}

function ref(l: HsLog): LogRef {
  return {
    block: l.block_number,
    logIndex: l.log_index,
    tx: l.transaction_hash ?? "",
  };
}

function bump(m: Map<string, number>, k: string, n = 1): void {
  m.set(k, (m.get(k) ?? 0) + n);
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function newPool(
  address: Addr,
  kind: "v2" | "cl",
  d: Decoded,
  factory: Addr,
  l: HsLog,
): PoolTruth {
  return {
    address,
    kind,
    factory,
    token0: d.token0 as string,
    token1: d.token1 as string,
    stable: kind === "v2" ? (d.stable as boolean) : false,
    tickSpacing: kind === "cl" ? Number(d.tickSpacing as bigint) : 0,
    created: ref(l),
    counts: new Map(),
    swaps: 0,
    vol0: 0n,
    vol1: 0n,
    activeHours: new Set(),
    fees0: 0n,
    fees1: 0n,
    reserve0: 0n,
    reserve1: 0n,
    lpSupply: 0n,
    mint0: 0n,
    mint1: 0n,
    burn0: 0n,
    burn1: 0n,
    claimStaked0: 0n,
    claimStaked1: 0n,
    claimUnstaked0: 0n,
    claimUnstaked1: 0n,
    sqrtPriceX96: 0n,
    tick: 0,
    initialized: false,
    positions: new Map(),
    sumMint0: 0n,
    sumMint1: 0n,
    sumBurn0: 0n,
    sumBurn1: 0n,
    sumSwap0: 0n,
    sumSwap1: 0n,
    sumCollect0: 0n,
    sumCollect1: 0n,
    sumCollectFees0: 0n,
    sumCollectFees1: 0n,
    flashPaid0: 0n,
    flashPaid1: 0n,
    flashes: 0,
    collectedFees0: 0n,
    collectedFees1: 0n,
    pendingPrincipal: new Map(),
  };
}

function user(t: ChainTruth, u: Addr, pool: Addr): UserPoolTruth {
  const k = userKey(u, pool);
  let x = t.users.get(k);
  if (!x) {
    x = {
      user: u,
      pool,
      swaps: 0,
      vol0: 0n,
      vol1: 0n,
      fees0: 0n,
      fees1: 0n,
      lpBalance: 0n,
      added0: 0n,
      added1: 0n,
      removed0: 0n,
      removed1: 0n,
      staked: 0n,
      gaugeDeposits: 0,
      gaugeWithdrawals: 0,
      gaugeClaims: 0,
      gaugeRewardsClaimed: 0n,
      almLp: 0n,
    };
    t.users.set(k, x);
  }
  return x;
}

/**
 * Streams logs of a set of addresses in order and hands each decoded log to `fn`.
 * @param ctx - Build context
 * @param addresses - Addresses to stream (chunked into one selection per 2,000)
 * @param withTx - Include transaction `from`
 * @param fn - Callback per log (logs whose topic0 is unknown get def = undefined)
 * @param resolve - Maps a log to its event definition
 * @returns Promise resolving when done
 */
async function streamAddresses(
  ctx: Ctx,
  label: string,
  addresses: Addr[],
  withTx: boolean,
  resolve: (l: HsLog) => EventDef | undefined,
  fn: (
    l: HsLog,
    def: EventDef,
    d: Decoded,
    from: string | undefined,
    ts: number,
  ) => void,
): Promise<void> {
  if (addresses.length === 0) return;
  const t0 = Date.now();
  let n = 0;
  const selections = [];
  for (let i = 0; i < addresses.length; i += 2000)
    selections.push({ address: addresses.slice(i, i + 2000) });
  await hypersyncStreamParallel(
    ctx.url,
    {
      from_block: ctx.truth.fromBlock,
      to_block: ctx.truth.pinnedBlock + 1,
      logs: selections,
      field_selection: {
        log: LOG_FIELDS,
        block: ["number", "timestamp"],
        transaction: withTx ? ["hash", "from"] : ["hash"],
      },
    },
    (p: HsPage) => {
      for (const b of p.blocks)
        ctx.blockTs.set(b.number, parseHsTimestamp(b.timestamp));
      const txFrom = new Map<string, string>();
      if (withTx)
        for (const t of p.transactions)
          if (t.from) txFrom.set(t.hash, t.from.toLowerCase());
      p.logs.sort(
        (a, b) => a.block_number - b.block_number || a.log_index - b.log_index,
      );
      for (const l of p.logs) {
        const def = resolve(l);
        if (!def) continue;
        let d: Decoded;
        try {
          d = decodeLog(def, l);
        } catch (e) {
          ctx.truth.notes.push(
            `decode failed ${def.contract}.${def.name} at ${l.block_number}/${l.log_index}: ${(e as Error).message}`,
          );
          continue;
        }
        const ts = ctx.blockTs.get(l.block_number) ?? 0;
        fn(
          l,
          def,
          d,
          l.transaction_hash ? txFrom.get(l.transaction_hash) : undefined,
          ts,
        );
        n++;
      }
      // Timestamps are only needed while the page is processed.
      if (ctx.blockTs.size > 200_000) ctx.blockTs.clear();
    },
    ctx.segments,
  );
  ctx.truth.stats.logs += n;
  ctx.log(
    `  ${label}: ${addresses.length} addresses, ${n} logs, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}

/**
 * Builds the ground truth of one chain up to `pinnedBlock` (inclusive).
 * @param chain - Chain spec from config.yaml
 * @param reg - ABI registry
 * @param opts - Pinned block and options
 * @returns Chain truth
 */
export async function buildChainTruth(
  chain: ChainSpec,
  reg: AbiRegistry,
  opts: BuildOptions,
): Promise<ChainTruth> {
  const t0 = Date.now();
  const truth: ChainTruth = {
    chainId: chain.id,
    fromBlock: chain.startBlock,
    pinnedBlock: opts.pinnedBlock,
    pinnedTimestamp: 0,
    pools: new Map(),
    gauges: new Map(),
    votingRewards: new Map(),
    wrappers: new Map(),
    nfts: new Map(),
    users: new Map(),
    tokens: new Set(),
    whitelist: new Map(),
    eventCounts: new Map(),
    unregisteredEventCounts: new Map(),
    tickSpacingFees: new Map(),
    v2CustomFees: new Map(),
    notes: [],
    stats: { logs: 0, seconds: 0 },
  };
  const ctx: Ctx = {
    chain,
    reg,
    url: hypersyncUrl(chain.id, chain.hypersyncUrl),
    truth,
    log: opts.log ?? (() => {}),
    segments: opts.segments ?? 6,
    blockTs: new Map(),
  };

  truth.pinnedTimestamp = await hypersyncBlockTimestamp(
    ctx.url,
    opts.pinnedBlock,
  );

  // ---------------- Phase 1: static contracts ----------------
  const statics = staticContracts(chain);
  const addrContract = new Map<Addr, string>();
  for (const [name, addrs] of statics)
    for (const a of addrs) addrContract.set(a, name);
  const topicMaps = new Map<string, Map<string, EventDef>>();
  const tm = (c: string) => {
    let m = topicMaps.get(c);
    if (!m) {
      m = reg.topicMap(c);
      topicMaps.set(c, m);
    }
    return m;
  };
  const nfpms = new Set(addressesWithRole(chain, ROLE.nfpm));
  const clFactories = new Set(addressesWithRole(chain, ROLE.clFactory));
  const v2Factories = new Set(addressesWithRole(chain, ROLE.v2Factory));
  /** tokenId mints by NFPM: `${nfpm}|${tokenId}` resolved later from CL Mint by tx. */
  const nftFirstIncrease = new Map<
    string,
    { tx: string; liquidity: bigint; logIndex: number }
  >();

  await streamAddresses(
    ctx,
    "static contracts",
    [...addrContract.keys()],
    false,
    (l) => tm(addrContract.get(l.address) ?? "").get(l.topic0 ?? ""),
    (l, def, d) => {
      if (def.configured)
        bump(truth.eventCounts, `${def.contract}.${def.name}`);
      const c = def.contract;
      const e = def.name;
      if ((ROLE.v2Factory(c) || ROLE.clFactory(c)) && e === "PoolCreated") {
        const pool = (d.pool as string).toLowerCase();
        // Factories without a `stable` param (Aero stable / volatile factories) imply it by name.
        const dd =
          d.stable === undefined ? { ...d, stable: /Stable/.test(c) } : d;
        const p = newPool(
          pool,
          ROLE.clFactory(c) ? "cl" : "v2",
          dd,
          l.address,
          l,
        );
        truth.pools.set(pool, p);
        truth.tokens.add(p.token0);
        truth.tokens.add(p.token1);
      } else if (ROLE.clFactory(c) && e === "TickSpacingEnabled") {
        truth.tickSpacingFees.set(
          Number(d.tickSpacing as bigint),
          Number(d.fee as bigint),
        );
      } else if (ROLE.v2Factory(c) && e === "SetCustomFee") {
        truth.v2CustomFees.set(
          (d.pool as string).toLowerCase(),
          d.fee as bigint,
        );
      } else if (ROLE.voter(c) && e === "GaugeCreated") {
        const pf = (d.poolFactory as string).toLowerCase();
        const kind = clFactories.has(pf)
          ? "cl"
          : v2Factories.has(pf)
            ? "v2"
            : "unregistered";
        const g: GaugeTruth = {
          address: (d.gauge as string).toLowerCase(),
          pool: (d.pool as string).toLowerCase(),
          kind,
          poolFactory: pf,
          feeVotingReward: (d.feeVotingReward as string).toLowerCase(),
          bribeVotingReward: (
            (d.bribeVotingReward ?? d.incentiveVotingReward) as string
          ).toLowerCase(),
          created: ref(l),
          voter: l.address,
          alive: true,
          counts: new Map(),
          deposits: 0,
          withdrawals: 0,
          claims: 0,
          rewardsClaimed: 0n,
          netStakeFromEvents: 0n,
          notified: 0n,
          notifies: 0,
          claimFees0: 0n,
          claimFees1: 0n,
        };
        truth.gauges.set(g.address, g);
        const bribeContract =
          c === "Voter"
            ? "BribesVotingReward"
            : "SuperchainIncentiveVotingReward";
        const mk = (
          a: Addr,
          kind: "fee" | "bribe",
          contract: string,
        ): VotingRewardTruth => ({
          address: a,
          pool: g.pool,
          kind,
          contract,
          claims: 0,
          claimed: new Map(),
          counts: new Map(),
        });
        truth.votingRewards.set(
          g.feeVotingReward,
          mk(g.feeVotingReward, "fee", "FeesVotingReward"),
        );
        truth.votingRewards.set(
          g.bribeVotingReward,
          mk(g.bribeVotingReward, "bribe", bribeContract),
        );
      } else if (
        ROLE.voter(c) &&
        (e === "GaugeKilled" || e === "GaugeRevived")
      ) {
        const g = truth.gauges.get((d.gauge as string).toLowerCase());
        if (g) g.alive = e === "GaugeRevived";
      } else if (ROLE.voter(c) && e === "WhitelistToken") {
        truth.whitelist.set(
          (d.token as string).toLowerCase(),
          d._bool as boolean,
        );
      } else if (
        (c === "ALMDeployFactoryV1" || c === "ALMDeployFactoryV2") &&
        e === "StrategyCreated"
      ) {
        const params = d.params as unknown as Record<string, unknown>;
        const wrapper = String(params.lpWrapper ?? "").toLowerCase();
        const pool = String(params.pool ?? "").toLowerCase();
        if (wrapper) {
          truth.wrappers.set(wrapper, {
            address: wrapper,
            contract:
              c === "ALMDeployFactoryV1" ? "ALMLPWrapperV1" : "ALMLPWrapperV2",
            pool,
            created: ref(l),
            depositLp: 0n,
            withdrawLp: 0n,
            totalSupplyFromTransfers: 0n,
            balances: new Map(),
            counts: new Map(),
          });
        }
      } else if (ROLE.nfpm(c)) {
        const id = d.tokenId as bigint;
        const key = `${l.address}|${id}`;
        if (e === "Transfer") {
          const from = d.from as string;
          const to = d.to as string;
          let n = truth.nfts.get(key);
          if (from === ZERO) {
            n = {
              nfpm: l.address,
              tokenId: id,
              owner: to,
              ownerExGauge: to,
              burned: false,
              liquidity: 0n,
              mintTx: l.transaction_hash ?? "",
              mintLogIndex: l.log_index,
              mintBlock: l.block_number,
            };
            truth.nfts.set(key, n);
          } else if (n) {
            n.owner = to;
            if (to === ZERO) n.burned = true;
            if (!truth.gauges.has(to) && !truth.gauges.has(from))
              n.ownerExGauge = to;
          }
        } else if (e === "IncreaseLiquidity") {
          const n = truth.nfts.get(key);
          if (n) n.liquidity += d.liquidity as bigint;
          if (!nftFirstIncrease.has(key)) {
            nftFirstIncrease.set(key, {
              tx: l.transaction_hash ?? "",
              liquidity: d.liquidity as bigint,
              logIndex: l.log_index,
            });
          }
        } else if (e === "DecreaseLiquidity") {
          const n = truth.nfts.get(key);
          if (n) n.liquidity -= d.liquidity as bigint;
        }
      }
    },
  );

  // Config-derived registration expectations.
  const gaugeOfPool = new Map<Addr, GaugeTruth[]>();
  for (const g of truth.gauges.values()) {
    const list = gaugeOfPool.get(g.pool) ?? [];
    list.push(g);
    gaugeOfPool.set(g.pool, list);
  }

  // ---------------- Phase 2a: V2 pools ----------------
  const v2Pools = [...truth.pools.values()].filter((p) => p.kind === "v2");
  const clPools = [...truth.pools.values()].filter((p) => p.kind === "cl");
  const poolTopics = tm("Pool");
  /** Per pool: LP sender into the pool within the current tx (for Burn attribution). */
  const lpIntoPool = new Map<Addr, { tx: string; from: Addr }>();
  const lpMintTo = new Map<Addr, { tx: string; to: Addr[] }>();
  const lastFees = new Map<Addr, { tx: string; a0: bigint; a1: bigint }>();
  await streamAddresses(
    ctx,
    "V2 pools",
    v2Pools.map((p) => p.address),
    true,
    (l) => poolTopics.get(l.topic0 ?? ""),
    (l, def, d, from, ts) => {
      const p = truth.pools.get(l.address);
      if (!p) return;
      const e = def.name;
      if (def.configured) {
        bump(truth.eventCounts, `Pool.${e}`);
        bump(p.counts, e);
        // A plain LP transfer (not a mint or burn) does not update the Pool row.
        if (e !== "Transfer" || d.from === ZERO || d.to === ZERO)
          p.activeHours.add(Math.floor(ts / 3600));
        p.lastLog = ref(l);
      }
      const tx = l.transaction_hash ?? "";
      if (e === "Swap") {
        const v0 = (d.amount0In as bigint) + (d.amount0Out as bigint);
        const v1 = (d.amount1In as bigint) + (d.amount1Out as bigint);
        p.swaps++;
        p.vol0 += v0;
        p.vol1 += v1;
        if (from) {
          const u = user(truth, from, p.address);
          u.swaps++;
          u.vol0 += v0;
          u.vol1 += v1;
        }
        // Effective fee rate: the pool emits Fees(input-side amount) before Swap in the same tx.
        const f = lastFees.get(p.address);
        const in0 = d.amount0In as bigint;
        const in1 = d.amount1In as bigint;
        if (f && f.tx === tx && in0 > 0n !== in1 > 0n) {
          const amountIn = in0 > 0n ? in0 : in1;
          const fee = in0 > 0n ? f.a0 : f.a1;
          if (amountIn >= 10_000_000n) {
            p.v2EffectiveFee = {
              bps: (fee * 20000n + amountIn) / (2n * amountIn),
              block: l.block_number,
              tx,
            };
          }
        }
      } else if (e === "Fees") {
        p.fees0 += d.amount0 as bigint;
        p.fees1 += d.amount1 as bigint;
        lastFees.set(p.address, {
          tx,
          a0: d.amount0 as bigint,
          a1: d.amount1 as bigint,
        });
        if (from) {
          const u = user(truth, from, p.address);
          u.fees0 += d.amount0 as bigint;
          u.fees1 += d.amount1 as bigint;
        }
      } else if (e === "Sync") {
        p.reserve0 = d.reserve0 as bigint;
        p.reserve1 = d.reserve1 as bigint;
        p.lastSync = ref(l);
      } else if (e === "Transfer") {
        const f = d.from as string;
        const to = d.to as string;
        const v = d.value as bigint;
        if (f === ZERO) p.lpSupply += v;
        else user(truth, f, p.address).lpBalance -= v;
        if (to === ZERO) p.lpSupply -= v;
        else user(truth, to, p.address).lpBalance += v;
        if (to === p.address && f !== ZERO)
          lpIntoPool.set(p.address, { tx, from: f });
        if (f === ZERO && v > 0n) {
          const cur = lpMintTo.get(p.address);
          if (cur && cur.tx === tx) cur.to.push(to);
          else lpMintTo.set(p.address, { tx, to: [to] });
        }
      } else if (e === "Mint" || e === "MintWithRecipient") {
        p.mint0 += d.amount0 as bigint;
        p.mint1 += d.amount1 as bigint;
        let recipient: string | undefined;
        if (e === "MintWithRecipient") recipient = d.to as string;
        else {
          const m = lpMintTo.get(p.address);
          if (m && m.tx === tx) {
            const real = m.to.filter((a) => a !== ADDRESS_ONE);
            recipient =
              real.length > 0 ? real[real.length - 1] : m.to[m.to.length - 1];
          }
        }
        if (recipient) {
          const u = user(truth, recipient, p.address);
          u.added0 += d.amount0 as bigint;
          u.added1 += d.amount1 as bigint;
        }
      } else if (e === "Burn") {
        p.burn0 += d.amount0 as bigint;
        p.burn1 += d.amount1 as bigint;
        const into = lpIntoPool.get(p.address);
        const lp = into && into.tx === tx ? into.from : (d.to as string);
        const u = user(truth, lp, p.address);
        u.removed0 += d.amount0 as bigint;
        u.removed1 += d.amount1 as bigint;
      } else if (e === "Claim") {
        const sender = d.sender as string;
        const isGauge = (gaugeOfPool.get(p.address) ?? []).some(
          (g) => g.address === sender && g.created.block <= l.block_number,
        );
        if (isGauge) {
          p.claimStaked0 += d.amount0 as bigint;
          p.claimStaked1 += d.amount1 as bigint;
        } else {
          p.claimUnstaked0 += d.amount0 as bigint;
          p.claimUnstaked1 += d.amount1 as bigint;
        }
      }
    },
  );

  // ---------------- Phase 2b: CL pools ----------------
  const clTopics = tm("CLPool");
  /** Mints owned by an NFPM, by tx, for the tokenId -> pool join. */
  const nfpmMintsByTx = new Map<
    string,
    {
      pool: Addr;
      tickLower: number;
      tickUpper: number;
      liquidity: bigint;
      logIndex: number;
      nfpm: Addr;
    }[]
  >();
  await streamAddresses(
    ctx,
    "CL pools",
    clPools.map((p) => p.address),
    true,
    (l) => clTopics.get(l.topic0 ?? ""),
    (l, def, d, from, ts) => {
      const p = truth.pools.get(l.address);
      if (!p) return;
      const e = def.name;
      if (def.configured) {
        bump(truth.eventCounts, `CLPool.${e}`);
        bump(p.counts, e);
        if (e !== "Initialize") p.activeHours.add(Math.floor(ts / 3600));
        p.lastLog = ref(l);
      }
      if (e === "Swap") {
        const a0 = d.amount0 as bigint;
        const a1 = d.amount1 as bigint;
        p.swaps++;
        p.vol0 += abs(a0);
        p.vol1 += abs(a1);
        p.sumSwap0 += a0;
        p.sumSwap1 += a1;
        p.sqrtPriceX96 = d.sqrtPriceX96 as bigint;
        p.tick = Number(d.tick as bigint);
        p.lastSwapLiquidity = d.liquidity as bigint;
        p.lastSwap = ref(l);
        if (from) {
          const u = user(truth, from, p.address);
          u.swaps++;
          u.vol0 += abs(a0);
          u.vol1 += abs(a1);
        }
      } else if (e === "Initialize") {
        p.sqrtPriceX96 = d.sqrtPriceX96 as bigint;
        p.tick = Number(d.tick as bigint);
        p.initialized = true;
      } else if (e === "Mint" || e === "Burn") {
        const owner = d.owner as string;
        const tl = Number(d.tickLower as bigint);
        const tu = Number(d.tickUpper as bigint);
        const key = `${owner}|${tl}|${tu}`;
        const amt = d.amount as bigint;
        const a0 = d.amount0 as bigint;
        const a1 = d.amount1 as bigint;
        if (e === "Mint") {
          p.positions.set(key, (p.positions.get(key) ?? 0n) + amt);
          p.sumMint0 += a0;
          p.sumMint1 += a1;
          if (nfpms.has(owner)) {
            const tx = l.transaction_hash ?? "";
            const list = nfpmMintsByTx.get(tx) ?? [];
            list.push({
              pool: p.address,
              tickLower: tl,
              tickUpper: tu,
              liquidity: amt,
              logIndex: l.log_index,
              nfpm: owner,
            });
            nfpmMintsByTx.set(tx, list);
          }
        } else {
          p.positions.set(key, (p.positions.get(key) ?? 0n) - amt);
          p.sumBurn0 += a0;
          p.sumBurn1 += a1;
          const pp = p.pendingPrincipal.get(key) ?? [0n, 0n];
          p.pendingPrincipal.set(key, [pp[0] + a0, pp[1] + a1]);
        }
        if (p.positions.get(key) === 0n) p.positions.delete(key);
      } else if (e === "Collect") {
        const owner = d.owner as string;
        const key = `${owner}|${Number(d.tickLower as bigint)}|${Number(d.tickUpper as bigint)}`;
        const a0 = d.amount0 as bigint;
        const a1 = d.amount1 as bigint;
        p.sumCollect0 += a0;
        p.sumCollect1 += a1;
        const pp = p.pendingPrincipal.get(key) ?? [0n, 0n];
        const f0 = a0 >= pp[0] ? a0 - pp[0] : 0n;
        const f1 = a1 >= pp[1] ? a1 - pp[1] : 0n;
        const r0 = a0 >= pp[0] ? 0n : pp[0] - a0;
        const r1 = a1 >= pp[1] ? 0n : pp[1] - a1;
        p.collectedFees0 += f0;
        p.collectedFees1 += f1;
        if (r0 === 0n && r1 === 0n) p.pendingPrincipal.delete(key);
        else p.pendingPrincipal.set(key, [r0, r1]);
      } else if (e === "CollectFees") {
        p.sumCollectFees0 += d.amount0 as bigint;
        p.sumCollectFees1 += d.amount1 as bigint;
      } else if (e === "Flash") {
        p.flashes++;
        p.flashPaid0 += d.paid0 as bigint;
        p.flashPaid1 += d.paid1 as bigint;
      }
    },
  );

  // NFT -> pool / ticks join (first IncreaseLiquidity of a tokenId matches the NFPM-owned CL Mint in that tx).
  for (const [key, inc] of nftFirstIncrease) {
    const n = truth.nfts.get(key);
    if (!n) continue;
    const cands = (nfpmMintsByTx.get(inc.tx) ?? []).filter(
      (m) =>
        m.nfpm === n.nfpm &&
        m.liquidity === inc.liquidity &&
        m.logIndex < inc.logIndex,
    );
    const m =
      cands.length > 0
        ? cands.reduce((a, b) => (b.logIndex > a.logIndex ? b : a))
        : undefined;
    if (m) {
      n.pool = m.pool;
      n.tickLower = m.tickLower;
      n.tickUpper = m.tickUpper;
    }
  }

  // ---------------- Phase 2c: gauges ----------------
  const gaugeTopics = new Map<Addr, Map<string, EventDef>>();
  const regGauges = [...truth.gauges.values()];
  for (const g of regGauges)
    gaugeTopics.set(g.address, tm(g.kind === "cl" ? "CLGauge" : "Gauge"));
  await streamAddresses(
    ctx,
    "gauges",
    regGauges.map((g) => g.address),
    false,
    (l) => gaugeTopics.get(l.address)?.get(l.topic0 ?? ""),
    (l, def, d) => {
      const g = truth.gauges.get(l.address);
      if (!g) return;
      const e = def.name;
      if (def.configured) {
        const key = `${def.contract}.${e}`;
        if (g.kind === "unregistered") bump(truth.unregisteredEventCounts, key);
        else bump(truth.eventCounts, key);
        bump(g.counts, e);
        const p = truth.pools.get(g.pool);
        if (p)
          p.activeHours.add(
            Math.floor((ctx.blockTs.get(l.block_number) ?? 0) / 3600),
          );
      }
      if (e === "Deposit") {
        g.deposits++;
        const amount = (
          g.kind === "cl" ? d.liquidityToStake : d.amount
        ) as bigint;
        const who = (g.kind === "cl" ? d.user : d.to) as string;
        g.netStakeFromEvents += amount;
        const u = user(truth, who, g.pool);
        u.gaugeDeposits++;
        if (g.kind !== "cl") u.staked += amount;
        if (g.kind === "cl") {
          const tokenId = d.tokenId as bigint;
          for (const nfpm of nfpms) {
            const n = truth.nfts.get(`${nfpm}|${tokenId}`);
            if (n && n.pool === g.pool) {
              n.stakedBy = who;
              n.stakedIn = g.address;
            }
          }
        }
      } else if (e === "Withdraw") {
        g.withdrawals++;
        const amount = (
          g.kind === "cl" ? d.liquidityToStake : d.amount
        ) as bigint;
        const who = (g.kind === "cl" ? d.user : d.from) as string;
        g.netStakeFromEvents -= amount;
        const u = user(truth, who, g.pool);
        u.gaugeWithdrawals++;
        if (g.kind !== "cl") u.staked -= amount;
      } else if (e === "ClaimRewards") {
        g.claims++;
        g.rewardsClaimed += d.amount as bigint;
        const u = user(truth, d.from as string, g.pool);
        u.gaugeClaims++;
        u.gaugeRewardsClaimed += d.amount as bigint;
      } else if (e === "NotifyReward") {
        g.notifies++;
        g.notified += d.amount as bigint;
      } else if (e === "ClaimFees") {
        g.claimFees0 += d.claimed0 as bigint;
        g.claimFees1 += d.claimed1 as bigint;
      }
    },
  );
  // CL per-user stake: liquidity of NFTs still held by the gauge, credited to the depositor.
  for (const n of truth.nfts.values()) {
    if (
      n.burned ||
      !n.stakedIn ||
      n.owner !== n.stakedIn ||
      !n.pool ||
      !n.stakedBy
    )
      continue;
    user(truth, n.stakedBy, n.pool).staked += n.liquidity;
  }

  // ---------------- Phase 2d: voting rewards ----------------
  // The indexer registers both voting rewards of every GaugeCreated, whatever the pool factory.
  const vrTopics = new Map<Addr, Map<string, EventDef>>();
  for (const v of truth.votingRewards.values())
    vrTopics.set(v.address, tm(v.contract));
  await streamAddresses(
    ctx,
    "voting rewards",
    [...truth.votingRewards.keys()],
    false,
    (l) => vrTopics.get(l.address)?.get(l.topic0 ?? ""),
    (l, def, d) => {
      const v = truth.votingRewards.get(l.address);
      if (!v) return;
      if (def.configured) {
        bump(truth.eventCounts, `${def.contract}.${def.name}`);
        bump(v.counts, def.name);
      }
      if (def.name === "ClaimRewards") {
        v.claims++;
        const reward = ((d.reward ?? d._reward) as string).toLowerCase();
        v.claimed.set(
          reward,
          (v.claimed.get(reward) ?? 0n) + ((d.amount ?? d._amount) as bigint),
        );
      }
    },
  );

  // ---------------- Phase 2e: ALM wrappers ----------------
  const wTopics = new Map<Addr, Map<string, EventDef>>();
  for (const w of truth.wrappers.values())
    wTopics.set(w.address, tm(w.contract));
  await streamAddresses(
    ctx,
    "ALM wrappers",
    [...truth.wrappers.keys()],
    false,
    (l) => wTopics.get(l.address)?.get(l.topic0 ?? ""),
    (l, def, d) => {
      const w = truth.wrappers.get(l.address);
      if (!w) return;
      if (def.configured) {
        bump(truth.eventCounts, `${def.contract}.${def.name}`);
        bump(w.counts, def.name);
      }
      if (def.name === "Deposit") w.depositLp += d.lpAmount as bigint;
      else if (def.name === "Withdraw") w.withdrawLp += d.lpAmount as bigint;
      else if (def.name === "Transfer") {
        const f = d.from as string;
        const to = d.to as string;
        const v = d.value as bigint;
        if (f === ZERO) w.totalSupplyFromTransfers += v;
        else w.balances.set(f, (w.balances.get(f) ?? 0n) - v);
        if (to === ZERO) w.totalSupplyFromTransfers -= v;
        else w.balances.set(to, (w.balances.get(to) ?? 0n) + v);
      }
    },
  );
  for (const w of truth.wrappers.values()) {
    for (const [holder, bal] of w.balances) {
      if (holder === w.address) continue;
      if (bal !== 0n) user(truth, holder, w.pool).almLp += bal;
    }
  }

  truth.stats.seconds = (Date.now() - t0) / 1000;
  return truth;
}
