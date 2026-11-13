import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { S } from "envio";
import { HttpRequestError, stringToHex } from "viem";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "../../src/Constants";
import { ErrorType } from "../../src/Effects/Helpers";
import {
  decodeBytes32String,
  fetchTokenMetadata,
  getTokenMetadata,
  metadataProvesContract,
  sanitizeTokenString,
} from "../../src/Effects/TokenMetadata";
import {
  answeringViemClient,
  captureReadError,
  createMockEffectContext,
  failingViemClient,
  installRpcMocks,
  runEffect,
} from "./setup";

const CHAIN = 8453;
const TOKEN = toChecksumAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");

let revert: unknown;
let pruned: unknown;
let zeroData: unknown;
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
  zeroData = await captureReadError(answeringViemClient("0x"));
});

type Answers = Partial<
  Record<"name" | "NAME" | "symbol" | "SYMBOL" | "decimals", unknown>
>;
/** Mock client: string/number answers resolve, Error-like answers reject. */
const tokenClient = (answers: Answers) => ({
  readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
    const a = answers[functionName as keyof Answers];
    if (a === undefined) throw revert;
    if (a instanceof Error || (a && typeof a === "object")) throw a;
    return a;
  }),
});

describe("fetchTokenMetadata", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("reads name, symbol and decimals independently", async () => {
    const primary = tokenClient({
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
    });
    restore = installRpcMocks(CHAIN, primary);
    const r = await fetchTokenMetadata(createMockEffectContext(), TOKEN, CHAIN);
    expect(r).toEqual({
      value: { name: "USD Coin", symbol: "USDC", decimals: 6 },
      usedDefault: false,
      errorClass: undefined,
    });
    // bytes32 variants are only read when the string read fails.
    expect(primary.readContract).toHaveBeenCalledTimes(3);
  });

  it("keeps decimals=6 when name() reverts (the old all-or-nothing bug stored 18)", async () => {
    restore = installRpcMocks(
      CHAIN,
      tokenClient({ symbol: "ODD", decimals: 6 }),
    );
    const r = await fetchTokenMetadata(createMockEffectContext(), TOKEN, CHAIN);
    expect(r.value).toEqual({ name: "unknown", symbol: "ODD", decimals: 6 });
    expect(r.usedDefault).toBe(false); // deterministic: cacheable
  });

  it("falls back to bytes32 NAME()/SYMBOL() like the Uniswap v4 indexer", async () => {
    restore = installRpcMocks(
      CHAIN,
      tokenClient({
        name: zeroData,
        NAME: stringToHex("Maker", { size: 32 }),
        symbol: zeroData,
        SYMBOL: stringToHex("MKR", { size: 32 }),
        decimals: 18,
      }),
    );
    const r = await fetchTokenMetadata(createMockEffectContext(), TOKEN, CHAIN);
    expect(r.value).toEqual({ name: "Maker", symbol: "MKR", decimals: 18 });
  });

  it("uses the Uniswap placeholders when every read reverts, and that result is cacheable", async () => {
    restore = installRpcMocks(CHAIN, tokenClient({}));
    const r = await fetchTokenMetadata(createMockEffectContext(), TOKEN, CHAIN);
    expect(r.value).toEqual({
      name: "unknown",
      symbol: "UNKNOWN",
      decimals: 18,
    });
    expect(r.usedDefault).toBe(false);
  });

  it("clamps decimals above 50 to 18", async () => {
    restore = installRpcMocks(
      CHAIN,
      tokenClient({ name: "Huge", symbol: "HUGE", decimals: 255 }),
    );
    const r = await fetchTokenMetadata(createMockEffectContext(), TOKEN, CHAIN);
    expect(r.value.decimals).toBe(18);
  });

  it("marks the result non-cacheable when one field failed transiently (pruned node on both endpoints)", async () => {
    const primary = tokenClient({
      name: "USD Coin",
      symbol: pruned,
      decimals: 6,
    });
    const fallback = tokenClient({ symbol: pruned });
    restore = installRpcMocks(CHAIN, primary, fallback);
    const ctx = createMockEffectContext();
    const r = await fetchTokenMetadata(ctx, TOKEN, CHAIN);
    expect(r.value).toEqual({
      name: "USD Coin",
      symbol: "UNKNOWN",
      decimals: 6,
    });
    expect(r.usedDefault).toBe(true);
    expect(r.errorClass).toBe(ErrorType.HISTORICAL_STATE_NOT_AVAILABLE);
    // A transient failure must not trigger the bytes32 SYMBOL() probe.
    expect(
      primary.readContract.mock.calls.map((c) => c[0].functionName),
    ).not.toContain("SYMBOL");
  });

  it("recovers a field through the fallback endpoint", async () => {
    const primary = tokenClient({
      name: new HttpRequestError({ status: 503, url: "https://x" }),
      symbol: "USDC",
      decimals: 6,
    });
    const fallback = tokenClient({ name: "USD Coin" });
    restore = installRpcMocks(CHAIN, primary, fallback);
    const r = await fetchTokenMetadata(createMockEffectContext(), TOKEN, CHAIN);
    expect(r.value.name).toBe("USD Coin");
    expect(r.usedDefault).toBe(false);
  });
});

