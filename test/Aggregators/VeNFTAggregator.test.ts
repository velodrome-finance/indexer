import type { VeNFTAggregator, handlerContext } from "generated";
import {
  VeNFTId,
  updateVeNFTAggregator,
} from "../../src/Aggregators/VeNFTAggregator";

describe("VeNFTAggregator", () => {
  let mockContext: Partial<handlerContext>;
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
    mockContext = {
      VeNFTAggregator: {
        set: jest.fn(),
        get: jest.fn(),
        getOrThrow: jest.fn(),
        getOrCreate: jest.fn(),
        deleteUnsafe: jest.fn(),
        getWhere: {
          tokenId: {
            eq: jest.fn(),
            gt: jest.fn(),
            lt: jest.fn(),
          },
        },
      },
      log: {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.VeNFTAggregator?.set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTAggregator;
      });

      it("should update the veNFTAggregator with new values", () => {
        expect(result.id).toBe(VeNFTId(10, 1n));
        expect(result.owner).toBe("0x1111111111111111111111111111111111111111");
        expect(result.locktime).toBe(100n); // diff.locktime replaces current.locktime
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(result.totalValueLocked).toBe(150n); // 100n (current) + 50n (diff) = 150n
        expect(result.isAlive).toBe(true);
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
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.VeNFTAggregator?.set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTAggregator;
      });

      it("should update the veNFTAggregator with withdrawn amount", () => {
        expect(result.id).toBe(VeNFTId(10, 1n));
        expect(result.owner).toBe("0x1111111111111111111111111111111111111111");
        expect(result.locktime).toBe(100n); // current.locktime (no diff override)
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(result.totalValueLocked).toBe(75n); // 100n (current) + -25n (diff) = 75n
        expect(result.isAlive).toBe(true);
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
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.VeNFTAggregator?.set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTAggregator;
      });

      it("should update the veNFTAggregator with new owner", () => {
        expect(result.id).toBe(VeNFTId(10, 1n));
        expect(result.owner).toBe("0x2222222222222222222222222222222222222222");
        expect(result.locktime).toBe(100n); // current.locktime (no diff override)
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(result.totalValueLocked).toBe(200n); // 100n (current) + 100n (diff) = 200n
        expect(result.isAlive).toBe(true);
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
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.VeNFTAggregator?.set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTAggregator;
      });

      it("should set the veNFTAggregator to dead", () => {
        expect(result.id).toBe(VeNFTId(10, 1n));
        expect(result.owner).toBe("0x0000000000000000000000000000000000000000");
        expect(result.locktime).toBe(100n); // current.locktime (no diff override)
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(result.totalValueLocked).toBe(200n); // 100n (current) + 100n (diff) = 200n
        expect(result.isAlive).toBe(false);
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
          mockContext as handlerContext,
        );
        const mockSet = jest.mocked(mockContext.VeNFTAggregator?.set);
        expect(mockSet).toBeDefined();
        result = mockSet?.mock.calls[0]?.[0] as VeNFTAggregator;
      });

      it("should create a new veNFTAggregator", () => {
        expect(result.id).toBe(VeNFTId(10, 2n));
        expect(result.owner).toBe("0x3333333333333333333333333333333333333333");
        expect(result.locktime).toBe(200n);
        expect(result.lastUpdatedTimestamp).toBe(timestamp);
        expect(result.totalValueLocked).toBe(75n);
        expect(result.isAlive).toBe(true);
      });
    });
  });
});
