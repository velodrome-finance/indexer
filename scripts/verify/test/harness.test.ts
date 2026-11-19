import { TickMath } from "@uniswap/v3-sdk";
import {
  type Hex,
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  parseAbiParameters,
} from "viem";
import { normValue } from "../checks/store";
import { AbiRegistry, decodeLog } from "../lib/abi";
import {
  amount0Delta,
  amount1Delta,
  positionAmounts,
  sqrtRatioAtTick,
} from "../lib/clmath";
import { loadIndexerConfig } from "../lib/config";
import { Check, within } from "../lib/report";
import { relDiff, sample } from "../lib/util";
import { parseYaml } from "../lib/yaml";

describe("yaml", () => {
  it("parses maps, sequences of maps, scalars and comments", () => {
    const y = parseYaml(`a: 1 # c
b:
  - name: x
    address:
      - 0xAbC
      - "0xdef"
  - name: y
    address:
c: "q: r"
d: true
`);
    expect(y).toEqual({
      a: 1,
      b: [
        { name: "x", address: ["0xAbC", "0xdef"] },
        { name: "y", address: null },
      ],
      c: "q: r",
      d: true,
    });
  });

  it("reads config.yaml: chains, contracts, custom event signatures and RPC env vars", () => {
    const cfg = loadIndexerConfig();
    expect(cfg.chains.get(1750)?.contracts.get("PoolFactory")).toEqual([
      "0x31832f2a97fd20664d76cc421207669b55ce4bc0",
    ]);
    expect(cfg.chains.get(1750)?.rpcEnvVar).toBe("ENVIO_METAL_RPC_URL");
    expect(cfg.chains.get(1135)?.endBlock).toBe(39746606);
    expect(
      cfg.contracts
        .get("Pool")
        ?.events.find((e) => e.name === "MintWithRecipient"),
    ).toBeDefined();
    const reg = new AbiRegistry(cfg);
    const m4 = reg.event("Pool", "MintWithRecipient");
    const m3 = reg.event("Pool", "Mint");
    expect(m4.topic0).not.toBe(m3.topic0);
    expect(m4.configured && m3.configured).toBe(true);
    expect(reg.event("NFPM", "Collect").configured).toBe(false);
  });
});

describe("fast log decoder", () => {
  it("matches viem for static events with indexed and signed params", () => {
    const ev = parseAbiItem(
      "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
    );
    const args = {
      sender: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      amount0: -123456789n,
      amount1: 987654321n,
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 10n ** 20n,
      tick: -887,
    } as const;
    const topics = encodeEventTopics({
      abi: [ev],
      eventName: "Swap",
      args: { sender: args.sender, recipient: args.recipient },
    });
    const data = encodeAbiParameters(
      parseAbiParameters(
        "int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick",
      ),
      [
        args.amount0,
        args.amount1,
        args.sqrtPriceX96,
        args.liquidity,
        args.tick,
      ],
    );
    const log = {
      block_number: 1,
      log_index: 0,
      address: "0x",
      data,
      topic0: topics[0] as string,
      topic1: topics[1] as string,
      topic2: topics[2] as string,
    };
    const fast = decodeLog(
      {
        contract: "CLPool",
        name: "Swap",
        topic0: topics[0] as string,
        abi: ev,
        configured: true,
        isStatic: true,
      },
      log,
    );
    const slow = decodeEventLog({
      abi: [ev],
      data,
      topics: topics as [Hex, ...Hex[]],
    }).args as Record<string, unknown>;
    expect(fast.amount0).toBe(slow.amount0);
    expect(fast.amount1).toBe(slow.amount1);
    expect(fast.tick).toBe(BigInt(slow.tick as number));
    expect(fast.sender).toBe((slow.sender as string).toLowerCase());
    expect(fast.sqrtPriceX96).toBe(slow.sqrtPriceX96);
  });
});

describe("CL math", () => {
  it("sqrtRatioAtTick matches the Uniswap v3 SDK", () => {
    for (const t of [
      -887272, -500000, -60000, -1, 0, 1, 2, 60, 1000, 123456, 600000, 887272,
    ]) {
      expect(sqrtRatioAtTick(t)).toBe(
        BigInt(TickMath.getSqrtRatioAtTick(t).toString()),
      );
    }
  });

  it("position amounts round down and match the closed form", () => {
    const L = 10n ** 18n;
    const sa = sqrtRatioAtTick(-600);
    const sb = sqrtRatioAtTick(600);
    const sp = sqrtRatioAtTick(0);
    const a = positionAmounts(L, sp, 0, -600, 600);
    expect(a.amount0).toBe(amount0Delta(sp, sb, L, false));
    expect(a.amount1).toBe(amount1Delta(sa, sp, L, false));
    expect(amount0Delta(sp, sb, L, true) - a.amount0).toBeLessThanOrEqual(1n);
    const below = positionAmounts(L, sp, 0, 60, 600);
    expect(below.amount1).toBe(0n);
    const above = positionAmounts(L, sp, 0, -600, -60);
    expect(above.amount0).toBe(0n);
  });
});

describe("report", () => {
  it("tolerances", () => {
    expect(within(100n, 101n, { abs: 1n })).toBe(true);
    expect(within(100n, 102n, { abs: 1n })).toBe(false);
    expect(within(1_000_000n, 1_000_001n, { rel: 1e-6 })).toBe(true);
    expect(relDiff(0n, 0n)).toBe(0);
  });

  it("keeps the worst offenders and reports status", () => {
    const c = new Check("x", 1, "t", "exact", 2);
    for (let i = 0; i < 10; i++) c.cmp(`k${i}`, BigInt(i), 0n);
    const r = c.done("s");
    expect(r.status).toBe("fail");
    expect(r.offenderCount).toBe(9);
    expect(r.offenders.length).toBe(2);
    expect(r.offenders[0].key).toBe("k9");
    expect(new Check("y", 1, "t", "e").informational().done("").status).toBe(
      "pass",
    );
  });

  it("deterministic sample", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i);
    expect(sample(xs, 5, "s")).toEqual(sample(xs, 5, "s"));
    expect(new Set(sample(xs, 5, "s")).size).toBe(5);
  });
});

describe("store normalisation", () => {
  it("normalises Postgres and ClickHouse representations alike", () => {
    expect(normValue("t")).toBe(normValue("true"));
    expect(normValue("2025-01-21 14:00:00+00")).toBe(
      normValue("2025-01-21 14:00:00.000"),
    );
    expect(normValue("{420,7}")).toBe(normValue("[420,7]"));
    expect(normValue("{a,b}")).toBe(normValue("['a','b']"));
    expect(normValue(null)).toBe(normValue(undefined));
    expect(normValue("12")).toBe(normValue("12.000"));
  });
});
