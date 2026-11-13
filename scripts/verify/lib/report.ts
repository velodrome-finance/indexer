/**
 * Check results and the run report (JSON + Markdown).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { babs, jsonReplacer, relDiff } from "./util";

export type Status = "pass" | "fail" | "skip" | "warn";

export interface Offender {
  key: string;
  indexed: string;
  truth: string;
  diff?: string;
  detail?: Record<string, string | number | boolean | null | undefined>;
}

export interface CheckResult {
  id: string;
  chainId: number;
  title: string;
  status: Status;
  /** What is compared and how close it must be, with the reason. */
  tolerance: string;
  summary: string;
  stats: Record<string, string | number>;
  offenderCount: number;
  offenders: Offender[];
  seconds?: number;
}

export interface Tolerance {
  /** Allowed absolute difference (default 0). */
  abs?: bigint;
  /** Allowed relative difference, as a fraction (default 0). */
  rel?: number;
}

/**
 * Whether two values agree within a tolerance.
 * @param a - Indexed value
 * @param b - Truth value
 * @param t - Tolerance
 * @returns True when |a-b| <= abs or relDiff <= rel
 */
export function within(a: bigint, b: bigint, t: Tolerance = {}): boolean {
  const d = babs(a - b);
  if (d <= (t.abs ?? 0n)) return true;
  if (t.rel !== undefined && relDiff(a, b) <= t.rel) return true;
  return false;
}

/** Accumulates comparisons for one check and keeps the worst offenders. */
export class Check {
  readonly offenders: (Offender & { score: number })[] = [];
  offenderCount = 0;
  compared = 0;
  stats: Record<string, string | number> = {};
  private skipped: string | null = null;
  private warnOnly = false;
  private startedAt = Date.now();

  /**
   * @param id - Stable check id (e.g. `pool.v2.swaps`)
   * @param chainId - Chain
   * @param title - One-line description
   * @param tolerance - Tolerance statement (what, how close, why)
   * @param maxOffenders - Offenders kept in the report
   */
  constructor(
    readonly id: string,
    readonly chainId: number,
    readonly title: string,
    readonly tolerance: string,
    private readonly maxOffenders = 15,
  ) {}

  /**
   * Records one comparison of bigints.
   * @param key - Identifies the compared item (ids, addresses)
   * @param indexed - Indexer value
   * @param truth - Ground truth value
   * @param tol - Tolerance
   * @param detail - Reproduction detail (block, tx, ...)
   * @returns True when within tolerance
   */
  cmp(
    key: string,
    indexed: bigint,
    truth: bigint,
    tol: Tolerance = {},
    detail?: Offender["detail"],
  ): boolean {
    this.compared++;
    if (within(indexed, truth, tol)) return true;
    const d = indexed - truth;
    this.add(
      {
        key,
        indexed: indexed.toString(),
        truth: truth.toString(),
        diff: d.toString(),
        detail,
      },
      relDiff(indexed, truth) + Math.log10(Number(babs(d)) + 1) / 100,
    );
    return false;
  }

  /**
   * Records one comparison of strings/booleans/numbers (exact).
   * @param key - Item key
   * @param indexed - Indexer value
   * @param truth - Truth value
   * @param detail - Reproduction detail
   * @returns True when equal
   */
  eq(
    key: string,
    indexed: unknown,
    truth: unknown,
    detail?: Offender["detail"],
  ): boolean {
    this.compared++;
    if (String(indexed) === String(truth)) return true;
    this.add(
      { key, indexed: String(indexed), truth: String(truth), detail },
      1,
    );
    return false;
  }

  /**
   * Records a failure that is not a value comparison (missing / extra rows...).
   * @param o - Offender
   * @param score - Severity used to keep the worst ones
   * @returns void
   */
  add(o: Offender, score = 1): void {
    this.offenderCount++;
    this.offenders.push({ ...o, score });
    if (this.offenders.length > this.maxOffenders * 4) this.trim();
  }

  private trim(): void {
    this.offenders.sort((a, b) => b.score - a.score);
    this.offenders.length = Math.min(this.offenders.length, this.maxOffenders);
  }

