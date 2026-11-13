import { PoolId, TokenId, toChecksumAddress } from "../../src/Constants";
import {
  type PricingCandidate,
  buildCanonicalCandidate,
  buildPricingCandidate,
  combineTwoHopCandidate,
  getPricingPoolTargets,
  isCanonicalSourceAligned,
  isQualifyingCandidate,
  registerPricingPool,
  selectPricingCandidate,
} from "../../src/Pricing/PoolRoute";
import { MAX_ACCEPTED_PRICE } from "../../src/Pricing/PricingConfig";
import {
  E18,
  HOUR_START_S,
  OP,
  OP_DAI,
  OP_TOKEN_X,
  OP_USDC,
  OP_VELO,
  OP_WBTC,
  OP_WETH,
  Q96,
  USD,
  createPricingStore,
  makePool,
  makeToken,
} from "./pricingHarness";

const POOL_A = toChecksumAddress("0xA000000000000000000000000000000000000001");
const POOL_B = toChecksumAddress("0xB000000000000000000000000000000000000002");
const OP_TOKEN_ZERO_DEC = toChecksumAddress(
  "0x3333333333333333333333333333333333333333",
);

const usdc = makeToken(OP, OP_USDC, 6n, USD(1), HOUR_START_S);
const weth = makeToken(OP, OP_WETH, 18n, USD(2_500), HOUR_START_S);

