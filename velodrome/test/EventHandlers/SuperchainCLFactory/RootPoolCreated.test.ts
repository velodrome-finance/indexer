import { expect } from "chai";
import { MockDb, SuperchainCLFactory } from "../../../generated/src/TestHelpers.gen";

describe("SuperchainCLFactory RootPoolCreated Event", () => {
  const token0Address = "0x1111111111111111111111111111111111111111";
  const token1Address = "0x2222222222222222222222222222222222222222";
  const poolAddress = "0x3333333333333333333333333333333333333333";
  const chainId = 10;
  const mockPoolChainId = 5;
  
  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  it("should create a new RootPoolCreated entity", async () => {
    const mockEvent = SuperchainCLFactory.RootPoolCreated.createMockEvent({
      token0: token0Address,
      token1: token1Address,
      pool: poolAddress,
      chainid: BigInt(mockPoolChainId),
      tickSpacing: 10n,
      mockEventData: {
        block: {
          timestamp: 1000000,
          number: 123456,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234"
        },
        chainId,
        logIndex: 1,
      }
    });

    const result = await SuperchainCLFactory.RootPoolCreated.processEvent({ 
      event: mockEvent, 
      mockDb 
    });
    
    const createdEvent = result.entities.SuperchainCLFactory_RootPoolCreated.get(`${mockPoolChainId}_123456_1`);
    expect(createdEvent).to.not.be.undefined;
    expect(createdEvent?.token0).to.equal(token0Address);
    expect(createdEvent?.token1).to.equal(token1Address);
    expect(createdEvent?.pool).to.equal(poolAddress);
    expect(createdEvent?.poolChainId).to.equal(mockPoolChainId);
    expect(createdEvent?.tickSpacing).to.equal(10n);
    expect(createdEvent?.timestamp).to.deep.equal(new Date(1000000 * 1000));
  });
}); 