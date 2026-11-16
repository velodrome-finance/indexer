import { createTestIndexer } from "envio";
import {
  AERO_NFPM_ADDRESS,
  FeeToTickSpacingMappingId,
  POOL_DEPLOYMENT,
  PoolId,
  TokenId,
  rootPoolMatchingHash,
  toChecksumAddress,
} from "../../src/Constants";
import { rehydrateTimestamps } from "../../src/EntityTimestamps";
import { setupCommon } from "./Pool/common";

// Aero (MetaDEX) factories: pools are tagged deployment = AERO and stay out of
// the legacy root/leaf machinery (ADR 0005).
describe("Aero factories", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const block = {
    number: 60_000_000,
    timestamp: 1_790_000_000,
    hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  };

  const AERO_CL_FACTORY = {
    57073: toChecksumAddress("0x7660BF2aDefC687C22906112ca323d60A00358cF"),
    5042: toChecksumAddress("0x7F83235643181E440433400a027618Cd50879751"),
  } as const;
  const ARC_LITE_CL_FACTORY = toChecksumAddress(
    "0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03",
  );
  const ARC_LITE_NFPM = toChecksumAddress(
    "0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473",
  );
  const LEGACY_INK_CL_FACTORY = toChecksumAddress(
    "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
  );
  const STABLE_FACTORY = toChecksumAddress(
    "0x78589E876edcEbdce72ee3436ab3c9AD3a7cEF2D",
  );
  const VOLATILE_FACTORY = toChecksumAddress(
    "0x8E6a9FCd1d638CC760Ffba397605Fe3355dE76D2",
  );

  const token0 = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const token1 = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const pool = toChecksumAddress("0x3333333333333333333333333333333333333333");

  function seedTokens(
    idx: ReturnType<typeof createTestIndexer>,
    chainId: number,
  ): void {
    idx.Token.set({
      ...mockToken0Data,
      id: TokenId(chainId, token0),
      address: token0,
      chainId,
    });
    idx.Token.set({
      ...mockToken1Data,
      id: TokenId(chainId, token1),
      address: token1,
      chainId,
    });
  }

  function tickSpacingEnabled(
    factory: string,
    tickSpacing: bigint,
    fee: bigint,
    logIndex: number,
  ) {
    return {
      contract: "AeroCLFactory" as const,
      event: "TickSpacingEnabled" as const,
      srcAddress: factory as `0x${string}`,
      logIndex,
      block,
      params: { tickSpacing, fee },
    };
  }

  function clPoolCreated(
    contract: "AeroCLFactory" | "CLFactory",
    factory: string,
    tickSpacing: bigint,
    poolAddress = pool,
    logIndex = 10,
  ) {
    return {
      contract,
      event: "PoolCreated" as const,
      srcAddress: factory as `0x${string}`,
      logIndex,
      block,
      params: {
        token0: token0 as `0x${string}`,
        token1: token1 as `0x${string}`,
        tickSpacing,
        pool: poolAddress as `0x${string}`,
      },
    };
  }

  describe("AeroCLFactory", () => {
    it("creates an AERO CL pool with the Aero NFPM and its factory's tick-spacing fee", async () => {
      const chainId = 57073;
      const idx = createTestIndexer();
      seedTokens(idx, chainId);
      await idx.process({
        chains: {
          [chainId]: {
            simulate: [
              tickSpacingEnabled(AERO_CL_FACTORY[chainId], 100n, 10000n, 1),
              clPoolCreated("AeroCLFactory", AERO_CL_FACTORY[chainId], 100n),
            ],
          },
        },
      });
      const raw = await idx.Pool.get(PoolId(chainId, pool));
      const p = raw ? rehydrateTimestamps("Pool", raw) : undefined;
      expect(p?.deployment).toBe(POOL_DEPLOYMENT.AERO);
      expect(p?.isCL).toBe(true);
      expect(p?.factoryAddress).toBe(AERO_CL_FACTORY[chainId]);
      expect(p?.nfpmAddress).toBe(AERO_NFPM_ADDRESS);
      expect(p?.baseFee).toBe(10000n);
      expect(p?.currentFee).toBe(10000n);
      // Not a superchain leaf pool, and no legacy gauge config.
      expect(p?.rootPoolMatchingHash).toBeUndefined();
      expect(p?.gaugeEmissionsCap).toBeUndefined();
      expect(p?.minStakeTime).toBe(0n);
    });

    it("keys tick-spacing fees by factory: Arc's lite and Aero factories differ for the same spacing", async () => {
      const chainId = 5042;
      const idx = createTestIndexer();
      seedTokens(idx, chainId);
      const litePool = toChecksumAddress(
        "0x4444444444444444444444444444444444444444",
      );
      await idx.process({
        chains: {
          [chainId]: {
            simulate: [
              tickSpacingEnabled(ARC_LITE_CL_FACTORY, 50n, 500n, 1),
              tickSpacingEnabled(AERO_CL_FACTORY[chainId], 50n, 3000n, 2),
              clPoolCreated(
                "AeroCLFactory",
                ARC_LITE_CL_FACTORY,
                50n,
                litePool,
                3,
              ),
              clPoolCreated(
                "AeroCLFactory",
                AERO_CL_FACTORY[chainId],
                50n,
                pool,
                4,
              ),
            ],
          },
        },
      });
      const lite = await idx.FeeToTickSpacingMapping.get(
        FeeToTickSpacingMappingId(chainId, ARC_LITE_CL_FACTORY, 50n),
      );
      const main = await idx.FeeToTickSpacingMapping.get(
        FeeToTickSpacingMappingId(chainId, AERO_CL_FACTORY[chainId], 50n),
      );
      expect(lite?.fee).toBe(500n);
      expect(lite?.factoryAddress).toBe(ARC_LITE_CL_FACTORY);
      expect(main?.fee).toBe(3000n);

      const litePoolRow = await idx.Pool.get(PoolId(chainId, litePool));
      const mainPoolRow = await idx.Pool.get(PoolId(chainId, pool));
      expect(litePoolRow?.baseFee).toBe(500n);
      expect(litePoolRow?.nfpmAddress).toBe(ARC_LITE_NFPM);
      expect(mainPoolRow?.baseFee).toBe(3000n);
      expect(mainPoolRow?.nfpmAddress).toBe(AERO_NFPM_ADDRESS);
      expect(litePoolRow?.deployment).toBe(POOL_DEPLOYMENT.AERO);
    });

    it("writes no RootPool_LeafPool for an Ink Aero CL pool (leaf CL pools write no mapping, ADR 0009 flow E)", async () => {
      const chainId = 57073;
      const idx = createTestIndexer();
      seedTokens(idx, chainId);
      await idx.process({
        chains: {
          [chainId]: {
            simulate: [
              tickSpacingEnabled(AERO_CL_FACTORY[chainId], 100n, 10000n, 1),
              clPoolCreated("AeroCLFactory", AERO_CL_FACTORY[chainId], 100n),
            ],
          },
        },
      });
      expect(await idx.Pool.get(PoolId(chainId, pool))).toBeDefined();
      expect(await idx.RootPool_LeafPool.getAll()).toEqual([]);
      expect(await idx.RootPool.getAll()).toEqual([]);
    });

    it("tags legacy CL pools VELODROME off Base", async () => {
      const chainId = 57073;
      const idx = createTestIndexer();
      seedTokens(idx, chainId);
      await idx.process({
        chains: {
          [chainId]: {
            simulate: [
              {
                ...tickSpacingEnabled(LEGACY_INK_CL_FACTORY, 100n, 500n, 1),
                contract: "CLFactory" as const,
              },
              clPoolCreated("CLFactory", LEGACY_INK_CL_FACTORY, 100n),
            ],
          },
        },
      });
      const p = await idx.Pool.get(PoolId(chainId, pool));
      expect(p?.deployment).toBe(POOL_DEPLOYMENT.VELODROME);
      expect(p?.rootPoolMatchingHash).toBe(
        rootPoolMatchingHash(chainId, token0, token1, 100n),
      );
      // A leaf CL pool only stores its matching hash; the analytics layer joins
      // it to Optimism's RootPool (ADR 0009 flow E), so no mapping row here.
      expect(await idx.RootPool_LeafPool.getAll()).toEqual([]);
    });
  });

  describe("AeroStablePoolFactory / AeroVolatilePoolFactory", () => {
    function v2PoolCreated(
      contract: "AeroStablePoolFactory" | "AeroVolatilePoolFactory",
      factory: string,
      poolAddress: string,
      logIndex: number,
    ) {
      return {
        contract,
        event: "PoolCreated" as const,
        srcAddress: factory as `0x${string}`,
        logIndex,
        block,
        params: {
          token0: token0 as `0x${string}`,
          token1: token1 as `0x${string}`,
          pool: poolAddress as `0x${string}`,
          poolCount: 1n,
        },
      };
    }

    it("takes stability from the emitting factory and needs no root-pool lookup on a leaf chain", async () => {
      const chainId = 57073;
      const stablePool = toChecksumAddress(
        "0x5555555555555555555555555555555555555555",
      );
      const volatilePool = toChecksumAddress(
        "0x6666666666666666666666666666666666666666",
      );
      const idx = createTestIndexer();
      seedTokens(idx, chainId);
      await idx.process({
        chains: {
          [chainId]: {
            simulate: [
              v2PoolCreated(
                "AeroStablePoolFactory",
                STABLE_FACTORY,
                stablePool,
                1,
              ),
              v2PoolCreated(
                "AeroVolatilePoolFactory",
                VOLATILE_FACTORY,
                volatilePool,
                2,
              ),
            ],
          },
        },
      });
      const s = await idx.Pool.get(PoolId(chainId, stablePool));
      const v = await idx.Pool.get(PoolId(chainId, volatilePool));
      expect(s?.isStable).toBe(true);
      expect(s?.isCL).toBe(false);
      expect(s?.deployment).toBe(POOL_DEPLOYMENT.AERO);
      expect(s?.baseFee).toBe(500n); // 5 bps in FEE_SCALE
      expect(v?.isStable).toBe(false);
      expect(v?.baseFee).toBe(3000n); // 30 bps in FEE_SCALE
      expect(v?.factoryAddress).toBe(VOLATILE_FACTORY);
      expect(v?.rootPoolMatchingHash).toBeUndefined();
      // The legacy leaf PoolFactory records its Optimism root pool (CREATE2
      // address, ADR 0009 flow D); an Aero pool must not (no RootPool_LeafPool row).
      for (const leafPoolAddress of [stablePool, volatilePool]) {
        expect(
          await idx.RootPool_LeafPool.getWhere({
            leafPoolAddress: { _eq: leafPoolAddress },
          }),
        ).toEqual([]);
      }
    });
  });
});