describe("getTokenMetadata effect (Uniswap v4 cache compatibility)", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  const effect = getTokenMetadata as unknown as {
    name: string;
    input: S.Schema<unknown>;
    output: S.Schema<unknown>;
  };

  it("has the same name as the Uniswap effect", () => {
    expect(effect.name).toBe("getTokenMetadata");
  });

  it("serialises its input to the cache id format of the Uniswap TSV", async () => {
    // envio's `S` does not re-export reverseConvertOrThrow; load the same
    // rescript-schema module envio uses (it builds the cache id with it).
    const envioEntry = createRequire(import.meta.url).resolve("envio");
    const surySpecifier = createRequire(envioEntry)
      .resolve("rescript-schema")
      .replace(/S\.js$/, "S.mjs");
    const Sury = (await import(pathToFileURL(surySpecifier).href)) as {
      reverseConvertOrThrow: (v: unknown, s: unknown) => unknown;
    };
    const serialised = Sury.reverseConvertOrThrow(
      { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", chainId: 10 },
      effect.input,
    );
    expect(JSON.stringify(serialised)).toBe(
      '["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",10]',
    );
  });

  it("parses an output row copied from the Uniswap TSV", () => {
    expect(
      S.parseOrThrow(
        JSON.parse('{"name": "USD Coin", "symbol": "USDC", "decimals": 6}'),
        effect.output,
      ),
    ).toEqual({ name: "USD Coin", symbol: "USDC", decimals: 6 });
  });

  it("does not cache a result with a transient field failure", async () => {
    restore = installRpcMocks(
      CHAIN,
      tokenClient({ name: "A", symbol: pruned, decimals: 6 }),
      null,
    );
    const { output, context } = await runEffect(getTokenMetadata, {
      address: TOKEN,
      chainId: CHAIN,
    });
    expect(output).toEqual({ name: "A", symbol: "UNKNOWN", decimals: 6 });
    expect(context.cache).toBe(false);
  });

  it("caches deterministic results", async () => {
    restore = installRpcMocks(CHAIN, tokenClient({ decimals: 6 }), null);
    const { context } = await runEffect(getTokenMetadata, {
      address: TOKEN,
      chainId: CHAIN,
    });
    expect(context.cache).toBe(true);
  });
});

describe("token metadata helpers", () => {
  it("sanitises control characters and decodes bytes32", () => {
    expect(sanitizeTokenString(" A\u0000B\n ")).toBe("AB");
    expect(sanitizeTokenString("")).toBe("");
    expect(decodeBytes32String(stringToHex("DAI", { size: 32 }))).toBe("DAI");
  });

  it("metadataProvesContract only for a real name or symbol", () => {
    expect(
      metadataProvesContract({
        name: "unknown",
        symbol: "UNKNOWN",
        decimals: 18,
      }),
    ).toBe(false);
    expect(
      metadataProvesContract({ name: "unknown", symbol: "X", decimals: 18 }),
    ).toBe(true);
  });
});
