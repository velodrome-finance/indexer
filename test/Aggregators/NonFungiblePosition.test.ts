import type { NonFungiblePosition, handlerContext } from "generated";
import {
  NonFungiblePositionId,
  updateNonFungiblePosition,
} from "../../src/Aggregators/NonFungiblePosition";

describe("NonFungiblePosition", () => {
  let mockContext: Partial<handlerContext>;
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const mockNonFungiblePosition: NonFungiblePosition = {
    id: "10_1",
    chainId: 10,
    tokenId: 1n,
    owner: "0x1111111111111111111111111111111111111111",
    pool: "0xPoolAddress0000000000000000000000",
    tickUpper: 100n,
    tickLower: -100n,
    token0: "0xToken0Address0000000000000000000000",
    token1: "0xToken1Address0000000000000000000000",
    liquidity: 1000000000000000000n,
    amount0: 1000000000000000000n,
    amount1: 2000000000000000000n,
    amountUSD: 3000000000000000000n,
    mintTransactionHash: transactionHash,
    lastUpdatedTimestamp: new Date(10000 * 1000),
  };
  const timestamp = new Date(10001 * 1000);

  beforeEach(() => {
    mockContext = {
      NonFungiblePosition: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          owner: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          tokenId: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
          mintTransactionHash: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      log: {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("updateNonFungiblePosition", () => {
    describe("when updating with transfer diff (owner change)", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const transferDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: "0x2222222222222222222222222222222222222222",
          lastUpdatedTimestamp: timestamp,
        };

        updateNonFungiblePosition(
          transferDiff,
          mockNonFungiblePosition,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.NonFungiblePosition?.set);
        result = mockSet?.mock.calls[0]?.[0] as NonFungiblePosition;
      });

      it("should update the nonFungiblePosition with new owner", () => {
        expect(result.id).toBe(NonFungiblePositionId(10, 1n));
        expect(result.owner).toBe("0x2222222222222222222222222222222222222222");
        expect(result.tickUpper).toBe(100n); // unchanged
        expect(result.tickLower).toBe(-100n); // unchanged
        expect(result.amount0).toBe(1000000000000000000n); // unchanged
        expect(result.amount1).toBe(2000000000000000000n); // unchanged
        expect(result.amountUSD).toBe(3000000000000000000n); // unchanged
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });

    describe("when updating with increase liquidity diff", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const increaseDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          amount0: 1500000000000000000n, // new absolute value
          amount1: 3000000000000000000n, // new absolute value
          lastUpdatedTimestamp: timestamp,
        };

        updateNonFungiblePosition(
          increaseDiff,
          mockNonFungiblePosition,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.NonFungiblePosition?.set);
        result = mockSet?.mock.calls[0]?.[0] as NonFungiblePosition;
      });

      it("should update amount0 and amount1 with absolute values", () => {
        expect(result.amount0).toBe(1500000000000000000n); // new absolute value
        expect(result.amount1).toBe(3000000000000000000n); // new absolute value
        expect(result.owner).toBe("0x1111111111111111111111111111111111111111"); // unchanged
        expect(result.tickUpper).toBe(100n); // unchanged
        expect(result.tickLower).toBe(-100n); // unchanged
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });

    describe("when updating with decrease liquidity diff", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const decreaseDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          amount0: 500000000000000000n, // new absolute value
          amount1: 1000000000000000000n, // new absolute value
          lastUpdatedTimestamp: timestamp,
        };

        updateNonFungiblePosition(
          decreaseDiff,
          mockNonFungiblePosition,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.NonFungiblePosition?.set);
        result = mockSet?.mock.calls[0]?.[0] as NonFungiblePosition;
      });

      it("should update amount0 and amount1 with absolute values", () => {
        expect(result.amount0).toBe(500000000000000000n); // new absolute value
        expect(result.amount1).toBe(1000000000000000000n); // new absolute value
        expect(result.owner).toBe("0x1111111111111111111111111111111111111111"); // unchanged
        expect(result.tickUpper).toBe(100n); // unchanged
        expect(result.tickLower).toBe(-100n); // unchanged
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });

    describe("when updating with partial diff (only amount0)", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const partialDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          amount0: 1500000000000000000n, // new absolute value
          lastUpdatedTimestamp: timestamp,
        };

        updateNonFungiblePosition(
          partialDiff,
          mockNonFungiblePosition,
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.NonFungiblePosition?.set);
        result = mockSet?.mock.calls[0]?.[0] as NonFungiblePosition;
      });

      it("should update only amount0, leave amount1 unchanged", () => {
        expect(result.amount0).toBe(1500000000000000000n); // new absolute value
        expect(result.amount1).toBe(2000000000000000000n); // unchanged
        expect(result.owner).toBe("0x1111111111111111111111111111111111111111"); // unchanged
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
      });
    });
  });
});
