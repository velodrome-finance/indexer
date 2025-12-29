import type {
  NFPM_DecreaseLiquidity_event,
  NFPM_IncreaseLiquidity_event,
  NonFungiblePosition,
  Token,
  handlerContext,
} from "generated";
import {
  findNonFungiblePositionByTXHashAndAmounts,
  getPositionWithPlaceholderFallback,
  getSqrtPriceX96AndTokens,
  getTokensForPosition,
  processDecreaseLiquidity,
  processIncreaseLiquidity,
  processTransfer,
} from "../../../src/EventHandlers/NFPM/NFPMLogic";
import {
  calculatePositionAmountsFromLiquidity,
  calculateTotalLiquidityUSD,
} from "../../../src/Helpers";

describe("NFPMLogic", () => {
  const chainId = 10;
  const tokenId = 1n;
  const positionId = `${chainId}_${tokenId}`;
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const token0Address = "0xToken0Address0000000000000000000000";
  const token1Address = "0xToken1Address0000000000000000000000";

  const mockPosition: NonFungiblePosition = {
    id: positionId,
    chainId: chainId,
    tokenId: tokenId,
    owner: "0x1111111111111111111111111111111111111111",
    pool: "0xPoolAddress0000000000000000000000",
    tickUpper: 100n,
    tickLower: -100n,
    token0: token0Address,
    token1: token1Address,
    liquidity: 1000000000000000000n,
    amount0: 500000000000000000n,
    amount1: 1000000000000000000n,
    amountUSD: 2500000000000000000n,
    mintTransactionHash: transactionHash,
    lastUpdatedTimestamp: new Date(),
  };

  // Placeholder position uses new format: ${chainId}_${txHash}_${logIndex}
  // tokenId is set to CLPool.Mint logIndex (in this test, logIndex = 0)
  const mintLogIndex = 0;
  const transferLogIndex = 2; // Transfer comes after Mint
  const mockPlaceholderPosition: NonFungiblePosition = {
    ...mockPosition,
    id: `${chainId}_${transactionHash.slice(2)}_${mintLogIndex}`,
    tokenId: BigInt(mintLogIndex), // Placeholder tokenId = CLPool.Mint logIndex
  };

  const mockToken0: Token = {
    id: `${chainId}_${token0Address}`,
    chainId: chainId,
    address: token0Address,
    symbol: "TOKEN0",
    name: "Token 0",
    decimals: 18n,
    pricePerUSDNew: 10n ** 18n, // 1 USD per token
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockToken1: Token = {
    id: `${chainId}_${token1Address}`,
    chainId: chainId,
    address: token1Address,
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSDNew: 2n * 10n ** 18n, // 2 USD per token
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  describe("getPositionWithPlaceholderFallback", () => {
    let mockContext: handlerContext;

    beforeEach(() => {
      mockContext = {
        NonFungiblePosition: {
          get: jest.fn(),
          getWhere: {
            tokenId: {
              eq: jest.fn(),
            },
            mintTransactionHash: {
              eq: jest.fn(),
            },
          },
        },
        Token: {
          get: jest.fn(),
        },
        effect: jest.fn(),
        log: {
          error: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should return position when found directly", async () => {
      (
        mockContext.NonFungiblePosition.getWhere.tokenId.eq as jest.Mock
      ).mockResolvedValue([mockPosition]);

      const result = await getPositionWithPlaceholderFallback(
        chainId,
        tokenId,
        transactionHash,
        mockContext,
        true,
      );

      expect(result).toEqual(mockPosition);
      expect(
        mockContext.NonFungiblePosition.getWhere.tokenId.eq as jest.Mock,
      ).toHaveBeenCalledWith(tokenId);
    });

    it("should return placeholder position when direct get fails", async () => {
      (
        mockContext.NonFungiblePosition.getWhere.tokenId.eq as jest.Mock
      ).mockResolvedValue([]);
      (
        mockContext.NonFungiblePosition.getWhere.mintTransactionHash
          .eq as jest.Mock
      ).mockResolvedValue([mockPlaceholderPosition]);

      const result = await getPositionWithPlaceholderFallback(
        chainId,
        tokenId,
        transactionHash,
        mockContext,
        true,
        transferLogIndex, // Pass logIndex for matching logic
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe(mockPlaceholderPosition.id);
      expect(result?.tokenId).toBe(mockPlaceholderPosition.tokenId);
    });

    it("should return null when position not found and no placeholder", async () => {
      (
        mockContext.NonFungiblePosition.getWhere.tokenId.eq as jest.Mock
      ).mockResolvedValue([]);
      (
        mockContext.NonFungiblePosition.getWhere.mintTransactionHash
          .eq as jest.Mock
      ).mockResolvedValue([]);

      const result = await getPositionWithPlaceholderFallback(
        chainId,
        tokenId,
        transactionHash,
        mockContext,
        true,
      );

      expect(result).toBeNull();
    });

    it("should not check placeholder when shouldCheckPlaceholder is false", async () => {
      (
        mockContext.NonFungiblePosition.getWhere.tokenId.eq as jest.Mock
      ).mockResolvedValue([]);

      const result = await getPositionWithPlaceholderFallback(
        chainId,
        tokenId,
        transactionHash,
        mockContext,
        false,
      );

      expect(result).toBeNull();
      expect(
        jest.mocked(
          mockContext.NonFungiblePosition.getWhere.mintTransactionHash.eq,
        ),
      ).not.toHaveBeenCalled();
    });
  });

  describe("findNonFungiblePositionByTXHashAndAmounts", () => {
    let mockContext: handlerContext;

    beforeEach(() => {
      mockContext = {
        NonFungiblePosition: {
          get: jest.fn(),
          getWhere: {
            mintTransactionHash: {
              eq: jest.fn(),
            },
          },
        },
        Token: {
          get: jest.fn(),
        },
        effect: jest.fn(),
        log: {
          error: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should return matching position when found", async () => {
      const matchingPosition = {
        ...mockPosition,
        amount0: 500000000000000000n,
        amount1: 1000000000000000000n,
      };
      const otherPosition = {
        ...mockPosition,
        id: `${chainId}_2`,
        tokenId: 2n,
        amount0: 1000000000000000000n,
        amount1: 2000000000000000000n,
      };

      (
        mockContext.NonFungiblePosition.getWhere.mintTransactionHash
          .eq as jest.Mock
      ).mockResolvedValue([matchingPosition, otherPosition]);

      const result = await findNonFungiblePositionByTXHashAndAmounts(
        transactionHash,
        500000000000000000n,
        1000000000000000000n,
        mockContext,
      );

      expect(result).toEqual(matchingPosition);
    });

    it("should return null when no positions found", async () => {
      (
        mockContext.NonFungiblePosition.getWhere.mintTransactionHash
          .eq as jest.Mock
      ).mockResolvedValue([]);

      const result = await findNonFungiblePositionByTXHashAndAmounts(
        transactionHash,
        500000000000000000n,
        1000000000000000000n,
        mockContext,
      );

      expect(result).toBeNull();
    });

    it("should return null when no matching amounts found", async () => {
      (
        mockContext.NonFungiblePosition.getWhere.mintTransactionHash
          .eq as jest.Mock
      ).mockResolvedValue([mockPosition]);

      const result = await findNonFungiblePositionByTXHashAndAmounts(
        transactionHash,
        999999999999999999n, // Different amounts
        999999999999999999n,
        mockContext,
      );

      expect(result).toBeNull();
    });

    it("should return null when positions is undefined", async () => {
      (
        mockContext.NonFungiblePosition.getWhere.mintTransactionHash
          .eq as jest.Mock
      ).mockResolvedValue(undefined);

      const result = await findNonFungiblePositionByTXHashAndAmounts(
        transactionHash,
        500000000000000000n,
        1000000000000000000n,
        mockContext,
      );

      expect(result).toBeNull();
    });
  });

  describe("getTokensForPosition", () => {
    let mockContext: handlerContext;

    beforeEach(() => {
      mockContext = {
        Token: {
          get: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should return both tokens in parallel", async () => {
      (mockContext.Token.get as jest.Mock)
        .mockResolvedValueOnce(mockToken0)
        .mockResolvedValueOnce(mockToken1);

      const [token0, token1] = await getTokensForPosition(
        chainId,
        mockPosition,
        mockContext,
      );

      expect(token0).toEqual(mockToken0);
      expect(token1).toEqual(mockToken1);
      expect(mockContext.Token.get as jest.Mock).toHaveBeenCalledTimes(2);
    });

    it("should handle undefined tokens", async () => {
      (mockContext.Token.get as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(mockToken1);

      const [token0, token1] = await getTokensForPosition(
        chainId,
        mockPosition,
        mockContext,
      );

      expect(token0).toBeUndefined();
      expect(token1).toEqual(mockToken1);
    });
  });

  describe("getSqrtPriceX96AndTokens", () => {
    let mockContext: handlerContext;
    const expectedSqrtPriceX96 = 1529784656458878688052415794232633n;

    beforeEach(() => {
      mockContext = {
        Token: {
          get: jest.fn(),
        },
        effect: jest.fn(),
        log: {
          warn: jest.fn(),
          error: jest.fn(),
        },
      } as unknown as handlerContext;
    });

    it("should return sqrtPriceX96 and tokens in parallel", async () => {
      (mockContext.effect as jest.Mock).mockResolvedValue(expectedSqrtPriceX96);
      (mockContext.Token.get as jest.Mock)
        .mockResolvedValueOnce(mockToken0)
        .mockResolvedValueOnce(mockToken1);

      const [sqrtPriceX96, token0, token1] = await getSqrtPriceX96AndTokens(
        chainId,
        mockPosition,
        123456,
        mockContext,
      );

      expect(sqrtPriceX96).toBe(expectedSqrtPriceX96);
      expect(token0).toEqual(mockToken0);
      expect(token1).toEqual(mockToken1);
      expect(mockContext.effect as jest.Mock).toHaveBeenCalledTimes(1);
      expect(mockContext.Token.get as jest.Mock).toHaveBeenCalledTimes(2);
      expect(mockContext.log.warn as jest.Mock).toHaveBeenCalledTimes(0);
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(0);
    });

    it("should handle undefined tokens", async () => {
      (mockContext.effect as jest.Mock).mockResolvedValue(expectedSqrtPriceX96);
      (mockContext.Token.get as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const [sqrtPriceX96, token0, token1] = await getSqrtPriceX96AndTokens(
        chainId,
        mockPosition,
        123456,
        mockContext,
      );

      expect(sqrtPriceX96).toBe(expectedSqrtPriceX96);
      expect(token0).toBeUndefined();
      expect(token1).toBeUndefined();
    });

    it("should retry with actual block number when rounded block fails with contract not exists error", async () => {
      const contractNotExistsError = new Error(
        'The contract function "slot0" returned no data ("0x").',
      );
      // First call (rounded block) fails, second call (actual block) succeeds
      (mockContext.effect as jest.Mock)
        .mockRejectedValueOnce(contractNotExistsError)
        .mockResolvedValueOnce(expectedSqrtPriceX96);
      (mockContext.Token.get as jest.Mock)
        .mockResolvedValueOnce(mockToken0)
        .mockResolvedValueOnce(mockToken1);

      // Use a block number that will round down (e.g., 1801 for chain 10 rounds to 1800)
      // For chain 10 (Optimism), blocksPerHour = 1800, so 1801 rounds to 1800
      const blockNumber = 1801;
      const [sqrtPriceX96, token0, token1] = await getSqrtPriceX96AndTokens(
        chainId,
        mockPosition,
        blockNumber,
        mockContext,
      );

      expect(sqrtPriceX96).toBe(expectedSqrtPriceX96);
      expect(token0).toEqual(mockToken0);
      expect(token1).toEqual(mockToken1);
      expect(mockContext.effect as jest.Mock).toHaveBeenCalledTimes(2);
      expect(mockContext.log.warn as jest.Mock).toHaveBeenCalledTimes(1);
      expect((mockContext.log.warn as jest.Mock).mock.calls[0][0]).toContain(
        "does not exist at rounded block",
      );
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(0);
    });

    it("should return undefined when both rounded and actual block fail", async () => {
      const contractNotExistsError = new Error(
        'The contract function "slot0" returned no data ("0x").',
      );
      // Both calls fail
      (mockContext.effect as jest.Mock).mockRejectedValue(
        contractNotExistsError,
      );
      (mockContext.Token.get as jest.Mock)
        .mockResolvedValueOnce(mockToken0)
        .mockResolvedValueOnce(mockToken1);

      const blockNumber = 1801;
      const [sqrtPriceX96, token0, token1] = await getSqrtPriceX96AndTokens(
        chainId,
        mockPosition,
        blockNumber,
        mockContext,
      );

      expect(sqrtPriceX96).toBeUndefined();
      expect(token0).toEqual(mockToken0);
      expect(token1).toEqual(mockToken1);
      expect(mockContext.effect as jest.Mock).toHaveBeenCalledTimes(2);
      expect(mockContext.log.warn as jest.Mock).toHaveBeenCalledTimes(1);
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(1);
      expect((mockContext.log.error as jest.Mock).mock.calls[0][0]).toContain(
        "Failed to fetch sqrtPriceX96",
      );
    });

    it("should retry with actual block even for non-contract-not-exists errors and return undefined if both fail", async () => {
      const networkError = new Error("Network error: connection timeout");
      // Both calls fail with network error
      (mockContext.effect as jest.Mock).mockRejectedValue(networkError);
      (mockContext.Token.get as jest.Mock)
        .mockResolvedValueOnce(mockToken0)
        .mockResolvedValueOnce(mockToken1);

      const blockNumber = 1801;
      const [sqrtPriceX96, token0, token1] = await getSqrtPriceX96AndTokens(
        chainId,
        mockPosition,
        blockNumber,
        mockContext,
      );

      expect(sqrtPriceX96).toBeUndefined();
      expect(token0).toEqual(mockToken0);
      expect(token1).toEqual(mockToken1);
      expect(mockContext.effect as jest.Mock).toHaveBeenCalledTimes(2);
      expect(mockContext.log.warn as jest.Mock).toHaveBeenCalledTimes(1);
      expect(mockContext.log.error as jest.Mock).toHaveBeenCalledTimes(1);
    });
  });

  describe("processTransfer", () => {
    it("should update owner and recalculate USD value", () => {
      const newOwner = "0x2222222222222222222222222222222222222222";
      const blockTimestamp = 1000000;

      const result = processTransfer(
        newOwner,
        mockPosition,
        tokenId,
        mockToken0,
        mockToken1,
        blockTimestamp,
      );

      expect(result.owner).toBe(newOwner);
      expect(typeof result.amountUSD).toBe("bigint");
      expect(result.lastUpdatedTimestamp).toBeInstanceOf(Date);
      // amountUSD should be calculated: amount0 * price0 + amount1 * price1
      // 0.5 * 1 + 1 * 2 = 2.5 (in 18 decimals)
      expect(result.amountUSD).toBe(2500000000000000000n);
    });

    it("should handle undefined tokens", () => {
      const newOwner = "0x2222222222222222222222222222222222222222";
      const blockTimestamp = 1000000;

      const result = processTransfer(
        newOwner,
        mockPosition,
        tokenId,
        undefined,
        undefined,
        blockTimestamp,
      );

      expect(result.owner).toBe(newOwner);
      // When tokens are undefined, amountUSD should be 0
      expect(result.amountUSD).toBe(0n);
    });
  });

  describe("processIncreaseLiquidity", () => {
    const mockEvent: NFPM_IncreaseLiquidity_event = {
      params: {
        tokenId: tokenId,
        liquidity: 500000000000000000n, // 0.5 tokens
        amount0: 250000000000000000n,
        amount1: 500000000000000000n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: transactionHash,
      },
      chainId: chainId,
      logIndex: 1,
      srcAddress: "0x3333333333333333333333333333333333333333",
      transaction: {
        hash: transactionHash,
      },
    } as NFPM_IncreaseLiquidity_event;

    it("should increase liquidity and recalculate amounts", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      // Calculate expected new liquidity
      const expectedLiquidity =
        (mockPosition.liquidity ?? 0n) + mockEvent.params.liquidity;

      // Calculate expected new amounts from the new liquidity
      const expectedAmounts = calculatePositionAmountsFromLiquidity(
        expectedLiquidity,
        sqrtPriceX96,
        mockPosition.tickLower,
        mockPosition.tickUpper,
      );

      // Calculate expected amountUSD using the same function as the implementation
      const expectedAmountUSD = calculateTotalLiquidityUSD(
        expectedAmounts.amount0,
        expectedAmounts.amount1,
        mockToken0,
        mockToken1,
      );

      const result = processIncreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        mockToken0,
        mockToken1,
      );

      // Verify exact equality
      expect(result.liquidity).toBe(expectedLiquidity);
      expect(result.amount0).toBe(expectedAmounts.amount0);
      expect(result.amount1).toBe(expectedAmounts.amount1);
      expect(result.amountUSD).toBe(expectedAmountUSD);
      expect(result.lastUpdatedTimestamp).toBeInstanceOf(Date);
    });

    it("should handle position with no existing liquidity", () => {
      const positionWithoutLiquidity = {
        ...mockPosition,
        liquidity: undefined,
      };
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      const result = processIncreaseLiquidity(
        mockEvent,
        positionWithoutLiquidity as unknown as NonFungiblePosition,
        sqrtPriceX96,
        mockToken0,
        mockToken1,
      );

      // Should default to 0n for liquidity
      expect(result.liquidity).toBe(mockEvent.params.liquidity);
    });

    it("should handle undefined tokens", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      const result = processIncreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        undefined,
        undefined,
      );

      expect(result.liquidity).toBe(1500000000000000000n);
      expect(result.amount0).toBe(0n);
      expect(result.amount1).toBe(14999312540700449n);
      // amountUSD should be 0 when tokens are undefined
      expect(result.amountUSD).toBe(0n);
    });

    it("should calculate amountUSD correctly when tokens have valid prices", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      const result = processIncreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        mockToken0,
        mockToken1,
      );

      // Calculate expected amountUSD:
      // amount0 and amount1 are recalculated from liquidity
      // amountUSD = (normalizedAmount0 * price0 / 1e18) + (normalizedAmount1 * price1 / 1e18)
      // Since both tokens have 18 decimals, normalization doesn't change them
      // amountUSD = (amount0 * 1e18 / 1e18) + (amount1 * 2e18 / 1e18)
      // amountUSD = amount0 + (amount1 * 2)
      const expectedAmountUSD =
        (result.amount0 ?? 0n) + (result.amount1 ?? 0n) * 2n;

      expect(result.amountUSD).toBe(expectedAmountUSD);
      expect((result.amountUSD ?? 0n) > 0n).toBe(true);
    });

    it("should return 0 amountUSD when tokens have 0 price", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;
      const tokenWithZeroPrice = {
        ...mockToken0,
        pricePerUSDNew: 0n,
      };
      const token1WithZeroPrice = {
        ...mockToken1,
        pricePerUSDNew: 0n,
      };

      const result = processIncreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        tokenWithZeroPrice,
        token1WithZeroPrice,
      );

      // amountUSD should be 0 when token prices are 0
      expect(result.amountUSD).toBe(0n);
    });
  });

  describe("processDecreaseLiquidity", () => {
    const mockEvent: NFPM_DecreaseLiquidity_event = {
      params: {
        tokenId: tokenId,
        liquidity: 200000000000000000n, // 0.2 tokens
        amount0: 100000000000000000n,
        amount1: 200000000000000000n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: transactionHash,
      },
      chainId: chainId,
      logIndex: 1,
      srcAddress: "0x3333333333333333333333333333333333333333",
      transaction: {
        hash: transactionHash,
      },
    } as NFPM_DecreaseLiquidity_event;

    it("should decrease liquidity and recalculate amounts", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      // Calculate expected new liquidity
      const currentLiquidity = mockPosition.liquidity ?? 0n;
      const expectedLiquidity =
        currentLiquidity > mockEvent.params.liquidity
          ? currentLiquidity - mockEvent.params.liquidity
          : 0n;

      // Calculate expected new amounts from the new liquidity
      const expectedAmounts = calculatePositionAmountsFromLiquidity(
        expectedLiquidity,
        sqrtPriceX96,
        mockPosition.tickLower,
        mockPosition.tickUpper,
      );

      // Calculate expected amountUSD using the same function as the implementation
      const expectedAmountUSD = calculateTotalLiquidityUSD(
        expectedAmounts.amount0,
        expectedAmounts.amount1,
        mockToken0,
        mockToken1,
      );

      const result = processDecreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        mockToken0,
        mockToken1,
      );

      // Verify exact equality
      expect(result.liquidity).toBe(expectedLiquidity);
      expect(result.amount0).toBe(expectedAmounts.amount0);
      expect(result.amount1).toBe(expectedAmounts.amount1);
      expect(result.amountUSD).toBe(expectedAmountUSD);
      expect(result.lastUpdatedTimestamp).toBeInstanceOf(Date);
    });

    it("should handle position with no existing liquidity", () => {
      const positionWithoutLiquidity = {
        ...mockPosition,
        liquidity: undefined,
      };
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      const result = processDecreaseLiquidity(
        mockEvent,
        positionWithoutLiquidity as unknown as NonFungiblePosition,
        sqrtPriceX96,
        mockToken0,
        mockToken1,
      );

      // Should default to 0n for liquidity, so result should be 0n
      expect(result.liquidity).toBe(0n);
    });

    it("should handle undefined tokens", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      const result = processDecreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        undefined,
        undefined,
      );

      expect(typeof result.liquidity).toBe("bigint");
      expect(typeof result.amount0).toBe("bigint");
      expect(typeof result.amount1).toBe("bigint");
      // amountUSD should be 0 when tokens are undefined
      expect(result.amountUSD).toBe(0n);
    });

    it("should calculate amountUSD correctly when tokens have valid prices", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;

      const result = processDecreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        mockToken0,
        mockToken1,
      );

      // Calculate expected amountUSD:
      // amount0 and amount1 are recalculated from liquidity
      // amountUSD = (normalizedAmount0 * price0 / 1e18) + (normalizedAmount1 * price1 / 1e18)
      // Since both tokens have 18 decimals, normalization doesn't change them
      // amountUSD = (amount0 * 1e18 / 1e18) + (amount1 * 2e18 / 1e18)
      // amountUSD = amount0 + (amount1 * 2)
      const expectedAmountUSD =
        (result.amount0 ?? 0n) + (result.amount1 ?? 0n) * 2n;

      expect(result.amountUSD).toBe(expectedAmountUSD);
      // After decreasing liquidity, amountUSD should still be > 0 (unless liquidity went to 0)
      if ((result.liquidity ?? 0n) > 0n) {
        expect((result.amountUSD ?? 0n) > 0n).toBe(true);
      }
    });

    it("should return 0 amountUSD when tokens have 0 price", () => {
      const sqrtPriceX96 = 1529784656458878688052415794232633n;
      const tokenWithZeroPrice = {
        ...mockToken0,
        pricePerUSDNew: 0n,
      };
      const token1WithZeroPrice = {
        ...mockToken1,
        pricePerUSDNew: 0n,
      };

      const result = processDecreaseLiquidity(
        mockEvent,
        mockPosition,
        sqrtPriceX96,
        tokenWithZeroPrice,
        token1WithZeroPrice,
      );

      // amountUSD should be 0 when token prices are 0
      expect(result.amountUSD).toBe(0n);
    });
  });
});
