import { HttpRequestError } from "viem";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import {
  getTokenDetails,
  getTokenPrice,
  roundBlockToInterval,
  toTokenDetails,
} from "../../src/Effects/Token";
import {
  captureReadError,
  failingViemClient,
  installRpcMocks,
  runEffect,
} from "./setup";

const CHAIN = 10;
const TOKEN = "0x4200000000000000000000000000000000000042"; // OP, lower-case on purpose

let revert: unknown;
beforeAll(async () => {
  revert = await captureReadError(
    failingViemClient({ code: -32000, message: "execution reverted" }),
  );
});

describe("toTokenDetails", () => {
  it("maps the Uniswap placeholders to the empty 'missing' marker", () => {
    expect(
      toTokenDetails({ name: "unknown", symbol: "UNKNOWN", decimals: 18 }),
    ).toEqual({ name: "", symbol: "", decimals: 18 });
    expect(
      toTokenDetails({ name: "Optimism", symbol: "OP", decimals: 18 }),
    ).toEqual({ name: "Optimism", symbol: "OP", decimals: 18 });
  });
});

describe("getTokenDetails", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("keeps its name and is not itself cached (getTokenMetadata owns the cache)", () => {
    const e = getTokenDetails as unknown as {
      name: string;
      defaultShouldCache: boolean;
      crossChain: boolean;
    };
    expect(e.name).toBe("getTokenDetails");
    expect(e.defaultShouldCache).toBe(false);
    expect(e.crossChain).toBe(false);
  });

  it("delegates to getTokenMetadata with a checksummed address (the cache-key format)", async () => {
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string; address?: string }) =>
        ({ name: "Optimism", symbol: "OP", decimals: 18 })[functionName],
    );
    restore = installRpcMocks(CHAIN, { readContract } as never);
    const { output, context } = await runEffect(getTokenDetails, {
      contractAddress: TOKEN,
      chainId: CHAIN,
    });
    expect(output).toEqual({ name: "Optimism", symbol: "OP", decimals: 18 });
    expect(readContract.mock.calls[0][0].address).toBe(
      toChecksumAddress(TOKEN),
    );
    expect(context.childCacheFlags).toEqual([
      { name: "getTokenMetadata", cache: true },
    ]);
  });

  it("returns '' for unreadable name/symbol so the heal logic still fires", async () => {
    restore = installRpcMocks(CHAIN, {
      readContract: vi.fn(
        async ({ functionName }: { functionName: string }) => {
          if (functionName === "decimals") return 6;
          throw revert;
        },
      ),
    } as never);
    const { output } = await runEffect(getTokenDetails, {
      contractAddress: TOKEN,
      chainId: CHAIN,
    });
    expect(output).toEqual({ name: "", symbol: "", decimals: 6 });
  });

  it("returns the static fallback for a non-address without RPC", async () => {
    const readContract = vi.fn();
    restore = installRpcMocks(CHAIN, { readContract } as never);
    const { output } = await runEffect(getTokenDetails, {
      contractAddress: "not-an-address",
      chainId: CHAIN,
    });
    expect(output).toEqual({ name: "", symbol: "", decimals: 18 });
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("getTokenPrice", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());
  const chain = CHAIN_CONSTANTS[CHAIN];
  const block = chain.oracle.startBlock + 50_000_000;

  it("prices the destination token at 1 without RPC", async () => {
    const readContract = vi.fn();
    restore = installRpcMocks(CHAIN, { readContract } as never);
    const { output, context } = await runEffect(getTokenPrice, {
      tokenAddress: chain.destinationToken,
      chainId: CHAIN,
      blockNumber: block,
    });
    expect(output).toMatchObject({ pricePerUSDNew: 10n ** 18n });
    expect(context.cache).toBe(true);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("returns a cacheable 0 before the oracle exists", async () => {
    restore = installRpcMocks(CHAIN, { readContract: vi.fn() } as never);
    const { output, context } = await runEffect(getTokenPrice, {
      tokenAddress: TOKEN,
      chainId: CHAIN,
      blockNumber: chain.oracle.startBlock - 1,
    });
    expect(output).toMatchObject({ pricePerUSDNew: 0n });
    expect(context.cache).toBe(true);
  });

  it("scales a V3 oracle answer by the supplied decimals", async () => {
    restore = installRpcMocks(CHAIN, {
      readContract: vi.fn(async () => [2_000_000n]),
    } as never);
    const { output, context } = await runEffect(getTokenPrice, {
      tokenAddress: TOKEN,
      chainId: CHAIN,
      blockNumber: block,
      tokenDecimals: 18,
    });
    expect(output).toEqual({
      pricePerUSDNew: 2_000_000n * 10n ** 12n,
      priceOracleType: "v3",
    });
    expect(context.cache).toBe(true);
  });

  it("does not cache a zero price produced by an RPC outage", async () => {
    restore = installRpcMocks(
      CHAIN,
      {
        readContract: vi.fn(async () => {
          throw new HttpRequestError({ status: 502, url: "https://x" });
        }),
      } as never,
      null,
    );
    const { output, context } = await runEffect(getTokenPrice, {
      tokenAddress: TOKEN,
      chainId: CHAIN,
      blockNumber: block,
    });
    expect(output).toMatchObject({ pricePerUSDNew: 0n });
    expect(context.cache).toBe(false);
    expect(context.log.error).toHaveBeenCalled();
  });
});

describe("roundBlockToInterval", () => {
  it("rounds to the hour and clamps to minBlock", () => {
    expect(roundBlockToInterval(3601, 10)).toBe(3600);
    expect(roundBlockToInterval(3601, 1)).toBe(3600);
    expect(roundBlockToInterval(3601, 10, 3500)).toBe(3600);
    expect(roundBlockToInterval(3601, 10, 3700)).toBe(3700);
  });
});
