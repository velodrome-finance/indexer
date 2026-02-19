import type { Mock } from "vitest";
import { CHAIN_CONSTANTS } from "../src/Constants";
import * as PriceOracle from "../src/PriceOracle";

import type { Token, handlerContext } from "generated";

import { setupCommon } from "./EventHandlers/Pool/common";

describe("PriceOracle", () => {
  const mockContext = {
    effect: vi.fn(),
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    Token: {
      set: vi.fn(),
      get: vi.fn(),
      getOrThrow: vi.fn(),
      getOrCreate: vi.fn(),
      deleteUnsafe: vi.fn(),
      getWhere: {
        address: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
        chainId: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
      },
    },
    TokenPriceSnapshot: {
      set: vi.fn(),
      get: vi.fn(),
      getOrThrow: vi.fn(),
      getOrCreate: vi.fn(),
      deleteUnsafe: vi.fn(),
      getWhere: {
        address: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
        chainId: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
        lastUpdatedTimestamp: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
      },
    },
  } as unknown as Partial<handlerContext>;

  const chainId = 10; // Optimism
  const eth_client = CHAIN_CONSTANTS[chainId].eth_client;
  const startBlock = CHAIN_CONSTANTS[chainId].oracle.startBlock;
  const blockNumber = startBlock + 1;
  const blockDatetime = new Date("2023-01-01T00:00:00Z");

  const { mockToken0Data } = setupCommon();

  const defaultEffectImplementation = async (
    effectFn: { name: string },
    input: unknown,
  ) => {
    // Mock the effect calls for testing
    if (effectFn.name === "getTokenPrice") {
      return {
        pricePerUSDNew: 2n * 10n ** 18n,
      };
    }
    if (effectFn.name === "getTokenDetails") {
      return {
        name: "Test Token",
        decimals: 18,
        symbol: "TEST",
      };
    }
    return {};
  };

  beforeEach(() => {
    // Reset effect mock to default implementation before each test
    (mockContext.effect as Mock).mockImplementation(
      defaultEffectImplementation,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("refreshTokenPrice", () => {
    let testLastUpdated: Date;

    const mockTokenPriceData = {
      pricePerUSDNew: 2n * 10n ** 18n,
      decimals: mockToken0Data.decimals,
    };

    describe("if the update interval hasn't passed", () => {
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime());
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
      });
      it("should not update prices if the update interval hasn't passed", async () => {
        expect(mockContext.Token?.set as Mock).not.toHaveBeenCalled();
        expect(
          mockContext.TokenPriceSnapshot?.set as Mock,
        ).not.toHaveBeenCalled();
      });
    });
    describe("if the update interval has passed", () => {
      let updatedToken: Token;
      let testLastUpdated: Date;
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime() - 61 * 60 * 1000);
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
        updatedToken = (mockContext.Token?.set as Mock).mock.lastCall?.[0];
      });
      it("should update prices if the update interval has passed", async () => {
        expect(updatedToken.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBeGreaterThan(
          testLastUpdated.getTime(),
        );
      });
      it("should create a new TokenPriceSnapshot entity", async () => {
        const tokenPrice = (mockContext.TokenPriceSnapshot?.set as Mock).mock
          .lastCall?.[0];
        expect(tokenPrice.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(tokenPrice.lastUpdatedTimestamp.getTime()).toBeGreaterThan(
          testLastUpdated.getTime(),
        );
        expect(tokenPrice.isWhitelisted).toBe(mockToken0Data.isWhitelisted);
      });
    });

    describe("when pricePerUSDNew is 0n", () => {
      let updatedToken: Token;
      beforeEach(async () => {
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: new Date(blockDatetime.getTime()),
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
        updatedToken = (mockContext.Token?.set as Mock).mock.lastCall?.[0];
      });
      it("should refresh price even if less than 1 hour has passed", async () => {
        expect(mockContext.Token?.set as Mock).toHaveBeenCalled();
        expect(updatedToken.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
      });
    });

    describe("when lastUpdatedTimestamp is missing", () => {
      let updatedToken: Token;
      beforeEach(async () => {
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: undefined,
        } as unknown as Token;
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
        updatedToken = (mockContext.Token?.set as Mock).mock.lastCall?.[0];
      });
      it("should refresh price when lastUpdatedTimestamp is missing", async () => {
        expect(mockContext.Token?.set as Mock).toHaveBeenCalled();
        expect(updatedToken.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(updatedToken.lastUpdatedTimestamp).toBeInstanceOf(Date);
      });
    });

    describe("when price fetch fails", () => {
      let originalToken: Token;
      beforeEach(async () => {
        // Reset mockContext first
        (mockContext.Token?.set as Mock).mockClear();
        (mockContext.log?.error as Mock).mockClear();

        // Override effect mock to throw only for getTokenPrice
        // Since refreshTokenPrice calls both effects in parallel, we need to check
        // the effect name and throw conditionally rather than using mockImplementationOnce
        (mockContext.effect as Mock).mockImplementation(
          async (effectFn: { name: string }, input: unknown) => {
            if (effectFn.name === "getTokenPrice") {
              throw new Error("Price fetch failed");
            }
            // Use default implementation for other effects
            return defaultEffectImplementation(effectFn, input);
          },
        );

        const testLastUpdated = new Date(
          blockDatetime.getTime() - 61 * 60 * 1000,
        );
        originalToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        } as Token;
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          originalToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
      });
      it("should log error when price fetch fails", async () => {
        // Should log error
        expect(mockContext.log?.error as Mock).toHaveBeenCalled();
        const errorCall = (mockContext.log?.error as Mock).mock.lastCall;
        expect(errorCall?.[0]).toContain("Error refreshing token price");
      });
      it("should not update token when price fetch fails", async () => {
        // Token.set should not be called when error occurs
        // The function catches the error and returns the original token
        const setCalls = (mockContext.Token?.set as Mock).mock.calls;
        // Filter out any calls from previous tests
        const errorRelatedCalls = setCalls.filter(
          (call) => call[0]?.address === originalToken.address,
        );
        expect(errorRelatedCalls).toHaveLength(0);
      });
    });
  });

  describe("createTokenEntity", () => {
    const tokenAddress = "0x1111111111111111111111111111111111111111";
    const blockNumber = 1000000;

    beforeEach(() => {
      // Reset mocks
      (mockContext.Token?.set as Mock).mockClear();
      (mockContext.effect as Mock).mockClear();
    });

    it("should create a token entity with correct fields", async () => {
      const token = await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
      );

      expect(token).toBeDefined();
      expect(token.address).toBe(tokenAddress);
      expect(token.symbol).toBe("TEST");
      expect(token.name).toBe("Test Token");
      expect(token.decimals).toBe(18n);
      expect(token.pricePerUSDNew).toBe(0n);
      expect(token.chainId).toBe(chainId);
      expect(token.isWhitelisted).toBe(false);
      expect(token.lastUpdatedTimestamp).toBeInstanceOf(Date);
    });

    it("should call Token.set with the created entity", async () => {
      await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
      );

      expect(mockContext.Token?.set as Mock).toHaveBeenCalledTimes(1);
      const setToken = (mockContext.Token?.set as Mock).mock.lastCall?.[0];
      expect(setToken.address).toBe(tokenAddress);
      expect(setToken.pricePerUSDNew).toBe(0n);
    });

    it("should call getTokenDetails effect", async () => {
      await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
      );

      expect(mockContext.effect as Mock).toHaveBeenCalledTimes(1);
      const effectCall = (mockContext.effect as Mock).mock.lastCall;
      expect(effectCall?.[1].contractAddress).toBe(tokenAddress);
      expect(effectCall?.[1].chainId).toBe(chainId);
    });
  });
});
