import { createTestIndexer } from "envio";
import {
  UserStatsPerPoolId,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { setupCommon } from "./common";

describe("Pool Transfer Event", () => {
  let indexer: ReturnType<typeof createTestIndexer>;
  let commonData: ReturnType<typeof setupCommon>;
  let poolAddress: string;

  beforeEach(() => {
    indexer = createTestIndexer();
    commonData = setupCommon();
    poolAddress = commonData.mockLiquidityPoolData.poolAddress;

    // Set up indexer with common data
    indexer.Pool.set(commonData.mockLiquidityPoolData);
    indexer.Token.set(commonData.mockToken0Data);
    indexer.Token.set(commonData.mockToken1Data);
  });

  it("should process mint transfer and update pool totalLPTokenSupply", async () => {
    const userAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const LP_VALUE = 500n * 10n ** 18n;
    const txHash =
      "0x1234567890123456789012345678901234567890123456789012345678901234";

    await simulateEvent(indexer, 10, {
      contract: "Pool",
      event: "Transfer",
      params: {
        from: ZERO_ADDRESS,
        to: userAddress,
        value: LP_VALUE,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: txHash,
      },
      transaction: { hash: txHash },
      srcAddress: poolAddress as `0x${string}`,
      logIndex: 0,
    });

    // Verify pool aggregator was updated with new totalLPTokenSupply
    const updatedAggregator = await indexer.Pool.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.totalLPTokenSupply).toBe(LP_VALUE);

    // Verify PoolTransferInTx entity was created for matching
    const transferId = `10-${txHash}-${poolAddress}-0`;
    const storedTransfer = await indexer.PoolTransferInTx.get(transferId);
    expect(storedTransfer).toBeDefined();
    expect(storedTransfer?.isMint).toBe(true);
    expect(storedTransfer?.isBurn).toBe(false);
    expect(storedTransfer?.to).toBe(userAddress);

    // Verify user LP balance was updated
    const userStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(10, userAddress, poolAddress),
    );
    expect(userStats).toBeDefined();
    expect(userStats?.lpBalance).toBe(LP_VALUE);
  });

  it("should process burn transfer and update pool totalLPTokenSupply", async () => {
    const userAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const LP_VALUE = 300n * 10n ** 18n;
    const INITIAL_SUPPLY = 1000n * 10n ** 18n;
    const txHash =
      "0x1234567890123456789012345678901234567890123456789012345678901234";

    // Set initial totalLPTokenSupply
    const poolWithSupply = {
      ...commonData.mockLiquidityPoolData,
      totalLPTokenSupply: INITIAL_SUPPLY,
    };
    indexer.Pool.set(poolWithSupply);

    await simulateEvent(indexer, 10, {
      contract: "Pool",
      event: "Transfer",
      params: {
        from: userAddress,
        to: ZERO_ADDRESS,
        value: LP_VALUE,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: txHash,
      },
      transaction: { hash: txHash },
      srcAddress: poolAddress as `0x${string}`,
      logIndex: 0,
    });

    // Verify pool aggregator was updated with reduced totalLPTokenSupply
    const updatedAggregator = await indexer.Pool.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.totalLPTokenSupply).toBe(
      INITIAL_SUPPLY - LP_VALUE,
    );

    // Verify PoolTransferInTx entity was created for matching
    const transferId = `10-${txHash}-${poolAddress}-0`;
    const storedTransfer = await indexer.PoolTransferInTx.get(transferId);
    expect(storedTransfer).toBeDefined();
    expect(storedTransfer?.isMint).toBe(false);
    expect(storedTransfer?.isBurn).toBe(true);
    expect(storedTransfer?.from).toBe(userAddress);

    // Verify user LP balance was updated
    const userStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(10, userAddress, poolAddress),
    );
    expect(userStats).toBeDefined();
    expect(userStats?.lpBalance).toBe(-LP_VALUE);
  });

  it("should process regular transfer and update both user balances", async () => {
    const senderAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const recipientAddress = toChecksumAddress(
      "0x2222222222222222222222222222222222222222",
    );
    const LP_VALUE = 200n * 10n ** 18n;
    const txHash =
      "0x1234567890123456789012345678901234567890123456789012345678901234";

    await simulateEvent(indexer, 10, {
      contract: "Pool",
      event: "Transfer",
      params: {
        from: senderAddress,
        to: recipientAddress,
        value: LP_VALUE,
      },
      block: {
        timestamp: 1000000,
        number: 123456,
        hash: txHash,
      },
      transaction: { hash: txHash },
      srcAddress: poolAddress as `0x${string}`,
      logIndex: 0,
    });

    // Verify pool aggregator totalLPTokenSupply was NOT changed (regular transfer)
    const updatedAggregator = await indexer.Pool.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).toBeDefined();
    expect(updatedAggregator?.totalLPTokenSupply).toBe(0n);

    // Verify PoolTransferInTx entity was NOT created (regular transfers are not stored)
    const transferId = `10-${txHash}-${poolAddress}-0`;
    const storedTransfer = await indexer.PoolTransferInTx.get(transferId);
    expect(storedTransfer).toBeUndefined();

    // Verify sender LP balance was decreased
    const senderStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(10, senderAddress, poolAddress),
    );
    expect(senderStats).toBeDefined();
    expect(senderStats?.lpBalance).toBe(-LP_VALUE);

    // Verify recipient LP balance was increased
    const recipientStats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(10, recipientAddress, poolAddress),
    );
    expect(recipientStats).toBeDefined();
    expect(recipientStats?.lpBalance).toBe(LP_VALUE);
  });

  describe("when pool does not exist", () => {
    it("should return early without processing", async () => {
      // Create a fresh indexer without the pool
      const freshIndexer = createTestIndexer();
      freshIndexer.Token.set(commonData.mockToken0Data);
      freshIndexer.Token.set(commonData.mockToken1Data);
      // Note: We intentionally don't set the Pool
      const txHash =
        "0x1234567890123456789012345678901234567890123456789012345678901234";

      await simulateEvent(freshIndexer, 10, {
        contract: "Pool",
        event: "Transfer",
        params: {
          from: toChecksumAddress("0x1111111111111111111111111111111111111111"),
          to: toChecksumAddress("0x2222222222222222222222222222222222222222"),
          value: 100n * 10n ** 18n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: txHash,
        },
        transaction: { hash: txHash },
        srcAddress: poolAddress as `0x${string}`,
        logIndex: 0,
      });

      // Pool should not exist
      const pool = await freshIndexer.Pool.get(
        commonData.mockLiquidityPoolData.id,
      );
      expect(pool).toBeUndefined();

      // No entities should be created
      const transferId = `10-${txHash}-${poolAddress}-0`;
      const storedTransfer =
        await freshIndexer.PoolTransferInTx.get(transferId);
      expect(storedTransfer).toBeUndefined();
    });
  });
});
