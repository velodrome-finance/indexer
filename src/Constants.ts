import dotenv from "dotenv";
import type { PublicClient } from "viem";
import { Web3 } from "web3";

import { createPrimaryRpcClient } from "./Effects/RpcClient";
import PriceConnectors from "./constants/price_connectors.json";
import StablecoinsJson from "./constants/stablecoins.json";

dotenv.config();

export const TEN_TO_THE_3_BI = BigInt(10 ** 3);
export const TEN_TO_THE_6_BI = BigInt(10 ** 6);
export const TEN_TO_THE_18_BI = BigInt(10 ** 18);

/**
 * Canonical pool-fee scale: 1e6, "hundredths of a basis point".
 *
 * Every Pool stores `baseFee`/`currentFee` in this scale, and every fee
 * derivation divides by it — a single divisor across V2 (AMM) and CL pools
 * (issue #812). Examples:
 *   100 = 0.01%, 500 = 0.05%, 3000 = 0.30%, 10000 = 1.00%, 1_000_000 = 100%
 *
 * On-chain, CL (Slipstream) pools already report fees in 1e6, whereas V2 pools
 * report in basis points (1e4). {@link toCanonicalFeeScale} lifts V2 bps values
 * into FEE_SCALE at write time so the stored field and this divisor always agree.
 */
export const FEE_SCALE = 1000000n;

/** Multiplier converting an on-chain V2 basis-point fee (1e4) into {@link FEE_SCALE} (1e6). */
export const BPS_TO_FEE_SCALE = 100n;

/**
 * Normalize a raw on-chain pool fee to the canonical {@link FEE_SCALE} (1e6).
 *
 * CL pools already emit fees in FEE_SCALE and are returned unchanged. V2 (AMM)
 * pools emit fees in basis points (1e4) and are multiplied by
 * {@link BPS_TO_FEE_SCALE}. Keyed on `isCL` so a single stored scale — and a
 * single divisor — holds across both pool types (issue #812).
 *
 * @param rawFee - Fee as emitted on-chain (basis points for V2, 1e6 for CL)
 * @param isCL - Whether the owning pool is a concentrated-liquidity pool
 * @returns The fee expressed in FEE_SCALE (1e6)
 */
export function toCanonicalFeeScale(rawFee: bigint, isCL: boolean): bigint {
  return isCL ? rawFee : rawFee * BPS_TO_FEE_SCALE;
}

export const SECONDS_IN_AN_HOUR = BigInt(3600);
export const MS_IN_AN_HOUR = 3600 * 1000; // 3_600_000 ms
export const SECONDS_IN_A_DAY = BigInt(86400);
export const SECONDS_IN_A_WEEK = BigInt(604800);
export const SECONDS_IN_FOUR_YEARS = BigInt(126144000);

/** Snapshot interval: 1 hour in milliseconds (for epoch-aligned snapshots) */
export const SNAPSHOT_INTERVAL_IN_MS = 60 * 60 * 1000;

/**
 * Memo for {@link toChecksumAddress}: EIP-55 casing costs a keccak256 per call,
 * and the hot callers (e.g. the swap initiator on every swap) see the same few
 * thousand addresses over and over. Cleared wholesale when it reaches
 * {@link CHECKSUM_MEMO_LIMIT} entries so memory stays bounded.
 */
const checksumMemo = new Map<string, `0x${string}`>();
const CHECKSUM_MEMO_LIMIT = 100_000;

/**
 * EIP-55 checksum-cases an address (memoised; see {@link checksumMemo}).
 * @param address - Address in any case
 * @returns The checksummed address
 * @throws When `address` is not a valid address (as Web3 does; not memoised)
 */
export const toChecksumAddress = (address: string): `0x${string}` => {
  const memoised = checksumMemo.get(address);
  if (memoised !== undefined) return memoised;
  const checksummed = Web3.utils.toChecksumAddress(address) as `0x${string}`;
  if (checksumMemo.size >= CHECKSUM_MEMO_LIMIT) checksumMemo.clear();
  checksumMemo.set(address, checksummed);
  return checksummed;
};

// Note:
// These pools factories addresses are hardcoded since we can't check the pool type from the Voter contract.
// MUST stay in sync with every CLFactory address listed under chains[id=8453|10].contracts.CLFactory.address
// in config.yaml — see test/Constants.test.ts ("VOTER_CLPOOLS_FACTORY_LIST (#769)").
export const VOTER_CLPOOLS_FACTORY_LIST: string[] = [
  // base
  "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
  "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
  "0x9592CD9B267748cbfBDe90Ac9F7DF3c437A6d51B",
  "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef",
  // optimism
  "0x548118C7E0B865C2CfA94D15EC86B666468ac758",
  "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
  "0xe13Dd1fbA721Aa81a1826D9523AC9BC7d260c879",
].map((x) => toChecksumAddress(x));

export const VOTER_NONCL_POOLS_FACTORY_LIST: string[] = [
  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", // base
  "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a", // optimism
].map((x) => toChecksumAddress(x));

// Note:
// These pools factories addresses are hardcoded since we can't check the pool type
// from the SuperchainLeafVoter contract.
// MUST stay in sync with every CLFactory address listed under each superchain leaf
// chain's contracts.CLFactory.address in config.yaml — see test/Constants.test.ts
// ("config.yaml ↔ Constants.ts factory parity (#770, subsumes #769)").
// Missing entries cause SuperchainLeafVoter.GaugeCreated to silently drop the gauge
// from dynamic registration (same #769-class drift that hit VOTER_CLPOOLS_FACTORY_LIST).
export const SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST: string[] = [
  "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F", // Slipstream V1 — all superchain leaves
  "0x718E46d0962A66942E233760a8bd6038Ce54EdCD", // Slipstream gauge-V2 — all superchain leaves (added in #727)
].map((x) => toChecksumAddress(x));

export const SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST: string[] = [
  "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0", // All superchain chains have this address
].map((x) => toChecksumAddress(x));

export const ROOT_POOL_FACTORY_ADDRESS_OPTIMISM = toChecksumAddress(
  "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
);

/**
 * Canonical NFPM address for each CL pool, keyed by (chainId, CLFactory address).
 *
 * Chains typically have a 1:1 CLFactory↔NFPM pairing, but Optimism has two of each.
 * We disambiguate via factory-source: the CLFactory that emitted PoolCreated tells us
 * which NFPM will mint positions in that pool. Pairings are by deployment lineage —
 * the older factory pairs with the older NFPM, the newer factory pairs with the newer NFPM.
 *
 * Keys are `${chainId}-${checksumFactoryAddress}`. Values are checksummed NFPM addresses.
 *
 * Extracted from config.yaml — any new chain or factory must be added here for nfpmAddress
 * to populate on newly created CL pools (test/Constants.test.ts checks every
 * AeroCLFactory in config.yaml has an entry).
 */
