import { expect } from "chai";
import type {
  LiquidityPoolAggregator,
  PoolLauncherPool,
  handlerContext,
} from "generated";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import {
  linkLiquidityPoolAggregatorToPoolLauncher,
  processPoolLauncherPool,
} from "../../../src/EventHandlers/PoolLauncher/PoolLauncherLogic";
import { setupCommon } from "../Pool/common";

describe("PoolLauncherLogic", () => {
  const { mockLiquidityPoolData } = setupCommon();

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
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const launcherAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const creator = "0x1111111111111111111111111111111111111111";
      const poolLauncherToken = "0x2222222222222222222222222222222222222222";
      const pairToken = "0x3333333333333333333333333333333333333333";
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
      expect(result).to.not.be.undefined;
      expect(result.id).to.equal(
        "8453-0x1234567890123456789012345678901234567890",
      );
      expect(result.chainId).to.equal(8453);
      expect(result.underlyingPool).to.equal(
        "0x1234567890123456789012345678901234567890",
      );
      expect(result.launcher).to.equal(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      expect(result.creator).to.equal(
        "0x1111111111111111111111111111111111111111",
      );
      expect(result.poolLauncherToken).to.equal(
        "0x2222222222222222222222222222222222222222",
      );
      expect(result.pairToken).to.equal(
        "0x3333333333333333333333333333333333333333",
      );
      expect(result.createdAt).to.deep.equal(createdAt);
      expect(result.isEmerging).to.be.false;
      expect(result.lastFlagUpdateAt).to.deep.equal(createdAt);
      expect(result.migratedFrom).to.equal("");
      expect(result.migratedTo).to.equal("");
      expect(result.oldLocker).to.equal("");
      expect(result.newLocker).to.equal("");
      expect(result.lastMigratedAt).to.deep.equal(createdAt);

      // Verify the entity was set in the context
      const savedEntity = mockDb.entities.PoolLauncherPool.get(
        "8453-0x1234567890123456789012345678901234567890",
      );
      expect(savedEntity).to.not.be.undefined;
      expect(savedEntity?.id).to.equal(
        "8453-0x1234567890123456789012345678901234567890",
      );
    });

    it("should update an existing PoolLauncherPool", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const launcherAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const creator = "0x1111111111111111111111111111111111111111";
      const poolLauncherToken = "0x2222222222222222222222222222222222222222";
      const pairToken = "0x3333333333333333333333333333333333333333";
      const createdAt = new Date("2024-01-01T00:00:00Z");
      const chainId = 8453;

      // Create an existing PoolLauncherPool
      const existingPoolLauncherPool = {
        id: "8453-0x1234567890123456789012345678901234567890",
        chainId: 8453,
        underlyingPool: "0x1234567890123456789012345678901234567890",
        launcher: "0xoldlauncher0000000000000000000000000000000000",
        creator: "0x1111111111111111111111111111111111111111",
        poolLauncherToken: "0x2222222222222222222222222222222222222222",
        pairToken: "0x3333333333333333333333333333333333333333",
        createdAt: new Date("2023-12-01T00:00:00Z"),
        isEmerging: true,
        lastFlagUpdateAt: new Date("2023-12-01T00:00:00Z"),
        migratedFrom: "0xoldpool000000000000000000000000000000000000",
        migratedTo: "",
        oldLocker: "0xoldlocker0000000000000000000000000000000000",
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
      expect(result).to.not.be.undefined;
      expect(result.id).to.equal(
        "8453-0x1234567890123456789012345678901234567890",
      );
      expect(result.launcher).to.equal(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      ); // Updated
      expect(result.lastMigratedAt).to.deep.equal(createdAt); // Updated
      expect(result.creator).to.equal(
        "0x1111111111111111111111111111111111111111",
      ); // Unchanged
      expect(result.isEmerging).to.be.true; // Unchanged
      expect(result.migratedFrom).to.equal(
        "0xoldpool000000000000000000000000000000000000",
      ); // Unchanged
    });

    it("should handle different chain IDs correctly", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const launcherAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const creator = "0x1111111111111111111111111111111111111111";
      const poolLauncherToken = "0x2222222222222222222222222222222222222222";
      const pairToken = "0x3333333333333333333333333333333333333333";
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
      expect(result.id).to.equal(
        "10-0x1234567890123456789012345678901234567890",
      );
      expect(result.chainId).to.equal(10);
    });

    it("should normalize addresses to lowercase", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const launcherAddress = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
      const creator = "0x1111111111111111111111111111111111111111";
      const poolLauncherToken = "0x2222222222222222222222222222222222222222";
      const pairToken = "0x3333333333333333333333333333333333333333";
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
      expect(result.launcher).to.equal(
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      );
      expect(result.creator).to.equal(
        "0x1111111111111111111111111111111111111111",
      );
      expect(result.poolLauncherToken).to.equal(
        "0x2222222222222222222222222222222222222222",
      );
      expect(result.pairToken).to.equal(
        "0x3333333333333333333333333333333333333333",
      );
    });
  });

  describe("linkLiquidityPoolAggregatorToPoolLauncher", () => {
    describe("with CL factory", () => {
      it("should successfully link existing LiquidityPoolAggregator to PoolLauncherPool", async () => {
        const poolAddress = "0x1234567890123456789012345678901234567890";
        const chainId = 8453;

        // Create an existing LiquidityPoolAggregator (as if created by CLFactory)
        const existingLiquidityPoolAggregator: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: "0x1234567890123456789012345678901234567890",
          chainId: 8453,
          name: "TEST/USDC",
          token0_id: "0x2222222222222222222222222222222222222222_8453",
          token1_id: "0x3333333333333333333333333333333333333333_8453",
          token0_address: "0x2222222222222222222222222222222222222222",
          token1_address: "0x3333333333333333333333333333333333333333",
          isStable: false,
          isCL: true,
          reserve0: 1000000n,
          reserve1: 2000000n,
          totalLiquidityUSD: 3000000n,
          totalVolume0: 500000n,
          totalVolume1: 1000000n,
          totalVolumeUSD: 1500000n,
          totalVolumeUSDWhitelisted: 1500000n,
          gaugeFees0CurrentEpoch: 1000n,
          gaugeFees1CurrentEpoch: 2000n,
          totalFees0: 5000n,
          totalFees1: 10000n,
          totalFeesUSD: 15000n,
          totalFeesUSDWhitelisted: 15000n,
          numberOfSwaps: 25n,
          token0Price: 2000000000000000000n,
          token1Price: 500000000000000000n,
          totalVotesDeposited: 100000n,
          totalVotesDepositedUSD: 200000n,
          totalEmissions: 50000n,
          totalEmissionsUSD: 100000n,
          totalBribesUSD: 25000n,
          gaugeIsAlive: true,
          token0IsWhitelisted: true,
          token1IsWhitelisted: true,
          lastUpdatedTimestamp: new Date("2024-01-01T00:00:00Z"),
          lastSnapshotTimestamp: new Date("2024-01-01T00:00:00Z"),
          feeProtocol0: 100n,
          feeProtocol1: 200n,
          observationCardinalityNext: 1000n,
          totalFlashLoanFees0: 100n,
          totalFlashLoanFees1: 200n,
          totalFlashLoanFeesUSD: 300n,
          totalFlashLoanVolumeUSD: 10000n,
          numberOfFlashLoans: 5n,
          numberOfGaugeDeposits: 10n,
          numberOfGaugeWithdrawals: 5n,
          numberOfGaugeRewardClaims: 3n,
          totalGaugeRewardsClaimedUSD: 5000n,
          totalGaugeRewardsClaimed: 5000n,
          currentLiquidityStakedUSD: 100000n,
        };

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
          "0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity).to.not.be.undefined;
        expect(updatedEntity?.poolLauncherPoolId).to.equal(
          "8453-0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity?.lastUpdatedTimestamp).to.be.instanceOf(Date);

        // Verify all other fields remain unchanged
        expect(updatedEntity?.id).to.equal(
          "0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity?.chainId).to.equal(8453);
        expect(updatedEntity?.name).to.equal("TEST/USDC");
        expect(updatedEntity?.reserve0).to.equal(1000000n);
        expect(updatedEntity?.reserve1).to.equal(2000000n);
        expect(updatedEntity?.totalLiquidityUSD).to.equal(3000000n);
        expect(updatedEntity?.isCL).to.be.true;
        expect(updatedEntity?.gaugeIsAlive).to.be.true;
      });

      it("should handle case where LiquidityPoolAggregator does not exist", async () => {
        const poolAddress = "0x1234567890123456789012345678901234567890";
        const chainId = 8453;

        let warnCalled = false;
        const mockContextWithWarn = {
          ...mockContext,
          log: {
            ...mockContext.log,
            warn: (message: string) => {
              warnCalled = true;
              expect(message).to.include(
                "LiquidityPoolAggregator not found for pool",
              );
              expect(message).to.include(
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
        expect(warnCalled).to.be.true;

        // Verify no entity was created or updated
        const entity = mockDb.entities.LiquidityPoolAggregator.get(
          "0x1234567890123456789012345678901234567890",
        );
        expect(entity).to.be.undefined;
      });
    });

    describe("with V2 factory", () => {
      it("should successfully link existing LiquidityPoolAggregator to PoolLauncherPool", async () => {
        const poolAddress = "0x1234567890123456789012345678901234567890";
        const chainId = 8453;

        // Create an existing LiquidityPoolAggregator (as if created by V2Factory)
        const existingLiquidityPoolAggregator: LiquidityPoolAggregator = {
          ...mockLiquidityPoolData,
          id: "0x1234567890123456789012345678901234567890",
          chainId: 8453,
          name: "TEST/USDC",
          token0_id: "0x2222222222222222222222222222222222222222_8453",
          token1_id: "0x3333333333333333333333333333333333333333_8453",
          token0_address: "0x2222222222222222222222222222222222222222",
          token1_address: "0x3333333333333333333333333333333333333333",
          isStable: false,
          isCL: false, // V2 pools are not CL
          reserve0: 1000000n,
          reserve1: 2000000n,
          totalLiquidityUSD: 3000000n,
          totalVolume0: 500000n,
          totalVolume1: 1000000n,
          totalVolumeUSD: 1500000n,
          totalVolumeUSDWhitelisted: 1500000n,
          gaugeFees0CurrentEpoch: 1000n,
          gaugeFees1CurrentEpoch: 2000n,
          totalFees0: 5000n,
          totalFees1: 10000n,
          totalFeesUSD: 15000n,
          totalFeesUSDWhitelisted: 15000n,
          numberOfSwaps: 25n,
          token0Price: 2000000000000000000n,
          token1Price: 500000000000000000n,
          totalVotesDeposited: 100000n,
          totalVotesDepositedUSD: 200000n,
          totalEmissions: 50000n,
          totalEmissionsUSD: 100000n,
          totalBribesUSD: 25000n,
          gaugeIsAlive: true,
          token0IsWhitelisted: true,
          token1IsWhitelisted: true,
          lastUpdatedTimestamp: new Date("2024-01-01T00:00:00Z"),
          lastSnapshotTimestamp: new Date("2024-01-01T00:00:00Z"),
          feeProtocol0: 100n,
          feeProtocol1: 200n,
          observationCardinalityNext: 1000n,
          totalFlashLoanFees0: 100n,
          totalFlashLoanFees1: 200n,
          totalFlashLoanFeesUSD: 300n,
          totalFlashLoanVolumeUSD: 10000n,
          numberOfFlashLoans: 5n,
          numberOfGaugeDeposits: 10n,
          numberOfGaugeWithdrawals: 5n,
          numberOfGaugeRewardClaims: 3n,
          totalGaugeRewardsClaimedUSD: 5000n,
          totalGaugeRewardsClaimed: 5000n,
          currentLiquidityStakedUSD: 100000n,
        };

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
          "0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity).to.not.be.undefined;
        expect(updatedEntity?.poolLauncherPoolId).to.equal(
          "8453-0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity?.lastUpdatedTimestamp).to.be.instanceOf(Date);

        // Verify all other fields remain unchanged
        expect(updatedEntity?.id).to.equal(
          "0x1234567890123456789012345678901234567890",
        );
        expect(updatedEntity?.chainId).to.equal(8453);
        expect(updatedEntity?.name).to.equal("TEST/USDC");
        expect(updatedEntity?.reserve0).to.equal(1000000n);
        expect(updatedEntity?.reserve1).to.equal(2000000n);
        expect(updatedEntity?.totalLiquidityUSD).to.equal(3000000n);
        expect(updatedEntity?.isCL).to.be.false; // V2 pools are not CL
        expect(updatedEntity?.gaugeIsAlive).to.be.true;
      });

      it("should handle case where LiquidityPoolAggregator does not exist", async () => {
        const poolAddress = "0x1234567890123456789012345678901234567890";
        const chainId = 8453;

        let warnCalled = false;
        const mockContextWithWarn = {
          ...mockContext,
          log: {
            ...mockContext.log,
            warn: (message: string) => {
              warnCalled = true;
              expect(message).to.include(
                "LiquidityPoolAggregator not found for pool",
              );
              expect(message).to.include("V2Factory");
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
        expect(warnCalled).to.be.true;

        // Verify no entity was created or updated
        const entity = mockDb.entities.LiquidityPoolAggregator.get(
          "0x1234567890123456789012345678901234567890",
        );
        expect(entity).to.be.undefined;
      });
    });

    it("should handle different chain IDs correctly", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10; // Optimism

      const existingLiquidityPoolAggregator: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        id: "0x1234567890123456789012345678901234567890",
        chainId: 10,
        name: "TEST/USDC",
        token0_id: "0x2222222222222222222222222222222222222222_10",
        token1_id: "0x3333333333333333333333333333333333333333_10",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 1000000n,
        reserve1: 2000000n,
        totalLiquidityUSD: 3000000n,
        totalVolume0: 500000n,
        totalVolume1: 1000000n,
        totalVolumeUSD: 1500000n,
        totalVolumeUSDWhitelisted: 1500000n,
        gaugeFees0CurrentEpoch: 1000n,
        gaugeFees1CurrentEpoch: 2000n,
        totalFees0: 5000n,
        totalFees1: 10000n,
        totalFeesUSD: 15000n,
        totalFeesUSDWhitelisted: 15000n,
        numberOfSwaps: 25n,
        token0Price: 2000000000000000000n,
        token1Price: 500000000000000000n,
        totalVotesDeposited: 100000n,
        totalVotesDepositedUSD: 200000n,
        totalEmissions: 50000n,
        totalEmissionsUSD: 100000n,
        totalBribesUSD: 25000n,
        gaugeIsAlive: true,
        token0IsWhitelisted: true,
        token1IsWhitelisted: true,
        lastUpdatedTimestamp: new Date("2024-01-01T00:00:00Z"),
        lastSnapshotTimestamp: new Date("2024-01-01T00:00:00Z"),
        feeProtocol0: 100n,
        feeProtocol1: 200n,
        observationCardinalityNext: 1000n,
        totalFlashLoanFees0: 100n,
        totalFlashLoanFees1: 200n,
        totalFlashLoanFeesUSD: 300n,
        totalFlashLoanVolumeUSD: 10000n,
        numberOfFlashLoans: 5n,
        numberOfGaugeDeposits: 10n,
        numberOfGaugeWithdrawals: 5n,
        numberOfGaugeRewardClaims: 3n,
        totalGaugeRewardsClaimedUSD: 5000n,
        totalGaugeRewardsClaimed: 5000n,
        currentLiquidityStakedUSD: 100000n,
      };

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
        "0x1234567890123456789012345678901234567890",
      );
      expect(updatedEntity).to.not.be.undefined;
      expect(updatedEntity?.poolLauncherPoolId).to.equal(
        "10-0x1234567890123456789012345678901234567890",
      );
    });

    it("should normalize pool address to lowercase", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 8453;

      const existingLiquidityPoolAggregator: LiquidityPoolAggregator = {
        ...mockLiquidityPoolData,
        id: "0x1234567890123456789012345678901234567890",
        chainId: 8453,
        name: "TEST/USDC",
        token0_id: "0x2222222222222222222222222222222222222222_8453",
        token1_id: "0x3333333333333333333333333333333333333333_8453",
        token0_address: "0x2222222222222222222222222222222222222222",
        token1_address: "0x3333333333333333333333333333333333333333",
        isStable: false,
        isCL: true,
        reserve0: 1000000n,
        reserve1: 2000000n,
        totalLiquidityUSD: 3000000n,
        totalVolume0: 500000n,
        totalVolume1: 1000000n,
        totalVolumeUSD: 1500000n,
        totalVolumeUSDWhitelisted: 1500000n,
        gaugeFees0CurrentEpoch: 1000n,
        gaugeFees1CurrentEpoch: 2000n,
        totalFees0: 5000n,
        totalFees1: 10000n,
        totalFeesUSD: 15000n,
        totalFeesUSDWhitelisted: 15000n,
        numberOfSwaps: 25n,
        token0Price: 2000000000000000000n,
        token1Price: 500000000000000000n,
        totalVotesDeposited: 100000n,
        totalVotesDepositedUSD: 200000n,
        totalEmissions: 50000n,
        totalEmissionsUSD: 100000n,
        totalBribesUSD: 25000n,
        gaugeIsAlive: true,
        token0IsWhitelisted: true,
        token1IsWhitelisted: true,
        lastUpdatedTimestamp: new Date("2024-01-01T00:00:00Z"),
        lastSnapshotTimestamp: new Date("2024-01-01T00:00:00Z"),
        feeProtocol0: 100n,
        feeProtocol1: 200n,
        observationCardinalityNext: 1000n,
        totalFlashLoanFees0: 100n,
        totalFlashLoanFees1: 200n,
        totalFlashLoanFeesUSD: 300n,
        totalFlashLoanVolumeUSD: 10000n,
        numberOfFlashLoans: 5n,
        numberOfGaugeDeposits: 10n,
        numberOfGaugeWithdrawals: 5n,
        numberOfGaugeRewardClaims: 3n,
        totalGaugeRewardsClaimedUSD: 5000n,
        totalGaugeRewardsClaimed: 5000n,
        currentLiquidityStakedUSD: 100000n,
      };

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
        "0x1234567890123456789012345678901234567890",
      );
      expect(updatedEntity).to.not.be.undefined;
      expect(updatedEntity?.poolLauncherPoolId).to.equal(
        "8453-0x1234567890123456789012345678901234567890",
      );
    });
  });
});
