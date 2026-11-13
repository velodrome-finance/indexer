import { HttpRequestError } from "viem";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "../../src/Constants";
import { hasContractBytecode } from "../../src/Effects/Bytecode";
import {
  captureReadError,
  failingViemClient,
  installRpcMocks,
  runEffect,
} from "./setup";

const CHAIN = 8453;
const ADDR = toChecksumAddress("0xBd0bD2F62a2B5E9E3F3B2B9eFEb2a3E1C0A55528");

let revert: unknown;
beforeAll(async () => {
  revert = await captureReadError(
    failingViemClient({ code: -32000, message: "execution reverted" }),
  );
});

const http503 = () => new HttpRequestError({ status: 503, url: "https://x" });

describe("hasContractBytecode", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("skips the bytecode probe when metadata already proves a token contract", async () => {
    const getCode = vi.fn();
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) =>
        ({ name: "Token", symbol: "TKN", decimals: 18 })[functionName],
    );
    restore = installRpcMocks(CHAIN, { readContract, getCode } as never);
    const { output, context } = await runEffect(hasContractBytecode, {
      address: ADDR,
      chainId: CHAIN,
    });
    expect(output).toEqual({ hasCode: true });
    expect(getCode).not.toHaveBeenCalled();
    expect(context.cache).toBe(true);
  });

  it("probes and caches false for an EOA", async () => {
    const getCode = vi.fn(async () => "0x");
    const readContract = vi.fn(async () => {
      throw revert;
    });
    restore = installRpcMocks(CHAIN, { readContract, getCode } as never);
    const { output, context } = await runEffect(hasContractBytecode, {
      address: ADDR,
      chainId: CHAIN,
    });
    expect(output).toEqual({ hasCode: false });
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(context.cache).toBe(true);
  });

  it("probes and caches false for a contract whose decimals() reverts (#736)", async () => {
    restore = installRpcMocks(CHAIN, {
      getCode: vi.fn(async () => "0x6080"),
      readContract: vi.fn(async () => {
        throw revert;
      }),
    } as never);
    const { output, context } = await runEffect(hasContractBytecode, {
      address: ADDR,
      chainId: CHAIN,
    });
    expect(output).toEqual({ hasCode: false });
    expect(context.cache).toBe(true);
  });

  it("fails open (true) without caching when the probe cannot reach any endpoint", async () => {
    restore = installRpcMocks(
      CHAIN,
      {
        getCode: vi.fn(async () => {
          throw http503();
        }),
        readContract: vi.fn(async () => {
          throw http503();
        }),
      } as never,
      null,
    );
    const { output, context } = await runEffect(hasContractBytecode, {
      address: ADDR,
      chainId: CHAIN,
    });
    expect(output).toEqual({ hasCode: true });
    expect(context.cache).toBe(false);
  });

  it("returns false for a non-address without RPC", async () => {
    const getCode = vi.fn();
    restore = installRpcMocks(CHAIN, { getCode } as never);
    const { output } = await runEffect(hasContractBytecode, {
      address: "0x123",
      chainId: CHAIN,
    });
    expect(output).toEqual({ hasCode: false });
    expect(getCode).not.toHaveBeenCalled();
  });
});
