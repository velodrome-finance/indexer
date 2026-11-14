import type { Token } from "envio";
import { PoolId, TokenId, toChecksumAddress } from "../../src/Constants";
import * as PriceOracle from "../../src/PriceOracle";
import { getPricingPoolTargets } from "../../src/Pricing/PoolRoute";
import {
  MAX_TWO_HOP_PEER_POOLS,
  PRICING_TIER,
  getPricingTier,
} from "../../src/Pricing/PricingConfig";
import {
  DAY_S,
  E18,
  HOUR_S,
  HOUR_START_S,
  OP,
  OP_MANATEE,
  OP_TOKEN_X,
  OP_USDC,
  OP_WETH,
  Q96,
  USD,
  createPricingStore,
  makePool,
  makeToken,
} from "./pricingHarness";

/**
 * ADR 0007: a tier-3 token with no qualifying direct candidate may be priced
 * through a tier-3 peer whose own price comes from a direct pool route.
 *
 * Address order (token0 < token1): USDC 0x0b2C… < X 0x1111… < Y 0x3333… <
 * Z 0x5555….
 */
const X = OP_TOKEN_X;
const Y = toChecksumAddress("0x3333333333333333333333333333333333333333");
const Z = toChecksumAddress("0x5555555555555555555555555555555555555555");
const addr = (n: number): string =>
  toChecksumAddress(`0x${n.toString(16).padStart(40, "0")}`);
const P_Y_USDC = addr(0xc1); // Y direct: $100K USDC vs 50K Y → Y = $2
const P_X_Y = addr(0xc2); // peer: 1M X vs 25K Y ($50K at $2) → X = $0.05
const P_X_USDC = addr(0xc3); // X direct (only in some tests)
const P_Y_Z = addr(0xc4); // peer Y/Z
const P_Z_USDC = addr(0xc5); // Z direct

const NOW = HOUR_START_S + 10 * 60;
const STALE = NOW - 2 * HOUR_S;

const pYUsdc = (usdc = 100_000n, y = 50_000n) =>
  makePool(OP, P_Y_USDC, OP_USDC, Y, {
    reserve0: usdc * 10n ** 6n,
    reserve1: y * E18,
  });
const pXY = (x = 1_000_000n, y = 25_000n) =>
  makePool(OP, P_X_Y, X, Y, { reserve0: x * E18, reserve1: y * E18 });

function store(opts: {
  pools: ReturnType<typeof makePool>[];
  pricingPools: Record<string, string[]>;
  tokens?: Token[];
}) {
  const base = [
    makeToken(OP, OP_USDC, 6n, USD(1), STALE),
    makeToken(OP, X, 18n, 0n, STALE),
    makeToken(OP, Y, 18n, 0n, STALE),
    makeToken(OP, Z, 18n, 0n, STALE),
  ];
  const byId = new Map(base.map((t) => [t.id, t]));
  for (const t of opts.tokens ?? []) byId.set(t.id, t);
  return createPricingStore({
    tokens: [...byId.values()],
    pools: opts.pools,
    pricingPools: opts.pricingPools,
  });
}

const id = (a: string) => TokenId(OP, a);
const pid = (a: string) => PoolId(OP, a);

async function refresh(
  s: ReturnType<typeof createPricingStore>,
  address: string,
  at = NOW,
): Promise<Token> {
  const token = s.tokens.get(id(address));
  if (!token) throw new Error(`no token ${address}`);
  return PriceOracle.refreshTokenPrice(token, 1, at, OP, s.context);
}

const snapsFor = (s: ReturnType<typeof createPricingStore>, a: string) =>
  s.snapshots.filter((x) => x.address === a);

