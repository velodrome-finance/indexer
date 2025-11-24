import { expect } from "chai";
import { CLPool, MockDb } from "../../../generated/src/TestHelpers.gen";
import { setupCommon } from "../Pool/common";

describe("CLPool Mint Event Handler", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  const { mockLiquidityPoolData, mockToken0Data, mockToken1Data } =
    setupCommon();
  const chainId = 10;
  const poolAddress = mockLiquidityPoolData.id;
  const ownerAddress = "0x1111111111111111111111111111111111111111";
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

  it("should create NonFungiblePosition entity when processing Mint event", async () => {
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
        srcAddress: poolAddress,
        transaction: {
          hash: transactionHash,
        },
      },
    });

    const result = await CLPool.Mint.processEvent({
      event: mockEvent,
      mockDb,
    });

    // Verify that NonFungiblePosition entity was created
    // Placeholder ID format: ${chainId}_${txHash}_${logIndex} (without 0x prefix)
    const placeholderId = `${chainId}_${transactionHash.slice(2)}_${mockEvent.logIndex}`;
    const createdPosition =
      result.entities.NonFungiblePosition.get(placeholderId);
    expect(createdPosition).to.not.be.undefined;
    expect(createdPosition).to.exist;

    if (!createdPosition) return; // Type guard

    // Verify placeholder values (to be updated by NFPM.Transfer)
    expect(createdPosition.id).to.equal(placeholderId);
    expect(createdPosition.tokenId).to.equal(BigInt(mockEvent.logIndex));

    // Verify correct fields from event
    expect(createdPosition.chainId).to.equal(chainId);
    expect(createdPosition.owner.toLowerCase()).to.equal(
      ownerAddress.toLowerCase(),
    );
    expect(createdPosition.pool).to.equal(poolAddress);
    expect(createdPosition.tickUpper).to.equal(100000n);
    expect(createdPosition.tickLower).to.equal(-100000n);
    expect(createdPosition.token0).to.equal(mockToken0Data.address);
    expect(createdPosition.token1).to.equal(mockToken1Data.address);
    expect(createdPosition.amount0).to.equal(500000000000000000n);
    expect(createdPosition.amount1).to.equal(300000000000000000n);
    expect(createdPosition.mintTransactionHash).to.equal(transactionHash);
    expect(createdPosition.lastUpdatedTimestamp).to.deep.equal(
      new Date(1000000 * 1000),
    );

    // Verify amountUSD is calculated (should match netLiquidityAddedUSD from the mint result)
    // The amountUSD comes from result.userLiquidityDiff.netLiquidityAddedUSD
    // Calculation:
    // - amount0: 500000000000000000n (0.5 tokens, 18 decimals) * 1e18 = 500000000000000000n
    // - amount1: 300000000000000000n (300M tokens, 6 decimals)
    //   Normalized to 18 decimals: 300000000000000000n * 10^12 = 300000000000000000000000000n
    //   USD: 300000000000000000000000000n * 1e18 / 1e18 = 300000000000000000000000000n
    // Total: 300000000000500000000000000000n
    expect(createdPosition.amountUSD).to.be.a("bigint");
    expect(createdPosition.amountUSD).to.equal(300000000000500000000000000000n);
  });

  it("should create NonFungiblePosition with correct transaction hash for filtering", async () => {
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
        srcAddress: poolAddress,
        transaction: {
          hash: customTransactionHash,
        },
      },
    });

    const result = await CLPool.Mint.processEvent({
      event: mockEvent,
      mockDb,
    });

    // Placeholder ID format: ${chainId}_${txHash}_${logIndex} (without 0x prefix)
    const placeholderId = `${chainId}_${customTransactionHash.slice(2)}_${mockEvent.logIndex}`;
    const createdPosition =
      result.entities.NonFungiblePosition.get(placeholderId);
    expect(createdPosition).to.exist;
    if (!createdPosition) return;

    // Verify transaction hash matches (important for NFPM.IncreaseLiquidity filtering)
    expect(createdPosition.mintTransactionHash).to.equal(customTransactionHash);
    expect(createdPosition.amount0).to.equal(250000000000000000n);
    expect(createdPosition.amount1).to.equal(150000000000000000n);
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
        srcAddress: poolAddress,
        transaction: {
          hash: transactionHash,
        },
      },
    });

    const result = await CLPool.Mint.processEvent({
      event: mockEvent,
      mockDb,
    });

    // Placeholder ID format: ${chainId}_${txHash}_${logIndex} (without 0x prefix)
    const placeholderId = `${chainId}_${transactionHash.slice(2)}_${mockEvent.logIndex}`;
    const createdPosition =
      result.entities.NonFungiblePosition.get(placeholderId);
    expect(createdPosition).to.exist;
    if (!createdPosition) return;

    expect(createdPosition.amount0).to.equal(0n);
    expect(createdPosition.amount1).to.equal(0n);
    expect(createdPosition.amountUSD).to.equal(0n);
  });
});
