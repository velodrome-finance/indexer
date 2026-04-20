import type { CLGaugeConfig, LiquidityPoolAggregator, Token } from "generated";
import type { MockInstance } from "vitest";
import {
  CLFactory,
  MockDb,
  RootCLPoolFactory,
  Voter,
} from "../../generated/src/TestHelpers.gen";
import {
  CHAIN_CONSTANTS,
  FeeToTickSpacingMappingId,
  PendingDistributionId,
  PendingRootPoolMappingId,
  PendingVoteId,
  PoolId,
  RootGaugeRootPoolId,
  RootPoolLeafPoolId,
  TokenId,
  VeNFTId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../../src/Constants";
import { getTokensDeposited } from "../../src/Effects/Voter";
import * as CLFactoryPoolCreatedLogic from "../../src/EventHandlers/CLFactory/CLFactoryPoolCreatedLogic";
import * as PriceOracle from "../../src/PriceOracle";
import { setupCommon } from "./Pool/common";

describe("CLFactory Events", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  // Use Base (8453) — chainId-keyed CLGaugeConfig has a row for 8453 via CLGaugeFactoryV2
  const chainId = 8453;
  const poolAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;

  // Shared constants for FeeToTickSpacingMapping
  const TICK_SPACING = 60n;
  const FEE = 500n;
  const createFeeToTickSpacingMapping = () => ({
    id: FeeToTickSpacingMappingId(chainId, TICK_SPACING),
    chainId: chainId,
    tickSpacing: TICK_SPACING,
    fee: FEE,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
  });

  function setupMockDbWithEntities(
    db: ReturnType<typeof MockDb.createMockDb>,
    options: {
      includeFeeToTickSpacing?: boolean;
      clGaugeConfigChainId?: number;
    } = {},
  ): ReturnType<typeof MockDb.createMockDb> {
    const { includeFeeToTickSpacing = true, clGaugeConfigChainId = chainId } =
      options;
    const token0ForBase = {
      ...mockToken0Data,
      id: TokenId(chainId, mockToken0Data.address),
      chainId: chainId,
    } satisfies Token;
    const token1ForBase = {
      ...mockToken1Data,
      id: TokenId(chainId, mockToken1Data.address),
      chainId: chainId,
    } satisfies Token;
    let updated =
      db.entities.Token.set(token0ForBase).entities.Token.set(token1ForBase);
    const clGaugeConfig = {
      id: String(clGaugeConfigChainId),
      defaultEmissionsCap: 0n,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } satisfies CLGaugeConfig;
    updated = updated.entities.CLGaugeConfig.set(clGaugeConfig);
    if (includeFeeToTickSpacing) {
      const feeToTickSpacingMapping = createFeeToTickSpacingMapping();
      updated = updated.entities.FeeToTickSpacingMapping.set(
        feeToTickSpacingMapping,
      );
    }
    return updated;
  }

  let processSpy: MockInstance<
    typeof CLFactoryPoolCreatedLogic.processCLFactoryPoolCreated
  >;

  beforeEach(() => {
    // Mock createTokenEntity in case it's called for missing tokens
    vi.spyOn(PriceOracle, "createTokenEntity").mockImplementation(
      async (address: string) => ({
        id: TokenId(chainId, address),
        address: address,
        symbol: "",
        name: "Mock Token",
        decimals: 18n,
        pricePerUSDNew: 1000000000000000000n,
        chainId: chainId,
        isWhitelisted: false,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      }),
    );

    processSpy = vi
      .spyOn(CLFactoryPoolCreatedLogic, "processCLFactoryPoolCreated")
      .mockImplementation(
        async (
          event,
          _factoryAddress,
          token0,
          token1,
          clGaugeConfig,
          feeToTickSpacingMapping,
        ) => {
          const mapping = feeToTickSpacingMapping as
            | { fee?: bigint }
            | undefined;
          return {
            liquidityPoolAggregator: {
              id: PoolId(chainId, poolAddress),
              chainId: chainId,
              token0_id: TokenId(chainId, token0Address),
              token1_id: TokenId(chainId, token1Address),
              token0_address: token0Address,
              token1_address: token1Address,
              isStable: false,
              isCL: true,
              baseFee: mapping?.fee,
              currentFee: mapping?.fee,
              lastUpdatedTimestamp: new Date(1000000 * 1000),
              veNFTamountStaked: 0n,
            } as LiquidityPoolAggregator,
          };
        },
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PoolCreated event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof CLFactory.PoolCreated.createMockEvent>;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      mockDb = MockDb.createMockDb();
      mockDb = setupMockDbWithEntities(mockDb);

      mockEvent = CLFactory.PoolCreated.createMockEvent({
        token0: token0Address as `0x${string}`,
        token1: token1Address as `0x${string}`,
        pool: poolAddress,
        tickSpacing: TICK_SPACING,
        mockEventData: {
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });

      resultDB = await mockDb.processEvents([mockEvent]);
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should call processCLFactoryPoolCreated with correct parameters", () => {
      // processCLFactoryPoolCreated(event, factoryAddress, poolToken0, poolToken1, CLGaugeConfig, feeToTickSpacingMapping, context)
      expect(processSpy).toHaveBeenCalled();
      const callArgs = processSpy.mock.calls[0];
      expect(callArgs[0]).toEqual(mockEvent);
      expect(callArgs[1]).toEqual(mockEvent.srcAddress); // factoryAddress
      expect(callArgs[2]).toEqual(
        expect.objectContaining({
          address: mockToken0Data.address,
          chainId: chainId,
        }),
      );
      expect(callArgs[3]).toEqual(
        expect.objectContaining({
          address: mockToken1Data.address,
          chainId: chainId,
        }),
      );
      expect(callArgs[4]).toEqual(
        expect.objectContaining({
          id: String(chainId),
        }),
      );
      expect(callArgs[5]).toEqual(
        expect.objectContaining({
          id: FeeToTickSpacingMappingId(chainId, TICK_SPACING),
          fee: 500n,
        }),
      );
      // Verify context was passed as 7th argument
      expect(callArgs[6]).toBeDefined();
    });

    it("should set the liquidity pool aggregator entity", () => {
      const pool = resultDB.entities.LiquidityPoolAggregator.get(
        PoolId(chainId, poolAddress),
      );
      expect(pool).toBeDefined();
      expect(pool?.id).toBe(PoolId(chainId, poolAddress));
      expect(pool?.chainId).toBe(chainId);
      expect(pool?.isCL).toBe(true);
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should process event even during preload phase", async () => {
      // Create a mock context that simulates preload
      let preloadMockDb = MockDb.createMockDb();
      preloadMockDb = setupMockDbWithEntities(preloadMockDb);

      // Reset spy to track calls
      processSpy.mockClear();

      // Verify the mapping exists before processing (using the same key format as the handler)
      const mappingKey = FeeToTickSpacingMappingId(chainId, TICK_SPACING);
      const mappingBefore =
        preloadMockDb.entities.FeeToTickSpacingMapping.get(mappingKey);
      expect(mappingBefore).toBeDefined(); // Verify mapping exists before processing

      // Handlers now run during both preload and normal phases
      const result = await preloadMockDb.processEvents([mockEvent]);

      // Verify that the handler ran (pool should be created if mapping exists)
      const pool = result.entities.LiquidityPoolAggregator.get(
        PoolId(chainId, poolAddress),
      );

      // Since we verified the mapping exists, the handler should have run and created the pool
      expect(pool).toBeDefined();
      // The handler should have called processCLFactoryPoolCreated
      // Note: The spy may be called multiple times (preload + normal), so check at least once
      expect(processSpy).toHaveBeenCalled();
    });

    // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
    it.skip("should load token0, token1, CLGaugeConfig, and FeeToTickSpacingMapping in parallel", () => {
      // Verify that the handler loads all four entities and passes factoryAddress
      // processCLFactoryPoolCreated(event, factoryAddress, poolToken0, poolToken1, CLGaugeConfig, feeToTickSpacingMapping, context)
      expect(processSpy).toHaveBeenCalled();
      expect(processSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const callArgs = processSpy.mock.calls[0];
      expect(callArgs[1]).toBeDefined(); // factoryAddress
      expect(callArgs[2]).toBeDefined(); // token0
      expect(callArgs[3]).toBeDefined(); // token1
      const clGaugeConfig = callArgs[4];
      expect(clGaugeConfig).toBeDefined(); // CLGaugeConfig
      expect(clGaugeConfig?.id).toBe(String(chainId));
      const feeToTickSpacingMapping = callArgs[5] as { fee?: bigint };
      expect(feeToTickSpacingMapping).toBeDefined(); // FeeToTickSpacingMapping
      expect(feeToTickSpacingMapping?.fee).toBe(500n);
    });

    it("should set baseFee and currentFee from FeeToTickSpacingMapping when mapping exists", () => {
      const pool = resultDB.entities.LiquidityPoolAggregator.get(
        PoolId(chainId, poolAddress),
      );
      expect(pool?.baseFee).toBe(500n);
      expect(pool?.currentFee).toBe(500n);
    });

    it("should handle missing FeeToTickSpacingMapping gracefully", async () => {
      let mockDbWithoutMapping = MockDb.createMockDb();
      mockDbWithoutMapping = setupMockDbWithEntities(mockDbWithoutMapping, {
        includeFeeToTickSpacing: false,
      });

      const result = await mockDbWithoutMapping.processEvents([mockEvent]);

      const pool = result.entities.LiquidityPoolAggregator.get(
        PoolId(chainId, poolAddress),
      );
      // When mapping doesn't exist, handler returns early and no pool is created
      expect(pool).toBeUndefined();
    });

    describe("when PendingRootPoolMapping exists for the same rootPoolMatchingHash", () => {
      const rootChainId = 10;
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );

      it("should create RootPool_LeafPool and delete PendingRootPoolMapping", async () => {
        const hash = rootPoolMatchingHash(
          chainId,
          token0Address,
          token1Address,
          TICK_SPACING,
        );
        const pendingMapping = {
          id: PendingRootPoolMappingId(rootChainId, rootPoolAddress),
          rootChainId,
          rootPoolAddress,
          leafChainId: chainId,
          token0: token0Address,
          token1: token1Address,
          tickSpacing: TICK_SPACING,
          rootPoolMatchingHash: hash,
        };

        let db = MockDb.createMockDb();
        db = setupMockDbWithEntities(db);
        db = db.entities.PendingRootPoolMapping.set(pendingMapping);

        const result = await db.processEvents([mockEvent]);

        const rootPoolLeafPool = result.entities.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            chainId,
            rootPoolAddress,
            poolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeDefined();
        expect(rootPoolLeafPool?.rootPoolAddress).toBe(rootPoolAddress);
        expect(rootPoolLeafPool?.leafPoolAddress).toBe(poolAddress);
        expect(rootPoolLeafPool?.leafChainId).toBe(chainId);

        const stillPending = result.entities.PendingRootPoolMapping.get(
          pendingMapping.id,
        );
        expect(stillPending).toBeUndefined();
      });

      it("should flush pending votes when PendingVote and VeNFTState exist", async () => {
        const { createMockLiquidityPoolAggregator, createMockVeNFTState } =
          setupCommon();
        const fullPool = createMockLiquidityPoolAggregator({
          id: PoolId(chainId, poolAddress),
          chainId,
          token0_id: TokenId(chainId, token0Address),
          token1_id: TokenId(chainId, token1Address),
          token0_address: token0Address,
          token1_address: token1Address,
          veNFTamountStaked: 0n,
        });
        processSpy.mockImplementation(async () => ({
          liquidityPoolAggregator: fullPool,
        }));

        const hash = rootPoolMatchingHash(
          chainId,
          token0Address,
          token1Address,
          TICK_SPACING,
        );
        const pendingMapping = {
          id: PendingRootPoolMappingId(rootChainId, rootPoolAddress),
          rootChainId,
          rootPoolAddress,
          leafChainId: chainId,
          token0: token0Address,
          token1: token1Address,
          tickSpacing: TICK_SPACING,
          rootPoolMatchingHash: hash,
        };
        const tokenId = 1n;
        const voteWeight = 100n;
        const timestampMs = (mockEvent.block.timestamp as number) * 1000;
        const txHash = mockEvent.transaction?.hash ?? "0xhash";
        const logIndex = mockEvent.logIndex ?? 1;
        const pendingVote = {
          id: PendingVoteId(
            rootChainId,
            rootPoolAddress,
            tokenId,
            txHash,
            logIndex,
          ),
          chainId: rootChainId,
          rootPoolAddress,
          tokenId,
          weight: voteWeight,
          eventType: "Voted",
          timestamp: new Date(timestampMs),
          blockNumber: BigInt(mockEvent.block.number),
          transactionHash: txHash,
        };
        const ownerAddress = toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        );
        const veNFTState = createMockVeNFTState({
          id: VeNFTId(rootChainId, tokenId),
          chainId: rootChainId,
          tokenId,
          owner: ownerAddress,
        });

        let db = MockDb.createMockDb();
        db = setupMockDbWithEntities(db);
        db = db.entities.PendingRootPoolMapping.set(pendingMapping);
        db = db.entities.PendingVote.set(pendingVote);
        db = db.entities.VeNFTState.set(veNFTState);

        const result = await db.processEvents([mockEvent]);

        const rootPoolLeafPool = result.entities.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            chainId,
            rootPoolAddress,
            poolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeDefined();

        const processedPendingVote = result.entities.PendingVote.get(
          pendingVote.id,
        );
        expect(processedPendingVote).toBeUndefined();

        const leafPool = result.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(leafPool?.veNFTamountStaked).toBe(voteWeight);
      });
    });

    describe("full E2E: root ahead then leaf catches up (flush)", () => {
      const rootChainId = 10;
      const leafChainId = 252; // Fraxtal
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );
      const leafPoolAddress = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const blockTimestamp = 1000000;
      const blockNumber = 1000000;
      const txHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";
      function setupLeafChainEntities(
        db: ReturnType<typeof MockDb.createMockDb>,
        leafChain: number,
        leafPoolAddress: string,
        leafToken0: string,
        leafToken1: string,
        tickSpacing: bigint,
        fee: bigint = FEE,
      ): ReturnType<typeof MockDb.createMockDb> {
        const token0ForLeaf = {
          ...mockToken0Data,
          id: TokenId(leafChain, leafToken0),
          address: toChecksumAddress(leafToken0),
          chainId: leafChain,
        } satisfies Token;
        const token1ForLeaf = {
          ...mockToken1Data,
          id: TokenId(leafChain, leafToken1),
          address: toChecksumAddress(leafToken1),
          chainId: leafChain,
        } satisfies Token;
        let updated =
          db.entities.Token.set(token0ForLeaf).entities.Token.set(
            token1ForLeaf,
          );
        const clGaugeConfig = {
          id: String(leafChain),
          defaultEmissionsCap: 0n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } satisfies CLGaugeConfig;
        updated = updated.entities.CLGaugeConfig.set(clGaugeConfig);
        const feeToTickSpacingMapping = {
          id: FeeToTickSpacingMappingId(leafChain, tickSpacing),
          chainId: leafChain,
          tickSpacing,
          fee,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        };
        updated = updated.entities.FeeToTickSpacingMapping.set(
          feeToTickSpacingMapping,
        );
        return updated;
      }

      function setupCrossChainFlushE2E(options: {
        rootChainId: number;
        leafChainId: number;
        rootPoolAddress: string;
        leafPoolAddress: string;
        blockTimestamp: number;
        blockNumber: number;
        txHash: string;
        token0Address: string;
        token1Address: string;
        tickSpacing: bigint;
        fee?: bigint;
      }) {
        const {
          rootChainId: rcid,
          leafChainId: lcid,
          rootPoolAddress: rpa,
          leafPoolAddress: lpa,
          blockTimestamp: ts,
          blockNumber: bn,
          txHash: hash,
          token0Address: t0,
          token1Address: t1,
          tickSpacing: ts2,
          fee = FEE,
        } = options;

        let db = MockDb.createMockDb();
        db = setupLeafChainEntities(db, lcid, lpa, t0, t1, ts2, fee);

        const rootPoolCreatedEvent =
          RootCLPoolFactory.RootPoolCreated.createMockEvent({
            token0: t0 as `0x${string}`,
            token1: t1 as `0x${string}`,
            tickSpacing: ts2,
            chainid: BigInt(lcid),
            pool: rpa as `0x${string}`,
            mockEventData: {
              block: { timestamp: ts, number: bn, hash },
              chainId: rcid,
              logIndex: 1,
            },
          });

        const createClFactoryPoolCreatedEvent = (
          blockOffset = 1,
          timestampOffset = 1,
        ) =>
          CLFactory.PoolCreated.createMockEvent({
            token0: t0 as `0x${string}`,
            token1: t1 as `0x${string}`,
            pool: lpa as `0x${string}`,
            tickSpacing: ts2,
            mockEventData: {
              block: {
                number: bn + blockOffset,
                timestamp: ts + timestampOffset,
                hash,
              },
              chainId: lcid,
              logIndex: 1,
            },
          });

        return {
          db,
          rootPoolCreatedEvent,
          createClFactoryPoolCreatedEvent,
        };
      }

      it("should flush PendingRootPoolMapping and PendingVote when processing RootPoolCreated, Voted, then CLFactory.PoolCreated (two processEvents: root chain 10, leaf chain 252)", async () => {
        const { createMockLiquidityPoolAggregator, createMockVeNFTState } =
          setupCommon();
        const voteTokenId = 1n;
        const voteWeight = 100n;
        const ownerAddress = toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        );

        const e2e = setupCrossChainFlushE2E({
          rootChainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
          blockTimestamp,
          blockNumber,
          txHash,
          token0Address,
          token1Address,
          tickSpacing: TICK_SPACING,
        });

        {
          const fullPool = createMockLiquidityPoolAggregator({
            id: PoolId(leafChainId, leafPoolAddress),
            chainId: leafChainId,
            token0_id: TokenId(leafChainId, token0Address),
            token1_id: TokenId(leafChainId, token1Address),
            token0_address: token0Address,
            token1_address: token1Address,
            veNFTamountStaked: 0n,
          });
          processSpy.mockImplementation(async (_event, ..._rest) => ({
            liquidityPoolAggregator: fullPool,
          }));

          const veNFTState = createMockVeNFTState({
            id: VeNFTId(rootChainId, voteTokenId),
            chainId: rootChainId,
            tokenId: voteTokenId,
            owner: ownerAddress,
          });

          const db = e2e.db.entities.VeNFTState.set(veNFTState);

          const votedEvent = Voter.Voted.createMockEvent({
            voter: ownerAddress,
            pool: rootPoolAddress,
            tokenId: voteTokenId,
            weight: voteWeight,
            totalWeight: 1000n,
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

          const afterRoot = await db.processEvents([
            e2e.rootPoolCreatedEvent,
            votedEvent,
          ]);

          const clFactoryPoolCreatedEvent = e2e.createClFactoryPoolCreatedEvent(
            1,
            1,
          );

          const result = await afterRoot.processEvents([
            clFactoryPoolCreatedEvent,
          ]);

          const stillPending = result.entities.PendingRootPoolMapping.get(
            PendingRootPoolMappingId(rootChainId, rootPoolAddress),
          );
          expect(stillPending).toBeUndefined();

          const rootPoolLeafPool = result.entities.RootPool_LeafPool.get(
            RootPoolLeafPoolId(
              rootChainId,
              leafChainId,
              rootPoolAddress,
              leafPoolAddress,
            ),
          );
          expect(rootPoolLeafPool).toBeDefined();

          const processedPendingVote = result.entities.PendingVote.get(
            PendingVoteId(rootChainId, rootPoolAddress, voteTokenId, txHash, 2),
          );
          expect(processedPendingVote).toBeUndefined();

          const leafPool = result.entities.LiquidityPoolAggregator.get(
            PoolId(leafChainId, leafPoolAddress),
          );
          expect(leafPool).toBeDefined();
          expect(leafPool?.veNFTamountStaked).toBe(voteWeight);
        }
      });

      // TODO: Skip until envio migrates to createTestIndexer — vi.spyOn can't intercept tsx-loaded modules (alpha.18)
      it.skip("should flush PendingDistribution when processing RootPoolCreated, GaugeCreated, DistributeReward, then CLFactory.PoolCreated (cross-chain E2E)", async () => {
        const gaugeAddress = toChecksumAddress(
          "0xa75127121d28a9bf848f3b70e7eea26570aa7700",
        );
        const leafGaugeAddress = toChecksumAddress(
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        );
        const { createMockLiquidityPoolAggregator, createMockToken } =
          setupCommon();
        const distAmount = 1000n * 10n ** 18n;
        const tokensDepositedMock = 500n * 10n ** 18n;

        const rewardTokenAddress =
          CHAIN_CONSTANTS[rootChainId].rewardToken(blockNumber);
        const rewardToken = createMockToken({
          id: TokenId(rootChainId, rewardTokenAddress),
          address: toChecksumAddress(rewardTokenAddress),
          symbol: "VELO",
          name: "VELO",
          chainId: rootChainId,
          decimals: 18n,
          pricePerUSDNew: 2n * 10n ** 18n,
          isWhitelisted: true,
          lastUpdatedTimestamp: new Date(blockTimestamp * 1000),
        });

        vi.spyOn(
          getTokensDeposited as unknown as {
            handler: (args: { input: unknown }) => Promise<bigint | undefined>;
          },
          "handler",
        ).mockImplementation(async () => tokensDepositedMock);

        const e2e = setupCrossChainFlushE2E({
          rootChainId,
          leafChainId,
          rootPoolAddress,
          leafPoolAddress,
          blockTimestamp,
          blockNumber,
          txHash,
          token0Address,
          token1Address,
          tickSpacing: TICK_SPACING,
        });

        {
          const fullPool = createMockLiquidityPoolAggregator({
            id: PoolId(leafChainId, leafPoolAddress),
            chainId: leafChainId,
            token0_id: TokenId(leafChainId, token0Address),
            token1_id: TokenId(leafChainId, token1Address),
            token0_address: token0Address,
            token1_address: token1Address,
            veNFTamountStaked: 0n,
            totalEmissions: 0n,
            totalEmissionsUSD: 0n,
            totalVotesDeposited: 0n,
            totalVotesDepositedUSD: 0n,
            gaugeAddress: leafGaugeAddress,
          });
          processSpy.mockImplementation(async (_event, ..._rest) => ({
            liquidityPoolAggregator: fullPool,
          }));

          const db = e2e.db.entities.Token.set(rewardToken);

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
                number: blockNumber,
                timestamp: blockTimestamp,
                hash: txHash,
              },
              chainId: rootChainId,
              logIndex: 2,
            },
          });
          const distributeRewardEvent = Voter.DistributeReward.createMockEvent({
            gauge: gaugeAddress,
            amount: distAmount,
            mockEventData: {
              block: {
                number: blockNumber,
                timestamp: blockTimestamp,
                hash: txHash,
              },
              chainId: rootChainId,
              logIndex: 3,
              srcAddress: toChecksumAddress(
                "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
              ),
            },
          });

          const afterRoot = await db.processEvents([
            e2e.rootPoolCreatedEvent,
            gaugeCreatedEvent,
            distributeRewardEvent,
          ]);

          expect(
            afterRoot.entities.PendingRootPoolMapping.get(
              PendingRootPoolMappingId(rootChainId, rootPoolAddress),
            ),
          ).toBeDefined();
          expect(
            afterRoot.entities.RootGauge_RootPool.get(
              RootGaugeRootPoolId(rootChainId, gaugeAddress),
            ),
          ).toBeDefined();
          const pendingDistId = PendingDistributionId(
            rootChainId,
            rootPoolAddress,
            blockNumber,
            3,
          );
          expect(
            afterRoot.entities.PendingDistribution.get(pendingDistId),
          ).toBeDefined();

          const clFactoryPoolCreatedEvent = e2e.createClFactoryPoolCreatedEvent(
            1,
            1,
          );

          const result = await afterRoot.processEvents([
            clFactoryPoolCreatedEvent,
          ]);

          expect(
            result.entities.PendingRootPoolMapping.get(
              PendingRootPoolMappingId(rootChainId, rootPoolAddress),
            ),
          ).toBeUndefined();
          expect(
            result.entities.RootPool_LeafPool.get(
              RootPoolLeafPoolId(
                rootChainId,
                leafChainId,
                rootPoolAddress,
                leafPoolAddress,
              ),
            ),
          ).toBeDefined();
          expect(
            result.entities.PendingDistribution.get(pendingDistId),
          ).toBeUndefined();

          const leafPool = result.entities.LiquidityPoolAggregator.get(
            PoolId(leafChainId, leafPoolAddress),
          );
          expect(leafPool).toBeDefined();
          expect(leafPool?.totalEmissions).toBe(distAmount);
          expect(leafPool?.totalVotesDeposited).toBe(tokensDepositedMock);
          expect(leafPool?.gaugeAddress).toBe(leafGaugeAddress);
          vi.restoreAllMocks();
        }
      });

      it("should flush multiple PendingVotes for same root pool when CLFactory.PoolCreated is processed", async () => {
        const rootPoolAddress = toChecksumAddress(
          "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
        );
        const { createMockLiquidityPoolAggregator, createMockVeNFTState } =
          setupCommon();
        const voteWeight1 = 100n;
        const voteWeight2 = 200n;
        const tokenId1 = 1n;
        const tokenId2 = 2n;
        const timestampMs = (mockEvent.block.timestamp as number) * 1000;
        const ownerAddress1 = toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        );
        const ownerAddress2 = toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        );

        const fullPool = createMockLiquidityPoolAggregator({
          id: PoolId(chainId, poolAddress),
          chainId,
          token0_id: TokenId(chainId, token0Address),
          token1_id: TokenId(chainId, token1Address),
          token0_address: token0Address,
          token1_address: token1Address,
          veNFTamountStaked: 0n,
        });
        processSpy.mockImplementation(async () => ({
          liquidityPoolAggregator: fullPool,
        }));

        const hash = rootPoolMatchingHash(
          chainId,
          token0Address,
          token1Address,
          TICK_SPACING,
        );
        const pendingMapping = {
          id: PendingRootPoolMappingId(chainId, rootPoolAddress),
          rootChainId: chainId,
          rootPoolAddress,
          leafChainId: chainId,
          token0: token0Address,
          token1: token1Address,
          tickSpacing: TICK_SPACING,
          rootPoolMatchingHash: hash,
        };
        const txHash = mockEvent.transaction?.hash ?? "0xhash";
        const pendingVote1 = {
          id: PendingVoteId(chainId, rootPoolAddress, tokenId1, txHash, 1),
          chainId,
          rootPoolAddress,
          tokenId: tokenId1,
          weight: voteWeight1,
          eventType: "Voted",
          timestamp: new Date(timestampMs),
          blockNumber: BigInt(mockEvent.block.number),
          transactionHash: txHash,
        };
        const pendingVote2 = {
          id: PendingVoteId(chainId, rootPoolAddress, tokenId2, txHash, 2),
          chainId,
          rootPoolAddress,
          tokenId: tokenId2,
          weight: voteWeight2,
          eventType: "Voted",
          timestamp: new Date(timestampMs + 1),
          blockNumber: BigInt(mockEvent.block.number),
          transactionHash: txHash,
        };
        const veNFTState1 = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId1),
          chainId,
          tokenId: tokenId1,
          owner: ownerAddress1,
        });
        const veNFTState2 = createMockVeNFTState({
          id: VeNFTId(chainId, tokenId2),
          chainId,
          tokenId: tokenId2,
          owner: ownerAddress2,
        });

        let db = MockDb.createMockDb();
        db = setupMockDbWithEntities(db);
        db = db.entities.PendingRootPoolMapping.set(pendingMapping);
        db = db.entities.PendingVote.set(pendingVote1);
        db = db.entities.PendingVote.set(pendingVote2);
        db = db.entities.VeNFTState.set(veNFTState1);
        db = db.entities.VeNFTState.set(veNFTState2);

        const result = await db.processEvents([mockEvent]);

        expect(
          result.entities.PendingVote.get(pendingVote1.id),
        ).toBeUndefined();
        expect(
          result.entities.PendingVote.get(pendingVote2.id),
        ).toBeUndefined();

        const rootPoolLeafPool = result.entities.RootPool_LeafPool.get(
          RootPoolLeafPoolId(chainId, chainId, rootPoolAddress, poolAddress),
        );
        expect(rootPoolLeafPool).toBeDefined();

        const leafPool = result.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(leafPool).toBeDefined();
        expect(leafPool?.veNFTamountStaked).toBe(voteWeight1 + voteWeight2);
      });
    });
  });

  describe("TickSpacingEnabled event", () => {
    // Shared constants
    const CHAIN_ID = 10;
    const TICK_SPACING = 100n;
    const FEE = 500n;
    const BLOCK_TIMESTAMP = 1000000;
    const BLOCK_NUMBER = 123456;
    const BLOCK_HASH =
      "0x1234567890123456789012345678901234567890123456789012345678901234";

    let mockDb: ReturnType<typeof MockDb.createMockDb>;

    const createMockEvent = (
      tickSpacing: bigint,
      fee: bigint,
      overrides: {
        chainId?: number;
        timestamp?: number;
        number?: number;
        logIndex?: number;
      } = {},
    ) => {
      return CLFactory.TickSpacingEnabled.createMockEvent({
        tickSpacing,
        fee,
        mockEventData: {
          block: {
            timestamp: overrides.timestamp ?? BLOCK_TIMESTAMP,
            number: overrides.number ?? BLOCK_NUMBER,
            hash: BLOCK_HASH,
          },
          chainId: overrides.chainId ?? CHAIN_ID,
          logIndex: overrides.logIndex ?? 1,
        },
      });
    };

    beforeEach(() => {
      mockDb = MockDb.createMockDb();
    });

    it("should create a new mapping when it doesn't exist", async () => {
      const mappingId = FeeToTickSpacingMappingId(CHAIN_ID, TICK_SPACING);
      const mockEvent = createMockEvent(TICK_SPACING, FEE);

      const result = await mockDb.processEvents([mockEvent]);

      const mapping = result.entities.FeeToTickSpacingMapping.get(mappingId);
      expect(mapping).toBeDefined();
      expect(mapping?.id).toBe(mappingId);
      expect(mapping?.chainId).toBe(CHAIN_ID);
      expect(mapping?.tickSpacing).toBe(TICK_SPACING);
      expect(mapping?.fee).toBe(FEE);
      expect(mapping?.lastUpdatedTimestamp).toEqual(
        new Date(BLOCK_TIMESTAMP * 1000),
      );
    });

    it("should update existing mapping when it already exists", async () => {
      const mappingId = FeeToTickSpacingMappingId(CHAIN_ID, TICK_SPACING);
      const oldFee = 400n;
      const newFee = 600n;
      const oldTimestamp = 500000;
      const newTimestamp = 2000000;

      // Create existing mapping
      const existingMapping = {
        id: mappingId,
        chainId: CHAIN_ID,
        tickSpacing: TICK_SPACING,
        fee: oldFee,
        lastUpdatedTimestamp: new Date(oldTimestamp * 1000),
      };
      mockDb = mockDb.entities.FeeToTickSpacingMapping.set(existingMapping);

      const mockEvent = createMockEvent(TICK_SPACING, newFee, {
        timestamp: newTimestamp,
        number: 123457,
        logIndex: 2,
      });

      const result = await mockDb.processEvents([mockEvent]);

      const updatedMapping =
        result.entities.FeeToTickSpacingMapping.get(mappingId);
      expect(updatedMapping).toBeDefined();
      expect(updatedMapping?.fee).toBe(newFee);
      expect(updatedMapping?.lastUpdatedTimestamp).toEqual(
        new Date(newTimestamp * 1000),
      );
      // Verify other fields are preserved
      expect(updatedMapping?.id).toBe(mappingId);
      expect(updatedMapping?.chainId).toBe(CHAIN_ID);
      expect(updatedMapping?.tickSpacing).toBe(TICK_SPACING);
    });

    it.each([
      {
        name: "different tick spacings on same chain",
        mappings: [
          { tickSpacing: 100n, fee: 500n, chainId: CHAIN_ID },
          { tickSpacing: 200n, fee: 300n, chainId: CHAIN_ID },
        ],
      },
      {
        name: "same tick spacing on different chains",
        mappings: [
          { tickSpacing: TICK_SPACING, fee: 500n, chainId: 10 },
          { tickSpacing: TICK_SPACING, fee: 400n, chainId: 8453 },
        ],
      },
    ])(
      "should handle multiple mappings correctly: $name",
      async ({ mappings }) => {
        let result = mockDb;
        const expectedMappings: Array<{
          id: string;
          chainId: number;
          tickSpacing: bigint;
          fee: bigint;
        }> = [];

        for (const mapping of mappings) {
          const mappingId = FeeToTickSpacingMappingId(
            mapping.chainId,
            mapping.tickSpacing,
          );
          expectedMappings.push({
            id: mappingId,
            chainId: mapping.chainId,
            tickSpacing: mapping.tickSpacing,
            fee: mapping.fee,
          });

          const mockEvent = createMockEvent(mapping.tickSpacing, mapping.fee, {
            chainId: mapping.chainId,
          });

          result = await result.processEvents([mockEvent]);
        }

        // Verify all mappings were created correctly
        for (const expected of expectedMappings) {
          const mapping = result.entities.FeeToTickSpacingMapping.get(
            expected.id,
          );
          expect(mapping).toBeDefined();
          expect(mapping?.chainId).toBe(expected.chainId);
          expect(mapping?.tickSpacing).toBe(expected.tickSpacing);
          expect(mapping?.fee).toBe(expected.fee);
        }
      },
    );
  });
});
