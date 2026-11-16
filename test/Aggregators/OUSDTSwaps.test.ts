import type { Token } from "envio";
import { type Mock, vi } from "vitest";
import {
  createOUSDTSwapEntity,
  loadFirstOUSDTSwapInTx,
} from "../../src/Aggregators/OUSDTSwaps";
import { OUSDTSwapsId } from "../../src/Constants";
import type { handlerContext } from "../../src/EntityTypes";
import { setupCommon } from "../EventHandlers/Pool/common";

describe("OUSDTSwaps", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  const chainId = 10;
  const transactionHash =
    "0x1234567890123456789012345678901234567890123456789012345678901234";

  let mockContext: Partial<handlerContext>;
  let mockOUSDTSwapsSet: Mock;
  let mockRegistryGet: Mock;
  let mockRegistrySet: Mock;

  beforeEach(() => {
    mockOUSDTSwapsSet = vi.fn();
    mockRegistryGet = vi.fn().mockResolvedValue(undefined);
    mockRegistrySet = vi.fn();
    mockContext = {
      OUSDTSwaps: {
        set: mockOUSDTSwapsSet,
        get: vi.fn(),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      TxOUSDTSwapRegistry: {
        set: mockRegistrySet,
        get: mockRegistryGet,
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
      // no Hyperlane message processed in these transactions: no SuperSwap destination leg
      TxProcessIdRegistry: {
        set: vi.fn(),
        get: vi.fn().mockResolvedValue(undefined),
        getOrThrow: vi.fn(),
        getOrCreate: vi.fn(),
        deleteUnsafe: vi.fn(),
        getWhere: vi.fn().mockResolvedValue([]),
      },
    };
  });

  describe("TxOUSDTSwapRegistry (first oUSDT swap per tx)", () => {
    it("records the swap when it is the first in its tx", async () => {
      await createOUSDTSwapEntity(
        transactionHash,
        chainId,
        mockToken0Data as Token,
        mockToken1Data as Token,
        5n,
        0n,
        0n,
        7n,
        mockContext as handlerContext,
      );

      expect(mockRegistryGet).toHaveBeenCalledWith(transactionHash);
      expect(mockRegistrySet).toHaveBeenCalledWith({
        id: transactionHash,
        swapId: OUSDTSwapsId(
          transactionHash,
          chainId,
          mockToken0Data.address,
          5n,
          mockToken1Data.address,
          7n,
        ),
        tokenInPool: mockToken0Data.address,
        tokenOutPool: mockToken1Data.address,
        amountIn: 5n,
        amountOut: 7n,
      });
    });

    it("keeps the first swap when the tx already has one", async () => {
      mockRegistryGet.mockResolvedValue({ id: transactionHash });

      await createOUSDTSwapEntity(
        transactionHash,
        chainId,
        mockToken0Data as Token,
        mockToken1Data as Token,
        0n,
        3n,
        4n,
        0n,
        mockContext as handlerContext,
      );

      expect(mockOUSDTSwapsSet).toHaveBeenCalledTimes(1);
      expect(mockRegistrySet).not.toHaveBeenCalled();
    });

    it("is not touched when no swap occurred", async () => {
      await createOUSDTSwapEntity(
        transactionHash,
        chainId,
        mockToken0Data as Token,
        mockToken1Data as Token,
        0n,
        0n,
        0n,
        0n,
        mockContext as handlerContext,
      );

      expect(mockRegistryGet).not.toHaveBeenCalled();
      expect(mockRegistrySet).not.toHaveBeenCalled();
    });

    it("loadFirstOUSDTSwapInTx returns [] or the recorded swap", async () => {
      expect(
        await loadFirstOUSDTSwapInTx(
          transactionHash,
          mockContext as handlerContext,
        ),
      ).toEqual([]);

      mockRegistryGet.mockResolvedValue({
        id: transactionHash,
        swapId: "swap-1",
        tokenInPool: mockToken0Data.address,
        tokenOutPool: mockToken1Data.address,
        amountIn: 5n,
        amountOut: 7n,
      });
      expect(
        await loadFirstOUSDTSwapInTx(
          transactionHash,
          mockContext as handlerContext,
        ),
      ).toEqual([
        {
          id: "swap-1",
          transactionHash,
          tokenInPool: mockToken0Data.address,
          tokenOutPool: mockToken1Data.address,
          amountIn: 5n,
          amountOut: 7n,
        },
      ]);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createOUSDTSwapEntity", () => {
    describe("when token0 is going in (amount0In > 0)", () => {
      it("should create entity with token0 as tokenIn and token1 as tokenOut", async () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        await createOUSDTSwapEntity(
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
      it("should create entity with token1 as tokenIn and token0 as tokenOut", async () => {
        const amount0In = 0n;
        const amount0Out = 2000n * 10n ** 18n;
        const amount1In = 1000n * 10n ** 6n;
        const amount1Out = 0n;

        await createOUSDTSwapEntity(
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
      it("should not create an entity", async () => {
        const amount0In = 0n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 0n;

        await createOUSDTSwapEntity(
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
      it("should not create an entity", async () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        await createOUSDTSwapEntity(
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
      it("should not create an entity", async () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        await createOUSDTSwapEntity(
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
      it("should not create an entity", async () => {
        const amount0In = 1000n * 10n ** 18n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2000n * 10n ** 6n;

        await createOUSDTSwapEntity(
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
      it("should handle very large amounts", async () => {
        const amount0In = 999999999999999999999999999n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 888888888888888888888888888n;

        await createOUSDTSwapEntity(
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

      it("should handle amount0In = 1 (minimum positive value)", async () => {
        const amount0In = 1n;
        const amount0Out = 0n;
        const amount1In = 0n;
        const amount1Out = 2n;

        await createOUSDTSwapEntity(
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
