import { expect } from "chai";
import { Pool } from "../../../generated/src/TestHelpers.gen";
import { MockDb } from "../../../generated/src/TestHelpers.gen";
import { setupCommon } from "./common";

describe("Pool Burn Event", () => {
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

  it("should process burn event and update liquidity pool aggregator", async () => {
    const mockEvent = Pool.Burn.createMockEvent({
      sender: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount0: 500n * 10n ** 18n,
      amount1: 1000n * 10n ** 18n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: commonData.mockLiquidityPoolData.id,
      },
    });

    const result = await Pool.Burn.processEvent({ event: mockEvent, mockDb });

    // Verify that the liquidity pool aggregator was updated
    const updatedAggregator = result.entities.LiquidityPoolAggregator.get(
      commonData.mockLiquidityPoolData.id,
    );
    expect(updatedAggregator).to.not.be.undefined;
    expect(updatedAggregator?.lastUpdatedTimestamp).to.deep.equal(
      new Date(1000000 * 1000),
    );
  });
});
