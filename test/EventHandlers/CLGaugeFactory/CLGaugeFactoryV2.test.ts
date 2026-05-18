import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { type MockPool, setupCommon } from "../Pool/common";

describe("CLGaugeFactoryV2 Event Handlers", () => {
  const { mockLiquidityPoolData, createMockPool } = setupCommon();
  const chainId = 10;
  const mockGaugeFactoryAddress = toChecksumAddress(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const mockGaugeAddress = toChecksumAddress(
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const mockDefaultCap = 1000000000000000000000n; // 1000 tokens in 18 decimals
  const mockEmissionCap = 500000000000000000000n; // 500 tokens in 18 decimals

  describe("SetDefaultCap Event Handler", () => {
    it("should create CLGaugeConfig entity keyed by chainId", async () => {
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: mockDefaultCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      const createdConfig = await indexer.CLGaugeConfig.get(String(chainId));

      expect(createdConfig).toBeDefined();

      if (!createdConfig) return; // Type guard

      expect(createdConfig.id).toBe(String(chainId));
      expect(createdConfig.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(
        new Date(
          createdConfig.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(1000000 * 1000).getTime());
    });

    it("should update existing CLGaugeConfig entity when called multiple times on the same chain", async () => {
      const indexer = createTestIndexer();

      // First call
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: mockDefaultCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Second call with different cap
      const newDefaultCap = 2000000000000000000000n; // 2000 tokens
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: newDefaultCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 2000000,
          number: 123457,
          hash: "0x2234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 2,
      });

      const updatedConfig = await indexer.CLGaugeConfig.get(String(chainId));

      expect(updatedConfig).toBeDefined();
      if (!updatedConfig) return;

      expect(updatedConfig.id).toBe(String(chainId));
      expect(updatedConfig.defaultEmissionsCap).toBe(newDefaultCap);
      expect(
        new Date(
          updatedConfig.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(2000000 * 1000).getTime());
    });

    it("should key CLGaugeConfig by chainId independently per chain", async () => {
      const otherChainId = 8453; // Base
      const otherDefaultCap = 3000000000000000000000n; // 3000 tokens

      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: mockDefaultCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      await simulateEvent(indexer, otherChainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: otherDefaultCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x3234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 2,
      });

      const configChain10 = await indexer.CLGaugeConfig.get(String(chainId));
      const configChain8453 = await indexer.CLGaugeConfig.get(
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
    let mockPoolWithGauge: MockPool;

    beforeEach(() => {
      // Create a pool entity with a gauge address
      mockPoolWithGauge = createMockPool({
        gaugeAddress: mockGaugeAddress,
        gaugeEmissionsCap: 0n, // Initial value
      });
    });

    it("should update pool entity with new emission cap", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(mockPoolWithGauge);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetEmissionCap",
        params: {
          _gauge: mockGaugeAddress,
          _newEmissionCap: mockEmissionCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      const updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);

      expect(updatedPool).toBeDefined();

      if (!updatedPool) return; // Type guard

      expect(updatedPool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(
        new Date(
          updatedPool.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(1000000 * 1000).getTime());
      // Verify other fields are preserved
      expect(updatedPool.id).toBe(mockLiquidityPoolData.id);
      expect(updatedPool.gaugeAddress).toBe(mockGaugeAddress);
    });

    it("should update existing emission cap when called multiple times", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(mockPoolWithGauge);

      // First update
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetEmissionCap",
        params: {
          _gauge: mockGaugeAddress,
          _newEmissionCap: mockEmissionCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Second update with different cap
      const newEmissionCap = 750000000000000000000n; // 750 tokens
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetEmissionCap",
        params: {
          _gauge: mockGaugeAddress,
          _newEmissionCap: newEmissionCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 2000000,
          number: 123457,
          hash: "0x2234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 2,
      });

      const updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);

      expect(updatedPool).toBeDefined();
      if (!updatedPool) return;

      expect(updatedPool.gaugeEmissionsCap).toBe(newEmissionCap);
      expect(
        new Date(
          updatedPool.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(2000000 * 1000).getTime());
    });

    it("should handle case where pool entity is not found", async () => {
      const indexer = createTestIndexer();
      // Pool seeded with a different gauge address
      indexer.Pool.set(mockPoolWithGauge);

      const nonExistentGaugeAddress = toChecksumAddress(
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      );

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetEmissionCap",
        params: {
          _gauge: nonExistentGaugeAddress,
          _newEmissionCap: mockEmissionCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      // Pool should not be updated (still 0n from initial setup)
      const pool = await indexer.Pool.get(mockLiquidityPoolData.id);

      expect(pool).toBeDefined();
      if (!pool) return;

      expect(pool.gaugeEmissionsCap).toBe(0n);
    });

    it("should preserve all other pool fields when updating emission cap", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(mockPoolWithGauge);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetEmissionCap",
        params: {
          _gauge: mockGaugeAddress,
          _newEmissionCap: mockEmissionCap,
        },
        srcAddress: mockGaugeFactoryAddress,
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        logIndex: 1,
      });

      const updatedPool = await indexer.Pool.get(mockLiquidityPoolData.id);

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
      expect(
        new Date(
          updatedPool.lastUpdatedTimestamp as unknown as string,
        ).getTime(),
      ).toBe(new Date(1000000 * 1000).getTime());
    });
  });
});
