import type { Token } from "envio";
import { PoolId, TokenId, toChecksumAddress } from "../src/Constants";
import type { handlerContext } from "../src/EntityTypes";
import * as PriceOracle from "../src/PriceOracle";
import { TokenPriceSnapshotId } from "../src/Snapshots/TokenPriceSnapshot";
import {
  DAY_S,
  E18,
  HOUR_S,
  HOUR_START_S,
  LISK,
  LISK_USDT,
  OP,
  OP_MANATEE,
  OP_TOKEN_X,
  OP_USDC,
  OP_VELO,
  OP_WETH,
  Q96,
  USD,
  XVELO,
  createPricingStore,
  makePool,
  makeToken,
} from "./Pricing/pricingHarness";

const addr = (n: number): string =>
  toChecksumAddress(`0x${n.toString(16).padStart(40, "0")}`);

const P_WETH_USDC = addr(0xa1); // CL USDC/WETH: WETH = $2,500, $1M a side
const P_VELO_WETH = addr(0xa2); // V2 WETH/VELO: VELO = $0.10, $250K WETH side
const P_X_VELO = addr(0xa3); // V2 X/VELO: X = $0.05, $50K VELO side
const P_X_USDC = addr(0xa4); // V2 USDC/X: X = $0.20, $2K USDC side (below the $5K floor)
const P_X_WETH = addr(0xa5); // V2 X/WETH: X = $0.06, $500K WETH side

/** Event time: 10 minutes into a clock hour. */
const NOW = HOUR_START_S + 10 * 60;
/** Two hours before NOW: every seeded token is due. */
const STALE = NOW - 2 * HOUR_S;

function poolWethUsdc() {
  // token0 = USDC (0x0b2C…), token1 = WETH (0x4200…); raw price 4e8 → $2,500.
  return makePool(OP, P_WETH_USDC, OP_USDC, OP_WETH, {
    isCL: true,
    sqrtPriceX96: 20_000n * Q96,
    reserve0: 1_000_000n * 10n ** 6n,
    reserve1: 400n * E18,
  });
}
function poolVeloWeth() {
  // token0 = WETH, token1 = VELO: 100 WETH ($250K) vs 2.5M VELO → $0.10.
  return makePool(OP, P_VELO_WETH, OP_WETH, OP_VELO, {
    reserve0: 100n * E18,
    reserve1: 2_500_000n * E18,
  });
}
function poolXVelo() {
  // token0 = X, token1 = VELO: 1M X vs 500K VELO ($50K) → X = 0.5 VELO = $0.05.
  return makePool(OP, P_X_VELO, OP_TOKEN_X, OP_VELO, {
    reserve0: 1_000_000n * E18,
    reserve1: 500_000n * E18,
  });
}
function poolXUsdc() {
  // token0 = USDC, token1 = X: $2K vs 10K X → $0.20, but under the floor.
  return makePool(OP, P_X_USDC, OP_USDC, OP_TOKEN_X, {
    reserve0: 2_000n * 10n ** 6n,
    reserve1: 10_000n * E18,
  });
}
function poolXWeth() {
  // token0 = X, token1 = WETH: 200 WETH ($500K) vs 8.33M X → $0.06.
  return makePool(OP, P_X_WETH, OP_TOKEN_X, OP_WETH, {
    reserve0: (25_000_000n * E18) / 3n,
    reserve1: 200n * E18,
  });
}

/** A standard Optimism store: USDC, WETH (stale $2,000), VELO (stale $0.08), X. */
function opStore(
  overrides: {
    tokens?: Token[];
    extraPools?: ReturnType<typeof makePool>[];
    pricingPools?: Record<string, string[]>;
  } = {},
) {
  const tokens = [
    makeToken(OP, OP_USDC, 6n, USD(1), STALE),
    makeToken(OP, OP_WETH, 18n, USD(2_000), STALE),
    makeToken(OP, OP_VELO, 18n, (8n * E18) / 100n, STALE),
    makeToken(OP, OP_TOKEN_X, 18n, 0n, STALE),
  ];
  const byId = new Map(tokens.map((t) => [t.id, t]));
  for (const t of overrides.tokens ?? []) byId.set(t.id, t);
  return createPricingStore({
    tokens: [...byId.values()],
    pools: [
      poolWethUsdc(),
      poolVeloWeth(),
      poolXVelo(),
      poolXUsdc(),
      ...(overrides.extraPools ?? []),
    ],
    pricingPools: overrides.pricingPools ?? {
      [TokenId(OP, OP_WETH)]: [PoolId(OP, P_WETH_USDC)],
      [TokenId(OP, OP_VELO)]: [PoolId(OP, P_VELO_WETH)],
      [TokenId(OP, OP_TOKEN_X)]: [PoolId(OP, P_X_USDC), PoolId(OP, P_X_VELO)],
    },
  });
}

