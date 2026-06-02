import { domainToChainId } from "../../../src/EventHandlers/SuperswapsHyperlane/HyperlaneDomain";

describe("domainToChainId", () => {
  it("maps Metal's Hyperlane domain (1000001750) to its chainId (1750)", () => {
    expect(domainToChainId(1000001750n)).toBe(1750n);
  });

  it("returns the value unchanged for chains where domain === chainId", () => {
    // All 11 other indexed chains have domainId === chainId (identity).
    expect(domainToChainId(10n)).toBe(10n); // Optimism
    expect(domainToChainId(8453n)).toBe(8453n); // Base
    expect(domainToChainId(1135n)).toBe(1135n); // Lisk
    expect(domainToChainId(1923n)).toBe(1923n); // Swell
  });

  it("passes an unknown/unlisted domain through as-is", () => {
    expect(domainToChainId(999999n)).toBe(999999n);
  });
});
