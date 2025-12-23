import type {
  VeNFTAggregator,
  VeNFT_Deposit_event,
  VeNFT_Transfer_event,
  VeNFT_Withdraw_event,
} from "../../../generated";
import { toChecksumAddress } from "../../../src/Constants";
import { processVeNFTEvent } from "../../../src/EventHandlers/VeNFT/VeNFTLogic";

describe("VeNFTLogic", () => {
  const mockVeNFTAggregator: VeNFTAggregator = {
    id: "10_1",
    chainId: 10,
    tokenId: 1n,
    owner: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    locktime: 100n,
    lastUpdatedTimestamp: new Date(10000 * 1000),
    totalValueLocked: 100n,
    isAlive: true,
  };

  describe("processVeNFTEvent", () => {
    describe("Deposit Event", () => {
      const mockDepositEvent: VeNFT_Deposit_event = {
        params: {
          provider: "0x2222222222222222222222222222222222222222",
          tokenId: 1n,
          value: 50n,
          locktime: 200n,
          // Field name follows the on-chain ABI / generated type
          deposit_type: 1n,
          ts: 100n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
        transaction: {
          hash: "0x1111111111111111111111111111111111111111",
        },
      } as VeNFT_Deposit_event;

      it("should process deposit event with existing VeNFT", async () => {
        // Note: Deposit events should always have an existing VeNFT
        // (created during Transfer/mint event)
        const result = await processVeNFTEvent(
          mockDepositEvent,
          mockVeNFTAggregator,
        );

        expect(result.veNFTAggregatorDiff).toEqual({
          id: "10_1",
          chainId: 10,
          tokenId: 1n,
          owner: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          locktime: 200n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
          totalValueLocked: 50n,
          isAlive: true,
        });
      });
    });

    describe("Transfer Event", () => {
      const mockTransferEvent: VeNFT_Transfer_event = {
        params: {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          tokenId: 1n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
        transaction: {
          hash: "0x1111111111111111111111111111111111111111",
        },
      } as VeNFT_Transfer_event;

      it("should process transfer event with existing VeNFT", async () => {
        const result = await processVeNFTEvent(
          mockTransferEvent,
          mockVeNFTAggregator,
        );

        expect(result.veNFTAggregatorDiff).toEqual({
          id: "10_1",
          chainId: 10,
          tokenId: 1n,
          owner: toChecksumAddress(
            "0x2222222222222222222222222222222222222222",
          ),
          locktime: 100n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
          totalValueLocked: 100n,
          isAlive: true,
        });
      });

      it("should handle transfer to zero address (burn)", async () => {
        const burnEvent = {
          ...mockTransferEvent,
          params: {
            ...mockTransferEvent.params,
            to: "0x0000000000000000000000000000000000000000",
          },
        } as VeNFT_Transfer_event;

        const result = await processVeNFTEvent(burnEvent, mockVeNFTAggregator);

        expect(result.veNFTAggregatorDiff).toEqual({
          id: "10_1",
          chainId: 10,
          tokenId: 1n,
          owner: "0x0000000000000000000000000000000000000000",
          locktime: 100n,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
          totalValueLocked: 100n,
          isAlive: false,
        });
      });
    });

    describe("Withdraw Event", () => {
      const mockWithdrawEvent: VeNFT_Withdraw_event = {
        params: {
          provider: "0x1111111111111111111111111111111111111111",
          tokenId: 1n,
          value: 25n,
          ts: 100n,
        },
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
        transaction: {
          hash: "0x1111111111111111111111111111111111111111",
        },
      } as VeNFT_Withdraw_event;

      it("should process withdraw event with existing VeNFT", async () => {
        // Withdraw event is a burn operation, so isAlive should be false
        const result = await processVeNFTEvent(
          mockWithdrawEvent,
          mockVeNFTAggregator,
        );

        expect(result.veNFTAggregatorDiff).toEqual({
          id: "10_1",
          chainId: 10,
          tokenId: 1n,
          owner: toChecksumAddress(
            "0x1111111111111111111111111111111111111111",
          ),
          lastUpdatedTimestamp: new Date(1000000 * 1000),
          totalValueLocked: -25n,
          isAlive: false,
        });
      });
    });
  });
});
