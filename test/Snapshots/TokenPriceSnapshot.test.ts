import { TEN_TO_THE_18_BI, toChecksumAddress } from "../../src/Constants";
import {
  PRICE_SOURCE,
  TokenPriceSnapshotId,
  createTokenPriceSnapshot,
  setTokenPriceSnapshot,
} from "../../src/Snapshots/TokenPriceSnapshot";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("TokenPriceSnapshot", () => {
  let common: ReturnType<typeof setupCommon>;
  const chainId = 10;
  const address = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  // 2023-11-14T22:13:20Z — 13m20s into its clock hour.
  const timestamp = new Date(1_700_000_000 * 1000);
  const hourStartMs = Math.floor(timestamp.getTime() / 3_600_000) * 3_600_000;
  const input = {
    address,
    chainId,
    timestamp,
    pricePerUSDNew: 2_000n * TEN_TO_THE_18_BI,
    isWhitelisted: true,
    priceSource: PRICE_SOURCE.POOL,
    pricingPoolId: `${chainId}-0xPool`,
    pricingDepthUSD: 50_000n * TEN_TO_THE_18_BI,
  };

  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
  });

  describe("TokenPriceSnapshotId", () => {
    it("keys the snapshot on the token and the clock hour", () => {
      expect(TokenPriceSnapshotId(chainId, address, timestamp)).toBe(
        `${chainId}-${address}-${hourStartMs}`,
      );
    });

    it("gives every instant in the same hour the same id", () => {
      const lateInHour = new Date(hourStartMs + 3_599_999);
      expect(TokenPriceSnapshotId(chainId, address, lateInHour)).toBe(
        TokenPriceSnapshotId(chainId, address, timestamp),
      );
      const nextHour = new Date(hourStartMs + 3_600_000);
      expect(TokenPriceSnapshotId(chainId, address, nextHour)).not.toBe(
        TokenPriceSnapshotId(chainId, address, timestamp),
      );
    });
  });

  describe("createTokenPriceSnapshot", () => {
    it("records every field, including pool provenance", () => {
      expect(createTokenPriceSnapshot(input)).toEqual({
        id: TokenPriceSnapshotId(chainId, address, timestamp),
        address,
        pricePerUSDNew: input.pricePerUSDNew,
        isWhitelisted: true,
        lastUpdatedTimestamp: timestamp,
        priceSource: "pool",
        pricingPoolId: input.pricingPoolId,
        pricingDepthUSD: input.pricingDepthUSD,
      });
    });

    it("leaves pool provenance empty for non-pool ticks", () => {
      const snapshot = createTokenPriceSnapshot({
        address,
        chainId,
        timestamp,
        pricePerUSDNew: 3n,
        isWhitelisted: false,
        priceSource: PRICE_SOURCE.CARRIED,
      });
      expect(snapshot.priceSource).toBe("carried");
      expect(snapshot.isWhitelisted).toBe(false);
      expect(snapshot.pricingPoolId).toBeUndefined();
      expect(snapshot.pricingDepthUSD).toBeUndefined();
    });
  });

  it("setTokenPriceSnapshot persists exactly the created snapshot", () => {
    const context = common.createMockContext({
      TokenPriceSnapshot: { set: vi.fn() },
    });

    setTokenPriceSnapshot(input, context);

    expect(context.TokenPriceSnapshot.set).toHaveBeenCalledTimes(1);
    expect(context.TokenPriceSnapshot.set).toHaveBeenCalledWith(
      createTokenPriceSnapshot(input),
    );
  });
});
