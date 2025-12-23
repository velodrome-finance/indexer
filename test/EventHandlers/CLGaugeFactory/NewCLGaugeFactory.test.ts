import {
  MockDb,
  NewCLGaugeFactory,
} from "../../../generated/src/TestHelpers.gen";
import type {
  CLGaugeConfig,
  LiquidityPoolAggregator,
} from "../../../generated/src/Types.gen";
import { toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("NewCLGaugeFactory Event Handlers", () => {
  const { mockLiquidityPoolData } = setupCommon();
  const chainId = 10;
  const mockGaugeFactoryAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const mockGaugeAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const mockDefaultCap = 1000000000000000000000n; // 1000 tokens in 18 decimals
  const mockEmissionCap = 500000000000000000000n; // 500 tokens in 18 decimals

  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  describe("SetDefaultCap Event Handler", () => {
    it("should create CLGaugeConfig entity with correct values", async () => {
      const mockEvent = NewCLGaugeFactory.SetDefaultCap.createMockEvent({
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

      const result = await NewCLGaugeFactory.SetDefaultCap.processEvent({
        event: mockEvent,
        mockDb,
      });

      const createdConfig = result.entities.CLGaugeConfig.get(
        mockGaugeFactoryAddress,
      );

      expect(createdConfig).toBeDefined();

      if (!createdConfig) return; // Type guard

      expect(createdConfig.id).toBe(mockGaugeFactoryAddress);
      expect(createdConfig.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(createdConfig.lastUpdatedTimestamp).toEqual(
        new Date(1000000 * 1000),
      );
    });

    it("should update existing CLGaugeConfig entity when called multiple times", async () => {
      // First call
      const mockEvent1 = NewCLGaugeFactory.SetDefaultCap.createMockEvent({
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

      const result1 = await NewCLGaugeFactory.SetDefaultCap.processEvent({
        event: mockEvent1,
        mockDb,
      });

      // Update mockDb with the result entities
      mockDb = MockDb.createMockDb();
      const config1 = result1.entities.CLGaugeConfig.get(
        mockGaugeFactoryAddress,
      );
      if (config1) {
        mockDb = mockDb.entities.CLGaugeConfig.set(config1);
      }

      // Second call with different cap
      const newDefaultCap = 2000000000000000000000n; // 2000 tokens
      const mockEvent2 = NewCLGaugeFactory.SetDefaultCap.createMockEvent({
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

      const result2 = await NewCLGaugeFactory.SetDefaultCap.processEvent({
        event: mockEvent2,
        mockDb,
      });

      const updatedConfig = result2.entities.CLGaugeConfig.get(
        mockGaugeFactoryAddress,
      );

      expect(updatedConfig).toBeDefined();
      if (!updatedConfig) return;

      expect(updatedConfig.id).toBe(mockGaugeFactoryAddress);
      expect(updatedConfig.defaultEmissionsCap).toBe(newDefaultCap);
      expect(updatedConfig.lastUpdatedTimestamp).toEqual(
        new Date(2000000 * 1000),
      );
    });

    it("should handle different gauge factory addresses independently", async () => {
      const anotherFactoryAddress =
        "0xcccccccccccccccccccccccccccccccccccccccc";
      const anotherDefaultCap = 3000000000000000000000n; // 3000 tokens

      const mockEvent1 = NewCLGaugeFactory.SetDefaultCap.createMockEvent({
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

      const result1 = await NewCLGaugeFactory.SetDefaultCap.processEvent({
        event: mockEvent1,
        mockDb,
      });

      // Update mockDb with the result entities
      mockDb = MockDb.createMockDb();
      const firstConfig = result1.entities.CLGaugeConfig.get(
        mockGaugeFactoryAddress,
      );
      if (firstConfig) {
        mockDb = mockDb.entities.CLGaugeConfig.set(firstConfig);
      }

      const mockEvent2 = NewCLGaugeFactory.SetDefaultCap.createMockEvent({
        _newDefaultCap: anotherDefaultCap,
        mockEventData: {
          srcAddress: anotherFactoryAddress,
          chainId,
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x3234567890123456789012345678901234567890123456789012345678901234",
          },
          logIndex: 2,
        },
      });

      const result2 = await NewCLGaugeFactory.SetDefaultCap.processEvent({
        event: mockEvent2,
        mockDb,
      });

      const config1 = result2.entities.CLGaugeConfig.get(
        mockGaugeFactoryAddress,
      );
      const config2 = result2.entities.CLGaugeConfig.get(anotherFactoryAddress);

      expect(config1).toBeDefined();
      expect(config2).toBeDefined();

      if (!config1 || !config2) return;

      expect(config1.id).toBe(mockGaugeFactoryAddress);
      expect(config2.id).toBe(anotherFactoryAddress);
      expect(config1.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(config2.defaultEmissionsCap).toBe(anotherDefaultCap);
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
      const mockEvent = NewCLGaugeFactory.SetEmissionCap.createMockEvent({
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

      const result = await NewCLGaugeFactory.SetEmissionCap.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere,
      });

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
      const mockEvent1 = NewCLGaugeFactory.SetEmissionCap.createMockEvent({
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

      const result1 = await NewCLGaugeFactory.SetEmissionCap.processEvent({
        event: mockEvent1,
        mockDb,
      });

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
      const mockEvent2 = NewCLGaugeFactory.SetEmissionCap.createMockEvent({
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

      const result2 = await NewCLGaugeFactory.SetEmissionCap.processEvent({
        event: mockEvent2,
        mockDb,
      });

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
      const nonExistentGaugeAddress =
        "0xdddddddddddddddddddddddddddddddddddddddd";

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

      const mockEvent = NewCLGaugeFactory.SetEmissionCap.createMockEvent({
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

      const result = await NewCLGaugeFactory.SetEmissionCap.processEvent({
        event: mockEvent,
        mockDb: mockDbWithEmptyGetWhere,
      });

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
      const mockEvent = NewCLGaugeFactory.SetEmissionCap.createMockEvent({
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

      const result = await NewCLGaugeFactory.SetEmissionCap.processEvent({
        event: mockEvent,
        mockDb: mockDbWithGetWhere,
      });

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