const CL_FACTORY_TO_NFPM: Record<string, string> = {
  // Optimism — three NFPMs, three CLFactories. Each pairing verified on-chain
  // via NFPM.factory().
  [`10-${toChecksumAddress("0x548118C7E0B865C2CfA94D15EC86B666468ac758")}`]:
    toChecksumAddress("0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4"),
  [`10-${toChecksumAddress("0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F")}`]:
    toChecksumAddress("0x416b433906b1B72FA758e166e239c43d68dC6F29"),
  // Slipstream gauge-V2 CLFactory (#727) ↔ third OP NFPM. Verified via NFPM.factory().
  [`10-${toChecksumAddress("0xe13Dd1fbA721Aa81a1826D9523AC9BC7d260c879")}`]:
    toChecksumAddress("0xf7f8ccce99Ca2896eC75D3A399D152dB96808399"),

  // Base — four CLFactories each with a dedicated NFPM, verified on-chain via
  // NFPM.factory().
  [`8453-${toChecksumAddress("0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A")}`]:
    toChecksumAddress("0x827922686190790b37229fd06084350E74485b72"),
  [`8453-${toChecksumAddress("0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a")}`]:
    toChecksumAddress("0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F"),
  [`8453-${toChecksumAddress("0x9592CD9B267748cbfBDe90Ac9F7DF3c437A6d51B")}`]:
    toChecksumAddress("0xc741beb2156827704A1466575ccA1cBf726a1178"),
  // Newest CLFactory (paired with CLGaugeFactoryV3) ↔ fourth Base NFPM. Verified.
  [`8453-${toChecksumAddress("0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef")}`]:
    toChecksumAddress("0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53"),

  // Aero (MetaDEX) CLFactories: one per chain, all paired with the Aero NFPM
  // (CLFactory constructor argument `nftPositionManager`, cl-<chain>.json).
  // Arc also has the earlier "lite launch" CLFactory with its own NFPM
  // (cllitelaunch-arc.json).
  ...Object.fromEntries(
    Object.entries({
      8453: "0x9CB220581b91b0C83223012FE69688b92aD07a76",
      10: "0xfeaB42D90055db3a0616249f76B6002D72266778",
      42161: "0x88a60ee77392577c355C0acb2A8d476D5a4EC03a",
      1: "0xF4Fd2E6c5B60c5b365cd1B96DD6245E6D60414c2",
      57073: "0x7660BF2aDefC687C22906112ca323d60A00358cF",
      4663: "0xc63d7338c178e805c544B8f897066bD3BBcBE136",
      5042: "0x7F83235643181E440433400a027618Cd50879751",
    }).map(([chainId, factory]) => [
      `${chainId}-${toChecksumAddress(factory)}`,
      toChecksumAddress("0x4857DB576eE0e45F10525eC59527BfD10beeC60b"),
    ]),
  ),
  [`5042-${toChecksumAddress("0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03")}`]:
    toChecksumAddress("0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473"),
};

/**
 * Which deployment a pool belongs to, stored on `Pool.deployment` and
 * `PoolSnapshot.deployment` (docs/adr/0005-one-data-model-for-legacy-and-aero-pools.md):
 *
 * - `VELODROME`: Velodrome V2 / Slipstream on Optimism and the superchain
 *   leaves (every legacy pool not on Base).
 * - `AERODROME`: Aerodrome V2 / Slipstream on Base.
 * - `AERO`: the Aero (MetaDEX) deployment launched 2026-10-21 on Base,
 *   Optimism, Ethereum, Arbitrum, Ink, Robinhood Chain and Arc (Arc's earlier
 *   "lite launch" included).
 *
 * Stored as a String, not an enum, like the other value sets in schema.graphql.
 */
export const POOL_DEPLOYMENT = {
  VELODROME: "VELODROME",
  AERODROME: "AERODROME",
  AERO: "AERO",
} as const;
export type PoolDeployment =
  (typeof POOL_DEPLOYMENT)[keyof typeof POOL_DEPLOYMENT];

/**
 * The legacy deployment a pool created by a legacy factory on `chainId` belongs to.
 *
 * @param chainId - Chain the pool lives on
 * @returns `AERODROME` on Base, `VELODROME` everywhere else
 */
export function legacyPoolDeployment(chainId: number): PoolDeployment {
  return chainId === 8453
    ? POOL_DEPLOYMENT.AERODROME
    : POOL_DEPLOYMENT.VELODROME;
}

/** Aero NonfungiblePositionManager: the same address on every Aero chain. */
export const AERO_NFPM_ADDRESS = toChecksumAddress(
  "0x4857DB576eE0e45F10525eC59527BfD10beeC60b",
);

/**
 * Every superchain leaf chain shares the same set of CLFactory↔NFPM pairs, so
 * we match on factory alone to avoid listing every chain ID explicitly. There
 * are currently two pairings: the original Slipstream V1 deployment, and the
 * gauge-V2 deployment added in #727. Both verified on-chain via NFPM.factory().
 */
const SUPERCHAIN_CL_FACTORY_TO_NFPM: Record<string, string> = {
  [toChecksumAddress("0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F")]:
    toChecksumAddress("0x991d5546C4B442B4c5fdc4c8B8b8d131DEB24702"),
  [toChecksumAddress("0x718E46d0962A66942E233760a8bd6038Ce54EdCD")]:
    toChecksumAddress("0xefD0f78F93f578036AE34D52A813a4BE7D8D2D52"),
};

/**
 * Resolve the canonical NFPM address for a CL pool from its (chainId, factoryAddress) pair.
 *
 * The NFPM contract owns position NFTs for CL pools created by its paired CLFactory.
 * On chains with a single NFPM/CLFactory this is trivially deterministic; on Optimism
 * (three NFPMs) and Base (four NFPMs) we rely on the factory that emitted PoolCreated
 * to pick the right one. Superchain leaves share two CLFactory↔NFPM pairs matched on
 * factory alone. Aero CLFactories map to the Aero NFPM (Arc's lite-launch
 * CLFactory to its own NFPM); they are keyed by (chainId, factory) because the
 * Aero CLFactory address differs per chain.
 *
 * @param chainId - Chain ID where the CL pool lives
 * @param factoryAddress - Address of the CLFactory that created the pool (event.srcAddress)
 * @returns Checksummed NFPM address, or null if the (chainId, factory) pair is unknown
 */
export function nfpmForCLPool(
  chainId: number,
  factoryAddress: string,
): string | null {
  const checksummed = toChecksumAddress(factoryAddress);
  const explicit = CL_FACTORY_TO_NFPM[`${chainId}-${checksummed}`];
  if (explicit) return explicit;
  return SUPERCHAIN_CL_FACTORY_TO_NFPM[checksummed] ?? null;
}

export const OUSDT_ADDRESS = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";
export const OUSDT_DECIMALS = 6;

