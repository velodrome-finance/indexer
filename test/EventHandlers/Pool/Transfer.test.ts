import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import { ZERO_ADDRESS } from "../../../src/Constants";
import { setupCommon } from "./common";

describe("Pool Transfer Event", () => {
  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let commonData: ReturnType<typeof setupCommon>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
    commonData = setupCommon();

    // Set up mock database with common data
    const updatedDB1 = mockDb.entities.LiquidityPoolAggregator.set(
      commonData.mockLiquidityPoolData,
    );
    const updatedDB2 = updatedDB1.entities.Token.set(commonData.mockToken0Data);
    mockDb = updatedDB2.entities.Token.set(commonData.mockToken1Data);
  });

  it("should process mint transfer and update pool totalLPTokenSupply", async () => {
    const userAddress = "0x1111111111111111111111111111111111111111";
    const LP_VALUE = 500n * 10n ** 18n;

    const mockEvent = Pool.Transfer.createMockEvent({
      from: ZERO_ADDRESS,
      to: userAddress,
      value: LP_VALUE,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 0,
        srcAddress: commonData.mockLiquidityPoolData.id,
      },
    });

    const result = await Pool.Transfer.processEvent({
      event: mockEvent,
      mockDb,
    });

    // Verify pool aggregator was updated with new totalLPTokenSupply
    const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.totalLPTokenSupply).toBe(LP_VALUE);

    // Verify PoolTransferInTx entity was created for matching
    const transferId = `10-${mockEvent.transaction.hash}-${commonData.mockLiquidityPoolData.id}-0`;
    const storedTransfer = result.entities.PoolTransferInTx.get(transferId);
    expect(storedTransfer).toBeDefined();
    expect(storedTransfer?.isMint).toBe(true);
    expect(storedTransfer?.isBurn).toBe(false);
    expect(storedTransfer?.to).toBe(userAddress);

    // Verify user LP balance was updated
    const userStats = result.entities.UserStatsPerPool.get(
      `${userAddress}_${commonData.mockLiquidityPoolData.id}_10`,
    );
    expect(userStats).toBeDefined();
    expect(userStats?.lpBalance).toBe(LP_VALUE);
  });

  it("should process burn transfer and update pool totalLPTokenSupply", async () => {
    const userAddress = "0x1111111111111111111111111111111111111111";
    const LP_VALUE = 300n * 10n ** 18n;
    const INITIAL_SUPPLY = 1000n * 10n ** 18n;

    // Set initial totalLPTokenSupply
    const poolWithSupply = {
      ...commonData.mockLiquidityPoolData,
      totalLPTokenSupply: INITIAL_SUPPLY,
    };
    const updatedDB1 =
      mockDb.entities.LiquidityPoolAggregator.set(poolWithSupply);
    mockDb = updatedDB1;

    const mockEvent = Pool.Transfer.createMockEvent({
      from: userAddress,
      to: ZERO_ADDRESS,
      value: LP_VALUE,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 0,
        srcAddress: commonData.mockLiquidityPoolData.id,
      },
    });

    const result = await Pool.Transfer.processEvent({
      event: mockEvent,
      mockDb,
    });

    // Verify pool aggregator was updated with reduced totalLPTokenSupply
    const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.totalLPTokenSupply).toBe(
      INITIAL_SUPPLY - LP_VALUE,
    );

    // Verify PoolTransferInTx entity was created for matching
    const transferId = `10-${mockEvent.transaction.hash}-${commonData.mockLiquidityPoolData.id}-0`;
    const storedTransfer = result.entities.PoolTransferInTx.get(transferId);
    expect(storedTransfer).toBeDefined();
    expect(storedTransfer?.isMint).toBe(false);
    expect(storedTransfer?.isBurn).toBe(true);
    expect(storedTransfer?.from).toBe(userAddress);

    // Verify user LP balance was updated
    const userStats = result.entities.UserStatsPerPool.get(
      `${userAddress}_${commonData.mockLiquidityPoolData.id}_10`,
    );
    expect(userStats).toBeDefined();
    expect(userStats?.lpBalance).toBe(-LP_VALUE);
  });

  it("should process regular transfer and update both user balances", async () => {
    const senderAddress = "0x1111111111111111111111111111111111111111";
    const recipientAddress = "0x2222222222222222222222222222222222222222";
    const LP_VALUE = 200n * 10n ** 18n;

    const mockEvent = Pool.Transfer.createMockEvent({
      from: senderAddress,
      to: recipientAddress,
      value: LP_VALUE,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 0,
        srcAddress: commonData.mockLiquidityPoolData.id,
      },
    });

    const result = await Pool.Transfer.processEvent({
      event: mockEvent,
      mockDb,
    });

    // Verify pool aggregator totalLPTokenSupply was NOT changed (regular transfer)
    const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.totalLPTokenSupply).toBe(0n);

    // Verify PoolTransferInTx entity was NOT created (regular transfers are not stored)
    const transferId = `10-${mockEvent.transaction.hash}-${commonData.mockLiquidityPoolData.id}-0`;
    const storedTransfer = result.entities.PoolTransferInTx.get(transferId);
    expect(storedTransfer).toBeUndefined();

    // Verify sender LP balance was decreased
    const senderStats = result.entities.UserStatsPerPool.get(
      `${senderAddress}_${commonData.mockLiquidityPoolData.id}_10`,
    );
    expect(senderStats).toBeDefined();
    expect(senderStats?.lpBalance).toBe(-LP_VALUE);

    // Verify recipient LP balance was increased
    const recipientStats = result.entities.UserStatsPerPool.get(
      `${recipientAddress}_${commonData.mockLiquidityPoolData.id}_10`,
    );
    expect(recipientStats).toBeDefined();
    expect(recipientStats?.lpBalance).toBe(LP_VALUE);
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a fresh mockDb without the pool
      const freshMockDb = MockDb.createMockDb();
      const updatedDB1 = freshMockDb.entities.Token.set(
        commonData.mockToken0Data,
      );
      const updatedDB2 = updatedDB1.entities.Token.set(
        commonData.mockToken1Data,
      );
      // Note: We intentionally don't set the LiquidityPoolAggregator

      const mockEvent = Pool.Transfer.createMockEvent({
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: 100n * 10n ** 18n,
        mockEventData: {
          block: {
            timestamp: 1000000,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: 10,
          logIndex: 0,
          srcAddress: commonData.mockLiquidityPoolData.id,
        },
      });

      const postEventDB = await Pool.Transfer.processEvent({
        event: mockEvent,
        mockDb: updatedDB2,
      });

      // Pool should not exist
      const pool = postEventDB.entities.LiquidityPoolAggregator.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeUndefined();

      // No entities should be created
      const transferId = `10-${mockEvent.transaction.hash}-${commonData.mockLiquidityPoolData.id}-0`;
      const storedTransfer =
        postEventDB.entities.PoolTransferInTx.get(transferId);
      expect(storedTransfer).toBeUndefined();
    });
  });
});
