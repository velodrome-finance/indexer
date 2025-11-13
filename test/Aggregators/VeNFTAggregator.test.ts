import { expect } from "chai";
import type { VeNFTAggregator, handlerContext } from "generated";
import sinon from "sinon";
import {
  VeNFTId,
  updateVeNFTAggregator,
} from "../../src/Aggregators/VeNFTAggregator";

describe("VeNFTAggregator", () => {
  let contextStub: Partial<handlerContext>;
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
      VeNFTAggregator: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          address: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          chainId: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
        },
      },
      log: {
        error: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      },
    };
  });

  describe("updateVeNFTAggregator", () => {
    describe("when updating with deposit diff", () => {
      let result: VeNFTAggregator;
      beforeEach(async () => {
        const depositDiff = {
          id: VeNFTId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: "0x1111111111111111111111111111111111111111",
          locktime: 100n,
          totalValueLocked: 50n,
          isAlive: true,
        };

        updateVeNFTAggregator(
          depositDiff,
          mockVeNFTAggregator,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.VeNFTAggregator?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should update the veNFTAggregator with new values", () => {
        expect(result.id).to.equal(VeNFTId(10, 1n));
        expect(result.owner).to.equal(
          "0x1111111111111111111111111111111111111111",
        );
        expect(result.locktime).to.equal(100n); // diff.locktime replaces current.locktime
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
        expect(result.totalValueLocked).to.equal(150n); // 100n (current) + 50n (diff) = 150n
        expect(result.isAlive).to.equal(true);
      });
    });

    describe("when updating with withdraw diff", () => {
      let result: VeNFTAggregator;
      beforeEach(async () => {
        const withdrawDiff = {
          id: VeNFTId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: "0x1111111111111111111111111111111111111111",
          locktime: 100n,
          totalValueLocked: -25n,
          isAlive: true,
        };

        updateVeNFTAggregator(
          withdrawDiff,
          mockVeNFTAggregator,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.VeNFTAggregator?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should update the veNFTAggregator with withdrawn amount", () => {
        expect(result.id).to.equal(VeNFTId(10, 1n));
        expect(result.owner).to.equal(
          "0x1111111111111111111111111111111111111111",
        );
        expect(result.locktime).to.equal(100n); // current.locktime (no diff override)
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
        expect(result.totalValueLocked).to.equal(75n); // 100n (current) + -25n (diff) = 75n
        expect(result.isAlive).to.equal(true);
      });
    });

    describe("when updating with transfer diff", () => {
      let result: VeNFTAggregator;
      beforeEach(async () => {
        const transferDiff = {
          id: VeNFTId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: "0x2222222222222222222222222222222222222222",
          locktime: 100n,
          totalValueLocked: 100n,
          isAlive: true,
        };

        updateVeNFTAggregator(
          transferDiff,
          mockVeNFTAggregator,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.VeNFTAggregator?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should update the veNFTAggregator with new owner", () => {
        expect(result.id).to.equal(VeNFTId(10, 1n));
        expect(result.owner).to.equal(
          "0x2222222222222222222222222222222222222222",
        );
        expect(result.locktime).to.equal(100n); // current.locktime (no diff override)
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
        expect(result.totalValueLocked).to.equal(200n); // 100n (current) + 100n (diff) = 200n
        expect(result.isAlive).to.equal(true);
      });
    });

    describe("when updating with burn diff (zero address)", () => {
      let result: VeNFTAggregator;
      beforeEach(async () => {
        const burnDiff = {
          id: VeNFTId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: "0x0000000000000000000000000000000000000000",
          locktime: 100n,
          totalValueLocked: 100n,
          isAlive: false,
        };

        updateVeNFTAggregator(
          burnDiff,
          mockVeNFTAggregator,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.VeNFTAggregator?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should set the veNFTAggregator to dead", () => {
        expect(result.id).to.equal(VeNFTId(10, 1n));
        expect(result.owner).to.equal(
          "0x0000000000000000000000000000000000000000",
        );
        expect(result.locktime).to.equal(100n); // current.locktime (no diff override)
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
        expect(result.totalValueLocked).to.equal(200n); // 100n (current) + 100n (diff) = 200n
        expect(result.isAlive).to.equal(false);
      });
    });

    describe("when creating new VeNFT (no current)", () => {
      let result: VeNFTAggregator;
      beforeEach(async () => {
        const newVeNFTDiff = {
          id: VeNFTId(10, 2n),
          chainId: 10,
          tokenId: 2n,
          owner: "0x3333333333333333333333333333333333333333",
          locktime: 200n,
          totalValueLocked: 75n,
          isAlive: true,
        };

        // Create a dummy empty VeNFTAggregator to add to
        const emptyVeNFT: VeNFTAggregator = {
          id: VeNFTId(10, 2n),
          chainId: 10,
          tokenId: 2n,
          owner: "",
          locktime: 0n,
          lastUpdatedTimestamp: new Date(0),
          totalValueLocked: 0n,
          isAlive: true,
        };

        updateVeNFTAggregator(
          newVeNFTDiff,
          emptyVeNFT,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.VeNFTAggregator?.set as sinon.SinonStub).firstCall
          .args[0];
      });

      it("should create a new veNFTAggregator", () => {
        expect(result.id).to.equal(VeNFTId(10, 2n));
        expect(result.owner).to.equal(
          "0x3333333333333333333333333333333333333333",
        );
        expect(result.locktime).to.equal(200n);
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
        expect(result.totalValueLocked).to.equal(75n);
        expect(result.isAlive).to.equal(true);
      });
    });
  });
});
