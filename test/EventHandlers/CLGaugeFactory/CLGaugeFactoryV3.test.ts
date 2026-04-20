import type { CLGaugeConfig, LiquidityPoolAggregator } from "generated";
import {
  CLGaugeFactoryV2,
  CLGaugeFactoryV3,
  MockDb,
} from "../../../generated/src/TestHelpers.gen";
import { PoolId, toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("CLGaugeFactoryV3 Event Handlers", () => {
  const { mockLiquidityPoolData } = setupCommon();
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

  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  describe("SetDefaultCap", () => {
    it("writes CLGaugeConfig keyed by chainId", async () => {
      const event = CLGaugeFactoryV3.SetDefaultCap.createMockEvent({
        _newDefaultCap: mockDefaultCap,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 2_000_000,
            number: 2,
            hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          },
          logIndex: 1,
        },
      });

      const result = await mockDb.processEvents([event]);

      const config = result.entities.CLGaugeConfig.get(String(chainId));
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.id).toBe(String(chainId));
      expect(config.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(config.lastUpdatedTimestamp).toEqual(new Date(2_000_000 * 1000));
    });

    it("last-writer-wins: V3 overrides an earlier V2-written row on the same chain", async () => {
      const v2DefaultCap = 111n;
      const v3DefaultCap = 222n;

      const v2Event = CLGaugeFactoryV2.SetDefaultCap.createMockEvent({
        _newDefaultCap: v2DefaultCap,
        mockEventData: {
          srcAddress: v2FactoryAddress,
          chainId,
          block: {
            timestamp: 1_000_000,
            number: 1,
            hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          },
          logIndex: 1,
        },
      });

      const afterV2 = await mockDb.processEvents([v2Event]);
      const v2Config = afterV2.entities.CLGaugeConfig.get(String(chainId));
      expect(v2Config?.defaultEmissionsCap).toBe(v2DefaultCap);

      // Seed the V2 result into the next mockDb
      let seeded = MockDb.createMockDb();
      if (v2Config) {
        seeded = seeded.entities.CLGaugeConfig.set(v2Config);
      }

      const v3Event = CLGaugeFactoryV3.SetDefaultCap.createMockEvent({
        _newDefaultCap: v3DefaultCap,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 2_000_000,
            number: 2,
            hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          },
          logIndex: 1,
        },
      });

      const afterV3 = await seeded.processEvents([v3Event]);
      const v3Config = afterV3.entities.CLGaugeConfig.get(String(chainId));

      expect(v3Config).toBeDefined();
      if (!v3Config) return;
      expect(v3Config.defaultEmissionsCap).toBe(v3DefaultCap);
      expect(v3Config.lastUpdatedTimestamp).toEqual(new Date(2_000_000 * 1000));
    });
  });

  describe("SetEmissionCap", () => {
    let mockPoolWithGauge: LiquidityPoolAggregator;
    let mockDbWithGetWhere: typeof mockDb;

    beforeEach(() => {
      mockPoolWithGauge = {
        ...mockLiquidityPoolData,
        gaugeAddress: mockGaugeAddress,
        gaugeEmissionsCap: 0n,
      };

      mockDb = mockDb.entities.LiquidityPoolAggregator.set(mockPoolWithGauge);

      const storedPools = [mockPoolWithGauge];

      mockDbWithGetWhere = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          LiquidityPoolAggregator: {
            ...mockDb.entities.LiquidityPoolAggregator,
            getWhere: {
              gaugeAddress: {
                eq: async (gaugeAddr: string) =>
                  storedPools.filter(
                    (p) =>
                      p.gaugeAddress &&
                      toChecksumAddress(p.gaugeAddress) ===
                        toChecksumAddress(gaugeAddr),
                  ),
              },
            },
          },
        },
      } as typeof mockDb;
    });

    it("updates LiquidityPoolAggregator.gaugeEmissionsCap by gauge address", async () => {
      const event = CLGaugeFactoryV3.SetEmissionCap.createMockEvent({
        _gauge: mockGaugeAddress,
        _newEmissionCap: mockEmissionCap,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 3_000_000,
            number: 3,
            hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          },
          logIndex: 1,
        },
      });

      const result = await mockDbWithGetWhere.processEvents([event]);

      const pool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.gaugeEmissionsCap).toBe(mockEmissionCap);
      expect(pool.lastUpdatedTimestamp).toEqual(new Date(3_000_000 * 1000));
      expect(pool.gaugeAddress).toBe(mockGaugeAddress);
    });

    it("logs an error and leaves state unchanged when no pool matches the gauge", async () => {
      const emptyDb = {
        ...mockDb,
        entities: {
          ...mockDb.entities,
          LiquidityPoolAggregator: {
            ...mockDb.entities.LiquidityPoolAggregator,
            getWhere: {
              gaugeAddress: {
                eq: async (_: string) => [],
              },
            },
          },
        },
      } as typeof mockDb;

      const event = CLGaugeFactoryV3.SetEmissionCap.createMockEvent({
        _gauge: toChecksumAddress("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
        _newEmissionCap: mockEmissionCap,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 3_000_000,
            number: 3,
            hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          },
          logIndex: 1,
        },
      });

      const result = await emptyDb.processEvents([event]);

      const pool = result.entities.LiquidityPoolAggregator.get(
        mockLiquidityPoolData.id,
      );
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.gaugeEmissionsCap).toBe(0n);
    });
  });

  describe("SetDefaultMinStakeTime", () => {
    const mockMinStakeTime = 86_400n; // 1 day

    it("creates a CLGaugeConfig with defaultMinStakeTime and zero defaults for siblings", async () => {
      const event = CLGaugeFactoryV3.SetDefaultMinStakeTime.createMockEvent({
        _minStakeTime: mockMinStakeTime,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 4_000_000,
            number: 4,
            hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
          },
          logIndex: 1,
        },
      });

      const result = await mockDb.processEvents([event]);

      const config = result.entities.CLGaugeConfig.get(String(chainId));
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
      const seeded = mockDb.entities.CLGaugeConfig.set(existing);

      const event = CLGaugeFactoryV3.SetDefaultMinStakeTime.createMockEvent({
        _minStakeTime: mockMinStakeTime,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 4_000_000,
            number: 4,
            hash: "0x4444444444444444444444444444444444444444444444444444444444444444",
          },
          logIndex: 1,
        },
      });

      const result = await seeded.processEvents([event]);

      const config = result.entities.CLGaugeConfig.get(String(chainId));
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

    it("sets minStakeTime on the matching LiquidityPoolAggregator", async () => {
      const existingPool: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        id: poolOnBaseId,
        chainId,
        poolAddress: poolAddress as `0x${string}`,
        minStakeTime: 0n,
      };
      const seeded = mockDb.entities.LiquidityPoolAggregator.set(existingPool);

      const event = CLGaugeFactoryV3.SetPoolMinStakeTime.createMockEvent({
        _pool: poolAddress,
        _minStakeTime: 3_600n,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 5_000_000,
            number: 5,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
          logIndex: 1,
        },
      });

      const result = await seeded.processEvents([event]);

      const pool = result.entities.LiquidityPoolAggregator.get(poolOnBaseId);
      expect(pool).toBeDefined();
      if (!pool) return;
      expect(pool.minStakeTime).toBe(3_600n);
      expect(pool.lastUpdatedTimestamp).toEqual(new Date(5_000_000 * 1000));
    });

    it("returns cleanly when no pool is found for the given pool address", async () => {
      const event = CLGaugeFactoryV3.SetPoolMinStakeTime.createMockEvent({
        _pool: toChecksumAddress("0xdddddddddddddddddddddddddddddddddddddddd"),
        _minStakeTime: 3_600n,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 5_000_000,
            number: 5,
            hash: "0x5555555555555555555555555555555555555555555555555555555555555555",
          },
          logIndex: 1,
        },
      });

      const result = await mockDb.processEvents([event]);

      // Verify no pool entity was created for the missing pool — handler short-circuits.
      const missingPool = result.entities.LiquidityPoolAggregator.get(
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
      const event = CLGaugeFactoryV3.SetPenaltyRate.createMockEvent({
        _penaltyRate: mockPenaltyRate,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 6_000_000,
            number: 6,
            hash: "0x6666666666666666666666666666666666666666666666666666666666666666",
          },
          logIndex: 1,
        },
      });

      const result = await mockDb.processEvents([event]);

      const config = result.entities.CLGaugeConfig.get(String(chainId));
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
      const seeded = mockDb.entities.CLGaugeConfig.set(existing);

      const event = CLGaugeFactoryV3.SetPenaltyRate.createMockEvent({
        _penaltyRate: mockPenaltyRate,
        mockEventData: {
          srcAddress: v3FactoryAddress,
          chainId,
          block: {
            timestamp: 6_000_000,
            number: 6,
            hash: "0x6666666666666666666666666666666666666666666666666666666666666666",
          },
          logIndex: 1,
        },
      });

      const result = await seeded.processEvents([event]);

      const config = result.entities.CLGaugeConfig.get(String(chainId));
      expect(config).toBeDefined();
      if (!config) return;
      expect(config.defaultEmissionsCap).toBe(mockDefaultCap);
      expect(config.defaultMinStakeTime).toBe(86_400n);
      expect(config.penaltyRate).toBe(mockPenaltyRate);
    });
  });
});
