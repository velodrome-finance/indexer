import { expect } from "chai";
import type { NonFungiblePosition, handlerContext } from "generated";
import sinon from "sinon";
import {
  NonFungiblePositionId,
  updateNonFungiblePosition,
} from "../../src/Aggregators/NonFungiblePosition";

describe("NonFungiblePosition", () => {
  let contextStub: Partial<handlerContext>;
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";
  const mockNonFungiblePosition: NonFungiblePosition = {
    id: "10_1",
    chainId: 10,
    tokenId: 1n,
    owner: "0x1111111111111111111111111111111111111111",
    pool: "0xPoolAddress0000000000000000000000",
    tickUpper: 100n,
    tickLower: -100n,
    token0: "0xToken0Address0000000000000000000000",
    token1: "0xToken1Address0000000000000000000000",
    amount0: 1000000000000000000n,
    amount1: 2000000000000000000n,
    amountUSD: 3000000000000000000n,
    transactionHash: transactionHash,
    lastUpdatedTimestamp: new Date(10000 * 1000),
  };
  const timestamp = new Date(10001 * 1000);

  beforeEach(() => {
    contextStub = {
      NonFungiblePosition: {
        set: sinon.stub(),
        get: sinon.stub(),
        getOrThrow: sinon.stub(),
        getOrCreate: sinon.stub(),
        deleteUnsafe: sinon.stub(),
        getWhere: {
          owner: {
            eq: sinon.stub(),
            gt: sinon.stub(),
            lt: sinon.stub(),
          },
          transactionHash: {
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

  describe("updateNonFungiblePosition", () => {
    describe("when updating with transfer diff (owner change)", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const transferDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          owner: "0x2222222222222222222222222222222222222222",
        };

        updateNonFungiblePosition(
          transferDiff,
          mockNonFungiblePosition,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.NonFungiblePosition?.set as sinon.SinonStub)
          .firstCall.args[0];
      });

      it("should update the nonFungiblePosition with new owner", () => {
        expect(result.id).to.equal(NonFungiblePositionId(10, 1n));
        expect(result.owner).to.equal(
          "0x2222222222222222222222222222222222222222",
        );
        expect(result.tickUpper).to.equal(100n); // unchanged
        expect(result.tickLower).to.equal(-100n); // unchanged
        expect(result.amount0).to.equal(1000000000000000000n); // unchanged
        expect(result.amount1).to.equal(2000000000000000000n); // unchanged
        expect(result.amountUSD).to.equal(3000000000000000000n); // unchanged
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
      });
    });

    describe("when updating with increase liquidity diff", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const increaseDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          amount0: 500000000000000000n,
          amount1: 1000000000000000000n,
        };

        updateNonFungiblePosition(
          increaseDiff,
          mockNonFungiblePosition,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.NonFungiblePosition?.set as sinon.SinonStub)
          .firstCall.args[0];
      });

      it("should add to amount0 and amount1", () => {
        expect(result.amount0).to.equal(1500000000000000000n); // 1000n + 500n = 1500n
        expect(result.amount1).to.equal(3000000000000000000n); // 2000n + 1000n = 3000n
        expect(result.owner).to.equal(
          "0x1111111111111111111111111111111111111111",
        ); // unchanged
        expect(result.tickUpper).to.equal(100n); // unchanged
        expect(result.tickLower).to.equal(-100n); // unchanged
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
      });
    });

    describe("when updating with decrease liquidity diff", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const decreaseDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          amount0: -500000000000000000n,
          amount1: -1000000000000000000n,
        };

        updateNonFungiblePosition(
          decreaseDiff,
          mockNonFungiblePosition,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.NonFungiblePosition?.set as sinon.SinonStub)
          .firstCall.args[0];
      });

      it("should subtract from amount0 and amount1", () => {
        expect(result.amount0).to.equal(500000000000000000n); // 1000n - 500n = 500n
        expect(result.amount1).to.equal(1000000000000000000n); // 2000n - 1000n = 1000n
        expect(result.owner).to.equal(
          "0x1111111111111111111111111111111111111111",
        ); // unchanged
        expect(result.tickUpper).to.equal(100n); // unchanged
        expect(result.tickLower).to.equal(-100n); // unchanged
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
      });
    });

    describe("when updating with partial diff (only amount0)", () => {
      let result: NonFungiblePosition;
      beforeEach(async () => {
        const partialDiff = {
          id: NonFungiblePositionId(10, 1n),
          chainId: 10,
          tokenId: 1n,
          amount0: 500000000000000000n,
        };

        updateNonFungiblePosition(
          partialDiff,
          mockNonFungiblePosition,
          timestamp,
          contextStub as handlerContext,
        );
        result = (contextStub.NonFungiblePosition?.set as sinon.SinonStub)
          .firstCall.args[0];
      });

      it("should update only amount0, leave amount1 unchanged", () => {
        expect(result.amount0).to.equal(1500000000000000000n); // 1000n + 500n = 1500n
        expect(result.amount1).to.equal(2000000000000000000n); // unchanged
        expect(result.owner).to.equal(
          "0x1111111111111111111111111111111111111111",
        ); // unchanged
        expect(result.lastUpdatedTimestamp).to.equal(timestamp);
      });
    });
  });
});
