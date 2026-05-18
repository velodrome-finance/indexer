import type { CLGaugeConfig } from "envio";
import { createTestIndexer } from "envio";
import { PoolId, toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { type MockPool, setupCommon } from "../Pool/common";

describe("CLGaugeFactoryV3 Event Handlers", () => {
  const { mockLiquidityPoolData, createMockPool } = setupCommon();
  const chainId = 8453; // Base — where V3 is deployed
  const v2FactoryAddress = toChecksumAddress(
    "0xB630227a79707D517320b6c0f885806389dFcbB3",
  );
  const v3FactoryAddress = toChecksumAddress(
    "0x385293CaE378C813F16f0C1334d774AdDDf56AbB",
  );
  const mockGaugeAddress = toChecksumAddress(
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const mockDefaultCap = 1000000000000000000000n; // 1000 tokens
  const mockEmissionCap = 500000000000000000000n; // 500 tokens

  describe("SetDefaultCap", () => {
    it("writes CLGaugeConfig keyed by chainId", async () => {
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: mockDefaultCap,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 2_000_000,
          number: 2,
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        },
        logIndex: 1,
      });

      const config = await indexer.CLGaugeConfig.get(String(chainId));
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.id).toBe(String(chainId));
      expect(config.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(
        new Date(config.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(2_000_000 * 1000).getTime());
    });

    it("last-writer-wins: V3 overrides an earlier V2-written row on the same chain", async () => {
      const v2DefaultCap = 111n;
      const v3DefaultCap = 222n;

      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV2",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: v2DefaultCap,
        },
        srcAddress: v2FactoryAddress,
        block: {
          timestamp: 1_000_000,
          number: 1,
          hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        },
        logIndex: 1,
      });

      const v2Config = await indexer.CLGaugeConfig.get(String(chainId));
      expect(v2Config?.defaultEmissionsCap).toBe(v2DefaultCap);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetDefaultCap",
        params: {
          _newDefaultCap: v3DefaultCap,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 2_000_000,
          number: 2,
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        },
        logIndex: 1,
      });

      const v3Config = await indexer.CLGaugeConfig.get(String(chainId));

      expect(v3Config).toBeDefined();
      if (!v3Config) return;
      expect(v3Config.defaultEmissionsCap).toBe(v3DefaultCap);
      expect(
        new Date(v3Config.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(2_000_000 * 1000).getTime());
    });
  });

  describe("SetEmissionCap", () => {
    let mockPoolWithGauge: MockPool;

    beforeEach(() => {
      mockPoolWithGauge = createMockPool({
        gaugeAddress: mockGaugeAddress,
        gaugeEmissionsCap: 0n,
      });
    });

    it("updates Pool.gaugeEmissionsCap by gauge address", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(mockPoolWithGauge);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetEmissionCap",
        params: {
          _gauge: mockGaugeAddress,
          _newEmissionCap: mockEmissionCap,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 3_000_000,
          number: 3,
          hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        },
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(mockLiquidityPoolData.id);
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(
        new Date(pool.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(3_000_000 * 1000).getTime());
      expect(pool.gaugeAddress).toBe(mockGaugeAddress);
    });

    it("logs an error and leaves state unchanged when no pool matches the gauge", async () => {
      const indexer = createTestIndexer();
      indexer.Pool.set(mockPoolWithGauge);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetEmissionCap",
        params: {
          _gauge: toChecksumAddress(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          ),
          _newEmissionCap: mockEmissionCap,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 3_000_000,
          number: 3,
          hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        },
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(mockLiquidityPoolData.id);
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.gaugeEmissionsCap).toBe(0n);
    });
  });

  describe("SetDefaultMinStakeTime", () => {
    const mockMinStakeTime = 86_400n; // 1 day

    it("creates a CLGaugeConfig with defaultMinStakeTime and zero defaults for siblings", async () => {
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetDefaultMinStakeTime",
        params: {
          _minStakeTime: mockMinStakeTime,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 4_000_000,
          number: 4,
          hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
        },
        logIndex: 1,
      });

      const config = await indexer.CLGaugeConfig.get(String(chainId));
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.defaultMinStakeTime).toBe(mockMinStakeTime);
      expect(config.defaultEmissionsCap).toBe(0n);
      expect(config.penaltyRate).toBe(0n);
      expect(
        new Date(config.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(4_000_000 * 1000).getTime());
    });

    it("updates defaultMinStakeTime without stomping existing defaultEmissionsCap or penaltyRate", async () => {
      const indexer = createTestIndexer();
      const existing: CLGaugeConfig = {
        id: String(chainId),
        defaultEmissionsCap: mockDefaultCap,
        defaultMinStakeTime: 0n,
        penaltyRate: 250n,
        lastUpdatedTimestamp: new Date(3_000_000 * 1000),
      };
      indexer.CLGaugeConfig.set(existing);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetDefaultMinStakeTime",
        params: {
          _minStakeTime: mockMinStakeTime,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 4_000_000,
          number: 4,
          hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
        },
        logIndex: 1,
      });

      const config = await indexer.CLGaugeConfig.get(String(chainId));
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(config.defaultMinStakeTime).toBe(mockMinStakeTime);
      expect(config.penaltyRate).toBe(250n);
    });
  });

  describe("SetPoolMinStakeTime", () => {
    const poolAddress = toChecksumAddress(
      "0xcccccccccccccccccccccccccccccccccccccccc",
    );
    const poolOnBaseId = PoolId(chainId, poolAddress);

    it("sets minStakeTime on the matching Pool", async () => {
      const indexer = createTestIndexer();
      const existingPool = createMockPool({
        id: poolOnBaseId,
        chainId,
        poolAddress: poolAddress as `0x${string}`,
        minStakeTime: 0n,
      });
      indexer.Pool.set(existingPool);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetPoolMinStakeTime",
        params: {
          _pool: poolAddress,
          _minStakeTime: 3_600n,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 5_000_000,
          number: 5,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        logIndex: 1,
      });

      const pool = await indexer.Pool.get(poolOnBaseId);
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.minStakeTime).toBe(3_600n);
      expect(
        new Date(pool.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(5_000_000 * 1000).getTime());
    });

    it("returns cleanly when no pool is found for the given pool address", async () => {
      const indexer = createTestIndexer();

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetPoolMinStakeTime",
        params: {
          _pool: toChecksumAddress(
            "0xdddddddddddddddddddddddddddddddddddddddd",
          ),
          _minStakeTime: 3_600n,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 5_000_000,
          number: 5,
          hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        logIndex: 1,
      });

      // Verify no pool entity was created for the missing pool — handler short-circuits.
      const missingPool = await indexer.Pool.get(
        PoolId(
          chainId,
          toChecksumAddress("0xdddddddddddddddddddddddddddddddddddddddd"),
        ),
      );
      expect(missingPool).toBeUndefined();
    });
  });

  describe("SetPenaltyRate", () => {
    const mockPenaltyRate = 250n; // 2.5% in bps

    it("creates a CLGaugeConfig with penaltyRate and zero defaults for siblings", async () => {
      const indexer = createTestIndexer();
      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetPenaltyRate",
        params: {
          _penaltyRate: mockPenaltyRate,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 6_000_000,
          number: 6,
          hash: "0x6666666666666666666666666666666666666666666666666666666666666666",
        },
        logIndex: 1,
      });

      const config = await indexer.CLGaugeConfig.get(String(chainId));
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.penaltyRate).toBe(mockPenaltyRate);
      expect(config.defaultEmissionsCap).toBe(0n);
      expect(config.defaultMinStakeTime).toBe(0n);
    });

    it("updates penaltyRate without stomping defaultEmissionsCap or defaultMinStakeTime", async () => {
      const indexer = createTestIndexer();
      const existing: CLGaugeConfig = {
        id: String(chainId),
        defaultEmissionsCap: mockDefaultCap,
        defaultMinStakeTime: 86_400n,
        penaltyRate: 0n,
        lastUpdatedTimestamp: new Date(4_000_000 * 1000),
      };
      indexer.CLGaugeConfig.set(existing);

      await simulateEvent(indexer, chainId, {
        contract: "CLGaugeFactoryV3",
        event: "SetPenaltyRate",
        params: {
          _penaltyRate: mockPenaltyRate,
        },
        srcAddress: v3FactoryAddress,
        block: {
          timestamp: 6_000_000,
          number: 6,
          hash: "0x6666666666666666666666666666666666666666666666666666666666666666",
        },
        logIndex: 1,
      });

      const config = await indexer.CLGaugeConfig.get(String(chainId));
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(config.defaultMinStakeTime).toBe(86_400n);
      expect(config.penaltyRate).toBe(mockPenaltyRate);
    });
  });
});
