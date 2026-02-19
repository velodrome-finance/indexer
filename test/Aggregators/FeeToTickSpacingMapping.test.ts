import type { FeeToTickSpacingMapping, handlerContext } from "generated";
import { updateFeeToTickSpacingMapping } from "../../src/Aggregators/FeeToTickSpacingMapping";
import { FeeToTickSpacingMappingId } from "../../src/Constants";

describe("FeeToTickSpacingMapping", () => {
  // Shared constants
  const CHAIN_ID = 10;
  const TICK_SPACING = 100n;
  const INITIAL_FEE = 500n;
  const INITIAL_TIMESTAMP = 1000000;
  const MAPPING_ID = FeeToTickSpacingMappingId(CHAIN_ID, TICK_SPACING);

  let mockContext: Partial<handlerContext>;
  let currentMapping: FeeToTickSpacingMapping;

  beforeEach(() => {
    mockContext = {
      FeeToTickSpacingMapping: {
        set: vi.fn(),
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
    };

    currentMapping = {
      id: MAPPING_ID,
      chainId: CHAIN_ID,
      tickSpacing: TICK_SPACING,
      fee: INITIAL_FEE,
      lastUpdatedTimestamp: new Date(INITIAL_TIMESTAMP * 1000),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("updateFeeToTickSpacingMapping", () => {
    it("should update both fee and lastUpdatedTimestamp", async () => {
      const newFee = 400n;
      const newTimestamp = new Date(2000000 * 1000);
      const diff: Partial<FeeToTickSpacingMapping> = {
        fee: newFee,
        lastUpdatedTimestamp: newTimestamp,
      };

      await updateFeeToTickSpacingMapping(
        currentMapping,
        diff,
        mockContext as handlerContext,
      );

      const mockSet = vi.mocked(mockContext.FeeToTickSpacingMapping?.set);
      expect(mockSet).toHaveBeenCalledTimes(1);

      const updatedMapping = mockSet?.mock
        .calls[0]?.[0] as FeeToTickSpacingMapping;
      expect(updatedMapping).toEqual({
        ...currentMapping,
        fee: newFee,
        lastUpdatedTimestamp: newTimestamp,
      });
    });

    it("should handle partial updates correctly", async () => {
      const testCases = [
        {
          name: "update only fee",
          diff: { fee: 300n, lastUpdatedTimestamp: undefined },
          expectedFee: 300n,
          expectedTimestamp: currentMapping.lastUpdatedTimestamp,
        },
        {
          name: "update only timestamp",
          diff: {
            fee: undefined,
            lastUpdatedTimestamp: new Date(3000000 * 1000),
          },
          expectedFee: currentMapping.fee,
          expectedTimestamp: new Date(3000000 * 1000),
        },
        {
          name: "preserve values when both undefined",
          diff: { fee: undefined, lastUpdatedTimestamp: undefined },
          expectedFee: currentMapping.fee,
          expectedTimestamp: currentMapping.lastUpdatedTimestamp,
        },
      ];

      for (const testCase of testCases) {
        const mockSet = vi.mocked(mockContext.FeeToTickSpacingMapping?.set);
        mockSet?.mockClear();

        await updateFeeToTickSpacingMapping(
          currentMapping,
          testCase.diff,
          mockContext as handlerContext,
        );

        const updatedMapping = mockSet?.mock
          .calls[0]?.[0] as FeeToTickSpacingMapping;

        expect(updatedMapping.fee).toBe(testCase.expectedFee);
        expect(updatedMapping.lastUpdatedTimestamp).toEqual(
          testCase.expectedTimestamp,
        );
      }
    });

    it("should preserve all other fields from current mapping", async () => {
      const diff: Partial<FeeToTickSpacingMapping> = {
        fee: 600n,
        lastUpdatedTimestamp: new Date(4000000 * 1000),
      };

      await updateFeeToTickSpacingMapping(
        currentMapping,
        diff,
        mockContext as handlerContext,
      );

      const mockSet = vi.mocked(mockContext.FeeToTickSpacingMapping?.set);
      const updatedMapping = mockSet?.mock
        .calls[0]?.[0] as FeeToTickSpacingMapping;

      expect(updatedMapping.id).toBe(currentMapping.id);
      expect(updatedMapping.chainId).toBe(currentMapping.chainId);
      expect(updatedMapping.tickSpacing).toBe(currentMapping.tickSpacing);
    });

    it("should handle edge cases", async () => {
      const testCases = [
        {
          name: "zero fee",
          diff: { fee: 0n, lastUpdatedTimestamp: new Date(5000000 * 1000) },
          expectedFee: 0n,
        },
        {
          name: "large fee",
          diff: {
            fee: 10000n,
            lastUpdatedTimestamp: new Date(6000000 * 1000),
          },
          expectedFee: 10000n,
        },
      ];

      for (const testCase of testCases) {
        const mockSet = vi.mocked(mockContext.FeeToTickSpacingMapping?.set);
        mockSet?.mockClear();

        await updateFeeToTickSpacingMapping(
          currentMapping,
          testCase.diff,
          mockContext as handlerContext,
        );

        const updatedMapping = mockSet?.mock
          .calls[0]?.[0] as FeeToTickSpacingMapping;

        expect(updatedMapping.fee).toBe(testCase.expectedFee);
      }
    });
  });
});
