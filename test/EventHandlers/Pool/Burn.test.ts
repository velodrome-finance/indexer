import { expect } from "chai";
import { Pool } from "../../../generated/src/TestHelpers.gen";
import { MockDb } from "../../../generated/src/TestHelpers.gen";

describe("Pool Burn Event", () => {
  let mockDb: any;
  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  it("should create a new Pool_Burn entity", async () => {
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
        srcAddress: "0x3333333333333333333333333333333333333333",
      },
    });

    const result = await Pool.Burn.processEvent({ event: mockEvent, mockDb });

    const burnEvent = result.entities.Pool_Burn.get("10_123456_1");
    expect(burnEvent).to.not.be.undefined;
    expect(burnEvent?.sender).to.equal("0x1111111111111111111111111111111111111111");
    expect(burnEvent?.to).to.equal("0x2222222222222222222222222222222222222222");
    expect(burnEvent?.amount0).to.equal(500n * 10n ** 18n);
    expect(burnEvent?.amount1).to.equal(1000n * 10n ** 18n);
    expect(burnEvent?.timestamp).to.deep.equal(new Date(1000000 * 1000));
  });
});
