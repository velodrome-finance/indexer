import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENTITY_TIMESTAMP_FIELDS } from "../src/EntityTimestamps";

const SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "schema.graphql",
);

/**
 * Re-derives, straight from schema.graphql, the set of `Timestamp`-typed fields
 * per entity. Mirrors the parser intent of ENTITY_TIMESTAMP_FIELDS so the two
 * can be asserted equal. Strips inline `#` comments and keys off the field's
 * declared type (`: Timestamp`), not its name.
 */
function timestampFieldsFromSchema(): Record<string, string[]> {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const result: Record<string, string[]> = {};
  let current: string | null = null;

  for (const raw of schema.split("\n")) {
    const line = raw.replace(/#.*/, "");
    const typeMatch = line.match(/^type\s+([A-Za-z_]\w*)/);
    if (typeMatch) {
      current = typeMatch[1];
      continue;
    }
    if (/^\s*}/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(/^\s*([A-Za-z_]\w*)\s*:\s*Timestamp\b/);
    if (fieldMatch) {
      result[current] ??= [];
      result[current].push(fieldMatch[1]);
    }
  }
  return result;
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe("ENTITY_TIMESTAMP_FIELDS schema parity", () => {
  const fromSchema = timestampFieldsFromSchema();

  it("covers exactly the entities that declare Timestamp fields", () => {
    expect(Object.keys(ENTITY_TIMESTAMP_FIELDS).sort()).toEqual(
      Object.keys(fromSchema).sort(),
    );
  });

  it("lists exactly the Timestamp fields each entity declares", () => {
    for (const [entity, fields] of Object.entries(fromSchema)) {
      expect({
        entity,
        fields: sorted(
          ENTITY_TIMESTAMP_FIELDS[
            entity as keyof typeof ENTITY_TIMESTAMP_FIELDS
          ] ?? [],
        ),
      }).toEqual({ entity, fields: sorted(fields) });
    }
  });
});
