import { createTestIndexer } from "envio";
import { CLPoolMintEventId, toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { setupCommon } from "../Pool/common";

describe("CLPool Mint Event Handler", () => {
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const chainId = 10;
  const ownerAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const transactionHash =
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

  it("should create CLPoolMintEvent entity when processing Mint event", async () => {
    const indexer = createTestIndexer();
    indexer.Pool.set(mockLiquidityPoolData);
    indexer.Token.set(mockToken0Data);
    indexer.Token.set(mockToken1Data);

    const logIndex = 1;
    await simulateEvent(indexer, chainId, {
      contract: "CLPool",
      event: "Mint",
      params: {
        owner: ownerAddress,
        tickLower: -100000n,
        tickUpper: 100000n,
        amount: 1000000000000000000n,
        amount0: 500000000000000000n,
        amount1: 300000000000000000n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      srcAddress: poolAddress as `0x${string}`,
      transaction: { hash: transactionHash },
      logIndex,
    });

    // Verify that CLPoolMintEvent entity was created
    const mintEventId = CLPoolMintEventId(
      chainId,
      poolAddress,
      transactionHash,
      logIndex,
    );
    const createdMintEvent = await indexer.CLPoolMintEvent.get(mintEventId);
    expect(createdMintEvent).toBeDefined();

    if (!createdMintEvent) return; // Type guard

    // Verify correct fields from event
    expect(createdMintEvent.id).toBe(mintEventId);
    expect(createdMintEvent.chainId).toBe(chainId);
    expect(createdMintEvent.owner.toLowerCase()).toBe(
      ownerAddress.toLowerCase(),
    );
    expect(createdMintEvent.pool).toBe(poolAddress);
    expect(createdMintEvent.tickUpper).toBe(100000n);
    expect(createdMintEvent.tickLower).toBe(-100000n);
    expect(createdMintEvent.token0).toBe(mockToken0Data.address);
    expect(createdMintEvent.token1).toBe(mockToken1Data.address);
    expect(createdMintEvent.transactionHash).toBe(transactionHash);
    expect(createdMintEvent.logIndex).toBe(logIndex);
    expect(createdMintEvent.liquidity).toBe(1000000000000000000n);
  });

  it("should create CLPoolMintEvent with correct transaction hash for filtering", async () => {
    const indexer = createTestIndexer();
    indexer.Pool.set(mockLiquidityPoolData);
    indexer.Token.set(mockToken0Data);
    indexer.Token.set(mockToken1Data);

    const customTransactionHash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const logIndex = 2;

    await simulateEvent(indexer, chainId, {
      contract: "CLPool",
      event: "Mint",
      params: {
        owner: ownerAddress,
        tickLower: -50000n,
        tickUpper: 50000n,
        amount: 500000000000000000n,
        amount0: 250000000000000000n,
        amount1: 150000000000000000n,
      },
      block: {
        timestamp: 2000000,
        number: 234567,
        hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
      srcAddress: poolAddress as `0x${string}`,
      transaction: { hash: customTransactionHash },
      logIndex,
    });

    const mintEventId = CLPoolMintEventId(
      chainId,
      poolAddress,
      customTransactionHash,
      logIndex,
    );
    const createdMintEvent = await indexer.CLPoolMintEvent.get(mintEventId);
    expect(createdMintEvent).toBeDefined();
    if (!createdMintEvent) return;

    // Verify transaction hash matches (important for NFPM.Transfer matching)
    expect(createdMintEvent.transactionHash).toBe(customTransactionHash);
    expect(createdMintEvent.logIndex).toBe(logIndex);
  });

  it("should handle zero amounts correctly", async () => {
    const indexer = createTestIndexer();
    indexer.Pool.set(mockLiquidityPoolData);
    indexer.Token.set(mockToken0Data);
    indexer.Token.set(mockToken1Data);

    const logIndex = 1;
    await simulateEvent(indexer, chainId, {
      contract: "CLPool",
      event: "Mint",
      params: {
        owner: ownerAddress,
        tickLower: 0n,
        tickUpper: 0n,
        amount: 0n,
        amount0: 0n,
        amount1: 0n,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      },
      srcAddress: poolAddress as `0x${string}`,
      transaction: { hash: transactionHash },
      logIndex,
    });

    const mintEventId = CLPoolMintEventId(
      chainId,
      poolAddress,
      transactionHash,
      logIndex,
    );
    const createdMintEvent = await indexer.CLPoolMintEvent.get(mintEventId);
    expect(createdMintEvent).toBeDefined();
    if (!createdMintEvent) return;

    expect(createdMintEvent.liquidity).toBe(0n);
  });
});
