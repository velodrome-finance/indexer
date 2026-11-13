import {
  CHAIN_CONSTANTS,
  TokenId,
  toChecksumAddress,
} from "../../src/Constants";
import {
  getAnchorRefreshBlockInterval,
  getAnchorTokens,
  refreshAnchorTokens,
} from "../../src/Pricing/AnchorRefresh";
import { PRICING_TIER, getPricingTier } from "../../src/Pricing/PricingConfig";
import {
  E18,
  HOUR_S,
  HOUR_START_S,
  LISK,
  OP,
  OP_USDC,
  OP_VELO,
  OP_WETH,
  USD,
  XVELO,
  createPricingStore,
  makeToken,
} from "./pricingHarness";

const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

describe("anchor refresh (ADR 0006)", () => {
  describe("getAnchorTokens", () => {
    it("lists WETH first, then connectors and reward tokens, never a pinned token", () => {
      const anchors = getAnchorTokens(OP);
      expect(anchors[0]).toBe(toChecksumAddress(OP_WETH));
      expect(anchors).toContain(toChecksumAddress(OP_VELO));
      for (const a of anchors) {
        expect(getPricingTier(OP, a)).not.toBe(PRICING_TIER.PINNED);
      }
      expect(lower(anchors)).not.toContain(OP_USDC.toLowerCase());
    });

    it("includes the canonical sources that live on the chain", () => {
      // ezETH on Optimism is the canonical source for Swell / Ink ezETH.
      expect(lower(getAnchorTokens(OP))).toContain(
        "0x2416092f143378750bb29b79ed961ab195cceea5",
      );
      // wrsETH and SolvBTC on Base are sources for Swell rsETH / Ink SolvBTC.
      const base = lower(getAnchorTokens(8453));
      expect(base).toContain("0xedfa23602d0ec14714057867a78d01e94176bea0");
      expect(base).toContain("0x3b86ad95859b6ab773f55f8d94b4b9d443ee931f");
    });

    it("lists each token once", () => {
      for (const chainId of Object.keys(CHAIN_CONSTANTS).map(Number)) {
        const anchors = lower(getAnchorTokens(chainId));
        expect(new Set(anchors).size).toBe(anchors.length);
      }
    });

    it("gives every configured chain an anchor list and a block interval", () => {
      for (const chainId of Object.keys(CHAIN_CONSTANTS).map(Number)) {
        expect(getAnchorTokens(chainId).length).toBeGreaterThan(0);
        expect(getAnchorRefreshBlockInterval(chainId)).toBeGreaterThan(0);
      }
      expect(getAnchorTokens(999_999)).toEqual([]);
      expect(getAnchorRefreshBlockInterval(999_999)).toBeUndefined();
    });
  });

  describe("refreshAnchorTokens", () => {
    const NOW = HOUR_START_S + 5 * 60;

    it("refreshes every existing anchor at the block's time and skips missing ones", async () => {
      // Lisk: XVELO exists (its canonical source, Optimism VELO, is fresh),
      // WETH does not exist yet.
      const store = createPricingStore({
        tokens: [
          makeToken(LISK, XVELO, 18n, 0n, NOW - 2 * HOUR_S),
          makeToken(OP, OP_VELO, 18n, E18 / 10n, NOW - 600, {
            pricingDepthUSD: USD(250_000),
          }),
        ],
      });
      await refreshAnchorTokens(LISK, 123, NOW, store.context);
      const xvelo = store.tokens.get(TokenId(LISK, XVELO));
      expect(xvelo?.pricePerUSDNew).toBe(E18 / 10n);
      expect(xvelo?.lastUpdatedTimestamp).toEqual(new Date(NOW * 1000));
      expect(store.snapshots.map((s) => [s.chainId, s.address])).toEqual([
        [LISK, XVELO],
      ]);
      // The Optimism source is read, never refreshed with Lisk's block time.
      expect(
        store.tokens.get(TokenId(OP, OP_VELO))?.lastUpdatedTimestamp,
      ).toEqual(new Date((NOW - 600) * 1000));
    });

    it("is a no-op for anchors already refreshed this hour", async () => {
      const store = createPricingStore({
        tokens: [makeToken(LISK, XVELO, 18n, USD(1), NOW - 60)],
      });
      await refreshAnchorTokens(LISK, 123, NOW, store.context);
      expect(store.snapshots).toHaveLength(0);
    });
  });
});
