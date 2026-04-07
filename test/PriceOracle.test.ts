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
    describe("if less than 1 hour has passed (e.g. 30 minutes)", () => {
      beforeEach(async () => {
        const thirtyMinutesAgo = new Date(
          blockDatetime.getTime() - 30 * 60 * 1000,
        );
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: thirtyMinutesAgo,
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
      it("should not refresh price when only 30 minutes have passed", async () => {
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

    describe("when pricePerUSDNew is 0n for more than 30 days (unpriceable)", () => {
      beforeEach(async () => {
        vi.mocked(mockContext.Token?.set)?.mockClear();

        const thirtyOneDaysAgo = new Date(
          blockDatetime.getTime() - 31 * 24 * 60 * 60 * 1000,
        );
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: thirtyOneDaysAgo,
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
      it("should NOT retry price fetch after 30-day backoff", async () => {
        // Token.set should not be called — shouldRefresh returns false
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
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

  describe("rpcGateway bypass for affected chains (Change C)", () => {
    const CELO_CHAIN_ID = 42220;
    const celoStartBlock = CHAIN_CONSTANTS[CELO_CHAIN_ID].oracle.startBlock;
    const celoBlockNumber = celoStartBlock + 1;
    const celoToken = {
      ...mockToken0Data,
      id: `${CELO_CHAIN_ID}-${mockToken0Data.address}`,
      chainId: CELO_CHAIN_ID,
      pricePerUSDNew: 0n,
      lastUpdatedTimestamp: new Date(blockDatetime.getTime()),
    };

    it("should call rpcGateway bypass when getTokenPrice returns $0 on affected chain", async () => {
      const bypassPrice = 5n * 10n ** 18n;
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "CELO", decimals: 18, symbol: "CELO" };
          }
          if (name === "rpcGateway") {
            return { pricePerUSDNew: bypassPrice, priceOracleType: "v3" };
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        celoToken,
        celoBlockNumber,
        blockDatetime.getTime() / 1000,
        CELO_CHAIN_ID,
        mockContext as handlerContext,
      );

      // rpcGateway should have been called (3 effect calls: getTokenDetails, getTokenPrice, rpcGateway)
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(3);
      const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
        .lastCall?.[0] as Token;
      expect(updatedToken.pricePerUSDNew).toBe(bypassPrice);
    });

    it("should NOT call rpcGateway bypass when getTokenPrice returns non-zero on affected chain", async () => {
      const nonZeroToken = {
        ...celoToken,
        pricePerUSDNew: 1n * 10n ** 18n,
        lastUpdatedTimestamp: new Date(
          blockDatetime.getTime() - 61 * 60 * 1000,
        ),
      };
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 3n * 10n ** 18n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "CELO", decimals: 18, symbol: "CELO" };
          }
          if (name === "rpcGateway") {
            throw new Error("rpcGateway bypass should not be called");
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        nonZeroToken,
        celoBlockNumber,
        blockDatetime.getTime() / 1000,
        CELO_CHAIN_ID,
        mockContext as handlerContext,
      );

      // Only 2 effect calls: getTokenDetails + getTokenPrice (no rpcGateway bypass)
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(2);
    });

    it("should NOT call rpcGateway bypass on unaffected chains even with $0 price", async () => {
      const optimismToken = {
        ...mockToken0Data,
        pricePerUSDNew: 0n,
        lastUpdatedTimestamp: new Date(blockDatetime.getTime()),
      };
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "Test Token", decimals: 18, symbol: "TEST" };
          }
          if (name === "rpcGateway") {
            throw new Error("rpcGateway bypass should not be called");
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        optimismToken,
        blockNumber,
        blockDatetime.getTime() / 1000,
        chainId, // Optimism - not affected
        mockContext as handlerContext,
      );

      // Only 2 effect calls: getTokenDetails + getTokenPrice (no rpcGateway bypass)
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(2);
    });

    it("should use last known price when bypass also returns $0 on affected chain", async () => {
      const previousPrice = 3n * 10n ** 18n;
      const tokenWithPreviousPrice = {
        ...celoToken,
        pricePerUSDNew: previousPrice,
        lastUpdatedTimestamp: new Date(
          blockDatetime.getTime() - 2 * 60 * 60 * 1000,
        ),
      };
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "CELO", decimals: 18, symbol: "CELO" };
          }
          if (name === "rpcGateway") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        tokenWithPreviousPrice,
        celoBlockNumber,
        blockDatetime.getTime() / 1000,
        CELO_CHAIN_ID,
        mockContext as handlerContext,
      );

      // Bypass was called (3 effect calls) but also returned $0
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(3);
      const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
        .lastCall?.[0] as Token;
      // Should fall back to last known price (7-day fallback in V3 path)
      expect(updatedToken.pricePerUSDNew).toBe(previousPrice);
    });
  });

  describe("createTokenEntity", () => {
    const tokenAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const blockNumber = 1000000;
    const blockTimestamp = Math.floor(blockDatetime.getTime() / 1000);

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
        blockTimestamp,
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
        blockTimestamp,
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
        blockTimestamp,
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
