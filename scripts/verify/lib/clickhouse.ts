/**
 * ClickHouse HTTP client (read-only). Results are requested as
 * TabSeparatedWithNames so every value arrives as text and 256-bit integers
 * keep full precision.
 */
import { httpRequest } from "./http";

export interface ChConfig {
  /** Base URL, e.g. http://localhost:8123 */
  url: string;
  database: string;
  username?: string;
  password?: string;
}

export type ChRow = Record<string, string | null>;

function unescapeTsv(s: string): string | null {
  if (s === "\\N") return null;
  if (!s.includes("\\")) return s;
  return s.replace(/\\(.)/g, (_, c: string) =>
    c === "t"
      ? "\t"
      : c === "n"
        ? "\n"
        : c === "r"
          ? "\r"
          : c === "0"
            ? "\0"
            : c,
  );
}

/** Minimal client; each query is one HTTP POST. */
export class ChClient {
  /**
   * @param cfg - Connection settings
   */
  constructor(readonly cfg: ChConfig) {}

  /**
   * Runs a query and returns all rows.
   * @param sql - SQL without a FORMAT clause
   * @returns Rows keyed by column name
   */
  async query(sql: string): Promise<ChRow[]> {
    const u = new URL(this.cfg.url);
    u.searchParams.set("database", this.cfg.database);
    const headers: Record<string, string> = { "content-type": "text/plain" };
    if (this.cfg.username) headers["X-ClickHouse-User"] = this.cfg.username;
    if (this.cfg.password) headers["X-ClickHouse-Key"] = this.cfg.password;
    let res: Awaited<ReturnType<typeof httpRequest>> | undefined;
    for (let attempt = 0; !res; attempt++) {
      try {
        res = await httpRequest(u.toString(), {
          method: "POST",
          headers,
          body: `${sql}\nFORMAT TabSeparatedWithNames`,
          timeoutMs: 600_000,
        });
        // The server-wide memory cap is shared with indexers that are writing;
        // a "(total) memory limit" error is transient, so wait and retry.
        if (
          res.status !== 200 &&
          /\(total\) memory limit/.test(res.body.toString("utf8")) &&
          attempt < 6
        ) {
          res = undefined;
          await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
        }
      } catch (e) {
        // Connection resets happen when the server is busy merging; retry.
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
    const text = res.body.toString("utf8");
    if (res.status !== 200)
      throw new Error(
        `ClickHouse HTTP ${res.status}: ${text.slice(0, 500)}\nSQL: ${sql.slice(0, 400)}`,
      );
    const lines = text.split("\n");
    if (lines.length === 0 || lines[0] === "") return [];
    const cols = lines[0].split("\t");
    const rows: ChRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      const row: ChRow = {};
      cols.forEach((c, j) => {
        row[c] = unescapeTsv(parts[j] ?? "");
      });
      rows.push(row);
    }
    return rows;
  }
}

/**
 * Builds a ClickHouse config from the ENVIO_CLICKHOUSE_* variables.
 * @param env - Environment (default process.env)
 * @returns Config, or undefined when no host is set
 */
export function chConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ChConfig | undefined {
  const host = env.ENVIO_CLICKHOUSE_HOST;
  if (!host) return undefined;
  return {
    url: host.startsWith("http") ? host : `http://${host}`,
    database: env.ENVIO_CLICKHOUSE_DATABASE ?? "default",
    username: env.ENVIO_CLICKHOUSE_USERNAME,
    password: env.ENVIO_CLICKHOUSE_PASSWORD,
  };
}