describe("PoolRoute", () => {
  describe("getPricingPoolTargets (candidate registration rule)", () => {
    it("registers the higher-tier side only", () => {
      // tier 3 vs tier 0
      expect(getPricingPoolTargets(OP, OP_USDC, OP_TOKEN_X)).toEqual([
        TokenId(OP, OP_TOKEN_X),
      ]);
      // tier 1 vs tier 0
      expect(getPricingPoolTargets(OP, OP_USDC, OP_WETH)).toEqual([
        TokenId(OP, OP_WETH),
      ]);
      // tier 2 vs tier 1, either token order
      expect(getPricingPoolTargets(OP, OP_WETH, OP_VELO)).toEqual([
        TokenId(OP, OP_VELO),
      ]);
      expect(getPricingPoolTargets(OP, OP_VELO, OP_WETH)).toEqual([
        TokenId(OP, OP_VELO),
      ]);
    });

    it("registers nothing for same-tier pairs in tiers 0-2", () => {
      expect(getPricingPoolTargets(OP, OP_USDC, OP_DAI)).toEqual([]); // 0/0
      expect(getPricingPoolTargets(OP, OP_VELO, OP_WBTC)).toEqual([]); // 2/2
    });

    it("registers a tier-3 / tier-3 pool for both sides as a peer pool (ADR 0007)", () => {
      expect(getPricingPoolTargets(OP, OP_TOKEN_X, OP_TOKEN_ZERO_DEC)).toEqual([
        TokenId(OP, OP_TOKEN_X),
        TokenId(OP, OP_TOKEN_ZERO_DEC),
      ]);
    });
  });

  describe("registerPricingPool", () => {
    it("appends the pool to the higher-tier token's list", async () => {
      const store = createPricingStore({});
      await registerPricingPool(store.context, OP, POOL_A, OP_USDC, OP_WETH);
      expect(store.pricingPools.get(TokenId(OP, OP_WETH))?.pools).toEqual([
        PoolId(OP, POOL_A),
      ]);
      expect(store.pricingPools.has(TokenId(OP, OP_USDC))).toBe(false);
    });

    it("keeps existing entries in creation order and never duplicates", async () => {
      const store = createPricingStore({
        pricingPools: { [TokenId(OP, OP_WETH)]: [PoolId(OP, POOL_A)] },
      });
      await registerPricingPool(store.context, OP, POOL_B, OP_WETH, OP_DAI);
      await registerPricingPool(store.context, OP, POOL_A, OP_USDC, OP_WETH);
      expect(store.pricingPools.get(TokenId(OP, OP_WETH))?.pools).toEqual([
        PoolId(OP, POOL_A),
        PoolId(OP, POOL_B),
      ]);
    });

    it("writes nothing for a same-tier pool in tiers 0-2", async () => {
      const store = createPricingStore({});
      await registerPricingPool(store.context, OP, POOL_A, OP_VELO, OP_WBTC);
      expect(store.pricingPools.size).toBe(0);
    });

    it("appends a tier-3 / tier-3 pool to both tokens' lists", async () => {
      const store = createPricingStore({});
      await registerPricingPool(
        store.context,
        OP,
        POOL_A,
        OP_TOKEN_X,
        OP_TOKEN_ZERO_DEC,
      );
      expect(store.pricingPools.get(TokenId(OP, OP_TOKEN_X))?.pools).toEqual([
        PoolId(OP, POOL_A),
      ]);
      expect(
        store.pricingPools.get(TokenId(OP, OP_TOKEN_ZERO_DEC))?.pools,
      ).toEqual([PoolId(OP, POOL_A)]);
    });
  });

  describe("buildPricingCandidate (pool ratios × counterparty price)", () => {
    it("CL: prices token1 (WETH, 18 dec) through token0 (USDC, 6 dec) from sqrtPriceX96", () => {
      // raw token1/token0 = (20000)^2 = 4e8 wei per micro-USDC
      //   → 4e8 · 1e6 / 1e18 = 0.0004 WETH per USDC → $2,500 per WETH.
      const pool = makePool(OP, POOL_A, OP_USDC, OP_WETH, {
        isCL: true,
        sqrtPriceX96: 20_000n * Q96,
        reserve0: 1_000_000n * 10n ** 6n,
        reserve1: 400n * E18,
      });
      const staleWeth = { ...weth, pricePerUSDNew: 0n };
      expect(buildPricingCandidate(pool, staleWeth, usdc)).toEqual({
        kind: "pool",
        sourceId: pool.id,
        priceUSD: USD(2_500),
        depthUSD: USD(1_000_000),
        targetSideUSD: USD(1_000_000),
      });
    });

    it("CL: prices token0 (USDC) through token1 (WETH) with the reciprocal", () => {
      const pool = makePool(OP, POOL_A, OP_USDC, OP_WETH, {
        isCL: true,
        sqrtPriceX96: 20_000n * Q96,
        reserve0: 1_000_000n * 10n ** 6n,
        reserve1: 400n * E18,
      });
      const candidate = buildPricingCandidate(pool, usdc, weth);
      expect(candidate?.priceUSD).toBe(USD(1));
      expect(candidate?.depthUSD).toBe(USD(1_000_000));
    });

    it("V2 volatile: reserve ratio with 8- and 6-decimal tokens", () => {
      // token0 = USDC (0x0b2C…), token1 = WBTC (0x68f1…)
      const pool = makePool(OP, POOL_A, OP_USDC, OP_WBTC, {
        reserve0: 1_000_000n * 10n ** 6n,
        reserve1: 10n * 10n ** 8n,
      });
      const wbtc = makeToken(OP, OP_WBTC, 8n, 0n, HOUR_START_S);
      expect(buildPricingCandidate(pool, wbtc, usdc)).toEqual({
        kind: "pool",
        sourceId: pool.id,
        priceUSD: USD(100_000),
        depthUSD: USD(1_000_000),
        targetSideUSD: USD(1_000_000),
      });
    });

    it("V2 volatile: a 0-decimal token is valued in whole units", () => {
      // 500 whole Z against 1,000 USDC → $2 per Z.
      const pool = makePool(OP, POOL_A, OP_USDC, OP_TOKEN_ZERO_DEC, {
        reserve0: 1_000n * 10n ** 6n,
        reserve1: 500n,
      });
      const zeroDec = makeToken(OP, OP_TOKEN_ZERO_DEC, 0n, 0n, HOUR_START_S);
      expect(buildPricingCandidate(pool, zeroDec, usdc)).toEqual({
        kind: "pool",
        sourceId: pool.id,
        priceUSD: USD(2),
        depthUSD: USD(1_000),
        targetSideUSD: USD(1_000),
      });
    });

    it("V2 stable: uses the x³y + xy³ marginal price, not the reserve ratio", () => {
      // Normalised x = 1M USDC, y = 2M X. Marginal USDC-in-X =
      // y(3x²+y²) / (x(x²+3y²)) = 2·7 / 13 = 14/13, so X = 13/14 USD.
      // The constant-product ratio would say $0.50.
      const pool = makePool(OP, POOL_A, OP_USDC, OP_TOKEN_X, {
        isStable: true,
        reserve0: 1_000_000n * 10n ** 6n,
        reserve1: 2_000_000n * E18,
      });
      const tokenX = makeToken(OP, OP_TOKEN_X, 18n, 0n, HOUR_START_S);
      const candidate = buildPricingCandidate(pool, tokenX, usdc);
      expect(candidate?.priceUSD).toBe((13n * E18) / 14n);
      expect(candidate?.depthUSD).toBe(USD(1_000_000));
    });

    it("V2 stable: a balanced pool prices at par across 6/18 decimals", () => {
      const pool = makePool(OP, POOL_A, OP_USDC, OP_TOKEN_X, {
        isStable: true,
        reserve0: 5_000_000n * 10n ** 6n,
        reserve1: 5_000_000n * E18,
      });
      const tokenX = makeToken(OP, OP_TOKEN_X, 18n, 0n, HOUR_START_S);
      expect(buildPricingCandidate(pool, tokenX, usdc)?.priceUSD).toBe(USD(1));
    });

    it("yields priceUSD 0 when the counterparty has no price", () => {
      const pool = makePool(OP, POOL_A, OP_USDC, OP_WETH, {
        isCL: true,
        sqrtPriceX96: 20_000n * Q96,
        reserve0: 1_000_000n * 10n ** 6n,
        reserve1: 400n * E18,
      });
      const unpricedWeth = { ...weth, pricePerUSDNew: 0n };
      const tokenX = makeToken(OP, OP_TOKEN_X, 18n, 0n, HOUR_START_S);
      const xPool = makePool(OP, POOL_B, OP_TOKEN_X, OP_WETH, {
        reserve0: E18,
        reserve1: E18,
      });
      expect(buildPricingCandidate(xPool, tokenX, unpricedWeth)?.priceUSD).toBe(
        0n,
      );
      expect(
        buildPricingCandidate(pool, weth, { ...usdc, pricePerUSDNew: 0n })
          ?.priceUSD,
      ).toBe(0n);
    });

    it("yields priceUSD 0 for an uninitialised CL pool or an empty V2 pool", () => {
      const cl = makePool(OP, POOL_A, OP_USDC, OP_WETH, {
        isCL: true,
        sqrtPriceX96: 0n,
        reserve0: 1n,
        reserve1: 1n,
      });
      const v2 = makePool(OP, POOL_B, OP_USDC, OP_WETH, {
        reserve0: 0n,
        reserve1: 400n * E18,
      });
      expect(buildPricingCandidate(cl, weth, usdc)?.priceUSD).toBe(0n);
      expect(buildPricingCandidate(v2, weth, usdc)?.priceUSD).toBe(0n);
    });

    it("returns undefined when the target is not in the pool", () => {
      const pool = makePool(OP, POOL_A, OP_USDC, OP_WETH, {
        reserve0: 1n,
        reserve1: 1n,
      });
      const tokenX = makeToken(OP, OP_TOKEN_X, 18n, 0n, HOUR_START_S);
      expect(buildPricingCandidate(pool, tokenX, usdc)).toBeUndefined();
    });
  });

  describe("selectPricingCandidate", () => {
    const floor = USD(1_000);
    const candidate = (
      sourceId: string,
      priceUSD: bigint,
      depthUSD: bigint,
      targetSideUSD = depthUSD,
    ): PricingCandidate => ({
      kind: "pool",
      sourceId,
      priceUSD,
      depthUSD,
      targetSideUSD,
    });

    it("takes the deepest qualifying candidate", () => {
      const picked = selectPricingCandidate(
        [
          candidate("shallow", USD(3), USD(5_000)),
          candidate("deep", USD(2), USD(80_000)),
          candidate("mid", USD(4), USD(20_000)),
        ],
        floor,
      );
      expect(picked?.sourceId).toBe("deep");
    });

    it("keeps the first candidate on a depth tie", () => {
      const picked = selectPricingCandidate(
        [
          candidate("first", USD(1), USD(9_000)),
          candidate("second", USD(2), USD(9_000)),
        ],
        floor,
      );
      expect(picked?.sourceId).toBe("first");
    });

    it("enforces the depth floor (at the floor qualifies, just below does not)", () => {
      expect(isQualifyingCandidate(candidate("p", USD(1), floor), floor)).toBe(
        true,
      );
      expect(
        isQualifyingCandidate(candidate("p", USD(1), floor - 1n), floor),
      ).toBe(false);
      // A deeper but sub-floor pool never beats nothing.
      expect(
        selectPricingCandidate([candidate("p", USD(1), floor - 1n)], floor),
      ).toBeUndefined();
    });

    it("enforces the 1000x value-imbalance bound", () => {
      const depth = USD(10_000);
      expect(
        isQualifyingCandidate(
          candidate("p", USD(1), depth, depth * 1000n),
          floor,
        ),
      ).toBe(true);
      expect(
        isQualifyingCandidate(
          candidate("p", USD(1), depth, depth * 1000n + 1n),
          floor,
        ),
      ).toBe(false);
    });

    it("an imbalanced deep pool loses to a shallower honest one", () => {
      const picked = selectPricingCandidate(
        [
          // $1M of counterparty claiming $5B of token: a poisoned pool.
          candidate("poison", USD(50_000), USD(1_000_000), USD(5_000_000_000)),
          candidate("honest", USD(1), USD(20_000)),
        ],
        floor,
      );
      expect(picked?.sourceId).toBe("honest");
    });

    it("rejects unpriced and above-ceiling candidates", () => {
      expect(
        isQualifyingCandidate(candidate("p", 0n, USD(1_000_000)), floor),
      ).toBe(false);
      expect(
        isQualifyingCandidate(
          candidate("p", MAX_ACCEPTED_PRICE, USD(1_000_000), 0n),
          floor,
        ),
      ).toBe(true);
      expect(
        isQualifyingCandidate(
          candidate("p", MAX_ACCEPTED_PRICE + 1n, USD(1_000_000), 0n),
          floor,
        ),
      ).toBe(false);
    });

    it("returns undefined for no candidates", () => {
      expect(selectPricingCandidate([], floor)).toBeUndefined();
    });
  });
  describe("canonical cross-chain candidate (ADR 0004)", () => {
    const blockMs = (HOUR_START_S + 600) * 1000;
    const HOUR_MS = 3_600_000;
    const source = (lastSuccessMs: number, depth: bigint | undefined) =>
      makeToken(OP, OP_WETH, 18n, USD(2_500), 0, {
        pricingDepthUSD: depth,
        lastSuccessfulPriceTimestamp: new Date(lastSuccessMs),
      });

    it("offers the source's stored price at its stored depth", () => {
      expect(
        buildCanonicalCandidate(
          source(blockMs - HOUR_MS, USD(9_000_000)),
          blockMs,
        ),
      ).toEqual({
        kind: "canonical",
        sourceId: TokenId(OP, OP_WETH),
        priceUSD: USD(2_500),
        depthUSD: USD(9_000_000),
        targetSideUSD: 0n,
      });
    });

    it("is aligned within ±2h of the block, inclusive", () => {
      for (const skew of [0, 2 * HOUR_MS, -2 * HOUR_MS, 90 * 60_000]) {
        expect(
          isCanonicalSourceAligned(new Date(blockMs - skew), blockMs),
        ).toBe(true);
      }
    });

    it("rejects a stale source (behind) and a source from the future (ahead)", () => {
      expect(
        isCanonicalSourceAligned(new Date(blockMs - 2 * HOUR_MS - 1), blockMs),
      ).toBe(false);
      expect(
        isCanonicalSourceAligned(new Date(blockMs + 2 * HOUR_MS + 1), blockMs),
      ).toBe(false);
      expect(
        buildCanonicalCandidate(
          source(blockMs + 90 * 24 * HOUR_MS, USD(9_000_000)),
          blockMs,
        ),
      ).toBeUndefined();
      expect(isCanonicalSourceAligned(undefined, blockMs)).toBe(false);
    });

    it("rejects a missing or unpriced source", () => {
      expect(buildCanonicalCandidate(undefined, blockMs)).toBeUndefined();
      expect(
        buildCanonicalCandidate(
          { ...source(blockMs, USD(9_000_000)), pricePerUSDNew: 0n },
          blockMs,
        ),
      ).toBeUndefined();
    });

    it("a source with no recorded depth has depth 0 and never clears the floor", () => {
      const candidate = buildCanonicalCandidate(
        source(blockMs, undefined),
        blockMs,
      );
      expect(candidate?.depthUSD).toBe(0n);
      expect(
        selectPricingCandidate(candidate ? [candidate] : [], USD(1_000)),
      ).toBeUndefined();
    });

    it("competes with local pools on depth", () => {
      const canonical = buildCanonicalCandidate(
        source(blockMs, USD(9_000_000)),
        blockMs,
      );
      if (!canonical) throw new Error("expected a canonical candidate");
      const thinLocal: PricingCandidate = {
        kind: "pool",
        sourceId: "1135-0xThin",
        priceUSD: USD(2_300),
        depthUSD: USD(1_300),
        targetSideUSD: USD(1_300),
      };
      const deepLocal = { ...thinLocal, depthUSD: USD(20_000_000) };
      expect(
        selectPricingCandidate([thinLocal, canonical], USD(1_000))?.kind,
      ).toBe("canonical");
      expect(
        selectPricingCandidate([deepLocal, canonical], USD(1_000))?.kind,
      ).toBe("pool");
    });
  });
  describe("combineTwoHopCandidate (weakest link, ADR 0007)", () => {
    const hop = (depthUSD: bigint, targetSideUSD = depthUSD) => ({
      kind: "pool" as const,
      sourceId: "10-0xPeerPool",
      priceUSD: USD(1) / 20n,
      depthUSD,
      targetSideUSD,
    });
    const via = (depthUSD: bigint) => ({
      kind: "pool" as const,
      sourceId: "10-0xDirectPool",
      priceUSD: USD(2),
      depthUSD,
      targetSideUSD: depthUSD,
    });

    it("keeps the peer pool's price and records the route", () => {
      expect(
        combineTwoHopCandidate(
          hop(USD(50_000)),
          via(USD(100_000)),
          "10-0xPeer",
        ),
      ).toEqual({
        kind: "pool",
        sourceId: "10-0xPeerPool",
        priceUSD: USD(1) / 20n,
        depthUSD: USD(50_000),
        targetSideUSD: USD(50_000),
        hops: 2,
        viaTokenId: "10-0xPeer",
        viaPoolId: "10-0xDirectPool",
      });
    });

    it("takes the shallower hop as the depth, whichever it is", () => {
      expect(
        combineTwoHopCandidate(hop(USD(50_000)), via(USD(8_000)), "p").depthUSD,
      ).toBe(USD(8_000));
      expect(
        combineTwoHopCandidate(hop(USD(3_000)), via(USD(900_000)), "p")
          .depthUSD,
      ).toBe(USD(3_000));
    });

    it("applies the floor and the 1000x bound to the weakest link", () => {
      const floor = USD(5_000);
      // Deep peer pool, shallow direct route: fails the floor.
      expect(
        isQualifyingCandidate(
          combineTwoHopCandidate(hop(USD(500_000)), via(USD(4_000)), "p"),
          floor,
        ),
      ).toBe(false);
      // T side of the peer pool is under 1000x the peer pool's own depth but
      // over 1000x the weakest link.
      const imbalanced = combineTwoHopCandidate(
        hop(USD(500_000), USD(500_000) * 900n),
        via(USD(10_000)),
        "p",
      );
      expect(isQualifyingCandidate(imbalanced, floor)).toBe(false);
      expect(
        isQualifyingCandidate(
          combineTwoHopCandidate(
            hop(USD(500_000), USD(10_000) * 1000n),
            via(USD(10_000)),
            "p",
          ),
          floor,
        ),
      ).toBe(true);
    });
  });
});
