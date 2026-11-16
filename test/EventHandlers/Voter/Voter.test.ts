import type { Token, VeNFTPoolVote, VeNFTState } from "envio";
import { createTestIndexer } from "envio";
import * as PoolModule from "../../../src/Aggregators/Pool";
import {
  CHAIN_CONSTANTS,
  PoolId,
  RootGaugeRootPoolId,
  RootPoolLeafPoolId,
  TokenId,
  UserStatsPerPoolId,
  VeNFTId,
  VeNFTPoolVoteId,
  getLegacyConstants,
  toChecksumAddress,
} from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import {
  RootPoolId,
  RootPoolVoteId,
} from "../../../src/EventHandlers/Voter/RootPoolLogic";
import {
  PRICE_TRUST_OUTCOME,
  PRICE_TRUST_REASON,
} from "../../../src/PriceTrust";
import { type WithChain, withLegacyRewardToken } from "../../testHelpers";
import { type MockPool, setupCommon } from "../Pool/common";

type MockUserStatsPerPool = ReturnType<
  ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
>;

// --- DistributeReward test helpers ---
const DEFAULT_REWARD_TIMESTAMP_SECONDS = 1000000;

function createRewardToken(
  chainId: number,
  rewardTokenAddress: string,
  overrides?: Partial<Token> & { timestampSeconds?: number },
): WithChain<Token> {
  const timestampSeconds =
    overrides?.timestampSeconds ?? DEFAULT_REWARD_TIMESTAMP_SECONDS;
  const base: WithChain<Token> = {
    id: TokenId(chainId, rewardTokenAddress),
    address: rewardTokenAddress as `0x${string}`,
    symbol: "VELO",
    name: "VELO",
    chainId,
    decimals: 18n,
    pricePerUSDNew: 2n * 10n ** 18n,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(timestampSeconds * 1000),
  } as WithChain<Token>;
  if (!overrides) return base;
  const { timestampSeconds: _ts, ...rest } = overrides;
  return { ...base, ...rest };
}

function setupDistributeRewardMocks(
  chainId: number,
  rewardTokenAddress: string,
  options?: { timestampSeconds?: number },
): { rewardToken: WithChain<Token>; cleanup: () => void } {
  const original = CHAIN_CONSTANTS[chainId];
  CHAIN_CONSTANTS[chainId] = withLegacyRewardToken(
    original,
    vi.fn().mockReturnValue(rewardTokenAddress),
  );

  const rewardToken = createRewardToken(chainId, rewardTokenAddress, {
    timestampSeconds: options?.timestampSeconds,
  });

  const cleanup = () => {
    CHAIN_CONSTANTS[chainId] = original;
  };

  return { rewardToken, cleanup };
}
// --- end DistributeReward helpers ---

// Superchain RootCLPoolFactory on Optimism (creates the RootPool, ADR 0009).
const ROOT_CL_POOL_FACTORY = toChecksumAddress(
  "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
);

/**
 * A RootCLPoolFactory.RootPoolCreated for `pool` (pair and tick spacing are
 * placeholders; only the RootPool row matters here).
 */
function rootPoolCreated(
  pool: string,
  leafChainId: number,
  block: { number: number; timestamp: number },
  logIndex = 1,
) {
  return {
    contract: "RootCLPoolFactory" as const,
    event: "RootPoolCreated" as const,
    srcAddress: ROOT_CL_POOL_FACTORY,
    logIndex,
    block: { ...block, hash: "0xrootpoolcreated" },
    params: {
      token0: toChecksumAddress("0xFc00000000000000000000000000000000000001"),
      token1: toChecksumAddress("0xFC00000000000000000000000000000000000006"),
      tickSpacing: 100n,
      chainid: BigInt(leafChainId),
      pool,
    },
  };
}

