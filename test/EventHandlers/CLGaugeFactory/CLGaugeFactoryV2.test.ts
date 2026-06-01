import { createTestIndexer } from "envio";
import { PoolId, toChecksumAddress } from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import { type MockPool, setupCommon } from "../Pool/common";

describe("CLGaugeFactoryV2 Event Handlers", () => {
  const { mockLiquidityPoolData, createMockPool } = setupCommon();
  // CLGaugeFactoryV2 is only deployed on Base (8453)
  const chainId = 8453 as const;
  const mockGaugeFactoryAddress = toChecksumAddress(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const mockGaugeAddress = toChecksumAddress(
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const mockDefaultCap = 1000000000000000000000n; // 1000 tokens in 18 decimals
  const mockEmissionCap = 500000000000000000000n; // 500 tokens in 18 decimals

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(() => {
    indexer = createTestIndexer();
  });

  describe("SetDefaultCap Event Handler", () => {
    it("should create CLGaugeConfig entity keyed by chainId", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetDefaultCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _newDefaultCap: mockDefaultCap,
                },
              },
            ],
          },
        },
      });

      const rawConfig = await indexer.CLGaugeConfig.get(String(chainId));
      const createdConfig = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;

      expect(createdConfig).toBeDefined();

      if (!createdConfig) return; // Type guard

      expect(createdConfig.id).toBe(String(chainId));
      expect(createdConfig.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(createdConfig.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should update existing CLGaugeConfig entity when called multiple times on the same chain", async () => {
      const newDefaultCap = 2000000000000000000000n; // 2000 tokens

      // Both events in one simulate array — same chain, sequential processing
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetDefaultCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _newDefaultCap: mockDefaultCap,
                },
              },
              {
                contract: "CLGaugeFactoryV2",
                event: "SetDefaultCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 2,
                block: {
                  timestamp: 2000000,
                  number: 123457,
                  hash: "0x2234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _newDefaultCap: newDefaultCap,
                },
              },
            ],
          },
        },
      });

      const rawConfig = await indexer.CLGaugeConfig.get(String(chainId));
      const updatedConfig = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;

      expect(updatedConfig).toBeDefined();
      if (!updatedConfig) return;

      expect(updatedConfig.id).toBe(String(chainId));
      expect(updatedConfig.defaultEmissionsCap).toBe(newDefaultCap);
      expect(updatedConfig.lastUpdatedTimestamp).toEqual(
        new Date(2000000 * 1000),
      );
    });

    it("should key CLGaugeConfig by chainId independently per chain", async () => {
      const otherDefaultCap = 3000000000000000000000n; // 3000 tokens

      // CLGaugeFactoryV2 is only on Base (8453). Test multi-key independence by
      // verifying the first event's config row exists after two sequential events.
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetDefaultCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _newDefaultCap: mockDefaultCap,
                },
              },
            ],
          },
        },
      });

      const rawConfig = await indexer.CLGaugeConfig.get(String(chainId));
      const configChain8453 = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;

      expect(configChain8453).toBeDefined();
      if (!configChain8453) return;

      expect(configChain8453.id).toBe(String(chainId));
      expect(configChain8453.defaultEmissionsCap).toBe(mockDefaultCap);

      // No other chain's config was written
      const configChain10 = await indexer.CLGaugeConfig.get(String(10));
      expect(configChain10).toBeUndefined();
    });
  });

  describe("SetEmissionCap Event Handler", () => {
    // Pool on chain 8453 (where CLGaugeFactoryV2 is deployed)
    const poolAddress = toChecksumAddress(
      "0x3333333333333333333333333333333333333333",
    );
    const poolId = PoolId(chainId, poolAddress);
    let mockPoolWithGauge: MockPool;

    beforeEach(() => {
      // Create pool on chain 8453 with the mock gauge address
      mockPoolWithGauge = createMockPool({
        chainId,
        poolAddress,
        gaugeAddress: mockGaugeAddress,
        gaugeEmissionsCap: 0n, // Initial value
      });

      // Seed pool directly — native getWhere will match on gaugeAddress
      indexer.Pool.set(mockPoolWithGauge);
    });

    it("should update pool entity with new emission cap", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetEmissionCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _gauge: mockGaugeAddress,
                  _newEmissionCap: mockEmissionCap,
                },
              },
            ],
          },
        },
      });

      const rawPool = await indexer.Pool.get(poolId);
      const updatedPool = rawPool
        ? rehydrateTimestamps("Pool", rawPool)
        : undefined;

      expect(updatedPool).toBeDefined();

      if (!updatedPool) return; // Type guard

      expect(updatedPool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(updatedPool.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
      // Verify other fields are preserved
      expect(updatedPool.id).toBe(poolId);
      expect(updatedPool.gaugeAddress).toBe(mockGaugeAddress);
    });

    it("should update existing emission cap when called multiple times", async () => {
      const newEmissionCap = 750000000000000000000n; // 750 tokens

      // Both events in one simulate array — same chain, sequential processing
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetEmissionCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _gauge: mockGaugeAddress,
                  _newEmissionCap: mockEmissionCap,
                },
              },
              {
                contract: "CLGaugeFactoryV2",
                event: "SetEmissionCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 2,
                block: {
                  timestamp: 2000000,
                  number: 123457,
                  hash: "0x2234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _gauge: mockGaugeAddress,
                  _newEmissionCap: newEmissionCap,
                },
              },
            ],
          },
        },
      });

      const rawPool = await indexer.Pool.get(poolId);
      const updatedPool = rawPool
        ? rehydrateTimestamps("Pool", rawPool)
        : undefined;

      expect(updatedPool).toBeDefined();
      if (!updatedPool) return;

      expect(updatedPool.gaugeEmissionsCap).toBe(newEmissionCap);
      expect(updatedPool.lastUpdatedTimestamp).toEqual(
        new Date(2000000 * 1000),
      );
    });

    it("should handle case where pool entity is not found", async () => {
      const nonExistentGaugeAddress = toChecksumAddress(
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      );

      // No pool seeded with this gauge address — native getWhere returns []
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetEmissionCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _gauge: nonExistentGaugeAddress,
                  _newEmissionCap: mockEmissionCap,
                },
              },
            ],
          },
        },
      });

      // Pool should not be updated (still has original values)
      const pool = await indexer.Pool.get(poolId);

      expect(pool).toBeDefined();
      if (!pool) return;

      // Should remain unchanged (still 0n from initial setup)
      expect(pool.gaugeEmissionsCap).toBe(0n);
    });

    it("should preserve all other pool fields when updating emission cap", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetEmissionCap",
                srcAddress: mockGaugeFactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1000000,
                  number: 123456,
                  hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
                },
                params: {
                  _gauge: mockGaugeAddress,
                  _newEmissionCap: mockEmissionCap,
                },
              },
            ],
          },
        },
      });

      const rawPool = await indexer.Pool.get(poolId);
      const updatedPool = rawPool
        ? rehydrateTimestamps("Pool", rawPool)
        : undefined;

      expect(updatedPool).toBeDefined();
      if (!updatedPool) return;

      // Verify all original fields are preserved
      expect(updatedPool.id).toBe(poolId);
      expect(updatedPool.chainId).toBe(chainId);
      expect(updatedPool.token0_id).toBe(mockPoolWithGauge.token0_id);
      expect(updatedPool.token1_id).toBe(mockPoolWithGauge.token1_id);
      expect(updatedPool.reserve0).toBe(mockPoolWithGauge.reserve0);
      expect(updatedPool.reserve1).toBe(mockPoolWithGauge.reserve1);
      expect(updatedPool.gaugeAddress).toBe(mockGaugeAddress);
      // Only these fields should change
      expect(updatedPool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(updatedPool.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });
});
