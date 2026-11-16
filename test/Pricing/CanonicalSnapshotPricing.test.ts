import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoolId, TokenId, toChecksumAddress } from "../../src/Constants";
import { resetCanonicalPriceSettings } from "../../src/Effects/CanonicalSourcePrice";
import * as PriceOracle from "../../src/PriceOracle";
import {
  type CanonicalSourcePriceInput,
  type CanonicalSourcePriceOutput,
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
 * refreshTokenPrice with the canonical snapshot effect (ADR 0009, flow F):
 * after local pools / live source and the seed, before two-hop and carry.
 */

const LISK_WETH = OP_WETH; // the OP-stack predeploy, same address on Lisk
const OP_WETH_ID = TokenId(OP, OP_WETH);
const P_WETH_USDT = toChecksumAddress(`0x${"c1".padStart(40, "0")}`);

/** 2026-11-15 10:30 UTC: after the committed seed's last hour (2026-11-14 01:00). */
const HOUR = 1_794_736_800;
const T = HOUR + 1800;
/** The hour the leaf asks for: the last complete hour before the block. */
const ASKED_MS = (HOUR - HOUR_S) * 1000;
const SNAPSHOT_PRICE = 1_823_636_840_882_785_821_053n;

/** 2025-10-09 00:30 UTC: inside the seed (Optimism WETH $4,438.642991). */
const SEED_T = 1_759_996_800 + 1800;
const SEED_WETH = 4_438_642_991n * 10n ** 12n;

type Responder = (
  input: CanonicalSourcePriceInput,
) => CanonicalSourcePriceOutput | Promise<CanonicalSourcePriceOutput>;

const answers: Responder = (input) => ({
  priceUSD: SNAPSHOT_PRICE,
  sourceHourMs: input.hourMs,
});
const notYet: Responder = () => ({ priceUSD: 0n, sourceHourMs: 0 });

function liskStore(opts: {
  at?: number;
  respond?: Responder;
  sourceAt?: number; // Optimism WETH's last success; undefined = no row
  pool?: boolean; // a qualifying $1,300 USDT / 0.5 WETH pool ($2,600)
}) {
  const at = opts.at ?? T;
  return createPricingStore({
    tokens: [
      makeToken(LISK, LISK_USDT, 6n, USD(1), at - DAY_S),
      makeToken(LISK, LISK_WETH, 18n, USD(2_000), at - 2 * HOUR_S),
      ...(opts.sourceAt === undefined
        ? []
        : [
            makeToken(OP, OP_WETH, 18n, USD(2_500), opts.sourceAt, {
              pricingDepthUSD: USD(9_000_000),
            }),
          ]),
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
    canonicalSourcePrice: opts.respond ?? answers,
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

describe("canonical snapshot effect in refreshTokenPrice (ADR 0009, flow F)", () => {
  beforeEach(() =>
    setEnv({
      ENVIO_CLICKHOUSE_HOST: "http://clickhouse.test:8123",
      ENVIO_CLICKHOUSE_DATABASE: "envio",
    }),
  );
  afterEach(() => {
    vi.unstubAllEnvs();
    resetCanonicalPriceSettings();
  });

  it("past the seed, with no local or live price, takes the source's snapshot for the last complete hour", async () => {
    const store = liskStore({});
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(store.canonicalSourcePriceCalls).toEqual([
      {
        sourceTokenId: OP_WETH_ID,
        hourMs: ASKED_MS,
        requesterTokenId: TokenId(LISK, LISK_WETH),
      },
    ]);
    expect(weth.pricePerUSDNew).toBe(SNAPSHOT_PRICE);
    expect(weth.pricingDepthUSD).toBeUndefined();
    expect(weth.lastSuccessfulPriceTimestamp).toEqual(new Date(T * 1000));
    expect(store.snapshots.at(-1)).toMatchObject({
      priceSource: "canonical-snapshot",
      pricingSourceTokenId: OP_WETH_ID,
      pricingSeedHour: new Date(ASKED_MS),
      pricingPoolId: undefined,
      pricingDepthUSD: undefined,
    });
  });

  it("records the source hour the effect used (lookback)", async () => {
    const store = liskStore({
      respond: (input) => ({
        priceUSD: SNAPSHOT_PRICE,
        sourceHourMs: input.hourMs - 2 * HOUR_S * 1000,
      }),
    });
    await refresh(store, LISK, LISK_WETH, T);
    expect(store.snapshots.at(-1)?.pricingSeedHour).toEqual(
      new Date(ASKED_MS - 2 * HOUR_S * 1000),
    );
  });

  it("does not call the effect where the seed has the hour", async () => {
    const store = liskStore({ at: SEED_T });
    const weth = await refresh(store, LISK, LISK_WETH, SEED_T);
    expect(weth.pricePerUSDNew).toBe(SEED_WETH);
    expect(store.snapshots.at(-1)?.priceSource).toBe("canonical-seed");
    expect(store.canonicalSourcePriceCalls).toEqual([]);
  });

  it("a qualifying local pool beats the effect (no call)", async () => {
    const store = liskStore({ pool: true });
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(weth.pricePerUSDNew).toBe(USD(2_600));
    expect(store.snapshots.at(-1)?.priceSource).toBe("pool");
    expect(store.canonicalSourcePriceCalls).toEqual([]);
  });

  it("a live source inside its window beats the effect (no call)", async () => {
    const store = liskStore({ sourceAt: T - 30 * 60 });
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(weth.pricePerUSDNew).toBe(USD(2_500));
    expect(store.snapshots.at(-1)?.priceSource).toBe("canonical");
    expect(store.canonicalSourcePriceCalls).toEqual([]);
  });

  it("with PRICING_CANONICAL_LIVE_READ=false the live source is not read and the effect answers", async () => {
    setEnv({ PRICING_CANONICAL_LIVE_READ: "false" });
    const store = liskStore({ sourceAt: T - 30 * 60 });
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(weth.pricePerUSDNew).toBe(SNAPSHOT_PRICE);
    expect(store.snapshots.at(-1)?.priceSource).toBe("canonical-snapshot");
    expect(store.context.Token.get).not.toHaveBeenCalledWith(OP_WETH_ID);
  });

  it("with the live read off, the seed still comes first", async () => {
    setEnv({ PRICING_CANONICAL_LIVE_READ: "false" });
    const store = liskStore({ at: SEED_T, sourceAt: SEED_T - 60 });
    await refresh(store, LISK, LISK_WETH, SEED_T);
    expect(store.snapshots.at(-1)?.priceSource).toBe("canonical-seed");
    expect(store.canonicalSourcePriceCalls).toEqual([]);
  });

  it("no answer yet: carries, and the next hour asks again for its own hour", async () => {
    const store = liskStore({ respond: notYet });
    const first = await refresh(store, LISK, LISK_WETH, T);
    expect(first.pricePerUSDNew).toBe(USD(2_000));
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
    // Later events in the same hour are throttled: no second call.
    await refresh(store, LISK, LISK_WETH, T + 600);
    expect(store.canonicalSourcePriceCalls).toHaveLength(1);
    await refresh(store, LISK, LISK_WETH, T + HOUR_S);
    expect(store.canonicalSourcePriceCalls.map((c) => c.hourMs)).toEqual([
      ASKED_MS,
      ASKED_MS + HOUR_S * 1000,
    ]);
  });

  it("an effect failure counts as no answer", async () => {
    const store = liskStore({
      respond: () => {
        throw new Error("boom");
      },
    });
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(weth.pricePerUSDNew).toBe(USD(2_000));
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
  });

  it("XVELO asks for Optimism VELO", async () => {
    const store = createPricingStore({
      tokens: [makeToken(LISK, XVELO, 18n, 0n, T - DAY_S)],
      canonicalSourcePrice: answers,
    });
    const xvelo = await refresh(store, LISK, XVELO, T);
    expect(store.canonicalSourcePriceCalls[0]?.sourceTokenId).toBe(
      TokenId(OP, OP_VELO),
    );
    expect(xvelo.pricePerUSDNew).toBe(SNAPSHOT_PRICE);
  });

  it("never calls the effect for a token without a canonical source", async () => {
    const store = createPricingStore({
      tokens: [makeToken(OP, OP_TOKEN_X, 18n, USD(7), T - DAY_S)],
      canonicalSourcePrice: answers,
    });
    await refresh(store, OP, OP_TOKEN_X, T);
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
    expect(store.canonicalSourcePriceCalls).toEqual([]);
  });

  it.each([
    ["switched off", { PRICING_CANONICAL_SNAPSHOT_EFFECT: "false" }],
    ["without ClickHouse settings", { ENVIO_CLICKHOUSE_HOST: "" }],
  ])("is not called when %s", async (_, vars) => {
    setEnv(vars);
    const store = liskStore({});
    await refresh(store, LISK, LISK_WETH, T);
    expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
    expect(store.canonicalSourcePriceCalls).toEqual([]);
  });

  it("the preload pass resolves a token-hour once however many events touch it", async () => {
    const store = liskStore({});
    (store.context as unknown as { isPreload: boolean }).isPreload = true;
    await Promise.all([
      refresh(store, LISK, LISK_WETH, T),
      refresh(store, LISK, LISK_WETH, T + 5),
      refresh(store, LISK, LISK_WETH, T + 900),
    ]);
    expect(store.canonicalSourcePriceCalls).toHaveLength(1);
  });
});
