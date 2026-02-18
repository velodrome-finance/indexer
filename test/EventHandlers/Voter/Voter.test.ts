import { MockDb, Voter } from "generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  UserStatsPerPool,
  VeNFTPoolVote,
  VeNFTState,
} from "generated/src/Types.gen";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  CHAIN_CONSTANTS,
  PoolId,
  TokenIdByChain,
  VeNFTId,
  VeNFTPoolVoteId,
  toChecksumAddress,
} from "../../../src/Constants";
import { getIsAlive, getTokensDeposited } from "../../../src/Effects/Voter";
import { setupCommon } from "../Pool/common";

// Type interface for Effect with handler property (for testing purposes)
interface EffectWithHandler<I, O> {
  name: string;
  handler: (args: { input: I; context: unknown }) => Promise<O>;
}

describe("Voter Events", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Voted Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.Voted.createMockEvent>;
    const chainId = 10; // Optimism
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const voterAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const tokenId = 1n;
    const ownerAddress = toChecksumAddress(
      "0x2222222222222222222222222222222222222222",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.Voted.createMockEvent({
        voter: voterAddress,
        pool: poolAddress,
        tokenId: tokenId,
        weight: 100n,
        totalWeight: 1000n,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool data exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      let mockUserStats: UserStatsPerPool;
      let mockVeNFTState: VeNFTState;

      beforeEach(async () => {
        const {
          mockLiquidityPoolData,
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockVeNFTState,
        } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          veNFTamountStaked: 0n,
        } as LiquidityPoolAggregator;

        mockUserStats = createMockUserStatsPerPool({
          userAddress: ownerAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          veNFTamountStaked: 0n,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId),
          chainId,
          tokenId,
          owner: ownerAddress,
        });

        // Setup mock database with required entities
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);
        mockDb = mockDb.entities.UserStatsPerPool.set(mockUserStats);
        mockDb = mockDb.entities.Token.set(mockToken0Data);
        mockDb = mockDb.entities.Token.set(mockToken1Data);
        mockDb = mockDb.entities.VeNFTState.set(mockVeNFTState);

        resultDB = await Voter.Voted.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update liquidity pool aggregator with voting data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.veNFTamountStaked).toBe(1000n);
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should update user stats per pool with voting data", () => {
        const userStatsId = `${ownerAddress}_${poolAddress}_${chainId}`;
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).toBeDefined();
        expect(updatedUserStats?.veNFTamountStaked).toBe(100n);
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should attribute votes to tokenId owner, not voter", () => {
        const voterStatsId = `${voterAddress}_${poolAddress}_${chainId}`;
        const voterStats = resultDB.entities.UserStatsPerPool.get(voterStatsId);
        expect(voterStats).toBeUndefined();
      });

      it("should create VeNFTPoolVote entity", () => {
        const veNFTPoolVoteId = VeNFTPoolVoteId(chainId, tokenId, poolAddress);
        const veNFTPoolVote =
          resultDB.entities.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.poolAddress).toBe(poolAddress);
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(100n);
        expect(veNFTPoolVote?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        const resultDB = await Voter.Voted.processEvent({
          event: mockEvent,
          mockDb,
        });

        // Should not create LiquidityPoolAggregator entity
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
        expect(
          Array.from(resultDB.entities.UserStatsPerPool.getAll()),
        ).toHaveLength(0);
        expect(
          Array.from(resultDB.entities.VeNFTPoolVote.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("when pool is a RootCLPool", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      // Real data from actual event
      // Event available here: https://optimistic.etherscan.io/tx/0x133260f0f7bf0a06d262f09b064a35d3c63178c6b5fd8e4798ba780f357dc7bd#eventlog#94
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );
      const leafPoolAddress = toChecksumAddress(
        "0x3BBdBAD64b383885031c4d9C8Afe0C3327d79888",
      );
      const realVoterAddress = toChecksumAddress(
        "0x0B7a0dE062EC95f815E9Aaa31C0AcBAdC7717171",
      );
      const realTokenId = 961n;
      const realWeight = 6887909874294904273927n;
      const realTotalWeight = 8343366589203809137097720n;
      const realTimestamp = 1734595305;
      const rootChainId = 10; // Optimism
      const leafChainId = 252; // Fraxtal
      let mockLeafPool: LiquidityPoolAggregator;
      let mockUserStats: UserStatsPerPool;
      let mockVeNFTState: VeNFTState;

      beforeEach(async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockLiquidityPoolAggregator,
          createMockVeNFTState,
        } = setupCommon();

        // Create tokens for the leaf chain (chain 252)
        const leafToken0Data: Token = {
          ...mockToken0Data,
          id: TokenIdByChain(mockToken0Data.address, leafChainId),
          chainId: leafChainId,
        };
        const leafToken1Data: Token = {
          ...mockToken1Data,
          id: TokenIdByChain(mockToken1Data.address, leafChainId),
          chainId: leafChainId,
        };

        // Create leaf pool using helper function
        mockLeafPool = createMockLiquidityPoolAggregator({
          id: PoolId(leafChainId, leafPoolAddress),
          chainId: leafChainId,
          token0_id: leafToken0Data.id,
          token1_id: leafToken1Data.id,
          veNFTamountStaked: 0n,
        });

        // Create user stats using helper function
        mockUserStats = createMockUserStatsPerPool({
          userAddress: realVoterAddress,
          poolAddress: rootPoolAddress,
          chainId: rootChainId,
          veNFTamountStaked: 0n,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, realTokenId),
          chainId: rootChainId,
          tokenId: realTokenId,
          owner: realVoterAddress,
        });

        // Create RootPool_LeafPool mapping
        const rootPoolLeafPool = {
          id: `${rootPoolAddress}_${rootChainId}_${leafPoolAddress}_${leafChainId}`,
          rootChainId: rootChainId,
          rootPoolAddress: rootPoolAddress,
          leafChainId: leafChainId,
          leafPoolAddress: leafPoolAddress,
        };

        // Setup mock database with leaf pool and RootPool_LeafPool mapping
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLeafPool);
        mockDb = mockDb.entities.RootPool_LeafPool.set(rootPoolLeafPool);
        mockDb = mockDb.entities.UserStatsPerPool.set(mockUserStats);
        mockDb = mockDb.entities.Token.set(leafToken0Data);
        mockDb = mockDb.entities.Token.set(leafToken1Data);
        mockDb = mockDb.entities.VeNFTState.set(mockVeNFTState);

        // Update event to use real data
        mockEvent = Voter.Voted.createMockEvent({
          voter: realVoterAddress,
          pool: rootPoolAddress,
          tokenId: realTokenId,
          weight: realWeight,
          totalWeight: realTotalWeight,
          mockEventData: {
            block: {
              number: 123456,
              timestamp: realTimestamp,
              hash: "0xhash",
            },
            chainId: rootChainId,
            logIndex: 1,
          },
        });

        resultDB = await Voter.Voted.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update leaf pool aggregator with voting data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(leafChainId, leafPoolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.veNFTamountStaked).toBe(realTotalWeight);
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("should update user stats per pool with voting data", () => {
        const userStatsId = `${realVoterAddress}_${rootPoolAddress}_${rootChainId}`;
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).toBeDefined();
        expect(updatedUserStats?.veNFTamountStaked).toBe(realWeight);
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });
    });

    describe("when multiple tokenIds share the same owner", () => {
      it("should aggregate votes at the user level", async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockLiquidityPoolAggregator,
          createMockVeNFTState,
        } = setupCommon();

        const owner = toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        );

        const liquidityPool = createMockLiquidityPoolAggregator({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          veNFTamountStaked: 0n,
        });

        const userStats = createMockUserStatsPerPool({
          userAddress: owner,
          poolAddress: poolAddress,
          chainId: chainId,
          veNFTamountStaked: 0n,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        const veNFT1 = createMockVeNFTState({
          id: VeNFTId(chainId, 1n),
          chainId,
          tokenId: 1n,
          owner,
        });

        const veNFT2 = createMockVeNFTState({
          id: VeNFTId(chainId, 2n),
          chainId,
          tokenId: 2n,
          owner,
        });

        let db = MockDb.createMockDb();
        db = db.entities.LiquidityPoolAggregator.set(liquidityPool);
        db = db.entities.UserStatsPerPool.set(userStats);
        db = db.entities.Token.set(mockToken0Data);
        db = db.entities.Token.set(mockToken1Data);
        db = db.entities.VeNFTState.set(veNFT1);
        db = db.entities.VeNFTState.set(veNFT2);

        const voteEvent1 = Voter.Voted.createMockEvent({
          voter: voterAddress,
          pool: poolAddress,
          tokenId: 1n,
          weight: 100n,
          totalWeight: 1000n,
          mockEventData: {
            block: {
              number: 123456,
              timestamp: 1000000,
              hash: "0xhash",
            },
            chainId: chainId,
            logIndex: 1,
          },
        });

        const voteEvent2 = Voter.Voted.createMockEvent({
          voter: voterAddress,
          pool: poolAddress,
          tokenId: 2n,
          weight: 200n,
          totalWeight: 1100n,
          mockEventData: {
            block: {
              number: 123457,
              timestamp: 1000001,
              hash: "0xhash2",
            },
            chainId: chainId,
            logIndex: 2,
          },
        });

        const dbAfterFirst = await Voter.Voted.processEvent({
          event: voteEvent1,
          mockDb: db,
        });

        const dbAfterSecond = await Voter.Voted.processEvent({
          event: voteEvent2,
          mockDb: dbAfterFirst,
        });

        const updatedUserStats = dbAfterSecond.entities.UserStatsPerPool.get(
          `${owner}_${poolAddress}_${chainId}`,
        );
        expect(updatedUserStats).toBeDefined();
        expect(updatedUserStats?.veNFTamountStaked).toBe(300n);
      });
    });
  });

  describe("Abstained Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.Abstained.createMockEvent>;
    const chainId = 10; // Optimism
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const voterAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const tokenId = 1n;
    const ownerAddress = toChecksumAddress(
      "0x2222222222222222222222222222222222222222",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.Abstained.createMockEvent({
        voter: voterAddress,
        pool: poolAddress,
        tokenId: tokenId,
        weight: 100n,
        totalWeight: 1000n,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool data exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      let mockUserStats: UserStatsPerPool;
      let mockVeNFTState: VeNFTState;
      let mockVeNFTPoolVote: VeNFTPoolVote;

      beforeEach(async () => {
        const {
          mockLiquidityPoolData,
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockVeNFTState,
          createMockVeNFTPoolVote,
        } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          veNFTamountStaked: 2000n, // Initial staked amount
        } as LiquidityPoolAggregator;

        mockUserStats = createMockUserStatsPerPool({
          userAddress: ownerAddress,
          poolAddress: poolAddress,
          chainId: chainId,
          veNFTamountStaked: 200n, // Initial user staked amount
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId),
          chainId,
          tokenId,
          owner: ownerAddress,
        });

        mockVeNFTPoolVote = createMockVeNFTPoolVote({
          id: VeNFTPoolVoteId(chainId, tokenId, poolAddress),
          poolAddress,
          veNFTamountStaked: 200n,
          veNFTState_id: mockVeNFTState.id,
          lastUpdatedTimestamp: new Date(0),
        });

        // Setup mock database with required entities
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);
        mockDb = mockDb.entities.UserStatsPerPool.set(mockUserStats);
        mockDb = mockDb.entities.Token.set(mockToken0Data);
        mockDb = mockDb.entities.Token.set(mockToken1Data);
        mockDb = mockDb.entities.VeNFTState.set(mockVeNFTState);
        mockDb = mockDb.entities.VeNFTPoolVote.set(mockVeNFTPoolVote);

        resultDB = await Voter.Abstained.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update liquidity pool aggregator with total weight (absolute value)", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        // totalWeight is the absolute total veNFT staked in pool, replacing previous value
        expect(updatedPool?.veNFTamountStaked).toBe(1000n); // event.params.totalWeight
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should decrease user stats veNFT amount staked (negative weight)", () => {
        const userStatsId = `${ownerAddress}_${poolAddress}_${chainId}`;
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).toBeDefined();
        // weight is subtracted (negative because it's a withdrawal)
        expect(updatedUserStats?.veNFTamountStaked).toBe(100n); // 200n - 100n
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should decrement tokenId pool votes", () => {
        const veNFTPoolVoteId = VeNFTPoolVoteId(chainId, tokenId, poolAddress);
        const veNFTPoolVote =
          resultDB.entities.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(100n); // 200n - 100n
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        const resultDB = await Voter.Abstained.processEvent({
          event: mockEvent,
          mockDb,
        });

        // Should not create LiquidityPoolAggregator entity
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
        expect(
          Array.from(resultDB.entities.UserStatsPerPool.getAll()),
        ).toHaveLength(0);
        expect(
          Array.from(resultDB.entities.VeNFTPoolVote.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("when pool is a RootCLPool", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      // Real data from actual Abstained event
      // Event available here: https://optimistic.etherscan.io/tx/0x133260f0f7bf0a06d262f09b064a35d3c63178c6b5fd8e4798ba780f357dc7bd#eventlog#61
      const rootPoolAddress = "0x4f2eD04AA2E052090144B0a6f72fbf5b340ED20c";
      const leafPoolAddress = "0xd335C616C8aa60CaB2345052f9D7D62Eb722f320";
      const realVoterAddress = "0x0B7a0dE062EC95f815E9Aaa31C0AcBAdC7717171";
      const realTokenId = 961n;
      const realWeight = 22328957523870653419264n;
      const realTotalWeight = 2586327170227043887618593n;
      const realTimestamp = 1734595305;
      const rootChainId = 10; // Optimism
      const leafChainId = 252; // Fraxtal
      const initialUserStaked = 50000000000000000000000n; // 50k tokens (18 decimals) - initial amount before withdrawal
      let mockLeafPool: LiquidityPoolAggregator;
      let mockUserStats: UserStatsPerPool;
      let mockVeNFTState: VeNFTState;
      let mockVeNFTPoolVote: VeNFTPoolVote;

      beforeEach(async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockLiquidityPoolAggregator,
          createMockVeNFTState,
          createMockVeNFTPoolVote,
        } = setupCommon();

        // Create tokens for the leaf chain (chain 252)
        const leafToken0Data: Token = {
          ...mockToken0Data,
          id: TokenIdByChain(mockToken0Data.address, leafChainId),
          chainId: leafChainId,
        };
        const leafToken1Data: Token = {
          ...mockToken1Data,
          id: TokenIdByChain(mockToken1Data.address, leafChainId),
          chainId: leafChainId,
        };

        // Create leaf pool using helper function with initial staked amount
        mockLeafPool = createMockLiquidityPoolAggregator({
          id: PoolId(leafChainId, leafPoolAddress),
          chainId: leafChainId,
          token0_id: leafToken0Data.id,
          token1_id: leafToken1Data.id,
          veNFTamountStaked: 3000000000000000000000000n, // Initial staked amount (3M tokens)
        });

        // Create user stats using helper function with initial staked amount
        mockUserStats = createMockUserStatsPerPool({
          userAddress: realVoterAddress,
          poolAddress: rootPoolAddress,
          chainId: rootChainId,
          veNFTamountStaked: initialUserStaked,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });

        mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, realTokenId),
          chainId: rootChainId,
          tokenId: realTokenId,
          owner: realVoterAddress,
        });

        mockVeNFTPoolVote = createMockVeNFTPoolVote({
          id: VeNFTPoolVoteId(rootChainId, realTokenId, rootPoolAddress),
          poolAddress: rootPoolAddress,
          veNFTamountStaked: realWeight,
          veNFTState_id: mockVeNFTState.id,
          lastUpdatedTimestamp: new Date(0),
        });

        // Create RootPool_LeafPool mapping
        const rootPoolLeafPool = {
          id: `${rootPoolAddress}_${rootChainId}_${leafPoolAddress}_${leafChainId}`,
          rootChainId: rootChainId,
          rootPoolAddress: rootPoolAddress,
          leafChainId: leafChainId,
          leafPoolAddress: leafPoolAddress,
        };

        // Setup mock database with leaf pool and RootPool_LeafPool mapping
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLeafPool);
        mockDb = mockDb.entities.RootPool_LeafPool.set(rootPoolLeafPool);
        mockDb = mockDb.entities.UserStatsPerPool.set(mockUserStats);
        mockDb = mockDb.entities.Token.set(leafToken0Data);
        mockDb = mockDb.entities.Token.set(leafToken1Data);
        mockDb = mockDb.entities.VeNFTState.set(mockVeNFTState);
        mockDb = mockDb.entities.VeNFTPoolVote.set(mockVeNFTPoolVote);

        // Update event to use real data
        mockEvent = Voter.Abstained.createMockEvent({
          voter: realVoterAddress,
          pool: rootPoolAddress,
          tokenId: realTokenId,
          weight: realWeight,
          totalWeight: realTotalWeight,
          mockEventData: {
            block: {
              number: 123456,
              timestamp: realTimestamp,
              hash: "0xhash",
            },
            chainId: rootChainId,
            logIndex: 1,
          },
        });

        resultDB = await Voter.Abstained.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update leaf pool aggregator with total weight (absolute value)", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(leafChainId, leafPoolAddress),
        );

        expect(updatedPool).toBeDefined();
        // totalWeight is the absolute total veNFT staked in pool, replacing previous value
        expect(updatedPool?.veNFTamountStaked).toBe(realTotalWeight);
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("should decrease user stats veNFT amount staked (negative weight)", () => {
        const userStatsId = `${realVoterAddress}_${rootPoolAddress}_${rootChainId}`;
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).toBeDefined();
        // weight is subtracted (negative because it's a withdrawal)
        const expectedStaked = initialUserStaked - realWeight;
        expect(updatedUserStats?.veNFTamountStaked).toBe(expectedStaked);
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("should zero out veNFT pool votes", () => {
        const veNFTPoolVoteId = VeNFTPoolVoteId(
          rootChainId,
          realTokenId,
          rootPoolAddress,
        );
        const veNFTPoolVote =
          resultDB.entities.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(0n);
      });
    });
  });

  describe("GaugeCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeCreated.createMockEvent>;
    const chainId = 10;
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeCreated.createMockEvent({
        poolFactory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", // VAMM factory
        votingRewardsFactory: "0x2222222222222222222222222222222222222222",
        gaugeFactory: "0x3333333333333333333333333333333333333333",
        pool: poolAddress,
        bribeVotingReward: "0x5555555555555555555555555555555555555555",
        feeVotingReward: "0x6666666666666666666666666666666666666666",
        gauge: gaugeAddress,
        creator: "0x7777777777777777777777777777777777777777",
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool entity exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        } as LiquidityPoolAggregator;

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await Voter.GaugeCreated.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should update pool entity with gauge address and voting reward addresses", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          "0x6666666666666666666666666666666666666666",
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          "0x5555555555555555555555555555555555555555",
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        const resultDB = await Voter.GaugeCreated.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("when pool factory is CL factory", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      let clFactoryEvent: ReturnType<typeof Voter.GaugeCreated.createMockEvent>;

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        } as LiquidityPoolAggregator;

        // Create event with CL factory address (from CLPOOLS_FACTORY_LIST)
        clFactoryEvent = Voter.GaugeCreated.createMockEvent({
          poolFactory: "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F", // CL factory (optimism)
          votingRewardsFactory: "0x2222222222222222222222222222222222222222",
          gaugeFactory: "0x3333333333333333333333333333333333333333",
          pool: poolAddress,
          bribeVotingReward: "0x5555555555555555555555555555555555555555",
          feeVotingReward: "0x6666666666666666666666666666666666666666",
          gauge: gaugeAddress,
          creator: "0x7777777777777777777777777777777777777777",
          mockEventData: {
            block: {
              number: 123456,
              timestamp: 1000000,
              hash: "0xhash",
            },
            chainId: chainId,
            logIndex: 1,
          },
        });

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await Voter.GaugeCreated.processEvent({
          event: clFactoryEvent,
          mockDb,
        });
      });

      it("should update pool entity with gauge address (CL factory path)", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          "0x6666666666666666666666666666666666666666",
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          "0x5555555555555555555555555555555555555555",
        );
      });
    });
  });

  describe("GaugeKilled Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeKilled.createMockEvent>;
    const chainId = 10;
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeKilled.createMockEvent({
        gauge: gaugeAddress,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool entity exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      const feeVotingRewardAddress =
        "0x6572b2b30f63B960608f3aA5205711C558998398";
      const bribeVotingRewardAddress =
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1";

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Initially has gauge address
          gaugeIsAlive: true, // Initially alive
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        } as LiquidityPoolAggregator;

        // Mock findPoolByGaugeAddress to return the pool
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await Voter.GaugeKilled.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should set gaugeIsAlive to false but preserve gauge address and voting reward addresses as historical data", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(false); // Should be set to false
        // Gauge address should be preserved as historical data
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        // Voting reward addresses should be preserved as historical data
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          feeVotingRewardAddress,
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          bribeVotingRewardAddress,
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        // Mock findPoolByGaugeAddress to return null
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(null);

        const resultDB = await Voter.GaugeKilled.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });
  });

  describe("GaugeRevived Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeRevived.createMockEvent>;
    const chainId = 10;
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeRevived.createMockEvent({
        gauge: gaugeAddress,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0xhash",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });
    });

    describe("when pool entity exists", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let mockLiquidityPool: LiquidityPoolAggregator;
      const feeVotingRewardAddress =
        "0x6572b2b30f63B960608f3aA5205711C558998398";
      const bribeVotingRewardAddress =
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1";

      beforeEach(async () => {
        const { mockLiquidityPoolData } = setupCommon();

        mockLiquidityPool = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Has gauge address
          gaugeIsAlive: false, // Initially killed
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        } as LiquidityPoolAggregator;

        // Mock findPoolByGaugeAddress to return the pool
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await Voter.GaugeRevived.processEvent({
          event: mockEvent,
          mockDb,
        });
      });

      it("should set gaugeIsAlive to true", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(true); // Should be set to true
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist", () => {
      it("should not create any entities", async () => {
        // Mock findPoolByGaugeAddress to return null
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(null);

        const resultDB = await Voter.GaugeRevived.processEvent({
          event: mockEvent,
          mockDb,
        });

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });
  });

  describe("WhitelistToken event", () => {
    let resultDB: ReturnType<typeof MockDb.createMockDb>;
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.WhitelistToken.createMockEvent>;

    beforeEach(async () => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.WhitelistToken.createMockEvent({
        whitelister: "0x1111111111111111111111111111111111111111",
        token: "0x2222222222222222222222222222222222222222",
        _bool: true,
        mockEventData: {
          block: {
            number: 123456,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 1,
        },
      });
    });
    describe("if token is in the db", () => {
      const expectedPricePerUSDNew = BigInt(10000000);
      let expectedId: string;
      beforeEach(async () => {
        // Note token doesn't have lastUpdatedTimestamp due to bug in codegen.
        // Will cast during the set call.
        const token = {
          id: TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
          address: "0x2222222222222222222222222222222222222222",
          symbol: "TEST",
          name: "TEST",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: expectedPricePerUSDNew,
          isWhitelisted: false,
        };

        const updatedDB1 = mockDb.entities.Token.set(token as Token);

        resultDB = await Voter.WhitelistToken.processEvent({
          event: mockEvent,
          mockDb: updatedDB1,
        });

        expectedId = TokenIdByChain(
          "0x2222222222222222222222222222222222222222",
          10,
        );
      });

      it("should update the token entity", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.id).toBe(expectedId);
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
      });

      it("should update lastUpdatedTimestamp when updating existing token", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.lastUpdatedTimestamp).toBeInstanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).toBe(
          mockEvent.block.timestamp * 1000,
        );
      });
    });
    describe("if token is not in the db", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let expectedId: string;
      beforeEach(async () => {
        resultDB = await Voter.WhitelistToken.processEvent({
          event: mockEvent,
          mockDb: mockDb,
        });

        expectedId = TokenIdByChain(
          "0x2222222222222222222222222222222222222222",
          10,
        );
      });

      it("should create a new Token entity", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.id).toBe(expectedId);
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(0n);
        expect(typeof token?.name).toBe("string");
        expect(typeof token?.symbol).toBe("string");
        expect(token?.address).toBe(
          "0x2222222222222222222222222222222222222222",
        );
      });

      it("should set lastUpdatedTimestamp when creating new token", async () => {
        const token = resultDB.entities.Token.get(
          TokenIdByChain("0x2222222222222222222222222222222222222222", 10),
        );
        expect(token?.lastUpdatedTimestamp).toBeInstanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).toBe(
          mockEvent.block.timestamp * 1000,
        );
      });
    });
  });

  describe("DistributeReward Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.DistributeReward.createMockEvent>;

    /**
     * Constants for the Distribute Reward event test. Note that we can use real
     * poolAddress and gaugeAddresses to make the call work.
     *
     * @constant {number} chainId - The chain ID for Optimism.
     * @constant {string} poolAddress - The address of the liquidity pool.
     * @constant {string} gaugeAddress - The address of the gauge.
     *
     * @see {@link ../../.cache/guagetopool-10.json} for a mapping between gauge and pool that exists.
     */
    const chainId = 10; // Optimism
    const voterAddress = "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C";
    const poolAddress = "0x478946BcD4a5a22b316470F5486fAfb928C0bA25";
    const poolId = PoolId(chainId, poolAddress);
    const gaugeAddress = "0xa75127121d28a9bf848f3b70e7eea26570aa7700";
    const blockNumber = 128357873;

    const rewardTokenAddress =
      CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

    beforeEach(() => {
      mockDb = MockDb.createMockDb();

      // Setup the mock event
      mockEvent = Voter.DistributeReward.createMockEvent({
        gauge: gaugeAddress,
        amount: 1000n * 10n ** 18n, // 1000 tokens with 18 decimals
        mockEventData: {
          block: {
            number: blockNumber,
            timestamp: 1000000,
            hash: "0xblockhash",
          },
          chainId: chainId,
          logIndex: 0,
          srcAddress: voterAddress,
        },
      });
    });

    describe("when reward token and liquidity pool exist", () => {
      let resultDB: ReturnType<typeof MockDb.createMockDb>;
      let updatedDB: ReturnType<typeof MockDb.createMockDb>;
      let originalChainConstants: (typeof CHAIN_CONSTANTS)[typeof chainId];

      const { mockLiquidityPoolData } = setupCommon();

      let expectations: {
        totalEmissions: bigint;
        totalEmissionsUSD: bigint;
        getTokensDeposited: bigint;
        getTokensDepositedUSD: bigint;
      };

      beforeEach(async () => {
        const liquidityPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          totalEmissions: 0n,
          totalEmissionsUSD: 0n,
          totalVotesDeposited: 0n,
          totalVotesDepositedUSD: 0n,
        } as LiquidityPoolAggregator;

        const rewardToken: Token = {
          id: TokenIdByChain(rewardTokenAddress, chainId),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n, // $2 per token
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000), // Set timestamp to prevent refresh
        } as Token;

        expectations = {
          totalEmissions: 1000n * 10n ** 18n, // normalizedEmissionsAmount
          totalEmissionsUSD: 2000n * 10n ** 18n, // normalizedEmissionsAmountUsd
          getTokensDeposited: 500n * 10n ** 18n,
          getTokensDepositedUSD: 1000n * 10n ** 18n,
        };

        // Mock findPoolByGaugeAddress to return the pool
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(liquidityPool);

        // Mock the effect functions at module level
        jest
          .spyOn(
            getIsAlive as unknown as EffectWithHandler<
              {
                voterAddress: string;
                gaugeAddress: string;
                blockNumber: number;
                eventChainId: number;
              },
              boolean | undefined
            >,
            "handler",
          )
          .mockImplementation(async () => true);
        jest
          .spyOn(
            getTokensDeposited as unknown as EffectWithHandler<
              {
                rewardTokenAddress: string;
                gaugeAddress: string;
                blockNumber: number;
                eventChainId: number;
              },
              bigint | undefined
            >,
            "handler",
          )
          .mockImplementation(async () => expectations.getTokensDeposited);

        // Set entities in the mock database
        updatedDB = mockDb.entities.Token.set(rewardToken);
        updatedDB =
          updatedDB.entities.LiquidityPoolAggregator.set(liquidityPool);

        // Mock CHAIN_CONSTANTS rewardToken function
        // Store original before mutation to restore in afterEach
        originalChainConstants = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstants,
          rewardToken: jest.fn().mockReturnValue(rewardTokenAddress),
        };

        // Process the event
        resultDB = await Voter.DistributeReward.processEvent({
          event: mockEvent,
          mockDb: updatedDB,
        });
      });

      afterEach(() => {
        // Restore original CHAIN_CONSTANTS to prevent test pollution
        // Note: jest.restoreAllMocks() in outer afterEach handles spy restoration
        CHAIN_CONSTANTS[chainId] = originalChainConstants;
      });

      it("should update the liquidity pool aggregator with emissions data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalEmissions).toBe(expectations.totalEmissions);
        expect(updatedPool?.totalEmissionsUSD).toBe(
          expectations.totalEmissionsUSD,
        );
        expect(updatedPool?.gaugeIsAlive).toBe(true);
        expect(updatedPool?.totalVotesDeposited).toBe(
          expectations.getTokensDeposited,
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
      it("should update the liquidity pool aggregator with votes deposited data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalVotesDeposited).toBe(
          expectations.getTokensDeposited,
        );
        expect(updatedPool?.totalVotesDepositedUSD).toBe(
          expectations.getTokensDepositedUSD,
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
      });
      it("should update the liquidity pool aggregator with gauge is alive data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(true);
      });
    });

    describe("when pool entity does not exist", () => {
      let originalChainConstantsForPoolTest: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should return early when pool does not exist", async () => {
        // Mock CHAIN_CONSTANTS rewardToken function
        originalChainConstantsForPoolTest = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsForPoolTest,
          rewardToken: jest.fn().mockReturnValue(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return null
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(null);

        const resultDB = await Voter.DistributeReward.processEvent({
          event: mockEvent,
          mockDb: mockDb,
        });

        // Should not create any entities when pool doesn't exist
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });

      afterEach(() => {
        // Restore original CHAIN_CONSTANTS to prevent test pollution
        if (originalChainConstantsForPoolTest !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsForPoolTest;
        }
      });
    });

    describe("when reward token or liquidity pool is missing", () => {
      let originalChainConstantsForRewardTest: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should log warning and return early when reward token is missing", async () => {
        const { mockLiquidityPoolData } = setupCommon();
        const liquidityPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          totalEmissions: 0n, // Start with 0 to test that it remains unchanged
        } as LiquidityPoolAggregator;

        // Mock CHAIN_CONSTANTS rewardToken function
        originalChainConstantsForRewardTest = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsForRewardTest,
          rewardToken: jest.fn().mockReturnValue(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return the pool
        jest
          .spyOn(LiquidityPoolAggregatorModule, "findPoolByGaugeAddress")
          .mockResolvedValue(liquidityPool);

        // Create a fresh database with only the liquidity pool, no reward token
        const freshDb = MockDb.createMockDb();
        const testDb =
          freshDb.entities.LiquidityPoolAggregator.set(liquidityPool);

        const resultDB = await Voter.DistributeReward.processEvent({
          event: mockEvent,
          mockDb: testDb,
        });

        // Should not update any entities when reward token is missing
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(1);
        const pool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(pool?.totalEmissions).toBe(0n); // Should remain unchanged
      });

      afterEach(() => {
        // Restore original CHAIN_CONSTANTS to prevent test pollution
        if (originalChainConstantsForRewardTest !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsForRewardTest;
        }
      });
    });
  });
});
