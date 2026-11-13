import type { Token, TokenPriceSnapshot, TokenPricingPools } from "envio";
import { PoolId, TokenId, toChecksumAddress } from "../../src/Constants";
import type { Pool, handlerContext } from "../../src/EntityTypes";
import { setupCommon } from "../EventHandlers/Pool/common";

/**
 * Real Optimism (chain 10) addresses, so tiers come from the live
 * CHAIN_CONSTANTS / price_connectors.json rather than test doubles.
 */
export const OP = 10;
export const OP_USDC = toChecksumAddress(
  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
); // destinationToken → tier 0, 6 decimals
export const OP_DAI = toChecksumAddress(
  "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
); // stablecoin → tier 0, 18 decimals
export const OP_WETH = toChecksumAddress(
  "0x4200000000000000000000000000000000000006",
); // tier 1
export const OP_VELO = toChecksumAddress(
  "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
); // reward token + connector → tier 2
export const OP_WBTC = toChecksumAddress(
  "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
); // connector → tier 2, 8 decimals
export const OP_TOKEN_X = toChecksumAddress(
  "0x1111111111111111111111111111111111111111",
); // tier 3
export const OP_MANATEE = toChecksumAddress(
  "0x7909Bda52eAf7C3cc12745E727Eb527a485241D8",
); // blacklisted on Optimism

export const LISK = 1135;
export const XVELO = toChecksumAddress(
  "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
); // reward token on leaf chains; rebinds to Optimism VELO
export const LISK_USDT = toChecksumAddress(
  "0x05D032ac25d322df992303dCa074EE7392C117b9",
); // Lisk stablecoin → tier 0

export const E18 = 10n ** 18n;
export const USD = (n: number | bigint): bigint => BigInt(n) * E18;

/** A fixed reference time: 2023-11-14T22:00:00Z, the start of a clock hour. */
export const HOUR_START_S = 1_700_000_000 - (1_700_000_000 % 3600);
export const HOUR_S = 3600;
export const DAY_S = 24 * HOUR_S;

const common = setupCommon();

/**
 * Builds a Token at `address` on `chainId`, last refreshed (and successfully
 * priced) at `refreshedAt` seconds.
 *
 * @param chainId - Chain the token lives on
 * @param address - Token address (checksummed)
 * @param decimals - Token decimals
 * @param price - Stored pricePerUSDNew (1e18-base)
 * @param refreshedAt - Unix seconds of the last refresh / success
 * @param overrides - Any other field overrides
 * @returns The token
 */
export function makeToken(
  chainId: number,
  address: string,
  decimals: bigint,
  price: bigint,
  refreshedAt: number,
  overrides: Partial<Token> = {},
): Token {
  return common.createMockToken({
    id: TokenId(chainId, address),
    address,
    chainId,
    decimals,
    symbol: "TKN",
    name: "Token",
    pricePerUSDNew: price,
    isWhitelisted: true,
    lastUpdatedTimestamp: new Date(refreshedAt * 1000),
    lastSuccessfulPriceTimestamp:
      price > 0n ? new Date(refreshedAt * 1000) : undefined,
    ...overrides,
  });
}

/**
 * Builds a pool between two tokens with the given state.
 *
 * @param chainId - Chain the pool lives on
 * @param poolAddress - Pool address (checksummed)
 * @param token0 - token0 address
 * @param token1 - token1 address
 * @param state - Pool kind + reserves / sqrtPriceX96
 * @returns The pool
 */
export function makePool(
  chainId: number,
  poolAddress: string,
  token0: string,
  token1: string,
  state: Partial<Pool>,
): Pool {
  return common.createMockPool({
    chainId,
    poolAddress,
    id: PoolId(chainId, poolAddress),
    token0_id: TokenId(chainId, token0),
    token1_id: TokenId(chainId, token1),
    token0_address: token0,
    token1_address: token1,
    isCL: false,
    isStable: false,
    sqrtPriceX96: 0n,
    ...state,
  }) as unknown as Pool;
}

/** 2^96, the Q64.96 unit of `sqrtPriceX96`. */
export const Q96 = 2n ** 96n;

export interface PricingStore {
  context: handlerContext;
  tokens: Map<string, Token>;
  pools: Map<string, Pool>;
  pricingPools: Map<string, TokenPricingPools>;
  snapshots: TokenPriceSnapshot[];
  effectCalls: string[];
}

/**
 * In-memory handler context covering everything the price refresh touches:
 * Token (get/set), Pool (get), TokenPricingPools (get/set), TokenPriceSnapshot
 * (set, recorded in order), `effect` (getTokenDetails / hasContractBytecode
 * only; any other effect name is recorded and throws, so a stray RPC in the
 * pricing path fails the test) and `log`.
 *
 * @param seed - Initial entities
 * @param seed.tokens - Tokens to seed
 * @param seed.pools - Pools to seed
 * @param seed.pricingPools - TokenPricingPools rows as `{ tokenId: poolIds }`
 * @returns The store and its context
 */
export function createPricingStore(seed: {
  tokens?: Token[];
  pools?: Pool[];
  pricingPools?: Record<string, string[]>;
}): PricingStore {
  const tokens = new Map((seed.tokens ?? []).map((t) => [t.id, t]));
  const pools = new Map((seed.pools ?? []).map((p) => [p.id, p]));
  const pricingPools = new Map<string, TokenPricingPools>(
    Object.entries(seed.pricingPools ?? {}).map(([id, list]) => [
      id,
      { id, pools: list },
    ]),
  );
  const snapshots: TokenPriceSnapshot[] = [];
  const effectCalls: string[] = [];

  const context = {
    Token: {
      get: vi.fn(async (id: string) => tokens.get(id)),
      set: vi.fn((t: Token) => {
        tokens.set(t.id, t);
      }),
    },
    Pool: {
      get: vi.fn(async (id: string) => pools.get(id)),
      set: vi.fn((p: Pool) => {
        pools.set(p.id, p);
      }),
    },
    TokenPricingPools: {
      get: vi.fn(async (id: string) => pricingPools.get(id)),
      set: vi.fn((row: TokenPricingPools) => {
        pricingPools.set(row.id, row);
      }),
    },
    TokenPriceSnapshot: {
      set: vi.fn((s: TokenPriceSnapshot) => {
        snapshots.push(s);
      }),
    },
    effect: vi.fn(async (effect: { name?: string }) => {
      const name = effect?.name ?? "unknown";
      effectCalls.push(name);
      if (name === "getTokenDetails") {
        return { name: "Healed", symbol: "HEAL", decimals: 18 };
      }
      if (name === "hasContractBytecode") return { hasCode: true };
      throw new Error(`unexpected effect in pricing path: ${name}`);
    }),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as handlerContext;

  return { context, tokens, pools, pricingPools, snapshots, effectCalls };
}