// Default fee values from PoolFactory contract constructor (non CL pools)
// This is needed for pools that don't have associated SetCustomFee events or
// have been created before the first SetCustomFee event was emitted.
// VAMM -> volatile pools; SAMM -> stable pools;
export const DEFAULT_VAMM_FEE_BPS = 30n;
export const DEFAULT_SAMM_FEE_BPS = 5n;

/**
 * A chain's price connector (src/constants/price_connectors.json): a base
 * asset other tokens are priced through (tiers 0–2, ADR 0003) and a positive
 * trust signal (ADR 0002).
 *
 * `createdBlock` is read only by the legacy on-chain oracle effect
 * (`getTokenPrice`, scripts only), which must not route through a connector
 * before it existed. Chains with no legacy oracle (the Aero-only chains) omit
 * it.
 */
type PriceConnector = {
  address: string;
  createdBlock?: number;
};

export const OPTIMISM_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.optimism as PriceConnector[];

export const BASE_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.base as PriceConnector[];

export const MODE_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.mode as PriceConnector[];

export const LISK_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.lisk as PriceConnector[];

export const FRAXTAL_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.fraxtal as PriceConnector[];

export const SONEIUM_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.soneium as PriceConnector[];

export const INK_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.ink as PriceConnector[];

export const METAL_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.metal as PriceConnector[];

export const UNICHAIN_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.unichain as PriceConnector[];

export const CELO_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.celo as PriceConnector[];

export const SUPERSEED_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.superseed as PriceConnector[];

export const SWELL_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.swellchain as PriceConnector[];

export const ETHEREUM_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.ethereum as PriceConnector[];

export const ARBITRUM_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.arbitrum as PriceConnector[];

export const ROBINHOOD_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.robinhood as PriceConnector[];

export const ARC_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.arc as PriceConnector[];

/**
 * Build a set of stablecoin addresses from a list of addresses and a destination token
 * @param addresses
 * @param destinationToken
 * @returns A set of stablecoin addresses
 */
function buildStablecoinSet(
  addresses: string[],
  destinationToken: string,
): Set<string> {
  const set = new Set<string>();
  for (const addr of addresses) {
    const lower = addr.toLowerCase();
    if (lower !== destinationToken.toLowerCase()) {
      set.add(lower);
    }
  }
  return set;
}

export enum PriceOracleType {
  V4 = "v4",
  V3 = "v3",
  V2 = "v2",
  V1 = "v1",
}

export { zeroAddress as ZERO_ADDRESS } from "viem";

// Stand-in returned by getTokenDetails for an address that is not an address.
// Real tokens go through getTokenMetadata (src/Effects/TokenMetadata.ts).
export const TOKEN_DETAILS_FALLBACK = { name: "", decimals: 18, symbol: "" };

export const USDC_DETAILS_FALLBACK = {
  name: "USDC",
  symbol: "USDC",
  decimals: 6,
};

/**
 * HTTP transport options for ad-hoc viem clients in `scripts/`. The indexer's
 * own clients are built in src/Effects/RpcClient.ts (lazy URL resolution,
 * per-chain rate limits); endpoint selection lives in src/Effects/RpcConfig.ts.
 * - batchSize 50: dRPC recommends batches well under 200; a slow call holds
 *   the whole batch.
 * - timeout 25s per HTTP request (per batch).
 * - retryCount 0: retries are handled by runWithRpcRetry (src/Effects/RpcGateway.ts).
 */
export const RPC_HTTP_OPTIONS = {
  batch: { batchSize: 50 },
  timeout: 25_000,
  retryCount: 0,
} as const;

/**
 * Retry budget per endpoint for every RPC operation (runWithRpcRetry). Which
 * error classes are retried at all is decided by RPC_ERROR_POLICY in
 * src/Effects/Helpers.ts: transient classes (5xx, timeout, rate limit,
 * network, pruned-node state errors, unknown) are retried; deterministic
 * reverts and auth/quota/method errors are not. Delay before retry n is
 * jittered in [c/2, c] with c = min(base * 2^n, maxDelayMs).
 * Worst case per endpoint: 4 attempts x 25 s timeout + ~3.5 s backoff.
 */
export const RPC_APP_RETRY = {
  maxAttempts: 4,
  baseDelayMs: 500,
  rateLimitBaseDelayMs: 1000,
  maxDelayMs: 8000,
} as const;

/** @see createFallbackRpcClient in src/Effects/RpcClient.ts */
export { createFallbackRpcClient } from "./Effects/RpcClient";

/**
 * The legacy (pre-Aero) on-chain spot-price oracle of a Velodrome/Aerodrome
 * deployment. Read only by the `getTokenPrice` effect, which is kept for
 * scripts; handlers price tokens from pool state (ADR 0003).
 */
export type LegacyPriceOracle = {
  getType: (blockNumber: number) => PriceOracleType;
  getAddress: (priceOracleType: PriceOracleType) => string;
  startBlock: number;
  updateDelta: number;
  // Issue #688: V1/V2 oracles' getManyRatesWithConnectors reverts when the
  // connector array contains tokens with no AMM pool at the queried block.
  // Lowercased addresses listed here are stripped from connectors only when
  // querying V1/V2 oracles. V3+ tolerates these silently.
  v1v2ConnectorBlacklist: Set<string>;
};

/**
 * Constants of the legacy deployment on a chain: Velodrome V2 + Slipstream on
 * Optimism and the superchain leaves, Aerodrome on Base. Absent on chains that
 * only have the Aero (MetaDEX) deployment.
 */
export type LegacyDeploymentConstants = {
  /**
   * Token the legacy Voter's gauges emit (VELO on Optimism, AERO v1 on Base,
   * XVELO on the leaves). Block-dependent only on Optimism (VELO v1 before the
   * v2 migration). It stays the legacy token after the Aero launch: residual
   * legacy gauge claims still pay it. Aero gauges use
   * {@link AeroDeploymentConstants.rewardToken}.
   */
  rewardToken: (blockNumber: number) => string;
  /** LpHelper that maps a leaf V2 pool to its Optimism root pool. */
  lpHelperAddress: string;
  oracle: LegacyPriceOracle;
};

/** Constants of the Aero (MetaDEX) deployment on a chain. */
export type AeroDeploymentConstants = {
  /**
   * Token the chain's Aero gauges emit: AERO on Base, the chain's xAERO
   * receipt token (redeemable 1:1 for AERO on Base) everywhere else
   * (`receiptToken` in deployment-addresses/leaf-<chain>.json).
   */
  rewardToken: string;
  /**
   * First block in which any Aero contract the indexer tracks on this chain
   * existed (eth_getCode-verified); the `start_block` of Aero-only chains.
   */
  startBlock: number;
};

