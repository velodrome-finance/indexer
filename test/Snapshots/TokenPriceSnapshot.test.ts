import { TokenIdByBlock, toChecksumAddress } from "../../src/Constants";
import {
  PRICE_SOURCE,
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
  const blockNumber = 500000;
  const lastUpdatedTimestamp = new Date(1000000 * 1000);
  const pricePerUSDNew = 1000000000000000000n;
  const isWhitelisted = true;
  const priceSource = PRICE_SOURCE.FRESH;

  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
  });

  describe("createTokenPriceSnapshot", () => {
    it("should return snapshot with id from TokenIdByBlock", () => {
      const snapshot = createTokenPriceSnapshot(
        address,
        chainId,
        blockNumber,
        lastUpdatedTimestamp,
        pricePerUSDNew,
        isWhitelisted,
        priceSource,
      );

      expect(snapshot.id).toBe(TokenIdByBlock(chainId, address, blockNumber));
    });

    it("should return snapshot with all passed fields", () => {
      const snapshot = createTokenPriceSnapshot(
        address,
        chainId,
        blockNumber,
        lastUpdatedTimestamp,
        pricePerUSDNew,
        isWhitelisted,
        priceSource,
      );

      expect(snapshot.address).toBe(address);
      expect(snapshot.chainId).toBe(chainId);
      expect(snapshot.pricePerUSDNew).toBe(pricePerUSDNew);
      expect(snapshot.isWhitelisted).toBe(isWhitelisted);
      expect(snapshot.lastUpdatedTimestamp).toBe(lastUpdatedTimestamp);
      expect(snapshot.priceSource).toBe(priceSource);
    });

    it("should handle isWhitelisted false", () => {
      const snapshot = createTokenPriceSnapshot(
        address,
        chainId,
        blockNumber,
        lastUpdatedTimestamp,
        pricePerUSDNew,
        false,
        priceSource,
      );

      expect(snapshot.isWhitelisted).toBe(false);
    });

    it("should carry the provenance tag it is given", () => {
      const snapshot = createTokenPriceSnapshot(
        address,
        chainId,
        blockNumber,
        lastUpdatedTimestamp,
        pricePerUSDNew,
        isWhitelisted,
        PRICE_SOURCE.CARRIED,
      );

      expect(snapshot.priceSource).toBe("carried");
    });
  });

  it("should set snapshot with id from TokenIdByBlock", () => {
    const context = common.createMockContext({
      TokenPriceSnapshot: { set: vi.fn() },
    });

    setTokenPriceSnapshot(
      address,
      chainId,
      blockNumber,
      lastUpdatedTimestamp,
      pricePerUSDNew,
      isWhitelisted,
      priceSource,
      context,
    );

    expect(context.TokenPriceSnapshot.set).toHaveBeenCalledTimes(1);
    expect(context.TokenPriceSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TokenIdByBlock(chainId, address, blockNumber),
      }),
    );
  });

  it("should set snapshot with all passed fields", () => {
    const context = common.createMockContext({
      TokenPriceSnapshot: { set: vi.fn() },
    });

    setTokenPriceSnapshot(
      address,
      chainId,
      blockNumber,
      lastUpdatedTimestamp,
      pricePerUSDNew,
      isWhitelisted,
      priceSource,
      context,
    );

    expect(context.TokenPriceSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TokenIdByBlock(chainId, address, blockNumber),
        address,
        chainId,
        pricePerUSDNew,
        isWhitelisted,
        lastUpdatedTimestamp,
        priceSource,
      }),
    );
  });

  it("should handle isWhitelisted false", () => {
    const context = common.createMockContext({
      TokenPriceSnapshot: { set: vi.fn() },
    });

    setTokenPriceSnapshot(
      address,
      chainId,
      blockNumber,
      lastUpdatedTimestamp,
      pricePerUSDNew,
      false,
      priceSource,
      context,
    );

    expect(context.TokenPriceSnapshot.set).toHaveBeenCalledWith(
      expect.objectContaining({
        isWhitelisted: false,
      }),
    );
  });
});
