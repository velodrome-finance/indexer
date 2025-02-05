import { expect } from "chai";
import { MockDb, SuperchainPoolFactory } from "../../../generated/src/TestHelpers.gen";

describe("SuperchainPoolFactory RootPoolCreated Event", () => {
  const token0Address = "0x1111111111111111111111111111111111111111";
  const token1Address = "0x2222222222222222222222222222222222222222";
  const poolAddress = "0xb01234713d278d0ae3039d5930102956861d144b"; // Using real pool address.
  const chainId = 10;
  const mockPoolChainId = 252;
  
  let mockDb: ReturnType<typeof MockDb.createMockDb>;

  beforeEach(() => {
    mockDb = MockDb.createMockDb();
  });

  xit("should create a new RootPoolCreated entity with chain ID from Web3 call", async () => {
    const mockEvent = SuperchainPoolFactory.RootPoolCreated.createMockEvent({
      token0: token0Address,
      token1: token1Address,
      pool: poolAddress,
      stable: false,
      length: 2n,
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

    const result = await SuperchainPoolFactory.RootPoolCreated.processEvent({ 
      event: mockEvent, 
      mockDb 
    });
    
    const createdEvent = result.entities.SuperchainPoolFactory_RootPoolCreated.get(`${chainId}_123456_1`);
    expect(createdEvent).to.not.be.undefined;
    expect(createdEvent?.token0).to.equal(token0Address);
    expect(createdEvent?.token1).to.equal(token1Address);
    expect(createdEvent?.pool).to.equal(poolAddress);
    expect(createdEvent?.stable).to.be.false;
    expect(createdEvent?.poolChainId).to.equal(mockPoolChainId);
    expect(createdEvent?.length).to.equal(2n);
    expect(createdEvent?.timestamp).to.deep.equal(new Date(1000000 * 1000));
  });
}); 