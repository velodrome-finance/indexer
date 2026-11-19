import type { CLGaugeConfig, Token } from "envio";
import { createTestIndexer } from "envio";
import {
  FeeToTickSpacingMappingId,
  PoolId,
  TokenId,
  VeNFTId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../../src/Constants";
import { rehydrateTimestamps } from "../../src/EntityTimestamps";
import {
  RootPoolId,
  RootPoolVoteId,
} from "../../src/EventHandlers/Voter/RootPoolLogic";
import type { WithChain } from "../testHelpers";
import { setupCommon } from "./Pool/common";

// An event only routes to a contract when its source address is one configured
// for that chain in config.yaml, so these fixtures use the real deployments.
const CL_FACTORY_ADDRESS_BY_CHAIN: Record<number, string> = {
  10: toChecksumAddress("0x548118C7E0B865C2CfA94D15EC86B666468ac758"),
  8453: toChecksumAddress("0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A"),
  252: toChecksumAddress("0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F"),
};
const ROOT_CL_POOL_FACTORY_ADDRESS_OPTIMISM = toChecksumAddress(
  "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
);

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
    id: FeeToTickSpacingMappingId(
      chainId,
      CL_FACTORY_ADDRESS_BY_CHAIN[chainId],
      TICK_SPACING,
    ),
    chainId: chainId,
    factoryAddress: CL_FACTORY_ADDRESS_BY_CHAIN[chainId],
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
    } satisfies WithChain<Token>;
    const token1ForBase = {
      ...mockToken1Data,
      id: TokenId(chainId, mockToken1Data.address),
      chainId: chainId,
    } satisfies WithChain<Token>;
    indexer.Token.set(token0ForBase);
    indexer.Token.set(token1ForBase);
    const clGaugeConfig = {
      id: String(clGaugeConfigChainId),
      chainId: clGaugeConfigChainId,
      defaultEmissionsCap: 0n,
      defaultMinStakeTime: 0n,
      penaltyRate: 0n,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } satisfies WithChain<CLGaugeConfig>;
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
                srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[
                  chainId
                ] as `0x${string}`,
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

    it("registers a tier-3 / tier-3 pool as a peer pool for both sides (ADR 0007)", async () => {
      // 0x1111… / 0x2222… are both tier-3 tokens on Base.
      const poolId = PoolId(chainId, poolAddress);
      expect(
        (await indexer.TokenPricingPools.get(TokenId(chainId, token0Address)))
          ?.pools,
      ).toEqual([poolId]);
      expect(
        (await indexer.TokenPricingPools.get(TokenId(chainId, token1Address)))
          ?.pools,
      ).toEqual([poolId]);
    });

    it("registers the pool as a pricing candidate for the higher-tier side (ADR 0003)", async () => {
      const baseWeth = toChecksumAddress(
        "0x4200000000000000000000000000000000000006",
      );
      const clPool = toChecksumAddress(
        "0x4444444444444444444444444444444444444444",
      );
      const idx = createTestIndexer();
      setupIndexerWithEntities(idx);
      idx.Token.set({
        ...mockToken1Data,
        id: TokenId(chainId, baseWeth),
        address: baseWeth,
        chainId,
      } satisfies WithChain<Token>);
      await idx.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "PoolCreated",
                srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[
                  chainId
                ] as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`, // tier 3
                  token1: baseWeth as `0x${string}`, // tier 1
                  pool: clPool,
                  tickSpacing: TICK_SPACING,
                },
              },
            ],
          },
        },
      });
      expect(
        (await idx.TokenPricingPools.get(TokenId(chainId, token0Address)))
          ?.pools,
      ).toEqual([PoolId(chainId, clPool)]);
      expect(
        await idx.TokenPricingPools.get(TokenId(chainId, baseWeth)),
      ).toBeUndefined();
    });

    it("should process event even during preload phase", async () => {
      const preloadIndexer = createTestIndexer();
      setupIndexerWithEntities(preloadIndexer);

      // Verify the mapping exists before processing (using the same key format as the handler)
      const mappingKey = FeeToTickSpacingMappingId(
        chainId,
        CL_FACTORY_ADDRESS_BY_CHAIN[chainId],
        TICK_SPACING,
      );
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
                srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[
                  chainId
                ] as `0x${string}`,
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
                srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[
                  chainId
                ] as `0x${string}`,
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

    // Regression for #865 (CL_FACTORY_POOL_COUNT_GAP). Before the fix, when the
    // #677 bytecode gate confirmed one token side was a non-contract,
    // createTokenEntity returned null and the CL handler dropped the Pool even
    // though CLFactory had authoritatively registered it on-chain (Base audit:
    // 22 CL pools missing). Now the gate skips only the Token row; the Pool is
    // persisted with an empty symbol on the offending side. Mirrors #864 (V2).
    it("creates the Pool even when one token side is a non-contract (#865)", async () => {
      // 0x...dEaD is an EOA on Base; eth_getCode returns 0x so the bytecode gate
      // in createTokenEntity returns null for that side.
      const eoaTokenAddress = toChecksumAddress(
        "0x000000000000000000000000000000000000dEaD",
      );
      const idx = createTestIndexer();
      // Seed token0 + config/mapping, but NOT token1 — token1 must traverse
      // createTokenEntity and hit the gate.
      idx.Token.set({
        ...mockToken0Data,
        id: TokenId(chainId, mockToken0Data.address),
        chainId,
      });
      idx.CLGaugeConfig.set({
        id: String(chainId),
        chainId,
        defaultEmissionsCap: 0n,
        defaultMinStakeTime: 0n,
        penaltyRate: 0n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      } satisfies WithChain<CLGaugeConfig>);
      idx.FeeToTickSpacingMapping.set(createFeeToTickSpacingMapping());

      await idx.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "PoolCreated",
                srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[
                  chainId
                ] as `0x${string}`,
                logIndex: 1,
                block: {
                  number: 1000000,
                  timestamp: 1000000,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  token0: token0Address as `0x${string}`,
                  token1: eoaTokenAddress as `0x${string}`,
                  pool: poolAddress,
                  tickSpacing: TICK_SPACING,
                },
              },
            ],
          },
        },
      });

      const pool = await idx.Pool.get(PoolId(chainId, poolAddress));
      expect(pool).toBeDefined();
      expect(pool?.isCL).toBe(true);
      // Empty symbol on the gated (EOA) side; token0's symbol stays in its slot.
      expect(pool?.name).toBe("CL-60 AMM - USDT/");
      // Pool keeps the on-chain token1 address; only the Token row is skipped.
      expect(pool?.token1_address).toBe(eoaTokenAddress);
      // No Token row created for the EOA side (the gate still wins there).
      const eoaToken = await idx.Token.get(TokenId(chainId, eoaTokenAddress));
      expect(eoaToken).toBeUndefined();
    });

    // A leaf CL pool only stores rootPoolMatchingHash and factoryAddress; the
    // analytics layer joins it to Optimism's RootPool on them. Nothing is
    // mapped or flushed at leaf pool creation (ADR 0009, flow E), and the root
    // pool's votes stay on Optimism's RootPool (flow A).
    describe("on a superchain leaf chain (root pool created on Optimism)", () => {
      const rootChainId = 10 as const;
      const leafChainId = 252 as const; // Fraxtal
      const rootPoolAddress = toChecksumAddress(
        "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
      );
      const leafPoolAddress = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const voterAddress = toChecksumAddress(
        "0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C",
      );
      const blockTimestamp = 1000000;
      const blockNumber = 1000000;
      const txHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";

      function setupLeafChainEntities(
        idx: ReturnType<typeof createTestIndexer>,
      ): void {
        for (const [base, address] of [
          [mockToken0Data, token0Address],
          [mockToken1Data, token1Address],
        ] as const) {
          idx.Token.set({
            ...base,
            id: TokenId(leafChainId, address),
            address,
            chainId: leafChainId,
          } satisfies WithChain<Token>);
        }
        idx.CLGaugeConfig.set({
          id: String(leafChainId),
          chainId: leafChainId,
          defaultEmissionsCap: 0n,
          defaultMinStakeTime: 0n,
          penaltyRate: 0n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } satisfies WithChain<CLGaugeConfig>);
        idx.FeeToTickSpacingMapping.set({
          id: FeeToTickSpacingMappingId(
            leafChainId,
            CL_FACTORY_ADDRESS_BY_CHAIN[leafChainId],
            TICK_SPACING,
          ),
          chainId: leafChainId,
          factoryAddress: CL_FACTORY_ADDRESS_BY_CHAIN[leafChainId],
          tickSpacing: TICK_SPACING,
          fee: FEE,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        });
      }

      const rootPoolCreated = {
        contract: "RootCLPoolFactory" as const,
        event: "RootPoolCreated" as const,
        srcAddress: ROOT_CL_POOL_FACTORY_ADDRESS_OPTIMISM as `0x${string}`,
        logIndex: 1,
        block: { timestamp: blockTimestamp, number: blockNumber, hash: txHash },
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          tickSpacing: TICK_SPACING,
          chainid: BigInt(leafChainId),
          pool: rootPoolAddress as `0x${string}`,
        },
      };
      const voted = (logIndex: number, tokenId: bigint, weight: bigint) => ({
        contract: "Voter" as const,
        event: "Voted" as const,
        srcAddress: voterAddress as `0x${string}`,
        logIndex,
        block: { number: blockNumber, timestamp: blockTimestamp, hash: txHash },
        transaction: { hash: txHash },
        params: {
          voter: voterAddress,
          pool: rootPoolAddress,
          tokenId,
          weight,
          totalWeight: 1000n,
        },
      });
      const leafPoolCreated = {
        contract: "CLFactory" as const,
        event: "PoolCreated" as const,
        srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[leafChainId] as `0x${string}`,
        logIndex: 1,
        block: {
          number: blockNumber + 1,
          timestamp: blockTimestamp + 1,
          hash: txHash,
        },
        params: {
          token0: token0Address as `0x${string}`,
          token1: token1Address as `0x${string}`,
          pool: leafPoolAddress as `0x${string}`,
          tickSpacing: TICK_SPACING,
        },
      };

      it("stores the join keys of Optimism's RootPool and writes no RootPool_LeafPool", async () => {
        const idx = createTestIndexer();
        setupLeafChainEntities(idx);
        await idx.process({
          chains: { [rootChainId]: { simulate: [rootPoolCreated] } },
        });
        await idx.process({
          chains: { [leafChainId]: { simulate: [leafPoolCreated] } },
        });

        const rootPool = await idx.RootPool.get(
          RootPoolId(rootChainId, rootPoolAddress),
        );
        const leafPool = await idx.Pool.get(
          PoolId(leafChainId, leafPoolAddress),
        );
        expect(leafPool?.rootPoolMatchingHash).toBe(
          rootPoolMatchingHash(
            leafChainId,
            token0Address,
            token1Address,
            TICK_SPACING,
          ),
        );
        expect(leafPool?.rootPoolMatchingHash).toBe(
          rootPool?.rootPoolMatchingHash,
        );
        expect(leafPool?.factoryAddress).toBe(rootPool?.rootFactoryAddress);
        expect(await idx.RootPool_LeafPool.getAll()).toEqual([]);
      });

      it("keeps Optimism's votes on the RootPool: the leaf pool's veNFTamountStaked stays 0 and no leaf user or VeNFTPoolVote is written", async () => {
        const { createMockVeNFTState } = setupCommon();
        const idx = createTestIndexer();
        setupLeafChainEntities(idx);
        for (const tokenId of [1n, 2n]) {
          idx.VeNFTState.set(
            createMockVeNFTState({
              id: VeNFTId(rootChainId, tokenId),
              chainId: rootChainId,
              tokenId,
            }),
          );
        }
        await idx.process({
          chains: {
            [rootChainId]: {
              simulate: [
                rootPoolCreated,
                voted(2, 1n, 100n),
                voted(3, 2n, 50n),
              ],
            },
          },
        });
        await idx.process({
          chains: { [leafChainId]: { simulate: [leafPoolCreated] } },
        });

        // By design (ADR 0009): leaf pool vote fields stay at their defaults.
        const leafPool = await idx.Pool.get(
          PoolId(leafChainId, leafPoolAddress),
        );
        expect(leafPool).toBeDefined();
        expect(leafPool?.veNFTamountStaked).toBe(0n);
        expect(await idx.UserStatsPerPool.getAll()).toEqual([]);
        expect(await idx.VeNFTPoolVote.getAll()).toEqual([]);

        const rootPool = await idx.RootPool.get(
          RootPoolId(rootChainId, rootPoolAddress),
        );
        expect(rootPool?.veNFTamountStaked).toBe(1000n); // totalWeight
        expect(
          (
            await idx.RootPoolVote.get(
              RootPoolVoteId(rootChainId, 1n, rootPoolAddress),
            )
          )?.veNFTamountStaked,
        ).toBe(100n);
        expect(
          (
            await idx.RootPoolVote.get(
              RootPoolVoteId(rootChainId, 2n, rootPoolAddress),
            )
          )?.veNFTamountStaked,
        ).toBe(50n);
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
      const mappingId = FeeToTickSpacingMappingId(
        CHAIN_ID,
        CL_FACTORY_ADDRESS_BY_CHAIN[CHAIN_ID],
        TICK_SPACING,
      );

      await indexer.process({
        chains: {
          [CHAIN_ID]: {
            simulate: [
              {
                contract: "CLFactory",
                event: "TickSpacingEnabled",
                srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[
                  CHAIN_ID
                ] as `0x${string}`,
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
      const mappingId = FeeToTickSpacingMappingId(
        CHAIN_ID,
        CL_FACTORY_ADDRESS_BY_CHAIN[CHAIN_ID],
        TICK_SPACING,
      );
      const oldFee = 400n;
      const newFee = 600n;
      const oldTimestamp = 500000;
      const newTimestamp = 2000000;

      // Create existing mapping
      const existingMapping = {
        id: mappingId,
        chainId: CHAIN_ID,
        factoryAddress: CL_FACTORY_ADDRESS_BY_CHAIN[CHAIN_ID],
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
                srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[
                  CHAIN_ID
                ] as `0x${string}`,
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
            CL_FACTORY_ADDRESS_BY_CHAIN[mapping.chainId],
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
                  srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[cid] as `0x${string}`,
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
    } satisfies WithChain<Token>;
    const token1 = {
      ...mockToken1Data,
      id: TokenId(chainId, mockToken1Data.address),
      chainId,
    } satisfies WithChain<Token>;
    idx.Token.set(token0);
    idx.Token.set(token1);
    idx.CLGaugeConfig.set({
      id: String(chainId),
      chainId,
      defaultEmissionsCap: 0n,
      defaultMinStakeTime: 0n,
      penaltyRate: 0n,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
    } satisfies WithChain<CLGaugeConfig>);
    idx.FeeToTickSpacingMapping.set({
      id: FeeToTickSpacingMappingId(
        chainId,
        CL_FACTORY_ADDRESS_BY_CHAIN[chainId],
        TICK_SPACING,
      ),
      chainId,
      factoryAddress: CL_FACTORY_ADDRESS_BY_CHAIN[chainId],
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
              srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[chainId] as `0x${string}`,
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
              srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[chainId] as `0x${string}`,
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
              srcAddress: CL_FACTORY_ADDRESS_BY_CHAIN[chainId] as `0x${string}`,
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
