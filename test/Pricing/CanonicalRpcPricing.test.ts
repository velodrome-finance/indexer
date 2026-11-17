import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoolId, TokenId, toChecksumAddress } from "../../src/Constants";
import { resetCanonicalPriceSettings } from "../../src/Effects/CanonicalSourcePrice";
import * as PriceOracle from "../../src/PriceOracle";
import {
  getCanonicalSourcePools,
  listCanonicalSources,
} from "../../src/PriceOverrides";
import {
  type CanonicalSourceRpcPriceInput,
  type CanonicalSourceRpcPriceOutput,
  DAY_S,
  E18,
  HOUR_S,
  LISK,
  LISK_USDT,
  OP,
  OP_TOKEN_X,
  OP_VELO,
  OP_WETH,
  USD,
  XVELO,
  createPricingStore,
  makePool,
  makeToken,
} from "./pricingHarness";

/**
 * refreshTokenPrice with the canonical RPC price (ADR 0010): after local
 * pools, the seed and the snapshot effect; before two-hop and carry.
 */

const LISK_WETH = OP_WETH; // the OP-stack predeploy, same address on Lisk
const OP_WETH_ID = TokenId(OP, OP_WETH);
const P_WETH_USDT = toChecksumAddress(`0x${"c1".padStart(40, "0")}`);
const SOURCE_POOL = getCanonicalSourcePools(OP_WETH_ID)[0].address;

/** 2026-11-15 10:30 UTC: after the committed seed's last hour (2026-11-14 01:00). */
const HOUR = 1_794_736_800;
const T = HOUR + 1800;
const RPC_PRICE = 1_823_636_840_882_785_821_053n;
const SNAPSHOT_PRICE = USD(1_800);
/** The source block the effect read: a few seconds before hour − 10 min. */
const SOURCE_TS = HOUR - 600 - 1;

/** 2025-10-09 00:30 UTC: inside the seed. */
const SEED_T = 1_759_996_800 + 1800;

type Responder = (
  input: CanonicalSourceRpcPriceInput,
) => CanonicalSourceRpcPriceOutput | Promise<CanonicalSourceRpcPriceOutput>;

const answers: Responder = (input) => ({
  priceUSD: RPC_PRICE,
  depthUSD: USD(3_000_000),
  poolAddress: SOURCE_POOL,
  sourceBlock: 144_000_000,
  sourceTimestamp: input.hourMs / 1000 - 601,
});
const noPrice: Responder = () => ({
  priceUSD: 0n,
  depthUSD: 0n,
  poolAddress: "",
  sourceBlock: 0,
  sourceTimestamp: 0,
});
const pending: Responder = () => {
  throw new Error("no canonical RPC price yet");
};

function liskStore(opts: {
  at?: number;
  respond?: Responder;
  snapshot?: boolean; // the snapshot effect has the hour
  pool?: boolean; // a qualifying $1,300 USDT / 0.5 WETH pool ($2,600)
}) {
  const at = opts.at ?? T;
  return createPricingStore({
    tokens: [
      makeToken(LISK, LISK_USDT, 6n, USD(1), at - DAY_S),
      makeToken(LISK, LISK_WETH, 18n, USD(2_000), at - 2 * HOUR_S),
    ],
    pools: opts.pool
      ? [
          makePool(LISK, P_WETH_USDT, LISK_USDT, LISK_WETH, {
            reserve0: 1_300n * 10n ** 6n,
            reserve1: E18 / 2n,
          }),
        ]
      : [],
    pricingPools: opts.pool
      ? { [TokenId(LISK, LISK_WETH)]: [PoolId(LISK, P_WETH_USDT)] }
      : {},
    canonicalSourcePrice: (input) =>
      opts.snapshot
        ? { priceUSD: SNAPSHOT_PRICE, sourceHourMs: input.hourMs }
        : { priceUSD: 0n, sourceHourMs: 0 },
    canonicalSourceRpcPrice: opts.respond ?? answers,
  });
}

