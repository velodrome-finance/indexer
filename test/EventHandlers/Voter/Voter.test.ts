import type {
  LiquidityPoolAggregator,
  Token,
  VeNFTPoolVote,
  VeNFTState,
} from "generated";
import {
  MockDb,
  RootCLPoolFactory,
  VeNFT,
  Voter,
} from "generated/src/TestHelpers.gen";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  CHAIN_CONSTANTS,
  PendingDistributionId,
  PendingRootPoolMappingId,
  PendingVoteId,
  PoolId,
  RootGaugeRootPoolId,
  RootPoolLeafPoolId,
  TokenId,
  UserStatsPerPoolId,
  VeNFTId,
  VeNFTPoolVoteId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../../../src/Constants";
import { getTokensDeposited } from "../../../src/Effects/Voter";
import { setupCommon } from "../Pool/common";

// --- DistributeReward test helpers ---
interface EffectWithHandler<I, O> {
  name: string;
  handler: (args: { input: I; context: unknown }) => Promise<O>;
}

const DEFAULT_REWARD_TIMESTAMP_SECONDS = 1000000;

function createRewardToken(
  chainId: number,
  rewardTokenAddress: string,
  overrides?: Partial<Token> & { timestampSeconds?: number },
): Token {
  const timestampSeconds =
    overrides?.timestampSeconds ?? DEFAULT_REWARD_TIMESTAMP_SECONDS;
  const base: Token = {
    id: TokenId(chainId, rewardTokenAddress),
    address: rewardTokenAddress as `0x${string}`,
    symbol: "VELO",
    name: "VELO",
    chainId,
    decimals: 18n,
    pricePerUSDNew: 2n * 10n ** 18n,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(timestampSeconds * 1000),
  } as Token;
  if (!overrides) return base;
  const { timestampSeconds: _ts, ...rest } = overrides;
  return { ...base, ...rest };
}

function setupDistributeRewardMocks(
  chainId: number,
  rewardTokenAddress: string,
  options?: { getTokensDepositedValue?: bigint; timestampSeconds?: number },
): { rewardToken: Token; cleanup: () => void } {
  const original = CHAIN_CONSTANTS[chainId];
  CHAIN_CONSTANTS[chainId] = {
    ...original,
    rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
  };

  let spy: ReturnType<typeof vi.spyOn> | undefined;
  if (options?.getTokensDepositedValue !== undefined) {
    spy = vi
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
      .mockImplementation(async () => options.getTokensDepositedValue);
  }

  const rewardToken = createRewardToken(chainId, rewardTokenAddress, {
    timestampSeconds: options?.timestampSeconds,
  });

  const cleanup = () => {
    CHAIN_CONSTANTS[chainId] = original;
    spy?.mockRestore();
  };

  return { rewardToken, cleanup };
}
// --- end DistributeReward helpers ---