/** Every per-chain constant the indexer needs, keyed by chain id in {@link CHAIN_CONSTANTS}. */
type chainConstants = {
  /**
   * The chain's ETH asset, pricing tier 1. The wrapped native token where the
   * native token is ETH; on Arc (native token USDC) the bridged WETH.
   */
  weth: string;
  /** The chain's main USD stablecoin: pinned at $1 and the oracle quote token. */
  destinationToken: string;
  destinationTokenDecimals: number;
  /** Price connectors (src/constants/price_connectors.json): tiers 0–2 and trusted. */
  priceConnectors: PriceConnector[];
  /** Other USD stablecoins pinned at $1 (src/constants/stablecoins.json), lowercased. */
  stablecoins: Set<string>;
  eth_client: PublicClient;
  legacy?: LegacyDeploymentConstants;
  aero?: AeroDeploymentConstants;
};

// Constants for Optimism
const OPTIMISM_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  destinationTokenDecimals: 6,
  priceConnectors: OPTIMISM_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.optimism,
    "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  ),
  eth_client: createPrimaryRpcClient(10),
  aero: {
    rewardToken: "0xbdEaeA5205d16f34Cb40038052d91235D87B4C54", // xAERO (leaf-optimism.json receiptToken)
    startBlock: 158475795, // VolatilePoolFactory deploy, eth_getCode-verified
  },
  legacy: {
    rewardToken: (blockNumber: number) => {
      if (blockNumber < 105896880) {
        return "0x3c8B650257cFb5f272f799F5e2b4e65093a11a05";
      }
      return "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db";
    },
    lpHelperAddress: "0xF313D54f514A810387D77b7Cc20a98ADd5f891f7",
    oracle: {
      getType: (blockNumber: number) => {
        if (blockNumber > 125484892) {
          return PriceOracleType.V3;
        }
        if (blockNumber > 124076662) {
          return PriceOracleType.V2;
        }
        return PriceOracleType.V1;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        switch (priceOracleType) {
          case PriceOracleType.V3:
            return "0x59114D308C6DE4A84F5F8cD80485a5481047b99f";
          case PriceOracleType.V2:
            return "0x6a3af44e23395d2470f7c81331add6ede8597306";
          case PriceOracleType.V1:
            return "0x395942C2049604a314d39F370Dfb8D87AAC89e16";
          case PriceOracleType.V4:
            throw new Error("V4 oracle not supported on Optimism");
          default:
            throw new Error(`Unsupported oracle type: ${priceOracleType}`);
        }
      },
      startBlock: 107676013,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set([
        "0x01bFF41798a0BcF287b996046Ca68b395DbC1071",
        "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
      ]),
    },
  },
};

// Constants for Base
const BASE_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  destinationTokenDecimals: 6,
  priceConnectors: BASE_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.base,
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ),
  eth_client: createPrimaryRpcClient(8453),
  aero: {
    rewardToken: "0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee", // AERO (root-base.json token)
    startBlock: 52880042, // VolatilePoolFactory deploy, eth_getCode-verified
  },
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    lpHelperAddress: "0xd48bed8AFaF8A1d0909fe823F6b48a4A96f58224",
    oracle: {
      getType: (blockNumber: number) => {
        if (blockNumber > 37381618) {
          return PriceOracleType.V4;
        }
        if (blockNumber > 19862773) {
          return PriceOracleType.V3;
        }
        if (blockNumber > 18480097) {
          return PriceOracleType.V2;
        }
        return PriceOracleType.V1;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        switch (priceOracleType) {
          case PriceOracleType.V4:
            return "0x8456038bdae8672f552182B0FC39b1917dE9a41A";
          case PriceOracleType.V3:
            return "0x3B06c787711ecb5624cE65AC8F26cde10831eb0C";
          case PriceOracleType.V2:
            return "0xcbf5b6abf55fb87271338097fdd03e9d82a9d63f";
          case PriceOracleType.V1:
            return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
        }
      },
      startBlock: 3219857,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set([
        "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
      ]),
    },
  },
};

// Constants for Lisk
const LISK_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", // oUSDT
  destinationTokenDecimals: 6,
  priceConnectors: LISK_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.lisk,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
  ),
  eth_client: createPrimaryRpcClient(1135),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0xa2e319aBE4bBEadeD6FcE67F7D0CDDc5d23F8a8A",
    oracle: {
      getType: (blockNumber: number) => {
        if (blockNumber > 8457278) {
          return PriceOracleType.V3;
        }
        return PriceOracleType.V2;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        switch (priceOracleType) {
          case PriceOracleType.V3:
            return "0x024503003fFE9AF285f47c1DaAaA497D9f1166D0";
          case PriceOracleType.V2:
            return "0xE50621a0527A43534D565B67D64be7C79807F269";
          case PriceOracleType.V1:
            return "0xE50621a0527A43534D565B67D64be7C79807F269";
          case PriceOracleType.V4:
            throw new Error("V4 oracle not supported on Lisk");
          default:
            throw new Error(`Unsupported oracle type: ${priceOracleType}`);
        }
      },
      startBlock: 8380726,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Mode
const MODE_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0xd988097fb8612cc24eeC14542bC03424c656005f",
  destinationTokenDecimals: 6,
  priceConnectors: MODE_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.mode,
    "0xd988097fb8612cc24eeC14542bC03424c656005f",
  ),
  eth_client: createPrimaryRpcClient(34443),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0xD4738416444ce276289A884fDA4FDAc31f8eC694",
    oracle: {
      getType: (blockNumber: number) => {
        if (blockNumber > 15738649) {
          return PriceOracleType.V3;
        }
        return PriceOracleType.V2;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        switch (priceOracleType) {
          case PriceOracleType.V3:
            return "0xbAEe949B52cb503e39f1Df54Dcee778da59E11bc";
          case PriceOracleType.V2:
            return "0xE50621a0527A43534D565B67D64be7C79807F269";
          case PriceOracleType.V1:
            return "0xE50621a0527A43534D565B67D64be7C79807F269";
          case PriceOracleType.V4:
            throw new Error("V4 oracle not supported on Mode");
          default:
            throw new Error(`Unsupported oracle type: ${priceOracleType}`);
        }
      },
      startBlock: 15591759,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set([
        "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
      ]),
    },
  },
};