async function refresh(
  store: ReturnType<typeof createPricingStore>,
  chainId: number,
  address: string,
  timestamp: number,
) {
  const token = store.tokens.get(TokenId(chainId, address));
  if (!token) throw new Error(`no token ${address}`);
  return PriceOracle.refreshTokenPrice(
    token,
    123,
    timestamp,
    chainId,
    store.context,
  );
}

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  resetCanonicalPriceSettings();
}

describe("canonical RPC price in refreshTokenPrice (ADR 0010)", () => {
  beforeEach(() =>
    setEnv({
      ENVIO_CLICKHOUSE_HOST: "http://clickhouse.test:8123",
      ENVIO_CLICKHOUSE_DATABASE: "envio",
      PRICING_CANONICAL_RPC_EFFECT: "true",
    }),
  );
  afterEach(() => {
    vi.unstubAllEnvs();
    resetCanonicalPriceSettings();
  });

  it("the snapshot effect has no hour yet: asks for the block's own hour, keyed by source and hour alone", async () => {
    const store = liskStore({});
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(store.canonicalSourcePriceCalls).toHaveLength(1);
    expect(store.canonicalSourceRpcPriceCalls).toEqual([
      { sourceTokenId: OP_WETH_ID, hourMs: HOUR * 1000 },
    ]);
    expect(weth.pricePerUSDNew).toBe(RPC_PRICE);
    expect(weth.pricingDepthUSD).toBeUndefined();
    expect(weth.lastSuccessfulPriceTimestamp).toEqual(new Date(T * 1000));
    expect(store.snapshots.at(-1)).toMatchObject({
      priceSource: "canonical-rpc",
      pricingSourceTokenId: OP_WETH_ID,
      pricingSeedHour: new Date(SOURCE_TS * 1000),
      pricingPoolId: PoolId(OP, SOURCE_POOL),
      pricingDepthUSD: USD(3_000_000),
    });
  });

  it("is not asked when the snapshot effect answers", async () => {
    const store = liskStore({ snapshot: true });
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(weth.pricePerUSDNew).toBe(SNAPSHOT_PRICE);
    expect(store.snapshots.at(-1)?.priceSource).toBe("canonical-snapshot");
    expect(store.canonicalSourceRpcPriceCalls).toEqual([]);
  });

  it("is not asked where the seed has the hour, or a local pool qualifies", async () => {
    const seeded = liskStore({ at: SEED_T });
    await refresh(seeded, LISK, LISK_WETH, SEED_T);
    expect(seeded.snapshots.at(-1)?.priceSource).toBe("canonical-seed");
    expect(seeded.canonicalSourceRpcPriceCalls).toEqual([]);

    const local = liskStore({ pool: true });
    await refresh(local, LISK, LISK_WETH, T);
    expect(local.snapshots.at(-1)?.priceSource).toBe("pool");
    expect(local.canonicalSourceRpcPriceCalls).toEqual([]);
  });

  it("is asked without ClickHouse settings (the snapshot effect is off)", async () => {
    setEnv({ ENVIO_CLICKHOUSE_HOST: "" });
    const store = liskStore({});
    await refresh(store, LISK, LISK_WETH, T);
    expect(store.canonicalSourcePriceCalls).toEqual([]);
    expect(store.snapshots.at(-1)?.priceSource).toBe("canonical-rpc");
  });

  it("no answer yet (the effect throws): carries, and the next hour asks for its own hour", async () => {
    const store = liskStore({ respond: pending });
    const first = await refresh(store, LISK, LISK_WETH, T);
    expect(first.pricePerUSDNew).toBe(USD(2_000));
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
    // Later events in the same hour are throttled: no second call.
    await refresh(store, LISK, LISK_WETH, T + 600);
    expect(store.canonicalSourceRpcPriceCalls).toHaveLength(1);
    await refresh(store, LISK, LISK_WETH, T + HOUR_S);
    expect(store.canonicalSourceRpcPriceCalls.map((c) => c.hourMs)).toEqual([
      HOUR * 1000,
      (HOUR + HOUR_S) * 1000,
    ]);
  });

  it("a settled 'no price' carries too", async () => {
    const store = liskStore({ respond: noPrice });
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(weth.pricePerUSDNew).toBe(USD(2_000));
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
  });

  it("XVELO asks for Optimism VELO", async () => {
    const store = createPricingStore({
      tokens: [makeToken(LISK, XVELO, 18n, 0n, T - DAY_S)],
      canonicalSourcePrice: () => ({ priceUSD: 0n, sourceHourMs: 0 }),
      canonicalSourceRpcPrice: answers,
    });
    const xvelo = await refresh(store, LISK, XVELO, T);
    expect(store.canonicalSourceRpcPriceCalls).toEqual([
      { sourceTokenId: TokenId(OP, OP_VELO), hourMs: HOUR * 1000 },
    ]);
    expect(xvelo.pricePerUSDNew).toBe(RPC_PRICE);
  });

  it("every target of one source asks with the same key (one cached read per hour)", async () => {
    const targets = listCanonicalSources().filter(
      ({ source }) => TokenId(source.chainId, source.address) === OP_WETH_ID,
    );
    expect(targets.length).toBeGreaterThan(5);
    const keys = new Set<string>();
    for (const { target } of targets) {
      const store = createPricingStore({
        tokens: [makeToken(target.chainId, target.address, 18n, 0n, T - DAY_S)],
        canonicalSourcePrice: () => ({ priceUSD: 0n, sourceHourMs: 0 }),
        canonicalSourceRpcPrice: answers,
      });
      // Different blocks of the same clock hour.
      const at = T + (target.chainId % 1000);
      await refresh(store, target.chainId, target.address, at);
      keys.add(JSON.stringify(store.canonicalSourceRpcPriceCalls));
    }
    expect([...keys]).toEqual([
      JSON.stringify([{ sourceTokenId: OP_WETH_ID, hourMs: HOUR * 1000 }]),
    ]);
  });

  it("a source without configured pools is never asked", async () => {
    const unlisted = listCanonicalSources().find(
      ({ source }) =>
        getCanonicalSourcePools(TokenId(source.chainId, source.address))
          .length === 0,
    );
    if (!unlisted) throw new Error("fixture: no source without pools");
    const { target } = unlisted;
    const store = createPricingStore({
      tokens: [
        makeToken(target.chainId, target.address, 18n, USD(7), T - HOUR_S),
      ],
      canonicalSourcePrice: () => ({ priceUSD: 0n, sourceHourMs: 0 }),
      canonicalSourceRpcPrice: answers,
    });
    await refresh(store, target.chainId, target.address, T);
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
    expect(store.canonicalSourceRpcPriceCalls).toEqual([]);
  });

  it("never asked for a token without a canonical source", async () => {
    const store = createPricingStore({
      tokens: [makeToken(OP, OP_TOKEN_X, 18n, USD(7), T - DAY_S)],
      canonicalSourceRpcPrice: answers,
    });
    await refresh(store, OP, OP_TOKEN_X, T);
    expect(store.canonicalSourceRpcPriceCalls).toEqual([]);
  });

  it("switched off: not asked", async () => {
    setEnv({ PRICING_CANONICAL_RPC_EFFECT: "false" });
    const store = liskStore({});
    await refresh(store, LISK, LISK_WETH, T);
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
    expect(store.canonicalSourceRpcPriceCalls).toEqual([]);
  });

  it("off by default under a test runner, so handler tests make no network calls", async () => {
    vi.unstubAllEnvs();
    resetCanonicalPriceSettings();
    const store = liskStore({});
    await refresh(store, LISK, LISK_WETH, T);
    expect(store.canonicalSourceRpcPriceCalls).toEqual([]);
  });
});
