import { TokenId, toChecksumAddress } from "../../src/Constants";
import { listCanonicalSources } from "../../src/PriceOverrides";
import {
  CANONICAL_SEED_LOOKBACK_HOURS,
  buildCanonicalSeedIndex,
  encodeCanonicalSeedSeries,
  lookupCanonicalSeedPrice,
} from "../../src/Pricing/CanonicalPriceSeed";
import SeedJson from "../../src/constants/canonical_price_seed.json";

const E18 = 10n ** 18n;
const H = 3600;
const START = 1_759_996_800; // 2025-10-09 00:00 UTC
const ms = (s: number) => s * 1000;

/** A small synthetic seed: hours 0..5 from START, hour 2 and 3 missing. */
function synthetic() {
  const hourly = new Map<number, bigint>([
    [START, 2_000n * E18],
    [START + H, 2_010n * E18],
    [START + 4 * H, 2_040n * E18],
    [START + 5 * H, 2_050n * E18],
  ]);
  const series = encodeCanonicalSeedSeries(hourly);
  if (!series) throw new Error("empty");
  return buildCanonicalSeedIndex({ sources: { "10-0xSRC": series } });
}

describe("CanonicalPriceSeed (ADR 0008)", () => {
  describe("encode / decode", () => {
    it("round-trips prices at nine significant digits and keeps gaps as gaps", () => {
      const hourly = new Map<number, bigint>([
        [START, 4_438_642_991_000_000_000_000n], // WETH $4,438.642991
        [START + 2 * H, 4_440_000_000_000_000_000_000n],
      ]);
      const series = encodeCanonicalSeedSeries(hourly);
      expect(series).toEqual({
        startHour: START,
        scale: 6,
        prices: "4438642991,,4440000000",
      });
      const index = buildCanonicalSeedIndex({
        sources: { s: series as NonNullable<typeof series> },
      });
      expect(lookupCanonicalSeedPrice("s", ms(START + 59), index)).toEqual({
        priceUSD: 4_438_642_991_000_000_000_000n,
        hourMs: ms(START),
      });
    });

    it("picks a finer scale for sub-dollar tokens", () => {
      const series = encodeCanonicalSeedSeries(
        new Map([[START, 45_575_000_000_000_000n]]), // VELO $0.045575
      );
      expect(series?.scale).toBe(10);
      expect(series?.prices).toBe("455750000");
    });

    it("rejects a timestamp that is not an hour start", () => {
      expect(() =>
        encodeCanonicalSeedSeries(new Map([[START + 1, E18]])),
      ).toThrow();
    });
  });

  describe("lookup", () => {
    const index = synthetic();

    it("returns the block's own clock hour anywhere inside it", () => {
      expect(
        lookupCanonicalSeedPrice("10-0xSRC", ms(START + H + 3599), index),
      ).toEqual({ priceUSD: 2_010n * E18, hourMs: ms(START + H) });
    });

    it(`falls back at most ${CANONICAL_SEED_LOOKBACK_HOURS} hours, never forward`, () => {
      // Hour 2 missing → hour 1; hour 3 missing → hour 1 (two back).
      expect(
        lookupCanonicalSeedPrice("10-0xSRC", ms(START + 2 * H + 10), index)
          ?.hourMs,
      ).toBe(ms(START + H));
      expect(
        lookupCanonicalSeedPrice("10-0xSRC", ms(START + 3 * H + 10), index)
          ?.hourMs,
      ).toBe(ms(START + H));
    });

    it("is undefined before the first hour", () => {
      expect(
        lookupCanonicalSeedPrice("10-0xSRC", ms(START - 1), index),
      ).toBeUndefined();
    });

    it("serves the last hour for two hours past the end, then nothing", () => {
      const last = START + 5 * H;
      expect(
        lookupCanonicalSeedPrice("10-0xSRC", ms(last + 2 * H + 3599), index)
          ?.hourMs,
      ).toBe(ms(last));
      expect(
        lookupCanonicalSeedPrice("10-0xSRC", ms(last + 3 * H), index),
      ).toBeUndefined();
    });

    it("is undefined for a token the seed does not carry", () => {
      expect(
        lookupCanonicalSeedPrice("10-0xOTHER", ms(START), index),
      ).toBeUndefined();
    });
  });

  describe("the committed seed", () => {
    const sources = new Set(
      listCanonicalSources().map(({ source }) =>
        TokenId(source.chainId, source.address),
      ),
    );

    it("keys every series by a configured canonical source's token id", () => {
      const keys = Object.keys(SeedJson.sources);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(sources.has(key)).toBe(true);
    });

    it("carries Optimism WETH and VELO at the oracle's hourly values", () => {
      const weth = TokenId(
        10,
        toChecksumAddress("0x4200000000000000000000000000000000000006"),
      );
      const velo = TokenId(
        10,
        toChecksumAddress("0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db"),
      );
      expect(lookupCanonicalSeedPrice(weth, ms(START + 1800))?.priceUSD).toBe(
        4_438_642_991_000_000_000_000n,
      );
      expect(lookupCanonicalSeedPrice(velo, ms(START + 1800))?.priceUSD).toBe(
        45_575_000_000_000_000n,
      );
      expect(lookupCanonicalSeedPrice(weth, ms(1_727_740_800))?.priceUSD).toBe(
        2_597_714_561_000_000_000_000n,
      );
    });

    it("has no hole longer than the lookback in any series", () => {
      for (const series of Object.values(SeedJson.sources)) {
        let run = 0;
        let longest = 0;
        for (const p of series.prices.split(",")) {
          run = p === "" ? run + 1 : 0;
          if (run > longest) longest = run;
        }
        expect(longest).toBeLessThanOrEqual(CANONICAL_SEED_LOOKBACK_HOURS);
      }
    });
  });
});
