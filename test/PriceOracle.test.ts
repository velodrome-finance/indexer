import { CHAIN_CONSTANTS, toChecksumAddress } from "../src/Constants";
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
  const startBlock = CHAIN_CONSTANTS[chainId].oracle.startBlock;
  const blockNumber = startBlock + 1;
  const blockDatetime = new Date("2023-01-01T00:00:00Z");

  const { mockToken0Data } = setupCommon();

  const defaultEffectImplementation = async (
    effect: unknown,
    input: unknown,
  ) => {
    // Mock the effect calls for testing (effect has .name at runtime from createEffect)
    const name = (effect as { name?: string }).name;
    if (name === "getTokenPrice") {
      return {
        pricePerUSDNew: 2n * 10n ** 18n,
      };
    }
    if (name === "getTokenDetails") {
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
    vi.mocked(mockContext.effect)?.mockImplementation(
      defaultEffectImplementation,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
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
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
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
        updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
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
        const tokenPrice = vi.mocked(mockContext.TokenPriceSnapshot?.set)?.mock
          .lastCall?.[0];
        expect(tokenPrice?.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(tokenPrice?.lastUpdatedTimestamp.getTime()).toBeGreaterThan(
          testLastUpdated.getTime(),
        );
        expect(tokenPrice?.isWhitelisted).toBe(mockToken0Data.isWhitelisted);
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
        updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
      });
      it("should refresh price even if less than 1 hour has passed", async () => {
        expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalled();
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
        updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
      });
      it("should refresh price when lastUpdatedTimestamp is missing", async () => {
        expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalled();
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
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.log?.error)?.mockClear();

        // Override effect mock to throw only for getTokenPrice
        // Since refreshTokenPrice calls both effects in parallel, we need to check
        // the effect name and throw conditionally rather than using mockImplementationOnce
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, input: unknown) => {
            if ((effect as { name?: string }).name === "getTokenPrice") {
              throw new Error("Price fetch failed");
            }
            // Use default implementation for other effects
            return defaultEffectImplementation(effect, input);
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
        expect(vi.mocked(mockContext.log?.error)).toHaveBeenCalled();
        const errorCall = vi.mocked(mockContext.log?.error)?.mock.lastCall;
        expect(errorCall?.[0]).toContain("Error refreshing token price");
      });
      it("should not update token when price fetch fails", async () => {
        // Token.set should not be called when error occurs
        // The function catches the error and returns the original token
        const setCalls = vi.mocked(mockContext.Token?.set)?.mock.calls;
        // Filter out any calls from previous tests
        const errorRelatedCalls = setCalls?.filter(
          (call) => call[0]?.address === originalToken.address,
        );
        expect(errorRelatedCalls).toHaveLength(0);
      });
    });
  });

  describe("createTokenEntity", () => {
    const tokenAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const blockNumber = 1000000;

    beforeEach(() => {
      // Reset mocks
      vi.mocked(mockContext.Token?.set)?.mockClear();
      vi.mocked(mockContext.effect)?.mockClear();
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

      expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalledTimes(1);
      const setToken = vi.mocked(mockContext.Token?.set)?.mock
        .lastCall?.[0] as Token;
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

      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(1);
      const effectCall = vi.mocked(mockContext.effect)?.mock.lastCall;
      expect(
        (effectCall?.[1] as { contractAddress: string }).contractAddress,
      ).toBe(tokenAddress);
      expect((effectCall?.[1] as { chainId: number }).chainId).toBe(chainId);
    });
  });
});
