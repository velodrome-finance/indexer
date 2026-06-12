import type { EvmEvent, UserStatsPerPool } from "envio";
import type { MockInstance } from "vitest";
import * as PoolModule from "../../../src/Aggregators/Pool";
import * as UserStatsPerPoolModule from "../../../src/Aggregators/UserStatsPerPool";
import {
  PoolTransferInTxId,
  TxPoolTransferRegistryId,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import type { Pool, handlerContext } from "../../../src/EntityTypes";
import {
  processPoolTransfer,
  storeTransferForMatching,
  updatePoolTotalSupply,
  updateUserLpBalances,
} from "../../../src/EventHandlers/Pool/PoolTransferLogic";
import { setupCommon } from "./common";

describe("PoolTransferLogic", () => {
  const commonData = setupCommon();
  const { mockLiquidityPoolData } = commonData;

  // Shared constants
  const CHAIN_ID = 10;
  const POOL_ADDRESS = mockLiquidityPoolData.poolAddress;
  const USER_ADDRESS = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const RECIPIENT_ADDRESS = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const TX_HASH =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const LP_VALUE = 500n * 10n ** 18n;
  const BLOCK_NUMBER = 123456;
  const TIMESTAMP = 1000000;
  const TIMESTAMP_DATE = new Date(TIMESTAMP * 1000);
  const LOG_INDEX = 1;

  // Shared mock context
  let mockContext: handlerContext;
  let mockPool: Pool;
  let updatePoolSpy: MockInstance;
  let updateUserStatsPerPoolSpy: MockInstance;
  let loadOrCreateUserDataSpy: MockInstance;

  beforeEach(() => {
    mockPool = {
      ...mockLiquidityPoolData,
      totalLPTokenSupply: 1000n * 10n ** 18n,
    };

    mockContext = {
      log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
      },
      Pool: {
        get: vi.fn(),
        set: vi.fn(),
      },
      UserStatsPerPool: {
        get: vi.fn(),
        set: vi.fn(),
      },
      UserStatsPerPoolSnapshot: { set: vi.fn() },
      PoolTransferInTx: {
        set: vi.fn(),
      },
      TxPoolTransferRegistry: {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn(),
        deleteUnsafe: vi.fn(),
      },
    } as unknown as handlerContext;

    // Set up spies with mocks
    updatePoolSpy = vi
      .spyOn(PoolModule, "updatePool")
      .mockResolvedValue(undefined);

    loadOrCreateUserDataSpy = vi
      .spyOn(UserStatsPerPoolModule, "loadOrCreateUserData")
      .mockResolvedValue({
        ...commonData.mockUserStatsPerPoolData,
      } as UserStatsPerPool);

    updateUserStatsPerPoolSpy = vi
      .spyOn(UserStatsPerPoolModule, "updateUserStatsPerPool")
      .mockImplementation(async () => {
        return commonData.mockUserStatsPerPoolData;
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to create mock Transfer event
  const createMockTransferEvent = (
    from: string,
    to: string,
    value: bigint,
    logIndex: number = LOG_INDEX,
  ): EvmEvent<"Pool", "Transfer"> =>
    ({
      chainId: CHAIN_ID,
      block: {
        number: BLOCK_NUMBER,
        timestamp: TIMESTAMP,
        hash: "0xblock",
      },
      logIndex,
      srcAddress: POOL_ADDRESS as `0x${string}`,
      transaction: { hash: TX_HASH },
      params: {
        from: from as `0x${string}`,
        to: to as `0x${string}`,
        value,
      },
    }) as unknown as EvmEvent<"Pool", "Transfer">;

  describe("updatePoolTotalSupply", () => {
    it("should increment totalLPTokenSupply for mint transfers", async () => {
      await updatePoolTotalSupply(
        true, // isMint
        false, // isBurn
        LP_VALUE,
        mockPool,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );

      expect(updatePoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalTotalLPSupply: LP_VALUE,
        }),
        mockPool,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );
    });

    it("should decrement totalLPTokenSupply for burn transfers", async () => {
      await updatePoolTotalSupply(
        false, // isMint
        true, // isBurn
        LP_VALUE,
        mockPool,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );

      expect(updatePoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalTotalLPSupply: -LP_VALUE,
        }),
        mockPool,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );
    });

    it("should not update for regular transfers", async () => {
      await updatePoolTotalSupply(
        false, // isMint
        false, // isBurn
        LP_VALUE,
        mockPool,
        TIMESTAMP_DATE,
        mockContext,
        CHAIN_ID,
        BLOCK_NUMBER,
      );

      expect(updatePoolSpy).not.toHaveBeenCalled();
    });
  });

  describe("updateUserLpBalances", () => {
    it("should add LP balance to recipient for mint", async () => {
      await updateUserLpBalances(
        true, // isMint
        false, // isBurn
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: LP_VALUE,
        }),
        expect.anything(),
        mockContext,
        TIMESTAMP_DATE,
      );
    });

    it("should subtract LP balance from sender for burn", async () => {
      await updateUserLpBalances(
        false, // isMint
        true, // isBurn
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: -LP_VALUE,
        }),
        expect.anything(),
        mockContext,
        TIMESTAMP_DATE,
      );
    });

    it("should update both sender and recipient for regular transfers", async () => {
      await updateUserLpBalances(
        false, // isMint
        false, // isBurn
        USER_ADDRESS,
        RECIPIENT_ADDRESS,
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(2);
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: -LP_VALUE,
        }),
        expect.anything(),
        mockContext,
        TIMESTAMP_DATE,
      );
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: LP_VALUE,
        }),
        expect.anything(),
        mockContext,
        TIMESTAMP_DATE,
      );
    });

    it("should handle self-transfers (from === to) by updating only once with zero balance change", async () => {
      await updateUserLpBalances(
        false, // isMint
        false, // isBurn
        USER_ADDRESS,
        USER_ADDRESS, // Same address (self-transfer)
        LP_VALUE,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      // Should only call loadOrCreateUserData once for self-transfer
      expect(loadOrCreateUserDataSpy).toHaveBeenCalledTimes(1);
      expect(loadOrCreateUserDataSpy).toHaveBeenCalledWith(
        USER_ADDRESS,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      // Should only call updateUserStatsPerPool once with zero balance change
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(1);
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incrementalLpBalance: 0n,
          lastActivityTimestamp: TIMESTAMP_DATE,
        }),
        expect.anything(),
        mockContext,
        TIMESTAMP_DATE,
      );
    });

    // Regression: issue #850. Without the gauge-address filter, depositing
    // (Transfer from USER → GAUGE) or withdrawing (GAUGE → USER) LP tokens
    // would create a phantom UserStatsPerPool row keyed on the gauge contract
    // with `lpBalance > 0` and `totalLiquidityAdded* = 0`. Per-user stake
    // accounting already happens via Gauge.Deposit/Withdraw — the gauge is
    // not a user.
    describe("gauge filtering (#850)", () => {
      const GAUGE_ADDRESS = toChecksumAddress(
        "0x4444444444444444444444444444444444444444",
      );

      it("should skip the recipient when MINT credits the gauge", async () => {
        await updateUserLpBalances(
          true, // isMint
          false, // isBurn
          ZERO_ADDRESS,
          GAUGE_ADDRESS, // mint-to-gauge edge case
          LP_VALUE,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
          GAUGE_ADDRESS,
        );

        expect(loadOrCreateUserDataSpy).not.toHaveBeenCalled();
        expect(updateUserStatsPerPoolSpy).not.toHaveBeenCalled();
      });

      it("should skip the sender when BURN debits the gauge", async () => {
        await updateUserLpBalances(
          false, // isMint
          true, // isBurn
          GAUGE_ADDRESS, // burn-from-gauge edge case
          ZERO_ADDRESS,
          LP_VALUE,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
          GAUGE_ADDRESS,
        );

        expect(loadOrCreateUserDataSpy).not.toHaveBeenCalled();
        expect(updateUserStatsPerPoolSpy).not.toHaveBeenCalled();
      });

      it("should update only the user (not the gauge) when staking: USER -> GAUGE", async () => {
        await updateUserLpBalances(
          false, // isMint
          false, // isBurn
          USER_ADDRESS,
          GAUGE_ADDRESS, // stake: user transfers LP to gauge
          LP_VALUE,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
          GAUGE_ADDRESS,
        );

        expect(loadOrCreateUserDataSpy).toHaveBeenCalledTimes(1);
        expect(loadOrCreateUserDataSpy).toHaveBeenCalledWith(
          USER_ADDRESS,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
        );
        expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(1);
        expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
          expect.objectContaining({ incrementalLpBalance: -LP_VALUE }),
          expect.anything(),
          mockContext,
          TIMESTAMP_DATE,
        );
      });

      it("should update only the user (not the gauge) when unstaking: GAUGE -> USER", async () => {
        await updateUserLpBalances(
          false, // isMint
          false, // isBurn
          GAUGE_ADDRESS, // unstake: gauge transfers LP back to user
          USER_ADDRESS,
          LP_VALUE,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
          GAUGE_ADDRESS,
        );

        expect(loadOrCreateUserDataSpy).toHaveBeenCalledTimes(1);
        expect(loadOrCreateUserDataSpy).toHaveBeenCalledWith(
          USER_ADDRESS,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
        );
        expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(1);
        expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
          expect.objectContaining({ incrementalLpBalance: LP_VALUE }),
          expect.anything(),
          mockContext,
          TIMESTAMP_DATE,
        );
      });

      it("should skip a self-transfer when both sides are the gauge", async () => {
        await updateUserLpBalances(
          false, // isMint
          false, // isBurn
          GAUGE_ADDRESS,
          GAUGE_ADDRESS,
          LP_VALUE,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
          GAUGE_ADDRESS,
        );

        expect(loadOrCreateUserDataSpy).not.toHaveBeenCalled();
        expect(updateUserStatsPerPoolSpy).not.toHaveBeenCalled();
      });

      it("should still update both sides on a regular transfer when neither side is the gauge", async () => {
        await updateUserLpBalances(
          false, // isMint
          false, // isBurn
          USER_ADDRESS,
          RECIPIENT_ADDRESS,
          LP_VALUE,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
          GAUGE_ADDRESS,
        );

        expect(loadOrCreateUserDataSpy).toHaveBeenCalledTimes(2);
        expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(2);
      });

      it("should preserve current behaviour when gaugeAddress is undefined (no gauge wired yet)", async () => {
        await updateUserLpBalances(
          false, // isMint
          false, // isBurn
          USER_ADDRESS,
          RECIPIENT_ADDRESS,
          LP_VALUE,
          POOL_ADDRESS,
          CHAIN_ID,
          mockContext,
          TIMESTAMP_DATE,
          undefined,
        );

        expect(loadOrCreateUserDataSpy).toHaveBeenCalledTimes(2);
        expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("storeTransferForMatching", () => {
    it("should store mint transfers", async () => {
      await storeTransferForMatching(
        true, // isMint
        false, // isBurn
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
        BLOCK_NUMBER,
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
        TIMESTAMP_DATE,
        mockContext,
      );

      const transferId = PoolTransferInTxId(
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
      );
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          id: transferId,
          chainId: CHAIN_ID,
          txHash: TX_HASH,
          pool: POOL_ADDRESS,
          logIndex: LOG_INDEX,
          from: ZERO_ADDRESS,
          to: USER_ADDRESS,
          value: LP_VALUE,
          isMint: true,
          isBurn: false,
        }),
      );
      expect(mockContext.TxPoolTransferRegistry.set).toHaveBeenCalledWith({
        id: TxPoolTransferRegistryId(CHAIN_ID, TX_HASH, POOL_ADDRESS),
        transferIds: [transferId],
      });
    });

    it("should store burn transfers", async () => {
      await storeTransferForMatching(
        false, // isMint
        true, // isBurn
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
        BLOCK_NUMBER,
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
        TIMESTAMP_DATE,
        mockContext,
      );

      const transferId = PoolTransferInTxId(
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
      );
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isMint: false,
          isBurn: true,
          from: USER_ADDRESS,
          to: ZERO_ADDRESS,
        }),
      );
      expect(mockContext.TxPoolTransferRegistry.set).toHaveBeenCalledWith({
        id: TxPoolTransferRegistryId(CHAIN_ID, TX_HASH, POOL_ADDRESS),
        transferIds: [transferId],
      });
    });

    it("should not store regular transfers", async () => {
      await storeTransferForMatching(
        false, // isMint
        false, // isBurn
        CHAIN_ID,
        TX_HASH,
        POOL_ADDRESS,
        LOG_INDEX,
        BLOCK_NUMBER,
        USER_ADDRESS,
        RECIPIENT_ADDRESS,
        LP_VALUE,
        TIMESTAMP_DATE,
        mockContext,
      );

      expect(mockContext.PoolTransferInTx.set).not.toHaveBeenCalled();
      expect(mockContext.TxPoolTransferRegistry.set).not.toHaveBeenCalled();
    });
  });

  describe("processPoolTransfer", () => {
    it("should process mint transfer and update totalLPTokenSupply, user balance, and store for matching", async () => {
      const event = createMockTransferEvent(
        ZERO_ADDRESS,
        USER_ADDRESS,
        LP_VALUE,
      );
      loadOrCreateUserDataSpy.mockResolvedValue({
        ...commonData.mockUserStatsPerPoolData,
        userAddress: USER_ADDRESS,
      } as UserStatsPerPool);

      await processPoolTransfer(
        event,
        mockPool,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updatePoolSpy).toHaveBeenCalled();
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalled();
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalled();
    });

    it("should process burn transfer", async () => {
      const event = createMockTransferEvent(
        USER_ADDRESS,
        ZERO_ADDRESS,
        LP_VALUE,
      );
      loadOrCreateUserDataSpy.mockResolvedValue({
        ...commonData.mockUserStatsPerPoolData,
        userAddress: USER_ADDRESS,
      } as UserStatsPerPool);

      await processPoolTransfer(
        event,
        mockPool,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updatePoolSpy).toHaveBeenCalled();
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalled();
      expect(mockContext.PoolTransferInTx.set).toHaveBeenCalled();
    });

    it("should process regular transfer without storing for matching", async () => {
      const event = createMockTransferEvent(
        USER_ADDRESS,
        RECIPIENT_ADDRESS,
        LP_VALUE,
      );

      await processPoolTransfer(
        event,
        mockPool,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(2); // Both sender and recipient
      expect(mockContext.PoolTransferInTx.set).not.toHaveBeenCalled();
    });

    // Regression: issue #850. End-to-end check that a gauge-stake Transfer
    // (USER → GAUGE) routed through processPoolTransfer threads the pool's
    // gaugeAddress into updateUserLpBalances and only credits the user.
    it("should skip the gauge side when processing a stake Transfer (USER -> GAUGE) [#850]", async () => {
      const GAUGE_ADDRESS = toChecksumAddress(
        "0x4444444444444444444444444444444444444444",
      );
      const event = createMockTransferEvent(
        USER_ADDRESS,
        GAUGE_ADDRESS,
        LP_VALUE,
      );

      await processPoolTransfer(
        event,
        { ...mockPool, gaugeAddress: GAUGE_ADDRESS },
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );

      // Pool totalLPTokenSupply is not touched on regular transfers.
      expect(updatePoolSpy).not.toHaveBeenCalled();
      // Only the user side is credited; the gauge side is skipped.
      expect(loadOrCreateUserDataSpy).toHaveBeenCalledTimes(1);
      expect(loadOrCreateUserDataSpy).toHaveBeenCalledWith(
        USER_ADDRESS,
        POOL_ADDRESS,
        CHAIN_ID,
        mockContext,
        TIMESTAMP_DATE,
      );
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledTimes(1);
      expect(updateUserStatsPerPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ incrementalLpBalance: -LP_VALUE }),
        expect.anything(),
        mockContext,
        TIMESTAMP_DATE,
      );
      expect(mockContext.PoolTransferInTx.set).not.toHaveBeenCalled();
    });
  });
});
