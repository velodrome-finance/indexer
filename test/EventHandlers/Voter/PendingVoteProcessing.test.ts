import type {
  LiquidityPoolAggregator,
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
  PendingVoteId,
  PoolId,
  RootPoolLeafPoolId,
  VeNFTId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  deleteProcessedPendingVote,
  getPendingVotesByRootPool,
  processAllPendingVotesForRootPool,
  processPendingVote,
} from "../../../src/EventHandlers/Voter/PendingVoteProcessing";
import { setupCommon } from "../Pool/common";

describe("PendingVoteProcessing", () => {
  beforeEach(() => {
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
    it("should return pending votes for root pool sorted by timestamp ascending", async () => {
      const earlier = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        timestamp: new Date(999000),
      });
      const later = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 2),
        timestamp: new Date(1001000),
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
      expect(result[0].timestamp.getTime()).toBe(999000);
      expect(result[1].timestamp.getTime()).toBe(1001000);
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
      const withDate = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 1),
        timestamp: new Date(2000),
      });
      const withNumber = makePendingVote({
        id: PendingVoteId(rootChainId, rootPoolAddress, tokenId, "0xhash", 2),
        timestamp: 1000 as unknown as Date,
      });
      const getWhere = vi.fn().mockResolvedValue([withDate, withNumber]);
      const context = {
        PendingVote: { getWhere },
      } as unknown as handlerContext;

      const result = await getPendingVotesByRootPool(context, rootPoolAddress);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(withNumber);
      expect(result[1]).toBe(withDate);
    });
  });

  describe("processPendingVote", () => {
    it("should skip and log warn when VeNFTState is missing", async () => {
      const {
        createMockLiquidityPoolAggregator,
        mockToken0Data,
        mockToken1Data,
      } = setupCommon();
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
      const common = setupCommon();
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
    });

    it("should use negative weightDelta when eventType is Abstained", async () => {
      const common = setupCommon();
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
      const common = setupCommon();
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
      } = setupCommon();
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
      } = setupCommon();
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
      const common = setupCommon();
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
      const common = setupCommon();
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
});
