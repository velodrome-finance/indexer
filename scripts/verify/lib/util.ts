/** Small shared helpers (bigint parsing/formatting, sampling, concurrency). */

/**
 * Parses a decimal string (as returned by Postgres/ClickHouse) to bigint.
 * @param s - Value or null
 * @returns bigint (0n for null/empty)
 */
export function big(s: string | null | undefined): bigint {
  if (s === null || s === undefined || s === "") return 0n;
  const t = s.includes(".") ? s.slice(0, s.indexOf(".")) : s;
  return BigInt(t);
}

/**
 * Absolute value of a bigint.
 * @param x - Value
 * @returns |x|
 */
export function babs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/**
 * Relative difference |a-b| / max(|a|,|b|) as a float (0 when both are 0).
 * @param a - First
 * @param b - Second
 * @returns Relative difference
 */
export function relDiff(a: bigint, b: bigint): number {
  const m = babs(a) > babs(b) ? babs(a) : babs(b);
  if (m === 0n) return 0;
  return Number((babs(a - b) * 1_000_000_000n) / m) / 1e9;
}

/**
 * Formats a raw token amount with decimals for display.
 * @param x - Raw amount
 * @param decimals - Token decimals
 * @param digits - Fraction digits to keep
 * @returns Human-readable string
 */
export function fmtUnits(x: bigint, decimals: number, digits = 4): string {
  const neg = x < 0n;
  const v = neg ? -x : x;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, digits);
  return `${neg ? "-" : ""}${int}${digits > 0 && decimals > 0 ? `.${frac}` : ""}`;
}

/**
 * Deterministic pseudo-random sample (mulberry32 seeded by a string).
 * @param items - Items
 * @param n - Sample size
 * @param seed - Seed text
 * @returns Up to n items
 */
export function sample<T>(items: T[], n: number, seed: string): T[] {
  if (items.length <= n) return [...items];
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let s = h >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/**
 * Runs async work over items with bounded concurrency.
 * @param items - Inputs
 * @param limit - Max concurrent
 * @param fn - Worker
 * @returns Results in input order
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/**
 * JSON.stringify replacer that prints bigints as strings.
 * @param _k - Key
 * @param v - Value
 * @returns Serializable value
 */
export function jsonReplacer(_k: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Map) return Object.fromEntries(v);
  if (v instanceof Set) return [...v];
  return v;
}

/**
 * Lowercases an address-like string.
 * @param a - Address
 * @returns Lowercase address
 */
export function lc(a: string | null | undefined): string {
  return (a ?? "").toLowerCase();
}
