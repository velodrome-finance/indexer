import type { LiquidityPoolAggregator } from "generated";
import {
  CLGaugeFactoryV2,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("CLGaugeFactoryV2 Event Handlers", () => {
  const { mockLiquidityPoolData } = setupCommon();
  const chainId = 10;
  const mockGaugeFactoryAddress = toChecksumAddress(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const mockGaugeAddress = toChecksumAddress(
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const mockDefaultCap = 1000000000000000000000n; // 1000 tokens in 18 decimals
  const mockEmissionCap = 500000000000000000000n; // 500 tokens in 18 decimals

  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  describe("SetDefaultCap Event Handler", () => {
    it("should create CLGaugeConfig entity keyed by chainId", async () => {
      const mockEvent = CLGaugeFactoryV2.SetDefaultCap.createMockEvent({
        _newDefaultCap: mockDefaultCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      const result = await mockDb.processEvents([mockEvent]);

      const createdConfig = result.entities.CLGaugeConfig.get(String(chainId));

      expect(createdConfig).toBeDefined();

      if (!createdConfig) return; // Type guard

      expect(createdConfig.id).toBe(String(chainId));
      expect(createdConfig.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(createdConfig.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should update existing CLGaugeConfig entity when called multiple times on the same chain", async () => {
      // First call
      const mockEvent1 = CLGaugeFactoryV2.SetDefaultCap.createMockEvent({
        _newDefaultCap: mockDefaultCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      const result1 = await mockDb.processEvents([mockEvent1]);

      // Update mockDb with the result entities
      mockDb = MockDb.createMockDb();
      const config1 = result1.entities.CLGaugeConfig.get(String(chainId));
      if (config1) {
        mockDb = mockDb.entities.CLGaugeConfig.set(config1);
      }

      // Second call with different cap
      const newDefaultCap = 2000000000000000000000n; // 2000 tokens
      const mockEvent2 = CLGaugeFactoryV2.SetDefaultCap.createMockEvent({
        _newDefaultCap: newDefaultCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 2000000,
            number: 123457,
            hash: "0x2234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 2,
        },
      });

      const result2 = await mockDb.processEvents([mockEvent2]);

      const updatedConfig = result2.entities.CLGaugeConfig.get(String(chainId));

      expect(updatedConfig).toBeDefined();
      if (!updatedConfig) return;

      expect(updatedConfig.id).toBe(String(chainId));
      expect(updatedConfig.defaultEmissionsCap).toBe(newDefaultCap);
      expect(updatedConfig.lastUpdatedTimestamp).toEqual(
        new Date(2000000 * 1000),
      );
    });

    it("should key CLGaugeConfig by chainId independently per chain", async () => {
      const otherChainId = 8453; // Base
      const otherDefaultCap = 3000000000000000000000n; // 3000 tokens

      const mockEvent1 = CLGaugeFactoryV2.SetDefaultCap.createMockEvent({
        _newDefaultCap: mockDefaultCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      const result1 = await mockDb.processEvents([mockEvent1]);

      // Carry the chain 10 config forward when creating the next mockDb
      mockDb = MockDb.createMockDb();
      const firstConfig = result1.entities.CLGaugeConfig.get(String(chainId));
      if (firstConfig) {
        mockDb = mockDb.entities.CLGaugeConfig.set(firstConfig);
      }

      const mockEvent2 = CLGaugeFactoryV2.SetDefaultCap.createMockEvent({
        _newDefaultCap: otherDefaultCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId: otherChainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x3234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 2,
        },
      });

      const result2 = await mockDb.processEvents([mockEvent2]);

      const configChain10 = result2.entities.CLGaugeConfig.get(String(chainId));
      const configChain8453 = result2.entities.CLGaugeConfig.get(
        String(otherChainId),
      );

      expect(configChain10).toBeDefined();
      expect(configChain8453).toBeDefined();
      if (!configChain10 || !configChain8453) return;

      expect(configChain10.id).toBe(String(chainId));
      expect(configChain8453.id).toBe(String(otherChainId));
      expect(configChain10.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(configChain8453.defaultEmissionsCap).toBe(otherDefaultCap);
    });
  });

  describe("SetEmissionCap Event Handler", () => {
    let mockPoolWithGauge: LiquidityPoolAggregator;
    let mockDbWithGetWhere: typeof mockDb;

    beforeEach(() => {
      // Create a pool entity with a gauge address
      mockPoolWithGauge = {
        ...mockLiquidityPoolData,
        gaugeAddress: mockGaugeAddress,
        gaugeEmissionsCap: 0n, // Initial value
      };

      mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockPoolWithGauge);

      // Set up mockDb with getWhere support for gaugeAddress filtering
      const storedPools = [mockPoolWithGauge];

      mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          LiquidityPoolAggregator: {
            ...mockDb.entities.LiquidityPoolAggregator,
            getWhere: {
              gaugeAddress: {
                eq: async (gaugeAddr: string) => {
                  return storedPools.filter(
                    (entity) =>
                      entity.gaugeAddress &&
                      toChecksumAddress(entity.gaugeAddress) ===
                        toChecksumAddress(gaugeAddr),
                  );
                },
              },
            },
          },
        },
      } as typeof mockDb;
    });

    it("should update pool entity with new emission cap", async () => {
      const mockEvent = CLGaugeFactoryV2.SetEmissionCap.createMockEvent({
        _gauge: mockGaugeAddress,
        _newEmissionCap: mockEmissionCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      const result = await mockDbWithGetWhere.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );

      expect(updatedPool).toBeDefined();

      if (!updatedPool) return; // Type guard

      expect(updatedPool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(updatedPool.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
      // Verify other fields are preserved
      expect(updatedPool.id).toBe(mockLiquidityPoolData.id);
      expect(updatedPool.gaugeAddress).toBe(mockGaugeAddress);
    });

    it("should update existing emission cap when called multiple times", async () => {
      // First update
      const mockEvent1 = CLGaugeFactoryV2.SetEmissionCap.createMockEvent({
        _gauge: mockGaugeAddress,
        _newEmissionCap: mockEmissionCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      const result1 = await mockDb.processEvents([mockEvent1]);

      // Update mockDb with the result entities
      mockDb = MockDb.createMockDb();
      const pool1 = result1.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );
      if (pool1) {
        mockDb = mockDb.entities.LiquidityPoolAggregator.set(pool1);
      }

      // Second update with different cap
      const newEmissionCap = 750000000000000000000n; // 750 tokens
      const mockEvent2 = CLGaugeFactoryV2.SetEmissionCap.createMockEvent({
        _gauge: mockGaugeAddress,
        _newEmissionCap: newEmissionCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 2000000,
            number: 123457,
            hash: "0x2234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 2,
        },
      });

      const result2 = await mockDb.processEvents([mockEvent2]);

      const updatedPool = result2.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );

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

      // Set up mockDb with getWhere that returns empty array for non-existent gauge
      const mockDbWithEmptyGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          LiquidityPoolAggregator: {
            ...mockDb.entities.LiquidityPoolAggregator,
            getWhere: {
              gaugeAddress: {
                eq: async (_gaugeAddr: string) => {
                  return []; // No entities found
                },
              },
            },
          },
        },
      } as typeof mockDb;

      const mockEvent = CLGaugeFactoryV2.SetEmissionCap.createMockEvent({
        _gauge: nonExistentGaugeAddress,
        _newEmissionCap: mockEmissionCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      const result = await mockDbWithEmptyGetWhere.processEvents([mockEvent]);

      // Pool should not be updated
      const pool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );

      expect(pool).toBeDefined();
      if (!pool) return;

      // Should remain unchanged (still 0n from initial setup)
      expect(pool.gaugeEmissionsCap).toBe(0n);
    });

    it("should preserve all other pool fields when updating emission cap", async () => {
      const mockEvent = CLGaugeFactoryV2.SetEmissionCap.createMockEvent({
        _gauge: mockGaugeAddress,
        _newEmissionCap: mockEmissionCap,
        mockEventData: {
          srcAddress: mockGaugeFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 1,
        },
      });

      const result = await mockDbWithGetWhere.processEvents([mockEvent]);

      const updatedPool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );

      expect(updatedPool).toBeDefined();
      if (!updatedPool) return;

      // Verify all original fields are preserved
      expect(updatedPool.id).toBe(mockLiquidityPoolData.id);
      expect(updatedPool.chainId).toBe(mockLiquidityPoolData.chainId);
      expect(updatedPool.token0_id).toBe(mockLiquidityPoolData.token0_id);
      expect(updatedPool.token1_id).toBe(mockLiquidityPoolData.token1_id);
      expect(updatedPool.reserve0).toBe(mockLiquidityPoolData.reserve0);
      expect(updatedPool.reserve1).toBe(mockLiquidityPoolData.reserve1);
      expect(updatedPool.gaugeAddress).toBe(mockGaugeAddress);
      // Only these fields should change
      expect(updatedPool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(updatedPool.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });
  });
});
