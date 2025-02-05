import { expect } from "chai";
import { MockDb, VeNFT } from "../../generated/src/TestHelpers.gen";
import * as VeNFTAggregator from "../../src/Aggregators/VeNFTAggregator";
import sinon from "sinon";

const VeNFTId = (chainId: number, tokenId: bigint) => `${chainId}_${tokenId}`;

describe("VeNFT Events", () => {
  let mockDb: any;
  const chainId = 10;
  const tokenId = 1n;

  const mockVeNFTAggregator = {
    id: VeNFTId(chainId, tokenId),
    chainId: 10,
    tokenId: tokenId,
  };

  beforeEach(() => {
      mockDb = MockDb.createMockDb();
      mockDb = mockDb.entities.VeNFTAggregator.set(mockVeNFTAggregator);
  });

  describe("Transfer Event", () => {
    const eventData = {
        provider: "0x1111111111111111111111111111111111111111",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        tokenId: 1n,
        timestamp: 1n,
        chainId: 10,
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
    };

    let stubVeNFTAggregator: sinon.SinonStub;
    let postEventDB: any;
    let expected: any = {};
    let mockEvent: any;

    beforeEach(async () => {
        stubVeNFTAggregator = sinon.stub(VeNFTAggregator, "transferVeNFT");
        mockEvent = VeNFT.Transfer.createMockEvent(eventData);
        postEventDB = await VeNFT.Transfer.processEvent({
            event: mockEvent,
            mockDb: mockDb,
        });

        expected.id = `${chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
        expected.chainId = chainId;
        expected.tokenId = eventData.tokenId;
        expected.from = eventData.from;
        expected.to = eventData.to;
        expected.blockNumber = mockEvent.block.number;
        expected.logIndex = mockEvent.logIndex;
        expected.timestamp = new Date(mockEvent.block.timestamp * 1000);
    });
    afterEach(() => {
        stubVeNFTAggregator.restore();
    });
    it("should create a new Transfer entity", async () => {
        const transferEvent = postEventDB.entities.VeNFT_Transfer.get(expected.id);
        expect(transferEvent).not.to.be.undefined;
        expect(transferEvent).to.deep.equal(expected);
    });
    it("should call transferVeNFT with the correct arguments", async () => {
        expect(stubVeNFTAggregator.calledOnce).to.be.true;
        const calledWith = stubVeNFTAggregator.firstCall.args;
        expect(calledWith[0].id).to.equal(expected.id);
        expect(calledWith[1].id).to.deep.equal(mockVeNFTAggregator.id);
        expect(calledWith[2]).to.deep.equal(new Date(mockEvent.block.timestamp * 1000));
    });
  });
  describe("Withdraw Event", () => {
    const eventData = {
        provider: "0x1111111111111111111111111111111111111111",
        tokenId: 1n,
        value: 1n,
        ts: 1n,
        chainId: 10,
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
    };

    let stubVeNFTAggregator: sinon.SinonStub;
    let postEventDB: any;
    let expected: any = {};
    let mockEvent: any;

    beforeEach(async () => {
        stubVeNFTAggregator = sinon.stub(VeNFTAggregator, "withdrawVeNFT");
        mockEvent = VeNFT.Withdraw.createMockEvent(eventData);
        postEventDB = await VeNFT.Withdraw.processEvent({
            event: mockEvent,
            mockDb: mockDb,
        });

        expected.id = `${chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
        expected.chainId = chainId;
        expected.provider = eventData.provider;
        expected.tokenId = eventData.tokenId;
        expected.value = eventData.value;
        expected.ts = eventData.ts;
        expected.timestamp = new Date(mockEvent.block.timestamp * 1000);
        expected.blockNumber = mockEvent.block.number;
        expected.logIndex = mockEvent.logIndex;
    });
    afterEach(() => {
        stubVeNFTAggregator.restore();
    });
    it("should create a new Withdraw entity", async () => {
        const withdrawEvent = postEventDB.entities.VeNFT_Withdraw.get(expected.id);
        expect(withdrawEvent).not.to.be.undefined;
        expect(withdrawEvent).to.deep.equal(expected);
    });
    it("should call withdrawVeNFT with the correct arguments", async () => {
        // Passing along the created entities to the aggregator handler here, so
        // not doing a full deep equal.
        expect(stubVeNFTAggregator.calledOnce).to.be.true;
        const calledWith = stubVeNFTAggregator.firstCall.args;
        expect(calledWith[0].id).to.equal(expected.id);
        expect(calledWith[1].id).to.deep.equal(mockVeNFTAggregator.id);
        expect(calledWith[2]).to.deep.equal(new Date(mockEvent.block.timestamp * 1000));
    });
  });

  describe("Deposit Event", () => {
    const eventData = {
        provider: "0x1111111111111111111111111111111111111111",
        tokenId: 1n,
        value: 1n,
        locktime: 1n,
        depositType: 1n,
        ts: 1n,
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
    };

    let stubVeNFTAggregator: sinon.SinonStub;
    let postEventDB: any;
    let expected: any = {};
    let mockEvent: any;

    beforeEach(async () => {
        stubVeNFTAggregator = sinon.stub(VeNFTAggregator, "depositVeNFT");
        mockEvent = VeNFT.Deposit.createMockEvent(eventData);
        postEventDB = await VeNFT.Deposit.processEvent({
            event: mockEvent,
            mockDb: mockDb,
        });

        expected.id = `${chainId}_${mockEvent.block.number}_${mockEvent.logIndex}`;
        expected.chainId = chainId;
        expected.provider = eventData.provider;
        expected.tokenId = eventData.tokenId;
        expected.value = eventData.value;
        expected.locktime = eventData.locktime;
        expected.depositType = eventData.depositType;
        expected.ts = eventData.ts;
        expected.timestamp = new Date(mockEvent.block.timestamp * 1000);
        expected.blockNumber = mockEvent.block.number;
        expected.logIndex = mockEvent.logIndex;
    });
    afterEach(() => {
        stubVeNFTAggregator.restore();
    });
    it("should create a new Deposit entity", async () => {
        const depositEvent = postEventDB.entities.VeNFT_Deposit.get(expected.id);
        expect(depositEvent).not.to.be.undefined;
        expect(depositEvent).to.deep.equal(expected);
    });
    it("should call depositVeNFT with the correct arguments", async () => {
        expect(stubVeNFTAggregator.calledOnce).to.be.true;
        const calledWith = stubVeNFTAggregator.firstCall.args;
        expect(calledWith[0].id).to.equal(expected.id);
        expect(calledWith[1].id).to.deep.equal(mockVeNFTAggregator.id);
        expect(calledWith[2]).to.deep.equal(new Date(mockEvent.block.timestamp * 1000));
    });
  });
});
