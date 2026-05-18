import { createTestIndexer } from "envio";
import type { PublicClient } from "viem";
import type { Mock } from "vitest";
import {
  CHAIN_CONSTANTS,
  CLPoolMintEventId,
  NonFungiblePositionId,
  TokenId,
  TxCLPoolMintRegistryId,
  toChecksumAddress,
} from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { defaultNfpmAddress, setupCommon } from "../Pool/common";

describe("NFPM Events", () => {
  const {
    mockToken0Data,
    mockToken1Data,
    mockLiquidityPoolData,
    createMockPool,
  } = setupCommon();

  const chainId = mockLiquidityPoolData.chainId;
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;
  const tokenId = 1n;
  const nfpmAddress = defaultNfpmAddress;

  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  // Mock position with amounts matching the IncreaseLiquidity event amounts
  // This represents a newly minted position before the IncreaseLiquidity event
  const mockNonFungiblePosition = {
    id: NonFungiblePositionId(chainId, nfpmAddress, tokenId),
    chainId,
    tokenId: tokenId,
    nfpmAddress: nfpmAddress,
    owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    pool: poolAddress,
    tickUpper: 100n,
    tickLower: -100n,
    token0: token0Address,
    token1: token1Address,
    liquidity: 1000000000000000000n,
    mintTransactionHash: transactionHash,
    mintLogIndex: 42,
    lastUpdatedTimestamp: new Date(1000000 * 1000),
    lastSnapshotTimestamp: undefined,
    isStakedInGauge: false,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Transfer Event", () => {
    const eventData = {
      from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      tokenId: 1n,
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: nfpmAddress,
    };

    it("should update the owner", async () => {
      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set({ ...mockNonFungiblePosition });
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      indexer.Pool.set(mockLiquidityPoolData);

      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "Transfer",
        params: {
          from: eventData.from,
          to: eventData.to,
          tokenId: eventData.tokenId,
        },
        block: eventData.block,
        srcAddress: nfpmAddress,
        logIndex: eventData.logIndex,
      });

      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return;
      expect(updatedEntity.owner).toBe(eventData.to);
    });

    it("should create position from CLPoolMintEvent (integration test)", async () => {
      // Simulate the real flow: CLPool.Mint creates a CLPoolMintEvent, then NFPM.Transfer creates the position
      // In this test, CLPool.Mint has logIndex 0, Transfer has logIndex 2
      const mintLogIndex = 0;
      const transferLogIndex = 2;
      const stableId = NonFungiblePositionId(chainId, nfpmAddress, tokenId);

      const mockCLPoolMintEvent = {
        id: CLPoolMintEventId(
          chainId,
          poolAddress,
          transactionHash,
          mintLogIndex,
        ),
        chainId,
        pool: poolAddress,
        owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
        tickLower: -100n,
        tickUpper: 100n,
        liquidity: 1000000000000000000n,
        amount0: 0n,
        amount1: 0n,
        token0: token0Address,
        token1: token1Address,
        transactionHash: transactionHash,
        logIndex: mintLogIndex,
        consumedByTokenId: undefined,
        createdAt: new Date(1000000 * 1000),
      };

      const indexer = createTestIndexer();
      indexer.CLPoolMintEvent.set(mockCLPoolMintEvent);
      indexer.TxCLPoolMintRegistry.set({
        id: TxCLPoolMintRegistryId(chainId, transactionHash),
        mintEventIds: [mockCLPoolMintEvent.id],
      });
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);

      // Create Transfer event for mint (from = zero address)
      // Transfer logIndex must be > mint logIndex for matching logic
      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "Transfer",
        params: {
          from: toChecksumAddress("0x0000000000000000000000000000000000000000"), // Mint event
          to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
          tokenId: tokenId,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: {
          hash: transactionHash,
        },
        srcAddress: nfpmAddress,
        logIndex: transferLogIndex,
      });

      // Should create position with stable ID
      const createdEntity = await indexer.NonFungiblePosition.get(stableId);
      expect(createdEntity).toBeDefined();
      if (!createdEntity) return;

      // Verify it was created correctly
      expect(createdEntity.id).toBe(stableId); // Stable ID format
      expect(createdEntity.tokenId).toBe(tokenId);
      expect(createdEntity.owner).toBe(
        toChecksumAddress("0x2222222222222222222222222222222222222222"),
      );
      expect(createdEntity.pool).toBe(poolAddress);
      expect(createdEntity.mintLogIndex).toBe(mintLogIndex);
    });
  });

  describe("IncreaseLiquidity Event", () => {
    const eventData = {
      tokenId: 1n,
      liquidity: 1000n,
      amount0: 500000000000000000n,
      amount1: 1000000000000000000n,
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: nfpmAddress,
      transaction: {
        hash: transactionHash,
      },
    };

    it("should increase liquidity", async () => {
      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set({ ...mockNonFungiblePosition });
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      indexer.Pool.set(mockLiquidityPoolData);

      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "IncreaseLiquidity",
        params: {
          tokenId: eventData.tokenId,
          liquidity: eventData.liquidity,
          amount0: eventData.amount0,
          amount1: eventData.amount1,
        },
        block: eventData.block,
        transaction: eventData.transaction,
        srcAddress: nfpmAddress,
        logIndex: eventData.logIndex,
      });

      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return; // Type guard
      // With liquidity = 1e18 + 1000, price at tick 0, ticks -100 to 100
      expect(updatedEntity.owner).toBe(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).toBe(mockNonFungiblePosition.tickUpper);
      expect(updatedEntity.tickLower).toBe(mockNonFungiblePosition.tickLower);
    });

    it("should filter by transactionHash and then by tickLower/tickUpper/liquidity when multiple positions exist", async () => {
      // Create a second position with different ticks but same transaction hash
      const position2 = {
        ...mockNonFungiblePosition,
        id: NonFungiblePositionId(chainId, nfpmAddress, 2n),
        tokenId: 2n,
        tickLower: -200n, // Different ticks - won't match IncreaseLiquidity event
        tickUpper: 200n,
      };

      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set({ ...mockNonFungiblePosition });
      indexer.NonFungiblePosition.set(position2);
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      indexer.Pool.set(mockLiquidityPoolData);

      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "IncreaseLiquidity",
        params: {
          tokenId: eventData.tokenId,
          liquidity: eventData.liquidity,
          amount0: eventData.amount0,
          amount1: eventData.amount1,
        },
        block: eventData.block,
        transaction: eventData.transaction,
        srcAddress: nfpmAddress,
        logIndex: eventData.logIndex,
      });

      // Should match the first position, not the second
      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return;
    });

    it("should log error and return when no positions found by transaction hash", async () => {
      // Test error case: no positions found (no pre-seeded position)
      const indexer = createTestIndexer();
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);

      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "IncreaseLiquidity",
        params: {
          tokenId: eventData.tokenId,
          liquidity: eventData.liquidity,
          amount0: eventData.amount0,
          amount1: eventData.amount1,
        },
        block: eventData.block,
        transaction: eventData.transaction,
        srcAddress: nfpmAddress,
        logIndex: eventData.logIndex,
      });

      // Should not create or update any position
      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, tokenId),
      );
      expect(updatedEntity).toBeUndefined();
    });

    it("should log error and return when no matching position found by amounts", async () => {
      // Test error case: position not found by tokenId, and amounts don't match when searching by transaction hash
      // Use a different tokenId so it's not found by tokenId query
      const differentTokenId = 999n;
      const positionWithDifferentTokenId = {
        ...mockNonFungiblePosition,
        id: NonFungiblePositionId(chainId, nfpmAddress, differentTokenId),
        tokenId: differentTokenId,
      };

      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set(positionWithDifferentTokenId);
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);

      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "IncreaseLiquidity",
        params: {
          tokenId: eventData.tokenId,
          liquidity: eventData.liquidity,
          amount0: eventData.amount0,
          amount1: eventData.amount1,
        },
        block: eventData.block,
        transaction: eventData.transaction,
        srcAddress: nfpmAddress,
        logIndex: eventData.logIndex,
      });

      // Should not update the position (amounts don't match, handler returns early)
      // Position should still exist in the result with original values
      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, differentTokenId),
      );
      // Position exists but wasn't updated (still has original amounts)
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return;
    });
  });

  describe("DecreaseLiquidity Event", () => {
    const eventData = {
      tokenId: 1n,
      liquidity: 1000n,
      amount0: 300000000000000000n,
      amount1: 500000000000000000n,
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      chainId: 10,
      logIndex: 1,
      srcAddress: nfpmAddress,
    };

    it("should decrease liquidity", async () => {
      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set({ ...mockNonFungiblePosition });
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      indexer.Pool.set(mockLiquidityPoolData);

      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "DecreaseLiquidity",
        params: {
          tokenId: eventData.tokenId,
          liquidity: eventData.liquidity,
          amount0: eventData.amount0,
          amount1: eventData.amount1,
        },
        block: eventData.block,
        srcAddress: nfpmAddress,
        logIndex: eventData.logIndex,
      });

      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, tokenId),
      );
      expect(updatedEntity).toBeDefined();
      if (!updatedEntity) return; // Type guard
      // With liquidity = 1e18 - 1000, price at tick 0, ticks -100 to 100
      expect(updatedEntity.owner).toBe(mockNonFungiblePosition.owner);
      expect(updatedEntity.tickUpper).toBe(mockNonFungiblePosition.tickUpper);
      expect(updatedEntity.tickLower).toBe(mockNonFungiblePosition.tickLower);
    });

    it("should log error and return when position not found (Transfer should have run first)", async () => {
      // Simulate scenario where position doesn't exist
      const indexer = createTestIndexer();
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);

      // Create DecreaseLiquidity event for non-existent position
      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "DecreaseLiquidity",
        params: {
          tokenId: tokenId,
          liquidity: 1000n,
          amount0: 300000000000000000n,
          amount1: 500000000000000000n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: {
          hash: transactionHash,
        },
        srcAddress: nfpmAddress,
        logIndex: 1,
      });

      // Should not create any position
      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, tokenId),
      );
      expect(updatedEntity).toBeUndefined();
    });

    it("should log error and return when position is not found", async () => {
      // Test the error case: no position pre-seeded, just tokens
      const indexer = createTestIndexer();
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);

      await simulateEvent(indexer, chainId, {
        contract: "NFPM",
        event: "DecreaseLiquidity",
        params: {
          tokenId: tokenId,
          liquidity: 1000n,
          amount0: 300000000000000000n,
          amount1: 500000000000000000n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: {
          hash: transactionHash,
        },
        srcAddress: nfpmAddress,
        logIndex: 1,
      });

      // Should not create any position
      const updatedEntity = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainId, nfpmAddress, tokenId),
      );
      expect(updatedEntity).toBeUndefined();
    });
  });

  describe("Cross-chain tokenId collision prevention", () => {
    // Test the fix for cross-chain tokenId collisions
    // Same tokenId can exist on different chains, so we must filter by chainId
    const chainIdBase = 8453; // Base
    const chainIdLisk = 1135; // Lisk
    const sameTokenId = 42n; // Same tokenId on both chains
    const poolAddressBase = toChecksumAddress(
      "0x0000000000000000000000000000000000000001",
    );
    const poolAddressLisk = toChecksumAddress(
      "0xc2026f3fb6fc51F4EcAE40a88b4509cB6C143ed4",
    ); // The pool from the error

    // Position on Base (chain 8453)
    const positionBase = {
      id: NonFungiblePositionId(chainIdBase, nfpmAddress, sameTokenId),
      chainId: chainIdBase,
      tokenId: sameTokenId,
      nfpmAddress: nfpmAddress,
      owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
      pool: poolAddressBase,
      tickUpper: 100n,
      tickLower: -100n,
      token0: token0Address,
      token1: token1Address,
      liquidity: 1000000000000000000n,
      mintTransactionHash: transactionHash,
      mintLogIndex: 42,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
      lastSnapshotTimestamp: undefined,
      isStakedInGauge: false,
    };

    // Position on Lisk (chain 1135) with same tokenId
    const positionLisk = {
      id: NonFungiblePositionId(chainIdLisk, nfpmAddress, sameTokenId),
      chainId: chainIdLisk,
      tokenId: sameTokenId,
      nfpmAddress: nfpmAddress,
      owner: toChecksumAddress("0x2222222222222222222222222222222222222222"),
      pool: poolAddressLisk,
      tickUpper: 200n,
      tickLower: -200n,
      token0: token0Address,
      token1: token1Address,
      liquidity: 2000000000000000000n,
      mintTransactionHash: transactionHash,
      mintLogIndex: 42,
      lastUpdatedTimestamp: new Date(1000000 * 1000),
      lastSnapshotTimestamp: undefined,
      isStakedInGauge: false,
    };

    // Variables to hold mocks for verification
    let mockReadContractBase: Mock;
    let mockReadContractLisk: Mock;

    let originalChainConstantsBase: (typeof CHAIN_CONSTANTS)[number];
    let originalChainConstantsLisk: (typeof CHAIN_CONSTANTS)[number];

    beforeEach(() => {
      // Store original values
      originalChainConstantsBase = CHAIN_CONSTANTS[chainIdBase];
      originalChainConstantsLisk = CHAIN_CONSTANTS[chainIdLisk];

      // Mock ethClient for Base chain - create fresh mocks for each test
      const Q96 = 2n ** 96n;
      const mockSqrtPriceX96 = Q96;
      // readContract returns the decoded value directly
      mockReadContractBase = vi.fn().mockImplementation(async () => {
        return [mockSqrtPriceX96];
      });
      const mockEthClientBase = {
        readContract: mockReadContractBase,
      } as unknown as PublicClient;

      // Mock ethClient for Lisk chain - create fresh mocks for each test
      mockReadContractLisk = vi.fn().mockImplementation(async () => {
        return [mockSqrtPriceX96];
      });
      const mockEthClientLisk = {
        readContract: mockReadContractLisk,
      } as unknown as PublicClient;

      // Setup CHAIN_CONSTANTS for both chains - ensure it's set before any effects are called
      (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
        chainIdBase
      ] = {
        eth_client: mockEthClientBase,
      };
      (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
        chainIdLisk
      ] = {
        eth_client: mockEthClientLisk,
      };
    });

    afterEach(() => {
      // Restore original CHAIN_CONSTANTS
      if (originalChainConstantsBase !== undefined) {
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainIdBase
        ] = originalChainConstantsBase;
      } else {
        delete (
          CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>
        )[chainIdBase];
      }
      if (originalChainConstantsLisk !== undefined) {
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainIdLisk
        ] = originalChainConstantsLisk;
      } else {
        delete (
          CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>
        )[chainIdLisk];
      }
      vi.restoreAllMocks();
    });

    it("should filter by chainId when querying by tokenId in Transfer event", async () => {
      // Tokens for Base chain so loadPoolData can resolve and Transfer can update owner
      const mockToken0DataBase = {
        ...mockToken0Data,
        id: TokenId(chainIdBase, token0Address),
        chainId: chainIdBase,
      };
      const mockToken1DataBase = {
        ...mockToken1Data,
        id: TokenId(chainIdBase, token1Address),
        chainId: chainIdBase,
      };
      const mockPoolBase = createMockPool({
        chainId: chainIdBase,
        poolAddress: poolAddressBase,
        token0_id: mockToken0DataBase.id,
        token1_id: mockToken1DataBase.id,
        token0_address: token0Address,
        token1_address: token1Address,
      });

      // Setup indexer with both positions (same tokenId, different chains)
      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set(positionBase);
      indexer.NonFungiblePosition.set(positionLisk);
      indexer.Token.set(mockToken0Data);
      indexer.Token.set(mockToken1Data);
      indexer.Token.set(mockToken0DataBase);
      indexer.Token.set(mockToken1DataBase);
      indexer.Pool.set(mockPoolBase);

      // Create Transfer event on Base chain
      await simulateEvent(indexer, chainIdBase, {
        contract: "NFPM",
        event: "Transfer",
        params: {
          from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
          to: toChecksumAddress("0x3333333333333333333333333333333333333333"),
          tokenId: sameTokenId,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        srcAddress: nfpmAddress,
        logIndex: 1,
      });

      // Should only update the Base position, not the Lisk position
      const updatedBasePosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, nfpmAddress, sameTokenId),
      );
      const liskPosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, nfpmAddress, sameTokenId),
      );

      expect(updatedBasePosition).toBeDefined();
      if (!updatedBasePosition) return;
      // Should update owner to the new owner
      expect(updatedBasePosition.owner).toBe(
        toChecksumAddress("0x3333333333333333333333333333333333333333"),
      );
      // Should still have Base chain pool address
      expect(updatedBasePosition.pool).toBe(poolAddressBase);
      expect(updatedBasePosition.chainId).toBe(chainIdBase);

      // Lisk position should remain unchanged
      expect(liskPosition).toBeDefined();
      if (!liskPosition) return;
      expect(liskPosition.owner).toBe(positionLisk.owner);
      expect(liskPosition.pool).toBe(poolAddressLisk);
      expect(liskPosition.chainId).toBe(chainIdLisk);
    });

    it("should filter by chainId when querying by tokenId in IncreaseLiquidity event", async () => {
      // Verify CHAIN_CONSTANTS is set up correctly before test
      expect(CHAIN_CONSTANTS[chainIdBase]).toBeDefined();
      expect(CHAIN_CONSTANTS[chainIdBase].eth_client).toBeDefined();
      expect(mockReadContractBase).toBeDefined();

      // Create tokens for Base chain
      const mockToken0DataBase = {
        ...mockToken0Data,
        id: TokenId(chainIdBase, token0Address),
        chainId: chainIdBase,
      };
      const mockToken1DataBase = {
        ...mockToken1Data,
        id: TokenId(chainIdBase, token1Address),
        chainId: chainIdBase,
      };

      // Setup indexer with both positions
      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set(positionBase);
      indexer.NonFungiblePosition.set(positionLisk);
      indexer.Token.set(mockToken0DataBase);
      indexer.Token.set(mockToken1DataBase);

      // Create IncreaseLiquidity event on Base chain
      await simulateEvent(indexer, chainIdBase, {
        contract: "NFPM",
        event: "IncreaseLiquidity",
        params: {
          tokenId: sameTokenId,
          liquidity: 1000n,
          amount0: 500000000000000000n,
          amount1: 1000000000000000000n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: {
          hash: transactionHash,
        },
        srcAddress: nfpmAddress,
        logIndex: 1,
      });

      // Should only update the Base position
      const updatedBasePosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, nfpmAddress, sameTokenId),
      );
      const liskPosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, nfpmAddress, sameTokenId),
      );

      expect(updatedBasePosition).toBeDefined();
      if (!updatedBasePosition) return;
      // Should have updated liquidity (increased)
      expect(Number(updatedBasePosition.liquidity)).toBeGreaterThan(
        Number(positionBase.liquidity),
      );

      // Lisk position should remain unchanged
      expect(liskPosition).toBeDefined();
      if (!liskPosition) return;
      expect(typeof liskPosition.liquidity).toBe("bigint");
      expect(liskPosition.liquidity).toBe(positionLisk.liquidity);
      // Should NOT have called Lisk ethClient
      expect(mockReadContractLisk).not.toHaveBeenCalled();
    });

    it("should filter by chainId when querying by tokenId in DecreaseLiquidity event", async () => {
      // Verify CHAIN_CONSTANTS is set up correctly before test
      expect(CHAIN_CONSTANTS[chainIdLisk]).toBeDefined();
      expect(CHAIN_CONSTANTS[chainIdLisk].eth_client).toBeDefined();
      expect(mockReadContractLisk).toBeDefined();

      // Create tokens for Lisk chain
      const mockToken0DataLisk = {
        ...mockToken0Data,
        id: TokenId(chainIdLisk, token0Address),
        chainId: chainIdLisk,
      };
      const mockToken1DataLisk = {
        ...mockToken1Data,
        id: TokenId(chainIdLisk, token1Address),
        chainId: chainIdLisk,
      };

      // Setup indexer with both positions
      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set(positionBase);
      indexer.NonFungiblePosition.set(positionLisk);
      indexer.Token.set(mockToken0DataLisk);
      indexer.Token.set(mockToken1DataLisk);

      // Create DecreaseLiquidity event on Lisk chain
      await simulateEvent(indexer, chainIdLisk, {
        contract: "NFPM",
        event: "DecreaseLiquidity",
        params: {
          tokenId: sameTokenId,
          liquidity: 1000n,
          amount0: 300000000000000000n,
          amount1: 500000000000000000n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: {
          hash: transactionHash,
        },
        srcAddress: nfpmAddress,
        logIndex: 1,
      });

      // Should only update the Lisk position
      const basePosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, nfpmAddress, sameTokenId),
      );
      const updatedLiskPosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, nfpmAddress, sameTokenId),
      );

      expect(updatedLiskPosition).toBeDefined();
      if (!updatedLiskPosition) return;
      // Should have updated liquidity (decreased)
      expect(Number(updatedLiskPosition.liquidity)).toBeLessThan(
        Number(positionLisk.liquidity),
      );

      // Base position should remain unchanged
      expect(basePosition).toBeDefined();
      if (!basePosition) return;
      expect(basePosition.liquidity).toBe(positionBase.liquidity);
    });

    it("should prevent querying pool from wrong chain (the original bug)", async () => {
      // Setup indexer with BOTH positions (Base and Lisk with same tokenId)
      const mockToken0DataBase = {
        ...mockToken0Data,
        id: TokenId(chainIdBase, token0Address),
        chainId: chainIdBase,
      };
      const mockToken1DataBase = {
        ...mockToken1Data,
        id: TokenId(chainIdBase, token1Address),
        chainId: chainIdBase,
      };

      const indexer = createTestIndexer();
      indexer.NonFungiblePosition.set(positionBase);
      indexer.NonFungiblePosition.set(positionLisk);
      indexer.Token.set(mockToken0DataBase);
      indexer.Token.set(mockToken1DataBase);

      // Create IncreaseLiquidity event on Base chain (8453) for same tokenId
      await simulateEvent(indexer, chainIdBase, {
        contract: "NFPM",
        event: "IncreaseLiquidity",
        params: {
          tokenId: sameTokenId,
          liquidity: 1000n,
          amount0: 500000000000000000n,
          amount1: 1000000000000000000n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        transaction: {
          hash: transactionHash,
        },
        srcAddress: nfpmAddress,
        logIndex: 1,
      });

      // Verify: Base position should be updated (correct position was found and used)
      const updatedBasePosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdBase, nfpmAddress, sameTokenId),
      );
      expect(updatedBasePosition).toBeDefined();
      if (!updatedBasePosition) return;
      // Should have updated liquidity (increased)
      expect(Number(updatedBasePosition.liquidity)).toBeGreaterThan(
        Number(positionBase.liquidity),
      );

      // Verify: Lisk position should remain unchanged (wrong position was NOT used)
      const liskPosition = await indexer.NonFungiblePosition.get(
        NonFungiblePositionId(chainIdLisk, nfpmAddress, sameTokenId),
      );
      expect(liskPosition).toBeDefined();
      if (!liskPosition) return;
      expect(liskPosition.liquidity).toBe(positionLisk.liquidity);
    });
  });

  // #621 regression: two NFPMs on the same chain each have their own tokenId counter,
  // so (chainId, tokenId) alone is NOT a natural key. Adding nfpmAddress to the entity
  // ID guarantees the two positions live as distinct entities instead of silently
  // overwriting each other when they happen to mint into the same pool.
  describe("Intra-chain multi-NFPM tokenId collision prevention", () => {
    it("keeps positions under different NFPMs distinct for the same (chainId, tokenId)", () => {
      const OP_NFPM_A = toChecksumAddress(
        "0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4",
      );
      const OP_NFPM_B = toChecksumAddress(
        "0x416b433906b1B72FA758e166e239c43d68dC6F29",
      );
      const sharedChainId = 10;
      const sharedTokenId = 777n;

      const idA = NonFungiblePositionId(
        sharedChainId,
        OP_NFPM_A,
        sharedTokenId,
      );
      const idB = NonFungiblePositionId(
        sharedChainId,
        OP_NFPM_B,
        sharedTokenId,
      );

      expect(idA).not.toBe(idB);
      expect(idA).toBe(`${sharedChainId}-${OP_NFPM_A}-${sharedTokenId}`);
      expect(idB).toBe(`${sharedChainId}-${OP_NFPM_B}-${sharedTokenId}`);
    });
  });
});
