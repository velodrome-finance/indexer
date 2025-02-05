import { expect } from "chai";
import { Pool, MockDb } from "../../../generated/src/TestHelpers.gen";
import { setupCommon } from "./common";

describe("Pool Mint Event", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  it("should create a new Pool_Mint entity", async () => {
    const mockEvent = Pool.Mint.createMockEvent({
      sender: "0x1111111111111111111111111111111111111111",
      amount0: 1000n * 10n ** 18n,
      amount1: 2000n * 10n ** 18n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        logIndex: 1,
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    });

    const result = await Pool.Mint.processEvent({ event: mockEvent, mockDb });

    const mintEvent = result.entities.Pool_Mint.get("10_123456_1");
    expect(mintEvent).to.not.be.undefined;
    expect(mintEvent?.sender).to.equal("0x1111111111111111111111111111111111111111");
    expect(mintEvent?.amount0).to.equal(1000n * 10n ** 18n);
    expect(mintEvent?.amount1).to.equal(2000n * 10n ** 18n);
    expect(mintEvent?.timestamp).to.deep.equal(new Date(1000000 * 1000));
  });
});
