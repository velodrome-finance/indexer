import type { CLGaugeConfig, Token } from "envio";
import { createTestIndexer } from "envio";
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
import { rehydrateTimestamps } from "../../src/EntityTimestamps";
import { setupCommon } from "./Pool/common";

describe("CLFactory Events", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  // Use Base (8453) — chainId-keyed CLGaugeConfig has a row for 8453 via CLGaugeFactoryV2
  const chainId = 8453 as const;
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

  function setupIndexerWithEntities(
    indexer: ReturnType<typeof createTestIndexer>,
    options: {
      includeFeeToTickSpacing?: boolean;
      clGaugeConfigChainId?: number;
    } = {},
  ): void {
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
    indexer.Token.set(token0ForBase);
    indexer.Token.set(token1ForBase);
    const clGaugeConfig = {
      id: String(clGaugeConfigChainId),
      defaultEmissionsCap: 0n,
      defaultMinStakeTime: 0n,
      penaltyRate: 0n,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } satisfies CLGaugeConfig;
    indexer.CLGaugeConfig.set(clGaugeConfig);
    if (includeFeeToTickSpacing) {
      const feeToTickSpacingMapping = createFeeToTickSpacingMapping();
      indexer.FeeToTickSpacingMapping.set(feeToTickSpacingMapping);
    }
  }

  describe("PoolCreated event", () => {
    let indexer: ReturnType<typeof createTestIndexer>;

    beforeEach(async () => {
      indexer = createTestIndexer();
      setupIndexerWithEntities(indexer);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "PoolCreated",
                srcAddress: poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress,
                  tickSpacing: TICK_SPACING,
                },
              },
            ],
          },
        },
      });
    });

    it("should set the liquidity pool aggregator entity", async () => {
      const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(pool).toBeDefined();
      expect(pool?.id).toBe(PoolId(chainId, poolAddress));
      expect(pool?.chainId).toBe(chainId);
      expect(pool?.isCL).toBe(true);
    });

    it("should process event even during preload phase", async () => {
      const preloadIndexer = createTestIndexer();
      setupIndexerWithEntities(preloadIndexer);

      // Verify the mapping exists before processing (using the same key format as the handler)
      const mappingKey = FeeToTickSpacingMappingId(chainId, TICK_SPACING);
      const mappingBefore =
        await preloadIndexer.FeeToTickSpacingMapping.get(mappingKey);
      expect(mappingBefore).toBeDefined(); // Verify mapping exists before processing

      // Handlers now run during both preload and normal phases
      await preloadIndexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "PoolCreated",
                srcAddress: poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress,
                  tickSpacing: TICK_SPACING,
                },
              },
            ],
          },
        },
      });

      // Verify that the handler ran (pool should be created if mapping exists)
      const pool = await preloadIndexer.Pool.get(PoolId(chainId, poolAddress));

      // Since we verified the mapping exists, the handler should have run and created the pool
      expect(pool).toBeDefined();
    });

    it("should set baseFee and currentFee from FeeToTickSpacingMapping when mapping exists", async () => {
      const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
      expect(pool?.baseFee).toBe(500n);
      expect(pool?.currentFee).toBe(500n);
    });

    it("should handle missing FeeToTickSpacingMapping gracefully", async () => {
      const indexerNoMapping = createTestIndexer();
      setupIndexerWithEntities(indexerNoMapping, {
        includeFeeToTickSpacing: false,
      });

      await indexerNoMapping.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "PoolCreated",
                srcAddress: poolAddress as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: token1Address as `0x${string}`,
                  pool: poolAddress,
                  tickSpacing: TICK_SPACING,
                },
              },
            ],
          },
        },
      });

      const pool = await indexerNoMapping.Pool.get(
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

        const idx = createTestIndexer();
        setupIndexerWithEntities(idx);
        idx.PendingRootPoolMapping.set(pendingMapping);

        await idx.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "CLFactory",
                  event: "PoolCreated",
                  srcAddress: poolAddress as `0x${string}`,
                  logIndex: 1,
                  block: {
                    number: 1000000,
                    timestamp: 1000000,
                    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                  },
                  params: {
                    token0: token0Address as `0x${string}`,
                    token1: token1Address as `0x${string}`,
                    pool: poolAddress,
                    tickSpacing: TICK_SPACING,
                  },
                },
              ],
            },
          },
        });

        const rootPoolLeafPool = await idx.RootPool_LeafPool.get(
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

        const stillPending = await idx.PendingRootPoolMapping.get(
          pendingMapping.id,
        );
        expect(stillPending).toBeUndefined();
      });

      it("should flush pending votes when PendingVote and VeNFTState exist", async () => {
        const { createMockVeNFTState } = setupCommon();

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
        const blockTimestamp = 1000000;
        const blockNumber = 1000000;
        const blockHash =
          "0x1234567890123456789012345678901234567890123456789012345678901234";
        const txHash = blockHash;
        const logIndex = 1;
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
          timestamp: new Date(blockTimestamp * 1000),
          blockNumber: BigInt(blockNumber),
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

        const idx = createTestIndexer();
        setupIndexerWithEntities(idx);
        idx.PendingRootPoolMapping.set(pendingMapping);
        idx.PendingVote.set(pendingVote);
        idx.VeNFTState.set(veNFTState);

        await idx.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "CLFactory",
                  event: "PoolCreated",
                  srcAddress: poolAddress as `0x${string}`,
                  logIndex,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: blockHash,
                  },
                  params: {
                    token0: token0Address as `0x${string}`,
                    token1: token1Address as `0x${string}`,
                    pool: poolAddress,
                    tickSpacing: TICK_SPACING,
                  },
                },
              ],
            },
          },
        });

        const rootPoolLeafPool = await idx.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            rootChainId,
            chainId,
            rootPoolAddress,
            poolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeDefined();

        const processedPendingVote = await idx.PendingVote.get(pendingVote.id);
        expect(processedPendingVote).toBeUndefined();

        const leafPool = await idx.Pool.get(PoolId(chainId, poolAddress));
        expect(leafPool?.veNFTamountStaked).toBe(voteWeight);
      });
    });

    describe("full E2E: root ahead then leaf catches up (flush)", () => {
      const rootChainId = 10 as const;
      const leafChainId = 252 as const; // Fraxtal
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
        idx: ReturnType<typeof createTestIndexer>,
        leafChain: number,
        leafToken0: string,
        leafToken1: string,
        tickSpacing: bigint,
        fee: bigint = FEE,
      ): void {
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
        idx.Token.set(token0ForLeaf);
        idx.Token.set(token1ForLeaf);
        const clGaugeConfig = {
          id: String(leafChain),
          defaultEmissionsCap: 0n,
          defaultMinStakeTime: 0n,
          penaltyRate: 0n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } satisfies CLGaugeConfig;
        idx.CLGaugeConfig.set(clGaugeConfig);
        const feeToTickSpacingMapping = {
          id: FeeToTickSpacingMappingId(leafChain, tickSpacing),
          chainId: leafChain,
          tickSpacing,
          fee,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        };
        idx.FeeToTickSpacingMapping.set(feeToTickSpacingMapping);
      }

      function setupCrossChainFlushE2E(options: {
        rootChainId: typeof rootChainId;
        leafChainId: typeof leafChainId;
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

        const idx = createTestIndexer();
        setupLeafChainEntities(idx, lcid, t0, t1, ts2, fee);

        const rootPoolCreatedSimulate = {
          contract: "RootCLPoolFactory" as const,
          event: "RootPoolCreated" as const,
          srcAddress: rpa as `0x${string}`,
          logIndex: 1,
          block: { timestamp: ts, number: bn, hash },
          params: {
            token0: t0 as `0x${string}`,
            token1: t1 as `0x${string}`,
            tickSpacing: ts2,
            chainid: BigInt(lcid),
            pool: rpa as `0x${string}`,
          },
        };

        const createClFactoryPoolCreatedSimulate = (
          blockOffset = 1,
          timestampOffset = 1,
        ) => ({
          contract: "CLFactory" as const,
          event: "PoolCreated" as const,
          srcAddress: lpa as `0x${string}`,
          logIndex: 1,
          block: {
            number: bn + blockOffset,
            timestamp: ts + timestampOffset,
            hash,
          },
          params: {
            token0: t0 as `0x${string}`,
            token1: t1 as `0x${string}`,
            pool: lpa as `0x${string}`,
            tickSpacing: ts2,
          },
        });

        return {
          indexer: idx,
          rootPoolCreatedSimulate,
          createClFactoryPoolCreatedSimulate,
          rcid,
          lcid,
        };
      }

      it("should flush PendingRootPoolMapping and PendingVote when processing RootPoolCreated, Voted, then CLFactory.PoolCreated (two processEvents: root chain 10, leaf chain 252)", async () => {
        const { createMockVeNFTState } = setupCommon();
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
          const veNFTState = createMockVeNFTState({
            id: VeNFTId(rootChainId, voteTokenId),
            chainId: rootChainId,
            tokenId: voteTokenId,
            owner: ownerAddress,
          });

          e2e.indexer.VeNFTState.set(veNFTState);

          // Root chain first: RootPoolCreated + Voted create the
          // PendingRootPoolMapping + PendingVote.
          await e2e.indexer.process({
            chains: {
              [rootChainId]: {
                simulate: [
                  e2e.rootPoolCreatedSimulate,
                  {
                    contract: "Voter",
                    event: "Voted",
                    srcAddress: toChecksumAddress(
                      "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
                    ) as `0x${string}`,
                    logIndex: 2,
                    block: {
                      number: blockNumber,
                      timestamp: blockTimestamp,
                      hash: txHash,
                    },
                    transaction: { hash: txHash },
                    params: {
                      voter: ownerAddress,
                      pool: rootPoolAddress,
                      tokenId: voteTokenId,
                      weight: voteWeight,
                      totalWeight: 1000n,
                    },
                  },
                ],
              },
            },
          });

          // The leaf CLFactory.PoolCreated runs on a FRESH indexer carrying the
          // post-root state. createTestIndexer supports only ONE process() per
          // indexer (a 2nd process(), or a 2nd chain in the same process(),
          // re-persists batch-1 entities whose Timestamp fields have
          // round-tripped to strings and the writer throws date.toISOString).
          // Re-seeding the rehydrated entities reproduces the "root ahead, leaf
          // catches up" world the leaf event flushes.
          const leafIndexer = createTestIndexer();
          for (const e of await e2e.indexer.Token.getAll())
            leafIndexer.Token.set(rehydrateTimestamps("Token", e));
          for (const e of await e2e.indexer.CLGaugeConfig.getAll())
            leafIndexer.CLGaugeConfig.set(
              rehydrateTimestamps("CLGaugeConfig", e),
            );
          for (const e of await e2e.indexer.FeeToTickSpacingMapping.getAll())
            leafIndexer.FeeToTickSpacingMapping.set(
              rehydrateTimestamps("FeeToTickSpacingMapping", e),
            );
          for (const e of await e2e.indexer.VeNFTState.getAll())
            leafIndexer.VeNFTState.set(rehydrateTimestamps("VeNFTState", e));
          for (const e of await e2e.indexer.PendingVote.getAll())
            leafIndexer.PendingVote.set(rehydrateTimestamps("PendingVote", e));
          // PendingRootPoolMapping has no Timestamp field — copy as-is.
          for (const e of await e2e.indexer.PendingRootPoolMapping.getAll())
            leafIndexer.PendingRootPoolMapping.set(e);

          const clFactoryPoolCreatedSimulate =
            e2e.createClFactoryPoolCreatedSimulate(1, 1);

          await leafIndexer.process({
            chains: {
              [leafChainId]: {
                simulate: [clFactoryPoolCreatedSimulate],
              },
            },
          });

          const stillPending = await leafIndexer.PendingRootPoolMapping.get(
            PendingRootPoolMappingId(rootChainId, rootPoolAddress),
          );
          expect(stillPending).toBeUndefined();

          const rootPoolLeafPool = await leafIndexer.RootPool_LeafPool.get(
            RootPoolLeafPoolId(
              rootChainId,
              leafChainId,
              rootPoolAddress,
              leafPoolAddress,
            ),
          );
          expect(rootPoolLeafPool).toBeDefined();

          const processedPendingVote = await leafIndexer.PendingVote.get(
            PendingVoteId(rootChainId, rootPoolAddress, voteTokenId, txHash, 2),
          );
          expect(processedPendingVote).toBeUndefined();

          const leafPool = await leafIndexer.Pool.get(
            PoolId(leafChainId, leafPoolAddress),
          );
          expect(leafPool).toBeDefined();
          expect(leafPool?.veNFTamountStaked).toBe(voteWeight);
        }
      });

      it("should flush multiple PendingVotes for same root pool when CLFactory.PoolCreated is processed", async () => {
        const rootPoolAddressMulti = toChecksumAddress(
          "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
        );
        const { createMockVeNFTState } = setupCommon();
        const voteWeight1 = 100n;
        const voteWeight2 = 200n;
        const tokenId1 = 1n;
        const tokenId2 = 2n;
        const blockTimestampMs = blockTimestamp * 1000;
        const ownerAddress1 = toChecksumAddress(
          "0x2222222222222222222222222222222222222222",
        );
        const ownerAddress2 = toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        );

        const hash = rootPoolMatchingHash(
          chainId,
          token0Address,
          token1Address,
          TICK_SPACING,
        );
        const pendingMapping = {
          id: PendingRootPoolMappingId(chainId, rootPoolAddressMulti),
          rootChainId: chainId,
          rootPoolAddress: rootPoolAddressMulti,
          leafChainId: chainId,
          token0: token0Address,
          token1: token1Address,
          tickSpacing: TICK_SPACING,
          rootPoolMatchingHash: hash,
        };
        const blockHash =
          "0x1234567890123456789012345678901234567890123456789012345678901234";
        const txHashMulti = blockHash;
        const pendingVote1 = {
          id: PendingVoteId(
            chainId,
            rootPoolAddressMulti,
            tokenId1,
            txHashMulti,
            1,
          ),
          chainId,
          rootPoolAddress: rootPoolAddressMulti,
          tokenId: tokenId1,
          weight: voteWeight1,
          eventType: "Voted",
          timestamp: new Date(blockTimestampMs),
          blockNumber: BigInt(blockNumber),
          transactionHash: txHashMulti,
        };
        const pendingVote2 = {
          id: PendingVoteId(
            chainId,
            rootPoolAddressMulti,
            tokenId2,
            txHashMulti,
            2,
          ),
          chainId,
          rootPoolAddress: rootPoolAddressMulti,
          tokenId: tokenId2,
          weight: voteWeight2,
          eventType: "Voted",
          timestamp: new Date(blockTimestampMs + 1),
          blockNumber: BigInt(blockNumber),
          transactionHash: txHashMulti,
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

        const idx = createTestIndexer();
        setupIndexerWithEntities(idx);
        idx.PendingRootPoolMapping.set(pendingMapping);
        idx.PendingVote.set(pendingVote1);
        idx.PendingVote.set(pendingVote2);
        idx.VeNFTState.set(veNFTState1);
        idx.VeNFTState.set(veNFTState2);

        await idx.process({
          chains: {
            [chainId]: {
              simulate: [
                {
                  contract: "CLFactory",
                  event: "PoolCreated",
                  srcAddress: poolAddress as `0x${string}`,
                  logIndex: 1,
                  block: {
                    number: blockNumber,
                    timestamp: blockTimestamp,
                    hash: blockHash,
                  },
                  params: {
                    token0: token0Address as `0x${string}`,
                    token1: token1Address as `0x${string}`,
                    pool: poolAddress,
                    tickSpacing: TICK_SPACING,
                  },
                },
              ],
            },
          },
        });

        expect(await idx.PendingVote.get(pendingVote1.id)).toBeUndefined();
        expect(await idx.PendingVote.get(pendingVote2.id)).toBeUndefined();

        const rootPoolLeafPool = await idx.RootPool_LeafPool.get(
          RootPoolLeafPoolId(
            chainId,
            chainId,
            rootPoolAddressMulti,
            poolAddress,
          ),
        );
        expect(rootPoolLeafPool).toBeDefined();

        const leafPool = await idx.Pool.get(PoolId(chainId, poolAddress));
        expect(leafPool).toBeDefined();
        expect(leafPool?.veNFTamountStaked).toBe(voteWeight1 + voteWeight2);
      });
    });
  });

  describe("TickSpacingEnabled event", () => {
    // Shared constants
    const CHAIN_ID = 10 as const;
    const TICK_SPACING = 100n;
    const FEE = 500n;
    const BLOCK_TIMESTAMP = 1000000;
    const BLOCK_NUMBER = 123456;
    const BLOCK_HASH =
      "0x1234567890123456789012345678901234567890123456789012345678901234";

    let indexer: ReturnType<typeof createTestIndexer>;

    beforeEach(() => {
      indexer = createTestIndexer();
    });

    it("should create a new mapping when it doesn't exist", async () => {
      const mappingId = FeeToTickSpacingMappingId(CHAIN_ID, TICK_SPACING);

      await indexer.process({
        chains: {
          [CHAIN_ID]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "TickSpacingEnabled",
                srcAddress: toChecksumAddress(
                  "0x1111111111111111111111111111111111111111",
                ) as `0x${string}`,
                logIndex: 1,
                block: {
                  timestamp: BLOCK_TIMESTAMP,
                  number: BLOCK_NUMBER,
                  hash: BLOCK_HASH,
                },
                params: {
                  tickSpacing: TICK_SPACING,
                  fee: FEE,
                },
              },
            ],
          },
        },
      });

      const rawMapping = await indexer.FeeToTickSpacingMapping.get(mappingId);
      const mapping = rawMapping
        ? rehydrateTimestamps("FeeToTickSpacingMapping", rawMapping)
        : undefined;
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
      indexer.FeeToTickSpacingMapping.set(existingMapping);

      await indexer.process({
        chains: {
          [CHAIN_ID]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "TickSpacingEnabled",
                srcAddress: toChecksumAddress(
                  "0x1111111111111111111111111111111111111111",
                ) as `0x${string}`,
                logIndex: 2,
                block: {
                  timestamp: newTimestamp,
                  number: 123457,
                  hash: BLOCK_HASH,
                },
                params: {
                  tickSpacing: TICK_SPACING,
                  fee: newFee,
                },
              },
            ],
          },
        },
      });

      const rawUpdatedMapping =
        await indexer.FeeToTickSpacingMapping.get(mappingId);
      const updatedMapping = rawUpdatedMapping
        ? rehydrateTimestamps("FeeToTickSpacingMapping", rawUpdatedMapping)
        : undefined;
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
          { tickSpacing: 100n, fee: 500n, chainId: CHAIN_ID as number },
          { tickSpacing: 200n, fee: 300n, chainId: CHAIN_ID as number },
        ],
      },
      {
        name: "same tick spacing on different chains",
        mappings: [
          { tickSpacing: TICK_SPACING, fee: 500n, chainId: 10 as number },
          { tickSpacing: TICK_SPACING, fee: 400n, chainId: 8453 as number },
        ],
      },
    ])(
      "should handle multiple mappings correctly: $name",
      async ({ mappings }) => {
        const multiIndexer = createTestIndexer();
        const expectedMappings: Array<{
          id: string;
          chainId: number;
          tickSpacing: bigint;
          fee: bigint;
        }> = [];

        // Group events by chainId so same-chain events go in a single process() call
        const byChain = new Map<
          number,
          Array<(typeof mappings)[number] & { logIndex: number }>
        >();
        let logCounter = 0;
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
          const chain = byChain.get(mapping.chainId) ?? [];
          chain.push({ ...mapping, logIndex: ++logCounter });
          byChain.set(mapping.chainId, chain);
        }

        for (const [cid, chainMappings] of byChain) {
          await multiIndexer.process({
            chains: {
              [cid]: {
                simulate: chainMappings.map((m) => ({
                  contract: "CLFactory" as const,
                  event: "TickSpacingEnabled" as const,
                  srcAddress: toChecksumAddress(
                    "0x1111111111111111111111111111111111111111",
                  ) as `0x${string}`,
                  logIndex: m.logIndex,
                  block: {
                    timestamp: BLOCK_TIMESTAMP,
                    number: BLOCK_NUMBER,
                    hash: BLOCK_HASH,
                  },
                  params: {
                    tickSpacing: m.tickSpacing,
                    fee: m.fee,
                  },
                })),
              },
            },
          });
        }

        // Verify all mappings were created correctly
        for (const expected of expectedMappings) {
          const mapping = await multiIndexer.FeeToTickSpacingMapping.get(
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

// Slipstream same-tx ordering: CLPool.Initialize fires BEFORE
// CLFactory.PoolCreated within the same transaction, at a lower log index.
// CLPool.Initialize buffers sqrtPriceX96/tick into CLPoolPendingInitialize;
// CLFactory.PoolCreated must consume that buffer when constructing the
// aggregator so the aggregator is born with the correct opening price, then
// delete the buffer entry.
describe("CLFactory.PoolCreated ↔ CLPoolPendingInitialize buffer", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const chainId = 8453 as const;
  const poolAddress = toChecksumAddress(
    "0x565aecF84b5d30a6E79a5CEf3f0dA0Fc4280dEBC",
  );
  const TICK_SPACING = 60n;
  const FEE = 500n;
  const sqrtPriceX96 = 79228162514264337593543950336n; // sqrt(1) << 96
  const tick = -887n;

  function seedIndexer(idx: ReturnType<typeof createTestIndexer>): void {
    const token0 = {
      ...mockToken0Data,
      id: TokenId(chainId, mockToken0Data.address),
      chainId,
    } satisfies Token;
    const token1 = {
      ...mockToken1Data,
      id: TokenId(chainId, mockToken1Data.address),
      chainId,
    } satisfies Token;
    idx.Token.set(token0);
    idx.Token.set(token1);
    idx.CLGaugeConfig.set({
      id: String(chainId),
      defaultEmissionsCap: 0n,
      defaultMinStakeTime: 0n,
      penaltyRate: 0n,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } satisfies CLGaugeConfig);
    idx.FeeToTickSpacingMapping.set({
      id: FeeToTickSpacingMappingId(chainId, TICK_SPACING),
      chainId,
      tickSpacing: TICK_SPACING,
      fee: FEE,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    });
  }

  it("creates the aggregator with the buffered sqrtPriceX96/tick when CLPoolPendingInitialize is present", async () => {
    const indexer = createTestIndexer();
    seedIndexer(indexer);
    // Pre-seed the buffer as if CLPool.Initialize had run first.
    indexer.CLPoolPendingInitialize.set({
      id: PoolId(chainId, poolAddress),
      chainId,
      poolAddress,
      sqrtPriceX96,
      tick,
    });

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLFactory",
              event: "PoolCreated",
              srcAddress: poolAddress as `0x${string}`,
              logIndex: 313,
              block: {
                number: 13901333,
                timestamp: 1700000000,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: {
                token0: mockToken0Data.address as `0x${string}`,
                token1: mockToken1Data.address as `0x${string}`,
                pool: poolAddress,
                tickSpacing: TICK_SPACING,
              },
            },
          ],
        },
      },
    });

    const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    expect(pool).toBeDefined();
    if (!pool) return;
    expect(pool.sqrtPriceX96).toBe(sqrtPriceX96);
    expect(pool.tick).toBe(tick);
  });

  it("deletes CLPoolPendingInitialize after consuming it", async () => {
    const indexer = createTestIndexer();
    seedIndexer(indexer);
    indexer.CLPoolPendingInitialize.set({
      id: PoolId(chainId, poolAddress),
      chainId,
      poolAddress,
      sqrtPriceX96,
      tick,
    });

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLFactory",
              event: "PoolCreated",
              srcAddress: poolAddress as `0x${string}`,
              logIndex: 313,
              block: {
                number: 13901333,
                timestamp: 1700000000,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: {
                token0: mockToken0Data.address as `0x${string}`,
                token1: mockToken1Data.address as `0x${string}`,
                pool: poolAddress,
                tickSpacing: TICK_SPACING,
              },
            },
          ],
        },
      },
    });

    expect(
      await indexer.CLPoolPendingInitialize.get(PoolId(chainId, poolAddress)),
    ).toBeUndefined();
  });

  it("creates the aggregator with default 0n sqrtPriceX96/tick when no buffer is present (pre-Slipstream factories)", async () => {
    const indexer = createTestIndexer();
    seedIndexer(indexer);

    await indexer.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "CLFactory",
              event: "PoolCreated",
              srcAddress: poolAddress as `0x${string}`,
              logIndex: 313,
              block: {
                number: 13901333,
                timestamp: 1700000000,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: {
                token0: mockToken0Data.address as `0x${string}`,
                token1: mockToken1Data.address as `0x${string}`,
                pool: poolAddress,
                tickSpacing: TICK_SPACING,
              },
            },
          ],
        },
      },
    });

    const pool = await indexer.Pool.get(PoolId(chainId, poolAddress));
    expect(pool).toBeDefined();
    if (!pool) return;
    expect(pool.sqrtPriceX96).toBe(0n);
    expect(pool.tick).toBe(0n);
  });
});
