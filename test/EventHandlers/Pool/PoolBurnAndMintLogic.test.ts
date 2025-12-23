import { Pool } from "../../../generated/src/TestHelpers.gen";
import { processPoolLiquidityEvent } from "../../../src/EventHandlers/Pool/PoolBurnAndMintLogic";
import { setupCommon } from "./common";

describe("processPoolLiquidityEvent", () => {
  it("should return liquidity pool diff with correct timestamp", async () => {
    const commonData = setupCommon();

    const mockEvent = Pool.Mint.createMockEvent({
      sender: "0x1111111111111111111111111111111111111111",
      amount0: 1000n * 10n ** 18n,
      amount1: 2000n * 10n ** 18n,
      mockEventData: {
        block: { timestamp: 1000000, number: 123456, hash: "0x123" },
        chainId: 10,
        logIndex: 1,
        srcAddress: commonData.mockLiquidityPoolData.id,
      },
    });

    const mockContext = {
      log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      isPreload: false,
      effect: () => Promise.resolve(),
    } as unknown as Parameters<typeof processPoolLiquidityEvent>[6];

    const result = await processPoolLiquidityEvent(
      mockEvent,
      commonData.mockLiquidityPoolData,
      commonData.mockToken0Data,
      commonData.mockToken1Data,
      mockEvent.params.amount0,
      mockEvent.params.amount1,
      mockContext,
    );

    // Verify the function returns the expected structure
    expect(result).toHaveProperty("liquidityPoolDiff");
    expect(typeof result.liquidityPoolDiff).toBe("object");

    expect(result.liquidityPoolDiff?.lastUpdatedTimestamp).toEqual(
      new Date(1000000 * 1000),
    );
    // These values should match what updateReserveTokenData returns
    expect(result.liquidityPoolDiff?.token0Price).toBe(1000000000000000000n);
    expect(result.liquidityPoolDiff?.token1Price).toBe(1000000000000000000n);
    expect(result.liquidityPoolDiff?.token0IsWhitelisted).toBe(true);
    expect(result.liquidityPoolDiff?.token1IsWhitelisted).toBe(true);
    expect(result.liquidityPoolDiff?.totalLiquidityUSD).toBe(
      2000000000001000000000000000000000n,
    );
  });
});
