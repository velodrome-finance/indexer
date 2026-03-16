import type {
  LiquidityPoolAggregator,
  PendingDistribution,
  handlerContext,
} from "generated";
import type { PoolData } from "../../../src/Aggregators/LiquidityPoolAggregator";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  CHAIN_CONSTANTS,
  PendingDistributionId,
  PoolId,
  RootPoolLeafPoolId,
  TokenId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  deleteProcessedPendingDistribution,
  flushPendingVotesAndDistributionsForRootPool,
  getPendingDistributionsByRootPool,
  processAllPendingDistributionsForRootPool,
  processPendingDistribution,
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
  describe("flushPendingVotesAndDistributionsForRootPool", () => {
    const logPrefix = "[Test]";
    const rootPoolLeafPoolRow = { leafPoolAddress, leafChainId };

    it("should call processAllPendingDistributionsForRootPool with (context, rootPoolAddress)", async () => {
      const getWhereRootPoolLeafPool = vi
        .fn()
        .mockResolvedValue([rootPoolLeafPoolRow]);
      const getWherePendingDistribution = vi.fn().mockResolvedValue([]);

      const context = {
        log: { error: vi.fn() },
        RootPool_LeafPool: { getWhere: getWhereRootPoolLeafPool },
        PendingDistribution: { getWhere: getWherePendingDistribution },
      } as unknown as handlerContext;

      await flushPendingVotesAndDistributionsForRootPool(
        context,
        rootPoolAddress,
        logPrefix,
      );

      expect(getWhereRootPoolLeafPool).toHaveBeenCalledTimes(1);
      expect(getWhereRootPoolLeafPool).toHaveBeenCalledWith({
        rootPoolAddress: { _eq: rootPoolAddress },
      });
    });

    it("should log and resolve without throwing when processAllPendingDistributionsForRootPool throws", async () => {
      const logError = vi.fn();
      const getWhereRootPoolLeafPool = vi
        .fn()
        .mockResolvedValueOnce([rootPoolLeafPoolRow]);
      const getWherePendingDistribution = vi
        .fn()
        .mockRejectedValue(new Error("Pending distribution processing failed"));

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
        Number(pending.blockNumber),
        Math.floor((pending.blockTimestamp as Date).getTime() / 1000),
      );
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
      expect(updatePoolSpy).toHaveBeenCalledTimes(1);
      const timestampMs = (pending.blockTimestamp as Date).getTime();
      expect(updatePoolSpy).toHaveBeenCalledWith(
        expect.any(Object),
        leafPool,
        new Date(timestampMs),
        context,
        leafChainId,
        Number(pending.blockNumber),
      );
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