async function refresh(
  store: ReturnType<typeof createPricingStore>,
  chainId: number,
  address: string,
  timestamp = NOW,
): Promise<Token> {
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

const snapshotsFor = (
  store: ReturnType<typeof createPricingStore>,
  address: string,
) => store.snapshots.filter((s) => s.address === address);

describe("PriceOracle", () => {
  describe("refreshTokenPrice", () => {
    it("refuses to stamp a token with another chain's block time", async () => {
      const store = opStore();
      const before = store.tokens.get(TokenId(OP, OP_WETH));
      if (!before) throw new Error("missing WETH");
      const result = await PriceOracle.refreshTokenPrice(
        before,
        1,
        NOW,
        LISK,
        store.context,
      );
      expect(result).toBe(before);
      expect(store.context.Token.set).not.toHaveBeenCalled();
      expect(store.snapshots).toHaveLength(0);
      expect(store.context.log.error).toHaveBeenCalledWith(
        expect.stringContaining("Refusing to refresh"),
      );
    });

    describe("strict hourly throttle", () => {
      it("does nothing when the token was already refreshed this clock hour", async () => {
        const store = opStore({
          tokens: [makeToken(OP, OP_TOKEN_X, 18n, USD(1), HOUR_START_S + 60)],
        });
        const before = store.tokens.get(TokenId(OP, OP_TOKEN_X));
        const result = await refresh(store, OP, OP_TOKEN_X);
        expect(result).toBe(before);
        expect(store.context.Token.set).not.toHaveBeenCalled();
        expect(store.snapshots).toHaveLength(0);
        expect(store.context.TokenPricingPools.get).not.toHaveBeenCalled();
      });

      it("has no bypass for whitelisted tokens that were never priced", async () => {
        // Formerly (#862) such tokens refreshed and snapshotted on every event.
        const neverPriced = makeToken(OP, OP_TOKEN_X, 18n, 0n, NOW - 60, {
          isWhitelisted: true,
          lastSuccessfulPriceTimestamp: undefined,
        });
        const store = opStore({ tokens: [neverPriced] });
        await refresh(store, OP, OP_TOKEN_X);
        expect(store.snapshots).toHaveLength(0);
      });

      it("writes at most one snapshot per token per clock hour", async () => {
        const store = opStore();
        for (const minute of [10, 11, 25, 59]) {
          await refresh(store, OP, OP_TOKEN_X, HOUR_START_S + minute * 60);
        }
        expect(snapshotsFor(store, OP_TOKEN_X)).toHaveLength(1);
        expect(snapshotsFor(store, OP_WETH)).toHaveLength(1);

        await refresh(store, OP, OP_TOKEN_X, HOUR_START_S + HOUR_S + 5);
        const xSnapshots = snapshotsFor(store, OP_TOKEN_X);
        expect(xSnapshots).toHaveLength(2);
        expect(new Set(xSnapshots.map((s) => s.id)).size).toBe(2);
        expect(xSnapshots[1].id).toBe(
          TokenPriceSnapshotId(
            OP,
            OP_TOKEN_X,
            new Date((HOUR_START_S + HOUR_S) * 1000),
          ),
        );
      });

      it("a blacklisted token is throttled like any other", async () => {
        const store = createPricingStore({
          tokens: [makeToken(OP, OP_MANATEE, 18n, 0n, STALE)],
        });
        await refresh(store, OP, OP_MANATEE, NOW);
        await refresh(store, OP, OP_MANATEE, NOW + 60);
        await refresh(store, OP, OP_MANATEE, NOW + 120);
        expect(store.snapshots).toHaveLength(1);
      });
    });

    describe("tier 0", () => {
      it("pins a stablecoin at exactly $1 without reading pools", async () => {
        const store = opStore({
          tokens: [makeToken(OP, OP_USDC, 6n, 0n, STALE)],
        });
        const usdc = await refresh(store, OP, OP_USDC);
        expect(usdc.pricePerUSDNew).toBe(USD(1));
        expect(usdc.lastSuccessfulPriceTimestamp).toEqual(new Date(NOW * 1000));
        expect(store.context.TokenPricingPools.get).not.toHaveBeenCalled();
        expect(store.snapshots[0]).toMatchObject({
          priceSource: "pinned",
          pricePerUSDNew: USD(1),
        });
      });
    });

    describe("pool route", () => {
      it("prices WETH through its tier-0 pool and records pool + depth", async () => {
        const store = opStore();
        const weth = await refresh(store, OP, OP_WETH);
        expect(weth.pricePerUSDNew).toBe(USD(2_500));
        expect(weth.lastUpdatedTimestamp).toEqual(new Date(NOW * 1000));
        expect(weth.lastSuccessfulPriceTimestamp).toEqual(new Date(NOW * 1000));
        expect(store.tokens.get(TokenId(OP, OP_WETH))).toEqual(weth);
        expect(snapshotsFor(store, OP_WETH)).toEqual([
          expect.objectContaining({
            id: TokenPriceSnapshotId(OP, OP_WETH, new Date(NOW * 1000)),
            pricePerUSDNew: USD(2_500),
            priceSource: "pool",
            pricingPoolId: PoolId(OP, P_WETH_USDC),
            pricingDepthUSD: USD(1_000_000),
            lastUpdatedTimestamp: new Date(NOW * 1000),
          }),
        ]);
      });

      it("refreshes due counterparties first, down the tiers (X → VELO → WETH → USDC)", async () => {
        const store = opStore();
        const x = await refresh(store, OP, OP_TOKEN_X);

        // WETH re-priced to $2,500 before VELO used it; VELO to $0.10 before X.
        expect(store.tokens.get(TokenId(OP, OP_WETH))?.pricePerUSDNew).toBe(
          USD(2_500),
        );
        expect(store.tokens.get(TokenId(OP, OP_VELO))?.pricePerUSDNew).toBe(
          E18 / 10n,
        );
        // X through VELO at the fresh $0.10 (the stale $0.08 would give $0.04).
        expect(x.pricePerUSDNew).toBe((5n * E18) / 100n);
        // Snapshot order proves the ordering: each counterparty before its user.
        expect(store.snapshots.map((s) => s.address)).toEqual([
          OP_USDC,
          OP_WETH,
          OP_VELO,
          OP_TOKEN_X,
        ]);
        expect(snapshotsFor(store, OP_TOKEN_X)[0]).toMatchObject({
          priceSource: "pool",
          pricingPoolId: PoolId(OP, P_X_VELO),
          pricingDepthUSD: USD(50_000),
        });
      });

      it("does not re-refresh a counterparty already refreshed this hour", async () => {
        const store = opStore({
          tokens: [makeToken(OP, OP_VELO, 18n, E18 / 10n, NOW - 60)],
        });
        await refresh(store, OP, OP_TOKEN_X);
        expect(snapshotsFor(store, OP_VELO)).toHaveLength(0);
        expect(snapshotsFor(store, OP_WETH)).toHaveLength(0);
        expect(store.tokens.get(TokenId(OP, OP_TOKEN_X))?.pricePerUSDNew).toBe(
          (5n * E18) / 100n,
        );
      });

      it("takes the deepest qualifying pool", async () => {
        const store = opStore({
          extraPools: [poolXWeth()],
          pricingPools: {
            [TokenId(OP, OP_WETH)]: [PoolId(OP, P_WETH_USDC)],
            [TokenId(OP, OP_VELO)]: [PoolId(OP, P_VELO_WETH)],
            [TokenId(OP, OP_TOKEN_X)]: [
              PoolId(OP, P_X_USDC),
              PoolId(OP, P_X_VELO),
              PoolId(OP, P_X_WETH),
            ],
          },
        });
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(x.pricePerUSDNew).toBe((6n * E18) / 100n);
        expect(snapshotsFor(store, OP_TOKEN_X)[0]).toMatchObject({
          pricingPoolId: PoolId(OP, P_X_WETH),
          pricingDepthUSD: USD(500_000),
        });
      });

      it("skips a deep pool whose token side is over 1000x its counterparty side", async () => {
        // A V2 volatile pool is always value-balanced at its spot price, so the
        // bound bites on CL (one-sided ranges). sqrtPrice = Q96/2 → X = 0.25
        // WETH = $625; 1M X ($625M) against 200 WETH ($500K) is 1250x.
        const poisoned = makePool(OP, P_X_WETH, OP_TOKEN_X, OP_WETH, {
          isCL: true,
          sqrtPriceX96: Q96 / 2n,
          reserve0: 1_000_000n * E18,
          reserve1: 200n * E18,
        });
        const store = opStore({
          extraPools: [poisoned],
          pricingPools: {
            [TokenId(OP, OP_WETH)]: [PoolId(OP, P_WETH_USDC)],
            [TokenId(OP, OP_VELO)]: [PoolId(OP, P_VELO_WETH)],
            [TokenId(OP, OP_TOKEN_X)]: [
              PoolId(OP, P_X_VELO),
              PoolId(OP, P_X_WETH),
            ],
          },
        });
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(x.pricePerUSDNew).toBe((5n * E18) / 100n);
        expect(snapshotsFor(store, OP_TOKEN_X)[0].pricingPoolId).toBe(
          PoolId(OP, P_X_VELO),
        );
      });

      it("ignores a registered pool whose counterparty is not in a lower tier", async () => {
        // A corrupt row listing VELO/WETH under WETH must not recurse into VELO.
        const store = opStore({
          pricingPools: {
            [TokenId(OP, OP_WETH)]: [
              PoolId(OP, P_VELO_WETH),
              PoolId(OP, P_WETH_USDC),
            ],
            [TokenId(OP, OP_VELO)]: [PoolId(OP, P_VELO_WETH)],
          },
        });
        const weth = await refresh(store, OP, OP_WETH);
        expect(weth.pricePerUSDNew).toBe(USD(2_500));
        expect(snapshotsFor(store, OP_VELO)).toHaveLength(0);
      });

      it("never calls an RPC effect", async () => {
        const store = opStore();
        await refresh(store, OP, OP_TOKEN_X);
        expect(store.effectCalls).toEqual([]);
      });
    });

    describe("missing data never zeroes a good price", () => {
      const onlyShallowPool = {
        [TokenId(OP, OP_TOKEN_X)]: [PoolId(OP, P_X_USDC)],
      };

      it("carries the last price when no pool qualifies", async () => {
        const lastSuccess = NOW - 3 * DAY_S;
        const store = opStore({
          tokens: [makeToken(OP, OP_TOKEN_X, 18n, USD(7), lastSuccess)],
          pricingPools: onlyShallowPool,
        });
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(x.pricePerUSDNew).toBe(USD(7));
        expect(x.lastUpdatedTimestamp).toEqual(new Date(NOW * 1000));
        expect(x.lastSuccessfulPriceTimestamp).toEqual(
          new Date(lastSuccess * 1000),
        );
        expect(snapshotsFor(store, OP_TOKEN_X)[0]).toMatchObject({
          priceSource: "carried",
          pricePerUSDNew: USD(7),
          pricingPoolId: undefined,
        });
      });

      it("carries when the counterparty has no price", async () => {
        const lastSuccess = NOW - DAY_S;
        const store = opStore({
          tokens: [
            makeToken(OP, OP_TOKEN_X, 18n, USD(7), lastSuccess),
            makeToken(OP, OP_VELO, 18n, 0n, NOW - 60), // unpriced, not due
          ],
          pricingPools: { [TokenId(OP, OP_TOKEN_X)]: [PoolId(OP, P_X_VELO)] },
        });
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(x.pricePerUSDNew).toBe(USD(7));
        expect(snapshotsFor(store, OP_TOKEN_X)[0].priceSource).toBe("carried");
      });

      it("drops to 0 after 7 days without a successful price", async () => {
        const store = opStore({
          tokens: [makeToken(OP, OP_TOKEN_X, 18n, USD(7), NOW - 7 * DAY_S)],
          pricingPools: onlyShallowPool,
        });
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(x.pricePerUSDNew).toBe(0n);
        expect(snapshotsFor(store, OP_TOKEN_X)[0]).toMatchObject({
          priceSource: "unpriced",
          pricePerUSDNew: 0n,
        });
      });

      it.each([
        ["WETH (tier 1)", OP_WETH, USD(2_400)],
        ["a connector (tier 2)", OP_VELO, USD(1) / 10n],
      ])(
        "drops %s to 0 after 7 days like any other token, with the age on the last carried snapshot",
        async (_, address, price) => {
          const at6d = NOW - 6 * DAY_S;
          const carried = opStore({
            tokens: [makeToken(OP, address, 18n, price, at6d)],
            pricingPools: { [TokenId(OP, address)]: [] },
          });
          expect((await refresh(carried, OP, address)).pricePerUSDNew).toBe(
            price,
          );
          expect(snapshotsFor(carried, address)[0]).toMatchObject({
            priceSource: "carried",
            lastSuccessfulPriceTimestamp: new Date(at6d * 1000),
          });

          const expired = opStore({
            tokens: [makeToken(OP, address, 18n, price, NOW - 7 * DAY_S)],
            pricingPools: { [TokenId(OP, address)]: [] },
          });
          expect((await refresh(expired, OP, address)).pricePerUSDNew).toBe(0n);
          expect(snapshotsFor(expired, address)[0].priceSource).toBe(
            "unpriced",
          );
        },
      );

      it("records the success time on a fresh snapshot", async () => {
        const store = opStore();
        await refresh(store, OP, OP_WETH);
        expect(snapshotsFor(store, OP_WETH)[0]).toMatchObject({
          priceSource: "pool",
          lastSuccessfulPriceTimestamp: new Date(NOW * 1000),
        });
      });

      it("treats a failed store read as 'nothing qualified' and logs it", async () => {
        const store = opStore({
          tokens: [makeToken(OP, OP_TOKEN_X, 18n, USD(7), NOW - DAY_S)],
        });
        vi.mocked(store.context.TokenPricingPools.get).mockRejectedValueOnce(
          new Error("db down"),
        );
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(x.pricePerUSDNew).toBe(USD(7));
        expect(snapshotsFor(store, OP_TOKEN_X)[0].priceSource).toBe("carried");
        expect(store.context.log.error).toHaveBeenCalledWith(
          expect.stringContaining("db down"),
        );
      });
    });

    describe("blacklist", () => {
      it("forces a blacklisted token to 0 without reading its pools", async () => {
        const store = createPricingStore({
          tokens: [makeToken(OP, OP_MANATEE, 18n, USD(80_000), STALE)],
          pricingPools: { [TokenId(OP, OP_MANATEE)]: [PoolId(OP, P_X_USDC)] },
        });
        const manatee = await refresh(store, OP, OP_MANATEE);
        expect(manatee.pricePerUSDNew).toBe(0n);
        expect(manatee.lastSuccessfulPriceTimestamp).toEqual(
          new Date(STALE * 1000),
        );
        expect(store.context.TokenPricingPools.get).not.toHaveBeenCalled();
        expect(store.snapshots[0].priceSource).toBe("override");
      });
    });

    describe("canonical cross-chain candidate (ADR 0004)", () => {
      // Lisk WETH (0x4200…0006) has Optimism WETH as its canonical source.
      const LISK_WETH = OP_WETH;
      const P_WETH_USDT = addr(0xb1);
      const P_XVELO_WETH = addr(0xb2);
      const OP_DEPTH = USD(9_000_000);

      /** Lisk USDT/WETH: token0 = USDT (0x05D0…), token1 = WETH (0x4200…). */
      const liskWethPool = (usdt: bigint, weth: bigint) =>
        makePool(LISK, P_WETH_USDT, LISK_USDT, LISK_WETH, {
          reserve0: usdt,
          reserve1: weth,
        });
      /** $1,300 of USDT vs 0.5 WETH → $2,600 per WETH, just over the $1K floor. */
      const thinPool = () => liskWethPool(1_300n * 10n ** 6n, E18 / 2n);
      /** $500 of USDT vs 0.2 WETH → $2,500, below the floor. */
      const subFloorPool = () => liskWethPool(500n * 10n ** 6n, E18 / 5n);

      function liskStore(opts: {
        pool?: ReturnType<typeof makePool>;
        sourceAt: number;
        sourceDepth?: bigint;
        extraTokens?: Token[];
        extraPools?: ReturnType<typeof makePool>[];
        extraPricingPools?: Record<string, string[]>;
      }) {
        return createPricingStore({
          tokens: [
            makeToken(LISK, LISK_USDT, 6n, USD(1), STALE),
            makeToken(LISK, LISK_WETH, 18n, USD(2_000), NOW - 2 * DAY_S),
            makeToken(OP, OP_WETH, 18n, USD(2_500), opts.sourceAt, {
              pricingDepthUSD: opts.sourceDepth,
            }),
            ...(opts.extraTokens ?? []),
          ],
          pools: [
            ...(opts.pool ? [opts.pool] : []),
            ...(opts.extraPools ?? []),
          ],
          pricingPools: {
            ...(opts.pool
              ? { [TokenId(LISK, LISK_WETH)]: [PoolId(LISK, P_WETH_USDT)] }
              : {}),
            ...opts.extraPricingPools,
          },
        });
      }

      it("canonical wins over a thin local pool when deeper and time-aligned", async () => {
        const store = liskStore({
          pool: thinPool(),
          sourceAt: NOW - 30 * 60,
          sourceDepth: OP_DEPTH,
        });
        const weth = await refresh(store, LISK, LISK_WETH);
        expect(weth.pricePerUSDNew).toBe(USD(2_500));
        expect(weth.pricingDepthUSD).toBe(OP_DEPTH);
        expect(weth.lastSuccessfulPriceTimestamp).toEqual(new Date(NOW * 1000));
        expect(store.snapshots.at(-1)).toMatchObject({
          address: LISK_WETH,
          chainId: LISK,
          priceSource: "canonical",
          pricingSourceTokenId: TokenId(OP, OP_WETH),
          pricingDepthUSD: OP_DEPTH,
          pricingPoolId: undefined,
        });
        // The source is read, never refreshed from the target chain.
        expect(store.snapshots.some((s) => s.chainId === OP)).toBe(false);
        expect(store.effectCalls).toEqual([]);
      });

      it.each([
        ["behind (stale)", NOW - 3 * HOUR_S],
        ["ahead (from the future)", NOW + 3 * HOUR_S],
        ["months ahead in a backfill", NOW + 90 * DAY_S],
      ])(
        "local wins when the canonical source is misaligned: %s",
        async (_, at) => {
          const store = liskStore({
            pool: thinPool(),
            sourceAt: at,
            sourceDepth: OP_DEPTH,
          });
          const weth = await refresh(store, LISK, LISK_WETH);
          expect(weth.pricePerUSDNew).toBe(USD(2_600));
          expect(weth.pricingDepthUSD).toBe(USD(1_300));
          expect(store.snapshots.at(-1)).toMatchObject({
            priceSource: "pool",
            pricingPoolId: PoolId(LISK, P_WETH_USDT),
            pricingSourceTokenId: undefined,
          });
        },
      );

      it("local wins when it is deeper than the canonical source", async () => {
        const store = liskStore({
          pool: liskWethPool(20_000_000n * 10n ** 6n, 8_000n * E18),
          sourceAt: NOW - 30 * 60,
          sourceDepth: OP_DEPTH,
        });
        const weth = await refresh(store, LISK, LISK_WETH);
        expect(weth.pricePerUSDNew).toBe(USD(2_500));
        expect(store.snapshots.at(-1)?.priceSource).toBe("pool");
      });

      it("uses the canonical source when no local pool clears the floor", async () => {
        const store = liskStore({
          pool: subFloorPool(),
          sourceAt: NOW - 30 * 60,
          sourceDepth: OP_DEPTH,
        });
        const weth = await refresh(store, LISK, LISK_WETH);
        expect(weth.pricePerUSDNew).toBe(USD(2_500));
        expect(store.snapshots.at(-1)?.priceSource).toBe("canonical");
      });

      it("a source with no recorded depth never qualifies (local pool or carry instead)", async () => {
        const withPool = liskStore({ pool: thinPool(), sourceAt: NOW - 60 });
        expect((await refresh(withPool, LISK, LISK_WETH)).pricePerUSDNew).toBe(
          USD(2_600),
        );
        expect(withPool.snapshots.at(-1)?.priceSource).toBe("pool");

        const noPool = liskStore({ sourceAt: NOW - 60 });
        const weth = await refresh(noPool, LISK, LISK_WETH);
        expect(weth.pricePerUSDNew).toBe(USD(2_000));
        expect(noPool.snapshots.at(-1)?.priceSource).toBe("carried");
      });

      it("XVELO still binds to Optimism VELO", async () => {
        const store = createPricingStore({
          tokens: [
            makeToken(LISK, XVELO, 18n, USD(1) / 20n, NOW - 2 * DAY_S),
            makeToken(OP, OP_VELO, 18n, E18 / 10n, NOW - HOUR_S, {
              pricingDepthUSD: USD(250_000),
            }),
          ],
        });
        const xvelo = await refresh(store, LISK, XVELO);
        expect(xvelo.pricePerUSDNew).toBe(E18 / 10n);
        expect(store.snapshots.at(-1)).toMatchObject({
          priceSource: "canonical",
          pricingSourceTokenId: TokenId(OP, OP_VELO),
        });
      });

      it("stays acyclic: the cross-chain source is read, never refreshed or routed", async () => {
        // XVELO (tier 2) → Lisk WETH (tier 1, refreshed as its counterparty) →
        // reads Optimism WETH. Optimism WETH is due (last refresh 90 min ago)
        // and has a pricing-pool row, yet neither is touched.
        const xveloPool = makePool(LISK, P_XVELO_WETH, LISK_WETH, XVELO, {
          reserve0: 10n * E18, // $25K of WETH at the canonical $2,500
          reserve1: 250_000n * E18,
        });
        const store = liskStore({
          pool: thinPool(),
          sourceAt: NOW - 90 * 60,
          sourceDepth: OP_DEPTH,
          extraTokens: [makeToken(LISK, XVELO, 18n, 0n, STALE)],
          extraPools: [xveloPool],
          extraPricingPools: {
            [TokenId(LISK, XVELO)]: [PoolId(LISK, P_XVELO_WETH)],
            [TokenId(OP, OP_WETH)]: [PoolId(OP, P_WETH_USDC)],
          },
        });
        const xvelo = await refresh(store, LISK, XVELO);
        // OP VELO is absent, so XVELO prices through Lisk WETH ($2,500, canonical).
        expect(xvelo.pricePerUSDNew).toBe(E18 / 10n);
        expect(store.context.TokenPricingPools.get).not.toHaveBeenCalledWith(
          TokenId(OP, OP_WETH),
        );
        expect(store.snapshots.some((s) => s.chainId === OP)).toBe(false);
        expect(store.snapshots.map((s) => s.address)).toEqual([
          LISK_USDT,
          LISK_WETH,
          XVELO,
        ]);
      });
    });

    describe("a route is only as fresh as its base (counterparty freshness)", () => {
      // X's only route is X/VELO ($50K of VELO). VELO has no route of its own
      // here, so its refresh carries whatever it last had.
      const xOnlyViaVelo = (veloLastSuccess: number) =>
        opStore({
          tokens: [
            makeToken(OP, OP_TOKEN_X, 18n, USD(7) / 100n, NOW - DAY_S),
            makeToken(OP, OP_VELO, 18n, E18 / 10n, veloLastSuccess),
          ],
          pricingPools: {
            [TokenId(OP, OP_TOKEN_X)]: [PoolId(OP, P_X_VELO)],
            [TokenId(OP, OP_VELO)]: [],
          },
        });

      it("does not price through a counterparty that is only carrying an old price", async () => {
        const store = xOnlyViaVelo(NOW - 3 * DAY_S);
        const x = await refresh(store, OP, OP_TOKEN_X);
        // VELO carried (3 days old): X keeps its own last price instead of a
        // pool price built on the stale VELO.
        expect(snapshotsFor(store, OP_VELO)[0].priceSource).toBe("carried");
        expect(x.pricePerUSDNew).toBe(USD(7) / 100n);
        expect(snapshotsFor(store, OP_TOKEN_X)[0]).toMatchObject({
          priceSource: "carried",
          pricingPoolId: undefined,
        });
      });

      it("still prices through a counterparty whose last success is within the window", async () => {
        const store = xOnlyViaVelo(NOW - 90 * 60);
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(x.pricePerUSDNew).toBe(E18 / 20n); // 0.5 VELO at $0.10
        expect(snapshotsFor(store, OP_TOKEN_X)[0]).toMatchObject({
          priceSource: "pool",
          pricingPoolId: PoolId(OP, P_X_VELO),
        });
      });

      it("a quiet but healthy counterparty is refreshed first and so is fresh", async () => {
        // VELO last succeeded days ago but its own pool still qualifies: the
        // due refresh re-prices it from pool state, so X's route stands.
        const store = opStore({
          tokens: [
            makeToken(OP, OP_TOKEN_X, 18n, 0n, STALE),
            makeToken(OP, OP_VELO, 18n, E18 / 10n, NOW - 3 * DAY_S),
          ],
          pricingPools: {
            [TokenId(OP, OP_TOKEN_X)]: [PoolId(OP, P_X_VELO)],
            [TokenId(OP, OP_VELO)]: [PoolId(OP, P_VELO_WETH)],
            [TokenId(OP, OP_WETH)]: [PoolId(OP, P_WETH_USDC)],
          },
        });
        const x = await refresh(store, OP, OP_TOKEN_X);
        expect(snapshotsFor(store, OP_VELO)[0].priceSource).toBe("pool");
        expect(snapshotsFor(store, OP_TOKEN_X)[0].priceSource).toBe("pool");
        expect(x.pricePerUSDNew).toBeGreaterThan(0n);
      });

      it("a pinned counterparty is always fresh", async () => {
        const store = opStore({
          tokens: [
            // Not due this hour, and a success clock far in the past: a
            // pinned token's price never ages, so the route still stands.
            makeToken(OP, OP_USDC, 6n, USD(1), NOW - 60, {
              lastSuccessfulPriceTimestamp: new Date((NOW - 30 * DAY_S) * 1000),
            }),
            makeToken(OP, OP_WETH, 18n, 0n, STALE),
          ],
          pricingPools: { [TokenId(OP, OP_WETH)]: [PoolId(OP, P_WETH_USDC)] },
        });
        const weth = await refresh(store, OP, OP_WETH);
        expect(snapshotsFor(store, OP_WETH)[0].priceSource).toBe("pool");
        expect(weth.pricePerUSDNew).toBeGreaterThan(0n);
      });
    });

    describe("canonical seed fallback (ADR 0008)", () => {
      // 2025-10-09 00:30 UTC: inside the committed seed, where Optimism WETH's
      // hour is $4,438.642991 and Optimism VELO's $0.045575.
      const SEED_HOUR = 1_759_996_800;
      const T = SEED_HOUR + 1800;
      const SEED_WETH = 4_438_642_991n * 10n ** 12n;
      const LISK_WETH = OP_WETH;
      const P_WETH_USDT = addr(0xc1);

      function seedStore(opts: {
        sourceAt?: number; // undefined = no Optimism WETH row at all
        pool?: boolean; // a $1,300 USDT / 0.5 WETH pool (qualifies on Lisk)
        at?: number;
      }) {
        const at = opts.at ?? T;
        return createPricingStore({
          tokens: [
            makeToken(LISK, LISK_USDT, 6n, USD(1), at - DAY_S),
            makeToken(LISK, LISK_WETH, 18n, USD(2_000), at - 2 * DAY_S),
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
        });
      }

      it.each([
        ["months ahead (backfill)", T + 90 * DAY_S],
        ["behind", T - 3 * HOUR_S],
        ["missing", undefined],
      ])(
        "takes the seed's hour when the live source is %s and nothing local qualifies",
        async (_, sourceAt) => {
          const store = seedStore({ sourceAt });
          const weth = await refresh(store, LISK, LISK_WETH, T);
          expect(weth.pricePerUSDNew).toBe(SEED_WETH);
          expect(weth.pricingDepthUSD).toBeUndefined();
          expect(weth.lastSuccessfulPriceTimestamp).toEqual(new Date(T * 1000));
          expect(store.snapshots.at(-1)).toMatchObject({
            priceSource: "canonical-seed",
            pricingSourceTokenId: TokenId(OP, OP_WETH),
            pricingSeedHour: new Date(SEED_HOUR * 1000),
            pricingPoolId: undefined,
            pricingDepthUSD: undefined,
          });
          expect(store.effectCalls).toEqual([]);
        },
      );

      it("live canonical inside the window beats the seed", async () => {
        const store = seedStore({ sourceAt: T - 30 * 60 });
        const weth = await refresh(store, LISK, LISK_WETH, T);
        expect(weth.pricePerUSDNew).toBe(USD(2_500));
        expect(store.snapshots.at(-1)).toMatchObject({
          priceSource: "canonical",
          pricingSeedHour: undefined,
        });
      });

      it("a qualifying local pool beats the seed", async () => {
        const store = seedStore({ sourceAt: T + 90 * DAY_S, pool: true });
        const weth = await refresh(store, LISK, LISK_WETH, T);
        expect(weth.pricePerUSDNew).toBe(USD(2_600));
        expect(store.snapshots.at(-1)?.priceSource).toBe("pool");
      });

      it("outside the seed's range behaves as before (carry)", async () => {
        const at = 1_700_000_000; // 2023-11, before the seed starts
        const store = seedStore({ sourceAt: at + 90 * DAY_S, at });
        const weth = await refresh(store, LISK, LISK_WETH, at);
        expect(weth.pricePerUSDNew).toBe(USD(2_000));
        expect(store.snapshots.at(-1)?.priceSource).toBe("carried");
      });

      it("leaves tokens without a canonical source untouched", async () => {
        const store = createPricingStore({
          tokens: [makeToken(OP, OP_TOKEN_X, 18n, USD(7), T - DAY_S)],
        });
        const x = await refresh(store, OP, OP_TOKEN_X, T);
        expect(x.pricePerUSDNew).toBe(USD(7));
        expect(store.snapshots.at(-1)).toMatchObject({
          priceSource: "carried",
          pricingSeedHour: undefined,
        });
      });

      it("XVELO takes Optimism VELO's seed price", async () => {
        const store = createPricingStore({
          tokens: [makeToken(LISK, XVELO, 18n, 0n, T - DAY_S)],
        });
        const xvelo = await refresh(store, LISK, XVELO, T);
        expect(xvelo.pricePerUSDNew).toBe(45_575_000_000_000_000n);
        expect(store.snapshots.at(-1)).toMatchObject({
          priceSource: "canonical-seed",
          pricingSourceTokenId: TokenId(OP, OP_VELO),
        });
      });
    });

    it("heals empty metadata even when the price refresh is throttled (#735)", async () => {
      const store = opStore({
        tokens: [
          makeToken(OP, OP_TOKEN_X, 18n, USD(1), NOW - 60, {
            symbol: "",
            name: "",
          }),
        ],
      });
      const x = await refresh(store, OP, OP_TOKEN_X);
      expect(x.symbol).toBe("HEAL");
      expect(store.effectCalls).toEqual(["getTokenDetails"]);
      expect(store.snapshots).toHaveLength(0);
    });

    describe("preload pass", () => {
      /** The store's context as envio's preload pass presents it: writes are no-ops. */
      const preloadContext = (store: ReturnType<typeof createPricingStore>) =>
        ({
          ...store.context,
          isPreload: true,
          Token: { ...store.context.Token, set: vi.fn() },
          TokenPriceSnapshot: { set: vi.fn() },
        }) as unknown as handlerContext;

      const refreshIn = (
        store: ReturnType<typeof createPricingStore>,
        context: handlerContext,
        timestamp: number,
      ) => {
        const token = store.tokens.get(TokenId(OP, OP_TOKEN_X));
        if (!token) throw new Error("no token");
        return PriceOracle.refreshTokenPrice(
          token,
          123,
          timestamp,
          OP,
          context,
        );
      };

      it("resolves each (token, hour) once and shares the result", async () => {
        const store = opStore();
        // Clear any memo a previous test's preload left behind.
        await refresh(store, OP, OP_USDC);
        vi.mocked(store.context.TokenPricingPools.get).mockClear();

        const context = preloadContext(store);
        const results = await Promise.all(
          [10, 20, 30].map((minute) =>
            refreshIn(store, context, HOUR_START_S + minute * 60),
          ),
        );

        // X, then its counterparty chain VELO → WETH: one read each, not three.
        expect(store.context.TokenPricingPools.get).toHaveBeenCalledTimes(3);
        expect(results[1]).toBe(results[0]);
        expect(results[2]).toBe(results[0]);

        // Same price the run proper computes for the first event of the hour.
        const runProper = await refresh(
          store,
          OP,
          OP_TOKEN_X,
          HOUR_START_S + 600,
        );
        expect(results[0].pricePerUSDNew).toBe(runProper.pricePerUSDNew);
        expect(results[0].pricePerUSDNew).toBe((5n * E18) / 100n);
      });

      it("does not carry its memo past the batch's run proper", async () => {
        const store = opStore();
        const context = preloadContext(store);
        await refreshIn(store, context, NOW);
        // Run proper of the batch (any due refresh) clears the memo...
        await refresh(store, OP, OP_USDC);
        vi.mocked(store.context.TokenPricingPools.get).mockClear();
        // ...so the next batch's preload resolves (and loads) again.
        await refreshIn(store, context, NOW);
        expect(store.context.TokenPricingPools.get).toHaveBeenCalled();
      });

      it("a different clock hour is resolved separately", async () => {
        const store = opStore();
        const context = preloadContext(store);
        await refresh(store, OP, OP_USDC); // clear the memo
        vi.mocked(store.context.TokenPricingPools.get).mockClear();
        await refreshIn(store, context, NOW);
        const callsFirstHour = vi.mocked(store.context.TokenPricingPools.get)
          .mock.calls.length;
        await refreshIn(store, context, NOW + HOUR_S);
        expect(
          vi.mocked(store.context.TokenPricingPools.get).mock.calls.length,
        ).toBe(callsFirstHour * 2);
      });
    });
  });

  describe("isTokenRefreshNoop (lets loadPoolData skip the async call)", () => {
    // Every combination of the conditions refreshTokenPrice branches on:
    // chain, metadata, and the throttle clock (same hour, earlier hour, never),
    // for a pinned, a WETH, a connector and a tier-3 token, priced or not.
    const clocks = {
      sameHour: NOW - 60,
      earlierHour: NOW - 2 * HOUR_S,
      later: NOW + 2 * HOUR_S,
    };
    const cases: Array<{ label: string; token: Token; chainId: number }> = [];
    for (const address of [OP_USDC, OP_WETH, OP_VELO, OP_TOKEN_X]) {
      for (const [clockName, refreshedAt] of Object.entries(clocks)) {
        for (const metadata of ["complete", "noSymbol", "noName"] as const) {
          for (const price of [0n, USD(3)]) {
            for (const chainId of [OP, LISK]) {
              const token = makeToken(OP, address, 18n, price, refreshedAt, {
                symbol: metadata === "noSymbol" ? "" : "TKN",
                name: metadata === "noName" ? "" : "Token",
              });
              cases.push({
                label: `${address.slice(0, 8)} ${clockName} ${metadata} ${price} chain ${chainId}`,
                token,
                chainId,
              });
            }
          }
        }
      }
      cases.push({
        label: `${address.slice(0, 8)} never refreshed`,
        token: makeToken(OP, address, 18n, 0n, NOW, {
          lastUpdatedTimestamp: undefined,
        }),
        chainId: OP,
      });
    }

    it.each(cases)(
      "$label: true exactly when refreshTokenPrice returns its input with no read or write",
      async ({ token, chainId }) => {
        const store = opStore({ tokens: [token] });
        const noop = PriceOracle.isTokenRefreshNoop(token, NOW, chainId);
        const result = await PriceOracle.refreshTokenPrice(
          token,
          123,
          NOW,
          chainId,
          store.context,
        );
        const touched =
          result !== token ||
          vi.mocked(store.context.Token.set).mock.calls.length > 0 ||
          vi.mocked(store.context.Token.get).mock.calls.length > 0 ||
          vi.mocked(store.context.TokenPricingPools.get).mock.calls.length >
            0 ||
          store.snapshots.length > 0 ||
          store.effectCalls.length > 0;
        if (noop) {
          expect(touched).toBe(false);
        } else {
          // The only non-no-op that leaves everything untouched is the
          // cross-chain refusal, which still logs.
          expect(
            touched || vi.mocked(store.context.log.error).mock.calls.length > 0,
          ).toBe(true);
        }
      },
    );
  });

  describe("createTokenEntity", () => {
    const blockTimestamp = HOUR_START_S + 600;

    it("creates the token at price 0 with no success stamp", async () => {
      const store = createPricingStore({});
      const token = await PriceOracle.createTokenEntity(
        OP_TOKEN_X,
        OP,
        1_000_000,
        store.context,
        blockTimestamp,
      );
      if (!token) throw new Error("expected token to be created");
      expect(token).toMatchObject({
        id: TokenId(OP, OP_TOKEN_X),
        address: OP_TOKEN_X,
        chainId: OP,
        symbol: "HEAL",
        name: "Healed",
        decimals: 18n,
        pricePerUSDNew: 0n,
        isWhitelisted: false,
        lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
        lastSuccessfulPriceTimestamp: undefined,
        priceTrustOutcome: "UNTRUSTED",
        priceTrustReason: "NON_WL",
      });
      expect(store.tokens.get(token.id)).toBe(token);
    });

    it("creates a tier-0 stablecoin at its $1 pin", async () => {
      const store = createPricingStore({});
      const token = await PriceOracle.createTokenEntity(
        OP_USDC,
        OP,
        1_000_000,
        store.context,
        blockTimestamp,
      );
      expect(token?.pricePerUSDNew).toBe(USD(1));
      expect(token?.lastSuccessfulPriceTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
    });

    it("returns null and writes nothing when the address has no bytecode (#677)", async () => {
      const store = createPricingStore({});
      vi.mocked(store.context.effect).mockImplementation((async (effect: {
        name?: string;
      }) => {
        store.effectCalls.push(effect.name ?? "");
        if (effect.name === "hasContractBytecode") return { hasCode: false };
        throw new Error("getTokenDetails must not be called");
      }) as never);
      const token = await PriceOracle.createTokenEntity(
        OP_TOKEN_X,
        OP,
        1_000_000,
        store.context,
        blockTimestamp,
      );
      expect(token).toBeNull();
      expect(store.context.Token.set).not.toHaveBeenCalled();
      expect(store.effectCalls).toEqual(["hasContractBytecode"]);
    });
  });

  describe("initialTokenPriceFields", () => {
    const createdAt = new Date(HOUR_START_S * 1000);

    it("pins tier-0 tokens and stamps the success clock", () => {
      expect(
        PriceOracle.initialTokenPriceFields(OP, OP_USDC, createdAt),
      ).toEqual({
        pricePerUSDNew: USD(1),
        lastSuccessfulPriceTimestamp: createdAt,
      });
    });

    it("starts everything else at 0", () => {
      expect(
        PriceOracle.initialTokenPriceFields(OP, OP_WETH, createdAt),
      ).toEqual({
        pricePerUSDNew: 0n,
        lastSuccessfulPriceTimestamp: undefined,
      });
    });
  });

  describe("healTokenMetadata (#735, #820)", () => {
    const base = makeToken(OP, OP_TOKEN_X, 18n, USD(1), HOUR_START_S);

    function contextWithDetails(
      details: { name: string; symbol: string; decimals: number } | Error = {
        name: "Test Token",
        symbol: "TEST",
        decimals: 18,
      },
    ) {
      const store = createPricingStore({});
      vi.mocked(store.context.effect).mockImplementation((async () => {
        if (details instanceof Error) throw details;
        return details;
      }) as never);
      return store.context as handlerContext;
    }

    it("heals an empty-symbol token and writes the result", async () => {
      const context = contextWithDetails();
      const healed = await PriceOracle.healTokenMetadata(
        { ...base, symbol: "", name: "" },
        OP,
        context,
      );
      expect(healed.symbol).toBe("TEST");
      expect(healed.name).toBe("Test Token");
      expect(context.Token.set).toHaveBeenCalledWith(healed);
    });

    it("short-circuits without an effect call when metadata is populated", async () => {
      const context = contextWithDetails();
      const healed = await PriceOracle.healTokenMetadata(base, OP, context);
      expect(healed).toBe(base);
      expect(context.effect).not.toHaveBeenCalled();
      expect(context.Token.set).not.toHaveBeenCalled();
    });

    it("stages no write when the fresh read is still empty", async () => {
      const context = contextWithDetails({
        name: "",
        symbol: "",
        decimals: 18,
      });
      const input = { ...base, symbol: "", name: "" };
      expect(await PriceOracle.healTokenMetadata(input, OP, context)).toBe(
        input,
      );
      expect(context.Token.set).not.toHaveBeenCalled();
    });

    it("logs and returns the input when getTokenDetails throws", async () => {
      const context = contextWithDetails(new Error("RPC down"));
      const input = { ...base, symbol: "", name: "" };
      expect(await PriceOracle.healTokenMetadata(input, OP, context)).toBe(
        input,
      );
      expect(context.log.error).toHaveBeenCalledWith(
        expect.stringContaining("Error refreshing token metadata"),
      );
    });

    it("re-derives a fallback-origin decimals (#820)", async () => {
      const context = contextWithDetails({
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
      });
      const healed = await PriceOracle.healTokenMetadata(
        { ...base, symbol: "", name: "", decimals: 18n },
        OP,
        context,
      );
      expect(healed.decimals).toBe(6n);
    });

    it("leaves decimals alone when only the name was missing (#820)", async () => {
      const context = contextWithDetails({
        name: "USD Coin",
        symbol: "USDC",
        decimals: 18,
      });
      const healed = await PriceOracle.healTokenMetadata(
        { ...base, symbol: "USDC", name: "", decimals: 6n },
        OP,
        context,
      );
      expect(healed.name).toBe("USD Coin");
      expect(healed.decimals).toBe(6n);
    });
  });
});
