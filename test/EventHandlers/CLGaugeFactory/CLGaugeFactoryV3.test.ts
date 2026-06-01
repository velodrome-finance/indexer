import type { CLGaugeConfig } from "envio";
import { createTestIndexer } from "envio";
import { PoolId, toChecksumAddress } from "../../../src/Constants";
import { rehydrateTimestamps } from "../../../src/EntityTimestamps";
import { type MockPool, setupCommon } from "../Pool/common";

describe("CLGaugeFactoryV3 Event Handlers", () => {
  const { mockLiquidityPoolData, createMockPool } = setupCommon();
  const chainId = 8453 as const; // Base — where V3 is deployed
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

  let indexer: ReturnType<typeof createTestIndexer>;

  beforeEach(() => {
    indexer = createTestIndexer();
  });

  describe("SetDefaultCap", () => {
    it("writes CLGaugeConfig keyed by chainId", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetDefaultCap",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 2_000_000,
                  number: 2,
                  hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
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
      const config = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.id).toBe(String(chainId));
      expect(config.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(config.lastUpdatedTimestamp).toEqual(new Date(2_000_000 * 1000));
    });

    it("last-writer-wins: V3 overrides an earlier V2-written row on the same chain", async () => {
      const v2DefaultCap = 111n;
      const v3DefaultCap = 222n;

      // V2 event first
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV2",
                event: "SetDefaultCap",
                srcAddress: v2FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 1_000_000,
                  number: 1,
                  hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
                },
                params: {
                  _newDefaultCap: v2DefaultCap,
                },
              },
            ],
          },
        },
      });

      const rawV2Config = await indexer.CLGaugeConfig.get(String(chainId));
      const v2Config = rawV2Config
        ? rehydrateTimestamps("CLGaugeConfig", rawV2Config)
        : undefined;
      expect(v2Config?.defaultEmissionsCap).toBe(v2DefaultCap);
      if (!v2Config) return;

      // V3 fires on a FRESH indexer seeded with the V2-written row. A 2nd
      // process() on the same indexer is unsupported by createTestIndexer: it
      // re-persists batch-1 entities whose Timestamp fields have round-tripped
      // to strings, and the write serializer throws (date.toISOString). Seeding
      // the rehydrated row reproduces the "row already exists when V3 fires"
      // state without a second process() on the same indexer.
      const indexer2 = createTestIndexer();
      indexer2.CLGaugeConfig.set(v2Config);
      await indexer2.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetDefaultCap",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 2_000_000,
                  number: 2,
                  hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
                },
                params: {
                  _newDefaultCap: v3DefaultCap,
                },
              },
            ],
          },
        },
      });

      const rawV3Config = await indexer2.CLGaugeConfig.get(String(chainId));
      const v3Config = rawV3Config
        ? rehydrateTimestamps("CLGaugeConfig", rawV3Config)
        : undefined;

      expect(v3Config).toBeDefined();
      if (!v3Config) return;
      expect(v3Config.defaultEmissionsCap).toBe(v3DefaultCap);
      expect(v3Config.lastUpdatedTimestamp).toEqual(new Date(2_000_000 * 1000));
    });
  });

  describe("SetEmissionCap", () => {
    let mockPoolWithGauge: MockPool;

    beforeEach(() => {
      mockPoolWithGauge = createMockPool({
        gaugeAddress: mockGaugeAddress,
        gaugeEmissionsCap: 0n,
      });

      // Seed pool directly — native getWhere will match on gaugeAddress
      indexer.Pool.set(mockPoolWithGauge);
    });

    it("updates Pool.gaugeEmissionsCap by gauge address", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetEmissionCap",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 3_000_000,
                  number: 3,
                  hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
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

      const rawPool = await indexer.Pool.get(mockLiquidityPoolData.id);
      const pool = rawPool ? rehydrateTimestamps("Pool", rawPool) : undefined;
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(pool.lastUpdatedTimestamp).toEqual(new Date(3_000_000 * 1000));
      expect(pool.gaugeAddress).toBe(mockGaugeAddress);
    });

    it("logs an error and leaves state unchanged when no pool matches the gauge", async () => {
      // No pool seeded with this gauge address — native getWhere returns []
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetEmissionCap",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 3_000_000,
                  number: 3,
                  hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
                },
                params: {
                  _gauge: toChecksumAddress(
                    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                  ),
                  _newEmissionCap: mockEmissionCap,
                },
              },
            ],
          },
        },
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
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetDefaultMinStakeTime",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 4_000_000,
                  number: 4,
                  hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
                },
                params: {
                  _minStakeTime: mockMinStakeTime,
                },
              },
            ],
          },
        },
      });

      const rawConfig = await indexer.CLGaugeConfig.get(String(chainId));
      const config = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.defaultMinStakeTime).toBe(mockMinStakeTime);
      expect(config.defaultEmissionsCap).toBe(0n);
      expect(config.penaltyRate).toBe(0n);
      expect(config.lastUpdatedTimestamp).toEqual(new Date(4_000_000 * 1000));
    });

    it("updates defaultMinStakeTime without stomping existing defaultEmissionsCap or penaltyRate", async () => {
      const existing: CLGaugeConfig = {
        id: String(chainId),
        defaultEmissionsCap: mockDefaultCap,
        defaultMinStakeTime: 0n,
        penaltyRate: 250n,
        lastUpdatedTimestamp: new Date(3_000_000 * 1000),
      };
      indexer.CLGaugeConfig.set(existing);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetDefaultMinStakeTime",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 4_000_000,
                  number: 4,
                  hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
                },
                params: {
                  _minStakeTime: mockMinStakeTime,
                },
              },
            ],
          },
        },
      });

      const rawConfig = await indexer.CLGaugeConfig.get(String(chainId));
      const config = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;
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
      const existingPool = createMockPool({
        id: poolOnBaseId,
        chainId,
        poolAddress: poolAddress as `0x${string}`,
        minStakeTime: 0n,
      });
      indexer.Pool.set(existingPool);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetPoolMinStakeTime",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 5_000_000,
                  number: 5,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  _pool: poolAddress,
                  _minStakeTime: 3_600n,
                },
              },
            ],
          },
        },
      });

      const rawPool = await indexer.Pool.get(poolOnBaseId);
      const pool = rawPool ? rehydrateTimestamps("Pool", rawPool) : undefined;
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.minStakeTime).toBe(3_600n);
      expect(pool.lastUpdatedTimestamp).toEqual(new Date(5_000_000 * 1000));
    });

    it("returns cleanly when no pool is found for the given pool address", async () => {
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetPoolMinStakeTime",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 5_000_000,
                  number: 5,
                  hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
                },
                params: {
                  _pool: toChecksumAddress(
                    "0xdddddddddddddddddddddddddddddddddddddddd",
                  ),
                  _minStakeTime: 3_600n,
                },
              },
            ],
          },
        },
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
      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetPenaltyRate",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 6_000_000,
                  number: 6,
                  hash: "0x6666666666666666666666666666666666666666666666666666666666666666",
                },
                params: {
                  _penaltyRate: mockPenaltyRate,
                },
              },
            ],
          },
        },
      });

      const rawConfig = await indexer.CLGaugeConfig.get(String(chainId));
      const config = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.penaltyRate).toBe(mockPenaltyRate);
      expect(config.defaultEmissionsCap).toBe(0n);
      expect(config.defaultMinStakeTime).toBe(0n);
    });

    it("updates penaltyRate without stomping defaultEmissionsCap or defaultMinStakeTime", async () => {
      const existing: CLGaugeConfig = {
        id: String(chainId),
        defaultEmissionsCap: mockDefaultCap,
        defaultMinStakeTime: 86_400n,
        penaltyRate: 0n,
        lastUpdatedTimestamp: new Date(4_000_000 * 1000),
      };
      indexer.CLGaugeConfig.set(existing);

      await indexer.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                contract: "CLGaugeFactoryV3",
                event: "SetPenaltyRate",
                srcAddress: v3FactoryAddress,
                logIndex: 1,
                block: {
                  timestamp: 6_000_000,
                  number: 6,
                  hash: "0x6666666666666666666666666666666666666666666666666666666666666666",
                },
                params: {
                  _penaltyRate: mockPenaltyRate,
                },
              },
            ],
          },
        },
      });

      const rawConfig = await indexer.CLGaugeConfig.get(String(chainId));
      const config = rawConfig
        ? rehydrateTimestamps("CLGaugeConfig", rawConfig)
        : undefined;
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(config.defaultMinStakeTime).toBe(86_400n);
      expect(config.penaltyRate).toBe(mockPenaltyRate);
    });
  });
});