describe("Voter Events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      let mockUserStats: ReturnType<
        ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
      >;
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
          poolAddress: poolAddress,
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

        resultDB = await mockDb.processEvents([mockEvent]);
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
        const userStatsId = UserStatsPerPoolId(
          chainId,
          ownerAddress,
          poolAddress,
        );
        const updatedUserStats =
          resultDB.entities.UserStatsPerPool.get(userStatsId);
        expect(updatedUserStats).toBeDefined();
        expect(updatedUserStats?.veNFTamountStaked).toBe(100n);
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should attribute votes to tokenId owner, not voter", () => {
        const voterStatsId = UserStatsPerPoolId(
          chainId,
          voterAddress,
          poolAddress,
        );
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

    describe("when pool data exists but VeNFTState is missing", () => {
      it("should return early without updating pool or creating vote entities", async () => {
        const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
          setupCommon();
        const poolWithZeroStaked = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId,
          veNFTamountStaked: 0n,
        } as LiquidityPoolAggregator;
        let db = MockDb.createMockDb();
        db = db.entities.LiquidityPoolAggregator.set(poolWithZeroStaked);
        db = db.entities.Token.set(mockToken0Data);
        db = db.entities.Token.set(mockToken1Data);

        const resultDB = await db.processEvents([mockEvent]);

        const pool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(pool?.veNFTamountStaked).toBe(0n);
        expect(
          Array.from(resultDB.entities.UserStatsPerPool.getAll()),
        ).toHaveLength(0);
        expect(
          Array.from(resultDB.entities.VeNFTPoolVote.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        const resultDB = await mockDb.processEvents([mockEvent]);

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

    describe("when RootPool_LeafPool mapping is missing", () => {
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );
      const blockTimestamp = 1000000;
      const blockNumber = 123456;
      const txHash =
        "0x133260f0f7bf0a06d262f09b064a35d3c63178c6b5fd8e4798ba780f357dc7bd";
      const rootChainId = 10;
      const leafChainId = 252;
      const token0 = toChecksumAddress(
        "0xFc00000000000000000000000000000000000001",
      );
      const token1 = toChecksumAddress(
        "0xFC00000000000000000000000000000000000006",
      );
      const tickSpacing = 100n;
      const makePendingMapping = () => ({
        id: PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        rootChainId,
        rootPoolAddress,
        leafChainId,
        token0,
        token1,
        tickSpacing,
        rootPoolMatchingHash: rootPoolMatchingHash(
          leafChainId,
          token0,
          token1,
          tickSpacing,
        ),
      });

      it("should create PendingVote for Voted and not update pool entities", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId),
          chainId,
          tokenId,
          owner: ownerAddress,
        });
        // Cross-chain: root pool has PendingRootPoolMapping but no leaf yet -> MAPPING_NOT_FOUND -> create PendingVote
        mockDb = mockDb.entities.VeNFTState.set(mockVeNFTState);
        mockDb = mockDb.entities.PendingRootPoolMapping.set(
          makePendingMapping(),
        );
        mockEvent = Voter.Voted.createMockEvent({
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId,
          weight: 100n,
          totalWeight: 1000n,
          mockEventData: {
            block: {
              number: blockNumber,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId,
            logIndex: 1,
            transaction: { hash: txHash },
          },
        });

        const resultDB = await mockDb.processEvents([mockEvent]);

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote =
          resultDB.entities.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.rootPoolAddress).toBe(rootPoolAddress);
        expect(pendingVote?.tokenId).toBe(tokenId);
        expect(pendingVote?.weight).toBe(100n);
        expect(pendingVote?.eventType).toBe("Voted");
        expect(pendingVote?.blockNumber).toBe(BigInt(blockNumber));
        expect(pendingVote?.transactionHash).toBe(txHash);

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

      it("should create PendingVote for Abstained and not update pool entities", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId),
          chainId,
          tokenId,
          owner: ownerAddress,
        });
        mockDb = mockDb.entities.VeNFTState.set(mockVeNFTState);
        mockDb = mockDb.entities.PendingRootPoolMapping.set(
          makePendingMapping(),
        );
        const abstainedEvent = Voter.Abstained.createMockEvent({
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId,
          weight: 100n,
          totalWeight: 1000n,
          mockEventData: {
            block: {
              number: blockNumber,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId,
            logIndex: 1,
            transaction: { hash: txHash },
          },
        });

        const resultDB = await mockDb.processEvents([abstainedEvent]);

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote =
          resultDB.entities.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.eventType).toBe("Abstained");
        expect(pendingVote?.weight).toBe(100n);

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

      it("should not create PendingVote for Voted when RootPool_LeafPool mapping is missing and veNFTState is missing", async () => {
        // Deferred path: missing root pool mapping. No VeNFTState in DB -> must not create PendingVote.
        mockDb = mockDb.entities.PendingRootPoolMapping.set(
          makePendingMapping(),
        );
        mockEvent = Voter.Voted.createMockEvent({
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId,
          weight: 100n,
          totalWeight: 1000n,
          mockEventData: {
            block: {
              number: blockNumber,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId,
            logIndex: 1,
            transaction: { hash: txHash },
          },
        });

        const resultDB = await mockDb.processEvents([mockEvent]);

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote =
          resultDB.entities.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeUndefined();
        expect(Array.from(resultDB.entities.PendingVote.getAll())).toHaveLength(
          0,
        );
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

      it("should not create PendingVote for Abstained when RootPool_LeafPool mapping is missing and veNFTState is missing", async () => {
        // Deferred path: missing root pool mapping. No VeNFTState in DB -> must not create PendingVote.
        mockDb = mockDb.entities.PendingRootPoolMapping.set(
          makePendingMapping(),
        );
        const abstainedEvent = Voter.Abstained.createMockEvent({
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId,
          weight: 100n,
          totalWeight: 1000n,
          mockEventData: {
            block: {
              number: blockNumber,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId,
            logIndex: 1,
            transaction: { hash: txHash },
          },
        });

        const resultDB = await mockDb.processEvents([abstainedEvent]);

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote =
          resultDB.entities.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeUndefined();
        expect(Array.from(resultDB.entities.PendingVote.getAll())).toHaveLength(
          0,
        );
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

    describe("cross-chain sync: RootPoolCreated then Voted/Abstained (leaf chain behind)", () => {
      const rootChainId = 10;
      const leafChainId = 252;
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );
      const token0 = toChecksumAddress(
        "0xFc00000000000000000000000000000000000001",
      );
      const token1 = toChecksumAddress(
        "0xFC00000000000000000000000000000000000006",
      );
      const tickSpacing = BigInt(100);
      const voteTokenId = 1n;
      const voteWeight = 100n;
      const totalWeight = 1000n;
      const blockTimestamp = 1000000;
      const blockNumber = 123456;
      const txHash =
        "0x133260f0f7bf0a06d262f09b064a35d3c63178c6b5fd8e4798ba780f357dc7bd";

      it("should create PendingRootPoolMapping and PendingVote when RootPoolCreated then Voted (no leaf pool yet)", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, voteTokenId),
          chainId: rootChainId,
          tokenId: voteTokenId,
          owner: ownerAddress,
        });
        let db = MockDb.createMockDb();
        db = db.entities.VeNFTState.set(mockVeNFTState);

        const rootPoolCreatedEvent =
          RootCLPoolFactory.RootPoolCreated.createMockEvent({
            token0,
            token1,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress,
            mockEventData: {
              block: {
                timestamp: blockTimestamp,
                number: blockNumber,
                hash: txHash,
              },
              chainId: rootChainId,
              logIndex: 1,
            },
          });
        const votedEvent = Voter.Voted.createMockEvent({
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId: voteTokenId,
          weight: voteWeight,
          totalWeight,
          mockEventData: {
            block: {
              number: blockNumber,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId: rootChainId,
            logIndex: 2,
            transaction: { hash: txHash },
          },
        });

        const resultDB = await db.processEvents([
          rootPoolCreatedEvent,
          votedEvent,
        ]);

        const pendingMapping = resultDB.entities.PendingRootPoolMapping.get(
          PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        );
        expect(pendingMapping).toBeDefined();
        expect(pendingMapping?.rootPoolAddress).toBe(rootPoolAddress);
        expect(pendingMapping?.rootChainId).toBe(rootChainId);
        expect(pendingMapping?.leafChainId).toBe(leafChainId);
        expect(pendingMapping?.token0).toBe(token0);
        expect(pendingMapping?.token1).toBe(token1);
        expect(pendingMapping?.tickSpacing).toBe(tickSpacing);
        expect(pendingMapping?.rootPoolMatchingHash).toBe(
          rootPoolMatchingHash(leafChainId, token0, token1, tickSpacing),
        );

        const expectedPendingVoteId = PendingVoteId(
          rootChainId,
          rootPoolAddress,
          voteTokenId,
          txHash,
          2,
        );
        const pendingVote = resultDB.entities.PendingVote.get(
          expectedPendingVoteId,
        );
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.rootPoolAddress).toBe(rootPoolAddress);
        expect(pendingVote?.eventType).toBe("Voted");
        expect(pendingVote?.weight).toBe(voteWeight);

        expect(
          Array.from(resultDB.entities.RootPool_LeafPool.getAll()),
        ).toHaveLength(0);
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });

      it("should create PendingRootPoolMapping and PendingVote when RootPoolCreated then Abstained (no leaf pool yet)", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, voteTokenId),
          chainId: rootChainId,
          tokenId: voteTokenId,
          owner: ownerAddress,
        });
        let db = MockDb.createMockDb();
        db = db.entities.VeNFTState.set(mockVeNFTState);

        const rootPoolCreatedEvent =
          RootCLPoolFactory.RootPoolCreated.createMockEvent({
            token0,
            token1,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress,
            mockEventData: {
              block: {
                timestamp: blockTimestamp,
                number: blockNumber,
                hash: txHash,
              },
              chainId: rootChainId,
              logIndex: 1,
            },
          });
        const abstainedEvent = Voter.Abstained.createMockEvent({
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId: voteTokenId,
          weight: voteWeight,
          totalWeight,
          mockEventData: {
            block: {
              number: blockNumber,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId: rootChainId,
            logIndex: 2,
            transaction: { hash: txHash },
          },
        });

        const resultDB = await db.processEvents([
          rootPoolCreatedEvent,
          abstainedEvent,
        ]);

        const pendingMapping = resultDB.entities.PendingRootPoolMapping.get(
          PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        );
        expect(pendingMapping).toBeDefined();

        const expectedPendingVoteId = PendingVoteId(
          rootChainId,
          rootPoolAddress,
          voteTokenId,
          txHash,
          2,
        );
        const pendingVote = resultDB.entities.PendingVote.get(
          expectedPendingVoteId,
        );
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.eventType).toBe("Abstained");

        expect(
          Array.from(resultDB.entities.RootPool_LeafPool.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("Voted processed before RootPoolCreated (sync order edge case)", () => {
      const rootChainId = 10;
      const leafChainId = 252;
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );
      const token0 = toChecksumAddress(
        "0xFc00000000000000000000000000000000000001",
      );
      const token1 = toChecksumAddress(
        "0xFC00000000000000000000000000000000000006",
      );
      const tickSpacing = BigInt(100);
      const voteTokenId = 1n;
      const blockTimestamp = 1000000;
      const blockNumber = 123456;
      const txHash =
        "0x133260f0f7bf0a06d262f09b064a35d3c63178c6b5fd8e4798ba780f357dc7bd";

      it("should create PendingVote when Voted is processed before RootPoolCreated (PendingRootPoolMapping created by second event)", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, voteTokenId),
          chainId: rootChainId,
          tokenId: voteTokenId,
          owner: ownerAddress,
        });
        let db = MockDb.createMockDb();
        db = db.entities.VeNFTState.set(mockVeNFTState);

        const votedEvent = Voter.Voted.createMockEvent({
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId: voteTokenId,
          weight: 100n,
          totalWeight: 1000n,
          mockEventData: {
            block: {
              number: blockNumber,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId: rootChainId,
            logIndex: 1,
            transaction: { hash: txHash },
          },
        });
        const rootPoolCreatedEvent =
          RootCLPoolFactory.RootPoolCreated.createMockEvent({
            token0,
            token1,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress,
            mockEventData: {
              block: {
                timestamp: blockTimestamp + 1,
                number: blockNumber + 1,
                hash: txHash,
              },
              chainId: rootChainId,
              logIndex: 2,
            },
          });

        const resultDB = await db.processEvents([
          votedEvent,
          rootPoolCreatedEvent,
        ]);

        // create PendingVote whenever mapping is missing; RootPoolCreated then adds PendingRootPoolMapping
        expect(Array.from(resultDB.entities.PendingVote.getAll())).toHaveLength(
          1,
        );

        const pendingMapping = resultDB.entities.PendingRootPoolMapping.get(
          PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        );
        expect(pendingMapping).toBeDefined();
        expect(pendingMapping?.rootPoolAddress).toBe(rootPoolAddress);

        expect(
          Array.from(resultDB.entities.RootPool_LeafPool.getAll()),
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
      let mockUserStats: ReturnType<
        ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
      >;
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
          id: TokenId(leafChainId, mockToken0Data.address),
          chainId: leafChainId,
        };
        const leafToken1Data: Token = {
          ...mockToken1Data,
          id: TokenId(leafChainId, mockToken1Data.address),
          chainId: leafChainId,
        };

        // Create leaf pool using helper function
        mockLeafPool = createMockLiquidityPoolAggregator({
          id: PoolId(leafChainId, leafPoolAddress),
          chainId: leafChainId,
          poolAddress: leafPoolAddress,
          token0_id: leafToken0Data.id,
          token1_id: leafToken1Data.id,
          veNFTamountStaked: 0n,
        });

        // Create user stats keyed by leaf pool (real pool), not root
        mockUserStats = createMockUserStatsPerPool({
          userAddress: realVoterAddress,
          poolAddress: leafPoolAddress,
          chainId: leafChainId,
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
          id: RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
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

        resultDB = await mockDb.processEvents([mockEvent]);
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
        const userStatsId = UserStatsPerPoolId(
          leafChainId,
          realVoterAddress,
          leafPoolAddress,
        );
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
          poolAddress: poolAddress,
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

        const dbAfterFirst = await db.processEvents([voteEvent1]);

        const dbAfterSecond = await dbAfterFirst.processEvents([voteEvent2]);

        const updatedUserStats = dbAfterSecond.entities.UserStatsPerPool.get(
          UserStatsPerPoolId(chainId, owner, poolAddress),
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
      let mockUserStats: ReturnType<
        ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
      >;
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
          poolAddress: poolAddress,
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

        resultDB = await mockDb.processEvents([mockEvent]);
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
        const userStatsId = UserStatsPerPoolId(
          chainId,
          ownerAddress,
          poolAddress,
        );
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

    describe("when pool data exists but VeNFTState is missing", () => {
      it("should return early without updating pool or creating vote entities", async () => {
        const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
          setupCommon();
        const poolWithStaked = {
          ...mockLiquidityPoolData,
          id: PoolId(chainId, poolAddress),
          chainId,
          veNFTamountStaked: 1000n,
        } as LiquidityPoolAggregator;
        let db = MockDb.createMockDb();
        db = db.entities.LiquidityPoolAggregator.set(poolWithStaked);
        db = db.entities.Token.set(mockToken0Data);
        db = db.entities.Token.set(mockToken1Data);

        const resultDB = await db.processEvents([mockEvent]);

        const pool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(pool?.veNFTamountStaked).toBe(1000n);
        expect(
          Array.from(resultDB.entities.UserStatsPerPool.getAll()),
        ).toHaveLength(0);
        expect(
          Array.from(resultDB.entities.VeNFTPoolVote.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        const resultDB = await mockDb.processEvents([mockEvent]);

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
      const rootPoolAddress = toChecksumAddress(
        "0x4f2eD04AA2E052090144B0a6f72fbf5b340ED20c",
      );
      const leafPoolAddress = toChecksumAddress(
        "0xd335C616C8aa60CaB2345052f9D7D62Eb722f320",
      );
      const realVoterAddress = toChecksumAddress(
        "0x0B7a0dE062EC95f815E9Aaa31C0AcBAdC7717171",
      );
      const realTokenId = 961n;
      const realWeight = 22328957523870653419264n;
      const realTotalWeight = 2586327170227043887618593n;
      const realTimestamp = 1734595305;
      const rootChainId = 10; // Optimism
      const leafChainId = 252; // Fraxtal
      const initialUserStaked = 50000000000000000000000n; // 50k tokens (18 decimals) - initial amount before withdrawal
      let mockLeafPool: LiquidityPoolAggregator;
      let mockUserStats: ReturnType<
        ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
      >;
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
          id: TokenId(leafChainId, mockToken0Data.address),
          chainId: leafChainId,
        };
        const leafToken1Data: Token = {
          ...mockToken1Data,
          id: TokenId(leafChainId, mockToken1Data.address),
          chainId: leafChainId,
        };

        // Create leaf pool using helper function with initial staked amount
        mockLeafPool = createMockLiquidityPoolAggregator({
          id: PoolId(leafChainId, leafPoolAddress),
          chainId: leafChainId,
          poolAddress: leafPoolAddress,
          token0_id: leafToken0Data.id,
          token1_id: leafToken1Data.id,
          veNFTamountStaked: 3000000000000000000000000n, // Initial staked amount (3M tokens)
        });

        // Create user stats keyed by leaf pool (real pool), not root
        mockUserStats = createMockUserStatsPerPool({
          userAddress: realVoterAddress,
          poolAddress: leafPoolAddress,
          chainId: leafChainId,
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
          id: VeNFTPoolVoteId(leafChainId, realTokenId, leafPoolAddress),
          poolAddress: leafPoolAddress,
          veNFTamountStaked: realWeight,
          veNFTState_id: mockVeNFTState.id,
          lastUpdatedTimestamp: new Date(0),
        });

        // Create RootPool_LeafPool mapping
        const rootPoolLeafPool = {
          id: RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
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

        resultDB = await mockDb.processEvents([mockEvent]);
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
        const userStatsId = UserStatsPerPoolId(
          leafChainId,
          realVoterAddress,
          leafPoolAddress,
        );
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
          leafChainId,
          realTokenId,
          leafPoolAddress,
        );
        const veNFTPoolVote =
          resultDB.entities.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(0n);
      });

      it("should key VeNFTPoolVote and UserStatsPerPool by leaf pool (real pool) not root pool", () => {
        const rootUserStatsId = UserStatsPerPoolId(
          rootChainId,
          realVoterAddress,
          rootPoolAddress,
        );
        const rootVeNFTPoolVoteId = VeNFTPoolVoteId(
          rootChainId,
          realTokenId,
          rootPoolAddress,
        );
        expect(
          resultDB.entities.UserStatsPerPool.get(rootUserStatsId),
        ).toBeUndefined();
        expect(
          resultDB.entities.VeNFTPoolVote.get(rootVeNFTPoolVoteId),
        ).toBeUndefined();

        const leafUserStatsId = UserStatsPerPoolId(
          leafChainId,
          realVoterAddress,
          leafPoolAddress,
        );
        const leafVeNFTPoolVoteId = VeNFTPoolVoteId(
          leafChainId,
          realTokenId,
          leafPoolAddress,
        );
        const leafUserStats =
          resultDB.entities.UserStatsPerPool.get(leafUserStatsId);
        const leafVeNFTPoolVote =
          resultDB.entities.VeNFTPoolVote.get(leafVeNFTPoolVoteId);
        expect(leafUserStats).toBeDefined();
        expect(leafVeNFTPoolVote).toBeDefined();
        expect(leafUserStats?.veNFTamountStaked).toBe(
          initialUserStaked - realWeight,
        );
        expect(leafVeNFTPoolVote?.veNFTamountStaked).toBe(0n);
      });
    });
  });

  describe("cross-chain vote transfer then abstain", () => {
    it("reassigns the leaf user stake on transfer and returns it to zero on abstain", async () => {
      const {
        mockToken0Data,
        mockToken1Data,
        createMockLiquidityPoolAggregator,
        createMockVeNFTState,
      } = setupCommon();

      const rootChainId = 10;
      const leafChainId = 252;
      const tokenId = 4911n;
      const voteWeight = 126886024262337895334200n;
      const rootPoolAddress = toChecksumAddress(
        "0xf1D64ffc40Dc0050584dEf9496c0f7C463ec93Bf",
      );
      const leafPoolAddress = toChecksumAddress(
        "0xb43F6D14FeFA510F014cf90c8Ab110803bB28778",
      );
      const oldOwner = toChecksumAddress(
        "0xdaA12ca83de2FaB833fC28CE1300Ba6ddEe67204",
      );
      const newOwner = toChecksumAddress(
        "0x28ba242755de3034ac4bd63261e3579bDb37D599",
      );

      const leafToken0Data: Token = {
        ...mockToken0Data,
        id: TokenId(leafChainId, mockToken0Data.address),
        chainId: leafChainId,
      };
      const leafToken1Data: Token = {
        ...mockToken1Data,
        id: TokenId(leafChainId, mockToken1Data.address),
        chainId: leafChainId,
      };

      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
        token0_id: leafToken0Data.id,
        token1_id: leafToken1Data.id,
        veNFTamountStaked: 0n,
      });

      const veNFTState = createMockVeNFTState({
        id: VeNFTId(rootChainId, tokenId),
        chainId: rootChainId,
        tokenId,
        owner: oldOwner,
      });

      const rootPoolLeafPool = {
        id: RootPoolLeafPoolId(
          rootChainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        ),
        rootChainId,
        rootPoolAddress,
        leafChainId,
        leafPoolAddress,
      };

      let db = MockDb.createMockDb();
      db = db.entities.LiquidityPoolAggregator.set(leafPool);
      db = db.entities.RootPool_LeafPool.set(rootPoolLeafPool);
      db = db.entities.Token.set(leafToken0Data);
      db = db.entities.Token.set(leafToken1Data);
      db = db.entities.VeNFTState.set(veNFTState);

      const voteEvent = Voter.Voted.createMockEvent({
        voter: oldOwner,
        pool: rootPoolAddress,
        tokenId,
        weight: voteWeight,
        totalWeight: voteWeight,
        mockEventData: {
          block: {
            number: 129471197,
            timestamp: 1734541171,
            hash: "0xvote",
          },
          chainId: rootChainId,
          logIndex: 123,
        },
      });

      const transferEvent = VeNFT.Transfer.createMockEvent({
        from: oldOwner,
        to: newOwner,
        tokenId,
        mockEventData: {
          block: {
            number: 129598042,
            timestamp: 1734794861,
            hash: "0xtransfer",
          },
          chainId: rootChainId,
          logIndex: 8,
          srcAddress: toChecksumAddress(
            "0xFAf8FD17D9840595845582fCB047DF13f006787d",
          ),
        },
      });

      const abstainEvent = Voter.Abstained.createMockEvent({
        voter: newOwner,
        pool: rootPoolAddress,
        tokenId,
        weight: voteWeight,
        totalWeight: 0n,
        mockEventData: {
          block: {
            number: 129598518,
            timestamp: 1734795813,
            hash: "0xabstain",
          },
          chainId: rootChainId,
          logIndex: 24,
        },
      });

      const dbAfterVote = await db.processEvents([voteEvent]);
      const dbAfterTransfer = await dbAfterVote.processEvents([transferEvent]);
      const resultDB = await dbAfterTransfer.processEvents([abstainEvent]);

      const oldOwnerStatsAfterTransfer =
        dbAfterTransfer.entities.UserStatsPerPool.get(
          UserStatsPerPoolId(leafChainId, oldOwner, leafPoolAddress),
        );
      const newOwnerStatsAfterTransfer =
        dbAfterTransfer.entities.UserStatsPerPool.get(
          UserStatsPerPoolId(leafChainId, newOwner, leafPoolAddress),
        );

      expect(oldOwnerStatsAfterTransfer?.veNFTamountStaked).toBe(0n);
      expect(newOwnerStatsAfterTransfer?.veNFTamountStaked).toBe(voteWeight);
      expect(newOwnerStatsAfterTransfer?.firstActivityTimestamp).toEqual(
        new Date(1734794861 * 1000),
      );

      const finalOldOwnerStats = resultDB.entities.UserStatsPerPool.get(
        UserStatsPerPoolId(leafChainId, oldOwner, leafPoolAddress),
      );
      const finalNewOwnerStats = resultDB.entities.UserStatsPerPool.get(
        UserStatsPerPoolId(leafChainId, newOwner, leafPoolAddress),
      );
      const finalPoolVote = resultDB.entities.VeNFTPoolVote.get(
        VeNFTPoolVoteId(leafChainId, tokenId, leafPoolAddress),
      );

      expect(finalOldOwnerStats?.veNFTamountStaked).toBe(0n);
      expect(finalNewOwnerStats?.veNFTamountStaked).toBe(0n);
      expect(finalNewOwnerStats?.firstActivityTimestamp).toEqual(
        new Date(1734794861 * 1000),
      );
      expect(finalNewOwnerStats?.lastActivityTimestamp).toEqual(
        new Date(1734795813 * 1000),
      );
      expect(finalPoolVote?.veNFTamountStaked).toBe(0n);
    });
  });

  describe("GaugeCreated Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeCreated.createMockEvent>;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockEvent = Voter.GaugeCreated.createMockEvent({
        poolFactory: toChecksumAddress(
          "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
        ), // VAMM factory
        votingRewardsFactory: toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        ),
        gaugeFactory: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        pool: poolAddress,
        bribeVotingReward: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        feeVotingReward: toChecksumAddress(
          "0x6666666666666666666666666666666666666666",
        ),
        gauge: gaugeAddress,
        creator: toChecksumAddress(
          "0x7777777777777777777777777777777777777777",
        ),
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

        resultDB = await mockDb.processEvents([mockEvent]);
      });

      it("should update pool entity with gauge address and voting reward addresses", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          toChecksumAddress("0x6666666666666666666666666666666666666666"),
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          toChecksumAddress("0x5555555555555555555555555555555555555555"),
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
    });

    describe("when pool entity does not exist (RootPool case)", () => {
      it("should create RootGauge_RootPool for cross-chain DistributeReward resolution", async () => {
        const resultDB = await mockDb.processEvents([mockEvent]);

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);

        const expectedId = RootGaugeRootPoolId(chainId, gaugeAddress);
        const rootGaugeRootPool =
          resultDB.entities.RootGauge_RootPool.get(expectedId);
        expect(rootGaugeRootPool).toBeDefined();
        expect(rootGaugeRootPool?.rootChainId).toBe(chainId);
        expect(rootGaugeRootPool?.rootGaugeAddress).toBe(gaugeAddress);
        expect(rootGaugeRootPool?.rootPoolAddress).toBe(poolAddress);
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
          poolFactory: toChecksumAddress(
            "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
          ), // CL factory (optimism)
          votingRewardsFactory: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          gaugeFactory: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ),
          pool: poolAddress,
          bribeVotingReward: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          feeVotingReward: toChecksumAddress(
            "0x6666666666666666666666666666666666666666",
          ),
          gauge: gaugeAddress,
          creator: toChecksumAddress(
            "0x7777777777777777777777777777777777777777",
          ),
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

        resultDB = await mockDb.processEvents([clFactoryEvent]);
      });

      it("should update pool entity with gauge address (CL factory path)", () => {
        const updatedPool = resultDB.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeAddress).toBe(gaugeAddress);
        expect(updatedPool?.feeVotingRewardAddress).toBe(
          toChecksumAddress("0x6666666666666666666666666666666666666666"),
        );
        expect(updatedPool?.bribeVotingRewardAddress).toBe(
          toChecksumAddress("0x5555555555555555555555555555555555555555"),
        );
      });
    });
  });

  describe("GaugeKilled Event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof Voter.GaugeKilled.createMockEvent>;
    const chainId = 10;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

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
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

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
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await mockDb.processEvents([mockEvent]);
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
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const resultDB = await mockDb.processEvents([mockEvent]);

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
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

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
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

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
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(mockLiquidityPool);

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockLiquidityPool);

        resultDB = await mockDb.processEvents([mockEvent]);
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
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const resultDB = await mockDb.processEvents([mockEvent]);

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
        whitelister: toChecksumAddress(
          "0x1111111111111111111111111111111111111111",
        ),
        token: toChecksumAddress("0x2222222222222222222222222222222222222222"),
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
          id: TokenId(
            10,
            toChecksumAddress("0x2222222222222222222222222222222222222222"),
          ),
          address: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          symbol: "TEST",
          name: "TEST",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: expectedPricePerUSDNew,
          isWhitelisted: false,
        };

        const updatedDB1 = mockDb.entities.Token.set(token as Token);

        resultDB = await updatedDB1.processEvents([mockEvent]);

        expectedId = TokenId(
          10,
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        );
      });

      it("should update the token entity", async () => {
        const token = resultDB.entities.Token.get(
          TokenId(
            10,
            toChecksumAddress("0x2222222222222222222222222222222222222222"),
          ),
        );
        expect(token?.id).toBe(expectedId);
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
      });

      it("should update lastUpdatedTimestamp when updating existing token", async () => {
        const token = resultDB.entities.Token.get(
          TokenId(
            10,
            toChecksumAddress("0x2222222222222222222222222222222222222222"),
          ),
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
        resultDB = await mockDb.processEvents([mockEvent]);

        expectedId = TokenId(
          10,
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        );
      });

      it("should create a new Token entity", async () => {
        const token = resultDB.entities.Token.get(
          TokenId(
            10,
            toChecksumAddress("0x2222222222222222222222222222222222222222"),
          ),
        );
        expect(token?.id).toBe(expectedId);
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(0n);
        expect(typeof token?.name).toBe("string");
        expect(typeof token?.symbol).toBe("string");
        expect(token?.address).toBe(
          toChecksumAddress("0x2222222222222222222222222222222222222222"),
        );
      });

      it("should set lastUpdatedTimestamp when creating new token", async () => {
        const token = resultDB.entities.Token.get(
          TokenId(
            10,
            toChecksumAddress("0x2222222222222222222222222222222222222222"),
          ),
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
    const voterAddress = toChecksumAddress(
      "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
    );
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const poolId = PoolId(chainId, poolAddress);
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );
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
      let cleanup: () => void;

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
          gaugeIsAlive: false, // DistributeReward does not set this; we assert it remains unchanged
        } as LiquidityPoolAggregator;

        expectations = {
          totalEmissions: 1000n * 10n ** 18n, // normalizedEmissionsAmount
          totalEmissionsUSD: 2000n * 10n ** 18n, // normalizedEmissionsAmountUsd
          getTokensDeposited: 500n * 10n ** 18n,
          getTokensDepositedUSD: 1000n * 10n ** 18n,
        };

        const { rewardToken, cleanup: cleanupFn } = setupDistributeRewardMocks(
          chainId,
          rewardTokenAddress,
          { getTokensDepositedValue: expectations.getTokensDeposited },
        );
        cleanup = cleanupFn;

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(liquidityPool);

        // Set entities in the mock database
        updatedDB = mockDb.entities.Token.set(rewardToken);
        updatedDB =
          updatedDB.entities.LiquidityPoolAggregator.set(liquidityPool);

        // Process the event
        resultDB = await updatedDB.processEvents([mockEvent]);
      });

      afterEach(() => {
        cleanup();
      });

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should update the liquidity pool aggregator with emissions data", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.totalEmissions).toBe(expectations.totalEmissions);
        expect(updatedPool?.totalEmissionsUSD).toBe(
          expectations.totalEmissionsUSD,
        );
        expect(updatedPool?.totalVotesDeposited).toBe(
          expectations.getTokensDeposited,
        );
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });
      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should update the liquidity pool aggregator with votes deposited data", () => {
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
      it("should not modify gaugeIsAlive (preserves existing value) when false", () => {
        const updatedPool =
          resultDB.entities.LiquidityPoolAggregator.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(false);
      });

      describe("when pool has gaugeIsAlive true", () => {
        let resultDBWithAliveGauge: ReturnType<typeof MockDb.createMockDb>;
        let originalChainConstantsAlive: (typeof CHAIN_CONSTANTS)[typeof chainId];

        beforeEach(async () => {
          const liquidityPool: LiquidityPoolAggregator = {
            ...mockLiquidityPoolData,
            id: PoolId(chainId, poolAddress),
            chainId: chainId,
            totalEmissions: 0n,
            totalEmissionsUSD: 0n,
            totalVotesDeposited: 0n,
            totalVotesDepositedUSD: 0n,
            gaugeIsAlive: true,
          } as LiquidityPoolAggregator;

          const rewardToken: Token = {
            id: TokenId(chainId, rewardTokenAddress),
            address: rewardTokenAddress,
            symbol: "VELO",
            name: "VELO",
            chainId: chainId,
            decimals: 18n,
            pricePerUSDNew: 2n * 10n ** 18n,
            isWhitelisted: true,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          } as Token;

          vi.spyOn(
            LiquidityPoolAggregatorModule,
            "findPoolByGaugeAddress",
          ).mockResolvedValue(liquidityPool);

          vi.spyOn(
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
          ).mockImplementation(async () => 500n * 10n ** 18n);

          originalChainConstantsAlive = CHAIN_CONSTANTS[chainId];
          CHAIN_CONSTANTS[chainId] = {
            ...originalChainConstantsAlive,
            rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
          };

          let db = mockDb.entities.Token.set(rewardToken);
          db = db.entities.LiquidityPoolAggregator.set(liquidityPool);
          resultDBWithAliveGauge = await db.processEvents([mockEvent]);
        });

        afterEach(() => {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsAlive;
        });

        it("should not modify gaugeIsAlive (preserves existing value) when true", () => {
          const updatedPool =
            resultDBWithAliveGauge.entities.LiquidityPoolAggregator.get(poolId);
          expect(updatedPool).toBeDefined();
          expect(updatedPool?.gaugeIsAlive).toBe(true);
        });
      });
    });

    describe("when pool entity does not exist", () => {
      let originalChainConstantsForPoolTest: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should return early when pool does not exist and no RootGauge_RootPool mapping", async () => {
        // Mock CHAIN_CONSTANTS rewardToken function
        originalChainConstantsForPoolTest = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsForPoolTest,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return null (root gauge, no local pool)
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const resultDB = await mockDb.processEvents([mockEvent]);

        // Should not create any pool entities when pool doesn't exist and no root-gauge mapping
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

    describe("when root gauge and no RootPool_LeafPool (deferred)", () => {
      const rootPoolAddress = poolAddress;
      const leafChainId = 252;
      const blockTimestamp = 1000000;
      const blockNumberForRoot = 128357870;
      const txHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";
      const token0 = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const token1 = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const tickSpacing = 60n;
      let originalChainConstantsDeferred: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should create RootGauge_RootPool and PendingDistribution when processEvents RootPoolCreated, GaugeCreated, DistributeReward with no leaf", async () => {
        originalChainConstantsDeferred = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsDeferred,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        vi.spyOn(
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
        ).mockImplementation(async () => 500n * 10n ** 18n);

        const rewardToken: Token = {
          id: TokenId(chainId, rewardTokenAddress),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
        } as Token;

        let db = MockDb.createMockDb();
        db = db.entities.Token.set(rewardToken);

        const rootPoolCreatedEvent =
          RootCLPoolFactory.RootPoolCreated.createMockEvent({
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            tickSpacing,
            chainid: BigInt(leafChainId),
            pool: rootPoolAddress,
            mockEventData: {
              block: {
                timestamp: blockTimestamp,
                number: blockNumberForRoot,
                hash: txHash,
              },
              chainId: chainId,
              logIndex: 1,
            },
          });
        const gaugeCreatedEvent = Voter.GaugeCreated.createMockEvent({
          poolFactory: toChecksumAddress(
            "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
          ),
          votingRewardsFactory: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          gaugeFactory: toChecksumAddress(
            "0x3333333333333333333333333333333333333333",
          ),
          pool: rootPoolAddress,
          bribeVotingReward: toChecksumAddress(
            "0x5555555555555555555555555555555555555555",
          ),
          feeVotingReward: toChecksumAddress(
            "0x6666666666666666666666666666666666666666",
          ),
          gauge: gaugeAddress,
          creator: toChecksumAddress(
            "0x7777777777777777777777777777777777777777",
          ),
          mockEventData: {
            block: {
              number: blockNumberForRoot,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId: chainId,
            logIndex: 2,
          },
        });
        const distributeRewardEvent = Voter.DistributeReward.createMockEvent({
          gauge: gaugeAddress,
          amount: 1000n * 10n ** 18n,
          mockEventData: {
            block: {
              number: blockNumberForRoot,
              timestamp: blockTimestamp,
              hash: txHash,
            },
            chainId: chainId,
            logIndex: 3,
            srcAddress: toChecksumAddress(
              "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
            ),
          },
        });

        const resultDB = await db.processEvents([
          rootPoolCreatedEvent,
          gaugeCreatedEvent,
          distributeRewardEvent,
        ]);

        expect(
          resultDB.entities.RootGauge_RootPool.get(
            RootGaugeRootPoolId(chainId, gaugeAddress),
          ),
        ).toBeDefined();

        const pendingDistId = PendingDistributionId(
          chainId,
          rootPoolAddress,
          blockNumberForRoot,
          3,
        );
        const pendingDistribution =
          resultDB.entities.PendingDistribution.get(pendingDistId);
        expect(pendingDistribution).toBeDefined();
        expect(pendingDistribution?.gaugeAddress).toBe(gaugeAddress);
        expect(pendingDistribution?.amount).toBe(1000n * 10n ** 18n);

        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });

      afterEach(() => {
        if (originalChainConstantsDeferred !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsDeferred;
        }
      });

      it("should create PendingDistribution when root gauge has ambiguous RootPool_LeafPool mapping (length > 1)", async () => {
        originalChainConstantsDeferred = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsDeferred,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        const rootPoolAddressForAmbiguous = poolAddress;
        const leafChainId = 252;
        const leafPoolAddressA = toChecksumAddress(
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        const leafPoolAddressB = toChecksumAddress(
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        );
        const blockNumberForRoot = 128357870;
        const logIndex = 3;

        const rewardToken: Token = {
          id: TokenId(chainId, rewardTokenAddress),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } as Token;

        const rootGaugeRootPoolId = RootGaugeRootPoolId(chainId, gaugeAddress);
        const rootPoolLeafPoolIdA = RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddressForAmbiguous,
          leafPoolAddressA,
        );
        const rootPoolLeafPoolIdB = RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddressForAmbiguous,
          leafPoolAddressB,
        );

        const distributeRewardEvent = Voter.DistributeReward.createMockEvent({
          gauge: gaugeAddress,
          amount: 1000n * 10n ** 18n,
          mockEventData: {
            block: {
              number: blockNumberForRoot,
              timestamp: 1000000,
              hash: "0xblockhash",
            },
            chainId: chainId,
            logIndex,
            srcAddress: toChecksumAddress(
              "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
            ),
          },
        });

        let db = MockDb.createMockDb();
        db = db.entities.Token.set(rewardToken);
        db = db.entities.RootGauge_RootPool.set({
          id: rootGaugeRootPoolId,
          rootChainId: chainId,
          rootGaugeAddress: gaugeAddress,
          rootPoolAddress: rootPoolAddressForAmbiguous,
        });
        db = db.entities.RootPool_LeafPool.set({
          id: rootPoolLeafPoolIdA,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddressForAmbiguous,
          leafChainId,
          leafPoolAddress: leafPoolAddressA,
        });
        db = db.entities.RootPool_LeafPool.set({
          id: rootPoolLeafPoolIdB,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddressForAmbiguous,
          leafChainId,
          leafPoolAddress: leafPoolAddressB,
        });

        const resultDB = await db.processEvents([distributeRewardEvent]);

        const pendingDistId = PendingDistributionId(
          chainId,
          rootPoolAddressForAmbiguous,
          blockNumberForRoot,
          logIndex,
        );
        const pendingDistribution =
          resultDB.entities.PendingDistribution.get(pendingDistId);
        expect(pendingDistribution).toBeDefined();
        expect(pendingDistribution?.gaugeAddress).toBe(gaugeAddress);
        expect(pendingDistribution?.amount).toBe(1000n * 10n ** 18n);
        expect(pendingDistribution?.rootPoolAddress).toBe(
          rootPoolAddressForAmbiguous,
        );
        expect(pendingDistribution?.blockNumber).toBe(
          BigInt(blockNumberForRoot),
        );
        expect(pendingDistribution?.logIndex).toBe(logIndex);

        // Distribution was deferred; no pool should have been updated
        expect(
          Array.from(resultDB.entities.LiquidityPoolAggregator.getAll()),
        ).toHaveLength(0);
      });
    });

    describe("when gauge is root gauge and RootGauge_RootPool + RootPool_LeafPool exist", () => {
      const leafChainId = 252;
      const rootPoolAddress = poolAddress;
      const leafPoolAddress = toChecksumAddress(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      const leafPoolId = PoolId(leafChainId, leafPoolAddress);
      const leafGaugeAddress = toChecksumAddress(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
      let originalChainConstantsCrossChain: (typeof CHAIN_CONSTANTS)[typeof chainId];

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should apply distribution to leaf pool without overwriting gaugeAddress", async () => {
        const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
          setupCommon();

        const leafToken0Id = TokenId(leafChainId, mockToken0Data.address);
        const leafToken1Id = TokenId(leafChainId, mockToken1Data.address);
        const leafPool: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: leafPoolId,
          poolAddress: leafPoolAddress as `0x${string}`,
          chainId: leafChainId,
          token0_id: leafToken0Id,
          token1_id: leafToken1Id,
          token0_address: mockToken0Data.address as `0x${string}`,
          token1_address: mockToken1Data.address as `0x${string}`,
          totalEmissions: 0n,
          totalEmissionsUSD: 0n,
          totalVotesDeposited: 0n,
          totalVotesDepositedUSD: 0n,
          gaugeAddress: leafGaugeAddress,
          gaugeIsAlive: true,
        } as LiquidityPoolAggregator;

        const rewardToken: Token = {
          id: TokenId(chainId, rewardTokenAddress),
          address: rewardTokenAddress,
          symbol: "VELO",
          name: "VELO",
          chainId: chainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } as Token;

        const leafToken0: Token = {
          ...mockToken0Data,
          id: leafToken0Id,
          chainId: leafChainId,
        };
        const leafToken1: Token = {
          ...mockToken1Data,
          id: leafToken1Id,
          chainId: leafChainId,
        };

        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(null);

        vi.spyOn(
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
        ).mockImplementation(async () => 500n * 10n ** 18n);

        originalChainConstantsCrossChain = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsCrossChain,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        const rootGaugeRootPoolId = RootGaugeRootPoolId(chainId, gaugeAddress);
        const rootPoolLeafPoolId = RootPoolLeafPoolId(
          chainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
        );

        let db = mockDb.entities.Token.set(rewardToken);
        db = db.entities.Token.set(leafToken0);
        db = db.entities.Token.set(leafToken1);
        db = db.entities.LiquidityPoolAggregator.set(leafPool);
        db = db.entities.RootGauge_RootPool.set({
          id: rootGaugeRootPoolId,
          rootChainId: chainId,
          rootGaugeAddress: gaugeAddress,
          rootPoolAddress: rootPoolAddress,
        });
        db = db.entities.RootPool_LeafPool.set({
          id: rootPoolLeafPoolId,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddress,
          leafChainId,
          leafPoolAddress,
        });

        const resultDB = await db.processEvents([mockEvent]);

        const updatedLeafPool =
          resultDB.entities.LiquidityPoolAggregator.get(leafPoolId);
        expect(updatedLeafPool).toBeDefined();
        expect(updatedLeafPool?.totalEmissions).toBe(1000n * 10n ** 18n);
        expect(updatedLeafPool?.totalEmissionsUSD).toBe(2000n * 10n ** 18n);
        expect(updatedLeafPool?.totalVotesDeposited).toBe(500n * 10n ** 18n);
        // Cross-chain path must not overwrite leaf pool's gauge
        expect(updatedLeafPool?.gaugeAddress).toBe(leafGaugeAddress);
      });

      afterEach(() => {
        if (originalChainConstantsCrossChain !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsCrossChain;
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
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(
          LiquidityPoolAggregatorModule,
          "findPoolByGaugeAddress",
        ).mockResolvedValue(liquidityPool);

        // Create a fresh database with only the liquidity pool, no reward token
        const freshDb = MockDb.createMockDb();
        const testDb =
          freshDb.entities.LiquidityPoolAggregator.set(liquidityPool);

        const resultDB = await testDb.processEvents([mockEvent]);

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
