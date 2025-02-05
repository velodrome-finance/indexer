import { expect } from "chai";
import sinon from "sinon";
import { MockDb, CLPool } from "../../../generated/src/TestHelpers.gen";
import {
  Token,
  CLFactory_PoolCreated,
  LiquidityPoolAggregator,
} from "../../../generated/src/Types.gen";
import * as LiquidityPoolAggregatorFunctions from "../../../src/Aggregators/LiquidityPoolAggregator";
import * as PriceOracle from "../../../src/PriceOracle";
import { abs } from "../../../src/Maths";
import { setupCommon } from "../Pool/common";

describe("CLPool Event Handlers", () => {
  let mockDb: any;
  let updateLiquidityPoolAggregatorStub: sinon.SinonStub;
  let mockPriceOracle: sinon.SinonStub;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();

    updateLiquidityPoolAggregatorStub = sinon.stub(
      LiquidityPoolAggregatorFunctions,
      "updateLiquidityPoolAggregator"
    );
    mockPriceOracle = sinon
      .stub(PriceOracle, "refreshTokenPrice")
      .callsFake(async (...args) => {
        return args[0]; // Return the token that was passed in
      });

  });

  afterEach(() => {
    sinon.restore();
    updateLiquidityPoolAggregatorStub.restore();
  });

  describe("Mint Event", () => {
    let mockEvent: any;
    let eventData: any;


    const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } = setupCommon();

    let expectations: any = {
      amount0In: 100n * 10n ** 18n,
      amount1In: 100n * 10n ** 6n,
      totalLiquidityUSD: 0n,
    };

    expectations.totalLiquidityUSD =
      (mockLiquidityPoolData.reserve0 + expectations.amount0In) * mockToken0Data.pricePerUSDNew / ( 10n ** (mockToken0Data.decimals) )  +
      (mockLiquidityPoolData.reserve1 + expectations.amount1In) * mockToken1Data.pricePerUSDNew / ( 10n ** (mockToken1Data.decimals) );

    let postEventDB: any;
    let collectedEntity: any;

    beforeEach(async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData);

      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data);

      eventData = {
        sender: "0x4444444444444444444444444444444444444444",
        to: "0x5555555555555555555555555555555555555555",
        amount0: expectations.amount0In,
        amount1: expectations.amount1In,
        tickUpper: 100000n,
        tickLower: 100000n,
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
      mockEvent = CLPool.Mint.createMockEvent(eventData);

      postEventDB = await CLPool.Mint.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });

      const expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
      collectedEntity = postEventDB.entities.CLPool_Mint.get(expectedId);

    });

    it("should create a mint entity", () => {
      expect(collectedEntity).to.not.be.undefined;
      expect(collectedEntity?.amount0).to.equal(expectations.amount0In);
      expect(collectedEntity?.amount1).to.equal(expectations.amount1In);
    });

    describe("CLPool Aggregator", () => {
      let diff: any;
      beforeEach(() => {
        [diff] = updateLiquidityPoolAggregatorStub.firstCall.args;
      });

      it("should update the reserves", () => {
        expect(diff.reserve0).to.equal(
          mockLiquidityPoolData.reserve0 +
          expectations.amount0In,
          "Reserve 0 should be appropriately updated");
        expect(diff.reserve1).to.equal(
          mockLiquidityPoolData.reserve1 +
          expectations.amount1In,
         "Reserve 1 should be appropriately updated");
      });
      it("should update the total liquidity in USD correctly", () => {
        expect(diff.totalLiquidityUSD).to.equal(
          expectations.totalLiquidityUSD,
         "Liquidity should be updated with appropriate prices");
      });
    });
  });

  describe("Burn Event", () => {
    let mockEvent: any;
    let eventData: any;

    let expectations: any = {
      amount0In: 100n * 10n ** 18n,
      amount1In: 100n * 10n ** 6n,
      totalLiquidity: 0n,
    };

    const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } = setupCommon();

    let postEventDB: any;
    let collectedEntity: any;

    beforeEach(async () => {
      const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData);

      const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data);
      const updatedDB3 = updatedDB2.entities.Token.set(mockToken1Data);

      eventData = {
        sender: "0x4444444444444444444444444444444444444444",
        to: "0x5555555555555555555555555555555555555555",
        amount0: expectations.amount0In,
        amount1: expectations.amount1In,
        tickUpper: 100000n,
        tickLower: 100000n,
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
      mockEvent = CLPool.Burn.createMockEvent(eventData);

      postEventDB = await CLPool.Burn.processEvent({
        event: mockEvent,
        mockDb: updatedDB3,
      });

      const expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
      collectedEntity = postEventDB.entities.CLPool_Burn.get(expectedId);

    });

    it("should create a burn entity", () => {
      expect(collectedEntity).to.not.be.undefined;
      expect(collectedEntity?.amount0).to.equal(expectations.amount0In);
      expect(collectedEntity?.amount1).to.equal(expectations.amount1In);
    });

  });

  describe("Collect Event", () => {
    let mockEvent: any;
    let mockEventData: any;
    let setupDB: any;
    const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } = setupCommon();
    const poolId = mockLiquidityPoolData.id; 
    let expectations: any = {
      amount0In: 100n * 10n ** 18n,
      amount1In: 100n * 10n ** 6n,
      totalLiquidityUSD: 0n,
    };

    expectations.totalLiquidityUSD =
      (mockLiquidityPoolData.reserve0 - expectations.amount0In) * mockToken0Data.pricePerUSDNew / ( 10n ** (mockToken0Data.decimals) )  +
      (mockLiquidityPoolData.reserve1 - expectations.amount1In) * mockToken1Data.pricePerUSDNew / ( 10n ** (mockToken1Data.decimals) );

    beforeEach(() => {
      mockEventData = {
        amount0: expectations.amount0In,
        amount1: expectations.amount1In,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xblockhash",
          },
          chainId: 1,
          logIndex: 0,
          srcAddress: poolId,
        },
      };

      mockEvent = CLPool.Collect.createMockEvent(mockEventData);
    });

    describe("when event is processed", () => {
      beforeEach(async () => {
        let updatedDB = mockDb.entities.Token.set(mockToken0Data);
        updatedDB = updatedDB.entities.Token.set(mockToken1Data);
        updatedDB =
          updatedDB.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData);

        setupDB = await CLPool.Collect.processEvent({
          event: mockEvent,
          mockDb: updatedDB,
        });
      });

      it("should create a CLPool_Collect entity", async () => {
        const expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
        const collectEntity = setupDB.entities.CLPool_Collect.get(expectedId);
        expect(collectEntity).to.not.be.undefined;
        expect(collectEntity?.amount0).to.equal(expectations.amount0In);
        expect(collectEntity?.amount1).to.equal(expectations.amount1In);
      });

      describe("CLPool Aggregator", () => {
        let diff: any;
        beforeEach(() => {
          [diff] = updateLiquidityPoolAggregatorStub.firstCall.args;
        });

        it("should update the reserves", () => {
          expect(diff.reserve0).to.equal(
            mockLiquidityPoolData.reserve0 -
            expectations.amount0In,
            "Reserve 0 should be appropriately updated");
          expect(diff.reserve1).to.equal(
            mockLiquidityPoolData.reserve1 -
            expectations.amount1In,
          "Reserve 1 should be appropriately updated");
        });
        it("should update the total liquidity in USD correctly", () => {
          expect(diff.totalLiquidityUSD).to.equal(
            expectations.totalLiquidityUSD,
          "Liquidity should be updated with appropriate prices");
        });
      });
    });
  });
  describe("Collect Fees Event", () => {
    let mockEvent: any;
    let mockEventData: any;
    let setupDB: any;

    const { mockToken0Data, mockToken1Data, mockLiquidityPoolData} = setupCommon();
    const poolId = mockLiquidityPoolData.id; 

    let expectations: any = {
      amount0In: 100n * 10n ** 18n,
      amount1In: 100n * 10n ** 6n,
      totalLiquidityUSD: 0n,
    };

    expectations.totalLiquidityUSD =
      (mockLiquidityPoolData.reserve0 - expectations.amount0In) * mockToken0Data.pricePerUSDNew / ( 10n ** (mockToken0Data.decimals) )  +
      (mockLiquidityPoolData.reserve1 - expectations.amount1In) * mockToken1Data.pricePerUSDNew / ( 10n ** (mockToken1Data.decimals) );
    
    expectations.totalFeesUSD =
          mockLiquidityPoolData.totalFeesUSD +
            (expectations.amount0In / 10n ** (mockToken0Data.decimals) ) * mockToken0Data.pricePerUSDNew +
            (expectations.amount1In / 10n ** (mockToken1Data.decimals) ) * mockToken1Data.pricePerUSDNew;

    expectations.totalFeesUSDWhitelisted = expectations.totalFeesUSD;

    beforeEach(() => {
      mockEventData = {
        amount0: expectations.amount0In,
        amount1: expectations.amount1In,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xblockhash",
          },
          chainId: 1,
          logIndex: 0,
          srcAddress: poolId,
        },
      };

      mockEvent = CLPool.CollectFees.createMockEvent(mockEventData);

    });

    describe("when event is processed", () => {
      let collectEntity: any;
      let diff: any;

      beforeEach(async () => {
        let updatedDB = mockDb.entities.Token.set(mockToken0Data as Token);
        updatedDB = updatedDB.entities.Token.set(mockToken1Data as Token);
        updatedDB =
          updatedDB.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData as LiquidityPoolAggregator);

        setupDB = await CLPool.CollectFees.processEvent({
          event: mockEvent,
          mockDb: updatedDB,
        });
        const expectedId = `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
        collectEntity = setupDB.entities.CLPool_CollectFees.get(expectedId);
        [diff] = updateLiquidityPoolAggregatorStub.firstCall.args;
      });

      it("should create a CLPool_CollectFees entity", async () => {
        expect(collectEntity).to.not.be.undefined;
        expect(collectEntity?.amount0).to.equal(expectations.amount0In);
        expect(collectEntity?.amount1).to.equal(expectations.amount1In);
      });

      it("should update LiquidityPoolAggregator", async () => {
        expect(updateLiquidityPoolAggregatorStub.calledOnce).to.be.true;
      });

      it("should update nominal fee amounts correctly", async () => {
        expect(diff.totalFees0).to.equal(
          mockLiquidityPoolData.totalFees0 + expectations.amount0In
        );
        expect(diff.totalFees1).to.equal(
          mockLiquidityPoolData.totalFees1 + expectations.amount1In
        );
      });

      it("should correctly update total fees in USD", async () => {
        expect(diff.totalFeesUSD).to.equal(expectations.totalFeesUSD,
          "It should correctly update total fees in USD");
      });
      it("should correctly update total fees in USD whitelisted", async () => {
        expect(diff.totalFeesUSDWhitelisted).to.equal(expectations.totalFeesUSDWhitelisted,
          "It should correctly update total fees in USD whitelisted");
      });
      describe("CLPool Aggregator", () => {
        let diff: any;
        beforeEach(() => {
          [diff] = updateLiquidityPoolAggregatorStub.firstCall.args;
        });

        it("should update the reserves", () => {
          expect(diff.reserve0).to.equal(
            mockLiquidityPoolData.reserve0 -
            expectations.amount0In,
            "Reserve 0 should be appropriately updated");
          expect(diff.reserve1).to.equal(
            mockLiquidityPoolData.reserve1 -
            expectations.amount1In,
          "Reserve 1 should be appropriately updated");
        });
        it("should update the total liquidity in USD correctly", () => {
          expect(diff.totalLiquidityUSD).to.equal(
            expectations.totalLiquidityUSD,
          "Liquidity should be updated with appropriate prices");
        });
      });
    });
  });

  describe("Swap Event", () => {
    let mockEvent: ReturnType<typeof CLPool.Swap.createMockEvent>;
    let swapEntity: any;
    let aggregatorCalls: any;

    const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } = setupCommon();
    const poolId = mockLiquidityPoolData.id; 

    let expectations: any = {
      amount0In: -10n * 10n ** 18n,
      amount1In: 10n * 10n ** 6n,
      totalLiquidityUSD: 0n,
    };

    // Note because the swap is negative for token 0, we add it to the reserve
    expectations.totalLiquidityUSD =
      (mockLiquidityPoolData.reserve0 + expectations.amount0In) * mockToken0Data.pricePerUSDNew / ( 10n ** (mockToken0Data.decimals) )  +
      (mockLiquidityPoolData.reserve1 + expectations.amount1In) * mockToken1Data.pricePerUSDNew / ( 10n ** (mockToken1Data.decimals) );

    beforeEach(async () => {

      mockEvent = CLPool.Swap.createMockEvent({
        sender: "0xsender",
        recipient: "0xrecipient",
        amount0: expectations.amount0In,
        amount1: expectations.amount1In,
        sqrtPriceX96: 1n << 96n,
        liquidity: 1000000n,
        tick: 111111n,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xblockhash",
          },
          chainId: 1,
          logIndex: 0,
          srcAddress: poolId,
        },
      });
    });

    describe("when tokens exist", () => {
      let updatedLiquidityPool: any;
      beforeEach(async () => {
        let updatedDB = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData as LiquidityPoolAggregator);
        updatedDB = updatedDB.entities.Token.set(mockToken0Data as Token);
        updatedDB = updatedDB.entities.Token.set(mockToken1Data as Token);

        const result = await CLPool.Swap.processEvent({
          event: mockEvent,
          mockDb: updatedDB,
        });
        swapEntity = result.entities.CLPool_Swap.get(`1_123456_0`);
        aggregatorCalls = updateLiquidityPoolAggregatorStub.firstCall.args;
        updatedLiquidityPool = aggregatorCalls[0];
      });

      it("should create a CLPool_Swap entity", async () => {
        expect(swapEntity).to.not.be.undefined;
        expect(swapEntity?.sender).to.equal("0xsender");
        expect(swapEntity?.recipient).to.equal("0xrecipient");
        expect(swapEntity?.amount0).to.equal(expectations.amount0In);
        expect(swapEntity?.amount1).to.equal(expectations.amount1In);
        expect(swapEntity?.sqrtPriceX96).to.equal(1n << 96n);
        expect(swapEntity?.liquidity).to.equal(mockEvent.params.liquidity);
        expect(swapEntity?.tick).to.equal(mockEvent.params.tick);
      });

      it("should update LiquidityPoolAggregator", async () => {
        expect(updateLiquidityPoolAggregatorStub.calledOnce).to.be.true;
      });

      it("should update nominal volume amounts correctly", async () => {
        expect(updatedLiquidityPool.totalVolume0).to.equal(
          mockLiquidityPoolData.totalVolume0 + abs(mockEvent.params.amount0)
        );
        expect(updatedLiquidityPool.totalVolume1).to.equal(
          mockLiquidityPoolData.totalVolume1 + abs(mockEvent.params.amount1)
        );
      });

      it("should update number of swaps correctly", async () => {
        expect(updatedLiquidityPool.numberOfSwaps).to.equal(2n);
      });

      it("should correctly update total volume in USD", async () => {
        expect(updatedLiquidityPool.totalVolumeUSD).to.equal(
          mockLiquidityPoolData.totalVolumeUSD +
            (abs(mockEvent.params.amount0) * mockToken0Data.pricePerUSDNew) /
              10n ** mockToken0Data.decimals
        );
      });

      it("should correctly update total volume in USD whitelisted", async () => {
        const [diff] = aggregatorCalls;
        expect(diff.totalVolumeUSDWhitelisted).to.equal(
          mockLiquidityPoolData.totalVolumeUSDWhitelisted +
            (abs(mockEvent.params.amount0) * mockToken0Data.pricePerUSDNew) /
              10n ** mockToken0Data.decimals
        );
      });

      it("should update token prices correctly", async () => {
        expect(updatedLiquidityPool.token0Price).to.equal(1n * 10n ** 18n);
        expect(updatedLiquidityPool.token1Price).to.equal(1n * 10n ** 18n);
      });

      it("should update reserve amounts correctly", async () => {
        expect(updatedLiquidityPool.reserve0).to.equal(mockLiquidityPoolData.reserve0 + expectations.amount0In);
        expect(updatedLiquidityPool.reserve1).to.equal(mockLiquidityPoolData.reserve1 + expectations.amount1In);
      });

      it("should update total liquidity in USD correctly", async () => {
        expect(updatedLiquidityPool.totalLiquidityUSD).to.equal(expectations.totalLiquidityUSD);
      });
      it("should call refreshTokenPrice on token0", () => {
        const calledToken = mockPriceOracle.firstCall.args[0];
        expect(calledToken.address).to.equal(mockToken0Data.address);
      });
      it("should call refreshTokenPrice on token1", () => {
        const calledToken = mockPriceOracle.secondCall.args[0];
        expect(calledToken.address).to.equal(mockToken1Data.address);
      });
      it("should update the liquidity pool with token0IsWhitelisted", () => {
        expect(updatedLiquidityPool.token0IsWhitelisted).to.equal(mockToken0Data.isWhitelisted);
      });
      it("should update the liquidity pool with token1IsWhitelisted", () => {
        expect(updatedLiquidityPool.token1IsWhitelisted).to.equal(mockToken1Data.isWhitelisted);
      });
    });

    describe("when tokens do not exist", () => {
      beforeEach(async () => {
        let updatedDB = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData);
        updatedDB = updatedDB.entities.Token.set(mockToken1Data);

        await CLPool.Swap.processEvent({
          event: mockEvent,
          mockDb: updatedDB,
        });
      });

      it("should handle missing token instances", async () => {
        expect(updateLiquidityPoolAggregatorStub.calledOnce).to.be.true;
        const [diff] = updateLiquidityPoolAggregatorStub.firstCall.args;

        expect(diff.totalVolume0).to.equal(
          mockLiquidityPoolData.totalVolume0 + abs(mockEvent.params.amount0)
        );
        expect(diff.totalVolume1).to.equal(
          mockLiquidityPoolData.totalVolume1 + abs(mockEvent.params.amount1)
        );
        expect(diff.totalVolumeUSD).to.equal(
          mockLiquidityPoolData.totalVolumeUSD +
            (abs(mockEvent.params.amount1) * mockToken1Data.pricePerUSDNew) /
              10n ** mockToken1Data.decimals
        );
      });
    });
  });
});
