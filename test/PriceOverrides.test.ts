import { CHAIN_CONSTANTS, TokenId, toChecksumAddress } from "../src/Constants";
import {
  getCanonicalSource,
  isBlacklistedToken,
  listCanonicalSources,
} from "../src/PriceOverrides";
import { PRICING_TIER, getPricingTier } from "../src/Pricing/PricingConfig";

describe("PriceOverrides", () => {
  describe("isBlacklistedToken", () => {
    it("returns true for $Manatee on Optimism", () => {
      expect(
        isBlacklistedToken(
          10,
          toChecksumAddress("0x7909Bda52eAf7C3cc12745E727Eb527a485241D8"),
        ),
      ).toBe(true);
    });

    it("returns true for SQUID on Ink", () => {
      expect(
        isBlacklistedToken(
          57073,
          toChecksumAddress("0x2e3b82891d1B2b90655597110cCA9b6587607e0c"),
        ),
      ).toBe(true);
    });

    it("returns true for ION on Lisk", () => {
      expect(
        isBlacklistedToken(
          1135,
          toChecksumAddress("0x3f608A49a3ab475dA7fBb167C1Be6b7a45cD7013"),
        ),
      ).toBe(true);
    });

    it("returns false for tokens not in the blacklist", () => {
      expect(
        isBlacklistedToken(
          10,
          toChecksumAddress("0x4200000000000000000000000000000000000006"),
        ),
      ).toBe(false);
    });

    it("scopes the lookup by chainId (Manatee/Optimism is not blacklisted on Base)", () => {
      expect(
        isBlacklistedToken(
          8453,
          toChecksumAddress("0x7909Bda52eAf7C3cc12745E727Eb527a485241D8"),
        ),
      ).toBe(false);
    });

    it.each([
      ["NANO", "0x3D6039ce21339BbBc0e107eab061F1E3073f7275"], // highest-magnitude entry
      ["AERO (symbol collision)", "0x52Db46082ce6031347449A278748527e0075B5Ac"], // shares symbol with canonical AERO
      ["ARASH", "0xEBCc3B60ED7bD906463BFafEbF5F9b19b5b0Cb7c"], // lowest-magnitude entry
    ])(
      "returns true for %s (Base inflated-price token, issue #701)",
      (_, address) => {
        expect(isBlacklistedToken(8453, toChecksumAddress(address))).toBe(true);
      },
    );

    it.each([
      ["HENLO", "0x047Cfd8f966F97c20528e5c1aEB549dB52F613ff"],
      ["DE / Degen", "0x5C985C58562FA7b2F017490c72817ba4984313E7"],
      ["Ragdoll v1", "0xf9fac6ccA82D7acea96Eb33880d628fdcbf07c96"],
      ["Ragdoll v2", "0xF5E89006CBeFf2dabCfda0Def5Bf45Ebe7f8429f"],
      ["CHIDO", "0x0fb741B7203c610585206b8cb56E0a0b45062ff2"],
      ["AUD", "0x62b1473641f38AC7cD57054DB093a2008BB9C577"],
      ["ET / Base", "0xFC366d0F92F5E03f25d867C82B451B89E17907a3"],
      ["USBA v1", "0x52fA342C288060b37776caDF98D8f81C57EBA2B9"],
      ["USBA v2", "0xb0e400A463F1e0b20Eb831B32DC19eD32EF9Ce61"],
      ["TOORBOLG", "0x8feeE3Dc6F8bA55dd54228a909D883bE78422870"],
      ["FD121", "0xa7F9101d91121251d6bA7C1383B39a7f1321cDF3"],
      ["FDOTC", "0x9D848D49819897738FB82C4026414140fEED7eb2"],
      ["HTE", "0x5Bca90d1481081c36E6ac308e8ba5403D6c99e1b"],
      ["PTTH", "0x4753ee21f0521B953e0Ac99449126dD457e85080"],
      ["CTB", "0xEF708582Ab333d602aBcFc740410224352e71D83"],
      ["ORC", "0x44B6FBbA989F018c2C0fE7EE0bf4340B21255C2C"],
      ["BAIBAI", "0x23FA9a1a634222C03F3C02124242DFf56bD90787"],
    ])(
      "returns true for %s (Base inflated-price token, issue #731)",
      (_, address) => {
        expect(isBlacklistedToken(8453, toChecksumAddress(address))).toBe(true);
      },
    );

    // Issue #786: whitelisted tokens whose oracle route froze at a wrong-high
    // but small per-token constant (invisible to the >$10^28 sweep). Blacklist
    // is the immediate stopgap that trust-gates them out of USD aggregates.
    it("returns true for PEPE on Base (frozen route, issue #786)", () => {
      expect(
        isBlacklistedToken(
          8453,
          toChecksumAddress("0x52b492a33E447Cdb854c7FC19F1e57E8BfA1777D"),
        ),
      ).toBe(true);
    });

    it("returns true for wOptiDoge on Optimism (frozen route, issue #786)", () => {
      expect(
        isBlacklistedToken(
          10,
          toChecksumAddress("0xC26921B5b9ee80773774d36C84328ccb22c3a819"),
        ),
      ).toBe(true);
    });

    it("scopes #786 entries by chainId (PEPE/Base not blacklisted on Optimism)", () => {
      expect(
        isBlacklistedToken(
          10,
          toChecksumAddress("0x52b492a33E447Cdb854c7FC19F1e57E8BfA1777D"),
        ),
      ).toBe(false);
    });

    // Issue #901: 0x940A319B… (symbol DEUS, 874M supply) is a SEPARATE real token
    // from canonical DEUS Finance — same symbol, anchor frozen at ~$0.528 vs
    // ~$0.0229 pool-implied (#786 frozen-anchor class, not a worthless spoof).
    // Blacklist forces its price to 0 so the inflated VIRTUAL/DEUS TVL routes
    // through the counterparty leg.
    it("returns true for the frozen-anchor DEUS token on Base (issue #901)", () => {
      expect(
        isBlacklistedToken(
          8453,
          toChecksumAddress("0x940A319B75861014A220D9c6c144d108552B089B"),
        ),
      ).toBe(true);
    });

    it("does not blacklist the canonical AERO on Base", () => {
      expect(
        isBlacklistedToken(
          8453,
          toChecksumAddress("0x940181a94A35A4569E4529A3CDfB74e38FD98631"),
        ),
      ).toBe(false);
    });

    it("does not blacklist the canonical DEUS Finance token on Base (issue #901)", () => {
      expect(
        isBlacklistedToken(
          8453,
          toChecksumAddress("0xDE5ed76E7c05eC5e4572CfC88d1ACEA165109E44"),
        ),
      ).toBe(false);
    });
  });

  describe("getCanonicalSource (ADR 0004)", () => {
    const VELO_OP = toChecksumAddress(
      "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    );
    const XVELO = toChecksumAddress(
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    );
    const RSETH_SWELL = toChecksumAddress(
      "0xc3eaCf0612346366Db554c991D7858716db09f58",
    );
    const WRSETH_BASE = toChecksumAddress(
      "0xEDfa23602D0EC14714057867A78d01e94176BEA0",
    );
    const WETH_OP_STACK = toChecksumAddress(
      "0x4200000000000000000000000000000000000006",
    );
    it("binds rsETH/Swell to wrsETH/Base", () => {
      expect(getCanonicalSource(1923, RSETH_SWELL)).toEqual({
        chainId: 8453,
        address: WRSETH_BASE,
      });
    });

    it("binds WETH/Metal to WETH/Optimism (issue #892)", () => {
      expect(getCanonicalSource(1750, WETH_OP_STACK)).toEqual({
        chainId: 10,
        address: WETH_OP_STACK,
      });
    });

    it.each([
      [1135, "Lisk"],
      [34443, "Mode"],
      [1868, "Soneium"],
      [130, "Unichain"],
      [57073, "Ink"],
      [1750, "Metal"],
      [1923, "Swell"],
      [5330, "Superseed"],
    ])("binds WETH on chainId=%i (%s) to WETH/Optimism", (chainId) => {
      expect(getCanonicalSource(chainId, WETH_OP_STACK)).toEqual({
        chainId: 10,
        address: WETH_OP_STACK,
      });
    });

    it("binds Celo's native-bridge WETH (its `weth` constant) to WETH/Optimism", () => {
      expect(getCanonicalSource(42220, CHAIN_CONSTANTS[42220].weth)).toEqual({
        chainId: 10,
        address: WETH_OP_STACK,
      });
    });

    it("leaves out Base (own deep market), Optimism (the source) and Fraxtal (frxETH, not ETH)", () => {
      expect(getCanonicalSource(8453, WETH_OP_STACK)).toBeUndefined();
      expect(getCanonicalSource(10, WETH_OP_STACK)).toBeUndefined();
      expect(
        getCanonicalSource(252, CHAIN_CONSTANTS[252].weth),
      ).toBeUndefined();
    });

    it("covers the `weth` constant of every chain except Optimism, Base and Fraxtal", () => {
      for (const [chainId, constants] of Object.entries(CHAIN_CONSTANTS)) {
        const expected = [10, 8453, 252].includes(Number(chainId))
          ? undefined
          : { chainId: 10, address: WETH_OP_STACK };
        expect({
          chainId,
          source: getCanonicalSource(Number(chainId), constants.weth),
        }).toEqual({ chainId, source: expected });
      }
    });

    it("never uses a pinned (tier-0) token as source or target", () => {
      for (const { source, target } of listCanonicalSources()) {
        expect(getPricingTier(source.chainId, source.address)).not.toBe(
          PRICING_TIER.PINNED,
        );
        expect(getPricingTier(target.chainId, target.address)).not.toBe(
          PRICING_TIER.PINNED,
        );
      }
    });

    it("never chains: no source is itself a target, and no token is its own source", () => {
      const pairs = listCanonicalSources();
      const targetIds = new Set(
        pairs.map(({ target }) => TokenId(target.chainId, target.address)),
      );
      for (const { source, target } of pairs) {
        expect(targetIds.has(TokenId(source.chainId, source.address))).toBe(
          false,
        );
        expect(source.chainId).not.toBe(target.chainId);
      }
    });

    it.each([
      [252, "Fraxtal"],
      [1135, "Lisk"],
      [34443, "Mode"],
      [1750, "Metal"],
      [1923, "Swell"],
      [1868, "Soneium"],
      [42220, "Celo"],
      [130, "Unichain"],
      [57073, "Ink"],
      [5330, "Superseed"],
    ])("binds XVELO on chainId=%i (%s) to VELO/Optimism", (chainId) => {
      expect(getCanonicalSource(chainId, XVELO)).toEqual({
        chainId: 10,
        address: VELO_OP,
      });
    });

    it("returns undefined for tokens without a canonical source", () => {
      expect(
        getCanonicalSource(
          10,
          toChecksumAddress("0x4200000000000000000000000000000000000006"),
        ),
      ).toBeUndefined();
    });

    it("returns undefined for XVELO's address on Base (not a superchain)", () => {
      expect(
        getCanonicalSource(
          8453,
          toChecksumAddress("0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81"),
        ),
      ).toBeUndefined();
    });
  });
});
