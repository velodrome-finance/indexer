import "../../eventHandlersRegistration";
import { CLPool, MockDb } from "../../../generated/src/TestHelpers.gen";
import { CLPoolMintEventId, toChecksumAddress } from "../../../src/Constants";
import { setupCommon } from "../Pool/common";

describe("CLPool Mint Event Handler", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const poolAddress = mockLiquidityPoolData.poolAddress;
  const chainId = 10;
  const ownerAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const transactionHash =
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

  beforeEach(() => {
    mockDb = MockDb.createMockDb();

    // Set up mock database with required entities
    const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolData,
    );
    const updatedDB2 = updatedDB1.entities.Token.set(mockToken0Data);
    mockDb = updatedDB2.entities.Token.set(mockToken1Data);
  });

  it("should create CLPoolMintEvent entity when processing Mint event", async () => {
    const mockEvent = CLPool.Mint.createMockEvent({
      owner: ownerAddress,
      tickLower: -100000n,
      tickUpper: 100000n,
      amount: 1000000000000000000n,
      amount0: 500000000000000000n,
      amount1: 300000000000000000n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId,
        logIndex: 1,
        srcAddress: poolAddress as `0x${string}`,
        transaction: {
          hash: transactionHash,
        },
      },
    });

    const result = await mockDb.processEvents([mockEvent]);

    // Verify that CLPoolMintEvent entity was created
    const mintEventId = CLPoolMintEventId(
      chainId,
      poolAddress,
      transactionHash,
      mockEvent.logIndex,
    );
    const createdMintEvent = result.entities.CLPoolMintEvent.get(mintEventId);
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
    expect(createdMintEvent.logIndex).toBe(mockEvent.logIndex);
    expect(createdMintEvent.liquidity).toBe(1000000000000000000n);
  });

  it("should create CLPoolMintEvent with correct transaction hash for filtering", async () => {
    const customTransactionHash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    const mockEvent = CLPool.Mint.createMockEvent({
      owner: ownerAddress,
      tickLower: -50000n,
      tickUpper: 50000n,
      amount: 500000000000000000n,
      amount0: 250000000000000000n,
      amount1: 150000000000000000n,
      mockEventData: {
        block: {
          timestamp: 2000000,
          number: 234567,
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        },
        chainId,
        logIndex: 2,
        srcAddress: poolAddress as `0x${string}`,
        transaction: {
          hash: customTransactionHash,
        },
      },
    });

    const result = await mockDb.processEvents([mockEvent]);

    const mintEventId = CLPoolMintEventId(
      chainId,
      poolAddress,
      customTransactionHash,
      mockEvent.logIndex,
    );
    const createdMintEvent = result.entities.CLPoolMintEvent.get(mintEventId);
    expect(createdMintEvent).toBeDefined();
    if (!createdMintEvent) return;

    // Verify transaction hash matches (important for NFPM.Transfer matching)
    expect(createdMintEvent.transactionHash).toBe(customTransactionHash);
    expect(createdMintEvent.logIndex).toBe(mockEvent.logIndex);
  });

  it("should handle zero amounts correctly", async () => {
    const mockEvent = CLPool.Mint.createMockEvent({
      owner: ownerAddress,
      tickLower: 0n,
      tickUpper: 0n,
      amount: 0n,
      amount0: 0n,
      amount1: 0n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId,
        logIndex: 1,
        srcAddress: poolAddress as `0x${string}`,
        transaction: {
          hash: transactionHash,
        },
      },
    });

    const result = await mockDb.processEvents([mockEvent]);

    const mintEventId = CLPoolMintEventId(
      chainId,
      poolAddress,
      transactionHash,
      mockEvent.logIndex,
    );
    const createdMintEvent = result.entities.CLPoolMintEvent.get(mintEventId);
    expect(createdMintEvent).toBeDefined();
    if (!createdMintEvent) return;

    expect(createdMintEvent.liquidity).toBe(0n);
  });
});
