import { S } from "envio";
import type { PublicClient } from "viem";
import { RPC_ERROR_POLICY } from "./Helpers";
import { createRpcEffect } from "./RpcEffect";
import {
  type RpcCallContext,
  type RpcResult,
  executeRpc,
  mostCacheBlockingErrorClass,
} from "./RpcGateway";

/**
 * Placeholders written by Envio's Uniswap v4 indexer `getTokenMetadata` effect
 * when a field cannot be read. Kept identical so rows produced here and rows
 * seeded from that indexer's cache mean the same thing.
 */
export const UNKNOWN_NAME = "unknown";
export const UNKNOWN_SYMBOL = "UNKNOWN";
/** Decimals used when `decimals()` cannot be read or exceeds {@link MAX_DECIMALS}. */
export const DEFAULT_DECIMALS = 18;
/** Larger values are clamped to {@link DEFAULT_DECIMALS} (a Base token reports ~9e36). */
export const MAX_DECIMALS = 50;

const METADATA_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "NAME",
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "SYMBOL",
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Output of {@link getTokenMetadata}; identical to the Uniswap v4 indexer's. */
export type TokenMetadata = { name: string; symbol: string; decimals: number };

/**
 * Removes control characters (incl. NUL, which Postgres text rejects) and trims.
 *
 * @param str - Raw string from the contract.
 * @returns Sanitised string ("" for empty input).
 */
export function sanitizeTokenString(str: string): string {
  if (!str) return "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
}

/**
 * Decodes a bytes32 `NAME()`/`SYMBOL()` result to text, dropping NUL bytes.
 *
 * @param value - 0x-prefixed 32-byte hex.
 * @returns The decoded, sanitised string.
 */
export function decodeBytes32String(value: `0x${string}`): string {
  const bytes = Buffer.from(value.slice(2), "hex").filter((b) => b !== 0);
  return sanitizeTokenString(new TextDecoder().decode(new Uint8Array(bytes)));
}

type FieldRead<T> = RpcResult<T | null>;

const readField = <T>(
  context: RpcCallContext,
  address: `0x${string}`,
  chainId: number,
  functionName: (typeof METADATA_ABI)[number]["name"],
  client: (c: PublicClient) => Promise<T>,
): Promise<FieldRead<T>> =>
  executeRpc<T | null>(
    context,
    {
      name: `getTokenMetadata.${functionName}`,
      chainId,
      details: { token: address },
    },
    null,
    client,
  );

const isTransient = (r: RpcResult<unknown>): boolean =>
  r.usedDefault &&
  r.errorClass !== undefined &&
  !RPC_ERROR_POLICY[r.errorClass].cacheableDefault;

/**
 * Reads ERC20 metadata field by field, so a non-standard or failing method
 * does not discard the others. Each read gets retries and the fallback
 * endpoint. Semantics match Envio's Uniswap v4 indexer:
 * `name()` then bytes32 `NAME()`, `symbol()` then bytes32 `SYMBOL()`,
 * placeholders "unknown" / "UNKNOWN", decimals 18 when unreadable or > 50.
 *
 * Unlike that implementation, a field that failed for a transient reason
 * (timeout, 5xx, pruned node, rate limit) makes the whole result
 * non-cacheable, so a placeholder caused by an outage is never persisted.
 *
 * @param context - Logger context.
 * @param address - Token address (checksummed).
 * @param chainId - Chain the token lives on.
 * @returns The metadata plus whether it is safe to cache.
 */
export async function fetchTokenMetadata(
  context: RpcCallContext,
  address: `0x${string}`,
  chainId: number,
): Promise<RpcResult<TokenMetadata>> {
  const read =
    (functionName: (typeof METADATA_ABI)[number]["name"]) =>
    (c: PublicClient) =>
      c.readContract({
        address,
        abi: METADATA_ABI,
        functionName,
      }) as Promise<unknown>;

  const [nameR, symbolR, decimalsR] = await Promise.all([
    readField(context, address, chainId, "name", read("name")),
    readField(context, address, chainId, "symbol", read("symbol")),
    readField(context, address, chainId, "decimals", read("decimals")),
  ]);

  // bytes32 fallbacks only when the string read failed deterministically.
  const bytes32 = async (
    primary: FieldRead<unknown>,
    fn: "NAME" | "SYMBOL",
  ): Promise<FieldRead<unknown> | null> =>
    primary.usedDefault && !isTransient(primary)
      ? readField(context, address, chainId, fn, read(fn))
      : null;
  const [nameB, symbolB] = await Promise.all([
    bytes32(nameR, "NAME"),
    bytes32(symbolR, "SYMBOL"),
  ]);

  const text = (
    s: FieldRead<unknown>,
    b: FieldRead<unknown> | null,
    placeholder: string,
  ): string => {
    let out = "";
    if (!s.usedDefault && typeof s.value === "string") {
      out = sanitizeTokenString(s.value);
    } else if (b && !b.usedDefault && typeof b.value === "string") {
      out = decodeBytes32String(b.value as `0x${string}`);
    } else {
      return placeholder;
    }
    return out || placeholder;
  };

  const rawDecimals = decimalsR.usedDefault ? null : Number(decimalsR.value);
  const decimals =
    rawDecimals !== null &&
    Number.isInteger(rawDecimals) &&
    rawDecimals >= 0 &&
    rawDecimals <= MAX_DECIMALS
      ? rawDecimals
      : DEFAULT_DECIMALS;

  const legs = [nameR, symbolR, decimalsR, nameB, symbolB].filter(
    (r): r is FieldRead<unknown> => r !== null,
  );
  const transient = legs.some(isTransient);
  return {
    value: {
      name: text(nameR, nameB, UNKNOWN_NAME),
      symbol: text(symbolR, symbolB, UNKNOWN_SYMBOL),
      decimals,
    },
    // `usedDefault` here means "some field is a stand-in for an outage".
    usedDefault: transient,
    errorClass: transient
      ? mostCacheBlockingErrorClass(...legs.map((l) => l.errorClass))
      : undefined,
  };
}

/**
 * ERC20 metadata effect, wire-compatible with the effect cache of Envio's
 * Uniswap v4 indexer: same name (`getTokenMetadata`), input tuple
 * `[address, chainId]` (cache id `["0x…",10]`), output
 * `{name, symbol, decimals}`, and per-chain cache (`crossChain: false`), so
 * Envio loads `.envio/cache/<chainId>/getTokenMetadata.tsv` into
 * `envio_<chainId>_effect_getTokenMetadata` on a fresh database.
 *
 * The cache id uses the address exactly as passed; always pass the EIP-55
 * checksummed form (the seed files are checksummed).
 */
export const getTokenMetadata = createRpcEffect(
  {
    name: "getTokenMetadata",
    input: S.tuple((t) => ({
      address: t.item(0, S.string) as `0x${string}`,
      chainId: t.item(1, S.number),
    })),
    output: S.schema({
      name: S.string,
      symbol: S.string,
      decimals: S.number,
    }),
    cache: true,
    crossChain: false,
  },
  ({ input, context }) =>
    fetchTokenMetadata(context, input.address, input.chainId),
);

/**
 * True when metadata proves the address is a contract that answers ERC20
 * metadata calls (a string read succeeded). An EOA returns empty data for
 * every call and therefore only placeholders.
 *
 * @param meta - Metadata from {@link getTokenMetadata}.
 * @returns Whether name or symbol is a real value.
 */
export function metadataProvesContract(meta: TokenMetadata): boolean {
  return meta.name !== UNKNOWN_NAME || meta.symbol !== UNKNOWN_SYMBOL;
}
