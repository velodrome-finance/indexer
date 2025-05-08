import { expect } from "chai";
import sinon from "sinon";
import {
  LiquidityPoolAggregator,
} from "../../generated/src/Types.gen";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import {
  getCurrentAccumulatedFeeCL,
  setLiquidityPoolAggregatorSnapshot,
  updateDynamicFeePools,
  updateLiquidityPoolAggregator,
} from "../../src/Aggregators/LiquidityPoolAggregator";

describe("LiquidityPoolAggregator Functions", () => {
  let contextStub: any;
  let liquidityPoolAggregator: any;
  let timestamp: Date;
  let mockContract: any;
  const blockNumber = 131536921;

  beforeEach(() => {
    contextStub = {
      LiquidityPoolAggregatorSnapshot: { set: sinon.stub() },
      LiquidityPoolAggregator: { set: sinon.stub() },
      Dynamic_Fee_Swap_Module: { set: sinon.stub() },
    };
    liquidityPoolAggregator = {
      id: "0x123",
      chainId: 10,
    };
    timestamp = new Date();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("updateDynamicFeePools", () => {
    beforeEach(async () => {
      mockContract = sinon.stub(CHAIN_CONSTANTS[10].eth_client, "simulateContract").onCall(0)
        .returns({
          result: [400, 2000, 10000000n]
        } as any);
      mockContract.onCall(1).returns({
        result: 1900
      } as any);
      liquidityPoolAggregator.id = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
      await updateDynamicFeePools(liquidityPoolAggregator as LiquidityPoolAggregator, contextStub, blockNumber);
    });
    afterEach(() => {
      mockContract.reset();
      contextStub.Dynamic_Fee_Swap_Module.set.reset();
    });
    it("should update the dynamic fee pools", async () => {
      const expected_id = `${liquidityPoolAggregator.chainId}-${liquidityPoolAggregator.id}-${blockNumber}` 
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].baseFee).to.equal(400);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].feeCap).to.equal(2000);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].scalingFactor).to.equal(10000000n);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].currentFee).to.equal(1900);
      expect(contextStub.Dynamic_Fee_Swap_Module.set.args[0][0].id).to.equal(expected_id);
    });
  });

  describe("getCurrentAccumulatedFeeCL", () => {
    let gaugeFees: any;
    beforeEach(async () => {
      liquidityPoolAggregator.id = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
      mockContract = sinon.stub(CHAIN_CONSTANTS[10].eth_client, "simulateContract").onCall(0)
        .returns({
          result: [55255516292n, 18613785323003103999n]
        } as any);
      gaugeFees = await getCurrentAccumulatedFeeCL(liquidityPoolAggregator.id, liquidityPoolAggregator.chainId, blockNumber);
    });
    afterEach(() => {
      mockContract.reset();
    });
    it("should fetch accumulated gauge fees for the CL pool", async () => {
      expect(gaugeFees.token0Fees).to.equal(55255516292n);
      expect(gaugeFees.token1Fees).to.equal(18613785323003103999n);
    });
  });

  describe("Snapshot Creation", () => {

    beforeEach(() => {
      setLiquidityPoolAggregatorSnapshot(
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub
      );
    })

    it("should create a snapshot of the liquidity pool aggregator", () => {

      expect(contextStub.LiquidityPoolAggregatorSnapshot.set.calledOnce).to.be
        .true;
      const snapshot =
        contextStub.LiquidityPoolAggregatorSnapshot.set.getCall(0).args[0];
      expect(snapshot.id).to.equal(
        `${liquidityPoolAggregator.chainId}-${
          liquidityPoolAggregator.id
        }_${timestamp.getTime()}`
      );
      expect(snapshot.pool).to.equal(liquidityPoolAggregator.id);
    });

  });

  describe("Updating the Liquidity Pool Aggregator", () => {

    let diff: any;
    beforeEach(() => {
      diff = {
        totalVolume0: 5000n,
        totalVolume1: 6000n,
        totalVolumeUSD: 7000n,
        numberOfSwaps: 11n,
        totalVolumeUSDWhitelisted: 8000n,
        totalFeesUSDWhitelisted: 9000n,
      };
      updateLiquidityPoolAggregator(
        diff,
        liquidityPoolAggregator as LiquidityPoolAggregator,
        timestamp,
        contextStub,
        blockNumber
      );
    })

    it("should update the liquidity pool aggregator", () => {

      const updatedAggregator =
        contextStub.LiquidityPoolAggregator.set.getCall(0).args[0];
      expect(updatedAggregator.totalVolume0).to.equal(diff.totalVolume0);
      expect(updatedAggregator.totalVolume1).to.equal(diff.totalVolume1);
      expect(updatedAggregator.numberOfSwaps).to.equal(diff.numberOfSwaps);
      expect(updatedAggregator.totalVolumeUSDWhitelisted).to.equal(diff.totalVolumeUSDWhitelisted);
      expect(updatedAggregator.totalFeesUSDWhitelisted).to.equal(diff.totalFeesUSDWhitelisted);
    });

    it("should create a snapshot if the last update was more than 1 hour ago", () => {
      const snapshot =
        contextStub.LiquidityPoolAggregatorSnapshot.set.getCall(0).args[0];
      expect(snapshot).to.not.be.undefined;
    });

  });

});
