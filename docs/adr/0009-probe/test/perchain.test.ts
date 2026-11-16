// Per-chain semantics through createTestIndexer (disable_default_cross_chain: true).
import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

const A = "0x000000000000000000000000000000000000000a";
const B = "0x000000000000000000000000000000000000000b";

const tx = (block: number, ts: number) => ({
  contract: "Weth" as const,
  event: "Transfer" as const,
  params: { from: A, to: B, value: 5n },
  block: { number: block, timestamp: ts },
});

describe("per-chain mode in createTestIndexer", () => {
  it("scopes reads to the handler's chain and keys rows by (id, chainId)", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        34443: {
          simulate: [tx(47278300, 1_800_000_000), tx(47290001, 1_800_003_600)],
        },
        1868: {
          simulate: [tx(30794700, 1_800_000_000), tx(30806001, 1_800_003_600)],
        },
      },
    });

    // Handler-side observations.
    const probes = await indexer.Probe.getAll();
    for (const p of probes)
      console.log("PROBE", (p as { chainId?: number }).chainId, p.id, p.note);
    expect(probes).toHaveLength(2);
    for (const p of probes) {
      const note = JSON.parse(p.note);
      expect(note.markerChainId).toBeNull(); // handler entity has no chainId
      expect(note.markerKeys).not.toContain("chainId");
      expect(
        note.otherMarkers.every((s: string) => s.endsWith("missing")),
      ).toBe(true);
      expect(note.getWhereShared).toHaveLength(1); // only its own chain's 0xshared row
      expect(note.sameIdCount).toBe("1"); // each chain counts only its own events
    }

    // Test-indexer side: ids repeat across chains, rows carry chainId.
    // Note: throws synchronously (Promise.resolve(getEntityFromState(...))), not a rejected promise.
    expect(() => indexer.SameId.get("global")).toThrow(
      /exists on multiple chains/,
    );
    const sameIds = await indexer.SameId.getWhere({
      chainId: { _eq: 34443 },
    } as never);
    console.log(
      "SameId on 34443:",
      JSON.stringify(sameIds, (_, v) => (typeof v === "bigint" ? `${v}` : v)),
    );
    expect(sameIds).toHaveLength(1);
    expect((sameIds[0] as { chainId?: number }).chainId).toBe(34443);
    const acc = await indexer.Account.get(`34443-${A}`);
    console.log(
      "Account 34443-A:",
      JSON.stringify(acc, (_, v) => (typeof v === "bigint" ? `${v}` : v)),
    );
    expect(acc?.transfersOut).toBe(2n);

    // set() outside a handler must say which chain.
    expect(() =>
      indexer.Marker.set({ id: "marker-x", firstBlock: 1 } as never),
    ).toThrow(/requires a `chainId`/);
    indexer.Marker.set({
      id: "marker-x",
      firstBlock: 1,
      chainId: 130,
    } as never);
    expect((await indexer.Marker.get("marker-x"))?.firstBlock).toBe(1);
  });
});
