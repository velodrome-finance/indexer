import { expect } from "chai";
import { MockDb, VotingReward } from "../../generated/src/TestHelpers.gen";
import { CHAIN_CONSTANTS, TokenIdByChain } from "../../src/Constants";
import { Token, LiquidityPoolAggregator } from "../../generated/src/Types.gen";
import * as Store from "../../src/Store";
import sinon from "sinon";
import { setupCommon } from "./Pool/common";

describe("VotingReward Events", () => {
  describe("NotifyReward Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof VotingReward.NotifyReward.createMockEvent>;

    /**
     * Constants for the NotifyReward event test.
     * 
     * @constant {number} chainId - The chain ID for Optimism.
     * @constant {string} poolAddress - The address of the liquidity pool.
     * @constant {string} bribeVotingRewardAddress - The address of the bribe voting reward contract.
     * @constant {string} rewardTokenAddress - The address of the reward token being distributed.
     */
    const chainId = 10; // Optimism
    
    const poolAddress = "0x904f14F9ED81d0b0a40D8169B28592aac5687158";
    const bribeVotingRewardAddress = "0x9afdc6c6caad5ff953e2cff9777c3af2e5d796fb";
    const rewardTokenAddress = "0x4200000000000000000000000000000000000042";
    const blockNumber = 128404994;
    let mockContract: sinon.SinonStub;

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      
      // Setup the mock event
      mockEvent = VotingReward.NotifyReward.createMockEvent({
        from: "0x1234567890123456789012345678901234567890",
        reward: rewardTokenAddress,
        epoch: 1n,
        amount: 1000n * 10n ** 18n, // 1000 tokens with 18 decimals
        mockEventData: {
          block: {
            number: blockNumber,
            timestamp: 1000000,
            hash: "0xblockhash",
          },
          chainId: chainId,
          logIndex: 0,
          srcAddress: bribeVotingRewardAddress,
        },
      });

      // Stub the pool lookup function
      sinon.stub(Store.poolLookupStoreManager(), "getPoolAddressByBribeVotingRewardAddress")
        .returns(poolAddress);
    });

    afterEach(() => {
      sinon.restore();
      mockContract.reset();
    });

    describe("when reward token does not exist", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;

      beforeEach(async () => {

        mockContract = sinon.stub(CHAIN_CONSTANTS[chainId].eth_client, "simulateContract")
          .returns({
            result: [1000n, 1000n]
          } as any);
        // Setup mock liquidity pool
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPoolData.id = poolAddress;

        const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData as LiquidityPoolAggregator);

        // Process the event
        resultDB = await VotingReward.NotifyReward.processEvent({
          event: mockEvent,
          mockDb: updatedDB1,
        });

      });

      afterEach(() => {
        mockContract.reset();
      });
      
      it("should create a VotingReward_NotifyReward entity", () => {
        const notifyRewardEvent = resultDB.entities.VotingReward_NotifyReward.get(
          `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`
        );
        expect(notifyRewardEvent).to.not.be.undefined;
        expect(notifyRewardEvent?.from).to.equal(mockEvent.params.from);
        expect(notifyRewardEvent?.reward).to.equal(rewardTokenAddress);
        expect(notifyRewardEvent?.amount).to.equal(mockEvent.params.amount);
        expect(notifyRewardEvent?.epoch).to.equal(mockEvent.params.epoch);
      });

      it("should update the liquidity pool aggregator with bribes data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.totalBribesUSD).to.not.be.undefined;
        expect(updatedPool?.totalBribesUSD).to.not.equal(0n);
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(new Date(1000000 * 1000));
      });

    });

    describe("when reward token and liquidity pool exist", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;

      let expectedBribesUSD = 0n;
      
      beforeEach(async () => {
        mockContract = sinon.stub(CHAIN_CONSTANTS[chainId].eth_client, "simulateContract")
          .returns({
            result: [1000n, 1000n]
          } as any);

        const { mockLiquidityPoolData } = setupCommon();
        mockLiquidityPoolData.id = poolAddress;

        // Setup mock reward token
        const rewardToken: Token = {
          id: TokenIdByChain(rewardTokenAddress, chainId),
          address: rewardTokenAddress,
          symbol: "TEST",
          name: "Test Token",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n, // $2 per token
          isWhitelisted: true,
        } as Token;

        expectedBribesUSD = mockLiquidityPoolData.totalBribesUSD +
          (mockEvent.params.amount * rewardToken.pricePerUSDNew / (10n ** (rewardToken.decimals)));

        // Set entities in the mock database
        resultDB = mockDb.entities.Token.set(rewardToken);
        resultDB = resultDB.entities.LiquidityPoolAggregator.set(mockLiquidityPoolData as LiquidityPoolAggregator);

        // Process the event
        resultDB = await VotingReward.NotifyReward.processEvent({
          event: mockEvent,
          mockDb: resultDB,
        });
      });

      afterEach(() => {
        mockContract.reset();
      });

      it("should create a VotingReward_NotifyReward entity", () => {
        const notifyRewardEvent = resultDB.entities.VotingReward_NotifyReward.get(
          `${mockEvent.chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`
        );
        expect(notifyRewardEvent).to.not.be.undefined;
        expect(notifyRewardEvent?.from).to.equal(mockEvent.params.from);
        expect(notifyRewardEvent?.reward).to.equal(rewardTokenAddress);
        expect(notifyRewardEvent?.amount).to.equal(mockEvent.params.amount);
        expect(notifyRewardEvent?.epoch).to.equal(mockEvent.params.epoch);
      });

      it("should update the liquidity pool aggregator with bribes data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.totalBribesUSD).to.equal(
          expectedBribesUSD, 
          "Should add the correct amount of bribes to the liquidity pool");
        expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(new Date(1000000 * 1000));
      });
    });
  });
}); 