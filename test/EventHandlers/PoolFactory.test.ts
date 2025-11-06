import { expect } from "chai";
import sinon from "sinon";
import { MockDb, PoolFactory } from "../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
} from "../../generated/src/Types.gen";
import { toChecksumAddress } from "../../src/Constants";
import * as PriceOracle from "../../src/PriceOracle";
import { setupCommon } from "./Pool/common";

describe("PoolFactory Events", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;
  const poolAddress = mockLiquidityPoolData.id;
  const chainId = 10;

  let mockPriceOracle: sinon.SinonStub;

  describe("PoolCreated event", () => {
    let createdPool: LiquidityPoolAggregator | undefined;

    beforeEach(async () => {
      mockPriceOracle = sinon
        .stub(PriceOracle, "createTokenEntity")
        .callsFake(async (...args) => {
          if (args[0] === token0Address) return mockToken0Data as Token;
          return mockToken1Data as Token;
        });

      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        stable: false,
        mockEventData: {
          block: {
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId,
          logIndex: 1,
        },
      });
      const result = await PoolFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });
      createdPool = result.entities.LiquidityPoolAggregator.get(poolAddress);
    });

    afterEach(() => {
      mockPriceOracle.restore();
    });

    it("should create token entities", async () => {
      expect(mockPriceOracle.calledTwice).to.be.true;
    });

    it("should create a new LiquidityPool entity and Token entities", async () => {
      expect(createdPool).to.not.be.undefined;
      expect(createdPool?.isStable).to.be.false;
      expect(createdPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(1000000 * 1000),
      );
    });

    it("should appropriately set token data on the aggregator", () => {
      expect(createdPool?.token0_id).to.equal(`${token0Address}-${chainId}`);
      expect(createdPool?.token1_id).to.equal(`${token1Address}-${chainId}`);
      expect(createdPool?.token0_address).to.equal(token0Address);
      expect(createdPool?.token1_address).to.equal(token1Address);
    });
  });

  describe("SetCustomFee event", () => {
    it("should update the LiquidityPoolAggregator", async () => {
      // Setup - create a pool entity first
      let mockDb = MockDb.createMockDb();
      const existingPool: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        baseFee: undefined,
        currentFee: undefined,
        lastUpdatedTimestamp: new Date(900000 * 1000),
      };
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(existingPool);

      const customFee = 500n; // 0.05% fee (500 basis points)
      const blockTimestamp = 2000000;
      const mockEvent = PoolFactory.SetCustomFee.createMockEvent({
        pool: poolAddress,
        fee: customFee,
        mockEventData: {
          block: {
            number: 2000000,
            timestamp: blockTimestamp,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
        },
      });

      // Execute
      const result = await PoolFactory.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check LiquidityPoolAggregator was updated
      const updatedPool =
        result.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.baseFee).to.equal(customFee);
      expect(updatedPool?.currentFee).to.equal(customFee);
      expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
      // Verify other fields are preserved
      expect(updatedPool?.id).to.equal(existingPool.id);
      expect(updatedPool?.chainId).to.equal(existingPool.chainId);
      expect(updatedPool?.token0_address).to.equal(existingPool.token0_address);
      expect(updatedPool?.token1_address).to.equal(existingPool.token1_address);
    });

    it("should update existing fee values when pool already has fees set", async () => {
      // Setup - create a pool entity with existing fees
      let mockDb = MockDb.createMockDb();
      const existingFee = 300n;
      const existingPool: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        baseFee: existingFee,
        currentFee: existingFee,
        lastUpdatedTimestamp: new Date(900000 * 1000),
      };
      mockDb = mockDb.entities.LiquidityPoolAggregator.set(existingPool);

      const newFee = 750n;
      const blockTimestamp = 2000000;
      const mockEvent = PoolFactory.SetCustomFee.createMockEvent({
        pool: poolAddress,
        fee: newFee,
        mockEventData: {
          block: {
            number: 2000000,
            timestamp: blockTimestamp,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
        },
      });

      // Execute
      const result = await PoolFactory.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check fees were updated
      const updatedPool =
        result.entities.LiquidityPoolAggregator.get(poolAddress);
      expect(updatedPool).to.not.be.undefined;
      expect(updatedPool?.baseFee).to.equal(newFee);
      expect(updatedPool?.currentFee).to.equal(newFee);
      expect(updatedPool?.baseFee).to.not.equal(existingFee);
      expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should return early without updating pool if pool does not exist", async () => {
      // Setup - no pool entity in mock DB
      const mockDb = MockDb.createMockDb();
      const nonExistentPoolAddress = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const mockEvent = PoolFactory.SetCustomFee.createMockEvent({
        pool: nonExistentPoolAddress,
        fee: 100n,
        mockEventData: {
          block: {
            number: 2000000,
            timestamp: 2000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 2,
        },
      });

      // Execute
      const result = await PoolFactory.SetCustomFee.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - LiquidityPoolAggregator should not be updated
      const pool = result.entities.LiquidityPoolAggregator.get(
        nonExistentPoolAddress,
      );
      expect(pool).to.be.undefined;
    });
  });
});