describe("Voter Events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Voted Event", () => {
    let indexer: ReturnType<typeof createTestIndexer>;
    const chainId = 10 as const;
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
      indexer = createTestIndexer();
    });

    describe("when pool data exists", () => {
      let mockLiquidityPool: MockPool;
      let mockUserStats: MockUserStatsPerPool;
      let mockVeNFTState: WithChain<VeNFTState>;

      beforeEach(async () => {
        const {
          createMockPool,
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockVeNFTState,
        } = setupCommon();

        mockLiquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          poolAddress: poolAddress,
          veNFTamountStaked: 0n,
        });

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
        indexer.Pool.set(mockLiquidityPool);
        indexer.UserStatsPerPool.set(mockUserStats);
        indexer.Token.set(mockToken0Data);
        indexer.Token.set(mockToken1Data);
        indexer.VeNFTState.set(mockVeNFTState);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });
      });

      it("should update liquidity pool aggregator with voting data", async () => {
        const raw = await indexer.Pool.get(PoolId(chainId, poolAddress));
        const updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.veNFTamountStaked).toBe(1000n);
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should update user stats per pool with voting data", async () => {
        const userStatsId = UserStatsPerPoolId(
          chainId,
          ownerAddress,
          poolAddress,
        );
        const rawStats = await indexer.UserStatsPerPool.get(userStatsId);
        const updatedUserStats = rawStats
          ? rehydrateTimestamps("UserStatsPerPool", rawStats)
          : undefined;
        expect(updatedUserStats).toBeDefined();
        expect(updatedUserStats?.veNFTamountStaked).toBe(100n);
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should attribute votes to tokenId owner, not voter", async () => {
        const voterStatsId = UserStatsPerPoolId(
          chainId,
          voterAddress,
          poolAddress,
        );
        const voterStats = await indexer.UserStatsPerPool.get(voterStatsId);
        expect(voterStats).toBeUndefined();
      });

      it("should create VeNFTPoolVote entity", async () => {
        const veNFTPoolVoteId = VeNFTPoolVoteId(chainId, tokenId, poolAddress);
        const rawVote = await indexer.VeNFTPoolVote.get(veNFTPoolVoteId);
        const veNFTPoolVote = rawVote
          ? rehydrateTimestamps("VeNFTPoolVote", rawVote)
          : undefined;
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
        const { createMockPool, mockToken0Data, mockToken1Data } =
          setupCommon();
        const poolWithZeroStaked = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId,
          poolAddress,
          veNFTamountStaked: 0n,
        });
        const db = createTestIndexer();
        db.Pool.set(poolWithZeroStaked);
        db.Token.set(mockToken0Data);
        db.Token.set(mockToken1Data);

        await db.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        const pool = await db.Pool.get(PoolId(chainId, poolAddress));
        expect(pool?.veNFTamountStaked).toBe(0n);
        expect(Array.from(await db.UserStatsPerPool.getAll())).toHaveLength(0);
        expect(Array.from(await db.VeNFTPoolVote.getAll())).toHaveLength(0);
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        // Should not create Pool entity
        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
        expect(
          Array.from(await indexer.UserStatsPerPool.getAll()),
        ).toHaveLength(0);
        expect(Array.from(await indexer.VeNFTPoolVote.getAll())).toHaveLength(
          0,
        );
      });
    });

    // A superchain root pool on Optimism: its vote goes to the RootPool and the
    // veNFT's RootPoolVote only, never onto the leaf pool, a leaf user or a
    // leaf-keyed VeNFTPoolVote (ADR 0009, flow A).
    describe("when pool is a superchain root pool", () => {
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
      const rootChainId = 10 as const;
      const leafChainId = 252; // Fraxtal
      let mockLeafPool: MockPool;
      let mockLeafUserStats: MockUserStatsPerPool;

      beforeEach(async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockPool,
          createMockVeNFTState,
        } = setupCommon();

        // The leaf side as the leaf chain writes it: the pool, its user and
        // its own RootPool_LeafPool row.
        mockLeafPool = createMockPool({
          id: PoolId(leafChainId, leafPoolAddress),
          chainId: leafChainId,
          poolAddress: leafPoolAddress,
          token0_id: TokenId(leafChainId, mockToken0Data.address),
          token1_id: TokenId(leafChainId, mockToken1Data.address),
          veNFTamountStaked: 0n,
        });
        mockLeafUserStats = createMockUserStatsPerPool({
          userAddress: realVoterAddress,
          poolAddress: leafPoolAddress,
          chainId: leafChainId,
          veNFTamountStaked: 0n,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });
        indexer.Pool.set(mockLeafPool);
        indexer.UserStatsPerPool.set(mockLeafUserStats);
        indexer.RootPool_LeafPool.set({
          id: RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
          chainId: leafChainId,
          rootChainId,
          rootPoolAddress,
          leafChainId,
          leafPoolAddress,
        });
        indexer.VeNFTState.set(
          createMockVeNFTState({
            id: VeNFTId(rootChainId, realTokenId),
            chainId: rootChainId,
            tokenId: realTokenId,
            owner: realVoterAddress,
          }),
        );

        await indexer.process({
          chains: {
            [rootChainId]: {
              simulate: [
                rootPoolCreated(rootPoolAddress, leafChainId, {
                  number: 123455,
                  timestamp: realTimestamp - 100,
                }),
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 2,
                  block: {
                    number: 123456,
                    timestamp: realTimestamp,
                    hash: "0xhash",
                  },
                  params: {
                    voter: realVoterAddress,
                    pool: rootPoolAddress,
                    tokenId: realTokenId,
                    weight: realWeight,
                    totalWeight: realTotalWeight,
                  },
                },
              ],
            },
          },
        });
      });

      it("sets the RootPool's veNFTamountStaked to totalWeight", async () => {
        const rootPool = await indexer.RootPool.get(
          RootPoolId(rootChainId, rootPoolAddress),
        );
        expect(rootPool?.veNFTamountStaked).toBe(realTotalWeight);
        expect(rootPool?.lastUpdatedTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("records the veNFT's vote in RootPoolVote, keyed by the root pool", async () => {
        const vote = await indexer.RootPoolVote.get(
          RootPoolVoteId(rootChainId, realTokenId, rootPoolAddress),
        );
        expect(vote).toMatchObject({
          id: `${rootChainId}-${realTokenId}-${rootPoolAddress}`,
          rootPoolAddress,
          tokenId: realTokenId,
          veNFTStateId: VeNFTId(rootChainId, realTokenId),
          veNFTamountStaked: realWeight,
          lastUpdatedTimestamp: new Date(realTimestamp * 1000),
        });
      });

      it("touches no leaf Pool, user or VeNFTPoolVote", async () => {
        // By design (ADR 0009): the leaf pool's and leaf user's vote fields
        // stay at 0; the numbers are on the RootPool / RootPoolVote.
        expect(
          await indexer.Pool.get(PoolId(leafChainId, leafPoolAddress)),
        ).toEqual(mockLeafPool);
        expect(await indexer.UserStatsPerPool.getAll()).toEqual([
          mockLeafUserStats,
        ]);
        expect(await indexer.VeNFTPoolVote.getAll()).toEqual([]);
      });
    });

    describe("when pool is neither a local pool nor a RootPool (a sink root pool, issue #601)", () => {
      // Known sink on Optimism: a placeholder root pool with no real leaf pool.
      const sinkRootPoolAddress = toChecksumAddress(
        "0x333030A736B47D20346d82A473680658ac1C2b88",
      );

      it("ignores Voted and Abstained", async () => {
        const { createMockVeNFTState } = setupCommon();
        indexer.VeNFTState.set(
          createMockVeNFTState({
            id: VeNFTId(chainId, tokenId),
            chainId,
            tokenId,
            owner: ownerAddress,
          }),
        );

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: (["Voted", "Abstained"] as const).map((event, i) => ({
                contract: "Voter" as const,
                event,
                logIndex: i + 1,
                block: {
                  number: 123456,
                  timestamp: 1000000,
                  hash: "0xsinkhash",
                },
                params: {
                  voter: voterAddress,
                  pool: sinkRootPoolAddress,
                  tokenId,
                  weight: 100n,
                  totalWeight: 1000n,
                },
              })),
            },
          },
        });

        expect(await indexer.Pool.getAll()).toEqual([]);
        expect(await indexer.UserStatsPerPool.getAll()).toEqual([]);
        expect(await indexer.VeNFTPoolVote.getAll()).toEqual([]);
        expect(await indexer.RootPool.getAll()).toEqual([]);
        expect(await indexer.RootPoolVote.getAll()).toEqual([]);
      });
    });

    describe("Voted processed before RootPoolCreated (sync order edge case)", () => {
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );

      it("does not record the vote (nothing is kept pending); the RootPool starts at 0", async () => {
        const { createMockVeNFTState } = setupCommon();
        indexer.VeNFTState.set(
          createMockVeNFTState({
            id: VeNFTId(chainId, tokenId),
            chainId,
            tokenId,
            owner: ownerAddress,
          }),
        );
        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
                rootPoolCreated(
                  rootPoolAddress,
                  252,
                  { number: 123457, timestamp: 1000001 },
                  2,
                ),
              ],
            },
          },
        });

        const rootPool = await indexer.RootPool.get(
          RootPoolId(chainId, rootPoolAddress),
        );
        expect(rootPool?.veNFTamountStaked).toBe(0n);
        expect(await indexer.RootPoolVote.getAll()).toEqual([]);
        expect(await indexer.RootPool_LeafPool.getAll()).toEqual([]);
      });
    });

    describe("when multiple tokenIds share the same owner", () => {
      it("should aggregate votes at the user level", async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockPool,
          createMockVeNFTState,
        } = setupCommon();

        const owner = toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        );

        const liquidityPool = createMockPool({
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

        const db = createTestIndexer();
        db.Pool.set(liquidityPool);
        db.UserStatsPerPool.set(userStats);
        db.Token.set(mockToken0Data);
        db.Token.set(mockToken1Data);
        db.VeNFTState.set(veNFT1);
        db.VeNFTState.set(veNFT2);

        await db.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: 1n,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 2,
                  block: {
                    number: 123457,
                    timestamp: 1000001,
                    hash: "0xhash2",
                  },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: 2n,
                    weight: 200n,
                    totalWeight: 1100n,
                  },
                },
              ],
            },
          },
        });

        const updatedUserStats = await db.UserStatsPerPool.get(
          UserStatsPerPoolId(chainId, owner, poolAddress),
        );
        expect(updatedUserStats).toBeDefined();
        expect(updatedUserStats?.veNFTamountStaked).toBe(300n);
      });
    });
  });

  describe("Abstained Event", () => {
    let indexer: ReturnType<typeof createTestIndexer>;
    const chainId = 10 as const;
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
      indexer = createTestIndexer();
    });

    describe("when pool data exists", () => {
      let mockLiquidityPool: MockPool;
      let mockUserStats: MockUserStatsPerPool;
      let mockVeNFTState: WithChain<VeNFTState>;
      let mockVeNFTPoolVote: WithChain<VeNFTPoolVote>;

      beforeEach(async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockPool,
          createMockUserStatsPerPool,
          createMockVeNFTState,
          createMockVeNFTPoolVote,
        } = setupCommon();

        mockLiquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          poolAddress: poolAddress,
          veNFTamountStaked: 2000n, // Initial staked amount
        });

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
        indexer.Pool.set(mockLiquidityPool);
        indexer.UserStatsPerPool.set(mockUserStats);
        indexer.Token.set(mockToken0Data);
        indexer.Token.set(mockToken1Data);
        indexer.VeNFTState.set(mockVeNFTState);
        indexer.VeNFTPoolVote.set(mockVeNFTPoolVote);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });
      });

      it("should update liquidity pool aggregator with total weight (absolute value)", async () => {
        const raw = await indexer.Pool.get(PoolId(chainId, poolAddress));
        const updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
        expect(updatedPool).toBeDefined();
        // totalWeight is the absolute total veNFT staked in pool, replacing previous value
        expect(updatedPool?.veNFTamountStaked).toBe(1000n); // event.params.totalWeight
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should decrease user stats veNFT amount staked (negative weight)", async () => {
        const userStatsId = UserStatsPerPoolId(
          chainId,
          ownerAddress,
          poolAddress,
        );
        const rawStats = await indexer.UserStatsPerPool.get(userStatsId);
        const updatedUserStats = rawStats
          ? rehydrateTimestamps("UserStatsPerPool", rawStats)
          : undefined;
        expect(updatedUserStats).toBeDefined();
        // weight is subtracted (negative because it's a withdrawal)
        expect(updatedUserStats?.veNFTamountStaked).toBe(100n); // 200n - 100n
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(1000000 * 1000),
        );
      });

      it("should decrement tokenId pool votes", async () => {
        const veNFTPoolVoteId = VeNFTPoolVoteId(chainId, tokenId, poolAddress);
        const veNFTPoolVote = await indexer.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(100n); // 200n - 100n
      });
    });

    describe("when pool data exists but VeNFTState is missing", () => {
      it("should return early without updating pool or creating vote entities", async () => {
        const { createMockPool, mockToken0Data, mockToken1Data } =
          setupCommon();
        const poolWithStaked = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId,
          veNFTamountStaked: 1000n,
        });
        const db = createTestIndexer();
        db.Pool.set(poolWithStaked);
        db.Token.set(mockToken0Data);
        db.Token.set(mockToken1Data);

        await db.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        const pool = await db.Pool.get(PoolId(chainId, poolAddress));
        expect(pool?.veNFTamountStaked).toBe(1000n);
        expect(Array.from(await db.UserStatsPerPool.getAll())).toHaveLength(0);
        expect(Array.from(await db.VeNFTPoolVote.getAll())).toHaveLength(0);
      });
    });

    describe("when pool data does not exist", () => {
      it("should return early without creating pool entities", async () => {
        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
                    voter: voterAddress,
                    pool: poolAddress,
                    tokenId: tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        // Should not create Pool entity
        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
        expect(
          Array.from(await indexer.UserStatsPerPool.getAll()),
        ).toHaveLength(0);
        expect(Array.from(await indexer.VeNFTPoolVote.getAll())).toHaveLength(
          0,
        );
      });
    });

    // ADR 0009, flow A: the Abstained of a superchain root pool lowers the
    // RootPool / RootPoolVote; the leaf pool and its users are left alone.
    describe("when pool is a superchain root pool", () => {
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
      const rootChainId = 10 as const;
      const leafChainId = 252; // Fraxtal
      const initialUserStaked = 50000000000000000000000n; // a leaf user's pre-flip stake
      let mockLeafPool: MockPool;
      let mockLeafUserStats: MockUserStatsPerPool;

      beforeEach(async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockPool,
        } = setupCommon();

        mockLeafPool = createMockPool({
          id: PoolId(leafChainId, leafPoolAddress),
          chainId: leafChainId,
          poolAddress: leafPoolAddress,
          token0_id: TokenId(leafChainId, mockToken0Data.address),
          token1_id: TokenId(leafChainId, mockToken1Data.address),
          veNFTamountStaked: 3000000000000000000000000n,
        });
        mockLeafUserStats = createMockUserStatsPerPool({
          userAddress: realVoterAddress,
          poolAddress: leafPoolAddress,
          chainId: leafChainId,
          veNFTamountStaked: initialUserStaked,
          firstActivityTimestamp: new Date(0),
          lastActivityTimestamp: new Date(0),
        });
        indexer.Pool.set(mockLeafPool);
        indexer.UserStatsPerPool.set(mockLeafUserStats);
        indexer.RootPool_LeafPool.set({
          id: RootPoolLeafPoolId(
            rootChainId,
            leafChainId,
            rootPoolAddress,
            leafPoolAddress,
          ),
          chainId: leafChainId,
          rootChainId,
          rootPoolAddress,
          leafChainId,
          leafPoolAddress,
        });

        // No VeNFTState: the root-pool path does not need one.
        await indexer.process({
          chains: {
            [rootChainId]: {
              simulate: [
                rootPoolCreated(rootPoolAddress, leafChainId, {
                  number: 123454,
                  timestamp: realTimestamp - 100,
                }),
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 2,
                  block: {
                    number: 123455,
                    timestamp: realTimestamp - 50,
                    hash: "0xhash0",
                  },
                  params: {
                    voter: realVoterAddress,
                    pool: rootPoolAddress,
                    tokenId: realTokenId,
                    weight: realWeight,
                    totalWeight: realTotalWeight + realWeight,
                  },
                },
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 3,
                  block: {
                    number: 123456,
                    timestamp: realTimestamp,
                    hash: "0xhash",
                  },
                  params: {
                    voter: realVoterAddress,
                    pool: rootPoolAddress,
                    tokenId: realTokenId,
                    weight: realWeight,
                    totalWeight: realTotalWeight,
                  },
                },
              ],
            },
          },
        });
      });

      it("sets the RootPool's weight to totalWeight and returns the veNFT's RootPoolVote to zero", async () => {
        const rootPool = await indexer.RootPool.get(
          RootPoolId(rootChainId, rootPoolAddress),
        );
        expect(rootPool?.veNFTamountStaked).toBe(realTotalWeight);
        expect(rootPool?.lastUpdatedTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
        const vote = await indexer.RootPoolVote.get(
          RootPoolVoteId(rootChainId, realTokenId, rootPoolAddress),
        );
        expect(vote?.veNFTamountStaked).toBe(0n);
        expect(vote?.lastUpdatedTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("leaves the leaf pool and the leaf user as they were and writes no VeNFTPoolVote or root-keyed user", async () => {
        expect(
          await indexer.Pool.get(PoolId(leafChainId, leafPoolAddress)),
        ).toEqual(mockLeafPool);
        expect(await indexer.UserStatsPerPool.getAll()).toEqual([
          mockLeafUserStats,
        ]);
        expect(await indexer.VeNFTPoolVote.getAll()).toEqual([]);
        expect(
          await indexer.UserStatsPerPool.get(
            UserStatsPerPoolId(rootChainId, realVoterAddress, rootPoolAddress),
          ),
        ).toBeUndefined();
      });
    });
  });

  // A veNFT that voted for a root pool changes hands, then abstains: the vote
  // stays on the tokenId's RootPoolVote and no user row is written for either
  // owner (before the flip both owners' leaf UserStatsPerPool rows moved).
  describe("root pool vote, veNFT transfer, then abstain", () => {
    it("keeps the vote on the tokenId's RootPoolVote and writes no user row", async () => {
      const { createMockVeNFTState } = setupCommon();

      const rootChainId = 10 as const;
      const leafChainId = 252;
      const tokenId = 4911n;
      const voteWeight = 126886024262337895334200n;
      const rootPoolAddress = toChecksumAddress(
        "0xf1D64ffc40Dc0050584dEf9496c0f7C463ec93Bf",
      );
      const oldOwner = toChecksumAddress(
        "0xdaA12ca83de2FaB833fC28CE1300Ba6ddEe67204",
      );
      const newOwner = toChecksumAddress(
        "0x28ba242755de3034ac4bd63261e3579bDb37D599",
      );
      const voteId = RootPoolVoteId(rootChainId, tokenId, rootPoolAddress);

      const indexer = createTestIndexer();
      indexer.VeNFTState.set(
        createMockVeNFTState({
          id: VeNFTId(rootChainId, tokenId),
          chainId: rootChainId,
          tokenId,
          owner: oldOwner,
        }),
      );

      await indexer.process({
        chains: {
          [rootChainId]: {
            simulate: [
              rootPoolCreated(rootPoolAddress, leafChainId, {
                number: 129471000,
                timestamp: 1734540777,
              }),
              {
                contract: "Voter",
                event: "Voted",
                logIndex: 123,
                block: {
                  number: 129471197,
                  timestamp: 1734541171,
                  hash: "0xvote",
                },
                params: {
                  voter: oldOwner,
                  pool: rootPoolAddress,
                  tokenId,
                  weight: voteWeight,
                  totalWeight: voteWeight,
                },
              },
              {
                contract: "VeNFT",
                event: "Transfer",
                logIndex: 8,
                srcAddress: toChecksumAddress(
                  "0xFAf8FD17D9840595845582fCB047DF13f006787d",
                ),
                block: {
                  number: 129598042,
                  timestamp: 1734794861,
                  hash: "0xtransfer",
                },
                params: {
                  from: oldOwner,
                  to: newOwner,
                  tokenId,
                },
              },
            ],
          },
        },
      });

      expect(
        (await indexer.VeNFTState.get(VeNFTId(rootChainId, tokenId)))?.owner,
      ).toBe(newOwner);
      expect((await indexer.RootPoolVote.get(voteId))?.veNFTamountStaked).toBe(
        voteWeight,
      );
      expect(await indexer.UserStatsPerPool.getAll()).toEqual([]);

      await indexer.process({
        chains: {
          [rootChainId]: {
            simulate: [
              {
                contract: "Voter",
                event: "Abstained",
                logIndex: 24,
                block: {
                  number: 129598518,
                  timestamp: 1734795813,
                  hash: "0xabstain",
                },
                params: {
                  voter: newOwner,
                  pool: rootPoolAddress,
                  tokenId,
                  weight: voteWeight,
                  totalWeight: 0n,
                },
              },
            ],
          },
        },
      });

      expect((await indexer.RootPoolVote.get(voteId))?.veNFTamountStaked).toBe(
        0n,
      );
      expect(
        (await indexer.RootPool.get(RootPoolId(rootChainId, rootPoolAddress)))
          ?.veNFTamountStaked,
      ).toBe(0n);
      expect(await indexer.UserStatsPerPool.getAll()).toEqual([]);
      expect(await indexer.VeNFTPoolVote.getAll()).toEqual([]);
    });
  });

  describe("GaugeCreated Event", () => {
    let indexer: ReturnType<typeof createTestIndexer>;
    const chainId = 10 as const;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );
    const gaugeCreatedParams = {
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
      creator: toChecksumAddress("0x7777777777777777777777777777777777777777"),
    };

    beforeEach(() => {
      indexer = createTestIndexer();
    });

    describe("when pool entity exists", () => {
      let mockLiquidityPool: MockPool;

      beforeEach(async () => {
        const { createMockPool } = setupCommon();

        mockLiquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        });

        indexer.Pool.set(mockLiquidityPool);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "GaugeCreated",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: gaugeCreatedParams,
                },
              ],
            },
          },
        });
      });

      it("should update pool entity with gauge address and voting reward addresses", async () => {
        const raw = await indexer.Pool.get(PoolId(chainId, poolAddress));
        const updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
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
      it("should create RootGauge_RootPool for the root gauge's DistributeReward", async () => {
        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "GaugeCreated",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: gaugeCreatedParams,
                },
              ],
            },
          },
        });

        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);

        const expectedId = RootGaugeRootPoolId(chainId, gaugeAddress);
        const rootGaugeRootPool =
          await indexer.RootGauge_RootPool.get(expectedId);
        expect(rootGaugeRootPool).toBeDefined();
        expect(rootGaugeRootPool?.rootChainId).toBe(chainId);
        expect(rootGaugeRootPool?.rootGaugeAddress).toBe(gaugeAddress);
        expect(rootGaugeRootPool?.rootPoolAddress).toBe(poolAddress);
      });
    });

    describe("when pool factory is CL factory", () => {
      let mockLiquidityPool: MockPool;

      beforeEach(async () => {
        const { createMockPool } = setupCommon();

        mockLiquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: "", // Initially empty
        });

        indexer.Pool.set(mockLiquidityPool);

        // Create event with CL factory address (from CLPOOLS_FACTORY_LIST)
        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "GaugeCreated",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: {
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
                  },
                },
              ],
            },
          },
        });
      });

      it("should update pool entity with gauge address (CL factory path)", async () => {
        const updatedPool = await indexer.Pool.get(
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
    let indexer: ReturnType<typeof createTestIndexer>;
    const chainId = 10 as const;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      indexer = createTestIndexer();
    });

    describe("when pool entity exists", () => {
      let mockLiquidityPool: MockPool;
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      beforeEach(async () => {
        const { createMockPool } = setupCommon();

        mockLiquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Initially has gauge address
          gaugeIsAlive: true, // Initially alive
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
          mockLiquidityPool,
        );

        indexer.Pool.set(mockLiquidityPool);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "GaugeKilled",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: { gauge: gaugeAddress },
                },
              ],
            },
          },
        });
      });

      it("should set gaugeIsAlive to false but preserve gauge address and voting reward addresses as historical data", async () => {
        const raw = await indexer.Pool.get(PoolId(chainId, poolAddress));
        const updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
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
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(null);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "GaugeKilled",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: { gauge: gaugeAddress },
                },
              ],
            },
          },
        });

        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
      });
    });
  });

  describe("GaugeRevived Event", () => {
    let indexer: ReturnType<typeof createTestIndexer>;
    const chainId = 10 as const;
    const poolAddress = toChecksumAddress(
      "0x478946BcD4a5a22b316470F5486fAfb928C0bA25",
    );
    const gaugeAddress = toChecksumAddress(
      "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
    );

    beforeEach(() => {
      indexer = createTestIndexer();
    });

    describe("when pool entity exists", () => {
      let mockLiquidityPool: MockPool;
      const feeVotingRewardAddress = toChecksumAddress(
        "0x6572b2b30f63B960608f3aA5205711C558998398",
      );
      const bribeVotingRewardAddress = toChecksumAddress(
        "0xc9eEBCD281d9A4c0839Eb643216caa80a68b88B1",
      );

      beforeEach(async () => {
        const { createMockPool } = setupCommon();

        mockLiquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress: gaugeAddress, // Has gauge address
          gaugeIsAlive: false, // Initially killed
          feeVotingRewardAddress: feeVotingRewardAddress, // Has voting reward addresses
          bribeVotingRewardAddress: bribeVotingRewardAddress,
        });

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
          mockLiquidityPool,
        );

        indexer.Pool.set(mockLiquidityPool);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "GaugeRevived",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: { gauge: gaugeAddress },
                },
              ],
            },
          },
        });
      });

      it("should set gaugeIsAlive to true", async () => {
        const raw = await indexer.Pool.get(PoolId(chainId, poolAddress));
        const updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
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
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(null);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "GaugeRevived",
                  logIndex: 1,
                  block: { number: 123456, timestamp: 1000000, hash: "0xhash" },
                  params: { gauge: gaugeAddress },
                },
              ],
            },
          },
        });

        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
      });
    });
  });

  describe("WhitelistToken event", () => {
    // Real WETH on Optimism — has on-chain bytecode, so the #677
    // hasContractBytecode gate doesn't short-circuit Token creation.
    const tokenAddress = toChecksumAddress(
      "0x4200000000000000000000000000000000000006",
    );
    const wlChainId = 10 as const;
    const wlBlockTimestamp = 1000000;
    const wlWhitelistParams = {
      whitelister: toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      ),
      token: tokenAddress,
      _bool: true,
    };
    const wlBlock = {
      number: 123456,
      timestamp: wlBlockTimestamp,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };

    describe("if token is in the db", () => {
      const expectedPricePerUSDNew = BigInt(10000000);

      async function setupInDbIndexer() {
        const token = {
          id: TokenId(10, tokenAddress),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: expectedPricePerUSDNew,
          isWhitelisted: false,
          lastUpdatedTimestamp: new Date(0),
        };
        const idx = createTestIndexer();
        idx.Token.set(token as WithChain<Token>);
        await idx.process({
          chains: {
            [wlChainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "WhitelistToken",
                  logIndex: 1,
                  block: wlBlock,
                  params: wlWhitelistParams,
                },
              ],
            },
          },
        });
        return idx;
      }

      it("should update the token entity", async () => {
        const idx = await setupInDbIndexer();
        const raw = await idx.Token.get(TokenId(10, tokenAddress));
        const token = raw ? rehydrateTimestamps("Token", raw) : undefined;
        expect(token?.id).toBe(TokenId(10, tokenAddress));
        expect(token?.isWhitelisted).toBe(true);
        expect(token?.pricePerUSDNew).toBe(expectedPricePerUSDNew);
      });

      it("should update lastUpdatedTimestamp when updating existing token", async () => {
        const idx = await setupInDbIndexer();
        const raw = await idx.Token.get(TokenId(10, tokenAddress));
        const token = raw ? rehydrateTimestamps("Token", raw) : undefined;
        expect(token?.lastUpdatedTimestamp).toBeInstanceOf(Date);
        expect(token?.lastUpdatedTimestamp?.getTime()).toBe(
          wlBlockTimestamp * 1000,
        );
      });
    });
    describe("priceTrust recomputation on existing tokens (issue #761)", () => {
      it("flips UNTRUSTED/NON_WL to TRUSTED/WL when WhitelistToken(true) lands", async () => {
        const existing = {
          id: TokenId(10, tokenAddress),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: BigInt(10000000),
          isWhitelisted: false,
          lastUpdatedTimestamp: new Date(0),
          priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
          priceTrustReason: PRICE_TRUST_REASON.NON_WL,
        } as WithChain<Token>;
        const db = createTestIndexer();
        db.Token.set(existing);

        await db.process({
          chains: {
            [wlChainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "WhitelistToken",
                  logIndex: 1,
                  block: wlBlock,
                  params: wlWhitelistParams,
                },
              ],
            },
          },
        });
        const token = await db.Token.get(TokenId(10, tokenAddress));

        expect(token?.isWhitelisted).toBe(true);
        expect(token?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.TRUSTED);
        expect(token?.priceTrustReason).toBe(PRICE_TRUST_REASON.WL);
      });

      it("flips TRUSTED/WL to UNTRUSTED/NON_WL when WhitelistToken(false) lands", async () => {
        // SNX on Optimism: real on-chain bytecode but NOT a price connector, so
        // de-whitelisting fully untrusts it. (WETH — the block's shared
        // tokenAddress — would stay TRUSTED/CONNECTOR under #898; covered next.)
        const nonConnectorToken = toChecksumAddress(
          "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4",
        );
        const existing = {
          id: TokenId(10, nonConnectorToken),
          address: nonConnectorToken,
          symbol: "TEST",
          name: "TEST",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: BigInt(10000000),
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(0),
          priceTrustOutcome: PRICE_TRUST_OUTCOME.TRUSTED,
          priceTrustReason: PRICE_TRUST_REASON.WL,
        } as WithChain<Token>;
        const db = createTestIndexer();
        db.Token.set(existing);

        await db.process({
          chains: {
            [wlChainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "WhitelistToken",
                  logIndex: 1,
                  block: wlBlock,
                  params: {
                    whitelister: toChecksumAddress(
                      "0x1111111111111111111111111111111111111111",
                    ),
                    token: nonConnectorToken,
                    _bool: false,
                  },
                },
              ],
            },
          },
        });
        const token = await db.Token.get(TokenId(10, nonConnectorToken));

        expect(token?.isWhitelisted).toBe(false);
        expect(token?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.UNTRUSTED);
        expect(token?.priceTrustReason).toBe(PRICE_TRUST_REASON.NON_WL);
      });

      it("keeps a connector TRUSTED/CONNECTOR when WhitelistToken(false) lands (#898)", async () => {
        // WETH is a configured price connector on Optimism, so de-whitelisting
        // it does NOT untrust it — connector membership is an independent trust
        // signal. isWhitelisted still flips to false.
        const existing = {
          id: TokenId(10, tokenAddress),
          address: tokenAddress,
          symbol: "TEST",
          name: "TEST",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: BigInt(10000000),
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(0),
          priceTrustOutcome: PRICE_TRUST_OUTCOME.TRUSTED,
          priceTrustReason: PRICE_TRUST_REASON.WL,
        } as WithChain<Token>;
        const db = createTestIndexer();
        db.Token.set(existing);

        await db.process({
          chains: {
            [wlChainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "WhitelistToken",
                  logIndex: 1,
                  block: wlBlock,
                  params: {
                    whitelister: toChecksumAddress(
                      "0x1111111111111111111111111111111111111111",
                    ),
                    token: tokenAddress,
                    _bool: false,
                  },
                },
              ],
            },
          },
        });
        const token = await db.Token.get(TokenId(10, tokenAddress));

        expect(token?.isWhitelisted).toBe(false);
        expect(token?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.TRUSTED);
        expect(token?.priceTrustReason).toBe(PRICE_TRUST_REASON.CONNECTOR);
      });

      it("flags an existing blacklisted token UNTRUSTED/BLACKLISTED on WhitelistToken(true)", async () => {
        // $Manatee on Optimism — present in src/PriceOverrides.ts BLACKLIST
        const blacklistedAddress = toChecksumAddress(
          "0x7909Bda52eAf7C3cc12745E727Eb527a485241D8",
        );
        const existing = {
          id: TokenId(10, blacklistedAddress),
          address: blacklistedAddress,
          symbol: "MANATEE",
          name: "MANATEE",
          chainId: 10,
          decimals: BigInt(18),
          pricePerUSDNew: 0n,
          isWhitelisted: false,
          lastUpdatedTimestamp: new Date(0),
          priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
          priceTrustReason: PRICE_TRUST_REASON.NON_WL,
        } as WithChain<Token>;
        const db = createTestIndexer();
        db.Token.set(existing);

        await db.process({
          chains: {
            [wlChainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "WhitelistToken",
                  logIndex: 1,
                  block: wlBlock,
                  params: {
                    whitelister: toChecksumAddress(
                      "0x1111111111111111111111111111111111111111",
                    ),
                    token: blacklistedAddress,
                    _bool: true,
                  },
                },
              ],
            },
          },
        });
        const token = await db.Token.get(TokenId(10, blacklistedAddress));

        expect(token?.isWhitelisted).toBe(true);
        expect(token?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.UNTRUSTED);
        expect(token?.priceTrustReason).toBe(PRICE_TRUST_REASON.BLACKLISTED);
      });
    });
  });

  describe("DistributeReward Event", () => {
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
    const chainId = 10 as const;
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
    const distributeBlock = {
      number: blockNumber,
      timestamp: 1000000,
      hash: "0xblockhash",
    };
    const distributeSimulate = {
      contract: "Voter" as const,
      event: "DistributeReward" as const,
      logIndex: 0,
      srcAddress: voterAddress,
      block: distributeBlock,
      params: { gauge: gaugeAddress, amount: 1000n * 10n ** 18n },
    };

    const rewardTokenAddress =
      getLegacyConstants(chainId).rewardToken(blockNumber);

    describe("when reward token and liquidity pool exist", () => {
      let indexer: ReturnType<typeof createTestIndexer>;
      let cleanup: () => void;

      const { createMockPool } = setupCommon();

      beforeEach(async () => {
        const liquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          gaugeAddress,
          totalEmissions: 400n * 10n ** 18n,
          totalEmissionsUSD: 0n,
          totalEmissionsRedistributed: 0n,
          totalEmissionsForfeited: 0n,
          totalGaugeRewardsClaimed: 300n * 10n ** 18n,
          totalGaugeEarlyWithdrawPenalties: 50n * 10n ** 18n,
          totalVotesDeposited: 0n,
          totalVotesDepositedUSD: 0n,
          gaugeIsAlive: false, // DistributeReward does not set this; we assert it remains unchanged
        });

        const { rewardToken, cleanup: cleanupFn } = setupDistributeRewardMocks(
          chainId,
          rewardTokenAddress,
        );
        cleanup = cleanupFn;

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
          liquidityPool,
        );

        indexer = createTestIndexer();
        indexer.Token.set(rewardToken);
        indexer.Pool.set(liquidityPool);

        await indexer.process({
          chains: {
            [chainId]: { simulate: [distributeSimulate] },
          },
        });
      });

      afterEach(() => {
        cleanup();
      });

      it("should not modify gaugeIsAlive (preserves existing value) when false", async () => {
        const updatedPool = await indexer.Pool.get(poolId);
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.gaugeIsAlive).toBe(false);
      });

      it("writes the gauge's event-derived reward-token balance to totalVotesDeposited, without RPC", async () => {
        const updatedPool = await indexer.Pool.get(poolId);
        // 400 emitted before + 1000 now - 300 claimed - 50 penalties = 1050 VELO
        expect(updatedPool?.totalEmissions).toBe(1400n * 10n ** 18n);
        expect(updatedPool?.totalVotesDeposited).toBe(1050n * 10n ** 18n);
        // at $2
        expect(updatedPool?.totalVotesDepositedUSD).toBe(2100n * 10n ** 18n);
      });

      describe("when pool has gaugeIsAlive true", () => {
        let aliveIndexer: ReturnType<typeof createTestIndexer>;
        let originalChainConstantsAlive: (typeof CHAIN_CONSTANTS)[typeof chainId];

        beforeEach(async () => {
          const liquidityPool = createMockPool({
            id: PoolId(chainId, poolAddress),
            chainId: chainId,
            totalEmissions: 0n,
            totalEmissionsUSD: 0n,
            totalVotesDeposited: 0n,
            totalVotesDepositedUSD: 0n,
            gaugeIsAlive: true,
          });

          const rewardToken: WithChain<Token> = {
            id: TokenId(chainId, rewardTokenAddress),
            address: rewardTokenAddress,
            symbol: "VELO",
            name: "VELO",
            chainId: chainId,
            decimals: 18n,
            pricePerUSDNew: 2n * 10n ** 18n,
            isWhitelisted: true,
            lastUpdatedTimestamp: new Date(1000000 * 1000),
          } as WithChain<Token>;

          vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
            liquidityPool,
          );

          originalChainConstantsAlive = CHAIN_CONSTANTS[chainId];
          CHAIN_CONSTANTS[chainId] = withLegacyRewardToken(
            originalChainConstantsAlive,
            vi.fn().mockReturnValue(rewardTokenAddress),
          );

          aliveIndexer = createTestIndexer();
          aliveIndexer.Token.set(rewardToken);
          aliveIndexer.Pool.set(liquidityPool);
          await aliveIndexer.process({
            chains: {
              [chainId]: { simulate: [distributeSimulate] },
            },
          });
        });

        afterEach(() => {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsAlive;
        });

        it("should not modify gaugeIsAlive (preserves existing value) when true", async () => {
          const updatedPool = await aliveIndexer.Pool.get(poolId);
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
        CHAIN_CONSTANTS[chainId] = withLegacyRewardToken(
          originalChainConstantsForPoolTest,
          vi.fn().mockReturnValue(rewardTokenAddress),
        );

        // Mock findPoolByGaugeAddress to return null (root gauge, no local pool)
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(null);

        const db = createTestIndexer();
        await db.process({
          chains: {
            [chainId]: { simulate: [distributeSimulate] },
          },
        });

        // Should not create any pool entities when pool doesn't exist and no root-gauge mapping
        expect(Array.from(await db.Pool.getAll())).toHaveLength(0);
      });

      afterEach(() => {
        // Restore original CHAIN_CONSTANTS to prevent test pollution
        if (originalChainConstantsForPoolTest !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsForPoolTest;
        }
      });
    });

    // A root gauge (no local Pool has it): the distribution goes to its
    // RootPool through RootGauge_RootPool, never to a leaf pool (ADR 0009,
    // flow B). No RootPool_LeafPool is read.
    describe("when the gauge is a root gauge (superchain root pool)", () => {
      const rootPoolAddress = poolAddress;
      const leafChainId = 252;
      const blockTimestamp = 1000000;
      const blockNumberForRoot = 128357870;
      const txHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";
      let originalChainConstantsRoot: (typeof CHAIN_CONSTANTS)[typeof chainId];

      afterEach(() => {
        if (originalChainConstantsRoot !== undefined) {
          CHAIN_CONSTANTS[chainId] = originalChainConstantsRoot;
        }
      });

      it("adds the distribution to the RootPool when processing RootPoolCreated, GaugeCreated, DistributeReward, and writes no Pool", async () => {
        originalChainConstantsRoot = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = withLegacyRewardToken(
          originalChainConstantsRoot,
          vi.fn().mockReturnValue(rewardTokenAddress),
        );

        const db = createTestIndexer();
        db.Token.set(
          createRewardToken(chainId, rewardTokenAddress, {
            timestampSeconds: blockTimestamp,
            // Priced at this hour: the refresh at the event keeps $2.
            lastSuccessfulPriceTimestamp: new Date(blockTimestamp * 1000),
          }),
        );
        // A leaf mapping for this root pool must not matter on the root side.
        db.RootPool_LeafPool.set({
          id: RootPoolLeafPoolId(
            chainId,
            leafChainId,
            rootPoolAddress,
            toChecksumAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
          ),
          chainId: leafChainId,
          rootChainId: chainId,
          rootPoolAddress,
          leafChainId,
          leafPoolAddress: toChecksumAddress(
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ),
        });

        await db.process({
          chains: {
            [chainId]: {
              simulate: [
                rootPoolCreated(rootPoolAddress, leafChainId, {
                  number: blockNumberForRoot,
                  timestamp: blockTimestamp,
                }),
                {
                  contract: "Voter",
                  event: "GaugeCreated",
                  logIndex: 2,
                  block: {
                    number: blockNumberForRoot,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
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
                  },
                },
                {
                  contract: "Voter",
                  event: "DistributeReward",
                  logIndex: 3,
                  srcAddress: voterAddress,
                  block: {
                    number: blockNumberForRoot,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: { gauge: gaugeAddress, amount: 1000n * 10n ** 18n },
                },
              ],
            },
          },
        });

        expect(
          await db.RootGauge_RootPool.get(
            RootGaugeRootPoolId(chainId, gaugeAddress),
          ),
        ).toMatchObject({ rootGaugeAddress: gaugeAddress, rootPoolAddress });

        const rootPool = await db.RootPool.get(
          RootPoolId(chainId, rootPoolAddress),
        );
        expect(rootPool).toMatchObject({
          gaugeAddress,
          gaugeIsAlive: true,
          totalEmissions: 1000n * 10n ** 18n,
          totalEmissionsUSD: 2000n * 10n ** 18n, // at $2
          numberOfDistributions: 1n,
          lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
        });

        expect(await db.Pool.getAll()).toEqual([]);
      });
    });

    describe("when rootPoolAddress is a known sink (issue #601)", () => {
      it("ignores a DistributeReward whose RootGauge_RootPool leads to no RootPool", async () => {
        // A RootGauge_RootPool whose rootPoolAddress is a known sink (OP): a
        // placeholder contract with no RootPoolCreated, so no RootPool row.
        const sinkRootPoolAddress = toChecksumAddress(
          "0x333030A736B47D20346d82A473680658ac1C2b88",
        );

        const db = createTestIndexer();
        db.Token.set(createRewardToken(chainId, rewardTokenAddress));
        db.RootGauge_RootPool.set({
          id: RootGaugeRootPoolId(chainId, gaugeAddress),
          chainId,
          rootChainId: chainId,
          rootGaugeAddress: gaugeAddress,
          rootPoolAddress: sinkRootPoolAddress,
        });

        await db.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "DistributeReward",
                  logIndex: 3,
                  srcAddress: voterAddress,
                  block: {
                    number: 128357870,
                    timestamp: 1000000,
                    hash: "0xblockhash",
                  },
                  params: { gauge: gaugeAddress, amount: 1000n * 10n ** 18n },
                },
              ],
            },
          },
        });

        expect(await db.RootPool.getAll()).toEqual([]);
        expect(await db.Pool.getAll()).toEqual([]);
      });
    });

    describe("when reward token or liquidity pool is missing", () => {
      let originalChainConstantsForRewardTest: (typeof CHAIN_CONSTANTS)[typeof chainId];

      it("should log warning and return early when reward token is missing", async () => {
        const { createMockPool } = setupCommon();
        const liquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          totalEmissions: 0n, // Start with 0 to test that it remains unchanged
        });

        // Mock CHAIN_CONSTANTS rewardToken function
        originalChainConstantsForRewardTest = CHAIN_CONSTANTS[chainId];
        CHAIN_CONSTANTS[chainId] = withLegacyRewardToken(
          originalChainConstantsForRewardTest,
          vi.fn().mockReturnValue(rewardTokenAddress),
        );

        // Mock findPoolByGaugeAddress to return the pool
        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
          liquidityPool,
        );

        // Create a fresh database with only the liquidity pool, no reward token
        const freshDb = createTestIndexer();
        freshDb.Pool.set(liquidityPool);

        await freshDb.process({
          chains: {
            [chainId]: { simulate: [distributeSimulate] },
          },
        });

        // Should not update any entities when reward token is missing
        expect(Array.from(await freshDb.Pool.getAll())).toHaveLength(1);
        const pool = await freshDb.Pool.get(PoolId(chainId, poolAddress));
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
