import type { PoolLauncherPool } from "envio";
import { PoolId, toChecksumAddress } from "../../../src/Constants";
import type { handlerContext } from "../../../src/EntityTypes";
import type { Pool } from "../../../src/EntityTypes";
import {
  linkPoolToPoolLauncher,
  processPoolLauncherPool,
} from "../../../src/EventHandlers/PoolLauncher/PoolLauncherLogic";
import { setupCommon } from "../Pool/common";

describe("PoolLauncherLogic", () => {
  const { createMockPool } = setupCommon();

  let mockContext: handlerContext;
  let poolLauncherPools: Map<string, PoolLauncherPool>;
  let pools: Map<string, Pool>;

  beforeEach(async () => {
    poolLauncherPools = new Map();
    pools = new Map();
    mockContext = {
      PoolLauncherPool: {
        get: (id: string) => Promise.resolve(poolLauncherPools.get(id)),
        set: (entity: PoolLauncherPool) => {
          poolLauncherPools.set(entity.id, entity);
        },
      },
      Pool: {
        get: (id: string) => Promise.resolve(pools.get(id)),
        set: (entity: Pool) => {
          pools.set(entity.id, entity);
        },
      },
      isPreload: false,
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    } as unknown as handlerContext;
  });

  describe("processPoolLauncherPool", () => {
    it("should create a new PoolLauncherPool when none exists", async () => {
      const poolAddress = toChecksumAddress(
        "0x1234567890123456789012345678901234567890",
      );
      const launcherAddress = toChecksumAddress(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      const creator = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const poolLauncherToken = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const pairToken = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const createdAt = new Date("2024-01-01T00:00:00Z");
      const chainId = 8453;

      const result = await processPoolLauncherPool(
        poolAddress,
        launcherAddress,
        creator,
        poolLauncherToken,
        pairToken,
        createdAt,
        chainId,
        mockContext,
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(`8453-${poolAddress}`);
      expect(result.chainId).toBe(8453);
      expect(result.underlyingPool).toBe(poolAddress);
      expect(result.launcher).toBe(launcherAddress);
      expect(result.creator).toBe(creator);
      expect(result.poolLauncherToken).toBe(poolLauncherToken);
      expect(result.pairToken).toBe(pairToken);
      expect(result.createdAt).toEqual(createdAt);
      expect(result.isEmerging).toBe(false);
      expect(result.lastFlagUpdateAt).toEqual(createdAt);
      expect(result.migratedFrom).toBe("");
      expect(result.migratedTo).toBe("");
      expect(result.oldLocker).toBe("");
      expect(result.newLocker).toBe("");
      expect(result.lastMigratedAt).toEqual(createdAt);

      // Verify the entity was set in the context
      const savedEntity = poolLauncherPools.get(`8453-${poolAddress}`);
      expect(savedEntity).toBeDefined();
      expect(savedEntity?.id).toBe(`8453-${poolAddress}`);
    });

    it("should record migratedFrom when created as a Migrate target (#818)", async () => {
      const poolAddress = toChecksumAddress(
        "0x1234567890123456789012345678901234567890",
      );
      const launcherAddress = toChecksumAddress(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      const creator = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const poolLauncherToken = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const pairToken = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const sourcePool = toChecksumAddress(
        "0x9999999999999999999999999999999999999999",
      );
      const createdAt = new Date("2024-01-01T00:00:00Z");
      const chainId = 8453;

      const result = await processPoolLauncherPool(
        poolAddress,
        launcherAddress,
        creator,
        poolLauncherToken,
        pairToken,
        createdAt,
        chainId,
        mockContext,
        sourcePool,
      );

      // The migrated target back-links to its source pool; migratedTo stays empty
      // until this pool is itself migrated away.
      expect(result.migratedFrom).toBe(sourcePool);
      expect(result.migratedTo).toBe("");
    });

    it("should update an existing PoolLauncherPool", async () => {
      const poolAddress = toChecksumAddress(
        "0x1234567890123456789012345678901234567890",
      );
      const launcherAddress = toChecksumAddress(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      const creator = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const poolLauncherToken = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const pairToken = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const createdAt = new Date("2024-01-01T00:00:00Z");
      const chainId = 8453;

      // Create an existing PoolLauncherPool
      const existingPoolLauncherPool: PoolLauncherPool = {
        id: PoolId(chainId, poolAddress),
        chainId: chainId,
        underlyingPool: poolAddress,
        launcher: toChecksumAddress(
          "0x0000000000000000000000000000000000000002",
        ),
        creator,
        poolLauncherToken,
        pairToken,
        createdAt: new Date("2023-12-01T00:00:00Z"),
        isEmerging: true,
        lastFlagUpdateAt: new Date("2023-12-01T00:00:00Z"),
        migratedFrom: toChecksumAddress(
          "0x0000000000000000000000000000000000000003",
        ),
        migratedTo: "",
        oldLocker: toChecksumAddress(
          "0x0000000000000000000000000000000000000004",
        ),
        newLocker: "",
        lastMigratedAt: new Date("2023-12-01T00:00:00Z"),
      };

      poolLauncherPools.set(
        existingPoolLauncherPool.id,
        existingPoolLauncherPool,
      );

      const result = await processPoolLauncherPool(
        poolAddress,
        launcherAddress,
        creator,
        poolLauncherToken,
        pairToken,
        createdAt,
        chainId,
        mockContext,
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe("8453-0x1234567890123456789012345678901234567890");
      expect(result.launcher).toBe(launcherAddress); // Updated, casing preserved verbatim
      expect(result.lastMigratedAt).toEqual(createdAt); // Updated
      expect(result.creator).toBe(creator); // Unchanged
      expect(result.isEmerging).toBe(true); // Unchanged
      expect(result.migratedFrom).toBe(existingPoolLauncherPool.migratedFrom); // Unchanged
    });

    it("should handle different chain IDs correctly", async () => {
      const poolAddress = toChecksumAddress(
        "0x1234567890123456789012345678901234567890",
      );
      const launcherAddress = toChecksumAddress(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      const creator = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const poolLauncherToken = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const pairToken = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const createdAt = new Date("2024-01-01T00:00:00Z");
      const chainId = 10; // Optimism

      const result = await processPoolLauncherPool(
        poolAddress,
        launcherAddress,
        creator,
        poolLauncherToken,
        pairToken,
        createdAt,
        chainId,
        mockContext,
      );

      // Assert
      expect(result.id).toBe("10-0x1234567890123456789012345678901234567890");
      expect(result.chainId).toBe(10);
    });

    it("should preserve EIP-55 checksum-cased addresses verbatim (no internal lowercasing)", async () => {
      // Envio's event.params.* always supplies EIP-55 addresses; storing them
      // verbatim keeps writers and readers on the same canonical key. See #633.
      const poolAddress = toChecksumAddress(
        "0x1234567890123456789012345678901234567890",
      );
      const launcherAddress = toChecksumAddress(
        "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
      );
      const creator = toChecksumAddress(
        "0x1111111111111111111111111111111111111111",
      );
      const poolLauncherToken = toChecksumAddress(
        "0x2222222222222222222222222222222222222222",
      );
      const pairToken = toChecksumAddress(
        "0x3333333333333333333333333333333333333333",
      );
      const createdAt = new Date("2024-01-01T00:00:00Z");
      const chainId = 8453;

      const result = await processPoolLauncherPool(
        poolAddress,
        launcherAddress,
        creator,
        poolLauncherToken,
        pairToken,
        createdAt,
        chainId,
        mockContext,
      );

      // Assert addresses are stored as-is (checksum-cased), not lowercased.
      expect(result.launcher).toBe(launcherAddress);
      expect(result.creator).toBe(creator);
      expect(result.poolLauncherToken).toBe(poolLauncherToken);
      expect(result.pairToken).toBe(pairToken);
      // Sanity check: the checksum form differs from the all-lowercase form
      // for at least one of these addresses (the all-A-F launcher).
      expect(result.launcher).not.toBe(launcherAddress.toLowerCase());
    });
  });

  describe("linkPoolToPoolLauncher", () => {
    const poolAddress = toChecksumAddress(
      "0x1234567890123456789012345678901234567890",
    );
    const chainId = 8453;

    describe("with CL factory", () => {
      it("should successfully link existing Pool to PoolLauncherPool", async () => {
        // Create an existing Pool (as if created by CLFactory)
        const existingPool = createMockPool({
          poolAddress: poolAddress,
          chainId: chainId,
          name: "TEST/USDC",
          reserve0: 1000000n,
          reserve1: 2000000n,
          totalLiquidityUSD: 3000000n,
          isCL: true,
        });

        pools.set(existingPool.id, existingPool);

        await linkPoolToPoolLauncher(poolAddress, chainId, mockContext, "CL");

        // Assert
        const updatedEntity = pools.get(PoolId(chainId, poolAddress));
        expect(updatedEntity).toBeDefined();
        expect(updatedEntity?.poolLauncherPoolId).toBe(
          "8453-0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity?.lastUpdatedTimestamp).toBeInstanceOf(Date);

        // Verify all other fields remain unchanged
        expect(updatedEntity?.id).toBe(PoolId(chainId, poolAddress));
        expect(updatedEntity?.chainId).toBe(8453);
        expect(updatedEntity?.name).toBe("TEST/USDC");
        expect(updatedEntity?.reserve0).toBe(1000000n);
        expect(updatedEntity?.reserve1).toBe(2000000n);
        expect(updatedEntity?.totalLiquidityUSD).toBe(3000000n);
        expect(updatedEntity?.isCL).toBe(true);
        expect(updatedEntity?.gaugeIsAlive).toBe(true);
      });

      it("should handle case where Pool does not exist", async () => {
        let warnCalled = false;
        const mockContextWithWarn = {
          ...mockContext,
          log: {
            ...mockContext.log,
            warn: (message: string) => {
              warnCalled = true;
              expect(message).toContain("Pool not found for pool");
              expect(message).toContain(
                "it should have been created by CLFactory",
              );
            },
          },
        };

        await linkPoolToPoolLauncher(
          poolAddress,
          chainId,
          mockContextWithWarn,
          "CL",
        );

        // Assert
        expect(warnCalled).toBe(true);

        // Verify no entity was created or updated
        const entity = pools.get(PoolId(chainId, poolAddress));
        expect(entity).toBeUndefined();
      });
    });

    describe("with V2 factory", () => {
      it("should successfully link existing Pool to PoolLauncherPool", async () => {
        // Create an existing Pool (as if created by V2Factory)
        const existingPool = createMockPool({
          poolAddress: poolAddress,
          chainId: chainId,
          name: "TEST/USDC",
          reserve0: 1000000n,
          reserve1: 2000000n,
          totalLiquidityUSD: 3000000n,
        });

        pools.set(existingPool.id, existingPool);

        await linkPoolToPoolLauncher(poolAddress, chainId, mockContext, "V2");

        // Assert
        const updatedEntity = pools.get(PoolId(chainId, poolAddress));
        expect(updatedEntity).toBeDefined();
        expect(updatedEntity?.poolLauncherPoolId).toBe(
          "8453-0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity?.lastUpdatedTimestamp).toBeInstanceOf(Date);

        // Verify all other fields remain unchanged
        expect(updatedEntity?.id).toBe(PoolId(chainId, poolAddress));
        expect(updatedEntity?.chainId).toBe(8453);
        expect(updatedEntity?.name).toBe("TEST/USDC");
        expect(updatedEntity?.reserve0).toBe(1000000n);
        expect(updatedEntity?.reserve1).toBe(2000000n);
        expect(updatedEntity?.totalLiquidityUSD).toBe(3000000n);
        expect(updatedEntity?.isCL).toBe(false); // V2 pools are not CL
        expect(updatedEntity?.gaugeIsAlive).toBe(true);
      });

      it("should handle case where Pool does not exist", async () => {
        let warnCalled = false;
        const mockContextWithWarn = {
          ...mockContext,
          log: {
            ...mockContext.log,
            warn: (message: string) => {
              warnCalled = true;
              expect(message).toContain("Pool not found for pool");
              expect(message).toContain("V2Factory");
            },
          },
        };

        await linkPoolToPoolLauncher(
          poolAddress,
          chainId,
          mockContextWithWarn,
          "V2",
        );

        // Assert
        expect(warnCalled).toBe(true);

        // Verify no entity was created or updated
        const entity = pools.get(PoolId(chainId, poolAddress));
        expect(entity).toBeUndefined();
      });
    });

    it("should handle different chain IDs correctly", async () => {
      const existingPool = createMockPool({
        poolAddress: poolAddress,
        chainId: 10,
      });

      pools.set(existingPool.id, existingPool);

      await linkPoolToPoolLauncher(poolAddress, 10, mockContext, "CL");

      // Assert
      const updatedEntity = pools.get(PoolId(10, poolAddress));
      expect(updatedEntity).toBeDefined();
      expect(updatedEntity?.poolLauncherPoolId).toBe(PoolId(10, poolAddress));
    });
  });
});
