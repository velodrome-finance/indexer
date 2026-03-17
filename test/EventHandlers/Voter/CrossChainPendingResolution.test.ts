import type {
  LiquidityPoolAggregator,
  PendingDistribution,
  PendingVote,
  RootPool_LeafPool,
  UserStatsPerPool,
  VeNFTPoolVote,
  VeNFTState,
  handlerContext,
} from "generated";
import type { PoolData } from "../../../src/Aggregators/LiquidityPoolAggregator";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import * as UserStatsPerPoolModule from "../../../src/Aggregators/UserStatsPerPool";
import * as VeNFTPoolVoteModule from "../../../src/Aggregators/VeNFTPoolVote";
import * as VeNFTStateModule from "../../../src/Aggregators/VeNFTState";
import {
  CHAIN_CONSTANTS,
  PendingDistributionId,
  PendingVoteId,
  PoolId,
  RootPoolLeafPoolId,
  TokenId,
  VeNFTId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  deleteProcessedPendingDistribution,
  deleteProcessedPendingVote,
  flushPendingVotesAndDistributionsForRootPool,
  getPendingDistributionsByRootPool,
  getPendingVotesByRootPool,
  processAllPendingDistributionsForRootPool,
  processAllPendingVotesForRootPool,
  processPendingDistribution,
  processPendingVote,
} from "../../../src/EventHandlers/Voter/CrossChainPendingResolution";
import * as VoterCommonLogic from "../../../src/EventHandlers/Voter/VoterCommonLogic";
import * as PriceOracle from "../../../src/PriceOracle";
import { setupCommon } from "../Pool/common";

