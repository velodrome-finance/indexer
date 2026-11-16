/**
 * Cache correctness for the effects that used to persist transient failures
 * (getRootPoolAddress, getSwapFee): a default produced by
 * an RPC outage must leave `context.cache === false`; real answers and
 * deterministic reverts stay cached.
 */
import { HttpRequestError } from "viem";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getLegacyConstants, toChecksumAddress } from "../../src/Constants";
import { getRootPoolAddress } from "../../src/Effects/RootPool";
import { getSwapFee } from "../../src/Effects/SwapFee";
import {
  captureReadError,
  failingViemClient,
  installRpcMocks,
  runEffect,
} from "./setup";

const A = toChecksumAddress("0x1111111111111111111111111111111111111111");
const B = toChecksumAddress("0x2222222222222222222222222222222222222222");
const ROOT = toChecksumAddress("0x3333333333333333333333333333333333333333");

let revert: unknown;
let pruned: unknown;
beforeAll(async () => {
  revert = await captureReadError(
    failingViemClient({ code: -32000, message: "execution reverted" }),
  );
  pruned = await captureReadError(
    failingViemClient({
      code: -32603,
      message:
        "insufficient changesets to revert to block #12272400. Available changeset range: 41491212..=41501276",
    }),
  );
});

const cases = [
  {
    name: "getRootPoolAddress",
    chainId: 1135,
    effect: getRootPoolAddress,
    input: { chainId: 1135, factory: A, token0: A, token1: B, type: 0 },
    answer: ROOT,
    expected: ROOT,
    defaultValue: "",
  },
  {
    name: "getSwapFee",
    chainId: 8453,
    effect: getSwapFee,
    input: {
      poolAddress: A,
      factoryAddress: B,
      chainId: 8453,
      blockNumber: 100,
    },
    answer: 500n,
    expected: 500n,
    defaultValue: undefined,
  },
] as const;

describe.each(cases)("$name", (c) => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("caches a real answer", async () => {
    restore = installRpcMocks(c.chainId, {
      readContract: vi.fn(async () => c.answer),
    } as never);
    const { output, context } = await runEffect(c.effect, c.input);
    expect(output).toBe(c.expected);
    expect(context.cache).toBe(true);
  });

  it("does NOT cache the default after a transient failure on both endpoints", async () => {
    const fail = vi.fn(async () => {
      throw new HttpRequestError({ status: 500, url: "https://x" });
    });
    restore = installRpcMocks(
      c.chainId,
      { readContract: fail } as never,
      { readContract: vi.fn(async () => Promise.reject(pruned)) } as never,
    );
    const { output, context } = await runEffect(c.effect, c.input);
    expect(output).toBe(c.defaultValue);
    expect(context.cache).toBe(false);
    expect(context.log.error).toHaveBeenCalledWith(
      expect.stringContaining(c.name),
      expect.objectContaining({ event: "rpc.default_used", cacheable: false }),
    );
  });

  it("caches the default for a deterministic revert", async () => {
    restore = installRpcMocks(c.chainId, {
      readContract: vi.fn(async () => Promise.reject(revert)),
    } as never);
    const { output, context } = await runEffect(c.effect, c.input);
    expect(output).toBe(c.defaultValue);
    expect(context.cache).toBe(true);
  });

  it("recovers through the fallback endpoint", async () => {
    restore = installRpcMocks(
      c.chainId,
      { readContract: vi.fn(async () => Promise.reject(pruned)) } as never,
      { readContract: vi.fn(async () => c.answer) } as never,
    );
    const { output, context } = await runEffect(c.effect, c.input);
    expect(output).toBe(c.expected);
    expect(context.cache).toBe(true);
  });
});

it("getRootPoolAddress reads the chain's LpHelper", async () => {
  const readContract = vi.fn(async () => ROOT);
  const restore = installRpcMocks(1135, { readContract } as never);
  try {
    await runEffect(getRootPoolAddress, cases[0].input);
    expect(readContract.mock.calls[0]).toEqual([
      expect.objectContaining({
        address: getLegacyConstants(1135).lpHelperAddress,
        functionName: "root_lp_address",
      }),
    ]);
  } finally {
    restore();
  }
});
