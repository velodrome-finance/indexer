import { describe, expect, it } from "vitest";
import { OUSDT_ADDRESS, toChecksumAddress } from "../../../src/Constants";
import type { handlerContext } from "../../../src/EntityTypes";
import {
  SuperSwapLegId,
  TxProcessIdRegistryId,
  nonOUSDTSide,
  recordProcessedMessage,
  writeSuperSwapDestinationLegsForSwap,
  writeSuperSwapOriginLegs,
} from "../../../src/EventHandlers/SuperswapsHyperlane/SuperSwapLegLogic";

/** A handler context with in-memory entity stores (get / set only). */
function fakeContext() {
  const stores: Record<string, Map<string, Record<string, unknown>>> = {};
  const store = (name: string) => {
    stores[name] ??= new Map();
    const m = stores[name];
    return {
      get: async (id: string) => m.get(id),
      set: (e: { id: string }) => {
        m.set(e.id, e as Record<string, unknown>);
      },
    };
  };
  const context = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => store(prop),
  }) as unknown as handlerContext;
  return { context, stores: (name: string) => stores[name] ?? new Map() };
}

const WETH = toChecksumAddress("0x4200000000000000000000000000000000000006");
const TOKEN_B = toChecksumAddress("0x1111111111111111111111111111111111111111");
const sender = toChecksumAddress("0x2222222222222222222222222222222222222222");

describe("nonOUSDTSide", () => {
  it("is the token sold for oUSDT or bought with it", () => {
    expect(
      nonOUSDTSide({
        tokenInPool: WETH,
        tokenOutPool: OUSDT_ADDRESS,
        amountIn: 5n,
        amountOut: 9n,
      }),
    ).toEqual({
      token: WETH,
      amount: 5n,
    });
    expect(
      nonOUSDTSide({
        tokenInPool: OUSDT_ADDRESS,
        tokenOutPool: TOKEN_B,
        amountIn: 9n,
        amountOut: 7n,
      }),
    ).toEqual({
      token: TOKEN_B,
      amount: 7n,
    });
    expect(
      nonOUSDTSide({
        tokenInPool: WETH,
        tokenOutPool: TOKEN_B,
        amountIn: 1n,
        amountOut: 1n,
      }),
    ).toBeUndefined();
  });
});

describe("SuperSwap origin legs", () => {
  it("writes one leg per dispatched message, in dispatch order", async () => {
    const { context, stores } = fakeContext();
    context.OUSDTBridgedTransaction.set({
      id: "0xtx",
      transactionHash: "0xtx",
      originChainId: 34443n,
      destinationChainId: 1750n,
      sender,
      recipient: sender,
      amount: 9n,
    });
    context.TxDispatchIdRegistry.set({
      id: "0xtx",
      messageIds: ["0xm1", "0xm2"],
    });
    context.TxOUSDTSwapRegistry.set({
      id: "0xtx",
      swapId: "s",
      tokenInPool: WETH,
      tokenOutPool: OUSDT_ADDRESS,
      amountIn: 5n,
      amountOut: 9n,
    });
    expect(
      await writeSuperSwapOriginLegs(
        34443,
        "0xtx",
        1750n,
        1_700_000_000,
        context,
      ),
    ).toBe(2);
    const legs = stores("SuperSwapOriginLeg");
    expect(legs.get(SuperSwapLegId(34443, "0xm2"))).toMatchObject({
      chainId: 34443,
      messageId: "0xm2",
      dispatchIndex: 1,
      destinationChainId: 1750n,
      oUSDTamount: 9n,
      sourceChainToken: WETH,
      sourceChainTokenAmountSwapped: 5n,
      timestamp: new Date(1_700_000_000_000),
    });
  });

  it("writes nothing without an oUSDT bridge, a dispatch or an oUSDT swap", async () => {
    const { context, stores } = fakeContext();
    context.TxDispatchIdRegistry.set({ id: "0xtx", messageIds: ["0xm1"] });
    expect(
      await writeSuperSwapOriginLegs(34443, "0xtx", 1750n, 1, context),
    ).toBe(0);
    expect(stores("SuperSwapOriginLeg").size).toBe(0);
  });
});

describe("SuperSwap destination legs", () => {
  const swap = {
    tokenInPool: OUSDT_ADDRESS,
    tokenOutPool: TOKEN_B,
    amountIn: 9n,
    amountOut: 7n,
  };

  it("ProcessId first (Hyperlane's order), then the swap: one leg per processed message", async () => {
    const { context, stores } = fakeContext();
    await recordProcessedMessage(1750, "0xdst", "0xm1", 1_700_000_100, context);
    expect(stores("SuperSwapDestinationLeg").size).toBe(0);
    await writeSuperSwapDestinationLegsForSwap(1750, "0xdst", swap, context);
    expect(
      stores("SuperSwapDestinationLeg").get(SuperSwapLegId(1750, "0xm1")),
    ).toMatchObject({
      chainId: 1750,
      messageId: "0xm1",
      transactionHash: "0xdst",
      destinationChainToken: TOKEN_B,
      destinationChainTokenAmountSwapped: 7n,
      timestamp: new Date(1_700_000_100_000),
    });
    expect(
      stores("TxProcessIdRegistry").get(TxProcessIdRegistryId(1750, "0xdst")),
    ).toMatchObject({
      messageIds: ["0xm1"],
    });
  });

  it("swap already recorded when ProcessId arrives: the leg is written at ProcessId", async () => {
    const { context, stores } = fakeContext();
    context.TxOUSDTSwapRegistry.set({ id: "0xdst", swapId: "s", ...swap });
    await recordProcessedMessage(1750, "0xdst", "0xm1", 5, context);
    expect(stores("SuperSwapDestinationLeg").size).toBe(1);
  });

  it("no leg for a swap in a transaction that processed no message", async () => {
    const { context, stores } = fakeContext();
    await writeSuperSwapDestinationLegsForSwap(1750, "0xother", swap, context);
    expect(stores("SuperSwapDestinationLeg").size).toBe(0);
  });
});
