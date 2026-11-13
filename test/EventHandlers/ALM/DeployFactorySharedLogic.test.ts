import type { NonFungiblePosition } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import type { handlerContext } from "../../../src/EntityTypes";
import { findStrategyPosition } from "../../../src/EventHandlers/ALM/DeployFactorySharedLogic";
import { setupCommon } from "../Pool/common";

describe("findStrategyPosition", () => {
  const { createMockNonFungiblePosition } = setupCommon();
  const chainId = 1868;
  const pool = toChecksumAddress("0xc2026f3fb6fc51F4EcAE40a88b4509cB6C143ed4");
  const otherPool = toChecksumAddress(
    "0x9999999999999999999999999999999999999999",
  );
  const txHash =
    "0x5e6bf8c09cd1684c9058231d881142db3b7add1102ab5b7ecd58a3e14eaca7e0";
  const ammPosition = {
    pool,
    token0: toChecksumAddress("0x1111111111111111111111111111111111111111"),
    token1: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    tickLower: 105000n,
    tickUpper: 117000n,
    liquidity: 5000n,
  };

  const position = (
    overrides: Partial<NonFungiblePosition>,
  ): NonFungiblePosition =>
    createMockNonFungiblePosition({
      chainId,
      pool,
      token0: ammPosition.token0,
      token1: ammPosition.token1,
      tickLower: ammPosition.tickLower,
      tickUpper: ammPosition.tickUpper,
      liquidity: ammPosition.liquidity,
      mintTransactionHash: txHash,
      ...overrides,
    });

  const contextReturning = (rows: NonFungiblePosition[]) => {
    const warn = vi.fn();
    const context = {
      NonFungiblePosition: { getWhere: vi.fn().mockResolvedValue(rows) },
      log: { warn, error: vi.fn(), info: vi.fn() },
    } as unknown as handlerContext;
    return { context, warn };
  };

  it("ignores identical positions minted on another chain or in another pool", async () => {
    const { context, warn } = contextReturning([
      position({ tokenId: 1n, chainId: 57073, mintLogIndex: 0 }),
      position({ tokenId: 2n, pool: otherPool, mintLogIndex: 1 }),
      position({ tokenId: 61956n, mintLogIndex: 5 }),
    ]);

    const result = await findStrategyPosition(
      chainId,
      txHash,
      ammPosition,
      "[test]",
      context,
    );

    expect(result?.tokenId).toBe(61956n);
    expect(warn).not.toHaveBeenCalled();
  });

  it("picks the earliest mint when several positions match, whatever order the query returns", async () => {
    const later = position({ tokenId: 11n, mintLogIndex: 9 });
    const earlier = position({ tokenId: 12n, mintLogIndex: 3 });

    for (const rows of [
      [later, earlier],
      [earlier, later],
    ]) {
      const { context, warn } = contextReturning(rows);
      const result = await findStrategyPosition(
        chainId,
        txHash,
        ammPosition,
        "[test]",
        context,
      );
      expect(result?.tokenId).toBe(12n);
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it("returns undefined when no position matches", async () => {
    const { context } = contextReturning([
      position({ tokenId: 1n, liquidity: 1n }),
    ]);

    const result = await findStrategyPosition(
      chainId,
      txHash,
      ammPosition,
      "[test]",
      context,
    );

    expect(result).toBeUndefined();
  });
});
