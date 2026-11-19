import {
  CHAIN_CONSTANTS,
  getLegacyConstants,
  toChecksumAddress,
} from "../../src/Constants";
import {
  ONE_USD,
  PRICING_TIER,
  getMinPricingDepthUSD,
  getPinnedPrice,
  getPricingTier,
} from "../../src/Pricing/PricingConfig";
import {
  LISK,
  LISK_USDT,
  OP,
  OP_DAI,
  OP_TOKEN_X,
  OP_USDC,
  OP_VELO,
  OP_WBTC,
  OP_WETH,
  USD,
  XVELO,
} from "./pricingHarness";

describe("PricingConfig", () => {
  describe("getPricingTier", () => {
    it("puts the destination token and stablecoins in tier 0", () => {
      expect(getPricingTier(OP, OP_USDC)).toBe(PRICING_TIER.PINNED);
      expect(getPricingTier(OP, OP_DAI)).toBe(PRICING_TIER.PINNED);
      expect(getPricingTier(LISK, LISK_USDT)).toBe(PRICING_TIER.PINNED);
    });

    it("puts the chain's WETH in tier 1", () => {
      expect(getPricingTier(OP, OP_WETH)).toBe(PRICING_TIER.WETH);
    });

    it("puts other price connectors and the reward token in tier 2", () => {
      expect(getPricingTier(OP, OP_WBTC)).toBe(PRICING_TIER.CONNECTOR);
      expect(getPricingTier(OP, OP_VELO)).toBe(PRICING_TIER.CONNECTOR);
      // XVELO: the leaf-chain reward token.
      expect(getPricingTier(LISK, XVELO)).toBe(PRICING_TIER.CONNECTOR);
    });

    it("includes every reward token a chain has had (Optimism VELO v1)", () => {
      const veloV1 = getLegacyConstants(OP).rewardToken(0);
      expect(veloV1).not.toBe(OP_VELO);
      expect(getPricingTier(OP, veloV1)).toBe(PRICING_TIER.CONNECTOR);
    });

    it("puts everything else in tier 3", () => {
      expect(getPricingTier(OP, OP_TOKEN_X)).toBe(PRICING_TIER.OTHER);
      // Optimism VELO is only a connector on Optimism.
      expect(getPricingTier(LISK, OP_VELO)).toBe(PRICING_TIER.OTHER);
    });

    it("ignores address case", () => {
      expect(getPricingTier(OP, OP_USDC.toLowerCase())).toBe(
        PRICING_TIER.PINNED,
      );
      expect(
        getPricingTier(OP, OP_WETH.toUpperCase().replace("0X", "0x")),
      ).toBe(PRICING_TIER.WETH);
    });

    it("treats unknown chains as tier 3 for every token", () => {
      expect(getPricingTier(999_999, OP_USDC)).toBe(PRICING_TIER.OTHER);
    });

    it("gives every configured chain a tier-0 destination token and a tier-1 WETH", () => {
      for (const [chainId, constants] of Object.entries(CHAIN_CONSTANTS)) {
        expect({
          chainId,
          tier: getPricingTier(Number(chainId), constants.destinationToken),
        }).toEqual({ chainId, tier: PRICING_TIER.PINNED });
        expect({
          chainId,
          tier: getPricingTier(Number(chainId), constants.weth),
        }).toEqual({ chainId, tier: PRICING_TIER.WETH });
      }
    });

    it("keeps every connector in tier 0, 1 or 2", () => {
      for (const [chainId, constants] of Object.entries(CHAIN_CONSTANTS)) {
        for (const connector of constants.priceConnectors) {
          expect(
            getPricingTier(Number(chainId), connector.address),
          ).toBeLessThanOrEqual(PRICING_TIER.CONNECTOR);
        }
      }
    });
  });

  describe("getPinnedPrice", () => {
    it("pins tier-0 tokens at exactly $1", () => {
      expect(getPinnedPrice(OP, OP_USDC)).toBe(ONE_USD);
      expect(getPinnedPrice(OP, OP_DAI)).toBe(ONE_USD);
    });

    it("pins nothing else", () => {
      expect(getPinnedPrice(OP, OP_WETH)).toBeUndefined();
      expect(getPinnedPrice(OP, OP_TOKEN_X)).toBeUndefined();
      expect(
        getPinnedPrice(
          OP,
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        ),
      ).toBeUndefined();
    });
  });

  describe("getMinPricingDepthUSD", () => {
    it("uses $5,000 on Optimism and Base", () => {
      expect(getMinPricingDepthUSD(10)).toBe(USD(5_000));
      expect(getMinPricingDepthUSD(8453)).toBe(USD(5_000));
    });

    it("uses $1,000 on leaf chains and unknown chains", () => {
      expect(getMinPricingDepthUSD(LISK)).toBe(USD(1_000));
      expect(getMinPricingDepthUSD(34443)).toBe(USD(1_000));
      expect(getMinPricingDepthUSD(999_999)).toBe(USD(1_000));
    });
  });
});
