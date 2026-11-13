import SeedJson from "../constants/canonical_price_seed.json";

// Local constants (not imported from Constants / PricingConfig) so the seed
// builder script can use this module without loading chain configuration.
const MS_IN_AN_HOUR = 3_600_000;
const ONE_USD = 10n ** 18n;

/**
 * Committed hourly prices of canonical source tokens (ADR 0008). During a
 * backfill a leaf chain's canonical source is almost never inside the ±2 h
 * window (Envio aligns chains by block-range fraction, not by time), so a
 * leaf token falls back to this seed: the source's price for the block's
 * clock hour, from a file rebuilt before each resync by
 * `scripts/build-canonical-price-seed.ts`.
 *
 * File shape (`src/constants/canonical_price_seed.json`):
 * `sources[sourceTokenId] = { startHour, scale, prices }`, where `startHour`
 * is the unix second of the first hour and `prices` is a comma-separated
 * string whose i-th field is the price of hour `startHour + i·3600` as an
 * integer in units of 10^-scale USD (empty = no price that hour). One string
 * per source keeps the file compact and out of the formatter's way.
 */

/** One source's hourly series as stored in the seed file. */
export interface CanonicalSeedSeries {
  /** Unix second of the first hour in `prices`. */
  readonly startHour: number;
  /** Prices are integers in units of 10^-scale USD. */
  readonly scale: number;
  /** One comma-separated field per clock hour from `startHour`; empty = no price. */
  readonly prices: string;
}

/** The seed file's shape. */
export interface CanonicalSeedFile {
  readonly sources: Readonly<Record<string, CanonicalSeedSeries>>;
}

/** A source's series decoded for lookup: prices already 1e18-scaled. */
export interface CanonicalSeedIndexEntry {
  readonly startHourMs: number;
  readonly prices: ReadonlyArray<bigint | undefined>;
}

/** Decoded seed: source token id → series. */
export type CanonicalSeedIndex = ReadonlyMap<string, CanonicalSeedIndexEntry>;

/** A seed hit: the price and the clock hour it belongs to. */
export interface CanonicalSeedPrice {
  /** USD price, 1e18-scaled. */
  readonly priceUSD: bigint;
  /** Start of the seed hour used, in milliseconds. */
  readonly hourMs: number;
}

/**
 * How many clock hours before the block's own hour the lookup may fall back
 * to when that hour has no price: the same two hours the live canonical
 * window allows, and only towards the past.
 */
export const CANONICAL_SEED_LOOKBACK_HOURS = 2;

/**
 * Decodes a seed file into a lookup index (prices converted to 1e18 USD
 * once, so the per-event lookup is an array read).
 *
 * @param file - The parsed seed file
 * @returns Index keyed by source token id (`{chainId}-{address}`)
 */
export function buildCanonicalSeedIndex(
  file: CanonicalSeedFile,
): CanonicalSeedIndex {
  const index = new Map<string, CanonicalSeedIndexEntry>();
  for (const [sourceId, series] of Object.entries(file.sources)) {
    const unit = ONE_USD / 10n ** BigInt(series.scale);
    index.set(sourceId, {
      startHourMs: series.startHour * 1000,
      prices: series.prices
        .split(",")
        .map((p) => (p === "" || p === "0" ? undefined : BigInt(p) * unit)),
    });
  }
  return index;
}

/**
 * Encodes one source's hourly prices for the seed file (used by
 * `scripts/build-canonical-price-seed.ts`). The scale is chosen per source so
 * the largest price has at most ten integer digits, which keeps about nine
 * significant digits for every price of an ordinary series.
 *
 * @param hourly - Unix hour start (seconds) → USD price, 1e18-scaled
 * @returns The series, or undefined when `hourly` is empty
 */
export function encodeCanonicalSeedSeries(
  hourly: ReadonlyMap<number, bigint>,
): CanonicalSeedSeries | undefined {
  const hours = [...hourly.keys()].sort((a, b) => a - b);
  if (hours.length === 0) return undefined;
  for (const h of hours) {
    if (h % 3600 !== 0) throw new Error(`hour ${h} is not an hour start`);
  }
  let max = 0n;
  for (const p of hourly.values()) if (p > max) max = p;
  // digits of max in whole USD (1e18 base): scale = 10 - digits(max / 1e18).
  let wholeDigits = 0;
  for (let v = max / ONE_USD; v > 0n; v /= 10n) wholeDigits++;
  const scale = Math.min(18, 10 - wholeDigits);
  const divisor = 10n ** BigInt(18 - scale);
  const start = hours[0];
  const fields: string[] = new Array(
    (hours[hours.length - 1] - start) / 3600 + 1,
  ).fill("");
  for (const h of hours) {
    const p = hourly.get(h) as bigint;
    const v = (p + divisor / 2n) / divisor;
    fields[(h - start) / 3600] = v > 0n ? v.toString() : "";
  }
  return { startHour: start, scale, prices: fields.join(",") };
}

/**
 * The committed seed, decoded once, on the first lookup (the JSON itself is
 * loaded with the module). Deferred so the seed builder script can import
 * this module while it rewrites the file.
 */
let defaultIndex: CanonicalSeedIndex | undefined;
function getDefaultIndex(): CanonicalSeedIndex {
  if (!defaultIndex) {
    defaultIndex = buildCanonicalSeedIndex(SeedJson as CanonicalSeedFile);
  }
  return defaultIndex;
}

/**
 * The seed price of `sourceId` for the clock hour containing
 * `blockTimestampMs`, falling back up to
 * {@link CANONICAL_SEED_LOOKBACK_HOURS} earlier hours when that hour has no
 * price. Never looks forward. O(1).
 *
 * @param sourceId - Canonical source token id (`{chainId}-{address}`)
 * @param blockTimestampMs - Timestamp of the block being priced, in milliseconds
 * @param index - Seed index (defaults to the committed seed)
 * @returns The price and the hour it came from, or undefined outside the seed
 */
export function lookupCanonicalSeedPrice(
  sourceId: string,
  blockTimestampMs: number,
  index: CanonicalSeedIndex = getDefaultIndex(),
): CanonicalSeedPrice | undefined {
  const series = index.get(sourceId);
  if (!series) return undefined;
  const hour = Math.floor(
    (blockTimestampMs - series.startHourMs) / MS_IN_AN_HOUR,
  );
  for (let back = 0; back <= CANONICAL_SEED_LOOKBACK_HOURS; back++) {
    const i = hour - back;
    if (i < 0) return undefined;
    if (i >= series.prices.length) continue;
    const priceUSD = series.prices[i];
    if (priceUSD !== undefined) {
      return { priceUSD, hourMs: series.startHourMs + i * MS_IN_AN_HOUR };
    }
  }
  return undefined;
}
