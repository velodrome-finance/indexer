import { expect } from "chai";
import { VeNFT_Deposit, VeNFT_Transfer, VeNFT_Withdraw, VeNFTAggregator } from "generated";
import { depositVeNFT, withdrawVeNFT, transferVeNFT, VeNFTId } from "../../src/Aggregators/VeNFTAggregator";
import sinon from "sinon";

describe("VeNFTAggregator", () => {

    let contextStub: any;
    const mockVeNFTAggregator: VeNFTAggregator = {
        id: "10_1",
        chainId: 10,
        tokenId: 1n,
        owner: "0x1111111111111111111111111111111111111111",
        locktime: 100n,
        lastUpdatedTimestamp: new Date(10000 * 1000),
        totalValueLocked: 100n,
        isAlive: true,
    };
    const timestamp = new Date(10001 * 1000);

    beforeEach(() => {
        contextStub = {
            VeNFTAggregator: { set: sinon.stub() },
        };
    });
    describe("depositVeNFT", () => {
        const mockDeposit: VeNFT_Deposit = {
            id: "10_1_1",
            provider: "0x1111111111111111111111111111111111111111",
            value: 100n,
            locktime: 100n,
            ts: 100n,
            timestamp: new Date(),
            chainId: 10,
            tokenId: 1n,
            blockNumber: 100,
            logIndex: 1,
            depositType: 1n,
        };
        describe("when the veNFT is not found", () => {
            let result: any;
            beforeEach(async() => {
                depositVeNFT(mockDeposit, undefined, timestamp, contextStub);
                result = contextStub.VeNFTAggregator.set.firstCall.args[0];
            });
            it("should create a new veNFTAggregator", () => {
                expect(result.id).to.equal(VeNFTId(mockDeposit.chainId, mockDeposit.tokenId));
                expect(result.owner).to.equal("");
                expect(result.locktime).to.equal(mockDeposit.locktime);
                expect(result.lastUpdatedTimestamp).to.equal(timestamp);
                expect(result.totalValueLocked).to.equal(mockDeposit.value);
                expect(result.isAlive).to.equal(true);
            });
        });
        describe("when the veNFT is found", () => {
            let result: any;
            beforeEach(async() => {
                depositVeNFT(mockDeposit, mockVeNFTAggregator, timestamp, contextStub);
                result = contextStub.VeNFTAggregator.set.firstCall.args[0];
            });
            it("should update the veNFTAggregator", () => {
                expect(result.id).to.equal(VeNFTId(mockDeposit.chainId, mockDeposit.tokenId));
                expect(result.owner).to.equal(mockVeNFTAggregator.owner);
                expect(result.locktime).to.equal(mockDeposit.locktime);
                expect(result.lastUpdatedTimestamp).to.equal(timestamp);
                expect(result.totalValueLocked).to.equal(mockVeNFTAggregator.totalValueLocked + mockDeposit.value);
                expect(result.isAlive).to.equal(true);
            });
        });
    });
    describe("withdrawVeNFT", () => {
        const mockWithdraw: VeNFT_Withdraw = {
            id: "10_1_1",
            provider: "0x1111111111111111111111111111111111111111",
            value: 100n,
            ts: 100n,
            timestamp: new Date(),
            blockNumber: 100,
            logIndex: 1,
            chainId: 10,
            tokenId: 1n,
        };
        describe("when the veNFT is not found", () => {
            let result: any;
            beforeEach(async() => {
                withdrawVeNFT(mockWithdraw, undefined, timestamp, contextStub);
                result = contextStub.VeNFTAggregator.set.firstCall.args[0];
            });
            it("should create a new veNFTAggregator", () => {
                expect(result.id).to.equal(VeNFTId(mockWithdraw.chainId, mockWithdraw.tokenId));
                expect(result.owner).to.equal("");
                expect(result.locktime).to.equal(0n);
                expect(result.lastUpdatedTimestamp).to.equal(timestamp);
                expect(result.totalValueLocked).to.equal(0n);
                expect(result.isAlive).to.equal(true);
            });
        });
        describe("when the veNFT is found", () => {
            let result: any;
            beforeEach(async() => {
                withdrawVeNFT(mockWithdraw, mockVeNFTAggregator, timestamp, contextStub);
                result = contextStub.VeNFTAggregator.set.firstCall.args[0];
            });
            it("should update the veNFTAggregator", () => {
                expect(result.id).to.equal(VeNFTId(mockWithdraw.chainId, mockWithdraw.tokenId));
                expect(result.owner).to.equal(mockVeNFTAggregator.owner);
                expect(result.locktime).to.equal(mockVeNFTAggregator.locktime);
                expect(result.lastUpdatedTimestamp).to.equal(timestamp);
                expect(result.totalValueLocked).to.equal(mockVeNFTAggregator.totalValueLocked - mockWithdraw.value);
                expect(result.isAlive).to.equal(true);
            });
        });
    });
    describe("transferVeNFT", () => {
        const mockTransfer: VeNFT_Transfer = {
            id: "10_1_1",
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
            tokenId: 1n,
            timestamp: new Date(),
            chainId: 10,
            blockNumber: 100,
            logIndex: 1,
        };
        describe("when the veNFT is not found", () => {
            let result: any;
            beforeEach(async() => {
                transferVeNFT(mockTransfer, undefined, timestamp, contextStub);
                result = contextStub.VeNFTAggregator.set.firstCall.args[0];
            });
            it("should create a new veNFTAggregator", () => {
                expect(result.id).to.equal(VeNFTId(mockTransfer.chainId, mockTransfer.tokenId));
                expect(result.owner).to.equal(mockTransfer.to);
                expect(result.locktime).to.equal(0n);
                expect(result.lastUpdatedTimestamp).to.equal(timestamp);
                expect(result.totalValueLocked).to.equal(0n);
                expect(result.isAlive).to.equal(true);
            });
        });
        describe("when the veNFT is found", () => {

            describe("when the transfer is to the zero address", () => {
                let result: any;
                beforeEach(async() => {
                    const zeroTransfer = {
                        ...mockTransfer,
                        to: "0x0000000000000000000000000000000000000000",
                    };
                    transferVeNFT(zeroTransfer, mockVeNFTAggregator, timestamp, contextStub);
                    result = contextStub.VeNFTAggregator.set.firstCall.args[0];
                });
                it("should set the veNFTAggregator to dead", () => {
                    expect(result.isAlive).to.equal(false);
                });
            });
            describe("when the transfer is not the zero address", () => {
                let result: any;
                beforeEach(async() => {
                    transferVeNFT(mockTransfer, mockVeNFTAggregator, timestamp, contextStub);
                    result = contextStub.VeNFTAggregator.set.firstCall.args[0];
                });
                it("should update the veNFTAggregator", () => {
                    expect(result.id).to.equal(VeNFTId(mockTransfer.chainId, mockTransfer.tokenId));
                    expect(result.owner).to.equal(mockTransfer.to);
                    expect(result.locktime).to.equal(mockVeNFTAggregator.locktime);
                    expect(result.lastUpdatedTimestamp).to.equal(timestamp);
                    expect(result.totalValueLocked).to.equal(mockVeNFTAggregator.totalValueLocked);
                    expect(result.isAlive).to.equal(true);
                });
            });
        });
    });
});