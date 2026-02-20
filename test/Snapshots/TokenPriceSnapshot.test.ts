import { TokenIdByBlock, toChecksumAddress } from "../../src/Constants";
import {
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

  beforeEach(() => {
    common = setupCommon();
    jest.clearAllMocks();
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
      );

      expect(snapshot.address).toBe(address);
      expect(snapshot.chainId).toBe(chainId);
      expect(snapshot.pricePerUSDNew).toBe(pricePerUSDNew);
      expect(snapshot.isWhitelisted).toBe(isWhitelisted);
      expect(snapshot.lastUpdatedTimestamp).toBe(lastUpdatedTimestamp);
    });

    it("should handle isWhitelisted false", () => {
      const snapshot = createTokenPriceSnapshot(
        address,
        chainId,
        blockNumber,
        lastUpdatedTimestamp,
        pricePerUSDNew,
        false,
      );

      expect(snapshot.isWhitelisted).toBe(false);
    });
  });

  it("should set snapshot with id from TokenIdByBlock", () => {
    const context = common.createMockContext({
      TokenPriceSnapshot: { set: jest.fn() },
    });

    setTokenPriceSnapshot(
      address,
      chainId,
      blockNumber,
      lastUpdatedTimestamp,
      pricePerUSDNew,
      isWhitelisted,
      context,
    );

    expect(context.TokenPriceSnapshot.set).toHaveBeenCalledTimes(1);
    const setArg = (context.TokenPriceSnapshot.set as jest.Mock).mock
      .calls[0][0];
    // TokenIdByBlock(chainId, address, blockNumber) => "chainId-address-blockNumber"
    expect(setArg.id).toBe(TokenIdByBlock(chainId, address, blockNumber));
  });

  it("should set snapshot with all passed fields", () => {
    const context = common.createMockContext({
      TokenPriceSnapshot: { set: jest.fn() },
    });

    setTokenPriceSnapshot(
      address,
      chainId,
      blockNumber,
      lastUpdatedTimestamp,
      pricePerUSDNew,
      isWhitelisted,
      context,
    );

    const setArg = (context.TokenPriceSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.address).toBe(address);
    expect(setArg.chainId).toBe(chainId);
    expect(setArg.pricePerUSDNew).toBe(pricePerUSDNew);
    expect(setArg.isWhitelisted).toBe(isWhitelisted);
    expect(setArg.lastUpdatedTimestamp).toBe(lastUpdatedTimestamp);
  });

  it("should handle isWhitelisted false", () => {
    const context = common.createMockContext({
      TokenPriceSnapshot: { set: jest.fn() },
    });

    setTokenPriceSnapshot(
      address,
      chainId,
      blockNumber,
      lastUpdatedTimestamp,
      pricePerUSDNew,
      false,
      context,
    );

    const setArg = (context.TokenPriceSnapshot.set as jest.Mock).mock
      .calls[0][0];
    expect(setArg.isWhitelisted).toBe(false);
  });
});
