/**
 * A verification target: the Postgres and ClickHouse databases of one indexer
 * instance (plus its metrics endpoint, if reachable).
 *
 * Either pass connection settings explicitly, or `--velo <stack>/<name>` to
 * read them from the dev-box hosting tool's instance files (passwords are read
 * from the stack's secret env file and never printed).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ChConfig } from "./clickhouse";
import { type PgConfig, parsePgUrl } from "./pg";

export interface Target {
  label: string;
  pg: PgConfig;
  pgSchema: string;
  ch?: ChConfig;
  metricsUrl?: string;
  /** Chains the instance indexes, when known. */
  chains?: number[];
}

const VELO_ROOT =
  process.env.VELO_HOME ?? "/home/dev/work-dev-box/hosting/velodrome-indexer";

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Resolves a velo-hosted instance (`scratch/verify`, `prod/main`).
 * @param spec - `<stack>/<name>`
 * @returns Target
 */
export function veloTarget(spec: string): Target {
  const [stack, name] = spec.split("/");
  const instDir = path.join(VELO_ROOT, "instances", stack, name);
  const inst = JSON.parse(
    readFileSync(path.join(instDir, "instance.json"), "utf8"),
  );
  const conf = readEnvFile(path.join(VELO_ROOT, "stacks", `${stack}.conf`));
  const secretFile = path.join(VELO_ROOT, "stacks", `${stack}.secret.env`);
  const secrets = existsSync(secretFile) ? readEnvFile(secretFile) : {};
  return {
    label: spec,
    pg: {
      host:
        conf.PG_BIND && conf.PG_BIND !== "0.0.0.0" ? conf.PG_BIND : "127.0.0.1",
      port: Number(conf.PG_PORT),
      user: "postgres",
      password: secrets.PG_PASSWORD,
      database: inst.pg_db,
    },
    pgSchema: "public",
    ch: {
      url: `http://127.0.0.1:${conf.CH_HTTP_PORT}`,
      database: inst.ch_db,
      // The read-only account is enough for every check.
      username: secrets.CH_READER_PASSWORD ? "reader" : "velo",
      password: secrets.CH_READER_PASSWORD ?? secrets.CH_PASSWORD,
    },
    metricsUrl: inst.metrics_port
      ? `http://127.0.0.1:${inst.metrics_port}/metrics`
      : undefined,
    chains: inst.chains,
  };
}

/**
 * Builds a target from CLI-style options.
 * @param o - Options: velo, pg (URL), pgSchema, chUrl, chDb, chUser, chPasswordEnv, metrics
 * @returns Target
 */
export function targetFromOptions(
  o: Record<string, string | undefined>,
): Target {
  if (o.velo) return veloTarget(o.velo);
  if (!o.pg)
    throw new Error(
      "--pg <postgres://...> or --velo <stack>/<name> is required",
    );
  const t: Target = {
    label: o.label ?? o.pg.replace(/:[^:@/]*@/, ":***@"),
    pg: parsePgUrl(o.pg),
    pgSchema: o.pgSchema ?? "public",
  };
  if (o.chUrl) {
    t.ch = {
      url: o.chUrl,
      database: o.chDb ?? "default",
      username: o.chUser,
      password: o.chPasswordEnv ? process.env[o.chPasswordEnv] : undefined,
    };
  }
  if (o.metrics) t.metricsUrl = o.metrics;
  return t;
}
