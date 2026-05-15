import { toChecksumAddress } from "../src/Constants";
import { getRebindTarget, isBlacklistedToken } from "../src/PriceOverrides";

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

    it("does not blacklist the canonical AERO on Base", () => {
      expect(
        isBlacklistedToken(
          8453,
          toChecksumAddress("0x940181a94A35A4569E4529A3CDfB74e38FD98631"),
        ),
      ).toBe(false);
    });
  });

  describe("getRebindTarget", () => {
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
    it("rebinds rsETH/Swell to wrsETH/Base", () => {
      expect(getRebindTarget(1923, RSETH_SWELL)).toEqual({
        chainId: 8453,
        address: WRSETH_BASE,
      });
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
    ])("rebinds XVELO on chainId=%i (%s) to VELO/Optimism", (chainId) => {
      expect(getRebindTarget(chainId, XVELO)).toEqual({
        chainId: 10,
        address: VELO_OP,
      });
    });

    it("returns undefined for tokens without a rebind", () => {
      expect(
        getRebindTarget(
          10,
          toChecksumAddress("0x4200000000000000000000000000000000000006"),
        ),
      ).toBeUndefined();
    });

    it("returns undefined for chains without any rebinds", () => {
      expect(
        getRebindTarget(
          8453,
          toChecksumAddress("0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81"),
        ),
      ).toBeUndefined();
    });
  });
});
