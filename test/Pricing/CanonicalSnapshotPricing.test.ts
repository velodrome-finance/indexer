import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoolId, TokenId, toChecksumAddress } from "../../src/Constants";
import { resetCanonicalPriceSettings } from "../../src/Effects/CanonicalSourcePrice";
import * as PriceOracle from "../../src/PriceOracle";
import { PRICING_TIER, getPricingTier } from "../../src/Pricing/PricingConfig";
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
 * after local pools and the seed, before two-hop and carry. The canonical
 * source's own Token row is never read (per-chain stores only hold this chain).
 */

const LISK_WETH = OP_WETH; // the OP-stack predeploy, same address on Lisk
const OP_WETH_ID = TokenId(OP, OP_WETH);
const P_WETH_USDT = toChecksumAddress(`0x${"c1".padStart(40, "0")}`);
/** A Lisk price connector (tier 2) other than XVELO, for XVELO's two-hop peer. */
const LISK_PEER = toChecksumAddress(
  "0xac485391EB2d7D88253a7F1eF18C37f4242D1A24",
);
const P_PEER_USDT = toChecksumAddress(`0x${"c2".padStart(40, "0")}`);
const P_XVELO_PEER = toChecksumAddress(`0x${"c3".padStart(40, "0")}`);

/**
 * 2030-01-01 10:30 UTC: after the committed seed's last hour, and far enough
 * out that a seed refresh does not move it inside the seed.
 */
const HOUR = 1_893_492_000;
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
  sourceAt?: number; // an Optimism WETH row's last success; undefined = no row
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

  it("a fresh source Token row is not read: the effect answers", async () => {
    const store = liskStore({ sourceAt: T - 30 * 60 });
    const weth = await refresh(store, LISK, LISK_WETH, T);
    expect(weth.pricePerUSDNew).toBe(SNAPSHOT_PRICE);
    expect(store.snapshots.at(-1)?.priceSource).toBe("canonical-snapshot");
    expect(store.context.Token.get).not.toHaveBeenCalledWith(OP_WETH_ID);
  });

  it("a fresh source Token row does not beat the seed", async () => {
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

  describe("order against two-hop and carry", () => {
    /**
     * XVELO's only pool is a peer pool against another Lisk connector, which
     * has a direct $100K USDT pool: a qualifying two-hop route (ADR 0007).
     * Pool sides follow address order (token0 < token1).
     */
    function twoHopStore() {
      const usdtFirst = LISK_USDT.toLowerCase() < LISK_PEER.toLowerCase();
      const xveloFirst = XVELO.toLowerCase() < LISK_PEER.toLowerCase();
      const usdtSide = 100_000n * 10n ** 6n;
      const peerSide = 50_000n * E18;
      const xveloSide = 1_000_000n * E18;
      const peerSide2 = 25_000n * E18;
      return createPricingStore({
        tokens: [
          makeToken(LISK, LISK_USDT, 6n, USD(1), T - DAY_S),
          makeToken(LISK, LISK_PEER, 18n, 0n, T - DAY_S),
          makeToken(LISK, XVELO, 18n, USD(3), T - DAY_S),
        ],
        pools: [
          // 100K USDT vs 50K PEER: PEER = $2.
          usdtFirst
            ? makePool(LISK, P_PEER_USDT, LISK_USDT, LISK_PEER, {
                reserve0: usdtSide,
                reserve1: peerSide,
              })
            : makePool(LISK, P_PEER_USDT, LISK_PEER, LISK_USDT, {
                reserve0: peerSide,
                reserve1: usdtSide,
              }),
          // 1M XVELO vs 25K PEER ($50K): XVELO = $0.05.
          xveloFirst
            ? makePool(LISK, P_XVELO_PEER, XVELO, LISK_PEER, {
                reserve0: xveloSide,
                reserve1: peerSide2,
              })
            : makePool(LISK, P_XVELO_PEER, LISK_PEER, XVELO, {
                reserve0: peerSide2,
                reserve1: xveloSide,
              }),
        ],
        pricingPools: {
          [TokenId(LISK, LISK_PEER)]: [
            PoolId(LISK, P_PEER_USDT),
            PoolId(LISK, P_XVELO_PEER),
          ],
          [TokenId(LISK, XVELO)]: [PoolId(LISK, P_XVELO_PEER)],
        },
        canonicalSourcePrice: answers,
      });
    }

    it("the fixture: XVELO and its peer are both Lisk connectors (tier 2)", () => {
      expect(getPricingTier(LISK, XVELO)).toBe(PRICING_TIER.CONNECTOR);
      expect(getPricingTier(LISK, LISK_PEER)).toBe(PRICING_TIER.CONNECTOR);
    });

    it("the effect answers before a qualifying two-hop route", async () => {
      const store = twoHopStore();
      const xvelo = await refresh(store, LISK, XVELO, T);
      expect(xvelo.pricePerUSDNew).toBe(SNAPSHOT_PRICE);
      expect(store.snapshots.at(-1)).toMatchObject({
        priceSource: "canonical-snapshot",
        pricingSourceTokenId: TokenId(OP, OP_VELO),
      });
    });

    it("with no effect answer the two-hop route is next, before carry", async () => {
      const store = twoHopStore();
      // Same store, effect switched off: the two-hop route prices XVELO.
      setEnv({ PRICING_CANONICAL_SNAPSHOT_EFFECT: "false" });
      const xvelo = await refresh(store, LISK, XVELO, T);
      expect(xvelo.pricePerUSDNew).toBe(E18 / 20n);
      expect(store.snapshots.at(-1)).toMatchObject({
        priceSource: "pool",
        pricingHops: 2,
        pricingPoolId: PoolId(LISK, P_XVELO_PEER),
        pricingViaTokenId: TokenId(LISK, LISK_PEER),
      });
      expect(store.canonicalSourcePriceCalls).toEqual([]);
    });
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
