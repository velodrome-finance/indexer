import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseSchemaTypes(
  schemaText: string,
): Map<string, Map<string, string>> {
  const typePattern = /type\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  const fieldPattern = /^\s*(\w+)\s*:\s*([^\s]+)/;
  const types = new Map<string, Map<string, string>>();

  for (const match of schemaText.matchAll(typePattern)) {
    const [, typeName, body] = match;
    const fields = new Map<string, string>();

    for (const line of body.split("\n")) {
      const fieldMatch = line.match(fieldPattern);
      if (fieldMatch) {
        fields.set(fieldMatch[1], fieldMatch[2]);
      }
    }

    types.set(typeName, fields);
  }

  return types;
}

describe("Snapshot schema parity", () => {
  const schemaText = readFileSync(
    resolve(process.cwd(), "schema.graphql"),
    "utf8",
  );
  const schemaTypes = parseSchemaTypes(schemaText);
  const allowedOmissions = new Map<string, string[]>([
    [
      "LiquidityPoolAggregator",
      [
        "tickSpacing",
        "lastUpdatedTimestamp",
        "lastSnapshotTimestamp",
        "rootPoolMatchingHash",
        "factoryAddress",
        "poolLauncherPoolId",
      ],
    ],
    ["UserStatsPerPool", ["firstActivityTimestamp", "lastSnapshotTimestamp"]],
    ["NonFungiblePosition", ["lastSnapshotTimestamp"]],
    ["ALM_LP_Wrapper", ["lastSnapshotTimestamp"]],
    ["VeNFTState", ["lastSnapshotTimestamp", "votesPerPool"]],
  ]);

  it("should keep snapshots in parity with their source entities except for the allowlist", () => {
    for (const [entityName, omissions] of allowedOmissions) {
      const snapshotName = `${entityName}Snapshot`;
      const entityFields = schemaTypes.get(entityName);
      const snapshotFields = schemaTypes.get(snapshotName);

      expect(
        entityFields,
        `${entityName} should exist in schema`,
      ).toBeDefined();
      expect(
        snapshotFields,
        `${snapshotName} should exist in schema`,
      ).toBeDefined();
      if (!entityFields || !snapshotFields) {
        throw new Error(`Missing schema types for ${entityName} parity check`);
      }

      const missingFields = [...entityFields.keys()].filter(
        (field) => !snapshotFields.has(field) && !omissions.includes(field),
      );

      expect(missingFields).toEqual([]);
    }
  });

  it("should model veNFT vote history through VeNFTPoolVoteSnapshot", () => {
    const veNFTStateSnapshotFields = schemaTypes.get("VeNFTStateSnapshot");
    const voteSnapshotFields = schemaTypes.get("VeNFTPoolVoteSnapshot");

    expect(veNFTStateSnapshotFields?.get("votesPerPool")).toBe(
      "[VeNFTPoolVoteSnapshot!]!",
    );
    expect(voteSnapshotFields?.get("veNFTStateSnapshot")).toBe(
      "VeNFTStateSnapshot!",
    );
  });
});
