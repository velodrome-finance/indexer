import type { CLFactory_TickSpacingEnabled_event } from "generated";
import { toChecksumAddress } from "../../../src/Constants";
import { processCLFactoryTickSpacingEnabled } from "../../../src/EventHandlers/CLFactory/CLFactoryTickSpacingEnabledLogic";

describe("CLFactoryTickSpacingEnabledLogic", () => {
  // Shared constants
  const CHAIN_ID = 10;
  const TICK_SPACING = 100n;
  const FEE = 500n;
  const BLOCK_TIMESTAMP = 1000000;
  const BLOCK_NUMBER = 123456;
  const SRC_ADDRESS = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const TX_HASH =
    "0x5555555555555555555555555555555555555555555555555555555555555555";
  const BLOCK_HASH =
    "0x6666666666666666666666666666666666666666666666666666666666666666";

  const createMockEvent = (
    overrides: Partial<CLFactory_TickSpacingEnabled_event> = {},
  ): CLFactory_TickSpacingEnabled_event => ({
    params: {
      tickSpacing: TICK_SPACING,
      fee: FEE,
      ...overrides.params,
    },
    srcAddress: SRC_ADDRESS,
    transaction: {
      hash: TX_HASH,
      ...overrides.transaction,
    },
    block: {
      timestamp: BLOCK_TIMESTAMP,
      number: BLOCK_NUMBER,
      hash: BLOCK_HASH,
      ...overrides.block,
    },
    chainId: CHAIN_ID,
    logIndex: 1,
    ...overrides,
  });

  describe("processCLFactoryTickSpacingEnabled", () => {
    it("should return a diff with fee and lastUpdatedTimestamp", () => {
      const mockEvent = createMockEvent();
      const result = processCLFactoryTickSpacingEnabled(mockEvent);

      expect(result).toEqual({
        fee: FEE,
        lastUpdatedTimestamp: new Date(BLOCK_TIMESTAMP * 1000),
      });
    });

    it.each([
      {
        fee: 400n,
        timestamp: 2000000,
        description: "different fee and timestamp",
      },
      { fee: 0n, timestamp: BLOCK_TIMESTAMP, description: "zero fee" },
      { fee: 1000n, timestamp: 3000000, description: "large fee" },
    ])(
      "should convert fee and timestamp correctly for $description",
      ({ fee, timestamp }) => {
        const mockEvent = createMockEvent({
          params: { tickSpacing: TICK_SPACING, fee },
          block: { timestamp, number: BLOCK_NUMBER, hash: BLOCK_HASH },
        });

        const result = processCLFactoryTickSpacingEnabled(mockEvent);

        expect(result.fee).toBe(fee);
        expect(typeof result.fee).toBe("bigint");
        expect(result.lastUpdatedTimestamp).toEqual(new Date(timestamp * 1000));
      },
    );
  });
});