  /**
   * Marks the check as skipped.
   * @param reason - Why it cannot run
   * @returns this
   */
  skip(reason: string): this {
    this.skipped = reason;
    return this;
  }

  /**
   * Offenders downgrade the check to `warn` instead of `fail` (informational checks).
   * @returns this
   */
  informational(): this {
    this.warnOnly = true;
    return this;
  }

  /**
   * Finalizes the result.
   * @param summary - Numbers on both sides, in one line
   * @returns Check result
   */
  done(summary: string): CheckResult {
    this.trim();
    const status: Status = this.skipped
      ? "skip"
      : this.offenderCount === 0
        ? "pass"
        : this.warnOnly
          ? "warn"
          : "fail";
    return {
      id: this.id,
      chainId: this.chainId,
      title: this.title,
      status,
      tolerance: this.tolerance,
      summary: this.skipped
        ? `skipped: ${this.skipped}${summary ? ` | ${summary}` : ""}`
        : summary,
      stats: { compared: this.compared, ...this.stats },
      offenderCount: this.offenderCount,
      offenders: this.offenders.map(({ score: _s, ...o }) => o),
      seconds: (Date.now() - this.startedAt) / 1000,
    };
  }
}

export interface RunReport {
  target: string;
  startedAt: string;
  finishedAt: string;
  chains: {
    chainId: number;
    pinnedBlock: number;
    pinnedTimestamp: string;
    truthSeconds: number;
    truthLogs: number;
    notes: string[];
  }[];
  results: CheckResult[];
  usage: Record<string, number | string>;
  warnings: string[];
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Writes report.json and report.md.
 * @param dir - Output directory
 * @param r - Report
 * @returns Paths written
 */
export function writeReport(dir: string, r: RunReport): string[] {
  const json = path.join(dir, "report.json");
  writeFileSync(json, JSON.stringify(r, jsonReplacer, 1));
  const lines: string[] = [];
  lines.push("# Indexer verification report", "");
  lines.push(
    `Target: \`${r.target}\`  `,
    `Run: ${r.startedAt} → ${r.finishedAt}`,
    "",
  );
  for (const w of r.warnings) lines.push(`> **Warning:** ${w}`, "");
  lines.push(
    "| chain | pinned block | block time | truth logs | truth s |",
    "|---|---|---|---|---|",
  );
  for (const c of r.chains)
    lines.push(
      `| ${c.chainId} | ${c.pinnedBlock} | ${c.pinnedTimestamp} | ${c.truthLogs} | ${c.truthSeconds.toFixed(0)} |`,
    );
  lines.push("");
  const counts = (st: Status) =>
    r.results.filter((x) => x.status === st).length;
  lines.push(
    `**${counts("pass")} pass, ${counts("fail")} fail, ${counts("warn")} warn, ${counts("skip")} skipped**`,
    "",
  );
  for (const chainId of [...new Set(r.results.map((x) => x.chainId))]) {
    lines.push(
      `## Chain ${chainId}`,
      "",
      "| check | status | summary |",
      "|---|---|---|",
    );
    for (const x of r.results.filter((y) => y.chainId === chainId)) {
      lines.push(
        `| \`${x.id}\` | ${x.status.toUpperCase()} | ${mdEscape(x.summary)} |`,
      );
    }
    lines.push("");
    for (const x of r.results.filter(
      (y) => y.chainId === chainId && y.offenderCount > 0,
    )) {
      lines.push(
        `### ${x.id} — ${x.status.toUpperCase()} (${x.offenderCount} offenders)`,
        "",
        x.title,
        "",
        `*Tolerance:* ${x.tolerance}`,
        "",
      );
      lines.push(
        "| key | indexed | truth | diff | detail |",
        "|---|---|---|---|---|",
      );
      for (const o of x.offenders) {
        const det = o.detail
          ? Object.entries(o.detail)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")
          : "";
        lines.push(
          `| ${mdEscape(o.key)} | ${mdEscape(o.indexed)} | ${mdEscape(o.truth)} | ${o.diff ?? ""} | ${mdEscape(det)} |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("## Usage", "", "```", JSON.stringify(r.usage, null, 1), "```");
  const md = path.join(dir, "report.md");
  writeFileSync(md, lines.join("\n"));
  return [json, md];
}