// Constants for Celo
const CELO_CONSTANTS: chainConstants = {
  weth: "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
  destinationToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", // USDT (native)
  destinationTokenDecimals: 6,
  priceConnectors: CELO_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.celo,
    "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  ),
  eth_client: createPrimaryRpcClient(42220),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0xa916A76b052AcD3b0FF6Cc76b55602fba456a85C",
    oracle: {
      getType: (blockNumber: number) => {
        return PriceOracleType.V3;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        return "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327";
      },
      startBlock: 31690441,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Soneium
const SONEIUM_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
  destinationTokenDecimals: 6,
  priceConnectors: SONEIUM_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.soneium,
    "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
  ),
  eth_client: createPrimaryRpcClient(1868),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0x600089ab611E4Cc9942163e68870806Db66e2B08",
    oracle: {
      getType: (blockNumber: number) => {
        return PriceOracleType.V3;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
      },
      startBlock: 1863998, // #821: V3 oracle deploy block, RPC-verified (eth_getCode binary-search)
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Unichain
const UNICHAIN_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  destinationTokenDecimals: 6,
  priceConnectors: UNICHAIN_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.unichain,
    "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  ),
  eth_client: createPrimaryRpcClient(130),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0x2DCD9B33F0721000Dc1F8f84B804d4CFA23d7713",
    oracle: {
      getType: (blockNumber: number) => {
        return PriceOracleType.V3;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
      },
      startBlock: 9415475,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Fraxtal
const FRAXTAL_CONSTANTS: chainConstants = {
  weth: "0xFC00000000000000000000000000000000000006",
  destinationToken: "0xFc00000000000000000000000000000000000001", // frxUSD
  destinationTokenDecimals: 18,
  priceConnectors: FRAXTAL_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.fraxtal,
    "0xFc00000000000000000000000000000000000001",
  ),
  eth_client: createPrimaryRpcClient(252),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34",
    oracle: {
      getType: (blockNumber: number) => {
        if (blockNumber > 12710720) {
          return PriceOracleType.V3;
        }
        return PriceOracleType.V2;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        switch (priceOracleType) {
          case PriceOracleType.V3:
            return "0x4817f8D70aE32Ee96e5E6BFA24eb7Fcfa83bbf29";
          case PriceOracleType.V2:
            return "0xE50621a0527A43534D565B67D64be7C79807F269";
          case PriceOracleType.V1:
            return "0xE50621a0527A43534D565B67D64be7C79807F269";
          case PriceOracleType.V4:
            throw new Error("V4 oracle not supported on Fraxtal");
          default:
            throw new Error(`Unsupported oracle type: ${priceOracleType}`);
        }
      },
      startBlock: 12640176,
      updateDelta: 60 * 60, // 1 hour
      // oUSDT (0x1217…) is dropped from Fraxtal price connectors entirely
      // (#764 follow-up): the contract at that address on Fraxtal is not the
      // canonical Velodrome-bridged oUSDT, so it must not be a price connector
      // here. With the connector gone, no V1/V2 blacklist entry is needed.
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Ink
const INK_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
  destinationTokenDecimals: 6,
  priceConnectors: INK_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.ink,
    "0xF1815bd50389c46847f0Bda824eC8da914045D14",
  ),
  eth_client: createPrimaryRpcClient(57073),
  aero: {
    rewardToken: "0x9e148C5716b5aAdCFD3B71cEAE9EE7a9e22C29E2", // xAERO (leaf-ink.json receiptToken)
    startBlock: 59052441, // VolatilePoolFactory deploy, eth_getCode-verified
  },
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0x2DCD9B33F0721000Dc1F8f84B804d4CFA23d7713",
    oracle: {
      getType: (blockNumber: number) => {
        return PriceOracleType.V3;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
      },
      startBlock: 3361885,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Metal
const METAL_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", // oUSDT
  destinationTokenDecimals: 6,
  priceConnectors: METAL_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.metal,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
  ),
  eth_client: createPrimaryRpcClient(1750),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0xcaa7d54453964773FE04B5aD32D06322Fc9d9fE4",
    oracle: {
      getType: (blockNumber: number) => {
        return PriceOracleType.V3;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        return "0x3e71CCdf495d9628D3655A600Bcad3afF2ddea98";
      },
      startBlock: 11438647,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Swell
const SWELL_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", // USDe
  destinationTokenDecimals: 18,
  priceConnectors: SWELL_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.swellchain,
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  ),
  eth_client: createPrimaryRpcClient(1923),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0x2002618dd63228670698200069E42f4422e82497",
    oracle: {
      getType: (blockNumber: number) => {
        return PriceOracleType.V3;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
      },
      startBlock: 3733759,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Constants for Superseed
const SUPERSEED_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  destinationToken: "0xC316C8252B5F2176d0135Ebb0999E99296998F2e", // USDC
  destinationTokenDecimals: 6,
  priceConnectors: SUPERSEED_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.superseed,
    "0xC316C8252B5F2176d0135Ebb0999E99296998F2e",
  ),
  eth_client: createPrimaryRpcClient(5330),
  legacy: {
    rewardToken: (blockNumber: number) =>
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    lpHelperAddress: "0xee717411f6E44F9feE011835C8E6FAaC5dEfF166",
    oracle: {
      getType: (blockNumber: number) => {
        return PriceOracleType.V3;
      },
      getAddress: (priceOracleType: PriceOracleType) => {
        return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
      },
      startBlock: 5642528,
      updateDelta: 60 * 60, // 1 hour
      v1v2ConnectorBlacklist: new Set(),
    },
  },
};

// Aero-only chains (no legacy Velodrome/Aerodrome deployment, so no legacy
// oracle, LpHelper or legacy reward token). Every value below was read off the
// chain on 2026-11-13: the tokens the chain's Aero pools pair against
// (HyperSync PoolCreated + Swap counts, symbol()/decimals() over RPC) and the
// first Aero contract's deploy block (eth_getCode just before and at it).

// Constants for Ethereum. Aero pools pair mostly against WETH (41 pools), USDC
// (30), USDT (11) and WBTC (9).
const ETHEREUM_CONSTANTS: chainConstants = {
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  destinationToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  destinationTokenDecimals: 6,
  priceConnectors: ETHEREUM_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.ethereum,
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  ),
  eth_client: createPrimaryRpcClient(1),
  aero: {
    rewardToken: "0x9e148C5716b5aAdCFD3B71cEAE9EE7a9e22C29E2", // xAERO (leaf-ethereum.json receiptToken)
    startBlock: 26237985, // VolatilePoolFactory deploy, eth_getCode-verified
  },
};

// Constants for Arbitrum. Aero pools pair mostly against USDG (24 pools), WETH
// (21), USDC (13), WBTC and USD₮0 (5 each) and ARB (4).
const ARBITRUM_CONSTANTS: chainConstants = {
  weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  destinationToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
  destinationTokenDecimals: 6,
  priceConnectors: ARBITRUM_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.arbitrum,
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  ),
  eth_client: createPrimaryRpcClient(42161),
  aero: {
    rewardToken: "0x436a085B2751cB87db270FFa66f8d698F87bEC82", // xAERO (leaf-arbitrum.json receiptToken)
    startBlock: 516786506, // VolatilePoolFactory deploy, eth_getCode-verified
  },
};

