import { expect } from "chai";
import { MockDb, SuperchainLeafVoter } from "../../generated/src/TestHelpers.gen";
import { TokenIdByChain, CHAIN_CONSTANTS } from "../../src/Constants";
import { Token, LiquidityPoolAggregator } from "../../generated/src/Types.gen";
import * as Store from "../../src/Store";
import * as Common from "../../src/EventHandlers/Voter/common";
import { setupCommon } from "./Pool/common";
import sinon from "sinon";

describe("SuperchainLeafVoter Events", () => {
  describe("Voted Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    
    beforeEach( async () => {
      mockDb = MockDb.createMockDb();
      const mockEvent = SuperchainLeafVoter.Voted.createMockEvent({
        sender: "0x1111111111111111111111111111111111111111",
        pool: "0x2222222222222222222222222222222222222222",
        tokenId: 1n,
        weight: 100n,
        totalWeight: 1000n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: 10,
          logIndex: 1,
        },
      });
      mockDb = await SuperchainLeafVoter.Voted.processEvent({ event: mockEvent, mockDb });
    });

    it("should create a Voter_Voted entity", async () => {
      const votedEntity = mockDb.entities.Voter_Voted.get("10_123456_1");
      expect(votedEntity).to.not.be.undefined;
      expect(votedEntity?.sender).to.equal("0x1111111111111111111111111111111111111111");
      expect(votedEntity?.pool).to.equal("0x2222222222222222222222222222222222222222");
      expect(votedEntity?.weight).to.equal(100n);
      expect(votedEntity?.totalWeight).to.equal(1000n);
    });
  });

  describe("GaugeCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    const poolLookupStub = sinon.stub(Store.poolLookupStoreManager(), "addRewardAddressDetails");
    
    beforeEach(async () => {
      mockDb = MockDb.createMockDb();
      const mockEvent = SuperchainLeafVoter.GaugeCreated.createMockEvent({
        poolFactory: "0x1111111111111111111111111111111111111111",
        votingRewardsFactory: "0x2222222222222222222222222222222222222222",
        gaugeFactory: "0x3333333333333333333333333333333333333333",
        pool: "0x4444444444444444444444444444444444444444",
        incentiveVotingReward: "0x5555555555555555555555555555555555555555",
        feeVotingReward: "0x6666666666666666666666666666666666666666",
        gauge: "0x7777777777777777777777777777777777777777",
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0xhash",
          },
          chainId: 10,
          logIndex: 1,
        },
      });
      
      mockDb = await SuperchainLeafVoter.GaugeCreated.processEvent({ event: mockEvent, mockDb });

    });

    xit("should create a Voter_GaugeCreated entity and update pool mappings", async () => {
      
      const gaugeCreatedEntity = mockDb.entities.Voter_GaugeCreated.get("10_123456_1");
      expect(gaugeCreatedEntity).to.not.be.undefined;
      expect(gaugeCreatedEntity?.pool).to.equal("0x4444444444444444444444444444444444444444");
      expect(gaugeCreatedEntity?.gauge).to.equal("0x7777777777777777777777777777777777777777");
      
      expect(poolLookupStub.calledOnce).to.be.true;
      sinon.restore();
    });
  });

  describe("DistributeReward Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof SuperchainLeafVoter.DistributeReward.createMockEvent>;
    const chainId = 10; // Optimism
    const voterAddress = "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C";
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";
    const blockNumber = 128357873;
    
    beforeEach(async () => {
      mockDb = MockDb.createMockDb();
      
      mockEvent = SuperchainLeafVoter.DistributeReward.createMockEvent({
        gauge: gaugeAddress,
        amount: 1000n * 10n ** 18n,
        mockEventData: {
          block: {
            number: blockNumber,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId,
          logIndex: 1,
          srcAddress: voterAddress,
        },
      });

      // Stub common functions
    });


    describe("when reward token and liquidity pool exist", () => {
      const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } = setupCommon();
      let expectations: any = {};
      
      beforeEach(async () => {
        const rewardTokenInfo = CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

        const liquidityPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: poolAddress,
          chainId: chainId,
        } as LiquidityPoolAggregator;
        
        // Setup mock reward token
        const rewardToken: Token = {
          id: TokenIdByChain(rewardTokenInfo, chainId),
          address: rewardTokenInfo,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
        } as Token;

        expectations = {
          totalEmissions: liquidityPool.totalEmissions + mockEvent.params.amount,
          totalEmissionsUSD: liquidityPool.totalEmissionsUSD + 
            mockEvent.params.amount * rewardToken.pricePerUSDNew / 10n ** rewardToken.decimals,
          getTokensDeposited: 500n * 10n ** 18n,
          getTokensDepositedUSD: 500n * 10n ** 18n * rewardToken.pricePerUSDNew / 10n ** rewardToken.decimals,
        };

        sinon.stub(Common, "getIsAlive").resolves(true);
        sinon.stub(Common, "getTokensDeposited").resolves(expectations.getTokensDeposited);
        sinon.stub(Store.poolLookupStoreManager(), "getPoolAddressByGaugeAddress")
            .returns(poolAddress);

        mockDb = mockDb.entities.Token.set(rewardToken);
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(liquidityPool);

        mockDb = await SuperchainLeafVoter.DistributeReward.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      afterEach(() => {
        sinon.restore();
      });

      it("should create a DistributeReward entity", () => {
        const distributeRewardEntity = mockDb.entities.Voter_DistributeReward.get(`${chainId}_${blockNumber}_1`);
        expect(distributeRewardEntity).to.not.be.undefined;
        expect(distributeRewardEntity?.amount).to.equal(mockEvent.params.amount);
        expect(distributeRewardEntity?.tokensDeposited).to.equal(expectations.getTokensDeposited);
      });

      it("should update the liquidity pool aggregator with emissions and votes data", () => {
        const updatedPool = mockDb.entities.LiquidityPoolAggregator.get(poolAddress);
        expect(updatedPool).to.not.be.undefined;
        expect(updatedPool?.totalEmissions).to.equal(expectations.totalEmissions);
        expect(updatedPool?.totalEmissionsUSD).to.equal(expectations.totalEmissionsUSD);
        expect(updatedPool?.totalVotesDeposited).to.equal(expectations.getTokensDeposited);
        expect(updatedPool?.totalVotesDepositedUSD).to.equal(expectations.getTokensDepositedUSD);
        expect(updatedPool?.gaugeIsAlive).to.be.true;
      });
    });
  });

}); 