import type { Token, VeNFTPoolVote, VeNFTState } from "envio";
import { createTestIndexer } from "envio";
import * as PoolModule from "../../../src/Aggregators/Pool";
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
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import {
  PRICE_TRUST_OUTCOME,
  PRICE_TRUST_REASON,
} from "../../../src/PriceTrust";
import { type MockPool, setupCommon } from "../Pool/common";

type MockUserStatsPerPool = ReturnType<
  ReturnType<typeof setupCommon>["createMockUserStatsPerPool"]
>;

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
      let mockVeNFTState: VeNFTState;

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
        indexer.VeNFTState.set(mockVeNFTState);
        indexer.PendingRootPoolMapping.set(makePendingMapping());

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  transaction: { hash: txHash },
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote = await indexer.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.rootPoolAddress).toBe(rootPoolAddress);
        expect(pendingVote?.tokenId).toBe(tokenId);
        expect(pendingVote?.weight).toBe(100n);
        expect(pendingVote?.eventType).toBe("Voted");
        expect(pendingVote?.blockNumber).toBe(BigInt(blockNumber));
        expect(pendingVote?.transactionHash).toBe(txHash);

        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
        expect(
          Array.from(await indexer.UserStatsPerPool.getAll()),
        ).toHaveLength(0);
        expect(Array.from(await indexer.VeNFTPoolVote.getAll())).toHaveLength(
          0,
        );
      });

      it("should create PendingVote for Abstained and not update pool entities", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId),
          chainId,
          tokenId,
          owner: ownerAddress,
        });
        const db2 = createTestIndexer();
        db2.VeNFTState.set(mockVeNFTState);
        db2.PendingRootPoolMapping.set(makePendingMapping());

        await db2.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 1,
                  transaction: { hash: txHash },
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote = await db2.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.eventType).toBe("Abstained");
        expect(pendingVote?.weight).toBe(100n);

        expect(Array.from(await db2.Pool.getAll())).toHaveLength(0);
        expect(Array.from(await db2.UserStatsPerPool.getAll())).toHaveLength(0);
        expect(Array.from(await db2.VeNFTPoolVote.getAll())).toHaveLength(0);
      });

      it("should not create PendingVote for Voted when RootPool_LeafPool mapping is missing and veNFTState is missing", async () => {
        // Deferred path: missing root pool mapping. No VeNFTState in DB -> must not create PendingVote.
        const db3 = createTestIndexer();
        db3.PendingRootPoolMapping.set(makePendingMapping());

        await db3.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  transaction: { hash: txHash },
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote = await db3.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeUndefined();
        expect(Array.from(await db3.PendingVote.getAll())).toHaveLength(0);
        expect(Array.from(await db3.Pool.getAll())).toHaveLength(0);
        expect(Array.from(await db3.UserStatsPerPool.getAll())).toHaveLength(0);
        expect(Array.from(await db3.VeNFTPoolVote.getAll())).toHaveLength(0);
      });

      it("should not create PendingVote for Abstained when RootPool_LeafPool mapping is missing and veNFTState is missing", async () => {
        // Deferred path: missing root pool mapping. No VeNFTState in DB -> must not create PendingVote.
        const db4 = createTestIndexer();
        db4.PendingRootPoolMapping.set(makePendingMapping());

        await db4.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 1,
                  transaction: { hash: txHash },
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
              ],
            },
          },
        });

        const expectedPendingId = PendingVoteId(
          chainId,
          rootPoolAddress,
          tokenId,
          txHash,
          1,
        );
        const pendingVote = await db4.PendingVote.get(expectedPendingId);
        expect(pendingVote).toBeUndefined();
        expect(Array.from(await db4.PendingVote.getAll())).toHaveLength(0);
        expect(Array.from(await db4.Pool.getAll())).toHaveLength(0);
        expect(Array.from(await db4.UserStatsPerPool.getAll())).toHaveLength(0);
        expect(Array.from(await db4.VeNFTPoolVote.getAll())).toHaveLength(0);
      });
    });

    describe("when pool is a known sink root pool (issue #601)", () => {
      // Known sink per src/Constants.ts KNOWN_SINK_ROOT_POOLS (OP). These
      // addresses are placeholder contracts with no real leaf pool, so votes
      // must be silently dropped instead of accumulating orphan PendingVote
      // rows that would never flush.
      const sinkRootPoolAddress = toChecksumAddress(
        "0x333030A736B47D20346d82A473680658ac1C2b88",
      );

      it("drops Voted silently without creating PendingVote", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId),
          chainId,
          tokenId,
          owner: ownerAddress,
        });
        indexer.VeNFTState.set(mockVeNFTState);

        await indexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  transaction: { hash: "0xsinkhash" },
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
                },
              ],
            },
          },
        });

        expect(Array.from(await indexer.PendingVote.getAll())).toHaveLength(0);
        expect(Array.from(await indexer.Pool.getAll())).toHaveLength(0);
      });

      it("drops Abstained silently without creating PendingVote", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId),
          chainId,
          tokenId,
          owner: ownerAddress,
        });
        const sinkIndexer = createTestIndexer();
        sinkIndexer.VeNFTState.set(mockVeNFTState);

        await sinkIndexer.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 1,
                  transaction: { hash: "0xsinkhash" },
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
                },
              ],
            },
          },
        });

        expect(Array.from(await sinkIndexer.PendingVote.getAll())).toHaveLength(
          0,
        );
        expect(Array.from(await sinkIndexer.Pool.getAll())).toHaveLength(0);
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
        const db = createTestIndexer();
        db.VeNFTState.set(mockVeNFTState);

        await db.process({
          chains: {
            [rootChainId as 10]: {
              simulate: [
                {
                  contract: "RootCLPoolFactory",
                  event: "RootPoolCreated",
                  logIndex: 1,
                  block: {
                    timestamp: blockTimestamp,
                    number: blockNumber,
                    hash: txHash,
                  },
                  params: {
                    token0,
                    token1,
                    tickSpacing,
                    chainid: BigInt(leafChainId),
                    pool: rootPoolAddress,
                  },
                },
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 2,
                  transaction: { hash: txHash },
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId: voteTokenId,
                    weight: voteWeight,
                    totalWeight,
                  },
                },
              ],
            },
          },
        });

        const pendingMapping = await db.PendingRootPoolMapping.get(
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
        const pendingVote = await db.PendingVote.get(expectedPendingVoteId);
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.rootPoolAddress).toBe(rootPoolAddress);
        expect(pendingVote?.eventType).toBe("Voted");
        expect(pendingVote?.weight).toBe(voteWeight);

        expect(Array.from(await db.RootPool_LeafPool.getAll())).toHaveLength(0);
        expect(Array.from(await db.Pool.getAll())).toHaveLength(0);
      });

      it("should create PendingRootPoolMapping and PendingVote when RootPoolCreated then Abstained (no leaf pool yet)", async () => {
        const { createMockVeNFTState } = setupCommon();
        const mockVeNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, voteTokenId),
          chainId: rootChainId,
          tokenId: voteTokenId,
          owner: ownerAddress,
        });
        const db = createTestIndexer();
        db.VeNFTState.set(mockVeNFTState);

        await db.process({
          chains: {
            [rootChainId as 10]: {
              simulate: [
                {
                  contract: "RootCLPoolFactory",
                  event: "RootPoolCreated",
                  logIndex: 1,
                  block: {
                    timestamp: blockTimestamp,
                    number: blockNumber,
                    hash: txHash,
                  },
                  params: {
                    token0,
                    token1,
                    tickSpacing,
                    chainid: BigInt(leafChainId),
                    pool: rootPoolAddress,
                  },
                },
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 2,
                  transaction: { hash: txHash },
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId: voteTokenId,
                    weight: voteWeight,
                    totalWeight,
                  },
                },
              ],
            },
          },
        });

        const pendingMapping = await db.PendingRootPoolMapping.get(
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
        const pendingVote = await db.PendingVote.get(expectedPendingVoteId);
        expect(pendingVote).toBeDefined();
        expect(pendingVote?.eventType).toBe("Abstained");

        expect(Array.from(await db.RootPool_LeafPool.getAll())).toHaveLength(0);
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
        const db = createTestIndexer();
        db.VeNFTState.set(mockVeNFTState);

        await db.process({
          chains: {
            [rootChainId as 10]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
                  transaction: { hash: txHash },
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: txHash,
                  },
                  params: {
                    voter: voterAddress,
                    pool: rootPoolAddress,
                    tokenId: voteTokenId,
                    weight: 100n,
                    totalWeight: 1000n,
                  },
                },
                {
                  contract: "RootCLPoolFactory",
                  event: "RootPoolCreated",
                  logIndex: 2,
                  block: {
                    timestamp: blockTimestamp + 1,
                    number: blockNumber + 1,
                    hash: txHash,
                  },
                  params: {
                    token0,
                    token1,
                    tickSpacing,
                    chainid: BigInt(leafChainId),
                    pool: rootPoolAddress,
                  },
                },
              ],
            },
          },
        });

        // create PendingVote whenever mapping is missing; RootPoolCreated then adds PendingRootPoolMapping
        expect(Array.from(await db.PendingVote.getAll())).toHaveLength(1);

        const pendingMapping = await db.PendingRootPoolMapping.get(
          PendingRootPoolMappingId(rootChainId, rootPoolAddress),
        );
        expect(pendingMapping).toBeDefined();
        expect(pendingMapping?.rootPoolAddress).toBe(rootPoolAddress);

        expect(Array.from(await db.RootPool_LeafPool.getAll())).toHaveLength(0);
      });
    });

    describe("when pool is a RootCLPool", () => {
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
      let mockUserStats: MockUserStatsPerPool;
      let mockVeNFTState: VeNFTState;

      beforeEach(async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockPool,
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
        mockLeafPool = createMockPool({
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
        indexer.Pool.set(mockLeafPool);
        indexer.RootPool_LeafPool.set(rootPoolLeafPool);
        indexer.UserStatsPerPool.set(mockUserStats);
        indexer.Token.set(leafToken0Data);
        indexer.Token.set(leafToken1Data);
        indexer.VeNFTState.set(mockVeNFTState);

        await indexer.process({
          chains: {
            [rootChainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Voted",
                  logIndex: 1,
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

      it("should update leaf pool aggregator with voting data", async () => {
        const raw = await indexer.Pool.get(
          PoolId(leafChainId, leafPoolAddress),
        );
        const updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;
        expect(updatedPool).toBeDefined();
        expect(updatedPool?.veNFTamountStaked).toBe(realTotalWeight);
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("should update user stats per pool with voting data", async () => {
        const userStatsId = UserStatsPerPoolId(
          leafChainId,
          realVoterAddress,
          leafPoolAddress,
        );
        const rawStats = await indexer.UserStatsPerPool.get(userStatsId);
        const updatedUserStats = rawStats
          ? rehydrateTimestamps("UserStatsPerPool", rawStats)
          : undefined;
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
      let mockVeNFTState: VeNFTState;
      let mockVeNFTPoolVote: VeNFTPoolVote;

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

    describe("when pool is a RootCLPool", () => {
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
      const initialUserStaked = 50000000000000000000000n; // 50k tokens (18 decimals) - initial amount before withdrawal
      let mockLeafPool: MockPool;
      let mockUserStats: MockUserStatsPerPool;
      let mockVeNFTState: VeNFTState;
      let mockVeNFTPoolVote: VeNFTPoolVote;

      beforeEach(async () => {
        const {
          mockToken0Data,
          mockToken1Data,
          createMockUserStatsPerPool,
          createMockPool,
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
        mockLeafPool = createMockPool({
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
        indexer.Pool.set(mockLeafPool);
        indexer.RootPool_LeafPool.set(rootPoolLeafPool);
        indexer.UserStatsPerPool.set(mockUserStats);
        indexer.Token.set(leafToken0Data);
        indexer.Token.set(leafToken1Data);
        indexer.VeNFTState.set(mockVeNFTState);
        indexer.VeNFTPoolVote.set(mockVeNFTPoolVote);

        await indexer.process({
          chains: {
            [rootChainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "Abstained",
                  logIndex: 1,
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

      it("should update leaf pool aggregator with total weight (absolute value)", async () => {
        const raw = await indexer.Pool.get(
          PoolId(leafChainId, leafPoolAddress),
        );
        const updatedPool = raw ? rehydrateTimestamps("Pool", raw) : undefined;

        expect(updatedPool).toBeDefined();
        // totalWeight is the absolute total veNFT staked in pool, replacing previous value
        expect(updatedPool?.veNFTamountStaked).toBe(realTotalWeight);
        expect(updatedPool?.lastUpdatedTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("should decrease user stats veNFT amount staked (negative weight)", async () => {
        const userStatsId = UserStatsPerPoolId(
          leafChainId,
          realVoterAddress,
          leafPoolAddress,
        );
        const rawStats = await indexer.UserStatsPerPool.get(userStatsId);
        const updatedUserStats = rawStats
          ? rehydrateTimestamps("UserStatsPerPool", rawStats)
          : undefined;
        expect(updatedUserStats).toBeDefined();
        // weight is subtracted (negative because it's a withdrawal)
        const expectedStaked = initialUserStaked - realWeight;
        expect(updatedUserStats?.veNFTamountStaked).toBe(expectedStaked);
        expect(updatedUserStats?.lastActivityTimestamp).toEqual(
          new Date(realTimestamp * 1000),
        );
      });

      it("should zero out veNFT pool votes", async () => {
        const veNFTPoolVoteId = VeNFTPoolVoteId(
          leafChainId,
          realTokenId,
          leafPoolAddress,
        );
        const veNFTPoolVote = await indexer.VeNFTPoolVote.get(veNFTPoolVoteId);
        expect(veNFTPoolVote).toBeDefined();
        expect(veNFTPoolVote?.veNFTamountStaked).toBe(0n);
      });

      it("should key VeNFTPoolVote and UserStatsPerPool by leaf pool (real pool) not root pool", async () => {
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
          await indexer.UserStatsPerPool.get(rootUserStatsId),
        ).toBeUndefined();
        expect(
          await indexer.VeNFTPoolVote.get(rootVeNFTPoolVoteId),
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
          await indexer.UserStatsPerPool.get(leafUserStatsId);
        const leafVeNFTPoolVote =
          await indexer.VeNFTPoolVote.get(leafVeNFTPoolVoteId);
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
        createMockPool,
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

      const leafPool = createMockPool({
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

      // indexer for intermediate state check (vote + transfer only)
      const transferIndexer = createTestIndexer();
      transferIndexer.Pool.set(leafPool);
      transferIndexer.RootPool_LeafPool.set(rootPoolLeafPool);
      transferIndexer.Token.set(leafToken0Data);
      transferIndexer.Token.set(leafToken1Data);
      transferIndexer.VeNFTState.set(veNFTState);

      await transferIndexer.process({
        chains: {
          [rootChainId as 10]: {
            simulate: [
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

      const rawOldAfter = await transferIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(leafChainId, oldOwner, leafPoolAddress),
      );
      const rawNewAfter = await transferIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(leafChainId, newOwner, leafPoolAddress),
      );
      const oldOwnerStatsAfterTransfer = rawOldAfter
        ? rehydrateTimestamps("UserStatsPerPool", rawOldAfter)
        : undefined;
      const newOwnerStatsAfterTransfer = rawNewAfter
        ? rehydrateTimestamps("UserStatsPerPool", rawNewAfter)
        : undefined;

      expect(oldOwnerStatsAfterTransfer?.veNFTamountStaked).toBe(0n);
      expect(newOwnerStatsAfterTransfer?.veNFTamountStaked).toBe(voteWeight);
      expect(newOwnerStatsAfterTransfer?.firstActivityTimestamp).toEqual(
        new Date(1734794861 * 1000),
      );

      // indexer for full run (vote + transfer + abstain)
      const fullIndexer = createTestIndexer();
      fullIndexer.Pool.set(leafPool);
      fullIndexer.RootPool_LeafPool.set(rootPoolLeafPool);
      fullIndexer.Token.set(leafToken0Data);
      fullIndexer.Token.set(leafToken1Data);
      fullIndexer.VeNFTState.set(veNFTState);

      await fullIndexer.process({
        chains: {
          [rootChainId as 10]: {
            simulate: [
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

      const rawFinalOld = await fullIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(leafChainId, oldOwner, leafPoolAddress),
      );
      const rawFinalNew = await fullIndexer.UserStatsPerPool.get(
        UserStatsPerPoolId(leafChainId, newOwner, leafPoolAddress),
      );
      const finalOldOwnerStats = rawFinalOld
        ? rehydrateTimestamps("UserStatsPerPool", rawFinalOld)
        : undefined;
      const finalNewOwnerStats = rawFinalNew
        ? rehydrateTimestamps("UserStatsPerPool", rawFinalNew)
        : undefined;
      const finalPoolVote = await fullIndexer.VeNFTPoolVote.get(
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
      it("should create RootGauge_RootPool for cross-chain DistributeReward resolution", async () => {
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
        idx.Token.set(token as Token);
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
        } as Token;
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
        } as Token;
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
        } as Token;
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
        } as Token;
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
      CHAIN_CONSTANTS[chainId].rewardToken(blockNumber);

    describe("when reward token and liquidity pool exist", () => {
      let indexer: ReturnType<typeof createTestIndexer>;
      let cleanup: () => void;

      const { createMockPool } = setupCommon();

      let expectations: {
        totalEmissions: bigint;
        totalEmissionsUSD: bigint;
        getTokensDeposited: bigint;
        getTokensDepositedUSD: bigint;
      };

      beforeEach(async () => {
        const liquidityPool = createMockPool({
          id: PoolId(chainId, poolAddress),
          chainId: chainId,
          totalEmissions: 0n,
          totalEmissionsUSD: 0n,
          totalVotesDeposited: 0n,
          totalVotesDepositedUSD: 0n,
          gaugeIsAlive: false, // DistributeReward does not set this; we assert it remains unchanged
        });

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

          vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(
            liquidityPool,
          );

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
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsForPoolTest,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

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

        const db = createTestIndexer();
        db.Token.set(rewardToken);

        await db.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "RootCLPoolFactory",
                  event: "RootPoolCreated",
                  logIndex: 1,
                  block: {
                    timestamp: blockTimestamp,
                    number: blockNumberForRoot,
                    hash: txHash,
                  },
                  params: {
                    token0: token0 as `0x${string}`,
                    token1: token1 as `0x${string}`,
                    tickSpacing,
                    chainid: BigInt(leafChainId),
                    pool: rootPoolAddress,
                  },
                },
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
                  srcAddress: toChecksumAddress(
                    "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
                  ),
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
        ).toBeDefined();

        const pendingDistId = PendingDistributionId(
          chainId,
          rootPoolAddress,
          blockNumberForRoot,
          3,
        );
        const pendingDistribution =
          await db.PendingDistribution.get(pendingDistId);
        expect(pendingDistribution).toBeDefined();
        expect(pendingDistribution?.gaugeAddress).toBe(gaugeAddress);
        expect(pendingDistribution?.amount).toBe(1000n * 10n ** 18n);

        expect(Array.from(await db.Pool.getAll())).toHaveLength(0);
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

        vi.spyOn(PoolModule, "findPoolByGaugeAddress").mockResolvedValue(null);

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

        const db = createTestIndexer();
        db.Token.set(rewardToken);
        db.RootGauge_RootPool.set({
          id: rootGaugeRootPoolId,
          rootChainId: chainId,
          rootGaugeAddress: gaugeAddress,
          rootPoolAddress: rootPoolAddressForAmbiguous,
        });
        db.RootPool_LeafPool.set({
          id: rootPoolLeafPoolIdA,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddressForAmbiguous,
          leafChainId,
          leafPoolAddress: leafPoolAddressA,
        });
        db.RootPool_LeafPool.set({
          id: rootPoolLeafPoolIdB,
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddressForAmbiguous,
          leafChainId,
          leafPoolAddress: leafPoolAddressB,
        });

        await db.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "Voter",
                  event: "DistributeReward",
                  logIndex,
                  srcAddress: toChecksumAddress(
                    "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
                  ),
                  block: {
                    number: blockNumberForRoot,
                    timestamp: 1000000,
                    hash: "0xblockhash",
                  },
                  params: { gauge: gaugeAddress, amount: 1000n * 10n ** 18n },
                },
              ],
            },
          },
        });

        const pendingDistId = PendingDistributionId(
          chainId,
          rootPoolAddressForAmbiguous,
          blockNumberForRoot,
          logIndex,
        );
        const pendingDistribution =
          await db.PendingDistribution.get(pendingDistId);
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
        expect(Array.from(await db.Pool.getAll())).toHaveLength(0);
      });
    });

    describe("when rootPoolAddress is a known sink (issue #601)", () => {
      it("drops DistributeReward silently without creating PendingDistribution", async () => {
        // Seed a RootGauge_RootPool mapping whose rootPoolAddress is a
        // known sink (OP). Known sinks are placeholder contracts with no
        // real leaf pool; we must not accumulate orphan Pending* records.
        const sinkRootPoolAddress = toChecksumAddress(
          "0x333030A736B47D20346d82A473680658ac1C2b88",
        );
        const blockNumberForSink = 128357870;
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

        const db = createTestIndexer();
        db.Token.set(rewardToken);
        db.RootGauge_RootPool.set({
          id: RootGaugeRootPoolId(chainId, gaugeAddress),
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
                  logIndex,
                  srcAddress: voterAddress,
                  block: {
                    number: blockNumberForSink,
                    timestamp: 1000000,
                    hash: "0xblockhash",
                  },
                  params: { gauge: gaugeAddress, amount: 1000n * 10n ** 18n },
                },
              ],
            },
          },
        });

        const pendingDistribution = await db.PendingDistribution.get(
          PendingDistributionId(
            chainId,
            sinkRootPoolAddress,
            blockNumberForSink,
            logIndex,
          ),
        );
        expect(pendingDistribution).toBeUndefined();
        expect(Array.from(await db.PendingDistribution.getAll())).toHaveLength(
          0,
        );
        expect(Array.from(await db.Pool.getAll())).toHaveLength(0);
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
        CHAIN_CONSTANTS[chainId] = {
          ...originalChainConstantsForRewardTest,
          rewardToken: vi.fn().mockReturnValue(rewardTokenAddress),
        };

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
