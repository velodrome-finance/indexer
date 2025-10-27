import { expect } from "chai";
import sinon from "sinon";
import { MockDb, NFPM } from "../../../generated/src/TestHelpers.gen";

const NonFungiblePositionId = (chainId: number, tokenId: bigint) =>
  `${chainId}_${tokenId}`;

const TokenId = (chainId: number, tokenAddress: string) =>
  `${chainId}_${tokenAddress}`;

describe("NFPM Events", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const chainId = 10;
  const tokenId = 1n;
  const token0Address = "0xToken0Address0000000000000000000000";
  const token1Address = "0xToken1Address0000000000000000000000";

  const mockNonFungiblePosition = {
    id: NonFungiblePositionId(chainId, tokenId),
    chainId: 10,
    tokenId: tokenId,
    owner: "0x1111111111111111111111111111111111111111",
    pool: "0xPoolAddress0000000000000000000000",
    tickUpper: 100,
    tickLower: -100,
    token0: token0Address,
    token1: token1Address,
    amount0: 1000000000000000000n,
    amount1: 2000000000000000000n,
    amountUSD: 3000000000000000000n,
    lastUpdatedTimestamp: new Date(),
  };

  // Mock Token entities needed for calculateTotalLiquidityUSD
  // pricePerUSDNew is stored with 18 decimals (1e18 = 1 USD per token)
  const mockToken0 = {
    id: TokenId(chainId, token0Address),
    chainId: chainId,
    address: token0Address,
    symbol: "TOKEN0",
    name: "Token 0",
    decimals: 18n,
    pricePerUSD: 0n,
    pricePerUSDNew: 10n ** 18n, // 1 USD per token (1e18)
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  const mockToken1 = {
    id: TokenId(chainId, token1Address),
    chainId: chainId,
    address: token1Address,
    symbol: "TOKEN1",
    name: "Token 1",
    decimals: 18n,
    pricePerUSD: 0n,
    pricePerUSDNew: 2n * 10n ** 18n, // 2 USD per token (2e18)
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(),
  };

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
    mockDb = mockDb.entities.NonFungiblePosition.set({
      ...mockNonFungiblePosition,
    });
    mockDb = mockDb.entities.Token.set(mockToken0);
    mockDb = mockDb.entities.Token.set(mockToken1);
  });

  describe("Transfer Event", () => {
    const eventData = {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      tokenId: 1n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof NFPM.Transfer.createMockEvent>;

    beforeEach(async () => {
      mockEvent = NFPM.Transfer.createMockEvent(eventData);
      postEventDB = await NFPM.Transfer.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should update the owner and recalculate amountUSD", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return; // Type guard
      expect(updatedEntity.owner.toLowerCase()).to.equal(
        eventData.to.toLowerCase(),
      );
      expect(updatedEntity.amount0).to.equal(mockNonFungiblePosition.amount0);
      expect(updatedEntity.amount1).to.equal(mockNonFungiblePosition.amount1);
      // amountUSD should be recalculated: (amount0 * pricePerUSD) + (amount1 * pricePerUSD)
      // (1e18 * 1) + (2e18 * 2) = 1e18 + 4e18 = 5e18
      expect(updatedEntity.amountUSD).to.equal(5000000000000000000n);
    });
  });

  describe("IncreaseLiquidity Event", () => {
    const eventData = {
      tokenId: 1n,
      liquidity: 1000n,
      amount0: 500000000000000000n,
      amount1: 1000000000000000000n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof NFPM.IncreaseLiquidity.createMockEvent>;

    beforeEach(async () => {
      mockEvent = NFPM.IncreaseLiquidity.createMockEvent(eventData);
      postEventDB = await NFPM.IncreaseLiquidity.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should increase amount0 and amount1 and recalculate amountUSD", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return; // Type guard
      expect(updatedEntity.amount0).to.equal(1500000000000000000n); // 1000n + 500n
      expect(updatedEntity.amount1).to.equal(3000000000000000000n); // 2000n + 1000n
      expect(updatedEntity.owner).to.equal(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).to.equal(
        mockNonFungiblePosition.tickUpper,
      );
      expect(updatedEntity.tickLower).to.equal(
        mockNonFungiblePosition.tickLower,
      );
      // amountUSD: (1.5e18 * 1) + (3e18 * 2) = 1.5e18 + 6e18 = 7.5e18
      expect(updatedEntity.amountUSD).to.equal(7500000000000000000n);
    });
  });

  describe("DecreaseLiquidity Event", () => {
    const eventData = {
      tokenId: 1n,
      liquidity: 1000n,
      amount0: 300000000000000000n,
      amount1: 500000000000000000n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    };

    let postEventDB: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof NFPM.DecreaseLiquidity.createMockEvent>;

    beforeEach(async () => {
      mockEvent = NFPM.DecreaseLiquidity.createMockEvent(eventData);
      postEventDB = await NFPM.DecreaseLiquidity.processEvent({
        event: mockEvent,
        mockDb: mockDb,
      });
    });

    it("should decrease amount0 and amount1 and recalculate amountUSD", () => {
      const updatedEntity = postEventDB.entities.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, tokenId),
      );
      expect(updatedEntity).to.exist;
      if (!updatedEntity) return; // Type guard
      expect(updatedEntity.amount0).to.equal(700000000000000000n); // 1000n - 300n
      expect(updatedEntity.amount1).to.equal(1500000000000000000n); // 2000n - 500n
      expect(updatedEntity.owner).to.equal(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).to.equal(
        mockNonFungiblePosition.tickUpper,
      );
      expect(updatedEntity.tickLower).to.equal(
        mockNonFungiblePosition.tickLower,
      );
      // amountUSD: (0.7e18 * 1) + (1.5e18 * 2) = 0.7e18 + 3e18 = 3.7e18
      expect(updatedEntity.amountUSD).to.equal(3700000000000000000n);
    });
  });
});