// Constants for Robinhood Chain (Arbitrum Orbit, native ETH). Aero pools pair
// against USDG (58 of 100 pools, 52 distinct counterparties) and WETH (32);
// there is no USDC market, so USDG is the destination token.
const ROBINHOOD_CONSTANTS: chainConstants = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  destinationToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", // USDG
  destinationTokenDecimals: 6,
  priceConnectors: ROBINHOOD_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.robinhood,
    "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  ),
  eth_client: createPrimaryRpcClient(4663),
  aero: {
    rewardToken: "0x9e148C5716b5aAdCFD3B71cEAE9EE7a9e22C29E2", // xAERO (leaf-robinhood.json receiptToken)
    startBlock: 93947396, // VolatilePoolFactory deploy, eth_getCode-verified
  },
};

// Constants for Arc (Circle). The native gas token is USDC; 0x3600…0000 is its
// ERC-20 interface (6 decimals) and the counterparty of 45 of the 50 Aero
// pools, so it is the destination token and there is no wrapped-native ETH.
// The tier-1 slot holds the bridged WETH (4 pools). EURC, GBPA and MXNB are
// non-USD stablecoins and are priced through their USDC pools, not pinned.
// startBlock is the "lite launch" deployment (metadex 1.0.0 / slipstream
// 1.0.1, deployment-addresses/*litelaunch-arc.json), which went live before the
// full launch on 2026-10-21 and holds 35 of Arc's 43 CL pools.
const ARC_CONSTANTS: chainConstants = {
  weth: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB",
  destinationToken: "0x3600000000000000000000000000000000000000", // USDC
  destinationTokenDecimals: 6,
  priceConnectors: ARC_PRICE_CONNECTORS,
  stablecoins: buildStablecoinSet(
    StablecoinsJson.arc,
    "0x3600000000000000000000000000000000000000",
  ),
  eth_client: createPrimaryRpcClient(5042),
  aero: {
    rewardToken: "0x20077cC0d5E385A0Fe9C91bbC7DC744f51559307", // xAERO (leaf-arc.json receiptToken)
    startBlock: 20964951, // lite-launch VolatilePoolFactory deploy, eth_getCode-verified
  },
};

/**
 * The legacy deployment's constants on `chainId`.
 *
 * @param chainId - Chain to look up
 * @returns The chain's legacy constants
 * @throws When the chain has no legacy Velodrome/Aerodrome deployment (an
 *   Aero-only chain); legacy handlers are only configured on legacy chains
 */
export function getLegacyConstants(chainId: number): LegacyDeploymentConstants {
  const legacy = CHAIN_CONSTANTS[chainId]?.legacy;
  if (!legacy) {
    throw new Error(
      `Chain ${chainId} has no legacy Velodrome/Aerodrome deployment`,
    );
  }
  return legacy;
}

/**
 * Create a unique ID for a token on a specific chain. Should only be used for Token entities.
 * Address must be EIP-55 checksum-cased (Envio's `event.params.*` already are).
 * @param chainId
 * @param address - Token address (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @returns string Merged Token ID.
 */
export const TokenId = (chainId: number, address: string) =>
  `${chainId}-${address}`;

/**
 * Create a unique ID for a pool on a specific chain as used by Pool.
 * Pool address must be EIP-55 checksum-cased (Envio's `event.params.*` already are).
 * Callers must NOT pre-lowercase — that triggers the silent miss documented in #633.
 * @param chainId
 * @param pool - Pool address (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @returns string Combined pool ID.
 */
export const PoolId = (chainId: number, pool: string) => `${chainId}-${pool}`;

/** Entity ID for ALM_LP_Wrapper. Format: {chainId}-{wrapperAddress}
 * @param chainId - Chain ID of the wrapper
 * @param wrapperAddress - Address of the wrapper (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @returns string Combined wrapper ID.
 */
export const ALMLPWrapperId = (chainId: number, wrapperAddress: string) =>
  `${chainId}-${wrapperAddress}`;

/** Entity ID for UserStatsPerPool. Format: {chainId}-{userAddress}-{poolAddress}
 * @param chainId - Chain ID of the pool
 * @param userAddress - Address of the user (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param poolAddress - Address of the pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @returns string Combined user ID.
 */
export const UserStatsPerPoolId = (
  chainId: number,
  userAddress: string,
  poolAddress: string,
) => `${chainId}-${userAddress}-${poolAddress}`;

/** Entity ID for VeNFTState. Format: {chainId}-{tokenId}
 * @param chainId - Chain ID of the veNFT
 * @param tokenId - ID of the veNFT
 * @returns string Combined veNFT ID.
 */
export const VeNFTId = (chainId: number, tokenId: bigint) =>
  `${chainId}-${tokenId}`;

/** Entity ID for VeNFTPoolVote. Format: {chainId}-{tokenId}-{poolAddress}
 * @param chainId - Chain ID of the veNFT
 * @param tokenId - ID of the veNFT
 * @param poolAddress - Address of the pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @returns string Combined veNFT pool vote ID.
 */
export const VeNFTPoolVoteId = (
  chainId: number,
  tokenId: bigint,
  poolAddress: string,
) => `${chainId}-${tokenId}-${poolAddress}`;

/** Entity ID for RootPool_LeafPool. Format: {rootChainId}-{leafChainId}-{rootPoolAddress}-{leafPoolAddress}. rootChainId is typically 10 (Optimism).
 * @param rootChainId - Chain ID of the root pool
 * @param leafChainId - Chain ID of the leaf pool
 * @param rootPoolAddress - Address of the root pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param leafPoolAddress - Address of the leaf pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @returns string Combined root pool leaf pool ID.
 */
export const RootPoolLeafPoolId = (
  rootChainId: number,
  leafChainId: number,
  rootPoolAddress: string,
  leafPoolAddress: string,
) => `${rootChainId}-${leafChainId}-${rootPoolAddress}-${leafPoolAddress}`;

/** Entity ID for RootGauge_RootPool. Format: {rootChainId}-{rootGaugeAddress}
 * @param rootChainId - Root chain ID (e.g. Optimism)
 * @param rootGaugeAddress - Root gauge address (RootGauge/RootCLGauge on root chain) (must be EIP-55 checksum-cased; do not pre-lowercase)
 */
export const RootGaugeRootPoolId = (
  rootChainId: number,
  rootGaugeAddress: string,
) => `${rootChainId}-${rootGaugeAddress}`;

/** rootPoolMatchingHash for cross-chain pool matching. Format: {leafChainId}_{token0}_{token1}_{tickSpacing}
 * @param leafChainId - Chain ID of the leaf pool
 * @param token0 - Token0 address (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param token1 - Token1 address (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param tickSpacing - Tick spacing value
 */
export const rootPoolMatchingHash = (
  leafChainId: number,
  token0: string,
  token1: string,
  tickSpacing: bigint | number,
) => `${leafChainId}_${token0}_${token1}_${tickSpacing}`;

