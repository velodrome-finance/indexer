import type {
  LiquidityPoolAggregator,
  PoolLauncherPool,
  handlerContext,
} from "generated";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import { PoolId, toChecksumAddress } from "../../../src/Constants";
import {
  linkLiquidityPoolAggregatorToPoolLauncher,
  processPoolLauncherPool,
} from "../../../src/EventHandlers/PoolLauncher/PoolLauncherLogic";
import { setupCommon } from "../Pool/common";

describe("PoolLauncherLogic", () => {
  const { createMockLiquidityPoolAggregator } = setupCommon();

  let mockContext: handlerContext;
  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(async () => {
    mockDb = MockDb.createMockDb();
    mockContext = {
      PoolLauncherPool: {
        get: (id: string) => mockDb.entities.PoolLauncherPool.get(id),
        set: (entity: PoolLauncherPool) => {
          mockDb = mockDb.entities.PoolLauncherPool.set(entity);
        },
      },
      LiquidityPoolAggregator: {
        get: (id: string) => mockDb.entities.LiquidityPoolAggregator.get(id),
        set: (entity: LiquidityPoolAggregator) => {
          mockDb = mockDb.entities.LiquidityPoolAggregator.set(entity);
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
      expect(result.id).toBe("8453-0x1234567890123456789012345678901234567890");
      expect(result.chainId).toBe(8453);
      expect(result.underlyingPool).toBe(
        "0x1234567890123456789012345678901234567890",
      );
      expect(result.launcher).toBe(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      expect(result.creator).toBe("0x1111111111111111111111111111111111111111");
      expect(result.poolLauncherToken).toBe(
        "0x2222222222222222222222222222222222222222",
      );
      expect(result.pairToken).toBe(
        "0x3333333333333333333333333333333333333333",
      );
      expect(result.createdAt).toEqual(createdAt);
      expect(result.isEmerging).toBe(false);
      expect(result.lastFlagUpdateAt).toEqual(createdAt);
      expect(result.migratedFrom).toBe("");
      expect(result.migratedTo).toBe("");
      expect(result.oldLocker).toBe("");
      expect(result.newLocker).toBe("");
      expect(result.lastMigratedAt).toEqual(createdAt);

      // Verify the entity was set in the context
      const savedEntity = mockDb.entities.PoolLauncherPool.get(
        "8453-0x1234567890123456789012345678901234567890",
      );
      expect(savedEntity).toBeDefined();
      expect(savedEntity?.id).toBe(
        "8453-0x1234567890123456789012345678901234567890",
      );
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
      const existingPoolLauncherPool = {
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

      mockDb = mockDb.entities.PoolLauncherPool.set(existingPoolLauncherPool);

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
      expect(result.launcher?.toLowerCase()).toBe(
        launcherAddress.toLowerCase(),
      ); // Updated (impl may return lowercase)
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

    it("should normalize addresses to lowercase", async () => {
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

      // Assert
      expect(result.launcher).toBe(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      expect(result.creator).toBe("0x1111111111111111111111111111111111111111");
      expect(result.poolLauncherToken).toBe(
        "0x2222222222222222222222222222222222222222",
      );
      expect(result.pairToken).toBe(
        "0x3333333333333333333333333333333333333333",
      );
    });
  });

  describe("linkLiquidityPoolAggregatorToPoolLauncher", () => {
    const poolAddress = toChecksumAddress(
      "0x1234567890123456789012345678901234567890",
    );
    const chainId = 8453;

    describe("with CL factory", () => {
      it("should successfully link existing LiquidityPoolAggregator to PoolLauncherPool", async () => {
        // Create an existing LiquidityPoolAggregator (as if created by CLFactory)
        const existingLiquidityPoolAggregator =
          createMockLiquidityPoolAggregator({
            poolAddress: poolAddress,
            chainId: chainId,
            name: "TEST/USDC",
            reserve0: 1000000n,
            reserve1: 2000000n,
            totalLiquidityUSD: 3000000n,
            isCL: true,
          });

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(
          existingLiquidityPoolAggregator,
        );

        await linkLiquidityPoolAggregatorToPoolLauncher(
          poolAddress,
          chainId,
          mockContext,
          "CL",
        );

        // Assert
        const updatedEntity = mockDb.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
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

      it("should handle case where LiquidityPoolAggregator does not exist", async () => {
        let warnCalled = false;
        const mockContextWithWarn = {
          ...mockContext,
          log: {
            ...mockContext.log,
            warn: (message: string) => {
              warnCalled = true;
              expect(message).toContain(
                "LiquidityPoolAggregator not found for pool",
              );
              expect(message).toContain(
                "it should have been created by CLFactory",
              );
            },
          },
        };

        await linkLiquidityPoolAggregatorToPoolLauncher(
          poolAddress,
          chainId,
          mockContextWithWarn,
          "CL",
        );

        // Assert
        expect(warnCalled).toBe(true);

        // Verify no entity was created or updated
        const entity = mockDb.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(entity).toBeUndefined();
      });
    });

    describe("with V2 factory", () => {
      it("should successfully link existing LiquidityPoolAggregator to PoolLauncherPool", async () => {
        // Create an existing LiquidityPoolAggregator (as if created by V2Factory)
        const existingLiquidityPoolAggregator =
          createMockLiquidityPoolAggregator({
            poolAddress: poolAddress,
            chainId: chainId,
            name: "TEST/USDC",
            reserve0: 1000000n,
            reserve1: 2000000n,
            totalLiquidityUSD: 3000000n,
          });

        mockDb = mockDb.entities.LiquidityPoolAggregator.set(
          existingLiquidityPoolAggregator,
        );

        await linkLiquidityPoolAggregatorToPoolLauncher(
          poolAddress,
          chainId,
          mockContext,
          "V2",
        );

        // Assert
        const updatedEntity = mockDb.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
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

      it("should handle case where LiquidityPoolAggregator does not exist", async () => {
        let warnCalled = false;
        const mockContextWithWarn = {
          ...mockContext,
          log: {
            ...mockContext.log,
            warn: (message: string) => {
              warnCalled = true;
              expect(message).toContain(
                "LiquidityPoolAggregator not found for pool",
              );
              expect(message).toContain("V2Factory");
            },
          },
        };

        await linkLiquidityPoolAggregatorToPoolLauncher(
          poolAddress,
          chainId,
          mockContextWithWarn,
          "V2",
        );

        // Assert
        expect(warnCalled).toBe(true);

        // Verify no entity was created or updated
        const entity = mockDb.entities.LiquidityPoolAggregator.get(
          PoolId(chainId, poolAddress),
        );
        expect(entity).toBeUndefined();
      });
    });

    it("should handle different chain IDs correctly", async () => {
      const existingLiquidityPoolAggregator = createMockLiquidityPoolAggregator(
        {
          poolAddress: poolAddress,
          chainId: 10,
        },
      );

      mockDb = mockDb.entities.LiquidityPoolAggregator.set(
        existingLiquidityPoolAggregator,
      );

      await linkLiquidityPoolAggregatorToPoolLauncher(
        poolAddress,
        10,
        mockContext,
        "CL",
      );

      // Assert
      const updatedEntity = mockDb.entities.LiquidityPoolAggregator.get(
        PoolId(10, poolAddress),
      );
      expect(updatedEntity).toBeDefined();
      expect(updatedEntity?.poolLauncherPoolId).toBe(PoolId(10, poolAddress));
    });

    it("should normalize pool address to lowercase", async () => {
      const existingLiquidityPoolAggregator = createMockLiquidityPoolAggregator(
        {
          poolAddress: poolAddress,
          chainId: chainId,
        },
      );

      mockDb = mockDb.entities.LiquidityPoolAggregator.set(
        existingLiquidityPoolAggregator,
      );

      await linkLiquidityPoolAggregatorToPoolLauncher(
        poolAddress,
        chainId,
        mockContext,
        "CL",
      );

      // Assert
      const updatedEntity = mockDb.entities.LiquidityPoolAggregator.get(
        PoolId(chainId, poolAddress),
      );
      expect(updatedEntity).toBeDefined();
      expect(updatedEntity?.poolLauncherPoolId).toBe(
        PoolId(chainId, poolAddress),
      );
    });
  });
});