/** The WBTC / uniBTC shape: X trades only against Y; Y has a USDC pool. */
const peerOnly = () =>
  store({
    pools: [pYUsdc(), pXY()],
    pricingPools: {
      [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
      [id(X)]: [pid(P_X_Y)],
    },
  });

describe("two-hop pricing through a tier-3 peer (ADR 0007)", () => {
  it("prices a token that only trades against a directly priced peer", async () => {
    const s = peerOnly();
    const x = await refresh(s, X);
    expect(x.pricePerUSDNew).toBe(E18 / 20n); // 0.025 Y × $2
    expect(x.pricingDepthUSD).toBe(USD(50_000)); // min($50K peer pool, $100K direct)
    expect(snapsFor(s, X)).toEqual([
      expect.objectContaining({
        priceSource: "pool",
        pricingHops: 2,
        pricingPoolId: pid(P_X_Y),
        pricingViaTokenId: id(Y),
        pricingViaPoolId: pid(P_Y_USDC),
        pricingDepthUSD: USD(50_000),
      }),
    ]);
  });

  it("computes the peer's direct price without writing the peer", async () => {
    const s = peerOnly();
    await refresh(s, X);
    // Y's lower-tier counterparty (USDC) is refreshed as usual; Y itself is
    // only computed, so its own refresh this hour is unaffected.
    expect(snapsFor(s, Y)).toHaveLength(0);
    expect(s.tokens.get(id(Y))?.pricePerUSDNew).toBe(0n);
    const y = await refresh(s, Y);
    expect(y.pricePerUSDNew).toBe(USD(2));
    expect(snapsFor(s, Y)[0]).toMatchObject({
      pricingHops: 1,
      pricingPoolId: pid(P_Y_USDC),
    });
  });

  it("the weakest link governs the depth floor", async () => {
    // Y's direct route holds only $4K of USDC (< $5K floor on Optimism):
    // Y has no direct price, so X has no two-hop route either.
    const s = store({
      pools: [pYUsdc(4_000n, 2_000n), pXY(1_000_000n, 2_500_000n)],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y)],
      },
    });
    const x = await refresh(s, X);
    expect(x.pricePerUSDNew).toBe(0n);
    expect(snapsFor(s, X)[0].priceSource).toBe("unpriced");
  });

  it("the weakest link governs the 1000x bound", async () => {
    // One-sided CL peer pool: 20M X claimed at 0.25 Y ($0.50) = $10M of X
    // against 3,000 Y ($6K, above the $5K floor) in the pool:
    // $10M / min($6K, $100K) ≈ 1,667x > 1000x.
    const s = store({
      pools: [
        pYUsdc(),
        makePool(OP, P_X_Y, X, Y, {
          isCL: true,
          sqrtPriceX96: Q96 / 2n,
          reserve0: 20_000_000n * E18,
          reserve1: 3_000n * E18,
        }),
      ],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y)],
      },
    });
    expect((await refresh(s, X)).pricePerUSDNew).toBe(0n);

    // Same pool with the X side cut to $5M (≈ 833x): the route qualifies.
    const ok = store({
      pools: [
        pYUsdc(),
        makePool(OP, P_X_Y, X, Y, {
          isCL: true,
          sqrtPriceX96: Q96 / 2n,
          reserve0: 10_000_000n * E18,
          reserve1: 3_000n * E18,
        }),
      ],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y)],
      },
    });
    expect((await refresh(ok, X)).pricePerUSDNew).toBe(E18 / 2n);
  });

  it("the weakest link can be the peer pool", async () => {
    // Deep direct route for Y, but only 2,000 Y ($4K) in the X/Y pool.
    const s = store({
      pools: [pYUsdc(), pXY(80_000n, 2_000n)],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y)],
      },
    });
    expect((await refresh(s, X)).pricePerUSDNew).toBe(0n);
  });

  it("prefers any qualifying direct candidate over a deeper two-hop route", async () => {
    // X/USDC: $6K vs 100K X → $0.06, just over the floor; the peer route is
    // $50K deep but is only consulted when nothing direct qualifies.
    const s = store({
      pools: [
        pYUsdc(),
        pXY(),
        makePool(OP, P_X_USDC, OP_USDC, X, {
          reserve0: 6_000n * 10n ** 6n,
          reserve1: 100_000n * E18,
        }),
      ],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y), pid(P_X_USDC)],
      },
    });
    const x = await refresh(s, X);
    expect(x.pricePerUSDNew).toBe((6n * E18) / 100n);
    expect(snapsFor(s, X)[0]).toMatchObject({
      pricingHops: 1,
      pricingPoolId: pid(P_X_USDC),
    });
  });

  it("never chains: a peer that is itself only two-hop-priced is not a route", async () => {
    // Z has a direct USDC pool; Y trades only with Z; X trades only with Y.
    const s = store({
      pools: [
        makePool(OP, P_Z_USDC, OP_USDC, Z, {
          reserve0: 100_000n * 10n ** 6n,
          reserve1: 100_000n * E18,
        }),
        makePool(OP, P_Y_Z, Y, Z, {
          reserve0: 50_000n * E18,
          reserve1: 50_000n * E18,
        }),
        pXY(),
      ],
      pricingPools: {
        [id(Z)]: [pid(P_Z_USDC), pid(P_Y_Z)],
        [id(Y)]: [pid(P_Y_Z), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y)],
      },
    });
    // Y gets a two-hop price through Z…
    const y = await refresh(s, Y);
    expect(y.pricePerUSDNew).toBe(USD(1));
    expect(snapsFor(s, Y)[0].pricingHops).toBe(2);
    // …but X cannot extend that chain, even with Y's stored price now > 0.
    const x = await refresh(s, X);
    expect(x.pricePerUSDNew).toBe(0n);
    expect(snapsFor(s, X)[0].priceSource).toBe("unpriced");
  });

  it("ignores a peer's carried price", async () => {
    // Y carries $2 from yesterday but has no qualifying direct route now.
    const s = store({
      pools: [pYUsdc(1_000n, 500n), pXY()],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y)],
      },
      tokens: [makeToken(OP, Y, 18n, USD(2), NOW - 20 * HOUR_S)],
    });
    expect((await refresh(s, X)).pricePerUSDNew).toBe(0n);
  });

  it("terminates on mutual peers with no direct route (acyclic)", async () => {
    const s = store({
      pools: [pXY()],
      pricingPools: {
        [id(X)]: [pid(P_X_Y)],
        [id(Y)]: [pid(P_X_Y)],
      },
    });
    expect((await refresh(s, X)).pricePerUSDNew).toBe(0n);
    expect((await refresh(s, Y)).pricePerUSDNew).toBe(0n);
    // Each token was refreshed once; nothing recursed into itself.
    expect(s.snapshots.map((x) => x.address)).toEqual([X, Y]);
  });

  it("is deterministic in refresh order", async () => {
    const xFirst = peerOnly();
    await refresh(xFirst, X);
    await refresh(xFirst, Y);
    const yFirst = peerOnly();
    await refresh(yFirst, Y);
    await refresh(yFirst, X);
    for (const a of [X, Y]) {
      expect(yFirst.tokens.get(id(a))?.pricePerUSDNew).toBe(
        xFirst.tokens.get(id(a))?.pricePerUSDNew,
      );
      expect(yFirst.tokens.get(id(a))?.pricingDepthUSD).toBe(
        xFirst.tokens.get(id(a))?.pricingDepthUSD,
      );
    }
  });

  it("skips a blacklisted peer", async () => {
    // $Manatee is blacklisted on Optimism; give it a deep USDC pool anyway.
    const P_M_USDC = addr(0xc6);
    const P_X_M = addr(0xc7);
    const s = store({
      pools: [
        makePool(OP, P_M_USDC, OP_USDC, OP_MANATEE, {
          reserve0: 100_000n * 10n ** 6n,
          reserve1: 100_000n * E18,
        }),
        makePool(OP, P_X_M, X, OP_MANATEE, {
          reserve0: 100_000n * E18,
          reserve1: 100_000n * E18,
        }),
      ],
      pricingPools: {
        [id(OP_MANATEE)]: [pid(P_M_USDC), pid(P_X_M)],
        [id(X)]: [pid(P_X_M)],
      },
      tokens: [makeToken(OP, OP_MANATEE, 18n, 0n, STALE)],
    });
    expect((await refresh(s, X)).pricePerUSDNew).toBe(0n);
  });

  it("considers at most MAX_TWO_HOP_PEER_POOLS peer pools, oldest first", async () => {
    // 32 dead peer pools registered first, then the X/Y pool with a priced
    // peer: the 33rd peer pool is beyond the cap.
    const dead = Array.from({ length: MAX_TWO_HOP_PEER_POOLS }, (_, i) =>
      makePool(OP, addr(0xd00 + i), X, addr(0xe00 + i), {
        reserve0: E18,
        reserve1: E18,
      }),
    );
    const s = store({
      pools: [pYUsdc(), pXY(), ...dead],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [...dead.map((p) => p.id), pid(P_X_Y)],
      },
    });
    expect((await refresh(s, X)).pricePerUSDNew).toBe(0n);

    // The same pools with the priced peer registered first: it is used.
    const first = store({
      pools: [pYUsdc(), pXY(), ...dead],
      pricingPools: {
        [id(Y)]: [pid(P_Y_USDC), pid(P_X_Y)],
        [id(X)]: [pid(P_X_Y), ...dead.map((p) => p.id)],
      },
    });
    expect((await refresh(first, X)).pricePerUSDNew).toBe(E18 / 20n);
  });

  it("never calls an RPC effect", async () => {
    const s = peerOnly();
    await refresh(s, X);
    expect(s.effectCalls).toEqual([]);
  });

  describe("the first hop's base must be fresh", () => {
    // Y's only direct route is Y/WETH (50K Y vs 40 WETH: $100K at $2,500).
    // WETH has no route of its own, so its refresh carries.
    const P_Y_WETH = addr(0xc6);
    const viaCarriedWeth = (wethLastSuccess: number) =>
      store({
        pools: [
          makePool(OP, P_Y_WETH, Y, OP_WETH, {
            reserve0: 50_000n * E18,
            reserve1: 40n * E18,
          }),
          pXY(),
        ],
        pricingPools: {
          [id(Y)]: [pid(P_Y_WETH), pid(P_X_Y)],
          [id(X)]: [pid(P_X_Y)],
          [id(OP_WETH)]: [],
        },
        tokens: [makeToken(OP, OP_WETH, 18n, USD(2_500), wethLastSuccess)],
      });

    it("no two-hop route when the peer's counterparty only carries an old price", async () => {
      const s = viaCarriedWeth(NOW - 3 * DAY_S);
      const x = await refresh(s, X);
      expect(x.pricePerUSDNew).toBe(0n);
      expect(snapsFor(s, X)[0].priceSource).toBe("unpriced");
    });

    it("two-hop route when that counterparty's last success is recent", async () => {
      const s = viaCarriedWeth(NOW - HOUR_S);
      const x = await refresh(s, X);
      expect(x.pricePerUSDNew).toBe(E18 / 20n); // 0.025 Y × $2
      expect(snapsFor(s, X)[0]).toMatchObject({
        pricingHops: 2,
        pricingViaPoolId: pid(P_Y_WETH),
      });
    });
  });
});