/** Entity ID for FeeToTickSpacingMapping. Format: {chainId}-{factoryAddress}-{tickSpacing}.
 *
 * The factory is part of the key because `tickSpacingToFee` is per CLFactory
 * and a chain can have several: Base has four legacy CLFactories plus the Aero
 * one, and on Arc tick spacing 50 is 0.05% on the lite-launch CLFactory but
 * 0.30% on the Aero CLFactory.
 *
 * @param chainId - Chain ID of the fee to tick spacing mapping
 * @param factoryAddress - CLFactory that emitted TickSpacingEnabled (EIP-55 checksummed)
 * @param tickSpacing - Tick spacing value
 * @returns string Combined fee to tick spacing mapping ID.
 */
export const FeeToTickSpacingMappingId = (
  chainId: number,
  factoryAddress: string,
  tickSpacing: bigint | number,
) => `${chainId}-${factoryAddress}-${tickSpacing}`;

/** Entity ID for NonFungiblePosition. Format: {chainId}-{nfpmAddress}-{tokenId} (stable id).
 *
 * The natural key is (NFPM, tokenId) — pool is metadata on the position. tokenIds are only
 * unique within a single NFPM contract's counter, so on chains with multiple NFPMs
 * (e.g. Optimism) nfpmAddress is required to prevent silent overwrites. See #618 / #621.
 *
 * @param chainId - Chain ID of the position
 * @param nfpmAddress - Address of the NFPM contract that owns the position (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param tokenId - Token ID of the NFT position
 * @returns string Combined non-fungible position ID.
 */
export const NonFungiblePositionId = (
  chainId: number,
  nfpmAddress: string,
  tokenId: bigint,
) => `${chainId}-${nfpmAddress}-${tokenId}`;

/**
 * Create a unique ID for a token on a specific chain at a specific block. Really should only be used
 * for TokenPrice Entities.
 * @param chainId
 * @param address - Token address (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param blockNumber
 * @returns string Merged Token ID.
 */
export const TokenIdByBlock = (
  chainId: number,
  address: string,
  blockNumber: number,
) => `${chainId}-${address}-${blockNumber}`;

/** Entity ID for PoolTransferInTx.
 * @param chainId
 * @param txHash
 * @param poolAddress - Address of the pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param logIndex
 */
export const PoolTransferInTxId = (
  chainId: number,
  txHash: string,
  poolAddress: string,
  logIndex: number,
) => `${chainId}-${txHash}-${poolAddress}-${logIndex}`;

/** Entity ID for TxPoolTransferRegistry. Format: {chainId}-{txHash}-{poolAddress}.
 * Keyed by (tx, pool) — finer grain than the CL mint registry — because the
 * Pool.Mint/Pool.Burn consumer already knows the pool (event.srcAddress). This
 * keeps registry rows small (typically 1–2 transfer ids per row).
 *
 * @param chainId - Chain ID of the tx
 * @param txHash - Transaction hash that produced the mint/burn Transfer
 * @param poolAddress - Address of the pool whose Transfer we are registering
 * @returns string Combined registry ID.
 */
export const TxPoolTransferRegistryId = (
  chainId: number,
  txHash: string,
  poolAddress: string,
) => `${chainId}-${txHash}-${poolAddress}`;

/** Entity ID for ALMLPWrapperTransferInTx.
 * @param chainId
 * @param txHash
 * @param wrapperAddress - Address of the wrapper (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param logIndex
 */
export const ALMLPWrapperTransferInTxId = (
  chainId: number,
  txHash: string,
  wrapperAddress: string,
  logIndex: number,
) => `${chainId}-${txHash}-${wrapperAddress}-${logIndex}`;

/** Entity ID for CLPoolMintEvent.
 * @param chainId
 * @param poolAddress - Address of the CL pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param txHash
 * @param logIndex
 */
export const CLPoolMintEventId = (
  chainId: number,
  poolAddress: string,
  txHash: string,
  logIndex: number,
) => `${chainId}-${poolAddress}-${txHash}-${logIndex}`;

/** Entity ID for AeroNFPMMintPool: every value an Aero NFPM IncreaseLiquidity
 * repeats from the CLPool.Mint it caused, so the IncreaseLiquidity handler finds
 * the pool by primary key.
 * Format: {chainId}-{txHash}-{nfpmAddress}-{tickLower}-{tickUpper}-{liquidity}-{amount0}-{amount1}
 * @param chainId - Chain ID of the tx
 * @param txHash - Transaction hash
 * @param nfpmAddress - The NFPM (the Mint's `owner`, the IncreaseLiquidity's emitter; EIP-55 checksummed)
 * @param tickLower - Lower tick of the range
 * @param tickUpper - Upper tick of the range
 * @param liquidity - Liquidity minted
 * @param amount0 - Raw token0 amount paid
 * @param amount1 - Raw token1 amount paid
 * @returns string Combined ID.
 */
export const AeroNFPMMintPoolId = (
  chainId: number,
  txHash: string,
  nfpmAddress: string,
  tickLower: bigint,
  tickUpper: bigint,
  liquidity: bigint,
  amount0: bigint,
  amount1: bigint,
) =>
  `${chainId}-${txHash}-${nfpmAddress}-${tickLower}-${tickUpper}-${liquidity}-${amount0}-${amount1}`;

/** Entity ID for V2SwapFeesInTx: the pending fee of a V2 swap, handed from
 * its Fees events to its Swap. Format: {chainId}-{txHash}-{poolAddress}
 * @param chainId - Chain ID of the tx
 * @param txHash - Transaction hash
 * @param poolAddress - V2 pool (EIP-55 checksummed)
 * @returns string Combined ID.
 */
export const V2SwapFeesInTxId = (
  chainId: number,
  txHash: string,
  poolAddress: string,
) => `${chainId}-${txHash}-${poolAddress}`;

/** Entity ID for NFPMCollectFeesInTx: the fees of a legacy-NFPM position,
 * handed from CLPool.Collect to the NFPM.Collect that follows it in the same
 * tx. Format: {chainId}-{txHash}-{nfpmAddress}
 * @param chainId - Chain ID of the tx
 * @param txHash - Transaction hash
 * @param nfpmAddress - The NFPM (CLPool.Collect's `owner`, NFPM.Collect's emitter; EIP-55 checksummed)
 * @returns string Combined ID.
 */
export const NFPMCollectFeesInTxId = (
  chainId: number,
  txHash: string,
  nfpmAddress: string,
) => `${chainId}-${txHash}-${nfpmAddress}`;

/** Entity ID for PoolFactoryDefaultFee. Format: {chainId}-{factoryAddress}-{stable|volatile}
 * @param chainId - Chain ID of the factory
 * @param factoryAddress - V2 pool factory (EIP-55 checksummed)
 * @param isStable - Pool type the default fee applies to
 * @returns string Combined ID.
 */