describe("CrossChainPendingResolution", () => {
  let common: ReturnType<typeof setupCommon>;

  beforeEach(() => {
    common = setupCommon();
    vi.restoreAllMocks();
  });

  const rootPoolAddress = toChecksumAddress(
    "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
  );
  const leafPoolAddress = toChecksumAddress(
    "0x3BBdBAD64b383885031c4d9C8Afe0C3327d79888",
  );
  const leafChainId = 252;
  const rootChainId = 10;
  const tokenId = 1n;
  const timestampMs = 1000000 * 1000;
  const timestamp = new Date(timestampMs);
  const ownerAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const gaugeAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );

  function makePendingDistribution(
    overrides: Partial<PendingDistribution> = {},
  ): PendingDistribution {
    const blockNumber = 106000000;
    const blockTimestampSeconds = 1700000000;
    return {
      id: PendingDistributionId(rootChainId, rootPoolAddress, blockNumber, 0),
      rootChainId,
      rootPoolAddress,
      gaugeAddress,
      amount: 1000000n,
      blockNumber: BigInt(blockNumber),
      blockTimestamp: new Date(blockTimestampSeconds * 1000),
      logIndex: 0,
      ...overrides,
    } as PendingDistribution;
  }

  function makePendingVote(overrides: Partial<PendingVote> = {}): PendingVote {
    return {
      id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
      chainId: rootChainId,
      rootPoolAddress,
      tokenId,
      weight: 100n,
      eventType: "Voted",
      timestamp,
      blockNumber: BigInt(123456),
      transactionHash: "0xhash",
      ...overrides,
    } as PendingVote;
  }

  function prepareProcessPendingVoteFixture(
    common: ReturnType<typeof setupCommon>,
    overrides?: {
      pendingVoteOverrides?: Partial<PendingVote>;
      leafPoolOverrides?: Partial<LiquidityPoolAggregator>;
    },
  ): {
    pendingVote: PendingVote;
    leafPoolData: PoolData;
    mockVeNFTState: VeNFTState;
    mockUserStats: UserStatsPerPool;
    mockVeNFTPoolVote: VeNFTPoolVote;
    context: handlerContext;
    updatePoolSpy: ReturnType<typeof vi.spyOn>;
    updateUserSpy: ReturnType<typeof vi.spyOn>;
    updateVoteSpy: ReturnType<typeof vi.spyOn>;
  } {
    const leafPool = common.createMockLiquidityPoolAggregator({
      id: PoolId(leafChainId, leafPoolAddress),
      chainId: leafChainId,
      poolAddress: leafPoolAddress,
      veNFTamountStaked: 0n,
      ...overrides?.leafPoolOverrides,
    });
    const leafPoolData: PoolData = {
      liquidityPoolAggregator: leafPool,
      token0Instance: common.mockToken0Data,
      token1Instance: common.mockToken1Data,
    };
    const pendingVote = makePendingVote(overrides?.pendingVoteOverrides);
    const mockVeNFTState = common.createMockVeNFTState({
      id: VeNFTId(rootChainId, tokenId),
      chainId: rootChainId,
      tokenId,
      owner: ownerAddress,
    });
    const mockUserStats = common.createMockUserStatsPerPool({
      userAddress: ownerAddress,
      poolAddress: leafPoolAddress,
      chainId: leafChainId,
    });
    const mockVeNFTPoolVote = common.createMockVeNFTPoolVote({
      veNFTState_id: mockVeNFTState.id,
      poolAddress: leafPoolAddress,
    });

    vi.spyOn(VeNFTStateModule, "loadVeNFTState").mockResolvedValue(
      mockVeNFTState,
    );
    vi.spyOn(
      VeNFTPoolVoteModule,
      "loadOrCreateVeNFTPoolVote",
    ).mockResolvedValue(mockVeNFTPoolVote);
    vi.spyOn(UserStatsPerPoolModule, "loadOrCreateUserData").mockResolvedValue(
      mockUserStats,
    );
    const updatePoolSpy = vi
      .spyOn(LiquidityPoolAggregatorModule, "updateLiquidityPoolAggregator")
      .mockResolvedValue(undefined);
    const updateUserSpy = vi
      .spyOn(UserStatsPerPoolModule, "updateUserStatsPerPool")
      .mockResolvedValue(mockUserStats);
    const updateVoteSpy = vi
      .spyOn(VeNFTPoolVoteModule, "updateVeNFTPoolVote")
      .mockResolvedValue(mockVeNFTPoolVote);

    const context = {
      VeNFTState: { get: vi.fn() },
      LiquidityPoolAggregator: { set: vi.fn() },
    } as unknown as handlerContext;

    return {
      pendingVote,
      leafPoolData,
      mockVeNFTState,
      mockUserStats,
      mockVeNFTPoolVote,
      context,
      updatePoolSpy,
      updateUserSpy,
      updateVoteSpy,
    };
  }

  describe("getPendingVotesByRootPool", () => {
    it("should return pending votes for root pool sorted by block number ascending", async () => {
      const earlier = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        timestamp: new Date(999000),
        blockNumber: 100n,
      });
      const later = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 2),
        timestamp: new Date(1001000),
        blockNumber: 200n,
      });
      const pendingVotes = [later, earlier];

      const getWhere = vi.fn().mockResolvedValue(pendingVotes);
      const context = {
        PendingVote: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingVotesByRootPool(context, rootPoolAddress);

      expect(getWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(result).toHaveLength(2);
      expect(Number(result[0].blockNumber)).toBe(100);
      expect(Number(result[1].blockNumber)).toBe(200);
    });

    it("should return empty array when getWhere returns null or undefined", async () => {
      const getWhere = vi.fn().mockResolvedValue(null);
      const context = {
        PendingVote: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingVotesByRootPool(context, rootPoolAddress);

      expect(result).toEqual([]);
    });

    it("should sort correctly when timestamp is not a Date instance", async () => {
      const pendingWithNumberTimestamp = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        timestamp: 500 as unknown as Date,
      });
      const getWhere = vi.fn().mockResolvedValue([pendingWithNumberTimestamp]);
      const context = {
        PendingVote: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingVotesByRootPool(context, rootPoolAddress);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(pendingWithNumberTimestamp);
    });

    it("should sort when one vote has Date timestamp and one has number timestamp", async () => {
      const firstBlock = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        timestamp: new Date(2000),
        blockNumber: 10n,
      });
      const secondBlock = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 2),
        timestamp: 1000 as unknown as Date,
        blockNumber: 20n,
      });
      const getWhere = vi.fn().mockResolvedValue([secondBlock, firstBlock]);
      const context = {
        PendingVote: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingVotesByRootPool(context, rootPoolAddress);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(firstBlock);
      expect(result[1]).toBe(secondBlock);
    });

    it("should order by log index within the same block (id-derived tie-break)", async () => {
      const sameBlock = 50n;
      const voteLogIndex1 = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhashA", 1),
        blockNumber: sameBlock,
      });
      const voteLogIndex3 = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhashB", 3),
        blockNumber: sameBlock,
      });
      const voteLogIndex2 = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhashC", 2),
        blockNumber: sameBlock,
      });
      const getWhere = vi
        .fn()
        .mockResolvedValue([voteLogIndex3, voteLogIndex1, voteLogIndex2]);
      const context = {
        PendingVote: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingVotesByRootPool(context, rootPoolAddress);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(voteLogIndex1);
      expect(result[1]).toBe(voteLogIndex2);
      expect(result[2]).toBe(voteLogIndex3);
    });
  });

  describe("processPendingVote", () => {
    it("should skip and log warn when VeNFTState is missing", async () => {
      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
        veNFTamountStaked: 0n,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };
      const pendingVote = makePendingVote();

      const warns: string[] = [];
      const VeNFTStateGet = vi.fn().mockResolvedValue(undefined);
      const context = {
        VeNFTState: { get: VeNFTStateGet },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      const result = await processPendingVote(
        context,
        pendingVote,
        leafPoolData,
      );

      expect(result).toBe(false);
      expect(warns.length).toBeGreaterThanOrEqual(1);
      const processWarn = warns.find((w) => w.includes("processPendingVote"));
      expect(processWarn).toBeDefined();
      expect(processWarn).toContain("VeNFTState not found");
      expect(processWarn).toContain(String(tokenId));
    });

    it("should update pool, user stats, and VeNFTPoolVote when VeNFTState exists", async () => {
      const {
        pendingVote,
        leafPoolData,
        context,
        updatePoolSpy,
        updateUserSpy,
        updateVoteSpy,
      } = prepareProcessPendingVoteFixture(common, {
        pendingVoteOverrides: { weight: 50n },
      });

      const result = await processPendingVote(
        context,
        pendingVote,
        leafPoolData,
      );

      expect(result).toBe(true);
      expect(updatePoolSpy).toHaveBeenCalledTimes(1);
      expect(updateUserSpy).toHaveBeenCalledTimes(1);
      expect(updateVoteSpy).toHaveBeenCalledTimes(1);

      // Cross-chain fix: updateLiquidityPoolAggregator must receive pendingVote.chainId
      // (root chain, not leafChainId) so the updateDynamicFeePools guard detects
      // the chain mismatch and skips the fee query (which would use root block on leaf RPC).
      const [, , , , eventChainIdArg, blockNumberArg] =
        updatePoolSpy.mock.calls[0];
      expect(eventChainIdArg).toBe(pendingVote.chainId);
      expect(eventChainIdArg).toBe(rootChainId);
      expect(eventChainIdArg).not.toBe(leafChainId);
      expect(blockNumberArg).toBe(Number(pendingVote.blockNumber));
    });

    it("should use negative weightDelta when eventType is Abstained", async () => {
      const { pendingVote, leafPoolData, context, updatePoolSpy } =
        prepareProcessPendingVoteFixture(common, {
          pendingVoteOverrides: { weight: 30n, eventType: "Abstained" },
          leafPoolOverrides: { veNFTamountStaked: 100n },
        });

      updatePoolSpy.mockClear();
      const result = await processPendingVote(
        context,
        pendingVote,
        leafPoolData,
      );

      expect(result).toBe(true);
      expect(updatePoolSpy).toHaveBeenCalledTimes(1);
      const [, currentPool] = updatePoolSpy.mock.calls[0];
      expect(currentPool.veNFTamountStaked).toBe(100n);
    });

    it("should convert numeric timestamp to Date when timestamp is not a Date instance", async () => {
      const numericTimestampMs = 1234567890;
      const { pendingVote, leafPoolData, context, updatePoolSpy } =
        prepareProcessPendingVoteFixture(common, {
          pendingVoteOverrides: {
            timestamp: numericTimestampMs as unknown as Date,
          },
        });

      updatePoolSpy.mockClear();
      const result = await processPendingVote(
        context,
        pendingVote,
        leafPoolData,
      );

      expect(result).toBe(true);
      expect(updatePoolSpy).toHaveBeenCalledTimes(1);
      const [, , callTimestamp] = updatePoolSpy.mock.calls[0];
      expect(callTimestamp).toEqual(new Date(numericTimestampMs));
    });

    it("should call loadOrCreateVeNFTPoolVote and loadOrCreateUserData with leaf chain and pool address (not root)", async () => {
      const { pendingVote, leafPoolData, context } =
        prepareProcessPendingVoteFixture(common);

      await processPendingVote(context, pendingVote, leafPoolData);

      expect(
        vi.mocked(VeNFTPoolVoteModule.loadOrCreateVeNFTPoolVote),
      ).toHaveBeenCalledWith(
        leafChainId,
        pendingVote.tokenId,
        leafPoolAddress,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(
        vi.mocked(UserStatsPerPoolModule.loadOrCreateUserData),
      ).toHaveBeenCalledWith(
        ownerAddress,
        leafPoolAddress,
        leafChainId,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe("deleteProcessedPendingVote", () => {
    it("should call PendingVote.deleteUnsafe with pending vote id", () => {
      const pendingVote = makePendingVote();
      const deleteUnsafe = vi.fn();
      const context = {
        PendingVote: { deleteUnsafe },
      } as unknown as handlerContext;

      deleteProcessedPendingVote(context, pendingVote);

      expect(deleteUnsafe).toHaveBeenCalledTimes(1);
      expect(deleteUnsafe).toHaveBeenCalledWith(pendingVote.id);
    });
  });

  describe("processAllPendingVotesForRootPool", () => {
    it("should warn and return when zero RootPool_LeafPool mappings exist", async () => {
      const getWhere = vi.fn().mockResolvedValue([]);
      const warns: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(getWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("Expected exactly one");
      expect(warns[0]).toContain("got 0");
    });

    it("should warn and return when getWhere returns null (uses ?? [])", async () => {
      const getWhere = vi.fn().mockResolvedValue(null);
      const warns: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(getWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("Expected exactly one");
      expect(warns[0]).toContain("got 0");
    });

    it("should warn and return when multiple RootPool_LeafPool mappings exist", async () => {
      const mapping1: RootPool_LeafPool = {
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
      const mapping2: RootPool_LeafPool = {
        ...mapping1,
        id: RootPoolLeafPoolId(
          rootChainId,
          8453,
          rootPoolAddress,
          toChecksumAddress("0x0000000000000000000000000000000000000001"),
        ),
        leafChainId: 8453,
        leafPoolAddress: toChecksumAddress(
          "0x0000000000000000000000000000000000000001",
        ),
      };
      const getWhere = vi.fn().mockResolvedValue([mapping1, mapping2]);
      const warns: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("got 2");
    });

    it("should warn and return when leaf pool data is not found", async () => {
      const mapping: RootPool_LeafPool = {
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
      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const liquidityPoolGet = vi.fn().mockResolvedValue(undefined);
      const warns: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        LiquidityPoolAggregator: { get: liquidityPoolGet },
        Token: { get: vi.fn().mockResolvedValue(undefined) },
        log: {
          warn: (msg: unknown) => warns.push(String(msg)),
          error: vi.fn(),
        },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("Leaf pool data not found");
      expect(warns[0]).toContain(leafPoolAddress);
    });

    it("should break loop when loadPoolData returns null during iteration", async () => {
      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const mapping: RootPool_LeafPool = {
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
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };

      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingVoteGetWhere = vi.fn().mockResolvedValue([
        makePendingVote({
          id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        }),
      ]);
      let loadPoolDataCallCount = 0;
      const loadPoolDataSpy = vi
        .spyOn(LiquidityPoolAggregatorModule, "loadPoolData")
        .mockImplementation(async () => {
          loadPoolDataCallCount++;
          return loadPoolDataCallCount === 1 ? leafPoolData : null;
        });
      const deleteUnsafe = vi.fn();
      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingVote: { getWhere: pendingVoteGetWhere, deleteUnsafe },
        LiquidityPoolAggregator: { get: vi.fn().mockResolvedValue(leafPool) },
        Token: {
          get: vi
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(
                id === mockToken0Data.id ? mockToken0Data : mockToken1Data,
              ),
            ),
        },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(loadPoolDataSpy).toHaveBeenCalledTimes(2);
      expect(deleteUnsafe).not.toHaveBeenCalled();
    });

    it("should not delete pending vote when VeNFTState is missing so it can be retried later", async () => {
      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const mapping: RootPool_LeafPool = {
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
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };
      const pendingVote = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
      });

      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingVoteGetWhere = vi.fn().mockResolvedValue([pendingVote]);
      const deleteUnsafe = vi.fn();
      vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
        leafPoolData,
      );
      vi.spyOn(VeNFTStateModule, "loadVeNFTState").mockResolvedValue(undefined);
      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingVote: { getWhere: pendingVoteGetWhere, deleteUnsafe },
        LiquidityPoolAggregator: { get: vi.fn().mockResolvedValue(leafPool) },
        Token: {
          get: vi
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(
                id === mockToken0Data.id ? mockToken0Data : mockToken1Data,
              ),
            ),
        },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(deleteUnsafe).not.toHaveBeenCalled();
    });

    it("should continue processing remaining pending votes and log error when processPendingVote throws for one vote", async () => {
      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const mockVeNFTState = common.createMockVeNFTState({
        id: VeNFTId(rootChainId, tokenId),
        chainId: rootChainId,
        tokenId,
        owner: ownerAddress,
      });
      const mockVeNFTPoolVote = common.createMockVeNFTPoolVote({
        veNFTState_id: mockVeNFTState.id,
        poolAddress: leafPoolAddress,
      });
      const mockUserStats = common.createMockUserStatsPerPool({
        userAddress: ownerAddress,
        poolAddress: leafPoolAddress,
        chainId: leafChainId,
      });
      const mapping: RootPool_LeafPool = {
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
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };
      const pendingVote1 = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
      });
      const pendingVote2 = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 2),
      });

      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingVoteGetWhere = vi
        .fn()
        .mockResolvedValue([pendingVote1, pendingVote2]);
      vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
        leafPoolData,
      );
      const processError = new Error("processPendingVote failed");
      vi.spyOn(VeNFTStateModule, "loadVeNFTState")
        .mockRejectedValueOnce(processError)
        .mockResolvedValue(mockVeNFTState);
      vi.spyOn(
        VeNFTPoolVoteModule,
        "loadOrCreateVeNFTPoolVote",
      ).mockResolvedValue(mockVeNFTPoolVote);
      vi.spyOn(
        UserStatsPerPoolModule,
        "loadOrCreateUserData",
      ).mockResolvedValue(mockUserStats);
      vi.spyOn(
        LiquidityPoolAggregatorModule,
        "updateLiquidityPoolAggregator",
      ).mockResolvedValue(undefined);
      vi.spyOn(
        UserStatsPerPoolModule,
        "updateUserStatsPerPool",
      ).mockResolvedValue(mockUserStats);
      vi.spyOn(VeNFTPoolVoteModule, "updateVeNFTPoolVote").mockResolvedValue(
        mockVeNFTPoolVote,
      );
      const errors: string[] = [];
      const deleteUnsafe = vi.fn();
      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingVote: { getWhere: pendingVoteGetWhere, deleteUnsafe },
        LiquidityPoolAggregator: {
          get: vi.fn().mockResolvedValue(leafPool),
          set: vi.fn(),
        },
        UserStatsPerPool: { get: vi.fn(), set: vi.fn() },
        VeNFTPoolVote: {
          get: vi.fn(),
          getWhere: vi.fn().mockResolvedValue([]),
          getOrCreate: vi.fn().mockResolvedValue(mockVeNFTPoolVote),
          set: vi.fn(),
        },
        Token: {
          get: vi
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(
                id === mockToken0Data.id ? mockToken0Data : mockToken1Data,
              ),
            ),
        },
        log: {
          info: vi.fn(),
          warn: vi.fn(),
          error: (msg: unknown) => errors.push(String(msg)),
        },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(pendingVote1.id);
      expect(errors[0]).toContain("processPendingVote failed");
      expect(deleteUnsafe).toHaveBeenCalledTimes(1);
      expect(deleteUnsafe).toHaveBeenCalledWith(pendingVote2.id);
    });

    it("should continue loop and log error when deleteProcessedPendingVote throws after successful process", async () => {
      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const mockVeNFTState = common.createMockVeNFTState({
        id: VeNFTId(rootChainId, tokenId),
        chainId: rootChainId,
        tokenId,
        owner: ownerAddress,
      });
      const mockVeNFTPoolVote = common.createMockVeNFTPoolVote({
        veNFTState_id: mockVeNFTState.id,
        poolAddress: leafPoolAddress,
      });
      const mockUserStats = common.createMockUserStatsPerPool({
        userAddress: ownerAddress,
        poolAddress: leafPoolAddress,
        chainId: leafChainId,
      });
      const mapping: RootPool_LeafPool = {
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
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };
      const pendingVote = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
      });

      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingVoteGetWhere = vi.fn().mockResolvedValue([pendingVote]);
      const deleteError = new Error("deleteUnsafe failed");
      const deleteUnsafe = vi.fn().mockImplementationOnce(() => {
        throw deleteError;
      });
      vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
        leafPoolData,
      );
      vi.spyOn(VeNFTStateModule, "loadVeNFTState").mockResolvedValue(
        mockVeNFTState,
      );
      vi.spyOn(
        VeNFTPoolVoteModule,
        "loadOrCreateVeNFTPoolVote",
      ).mockResolvedValue(mockVeNFTPoolVote);
      vi.spyOn(
        UserStatsPerPoolModule,
        "loadOrCreateUserData",
      ).mockResolvedValue(mockUserStats);
      vi.spyOn(
        LiquidityPoolAggregatorModule,
        "updateLiquidityPoolAggregator",
      ).mockResolvedValue(undefined);
      vi.spyOn(
        UserStatsPerPoolModule,
        "updateUserStatsPerPool",
      ).mockResolvedValue(mockUserStats);
      vi.spyOn(VeNFTPoolVoteModule, "updateVeNFTPoolVote").mockResolvedValue(
        mockVeNFTPoolVote,
      );
      const errors: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingVote: { getWhere: pendingVoteGetWhere, deleteUnsafe },
        LiquidityPoolAggregator: {
          get: vi.fn().mockResolvedValue(leafPool),
          set: vi.fn(),
        },
        UserStatsPerPool: { get: vi.fn(), set: vi.fn() },
        VeNFTPoolVote: {
          get: vi.fn(),
          getWhere: vi.fn().mockResolvedValue([]),
          getOrCreate: vi.fn().mockResolvedValue(mockVeNFTPoolVote),
          set: vi.fn(),
        },
        Token: {
          get: vi
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(
                id === mockToken0Data.id ? mockToken0Data : mockToken1Data,
              ),
            ),
        },
        log: {
          info: vi.fn(),
          warn: vi.fn(),
          error: (msg: unknown) => errors.push(String(msg)),
        },
      } as unknown as handlerContext;

      await processAllPendingVotesForRootPool(context, rootPoolAddress);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(pendingVote.id);
      expect(errors[0]).toContain("deleteUnsafe failed");
    });
  });

  describe("flushPendingVotesAndDistributionsForRootPool", () => {
    const logPrefix = "[Test]";
    const rootPoolLeafPoolRow = { leafPoolAddress, leafChainId };

    it("should call both processAllPendingVotesForRootPool and processAllPendingDistributionsForRootPool with (context, rootPoolAddress)", async () => {
      const getWhereRootPoolLeafPool = vi
        .fn()
        .mockResolvedValue([rootPoolLeafPoolRow]);
      const getWherePendingVote = vi.fn().mockResolvedValue([]);
      const getWherePendingDistribution = vi.fn().mockResolvedValue([]);

      const context = {
        log: { error: vi.fn() },
        RootPool_LeafPool: { getWhere: getWhereRootPoolLeafPool },
        PendingVote: { getWhere: getWherePendingVote },
        PendingDistribution: { getWhere: getWherePendingDistribution },
      } as unknown as handlerContext;

      await flushPendingVotesAndDistributionsForRootPool(
        context,
        rootPoolAddress,
        logPrefix,
      );

      expect(getWhereRootPoolLeafPool).toHaveBeenCalledTimes(2);
      expect(getWhereRootPoolLeafPool).toHaveBeenNthCalledWith(1, {
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(getWhereRootPoolLeafPool).toHaveBeenNthCalledWith(2, {
        rootPoolAddress: { _eq: rootPoolAddress },
      });
    });

    it("should log and still call processAllPendingDistributionsForRootPool when processAllPendingVotesForRootPool throws", async () => {
      const logError = vi.fn();
      const getWhereRootPoolLeafPool = vi
        .fn()
        .mockRejectedValueOnce(new Error("Pending vote processing failed"))
        .mockResolvedValueOnce([rootPoolLeafPoolRow]);
      const getWherePendingDistribution = vi.fn().mockResolvedValue([]);

      const context = {
        log: { error: logError },
        RootPool_LeafPool: { getWhere: getWhereRootPoolLeafPool },
        PendingDistribution: { getWhere: getWherePendingDistribution },
      } as unknown as handlerContext;

      await expect(
        flushPendingVotesAndDistributionsForRootPool(
          context,
          rootPoolAddress,
          logPrefix,
        ),
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining(logPrefix));
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("processAllPendingVotesForRootPool"),
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("Pending vote processing failed"),
      );
      expect(getWhereRootPoolLeafPool).toHaveBeenCalledTimes(2);
    });

    it("should log and resolve without throwing when processAllPendingDistributionsForRootPool throws", async () => {
      const logError = vi.fn();
      const logWarn = vi.fn();
      // First call: no row so processAllPendingVotesForRootPool exits early (warn + return). Second call: row for processAllPendingDistributionsForRootPool.
      const getWhereRootPoolLeafPool = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([rootPoolLeafPoolRow]);
      const getWherePendingDistribution = vi
        .fn()
        .mockRejectedValue(new Error("Pending distribution processing failed"));

      const context = {
        log: { error: logError, warn: logWarn },
        RootPool_LeafPool: { getWhere: getWhereRootPoolLeafPool },
        PendingDistribution: { getWhere: getWherePendingDistribution },
      } as unknown as handlerContext;

      await expect(
        flushPendingVotesAndDistributionsForRootPool(
          context,
          rootPoolAddress,
          logPrefix,
        ),
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining(logPrefix));
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("processAllPendingDistributionsForRootPool"),
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("Pending distribution processing failed"),
      );
    });
  });

  describe("getPendingDistributionsByRootPool", () => {
    it("should sort by blockNumber ascending then by logIndex ascending", async () => {
      const earlierBlock = makePendingDistribution({
        id: PendingDistributionId(rootChainId, rootPoolAddress, 100, 2),
        blockNumber: 100n,
        logIndex: 2,
      });
      const laterBlock = makePendingDistribution({
        id: PendingDistributionId(rootChainId, rootPoolAddress, 200, 1),
        blockNumber: 200n,
        logIndex: 1,
      });
      const getWhere = vi.fn().mockResolvedValue([laterBlock, earlierBlock]);
      const context = {
        PendingDistribution: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingDistributionsByRootPool(
        context,
        rootPoolAddress,
      );

      expect(result).toHaveLength(2);
      expect(Number(result[0].blockNumber)).toBe(100);
      expect(Number(result[1].blockNumber)).toBe(200);
      expect(getWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
    });

    it("should sort by logIndex when blockNumber is equal", async () => {
      const first = makePendingDistribution({
        id: PendingDistributionId(rootChainId, rootPoolAddress, 100, 3),
        blockNumber: 100n,
        logIndex: 3,
      });
      const second = makePendingDistribution({
        id: PendingDistributionId(rootChainId, rootPoolAddress, 100, 1),
        blockNumber: 100n,
        logIndex: 1,
      });
      const getWhere = vi.fn().mockResolvedValue([first, second]);
      const context = {
        PendingDistribution: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingDistributionsByRootPool(
        context,
        rootPoolAddress,
      );

      expect(result).toHaveLength(2);
      expect(result[0].logIndex).toBe(1);
      expect(result[1].logIndex).toBe(3);
    });

    it("should return empty array when getWhere returns null or undefined", async () => {
      const getWhere = vi.fn().mockResolvedValue(null);
      const context = {
        PendingDistribution: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingDistributionsByRootPool(
        context,
        rootPoolAddress,
      );

      expect(result).toEqual([]);
      expect(getWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
    });
  });

  describe("processPendingDistribution", () => {
    it("should warn and return when reward token is not found", async () => {
      const pending = makePendingDistribution({
        blockNumber: 106000000n,
        blockTimestamp: new Date(1700000000 * 1000),
      });
      const rewardTokenAddress = CHAIN_CONSTANTS[rootChainId].rewardToken(
        Number(pending.blockNumber),
      );
      const tokenGet = vi.fn().mockResolvedValue(undefined);
      const warns: string[] = [];
      const context = {
        Token: { get: tokenGet },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      const result = await processPendingDistribution(
        context,
        pending,
        leafPoolAddress,
        leafChainId,
      );

      expect(result).toBe(false);
      expect(tokenGet).toHaveBeenCalledWith(
        TokenId(rootChainId, rewardTokenAddress),
      );
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("[processAllPendingDistributionsForRootPool]");
      expect(warns[0]).toContain("Reward token not found");
      expect(warns[0]).toContain(String(rootChainId));
      expect(warns[0]).toContain(pending.id);
    });

    it("should warn and return when leaf pool data is not found", async () => {
      const pending = makePendingDistribution();
      const rewardTokenAddress = CHAIN_CONSTANTS[rootChainId].rewardToken(
        Number(pending.blockNumber),
      );
      const mockToken = {
        id: TokenId(rootChainId, rewardTokenAddress),
        address: rewardTokenAddress,
        symbol: "AERO",
        name: "Aero",
        decimals: 18n,
        chainId: rootChainId,
      };
      const tokenGet = vi.fn().mockResolvedValue(mockToken);
      const loadPoolDataSpy = vi
        .spyOn(LiquidityPoolAggregatorModule, "loadPoolData")
        .mockResolvedValue(null);
      const warns: string[] = [];
      const context = {
        Token: { get: tokenGet },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      const result = await processPendingDistribution(
        context,
        pending,
        leafPoolAddress,
        leafChainId,
      );

      expect(result).toBe(false);
      expect(loadPoolDataSpy).toHaveBeenCalledWith(
        leafPoolAddress,
        leafChainId,
        context,
      );
      // Cross-chain fix: loadPoolData must NOT receive blockNumber/blockTimestamp
      // because they belong to the root chain and would cause "Unknown block" errors
      // on the leaf chain's RPC.
      expect(loadPoolDataSpy.mock.calls[0]).toHaveLength(3);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("[processAllPendingDistributionsForRootPool]");
      expect(warns[0]).toContain("Leaf pool data not found");
      expect(warns[0]).toContain(leafPoolAddress);
      expect(warns[0]).toContain(String(leafChainId));
      expect(warns[0]).toContain(pending.id);
    });

    it("should apply LP diff when reward token and leaf pool data exist", async () => {
      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const pending = makePendingDistribution();
      const rewardTokenAddress = CHAIN_CONSTANTS[rootChainId].rewardToken(
        Number(pending.blockNumber),
      );
      const mockRewardToken = {
        id: TokenId(rootChainId, rewardTokenAddress),
        address: rewardTokenAddress as `0x${string}`,
        symbol: "AERO",
        name: "Aero",
        decimals: 18n,
        chainId: rootChainId,
      };
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
        gaugeIsAlive: undefined, // cover ?? false branch in processPendingDistribution
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };

      vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
        leafPoolData,
      );
      vi.spyOn(PriceOracle, "refreshTokenPrice").mockResolvedValue(
        mockRewardToken as never,
      );
      vi.spyOn(
        VoterCommonLogic,
        "computeVoterDistributeValues",
      ).mockResolvedValue({
        isAlive: true,
        tokensDeposited: 100n,
        normalizedEmissionsAmount: 50n,
        normalizedEmissionsAmountUsd: 50n,
        normalizedVotesDepositedAmountUsd: 100n,
      });
      const updatePoolSpy = vi
        .spyOn(LiquidityPoolAggregatorModule, "updateLiquidityPoolAggregator")
        .mockResolvedValue(undefined);

      const context = {
        Token: {
          get: vi.fn().mockResolvedValue(mockRewardToken),
        },
        log: { warn: vi.fn(), error: vi.fn() },
      } as unknown as handlerContext;

      const result = await processPendingDistribution(
        context,
        pending,
        leafPoolAddress,
        leafChainId,
      );

      expect(result).toBe(true);

      // Cross-chain fix: loadPoolData must NOT receive blockNumber/blockTimestamp
      const loadPoolDataSpy = vi.mocked(
        LiquidityPoolAggregatorModule.loadPoolData,
      );
      expect(loadPoolDataSpy.mock.calls[0]).toHaveLength(3);

      // Cross-chain fix: updateLiquidityPoolAggregator must receive rootChainId
      // (not leafChainId) so the updateDynamicFeePools guard detects the chain
      // mismatch and skips the fee query (which would use root block on leaf RPC).
      expect(updatePoolSpy).toHaveBeenCalledTimes(1);
      const timestampMs = (pending.blockTimestamp as Date).getTime();
      expect(updatePoolSpy).toHaveBeenCalledWith(
        expect.any(Object),
        leafPool,
        new Date(timestampMs),
        context,
        rootChainId,
        Number(pending.blockNumber),
      );
      // Verify it's rootChainId, not leafChainId
      expect(rootChainId).not.toBe(leafChainId);
    });
  });

  describe("deleteProcessedPendingDistribution", () => {
    it("should call PendingDistribution.deleteUnsafe with pending id", () => {
      const pending = makePendingDistribution();
      const deleteUnsafe = vi.fn();
      const context = {
        PendingDistribution: { deleteUnsafe },
      } as unknown as handlerContext;

      deleteProcessedPendingDistribution(context, pending);

      expect(deleteUnsafe).toHaveBeenCalledTimes(1);
      expect(deleteUnsafe).toHaveBeenCalledWith(pending.id);
    });
  });

  describe("processAllPendingDistributionsForRootPool", () => {
    it("should warn and return when zero RootPool_LeafPool mappings exist", async () => {
      const getWhere = vi.fn().mockResolvedValue([]);
      const warns: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      await processAllPendingDistributionsForRootPool(context, rootPoolAddress);

      expect(getWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("Expected exactly one");
      expect(warns[0]).toContain("got 0");
    });

    it("should warn and return when getWhere returns null (uses ?? [])", async () => {
      const getWhere = vi.fn().mockResolvedValue(null);
      const warns: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      await processAllPendingDistributionsForRootPool(context, rootPoolAddress);

      expect(getWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("Expected exactly one");
      expect(warns[0]).toContain("got 0");
    });

    it("should warn and return when multiple RootPool_LeafPool mappings exist", async () => {
      const mapping1 = {
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
      const mapping2 = {
        ...mapping1,
        id: RootPoolLeafPoolId(
          rootChainId,
          999,
          rootPoolAddress,
          toChecksumAddress("0x0000000000000000000000000000000000000001"),
        ),
        leafChainId: 999,
        leafPoolAddress: toChecksumAddress(
          "0x0000000000000000000000000000000000000001",
        ),
      };
      const getWhere = vi.fn().mockResolvedValue([mapping1, mapping2]);
      const warns: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere },
        log: { warn: (msg: unknown) => warns.push(String(msg)) },
      } as unknown as handlerContext;

      await processAllPendingDistributionsForRootPool(context, rootPoolAddress);

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("got 2");
    });

    it("should process pending distributions and delete each when one mapping exists", async () => {
      const mapping = {
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
      const pending = makePendingDistribution();
      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingDistributionGetWhere = vi.fn().mockResolvedValue([pending]);
      const deleteUnsafe = vi.fn();

      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };
      const rewardTokenAddress = CHAIN_CONSTANTS[rootChainId].rewardToken(
        Number(pending.blockNumber),
      );
      const mockRewardToken = {
        id: TokenId(rootChainId, rewardTokenAddress),
        address: rewardTokenAddress as `0x${string}`,
        symbol: "AERO",
        name: "Aero",
        decimals: 18n,
        chainId: rootChainId,
      };

      vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
        leafPoolData,
      );
      vi.spyOn(PriceOracle, "refreshTokenPrice").mockResolvedValue(
        mockRewardToken as never,
      );
      vi.spyOn(
        VoterCommonLogic,
        "computeVoterDistributeValues",
      ).mockResolvedValue({
        isAlive: true,
        tokensDeposited: 100n,
        normalizedEmissionsAmount: 50n,
        normalizedEmissionsAmountUsd: 50n,
        normalizedVotesDepositedAmountUsd: 100n,
      });
      vi.spyOn(
        LiquidityPoolAggregatorModule,
        "updateLiquidityPoolAggregator",
      ).mockResolvedValue(undefined);

      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingDistribution: {
          getWhere: pendingDistributionGetWhere,
          deleteUnsafe,
        },
        Token: { get: vi.fn().mockResolvedValue(mockRewardToken) },
        log: { warn: vi.fn(), error: vi.fn() },
      } as unknown as handlerContext;

      await processAllPendingDistributionsForRootPool(context, rootPoolAddress);

      expect(pendingDistributionGetWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(deleteUnsafe).toHaveBeenCalledTimes(1);
      expect(deleteUnsafe).toHaveBeenCalledWith(pending.id);
    });

    it("should not call deleteUnsafe when processPendingDistribution returns false (e.g. reward token not found)", async () => {
      const mapping = {
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
      const pending = makePendingDistribution();
      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingDistributionGetWhere = vi.fn().mockResolvedValue([pending]);
      const deleteUnsafe = vi.fn();
      const tokenGet = vi.fn().mockResolvedValue(undefined);

      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingDistribution: {
          getWhere: pendingDistributionGetWhere,
          deleteUnsafe,
        },
        Token: { get: tokenGet },
        log: { warn: vi.fn(), error: vi.fn() },
      } as unknown as handlerContext;

      await processAllPendingDistributionsForRootPool(context, rootPoolAddress);

      expect(pendingDistributionGetWhere).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
      expect(deleteUnsafe).not.toHaveBeenCalled();
    });

    it("should continue processing remaining pending distributions and log error when processPendingDistribution throws for one", async () => {
      const mapping = {
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
      const pending1 = makePendingDistribution({
        id: PendingDistributionId(rootChainId, rootPoolAddress, 106000000, 0),
        logIndex: 0,
      });
      const pending2 = makePendingDistribution({
        id: PendingDistributionId(rootChainId, rootPoolAddress, 106000001, 1),
        blockNumber: 106000001n,
        logIndex: 1,
      });
      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingDistributionGetWhere = vi
        .fn()
        .mockResolvedValue([pending1, pending2]);
      const deleteUnsafe = vi.fn();

      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };
      const rewardTokenAddress =
        CHAIN_CONSTANTS[rootChainId].rewardToken(106000000);
      const mockRewardToken = {
        id: TokenId(rootChainId, rewardTokenAddress),
        address: rewardTokenAddress as `0x${string}`,
        symbol: "AERO",
        name: "Aero",
        decimals: 18n,
        chainId: rootChainId,
      };

      vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
        leafPoolData,
      );
      vi.spyOn(PriceOracle, "refreshTokenPrice").mockResolvedValue(
        mockRewardToken as never,
      );
      vi.spyOn(
        VoterCommonLogic,
        "computeVoterDistributeValues",
      ).mockResolvedValue({
        isAlive: true,
        tokensDeposited: 100n,
        normalizedEmissionsAmount: 50n,
        normalizedEmissionsAmountUsd: 50n,
        normalizedVotesDepositedAmountUsd: 100n,
      });
      const processError = new Error("processPendingDistribution failed");
      vi.spyOn(LiquidityPoolAggregatorModule, "updateLiquidityPoolAggregator")
        .mockRejectedValueOnce(processError)
        .mockResolvedValue(undefined);

      const errors: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingDistribution: {
          getWhere: pendingDistributionGetWhere,
          deleteUnsafe,
        },
        Token: { get: vi.fn().mockResolvedValue(mockRewardToken) },
        log: {
          warn: vi.fn(),
          error: (msg: unknown) => errors.push(String(msg)),
        },
      } as unknown as handlerContext;

      await processAllPendingDistributionsForRootPool(context, rootPoolAddress);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(pending1.id);
      expect(errors[0]).toContain("processPendingDistribution failed");
      expect(deleteUnsafe).toHaveBeenCalledTimes(1);
      expect(deleteUnsafe).toHaveBeenCalledWith(pending2.id);
    });

    it("should continue loop and log error when deleteProcessedPendingDistribution throws after successful process", async () => {
      const mapping = {
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
      const pending = makePendingDistribution();
      const rootPoolLeafPoolGetWhere = vi.fn().mockResolvedValue([mapping]);
      const pendingDistributionGetWhere = vi.fn().mockResolvedValue([pending]);
      const deleteError = new Error("deleteUnsafe failed");
      const deleteUnsafe = vi.fn().mockImplementation(() => {
        throw deleteError;
      });

      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = common;
      const leafPool = createMockLiquidityPoolAggregator({
        id: PoolId(leafChainId, leafPoolAddress),
        chainId: leafChainId,
        poolAddress: leafPoolAddress,
      });
      const leafPoolData: PoolData = {
        liquidityPoolAggregator: leafPool,
        token0Instance: mockToken0Data,
        token1Instance: mockToken1Data,
      };
      const rewardTokenAddress = CHAIN_CONSTANTS[rootChainId].rewardToken(
        Number(pending.blockNumber),
      );
      const mockRewardToken = {
        id: TokenId(rootChainId, rewardTokenAddress),
        address: rewardTokenAddress as `0x${string}`,
        symbol: "AERO",
        name: "Aero",
        decimals: 18n,
        chainId: rootChainId,
      };

      vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
        leafPoolData,
      );
      vi.spyOn(PriceOracle, "refreshTokenPrice").mockResolvedValue(
        mockRewardToken as never,
      );
      vi.spyOn(
        VoterCommonLogic,
        "computeVoterDistributeValues",
      ).mockResolvedValue({
        isAlive: true,
        tokensDeposited: 100n,
        normalizedEmissionsAmount: 50n,
        normalizedEmissionsAmountUsd: 50n,
        normalizedVotesDepositedAmountUsd: 100n,
      });
      vi.spyOn(
        LiquidityPoolAggregatorModule,
        "updateLiquidityPoolAggregator",
      ).mockResolvedValue(undefined);

      const errors: string[] = [];
      const context = {
        RootPool_LeafPool: { getWhere: rootPoolLeafPoolGetWhere },
        PendingDistribution: {
          getWhere: pendingDistributionGetWhere,
          deleteUnsafe,
        },
        Token: { get: vi.fn().mockResolvedValue(mockRewardToken) },
        log: {
          warn: vi.fn(),
          error: (msg: unknown) => errors.push(String(msg)),
        },
      } as unknown as handlerContext;

      await processAllPendingDistributionsForRootPool(context, rootPoolAddress);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(pending.id);
      expect(errors[0]).toContain("deleteUnsafe failed");
    });
  });
});
