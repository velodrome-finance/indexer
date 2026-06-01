/**
 * Generates docs/schema.md — a human-readable reference for every entity and
 * field defined in schema.graphql.
 *
 * The GraphQL schema is the source of truth and is already richly commented,
 * so this script parses those comments rather than duplicating them by hand.
 * Re-run it whenever schema.graphql changes so the reference stays in lockstep.
 *
 * Usage:
 *   pnpm tsx scripts/generate-schema-docs.ts
 *   # (or, on Node 22.6+: node scripts/generate-schema-docs.ts)
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(repoRoot, "schema.graphql");
const outPath = path.join(repoRoot, "docs", "schema.md");

interface Field {
  name: string;
  type: string;
  indexed: boolean;
  derived: boolean;
  description: string;
}

interface Entity {
  name: string;
  description: string;
  fields: Field[];
}

/** Strips a leading `#` and one optional space from a comment line. */
function stripHash(line: string): string {
  return line.replace(/^\s*#\s?/, "").trimEnd();
}

/**
 * Joins a run of preceding comment lines into a single description, dropping a
 * leading section-header line (e.g. "CL Pool specific fields", "Swap metrics").
 */
function joinComment(lines: string[]): string {
  const out = [...lines];
  while (
    out.length > 0 &&
    /(?:fields|metrics)$/i.test(out[0]) &&
    out[0].split(/\s+/).length <= 5
  ) {
    out.shift();
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Parses schema.graphql into a list of entities with their fields. */
function parseSchema(src: string): Entity[] {
  const lines = src.split("\n");
  const entities: Entity[] = [];
  let current: Entity | null = null;
  let pending: string[] = []; // contiguous comment lines awaiting a field/type

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "") {
      pending = [];
      continue;
    }

    const typeMatch = line.match(/^type\s+(\w+)\s*\{/);
    if (typeMatch) {
      current = {
        name: typeMatch[1],
        description: joinComment(pending),
        fields: [],
      };
      entities.push(current);
      pending = [];
      continue;
    }

    if (line.startsWith("}")) {
      current = null;
      pending = [];
      continue;
    }

    if (line.startsWith("#")) {
      pending.push(stripHash(line));
      continue;
    }

    if (!current) continue;

    // A directive continuation on its own line (e.g. @derivedFrom on the next line).
    if (line.startsWith("@")) {
      const last = current.fields[current.fields.length - 1];
      if (last && /@derivedFrom/.test(line)) last.derived = true;
      if (last && /@index\b/.test(line)) last.indexed = true;
      continue;
    }

    const fieldMatch = line.match(/^(\w+):\s*(.+)$/);
    if (fieldMatch) {
      const name = fieldMatch[1];
      const rest = fieldMatch[2];
      const hashIdx = rest.indexOf("#");
      const inline = hashIdx >= 0 ? rest.slice(hashIdx + 1).trim() : "";
      const decl = (hashIdx >= 0 ? rest.slice(0, hashIdx) : rest).trim();
      const type = (decl.match(/^([^\s@]+)/)?.[1] ?? decl).trim();

      current.fields.push({
        name,
        type,
        indexed: /@index\b/.test(decl),
        derived: /@derivedFrom/.test(decl),
        description: inline || joinComment(pending),
      });
      pending = [];
    }
  }

  return entities;
}

// Category → ordered list of entity names. Entities not listed fall into "Other".
const CATEGORIES: { title: string; blurb: string; names: string[] }[] = [
  {
    title: "Core aggregates",
    blurb:
      "Latest-state entities that hold the headline metrics most consumers query.",
    names: [
      "Pool",
      "Token",
      "UserStatsPerPool",
      "NonFungiblePosition",
      "VeNFTState",
      "VeNFTPoolVote",
      "ALM_LP_Wrapper",
    ],
  },
  {
    title: "Snapshots",
    blurb:
      "Hourly, epoch-aligned copies of the core aggregates for historical/time-series queries.",
    names: [
      "PoolSnapshot",
      "TokenPriceSnapshot",
      "UserStatsPerPoolSnapshot",
      "NonFungiblePositionSnapshot",
      "VeNFTStateSnapshot",
      "VeNFTPoolVoteSnapshot",
      "ALM_LP_WrapperSnapshot",
    ],
  },
  {
    title: "Config & registry",
    blurb: "Chain-wide configuration and cross-chain mapping tables.",
    names: [
      "FactoryRegistryConfig",
      "DynamicFeeGlobalConfig",
      "CLGaugeConfig",
      "FeeToTickSpacingMapping",
      "RedistributorConfig",
      "RootPool_LeafPool",
      "RootGauge_RootPool",
    ],
  },
  {
    title: "Pool launcher",
    blurb: "Emerging-token pools created or migrated via the Pool Launcher.",
    names: ["PoolLauncherPool", "PoolLauncherConfig"],
  },
  {
    title: "Cross-chain superswaps (Hyperlane)",
    blurb:
      "oUSDT-bridged swaps and the Hyperlane dispatch/process events that correlate them.",
    names: [
      "SuperSwap",
      "OUSDTBridgedTransaction",
      "OUSDTSwaps",
      "DispatchId_event",
      "ProcessId_event",
    ],
  },
  {
    title: "Internal buffers & deferred state",
    blurb:
      "Short-lived bookkeeping entities used to correlate events across log indices/blocks. Most are deleted once consumed; not intended for end-user queries.",
    names: [
      "PendingVote",
      "CLPoolPendingInitialize",
      "PendingRootPoolMapping",
      "PendingDistribution",
      "CLPoolMintEvent",
      "CLPositionPendingPrincipal",
      "TxCLPoolMintRegistry",
      "TxPoolTransferRegistry",
      "PoolTransferInTx",
      "ALMLPWrapperTransferInTx",
      "ALM_TotalSupplyLimitUpdated_event",
    ],
  },
];

/** GitHub-style heading anchor slug. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}

/** Escapes a value for use inside a markdown table cell. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function renderEntity(e: Entity): string {
  const out: string[] = [];
  out.push(`### ${e.name}`);
  out.push("");
  if (e.description) {
    out.push(e.description);
    out.push("");
  }
  out.push("| Field | Type | Description |");
  out.push("| ----- | ---- | ----------- |");
  for (const f of e.fields) {
    const tags: string[] = [];
    if (f.indexed) tags.push("indexed");
    if (f.derived) tags.push("derived");
    const tag = tags.length ? ` _(${tags.join(", ")})_` : "";
    out.push(
      `| \`${f.name}\` | \`${f.type}\` | ${cell(f.description)}${tag} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

function main(): void {
  const src = readFileSync(schemaPath, "utf8");
  const entities = parseSchema(src);
  const byName = new Map(entities.map((e) => [e.name, e]));

  // Bucket entities into categories, collecting any leftovers into "Other".
  const seen = new Set<string>();
  const buckets = CATEGORIES.map((c) => ({
    ...c,
    entities: c.names
      .map((n) => byName.get(n))
      .filter((e): e is Entity => Boolean(e)),
  }));
  for (const b of buckets) for (const e of b.entities) seen.add(e.name);
  const leftovers = entities.filter((e) => !seen.has(e.name));
  if (leftovers.length > 0) {
    buckets.push({
      title: "Other",
      blurb: "Entities not yet categorized in scripts/generate-schema-docs.ts.",
      names: leftovers.map((e) => e.name),
      entities: leftovers,
    });
  }

  const out: string[] = [];
  out.push("<!--");
  out.push("  AUTO-GENERATED — do not edit by hand.");
  out.push("  Source: schema.graphql");
  out.push("  Regenerate: pnpm tsx scripts/generate-schema-docs.ts");
  out.push("-->");
  out.push("");
  out.push("# Entity & field reference");
  out.push("");
  out.push(
    `Generated from [\`schema.graphql\`](../schema.graphql). The schema defines **${entities.length} entity types**; each becomes a queryable table in the indexer's database.`,
  );
  out.push("");
  out.push("## Reading this reference");
  out.push("");
  out.push(
    "- **`Type`** is the GraphQL type. A trailing `!` means non-nullable.",
  );
  out.push(
    "- **`BigInt`** fields are fixed-point integers (no JS number precision loss); divide by the relevant token's `decimals` (or `10^18` for USD/`WAD`-scaled values) to get a human number.",
  );
  out.push(
    "- **`Timestamp`** is an ISO-8601 / epoch timestamp; **`Bytes`**/**`String`** hold addresses and hashes.",
  );
  out.push(
    "- **_(indexed)_** marks fields with a secondary index (`@index`) — efficient to filter on. **_(derived)_** marks reverse-relation fields (`@derivedFrom`) that are computed, not stored.",
  );
  out.push(
    "- Entity `id` formats and other conventions are documented inline in each `id` row. See the [Data model](../README.md#data-model) section of the README for the high-level map.",
  );
  out.push("");
  out.push("## Contents");
  out.push("");
  for (const b of buckets) {
    out.push(
      `- **${b.title}** — ${b.entities.map((e) => `[${e.name}](#${slug(e.name)})`).join(", ")}`,
    );
  }
  out.push("");
  for (const b of buckets) {
    out.push(`## ${b.title}`);
    out.push("");
    out.push(b.blurb);
    out.push("");
    for (const e of b.entities) out.push(renderEntity(e));
  }

  writeFileSync(outPath, `${out.join("\n").trimEnd()}\n`);
  process.stdout.write(
    `Wrote ${outPath} (${entities.length} entities, ${entities.reduce((n, e) => n + e.fields.length, 0)} fields)\n`,
  );
}

main();