export const PoolFactoryDefaultFeeId = (
  chainId: number,
  factoryAddress: string,
  isStable: boolean,
) => `${chainId}-${factoryAddress}-${isStable ? "stable" : "volatile"}`;

/** Entity ID for TxCLPoolMintRegistry. Format: {chainId}-{txHash}.
 * Keyed by transaction (not pool) because the NFPM.Transfer(mint) consumer only
 * knows chainId + txHash at lookup time; filtering by pool/logIndex happens on
 * the CLPoolMintEvent rows fetched via the registry.
 *
 * @param chainId - Chain ID of the tx
 * @param txHash - Transaction hash that produced one or more CLPool.Mint events
 * @returns string Combined registry ID.
 */
export const TxCLPoolMintRegistryId = (chainId: number, txHash: string) =>
  `${chainId}-${txHash}`;

/** ID for CLPositionPendingPrincipal — tracks burned principal awaiting collection.
 * Keyed by contract-level position identity (pool + owner + tick range).
 * Mirrors Solidity's positions mapping key: keccak256(owner, tickLower, tickUpper) per pool.
 * @param chainId - Chain ID of the position
 * @param poolAddress - Address of the CL pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param owner - Owner address (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param tickLower - Lower tick of the position range
 * @param tickUpper - Upper tick of the position range
 */
export const CLPositionPendingPrincipalId = (
  chainId: number,
  poolAddress: string,
  owner: string,
  tickLower: bigint,
  tickUpper: bigint,
) => `${chainId}-${poolAddress}-${owner}-${tickLower}-${tickUpper}`;

/** Snapshot ID for PoolSnapshot. epochMs = getSnapshotEpoch(timestamp).getTime()
 * @param chainId - Chain ID of the pool
 * @param poolAddress - Address of the pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param epochMs - Epoch timestamp in milliseconds
 * @returns string Combined pool ID.
 */
export const PoolSnapshotId = (
  chainId: number,
  poolAddress: string,
  epochMs: number,
) => `${PoolId(chainId, poolAddress)}-${epochMs}`;

/** Entity ID for OUSDTSwaps.
 * @param transactionHash
 * @param chainId
 * @param tokenInPool
 * @param amountIn
 * @param tokenOutPool
 * @param amountOut
 */
export const OUSDTSwapsId = (
  transactionHash: string,
  chainId: number,
  tokenInPool: string,
  amountIn: bigint,
  tokenOutPool: string,
  amountOut: bigint,
) =>
  `${transactionHash}-${chainId}-${tokenInPool}-${amountIn}-${tokenOutPool}-${amountOut}`;

/** Snapshot ID for UserStatsPerPoolSnapshot. epochMs = getSnapshotEpoch(timestamp).getTime()
 * @param chainId - Chain ID of the pool
 * @param userAddress - Address of the user (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param poolAddress - Address of the pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param epochMs - Epoch timestamp in milliseconds
 * @returns string Combined user ID.
 */
export const UserStatsPerPoolSnapshotId = (
  chainId: number,
  userAddress: string,
  poolAddress: string,
  epochMs: number,
) => `${chainId}-${userAddress}-${poolAddress}-${epochMs}`;

/** Snapshot ID for NonFungiblePositionSnapshot.
 * Format: {chainId}-{nfpmAddress}-{tokenId}-{epochMs}. epochMs = getSnapshotEpoch(timestamp).getTime().
 *
 * Includes nfpmAddress because tokenIds are only unique within a single NFPM contract's
 * counter. Optimism has two NFPMs so two positions can share (chainId, tokenId) with
 * different pools; without nfpmAddress in the ID their snapshots would collide in the
 * same epoch and overwrite each other. See #620.
 *
 * @param chainId - Chain ID of the non-fungible position
 * @param nfpmAddress - Address of the NFPM contract that owns the position (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param tokenId - ID of the non-fungible position
 * @param epochMs - Epoch timestamp in milliseconds
 * @returns string Combined non-fungible position snapshot ID.
 */
export const NonFungiblePositionSnapshotId = (
  chainId: number,
  nfpmAddress: string,
  tokenId: bigint,
  epochMs: number,
) => `${chainId}-${nfpmAddress}-${tokenId}-${epochMs}`;

/** Snapshot ID for ALM_LP_WrapperSnapshot. Format: {chainId}-{wrapperAddress}-{epochMs}. epochMs = getSnapshotEpoch(timestamp).getTime()
 * @param chainId - Chain ID of the wrapper
 * @param wrapperAddress - Address of the wrapper (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param epochMs - Epoch timestamp in milliseconds
 * @returns string Combined wrapper snapshot ID.
 */
export const ALMLPWrapperSnapshotId = (
  chainId: number,
  wrapperAddress: string,
  epochMs: number,
) => `${chainId}-${wrapperAddress}-${epochMs}`;

/** Snapshot ID for VeNFTStateSnapshot. epochMs = getSnapshotEpoch(timestamp).getTime()
 * @param chainId - Chain ID of the veNFT state
 * @param tokenId - ID of the veNFT state
 * @param epochMs - Epoch timestamp in milliseconds
 * @returns string Combined veNFT state ID.
 */
export const VeNFTStateSnapshotId = (
  chainId: number,
  tokenId: bigint,
  epochMs: number,
) => `${chainId}-${tokenId}-${epochMs}`;

/** Snapshot ID for VeNFTPoolVoteSnapshot. Format: {chainId}-{tokenId}-{poolAddress}-{epochMs}
 * @param chainId - Chain ID of the veNFT state
 * @param tokenId - ID of the veNFT state
 * @param poolAddress - Address of the pool (must be EIP-55 checksum-cased; do not pre-lowercase)
 * @param epochMs - Epoch timestamp in milliseconds
 * @returns string Combined veNFT pool vote snapshot ID.
 */
export const VeNFTPoolVoteSnapshotId = (
  chainId: number,
  tokenId: bigint,
  poolAddress: string,
  epochMs: number,
) => `${chainId}-${tokenId}-${poolAddress}-${epochMs}`;

// Key is chain ID
export const CHAIN_CONSTANTS: Record<number, chainConstants> = {
  10: OPTIMISM_CONSTANTS,
  8453: BASE_CONSTANTS,
  34443: MODE_CONSTANTS,
  1135: LISK_CONSTANTS,
  252: FRAXTAL_CONSTANTS,
  1750: METAL_CONSTANTS,
  1868: SONEIUM_CONSTANTS,
  57073: INK_CONSTANTS,
  130: UNICHAIN_CONSTANTS,
  42220: CELO_CONSTANTS,
  1923: SWELL_CONSTANTS,
  5330: SUPERSEED_CONSTANTS,
  1: ETHEREUM_CONSTANTS,
  42161: ARBITRUM_CONSTANTS,
  4663: ROBINHOOD_CONSTANTS,
  5042: ARC_CONSTANTS,
};
