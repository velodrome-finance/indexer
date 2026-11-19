/**
 * Verifies the swap-derived CL fee (src/Aggregators/CLSwapFee.ts) against the
 * chain: for a handful of real Slipstream swaps, amountIn minus the principal
 * implied by the price move must reproduce the fee rate the pool charged.
 *
 * For each pool it fetches recent `Swap` logs (eth_getLogs), keeps swaps that
 * are the pool's FIRST log in their block (so the pool state at block−1 is the
 * exact pre-swap state), and for each swap reads at block−1:
 *   - `slot0()` (sqrtPriceX96, tick) and `liquidity()`;
 *   - every initialized tick the swap crossed (`tickBitmap` + `ticks`);
 *   - the factory's `getSwapFee(pool)`, once as a plain call at block−1 and once
 *     with the swap block's timestamp as a block override (a dynamic fee reads
 *     a TWAP that depends on `block.timestamp`; the pool state is identical).
 *
 * It then computes the principal two ways:
 *   - closed form, for swaps that cross no initialized tick:
 *     `L·Δ√P` (token1 in) or `L·Δ(1/√P)` (token0 in), rounded up like the pool;
 *   - with the indexer's own `processTickCrossings(…, "total")` walk over a tick
 *     map built from the on-chain ticks, fed to the indexer's `deriveCLSwapFee`.
 * and prints the derived rate next to the on-chain rate, plus the output-side
 * residual (geometric principal of the output token vs the event amount; it
 * carries no fee, so it should be within a few wei).
 *
 * Usage: npx -y tsx@4.19.2 scripts/verify-cl-fee-derivation.ts [--swaps 6]
 * Request count is printed at the end (roughly 8–12 per swap + 4 per pool).
 */
import "dotenv/config";
import {
  http,
  type Log,
  type PublicClient,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  parseAbi,
  toHex,
} from "viem";
import CL_POOL_ABI from "../abis/CLPool.json";
import {
  TICK_MIN,
  processTickCrossings,
} from "../src/Aggregators/CLStakedLiquidity";
import { deriveCLSwapFee } from "../src/Aggregators/CLSwapFee";
import { RPC_CHAINS, resolveRpcEndpoints } from "../src/Effects/RpcConfig";
import type { handlerContext } from "../src/EntityTypes";

type PoolSpec = {
  label: string;
  chainId: number;
  pool: `0x${string}`;
  /** Blocks per eth_getLogs page when scanning back from the head. */
  pageBlocks: number;
};

const POOLS: PoolSpec[] = [
  {
    label: "Base WETH/USDC CL100 (dynamic)",
    chainId: 8453,
    pool: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59",
    pageBlocks: 200,
  },
  {
    label: "Base USDC/USDbC CL1 (static)",
    chainId: 8453,
    pool: "0x98c7A2338336d2d354663246F64676009c7bDa97",
    pageBlocks: 5000,
  },
  {
    label: "Base WETH/USDC CL1",
    chainId: 8453,
    pool: "0xdbc6998296caA1652A810dc8D3BaF4A8294330f1",
    pageBlocks: 300,
  },
  {
    label: "OP WETH/USDC CL100",
    chainId: 10,
    pool: "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    pageBlocks: 2000,
  },
];

const args = process.argv.slice(2);
const SWAPS = Number(args[args.indexOf("--swaps") + 1] || 6) || 6;
const Q96 = 1n << 96n;

const VIEW_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, bool)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function factory() view returns (address)",
  "function tickBitmap(int16) view returns (uint256)",
  "function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, int128, uint256, uint256, uint256, int56, uint160, uint32, bool initialized)",
  "function getSwapFee(address) view returns (uint24)",
]);