/**
 * Tier 2: a connector whose only deep market is against another connector
 * (WBTC / tBTC on Optimism in 2023: about $900K in the stable pool, a few
 * hundred dollars against WETH). Real Optimism addresses, both configured as
 * price connectors. Address order: USDC 0x0b2C… < WBTC 0x68f1… < tBTC 0x6c84….
 */
describe("two-hop pricing through a tier-2 peer", () => {
  const WBTC = toChecksumAddress("0x68f180fcCe6836688e9084f035309E29Bf0A2095");
  const TBTC = toChecksumAddress("0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40");
  const P_TBTC_USDC = addr(0xd1); // tBTC direct: $100K USDC vs 2 tBTC → $50K
  const P_WBTC_TBTC = addr(0xd2); // peer: 10 WBTC vs 10 tBTC
  const P_WBTC_VELO = addr(0xd3);

  const connectorStore = (pools: ReturnType<typeof makePool>[]) =>
    createPricingStore({
      tokens: [
        makeToken(OP, OP_USDC, 6n, USD(1), STALE),
        makeToken(OP, WBTC, 8n, 0n, STALE),
        makeToken(OP, TBTC, 18n, 0n, STALE),
      ],
      pools,
      pricingPools: {
        [id(TBTC)]: [pid(P_TBTC_USDC), pid(P_WBTC_TBTC)],
        [id(WBTC)]: [pid(P_WBTC_TBTC)],
      },
    });
  const tbtcUsdc = (usdc: bigint) =>
    makePool(OP, P_TBTC_USDC, OP_USDC, TBTC, {
      reserve0: usdc * 10n ** 6n,
      reserve1: (usdc * E18) / 50_000n,
    });
  const wbtcTbtc = makePool(OP, P_WBTC_TBTC, WBTC, TBTC, {
    reserve0: 10n * 10n ** 8n,
    reserve1: 10n * E18,
  });

  it("both tokens are connectors, and their pool registers for both", () => {
    expect(getPricingTier(OP, WBTC)).toBe(PRICING_TIER.CONNECTOR);
    expect(getPricingTier(OP, TBTC)).toBe(PRICING_TIER.CONNECTOR);
    expect(getPricingPoolTargets(OP, WBTC, TBTC)).toEqual([id(WBTC), id(TBTC)]);
  });

  it("prices a connector through a connector peer that has a direct route", async () => {
    const s = connectorStore([tbtcUsdc(100_000n), wbtcTbtc]);
    const wbtc = await refresh(s, WBTC);
    expect(wbtc.pricePerUSDNew).toBe(USD(50_000));
    expect(snapsFor(s, WBTC)).toEqual([
      expect.objectContaining({
        priceSource: "pool",
        pricingHops: 2,
        pricingPoolId: pid(P_WBTC_TBTC),
        pricingViaTokenId: id(TBTC),
        pricingViaPoolId: pid(P_TBTC_USDC),
        pricingDepthUSD: USD(100_000), // min($500K peer pool, $100K direct)
      }),
    ]);
  });

  it("gives no route when the peer's own direct market is under the floor", async () => {
    const s = connectorStore([tbtcUsdc(4_000n), wbtcTbtc]);
    const wbtc = await refresh(s, WBTC);
    expect(wbtc.pricePerUSDNew).toBe(0n);
  });

  it("never chains through a second connector peer", async () => {
    // VELO is a connector with no pools here; WBTC's only pool is against it.
    const VELO = toChecksumAddress(
      "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    );
    const s = createPricingStore({
      tokens: [
        makeToken(OP, OP_USDC, 6n, USD(1), STALE),
        makeToken(OP, WBTC, 8n, 0n, STALE),
        makeToken(OP, VELO, 18n, USD(1), STALE - DAY_S),
      ],
      pools: [
        makePool(OP, P_WBTC_VELO, WBTC, VELO, {
          reserve0: 10n * 10n ** 8n,
          reserve1: 500_000n * E18,
        }),
      ],
      pricingPools: { [id(WBTC)]: [pid(P_WBTC_VELO)] },
    });
    const wbtc = await refresh(s, WBTC);
    expect(wbtc.pricePerUSDNew).toBe(0n); // VELO's stored price is never used
  });
});
