import { estimateBlockAtTimestamp } from "../src/ChainBlockTime";

describe("estimateBlockAtTimestamp", () => {
  // Optimism Bedrock genesis is the OP anchor:
  //   block 105_235_063 at unix 1_686_068_903 (2023-06-06 16:28:23 UTC), 2s blocks.
  describe("Optimism (chain 10)", () => {
    it("returns the anchor block when timestamp == anchor timestamp", () => {
      expect(estimateBlockAtTimestamp(10, 1_686_068_903)).toBe(105_235_063);
    });

    it("advances by one block per 2 seconds elapsed", () => {
      // 10 seconds after anchor → 5 blocks ahead
      expect(estimateBlockAtTimestamp(10, 1_686_068_903 + 10)).toBe(
        105_235_063 + 5,
      );
    });

    it("estimates block 112_250_611 at unix 1_700_100_000 (~Nov 2023)", () => {
      // Worked example from the PR description / code comment.
      // elapsed = 1_700_100_000 - 1_686_068_903 = 14_031_097s
      // blocks  = floor(14_031_097 / 2)            = 7_015_548
      // result  = 105_235_063 + 7_015_548          = 112_250_611
      expect(estimateBlockAtTimestamp(10, 1_700_100_000)).toBe(112_250_611);
    });
  });

  describe("Base (chain 8453)", () => {
    it("returns a positive block for a post-genesis timestamp", () => {
      const result = estimateBlockAtTimestamp(8453, 1_700_000_000);
      expect(result).toBeDefined();
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("when the chain has no anchor configured", () => {
    it("returns undefined for an unknown chainId", () => {
      expect(estimateBlockAtTimestamp(99999, 1_700_000_000)).toBeUndefined();
    });
  });

  describe("when timestamp is before the anchor", () => {
    it("returns undefined (cannot estimate negative block)", () => {
      // Anchor is 2023-06-06; ask for 2020-01-01.
      expect(estimateBlockAtTimestamp(10, 1_577_836_800)).toBeUndefined();
    });
  });
});
