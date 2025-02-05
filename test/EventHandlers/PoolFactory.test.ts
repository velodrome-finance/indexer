import { expect } from "chai";
import { MockDb, PoolFactory } from "../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../src/Constants";
import * as PriceOracle from "../../src/PriceOracle";
import sinon from "sinon";
import { setupCommon } from "./Pool/common";
import { Token } from "../../generated/src/Types.gen";

describe("PoolFactory Events", () => {

  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } = setupCommon();
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;
  const poolAddress = mockLiquidityPoolData.id;
  const chainId = 10;

  let mockPriceOracle: sinon.SinonStub;

  describe("PoolCreated event", () => {
    let createdPool: any;

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
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234"
          }, 
          chainId,
          logIndex: 1,
        }
      });
      const result = await PoolFactory.PoolCreated.processEvent({ event: mockEvent, mockDb });
      createdPool = result.entities.LiquidityPoolAggregator.get(toChecksumAddress(poolAddress));
    });

    afterEach(() => {
      mockPriceOracle.restore();
    });

    it('should create token entities', async () => {
      expect(mockPriceOracle.calledTwice).to.be.true;
    });

    it("should create a new LiquidityPool entity and Token entities", async () => {
      expect(createdPool).to.not.be.undefined;
      expect(createdPool?.isStable).to.be.false;
      expect(createdPool?.lastUpdatedTimestamp).to.deep.equal(new Date(1000000 * 1000));
    });

    it("should appropriately set token data on the aggregator", () => {
      expect(createdPool?.token0_id).to.equal(toChecksumAddress(token0Address) + "-" + chainId);
      expect(createdPool?.token1_id).to.equal(toChecksumAddress(token1Address) + "-" + chainId);
      expect(createdPool?.token0_address).to.equal(token0Address);
      expect(createdPool?.token1_address).to.equal(token1Address);
    });
  });

  describe("SetCustomFee event", () => {
    it("should create a new PoolFactory_SetCustomFee entity", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const mockEvent = PoolFactory.SetCustomFee.createMockEvent({
        pool: "0x3333333333333333333333333333333333333333",
        fee: 100n,
        mockEventData: { 
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234"
          }, 
          chainId: 10,
          logIndex: 1,
        }
      });

      // Execute
      const result = await PoolFactory.SetCustomFee.processEvent({ event: mockEvent, mockDb });

      // Assert
      const setCustomFeeEvent = result.entities.PoolFactory_SetCustomFee.get("10_1000000_1");
      expect(setCustomFeeEvent).to.not.be.undefined;
      expect(setCustomFeeEvent?.pool).to.equal(poolAddress);
      expect(setCustomFeeEvent?.fee).to.equal(100n);
      expect(setCustomFeeEvent?.timestamp).to.deep.equal(new Date(1000000 * 1000));
    });
  });
});
