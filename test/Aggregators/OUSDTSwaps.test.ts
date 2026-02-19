import type { Token, handlerContext } from "generated";
import { type Mock, vi } from "vitest";
import { createOUSDTSwapEntity } from "../../src/Aggregators/OUSDTSwaps";
import { OUSDTSwapsId } from "../../src/Constants";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("OUSDTSwaps", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const chainId = 10;
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";

  let mockContext: Partial<handlerContext>;
  let mockOUSDTSwapsSet: Mock;

  beforeEach(() => {
    mockOUSDTSwapsSet = vi.fn();
    mockContext = {
      OUSDTSwaps: {
        set: mockOUSDTSwapsSet,
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createOUSDTSwapEntity", () => {
    describe("when token0 is going in (amount0In > 0)", () => {
      it("should create entity with token0 as tokenIn and token1 as tokenOut", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).toHaveBeenCalledTimes(1);
        const entity = mockOUSDTSwapsSet.mock.calls[0][0];
        expect(entity.id).toBe(
          OUSDTSwapsId(
            transactionHash,
            chainId,
            mockToken0Data.address,
            amount0In,
            mockToken1Data.address,
            amount1Out,
          ),
        );
        expect(entity.transactionHash).toBe(transactionHash);
        expect(entity.tokenInPool).toBe(mockToken0Data.address);
        expect(entity.tokenOutPool).toBe(mockToken1Data.address);
        expect(entity.amountIn).toBe(amount0In);
        expect(entity.amountOut).toBe(amount1Out);
      });
    });

    describe("when token1 is going in (amount1In > 0)", () => {
      it("should create entity with token1 as tokenIn and token0 as tokenOut", () => {
        const amount0In = 0n;
        const amount0Out = 2000n * 10n ** 18n;
        const amount1In = 1000n * 10n ** 6n;
        const amount1Out = 0n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).toHaveBeenCalledTimes(1);
        const entity = mockOUSDTSwapsSet.mock.calls[0][0];
        expect(entity.id).toBe(
          OUSDTSwapsId(
            transactionHash,
            chainId,
            mockToken1Data.address,
            amount1In,
            mockToken0Data.address,
            amount0Out,
          ),
        );
        expect(entity.transactionHash).toBe(transactionHash);
        expect(entity.tokenInPool).toBe(mockToken1Data.address);
        expect(entity.tokenOutPool).toBe(mockToken0Data.address);
        expect(entity.amountIn).toBe(amount1In);
        expect(entity.amountOut).toBe(amount0Out);
      });
    });

    describe("when both amounts are 0 (no swap)", () => {
      it("should not create an entity", () => {
        const amount0In = 0n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 0n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).not.toHaveBeenCalled();
      });
    });

    describe("when token0Instance is missing", () => {
      it("should not create an entity", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          undefined as unknown as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).not.toHaveBeenCalled();
      });
    });

    describe("when token1Instance is missing", () => {
      it("should not create an entity", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          undefined as unknown as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).not.toHaveBeenCalled();
      });
    });

    describe("when both token instances are missing", () => {
      it("should not create an entity", () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          undefined as unknown as Token,
          undefined as unknown as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).not.toHaveBeenCalled();
      });
    });

    describe("edge cases", () => {
      it("should handle very large amounts", () => {
        const amount0In = 999999999999999999999999999n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 888888888888888888888888888n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).toHaveBeenCalledTimes(1);
        const entity = mockOUSDTSwapsSet.mock.calls[0][0];
        expect(entity.id).toBe(
          OUSDTSwapsId(
            transactionHash,
            chainId,
            mockToken0Data.address,
            amount0In,
            mockToken1Data.address,
            amount1Out,
          ),
        );
        expect(entity.amountIn).toBe(amount0In);
        expect(entity.amountOut).toBe(amount1Out);
      });

      it("should handle amount0In = 1 (minimum positive value)", () => {
        const amount0In = 1n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2n;

        createOUSDTSwapEntity(
          transactionHash,
          chainId,
          mockToken0Data as Token,
          mockToken1Data as Token,
          amount0In,
          amount0Out,
          amount1In,
          amount1Out,
          mockContext as handlerContext,
        );

        expect(mockOUSDTSwapsSet).toHaveBeenCalledTimes(1);
        const entity = mockOUSDTSwapsSet.mock.calls[0][0];
        expect(entity.id).toBe(
          OUSDTSwapsId(
            transactionHash,
            chainId,
            mockToken0Data.address,
            amount0In,
            mockToken1Data.address,
            amount1Out,
          ),
        );
        expect(entity.amountIn).toBe(amount0In);
        expect(entity.amountOut).toBe(amount1Out);
      });
    });
  });
});