let requests = 0;
const clients = new Map<number, PublicClient>();
function client(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({
      chain: RPC_CHAINS[chainId].viemChain,
      transport: http(resolveRpcEndpoints(chainId).primary.url, {
        batch: false,
        retryCount: 2,
        onFetchRequest: () => {
          requests++;
        },
      }),
      batch: { multicall: false },
    }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

/** Only `context.log.error` is used by processTickCrossings. */
const stubContext = {
  log: { error: (m: string) => console.error(m) },
} as unknown as handlerContext;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};
/** Rate in FEE_SCALE units with three decimals, as a string. */
const ppm = (fee: bigint, amountIn: bigint) =>
  amountIn === 0n
    ? "-"
    : (Number((fee * 1_000_000_000n) / amountIn) / 1000).toFixed(3);

type SwapArgs = {
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
};

type Row = Record<string, string>;

async function verifyPool(spec: PoolSpec): Promise<Row[]> {
  const c = client(spec.chainId);
  const read = <T>(
    fn: string,
    a: unknown[],
    blockNumber?: bigint,
    address: `0x${string}` = spec.pool,
  ) =>
    c.readContract({
      address,
      abi: VIEW_ABI,
      functionName: fn,
      args: a,
      blockNumber,
    } as never) as Promise<T>;

  const [head, tickSpacing, factory] = await Promise.all([
    c.getBlockNumber(),
    read<number>("tickSpacing", []),
    read<`0x${string}`>("factory", []),
  ]);
  const ts = BigInt(tickSpacing);

  // Collect swaps that are the pool's first log in their block. `move` is the
  // tick distance from the previous swap seen in the same page (a proxy for
  // "likely crossed initialized ticks"), used to include some crossing swaps.
  const candidates: { log: Log; args: SwapArgs; move: bigint }[] = [];
  let to = head - 5n;
  for (let page = 0; page < 10 && candidates.length < SWAPS * 3; page++) {
    const from = to - BigInt(spec.pageBlocks) + 1n;
    const logs = await c.getLogs({
      address: spec.pool,
      fromBlock: from,
      toBlock: to,
    });
    const seenBlocks = new Set<bigint>();
    let lastTick: bigint | undefined;
    for (const log of logs) {
      const bn = log.blockNumber as bigint;
      const first = !seenBlocks.has(bn);
      seenBlocks.add(bn);
      let ev: { eventName: string; args: unknown } | undefined;
      try {
        ev = decodeEventLog({
          abi: CL_POOL_ABI,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        // not a decodable pool event
      }
      if (ev?.eventName !== "Swap") continue;
      const sw = ev.args as SwapArgs;
      const tick = BigInt(sw.tick);
      if (first) {
        const move = lastTick === undefined ? 0n : tick - lastTick;
        candidates.push({ log, args: sw, move: move < 0n ? -move : move });
      }
      lastTick = tick;
    }
    to = from - 1n;
  }
  // Half the picks are the biggest tick moves, half are spread over the window.
  const bigMoves = [...candidates]
    .sort((a, b) => (a.move > b.move ? -1 : a.move < b.move ? 1 : 0))
    .slice(0, Math.floor(SWAPS / 2));
  const rest = candidates.filter((x) => !bigMoves.includes(x));
  const step = Math.max(1, Math.floor(rest.length / (SWAPS - bigMoves.length)));
  const picks = [
    ...bigMoves,
    ...rest.filter((_, i) => i % step === 0).slice(0, SWAPS - bigMoves.length),
  ];

  const rows: Row[] = [];
  for (const { log, args: ev } of picks) {
    const bn = log.blockNumber as bigint;
    const pre = bn - 1n;
    const [slot0, lPre, feePrev, block] = await Promise.all([
      read<readonly [bigint, number]>("slot0", [], pre),
      read<bigint>("liquidity", [], pre),
      read<number>("getSwapFee", [spec.pool], pre, factory),
      c.getBlock({ blockNumber: bn }),
    ]);
    // Same pre-swap state, but evaluated at the swap block's timestamp.
    let feeAtSwapTime = "n/a";
    try {
      const raw = (await c.request({
        method: "eth_call",
        params: [
          {
            to: factory,
            data: encodeFunctionData({
              abi: VIEW_ABI,
              functionName: "getSwapFee",
              args: [spec.pool],
            }),
          },
          toHex(pre),
          {},
          { time: toHex(block.timestamp), number: toHex(bn) },
        ],
      } as never)) as `0x${string}`;
      feeAtSwapTime = BigInt(raw).toString();
    } catch (e) {
      feeAtSwapTime = `err:${(e as Error).message.split("\n")[0].slice(0, 40)}`;
    }

    const sqrtOld = slot0[0];
    const tickOld = BigInt(slot0[1]);
    const tickNew = BigInt(ev.tick);
    const sqrtNew = ev.sqrtPriceX96;

    // Initialized ticks the swap crossed: UP (tickOld, tickNew], DOWN (tickNew, tickOld].
    const up = tickNew > tickOld;
    const lo = up ? tickOld + 1n : tickNew + 1n;
    const hi = up ? tickNew : tickOld;
    const crossed: { tick: bigint; net: bigint }[] = [];
    if (lo <= hi) {
      const wLo = floorDiv(floorDiv(lo, ts), 256n);
      const wHi = floorDiv(floorDiv(hi, ts), 256n);
      for (let w = wLo; w <= wHi; w++) {
        const bits = await read<bigint>("tickBitmap", [Number(w)], pre);
        for (let b = 0n; b < 256n; b++) {
          if ((bits >> b) & 1n) {
            const t = (w * 256n + b) * ts;
            if (t >= lo && t <= hi) {
              const info = await read<readonly [bigint, bigint]>(
                "ticks",
                [Number(t)],
                pre,
              );
              crossed.push({ tick: t, net: info[1] });
            }
          }
        }
      }
    }
    crossed.sort((a, b) => (a.tick < b.tick ? -1 : 1));

    // Tick map for the indexer's walk: an anchor below everything carrying
    // L_pre minus the crossed nets already in the prefix at tickOld (DOWN walks).
    const prefixCrossed = crossed
      .filter((x) => x.tick <= tickOld)
      .reduce((s, x) => s + x.net, 0n);
    const edges = [TICK_MIN, ...crossed.map((x) => x.tick)];
    const nets = [lPre - prefixCrossed, ...crossed.map((x) => x.net)];
    const walk = processTickCrossings(
      spec.chainId,
      spec.pool,
      tickOld,
      tickNew,
      sqrtOld,
      sqrtNew,
      ts,
      stubContext,
      lPre,
      true,
      edges,
      nets,
      "total",
    );
    const derived = deriveCLSwapFee({
      amount0: ev.amount0,
      amount1: ev.amount1,
      principal0: walk.delta0,
      principal1: walk.delta1,
      walkEndLiquidity: walk.liquidityInRange,
      eventLiquidity: ev.liquidity,
    });

    const token0In = ev.amount0 > 0n;
    const amountIn = token0In ? ev.amount0 : ev.amount1;
    const amountOut = token0In ? -ev.amount1 : -ev.amount0;
    // Closed form, valid only without crossings.
    let closedFee = "-";
    if (crossed.length === 0) {
      const principal = token0In
        ? ceilDiv(lPre * Q96 * (sqrtOld - sqrtNew), sqrtOld * sqrtNew)
        : ceilDiv(lPre * (sqrtNew - sqrtOld), Q96);
      closedFee = ppm(amountIn - principal, amountIn);
    }
    const derivedFee = derived.ok
      ? token0In
        ? derived.feeAmount0
        : derived.feeAmount1
      : derived.derivedFee;
    const outPrincipal = token0In ? -walk.delta1 : -walk.delta0;
    const onchain =
      feeAtSwapTime.startsWith("err") || feeAtSwapTime === "n/a"
        ? String(feePrev)
        : feeAtSwapTime;
    const delta = Number(ppm(derivedFee, amountIn)) - Number(onchain);

    rows.push({
      pool: spec.label,
      block: bn.toString(),
      in: token0In ? "token0" : "token1",
      amountIn: amountIn.toString(),
      dTick: (tickNew - tickOld).toString(),
      crossed: crossed.length.toString(),
      "L ok":
        walk.liquidityInRange === ev.liquidity
          ? "yes"
          : `NO (${walk.liquidityInRange} vs ${ev.liquidity})`,
      feeIn: derivedFee.toString(),
      "closed-form rate": closedFee,
      "walk rate": ppm(derivedFee, amountIn),
      "stored rate": derived.ok
        ? (derived.feeRate?.toString() ?? "(small)")
        : `fallback:${derived.reason}`,
      "getSwapFee@N-1": String(feePrev),
      "getSwapFee@N-1,time(N)": feeAtSwapTime,
      "rate-onchain": delta.toFixed(3),
      "out residual (wei)": (outPrincipal - amountOut).toString(),
    });
  }
  return rows;
}

function printTable(rows: Row[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => r[c].length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((v, i) => v.padEnd(width[i])).join(" | ")} |`;
  console.log(line(cols));
  console.log(`|${width.map((w) => "-".repeat(w + 2)).join("|")}|`);
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}

async function main() {
  const all: Row[] = [];
  for (const spec of POOLS) {
    all.push(...(await verifyPool(spec)));
  }
  printTable(all);
  console.log(`\nRPC requests: ${requests}`);
}
main();
