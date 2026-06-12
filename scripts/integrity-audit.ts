/**
 * Data-integrity audit: NEW deployment vs reference OLD deployment.
 *
 * Compares two indexer GraphQL endpoints field-by-field on a stratified
 * sample of entities. Findings are bucketed into four classifications:
 *
 *   - NEW_REGRESSION     correct on OLD, wrong/missing on NEW (blocker)
 *   - EXPECTED_FIX       wrong on OLD, correct on NEW per a listed issue
 *   - EXPECTED_MIGRATION value shape changed by design (e.g. #812)
 *   - OPEN_GAP           wrong on both (e.g. #707 SuperSwap)
 *
 * Usage:
 *   NEW_GRAPHQL_URL=https://indexer.us.hyperindex.xyz/<new-slug>/v1/graphql \
 *   pnpm dlx tsx scripts/integrity-audit.ts > docs/audits/<report>.md
 *
 * OLD_GRAPHQL_URL is optional and defaults to the c9b8978 reference
 * deployment (https://indexer.us.hyperindex.xyz/e38a72a/v1/graphql).
 *
 * RPC URLs come from .env (ENVIO_<CHAIN>_RPC_URL). Chains with no configured
 * RPC are silently skipped for on-chain checks (GraphQL checks still run).
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../src/Constants";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABIS = join(__dirname, "..", "abis");

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

const OLD_URL =
  process.env.OLD_GRAPHQL_URL ??
  "https://indexer.us.hyperindex.xyz/e38a72a/v1/graphql";
const NEW_URL = process.env.NEW_GRAPHQL_URL;
if (!NEW_URL) {
  console.error(
    "NEW_GRAPHQL_URL is required (set OLD_GRAPHQL_URL to override the c9b8978 default).",
  );
  process.exit(1);
}

const CHAIN_IDS = [
  10, 8453, 34443, 1135, 252, 1750, 1868, 57073, 130, 42220, 1923, 5330,
] as const;

const POOLS_PER_CHAIN = 20;
const TOKENS_NONWL_PER_CHAIN = 100;
const USERS_PER_CHAIN = 50;
const NFPS_PER_NFPM = 100;
const VENFTS_PER_CHAIN = 500;

// Sub-cent negative totalLiquidityUSD exemption — accepted by the audit spec.
const NEG_TLU_EXEMPT: ReadonlySet<string> = new Set([
  `10-${toChecksumAddress("0xe132DAf3071d83d63B2D0A37919A91D1bD5e596c")}`,
  `8453-${toChecksumAddress("0x8Eea4BC2c84167ECF54Bef4d0bbd7eD0CE558686")}`,
]);

// Base NFPM at the centre of the #795 indexing-gap fix. This is the real
// on-chain NFPM paired with CLFactory 0x9592CD9B…d51B ("Another CL") — same
// address registered in config.yaml's Base NFPM block and CL_FACTORY_TO_NFPM
// (src/Constants.ts). Previously this constant held an unrelated dead address
// (no bytecode on Base), which caused the probe to always report 0 rows and
// fire a false-positive [BASE_NFPM_GAP_795] regression (#858).
const BASE_NFPM_795 = toChecksumAddress(
  "0xc741beb2156827704A1466575ccA1cBf726a1178",
);

// Metal Hyperlane domain that should map to chainId 1750 (#811).
const HYPERLANE_METAL_DOMAIN = 1_000_001_750n;

// ----------------------------------------------------------------------------
// ABIs (loaded lazily; only `getReserves` from Pool, `slot0` from CLPool, and
// an inline ERC20 `balanceOf` fragment are used)
// ----------------------------------------------------------------------------

type AbiFn = {
  type: "function";
  name: string;
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  stateMutability: string;
};

function loadAbi(filename: string): AbiFn[] {
  return JSON.parse(readFileSync(join(ABIS, filename), "utf-8")) as AbiFn[];
}

const POOL_ABI = loadAbi("Pool.json").filter(
  (x): x is AbiFn => x.type === "function" && x.name === "getReserves",
);
const ERC20_BALANCEOF = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ----------------------------------------------------------------------------
// GraphQL client (POST + fetch — no extra dep)
// ----------------------------------------------------------------------------

async function gql<T>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  // Hasura occasionally returns 5xx on expensive queries; retry transient
  // failures with backoff. Validation errors (4xx) and GraphQL errors fall
  // through immediately.
  const backoffsMs = [2_000, 5_000, 10_000, 20_000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const isTransient = res.status >= 500;
        const msg = `GraphQL HTTP ${res.status}: ${await res.text()}`;
        if (isTransient && attempt < backoffsMs.length) {
          lastErr = new Error(msg);
          await new Promise((r) => setTimeout(r, backoffsMs[attempt]));
          continue;
        }
        throw new Error(msg);
      }
      const body = (await res.json()) as { data?: T; errors?: unknown };
      if (body.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
      }
      if (!body.data) throw new Error("GraphQL: empty data");
      return body.data;
    } catch (err) {
      // Network-level failures (fetch rejection) are also worth retrying.
      const msg = err instanceof Error ? err.message : String(err);
      const isNetwork =
        msg.includes("fetch failed") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("UND_ERR");
      if (isNetwork && attempt < backoffsMs.length) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, backoffsMs[attempt]));
        continue;
      }
      throw err;
    }
  }
  if (lastErr instanceof Error) {
    throw lastErr;
  }
  throw new Error("gql: retries exhausted");
}

// ----------------------------------------------------------------------------
// Concurrency helper
// ----------------------------------------------------------------------------

async function mapConcurrent<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          out[idx] = await fn(items[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

// ----------------------------------------------------------------------------
// Findings model
// ----------------------------------------------------------------------------

type Classification =
  | "NEW_REGRESSION"
  | "EXPECTED_FIX"
  | "EXPECTED_MIGRATION"
  | "OPEN_GAP"
  | "PASS";

type Finding = {
  flag: string;
  classification: Classification;
  entity: string;
  chainId: number;
  entityId: string;
  oldValue?: string;
  newValue?: string;
  onchain?: string;
  note?: string;
};

const findings: Finding[] = [];

function record(f: Finding): void {
  if (f.classification !== "PASS") findings.push(f);
}

// ----------------------------------------------------------------------------
// Entity shapes (only the fields the audit reads)
// ----------------------------------------------------------------------------

type PoolRow = {
  id: string;
  chainId: number;
  poolAddress: string;
  name: string;
  isStable: boolean;
  isCL: boolean;
  reserve0: string;
  reserve1: string;
  totalLPTokenSupply: string;
  totalLiquidityUSD: string;
  totalVolume0: string;
  totalVolume1: string;
  totalVolumeUSD: string;
  totalFeesGenerated0: string;
  totalFeesGenerated1: string;
  totalFeesGeneratedUSD: string;
  totalStakedFeesCollected0: string;
  totalStakedFeesCollected1: string;
  token0_id: string;
  token1_id: string;
  token0_address: string;
  token1_address: string;
  token0Price: string;
  token1Price: string;
  totalEmissions: string;
  totalEmissionsUSD: string;
  currentFee: string;
  baseFee: string;
  currentLiquidityStaked: string;
  currentLiquidityStakedUSD: string;
  sqrtPriceX96: string | null;
  tick: string | null;
  liquidityInRange: string | null;
  stakedLiquidityInRange: string | null;
  stakedReserve0: string | null;
  stakedReserve1: string | null;
  tickEdges: string[];
  tickEdgeNets: string[];
  stakedTickEdges: string[];
  stakedTickEdgeNets: string[];
  feeCap: string | null;
  lastUpdatedTimestamp: string;
};

const POOL_FIELDS_COMMON = `
  id chainId poolAddress name isStable isCL
  reserve0 reserve1 totalLPTokenSupply totalLiquidityUSD
  totalVolume0 totalVolume1 totalVolumeUSD
  totalFeesGenerated0 totalFeesGenerated1 totalFeesGeneratedUSD
  totalStakedFeesCollected0 totalStakedFeesCollected1
  token0_id token1_id token0_address token1_address
  token0Price token1Price
  totalEmissions totalEmissionsUSD
  currentFee baseFee
  currentLiquidityStaked currentLiquidityStakedUSD
  sqrtPriceX96 tick liquidityInRange stakedLiquidityInRange
  stakedReserve0 stakedReserve1
  feeCap lastUpdatedTimestamp
`;
// Added by #808; absent from the c9b8978 OLD schema.
const POOL_FIELDS_NEW_ONLY = `
  tickEdges tickEdgeNets stakedTickEdges stakedTickEdgeNets
`;

type TokenRow = {
  id: string;
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: string;
  pricePerUSDNew: string;
  isWhitelisted: boolean;
  priceTrustOutcome: string | null;
  priceTrustReason: string | null;
  lastUpdatedTimestamp: string;
  lastSuccessfulPriceTimestamp: string | null;
};

const TOKEN_FIELDS = `
  id chainId address symbol name decimals
  pricePerUSDNew isWhitelisted
  priceTrustOutcome priceTrustReason
  lastUpdatedTimestamp lastSuccessfulPriceTimestamp
`;

type UserStatsRow = {
  id: string;
  chainId: number;
  userAddress: string;
  poolAddress: string;
  lpBalance: string;
  totalLiquidityAddedToken0: string;
  totalLiquidityAddedToken1: string;
  totalLiquidityRemovedToken0: string;
  totalLiquidityRemovedToken1: string;
  totalSwapVolumeUSD: string;
  numberOfSwaps: string;
  currentLiquidityStaked: string;
  currentLiquidityStakedUSD: string;
  almLpAmount: string;
};

const USER_FIELDS = `
  id chainId userAddress poolAddress
  lpBalance
  totalLiquidityAddedToken0 totalLiquidityAddedToken1
  totalLiquidityRemovedToken0 totalLiquidityRemovedToken1
  totalSwapVolumeUSD numberOfSwaps
  currentLiquidityStaked currentLiquidityStakedUSD
  almLpAmount
`;

type NfpRow = {
  id: string;
  chainId: number;
  tokenId: string;
  nfpmAddress: string;
  owner: string;
  pool: string;
  liquidity: string;
  isStakedInGauge: boolean;
};

const NFP_FIELDS = `
  id chainId tokenId nfpmAddress owner pool liquidity isStakedInGauge
`;

type VeNFTRow = {
  id: string;
  chainId: number;
  tokenId: string;
  owner: string;
  locktime: string;
  isPermanent: boolean;
  totalValueLocked: string;
  isAlive: boolean;
};

const VENFT_FIELDS = `
  id chainId tokenId owner locktime isPermanent totalValueLocked isAlive
`;

// ----------------------------------------------------------------------------
// Sampling
// ----------------------------------------------------------------------------

async function sampleTopPools(
  url: string,
  chainId: number,
  source: "OLD" | "NEW",
): Promise<PoolRow[]> {
  const fields =
    source === "NEW"
      ? `${POOL_FIELDS_COMMON} ${POOL_FIELDS_NEW_ONLY}`
      : POOL_FIELDS_COMMON;
  const q = `query($chainId: Int!, $limit: Int!) {
    Pool(
      where: { chainId: { _eq: $chainId } }
      order_by: { totalLiquidityUSD: desc }
      limit: $limit
    ) { ${fields} }
  }`;
  const data = await gql<{ Pool: PoolRow[] }>(url, q, {
    chainId,
    limit: POOLS_PER_CHAIN * 4, // headroom for category mixing
  });
  if (source === "OLD") {
    for (const p of data.Pool) {
      p.tickEdges ??= [];
      p.tickEdgeNets ??= [];
      p.stakedTickEdges ??= [];
      p.stakedTickEdgeNets ??= [];
    }
  }
  return data.Pool;
}

async function sampleWhitelistedTokens(
  url: string,
  chainId: number,
): Promise<TokenRow[]> {
  const q = `query($chainId: Int!) {
    Token(
      where: { chainId: { _eq: $chainId }, isWhitelisted: { _eq: true } }
    ) { ${TOKEN_FIELDS} }
  }`;
  const data = await gql<{ Token: TokenRow[] }>(url, q, { chainId });
  return data.Token;
}

async function sampleNonWhitelistedTokens(
  url: string,
  chainId: number,
): Promise<TokenRow[]> {
  const q = `query($chainId: Int!, $limit: Int!) {
    Token(
      where: { chainId: { _eq: $chainId }, isWhitelisted: { _eq: false } }
      order_by: { lastUpdatedTimestamp: desc }
      limit: $limit
    ) { ${TOKEN_FIELDS} }
  }`;
  const data = await gql<{ Token: TokenRow[] }>(url, q, {
    chainId,
    limit: TOKENS_NONWL_PER_CHAIN,
  });
  return data.Token;
}

async function sampleTopLPs(
  url: string,
  chainId: number,
): Promise<UserStatsRow[]> {
  const q = `query($chainId: Int!, $limit: Int!) {
    UserStatsPerPool(
      where: { chainId: { _eq: $chainId } }
      order_by: { lpBalance: desc }
      limit: $limit
    ) { ${USER_FIELDS} }
  }`;
  const data = await gql<{ UserStatsPerPool: UserStatsRow[] }>(url, q, {
    chainId,
    limit: USERS_PER_CHAIN,
  });
  return data.UserStatsPerPool;
}

async function sampleNFPsRecent(
  url: string,
  chainId: number,
): Promise<NfpRow[]> {
  const q = `query($chainId: Int!, $limit: Int!) {
    NonFungiblePosition(
      where: { chainId: { _eq: $chainId } }
      order_by: { lastUpdatedTimestamp: desc }
      limit: $limit
    ) { ${NFP_FIELDS} }
  }`;
  const data = await gql<{ NonFungiblePosition: NfpRow[] }>(url, q, {
    chainId,
    limit: NFPS_PER_NFPM,
  });
  return data.NonFungiblePosition;
}

async function countNFP795Probe(url: string): Promise<number> {
  // The Base NFPM 0xc741beb2 indexing gap (#795). Pull a single row to confirm
  // existence — counting is unnecessary if any row at all exists.
  const q = `query($nfpm: String!) {
    NonFungiblePosition(
      where: { chainId: { _eq: 8453 }, nfpmAddress: { _eq: $nfpm } }
      limit: 1
    ) { id }
  }`;
  const data = await gql<{ NonFungiblePosition: { id: string }[] }>(url, q, {
    nfpm: BASE_NFPM_795,
  });
  return data.NonFungiblePosition.length;
}

async function sampleVeNFTs(url: string, chainId: number): Promise<VeNFTRow[]> {
  const q = `query($chainId: Int!, $limit: Int!) {
    VeNFTState(
      where: { chainId: { _eq: $chainId }, isAlive: { _eq: true } }
      order_by: { lastUpdatedTimestamp: desc }
      limit: $limit
    ) { ${VENFT_FIELDS} }
  }`;
  const data = await gql<{ VeNFTState: VeNFTRow[] }>(url, q, {
    chainId,
    limit: VENFTS_PER_CHAIN,
  });
  return data.VeNFTState;
}

async function countSuperSwaps(url: string): Promise<number> {
  const q = "query { SuperSwap(limit: 1) { id destinationChainId } }";
  const data = await gql<{ SuperSwap: { id: string }[] }>(url, q);
  // We don't have aggregate available reliably; fetch 1 row first, then 100
  // for shape inspection if non-empty.
  if (data.SuperSwap.length === 0) return 0;
  const q2 = `query {
    SuperSwap(order_by: { timestamp: desc }, limit: 100) {
      id destinationChainId originChainId oUSDTamount
    }
  }`;
  const data2 = await gql<{ SuperSwap: { destinationChainId: string }[] }>(
    url,
    q2,
  );
  return data2.SuperSwap.length;
}

// ----------------------------------------------------------------------------
// Pool checks
// ----------------------------------------------------------------------------

function asBigInt(x: string | null | undefined, fallback = 0n): bigint {
  if (x == null || x === "") return fallback;
  return BigInt(x);
}

function recordIf(condition: boolean, f: Finding): void {
  if (condition) record(f);
}

function checkPoolInvariants(
  pool: PoolRow,
  oldPool: PoolRow | undefined,
  source: "NEW" | "OLD",
): void {
  const isNew = source === "NEW";
  const ent = `Pool/${source}`;

  // [NEG_RESERVE_GUARD] reserves must not be negative
  recordIf(asBigInt(pool.reserve0) < 0n, {
    flag: "[NEG_RESERVE_GUARD]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: pool.chainId,
    entityId: pool.id,
    newValue: pool.reserve0,
    note: "reserve0 < 0",
  });
  recordIf(asBigInt(pool.reserve1) < 0n, {
    flag: "[NEG_RESERVE_GUARD]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: pool.chainId,
    entityId: pool.id,
    newValue: pool.reserve1,
    note: "reserve1 < 0",
  });

  // totalLiquidityUSD >= 0 with the two-pool exemption
  const tluKey = `${pool.chainId}-${pool.poolAddress}`;
  if (!NEG_TLU_EXEMPT.has(tluKey)) {
    recordIf(asBigInt(pool.totalLiquidityUSD) < 0n, {
      flag: "[NEG_TLU]",
      classification: "NEW_REGRESSION",
      entity: ent,
      chainId: pool.chainId,
      entityId: pool.id,
      newValue: pool.totalLiquidityUSD,
      note: "totalLiquidityUSD < 0",
    });
  }

  // CL: stakedReserve_i <= reserve_i; stakedLiquidityInRange <= liquidityInRange
  if (pool.isCL) {
    if (pool.stakedReserve0 != null) {
      recordIf(asBigInt(pool.stakedReserve0) > asBigInt(pool.reserve0), {
        flag: "[NEG_STAKED_RESERVE_GUARD]",
        classification: "NEW_REGRESSION",
        entity: ent,
        chainId: pool.chainId,
        entityId: pool.id,
        newValue: pool.stakedReserve0,
        note: `stakedReserve0 > reserve0 (${pool.reserve0})`,
      });
    }
    if (pool.stakedReserve1 != null) {
      recordIf(asBigInt(pool.stakedReserve1) > asBigInt(pool.reserve1), {
        flag: "[NEG_STAKED_RESERVE_GUARD]",
        classification: "NEW_REGRESSION",
        entity: ent,
        chainId: pool.chainId,
        entityId: pool.id,
        newValue: pool.stakedReserve1,
        note: `stakedReserve1 > reserve1 (${pool.reserve1})`,
      });
    }
    if (pool.stakedLiquidityInRange != null && pool.liquidityInRange != null) {
      recordIf(
        asBigInt(pool.stakedLiquidityInRange) > asBigInt(pool.liquidityInRange),
        {
          flag: "[NEG_STAKED_LIQ_GUARD]",
          classification: "NEW_REGRESSION",
          entity: ent,
          chainId: pool.chainId,
          entityId: pool.id,
          newValue: pool.stakedLiquidityInRange,
          note: `stakedLiquidityInRange > liquidityInRange (${pool.liquidityInRange})`,
        },
      );
    }
  }

  // currentLiquidityStaked === 0n => currentLiquidityStakedUSD === 0n (#782)
  if (asBigInt(pool.currentLiquidityStaked) === 0n) {
    recordIf(asBigInt(pool.currentLiquidityStakedUSD) !== 0n, {
      flag: "[STAKED_USD_LOCKSTEP]",
      classification: "NEW_REGRESSION",
      entity: ent,
      chainId: pool.chainId,
      entityId: pool.id,
      newValue: pool.currentLiquidityStakedUSD,
      note: "currentLiquidityStaked=0 but USD != 0 (#782)",
    });
  }

  // Tick-array length parity
  recordIf(pool.tickEdges.length !== pool.tickEdgeNets.length, {
    flag: "[TICK_EDGE_DRIFT]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: pool.chainId,
    entityId: pool.id,
    note: `tickEdges.length=${pool.tickEdges.length} vs tickEdgeNets.length=${pool.tickEdgeNets.length}`,
  });
  recordIf(pool.stakedTickEdges.length !== pool.stakedTickEdgeNets.length, {
    flag: "[STAKED_TICK_DRIFT]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: pool.chainId,
    entityId: pool.id,
    note: `stakedTickEdges.length=${pool.stakedTickEdges.length} vs stakedTickEdgeNets.length=${pool.stakedTickEdgeNets.length}`,
  });

  // OLD vs NEW comparison (only when we have OLD for the same pool)
  if (oldPool && isNew) {
    // Volume monotonicity
    const checks: [string, bigint, bigint][] = [
      [
        "totalVolumeUSD",
        asBigInt(oldPool.totalVolumeUSD),
        asBigInt(pool.totalVolumeUSD),
      ],
      [
        "totalVolume0",
        asBigInt(oldPool.totalVolume0),
        asBigInt(pool.totalVolume0),
      ],
      [
        "totalVolume1",
        asBigInt(oldPool.totalVolume1),
        asBigInt(pool.totalVolume1),
      ],
    ];
    for (const [field, oldV, newV] of checks) {
      recordIf(newV < oldV, {
        flag: "[VOLUME_NONMONOTONIC]",
        classification: "NEW_REGRESSION",
        entity: ent,
        chainId: pool.chainId,
        entityId: pool.id,
        oldValue: oldV.toString(),
        newValue: newV.toString(),
        note: `${field} decreased (${oldV} -> ${newV})`,
      });
    }

    // currentFee/baseFee present on both
    const oldFee = asBigInt(oldPool.currentFee);
    const newFee = asBigInt(pool.currentFee);
    if (oldFee > 0n && newFee === 0n) {
      record({
        flag: "[FEE_DROPPED]",
        classification: "NEW_REGRESSION",
        entity: ent,
        chainId: pool.chainId,
        entityId: pool.id,
        oldValue: oldFee.toString(),
        newValue: newFee.toString(),
        note: "currentFee was non-zero on OLD, now 0",
      });
    }

    // #738: totalEmissionsUSD = 0 with totalEmissions > 0 is accepted only on
    // legacy pre-oracle pools. We don't ship the 188-row list inline; instead
    // we flag as OPEN_GAP only when BOTH deployments show the same condition
    // (true legacy) and as NEW_REGRESSION when OLD had a non-zero USD.
    const newEm = asBigInt(pool.totalEmissions);
    const newEmUSD = asBigInt(pool.totalEmissionsUSD);
    const oldEm = asBigInt(oldPool.totalEmissions);
    const oldEmUSD = asBigInt(oldPool.totalEmissionsUSD);
    if (newEm > 0n && newEmUSD === 0n) {
      if (oldEmUSD > 0n) {
        record({
          flag: "[EMISSIONS_USD_DROPPED]",
          classification: "NEW_REGRESSION",
          entity: ent,
          chainId: pool.chainId,
          entityId: pool.id,
          oldValue: oldEmUSD.toString(),
          newValue: newEmUSD.toString(),
          note: "totalEmissionsUSD was positive on OLD, now 0 (totalEmissions still positive)",
        });
      } else if (oldEm > 0n) {
        record({
          flag: "[EMISSIONS_USD_ZERO]",
          classification: "OPEN_GAP",
          entity: ent,
          chainId: pool.chainId,
          entityId: pool.id,
          oldValue: oldEmUSD.toString(),
          newValue: newEmUSD.toString(),
          note: "totalEmissionsUSD=0 on both (likely #738 legacy 188-pool list)",
        });
      }
    }

    // #810: V2 LP raw added/removed should be populated on NEW. We flag at
    // the UserStatsPerPool level — Pool-level cross-check is implicit.
  }
}

async function checkPoolOnchain(pool: PoolRow): Promise<void> {
  const chain = CHAIN_CONSTANTS[pool.chainId];
  if (!chain) return;
  const client = chain.eth_client;
  const addr = pool.poolAddress as `0x${string}`;

  try {
    if (!pool.isCL) {
      // V2 must equal getReserves() exactly (Sync-anchored)
      const result = (await client.readContract({
        address: addr,
        abi: POOL_ABI,
        functionName: "getReserves",
      })) as readonly [bigint, bigint, bigint];
      const [r0, r1] = result;
      const storedR0 = asBigInt(pool.reserve0);
      const storedR1 = asBigInt(pool.reserve1);
      if (storedR0 !== r0 || storedR1 !== r1) {
        record({
          flag: "[V2_RESERVE_MISMATCH]",
          classification: "NEW_REGRESSION",
          entity: "Pool/NEW",
          chainId: pool.chainId,
          entityId: pool.id,
          newValue: `${storedR0},${storedR1}`,
          onchain: `${r0},${r1}`,
          note: "V2 reserves diverge from getReserves() at latest block",
        });
      }
      return;
    }

    // CL static-fee: |reserve - (balanceOf - totalStakedFeesCollected)| / reserve <= 0.7%
    // We skip CL dynamic-fee (feeCap != null) — geometry-based now (#808).
    if (pool.feeCap != null) return;
    const [bal0, bal1] = await Promise.all([
      client.readContract({
        address: pool.token0_address as `0x${string}`,
        abi: ERC20_BALANCEOF,
        functionName: "balanceOf",
        args: [addr],
      }) as Promise<bigint>,
      client.readContract({
        address: pool.token1_address as `0x${string}`,
        abi: ERC20_BALANCEOF,
        functionName: "balanceOf",
        args: [addr],
      }) as Promise<bigint>,
    ]);
    const expected0 = bal0 - asBigInt(pool.totalStakedFeesCollected0);
    const expected1 = bal1 - asBigInt(pool.totalStakedFeesCollected1);
    const stored0 = asBigInt(pool.reserve0);
    const stored1 = asBigInt(pool.reserve1);
    const drift0 =
      expected0 === 0n
        ? 0n
        : absBI((stored0 - expected0) * 10000n) / absBI(expected0);
    const drift1 =
      expected1 === 0n
        ? 0n
        : absBI((stored1 - expected1) * 10000n) / absBI(expected1);
    // 0.7% = 70 / 10_000
    if (drift0 > 70n) {
      record({
        flag: "[CL_RESERVE_DRIFT]",
        classification: "NEW_REGRESSION",
        entity: "Pool/NEW",
        chainId: pool.chainId,
        entityId: pool.id,
        newValue: stored0.toString(),
        onchain: expected0.toString(),
        note: `reserve0 drift ${(Number(drift0) / 100).toFixed(2)}% (>0.7%)`,
      });
    }
    if (drift1 > 70n) {
      record({
        flag: "[CL_RESERVE_DRIFT]",
        classification: "NEW_REGRESSION",
        entity: "Pool/NEW",
        chainId: pool.chainId,
        entityId: pool.id,
        newValue: stored1.toString(),
        onchain: expected1.toString(),
        note: `reserve1 drift ${(Number(drift1) / 100).toFixed(2)}% (>0.7%)`,
      });
    }
  } catch (err) {
    // RPC errors are not classified as regressions; record a NOTE row only.
    record({
      flag: "[ONCHAIN_RPC_ERROR]",
      classification: "OPEN_GAP",
      entity: "Pool/NEW",
      chainId: pool.chainId,
      entityId: pool.id,
      note: `RPC failure: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function absBI(x: bigint): bigint {
  return x < 0n ? -x : x;
}

// ----------------------------------------------------------------------------
// Token checks
// ----------------------------------------------------------------------------

const PRICE_CEILING_1M = 10n ** 24n; // $1M scaled by 1e18
const PRICE_INFLATED = 10n ** 28n;

function checkTokenInvariants(
  tok: TokenRow,
  oldTok: TokenRow | undefined,
  source: "NEW" | "OLD",
): void {
  const isNew = source === "NEW";
  const ent = `Token/${source}`;
  const price = asBigInt(tok.pricePerUSDNew);

  recordIf(price > PRICE_INFLATED, {
    flag: "[PRICE_INFLATED]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: tok.chainId,
    entityId: tok.id,
    newValue: price.toString(),
    note: "pricePerUSDNew > 1e28 — inflated; blacklist candidate",
  });
  if (price <= PRICE_INFLATED) {
    recordIf(price > PRICE_CEILING_1M, {
      flag: "[PRICE_OVER_1M]",
      classification: "NEW_REGRESSION",
      entity: ent,
      chainId: tok.chainId,
      entityId: tok.id,
      newValue: price.toString(),
      note: "pricePerUSDNew > $1M (#788)",
    });
  }

  // priceTrustOutcome lockstep with isWhitelisted (#761).
  // Whitelisted tokens must be trusted; non-whitelisted may be trusted or not.
  if (tok.isWhitelisted && tok.priceTrustOutcome != null) {
    if (
      tok.priceTrustOutcome !== "trusted" &&
      tok.priceTrustOutcome !== "TRUSTED"
    ) {
      record({
        flag: "[WHITELIST_TRUST_DRIFT]",
        classification: "NEW_REGRESSION",
        entity: ent,
        chainId: tok.chainId,
        entityId: tok.id,
        newValue: tok.priceTrustOutcome,
        note: "Whitelisted but priceTrustOutcome != trusted (#761)",
      });
    }
  }

  // priceTrustOutcome should be non-null. We can't reliably detect "pre-field"
  // rows without an explicit cutoff, so we report as OPEN_GAP rather than
  // NEW_REGRESSION when both OLD and NEW are null.
  if (tok.priceTrustOutcome == null) {
    if (!oldTok || oldTok.priceTrustOutcome == null) {
      record({
        flag: "[PRICE_TRUST_NULL]",
        classification: "OPEN_GAP",
        entity: ent,
        chainId: tok.chainId,
        entityId: tok.id,
        note: "priceTrustOutcome=null on both (likely pre-field row)",
      });
    } else {
      record({
        flag: "[PRICE_TRUST_NULLED]",
        classification: "NEW_REGRESSION",
        entity: ent,
        chainId: tok.chainId,
        entityId: tok.id,
        oldValue: oldTok.priceTrustOutcome,
        newValue: "null",
        note: "priceTrustOutcome regressed null on NEW",
      });
    }
  }

  // Token-metadata heal (#820): symbol AND name both empty is the fingerprint.
  if (
    (tok.symbol === "" || tok.symbol == null) &&
    (tok.name === "" || tok.name == null)
  ) {
    record({
      flag: "[METADATA_BOTH_EMPTY]",
      classification: "NEW_REGRESSION",
      entity: ent,
      chainId: tok.chainId,
      entityId: tok.id,
      note: "symbol AND name both empty (#820 heal-on-read should populate)",
    });
  }

  // OLD vs NEW (whitelisted spike detector)
  if (oldTok && isNew && tok.isWhitelisted) {
    const oldPrice = asBigInt(oldTok.pricePerUSDNew);
    if (oldPrice > 0n && price > 0n) {
      // 10x or 0.1x spike
      const ratioUp = price * 10n >= oldPrice * 100n; // price/old >= 10
      const ratioDown = price * 100n <= oldPrice * 10n; // price/old <= 0.1
      if (ratioUp || ratioDown) {
        record({
          flag: "[PRICE_SPIKE]",
          classification: "NEW_REGRESSION",
          entity: ent,
          chainId: tok.chainId,
          entityId: tok.id,
          oldValue: oldPrice.toString(),
          newValue: price.toString(),
          note: ratioUp
            ? "whitelisted ≥ 10× jump up"
            : "whitelisted ≤ 10× drop",
        });
      }
    }

    // lastSuccessfulPriceTimestamp monotonic (whitelisted only)
    if (
      oldTok.lastSuccessfulPriceTimestamp &&
      tok.lastSuccessfulPriceTimestamp
    ) {
      if (
        Date.parse(tok.lastSuccessfulPriceTimestamp) <
        Date.parse(oldTok.lastSuccessfulPriceTimestamp)
      ) {
        record({
          flag: "[PRICE_FRESHNESS_REGRESS]",
          classification: "NEW_REGRESSION",
          entity: ent,
          chainId: tok.chainId,
          entityId: tok.id,
          oldValue: oldTok.lastSuccessfulPriceTimestamp,
          newValue: tok.lastSuccessfulPriceTimestamp,
          note: "lastSuccessfulPriceTimestamp regressed",
        });
      }
    }
  }
}

// ----------------------------------------------------------------------------
// UserStatsPerPool checks
// ----------------------------------------------------------------------------

function checkUserStatsInvariants(
  u: UserStatsRow,
  oldU: UserStatsRow | undefined,
  source: "NEW" | "OLD",
  v2Pools: Set<string>,
): void {
  const isNew = source === "NEW";
  const ent = `UserStatsPerPool/${source}`;

  recordIf(asBigInt(u.lpBalance) < 0n, {
    flag: "[NEG_LP_BALANCE_GUARD]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: u.chainId,
    entityId: u.id,
    newValue: u.lpBalance,
  });
  recordIf(asBigInt(u.almLpAmount) < 0n, {
    flag: "[NEG_ALM_LP_AMOUNT_GUARD]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: u.chainId,
    entityId: u.id,
    newValue: u.almLpAmount,
  });
  recordIf(asBigInt(u.currentLiquidityStaked) < 0n, {
    flag: "[NEG_STAKED_USER]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: u.chainId,
    entityId: u.id,
    newValue: u.currentLiquidityStaked,
  });
  recordIf(asBigInt(u.currentLiquidityStakedUSD) < 0n, {
    flag: "[NEG_STAKED_USER]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: u.chainId,
    entityId: u.id,
    newValue: u.currentLiquidityStakedUSD,
  });

  // #810: V2 LPs with lpBalance > 0 should have non-zero added token0/1 on NEW.
  if (isNew && asBigInt(u.lpBalance) > 0n) {
    const poolKey = `${u.chainId}-${u.poolAddress}`;
    if (v2Pools.has(poolKey)) {
      const added0 = asBigInt(u.totalLiquidityAddedToken0);
      const added1 = asBigInt(u.totalLiquidityAddedToken1);
      if (added0 === 0n && added1 === 0n) {
        record({
          flag: "[V2_LP_RAW_UNPOPULATED]",
          classification: "NEW_REGRESSION",
          entity: ent,
          chainId: u.chainId,
          entityId: u.id,
          newValue: `${added0},${added1}`,
          note: "V2 LP with lpBalance>0 has totalLiquidityAddedToken0/1=0 (#810 fix should populate)",
        });
      }
    }
  }
}

// ----------------------------------------------------------------------------
// NonFungiblePosition checks
// ----------------------------------------------------------------------------

function checkNfp(nfp: NfpRow, source: "NEW" | "OLD"): void {
  const ent = `NonFungiblePosition/${source}`;
  recordIf(asBigInt(nfp.liquidity) < 0n, {
    flag: "[NEG_NFP_LIQUIDITY_GUARD]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: nfp.chainId,
    entityId: nfp.id,
    newValue: nfp.liquidity,
  });
}

// ----------------------------------------------------------------------------
// VeNFTState checks
// ----------------------------------------------------------------------------

function checkVeNFT(v: VeNFTRow, source: "NEW" | "OLD"): void {
  const ent = `VeNFTState/${source}`;
  recordIf(asBigInt(v.totalValueLocked) < 0n, {
    flag: "[NEG_VENFT_TVL_GUARD]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: v.chainId,
    entityId: v.id,
    newValue: v.totalValueLocked,
  });
  recordIf(v.isPermanent && asBigInt(v.locktime) !== 0n, {
    flag: "[VENFT_LOCKSTATE_INVARIANT]",
    classification: "NEW_REGRESSION",
    entity: ent,
    chainId: v.chainId,
    entityId: v.id,
    newValue: v.locktime,
    note: "isPermanent=true but locktime != 0 (#776/#778)",
  });
}

// ----------------------------------------------------------------------------
// Report rendering
// ----------------------------------------------------------------------------

type SampleCounts = {
  oldPools: number;
  newPools: number;
  oldTokens: number;
  newTokens: number;
  oldUsers: number;
  newUsers: number;
  oldNfps: number;
  newNfps: number;
  oldVeNFTs: number;
  newVeNFTs: number;
  oldSuperSwaps: number;
  newSuperSwaps: number;
  base795Probe: number;
};

function cell(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  // Markdown tables only support inline cell content; collapse embedded
  // newlines (common in viem RPC error notes) and escape pipes so a single
  // logical row stays on one physical line.
  return v
    .replace(/\r?\n/g, " <br> ")
    .replace(/\s{2,}/g, " ")
    .replace(/\|/g, "\\|");
}

function renderReport(counts: SampleCounts): string {
  const byClass: Record<Classification, Finding[]> = {
    NEW_REGRESSION: [],
    EXPECTED_FIX: [],
    EXPECTED_MIGRATION: [],
    OPEN_GAP: [],
    PASS: [],
  };
  for (const f of findings) byClass[f.classification].push(f);

  const lines: string[] = [];
  lines.push("# Integrity audit: NEW vs c9b8978");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`- OLD: \`${OLD_URL}\``);
  lines.push(`- NEW: \`${NEW_URL}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `- Pools sampled: NEW ${counts.newPools} (OLD ${counts.oldPools})`,
  );
  lines.push(
    `- Tokens sampled: NEW ${counts.newTokens} (OLD ${counts.oldTokens})`,
  );
  lines.push(
    `- UserStatsPerPool sampled: NEW ${counts.newUsers} (OLD ${counts.oldUsers})`,
  );
  lines.push(
    `- NonFungiblePosition sampled: NEW ${counts.newNfps} (OLD ${counts.oldNfps})`,
  );
  lines.push(
    `- VeNFTState sampled: NEW ${counts.newVeNFTs} (OLD ${counts.oldVeNFTs})`,
  );
  lines.push(
    `- SuperSwap rows seen: NEW ${counts.newSuperSwaps} (OLD ${counts.oldSuperSwaps})`,
  );
  lines.push(
    `- Base NFPM \`${BASE_NFPM_795}\` row count probe (NEW): ${counts.base795Probe > 0 ? "≥1 (passes #795)" : "0 (FAILS #795)"}`,
  );
  lines.push("");
  lines.push("| classification | count |");
  lines.push("| --- | --- |");
  for (const k of [
    "NEW_REGRESSION",
    "EXPECTED_FIX",
    "EXPECTED_MIGRATION",
    "OPEN_GAP",
  ] as Classification[]) {
    lines.push(`| ${k} | ${byClass[k].length} |`);
  }
  lines.push("");

  for (const cls of [
    "NEW_REGRESSION",
    "EXPECTED_FIX",
    "EXPECTED_MIGRATION",
    "OPEN_GAP",
  ] as Classification[]) {
    lines.push(`## ${cls}`);
    lines.push("");
    if (byClass[cls].length === 0) {
      lines.push("_None_.");
      lines.push("");
      continue;
    }
    const byFlag = new Map<string, Finding[]>();
    for (const f of byClass[cls]) {
      const arr = byFlag.get(f.flag) ?? [];
      arr.push(f);
      byFlag.set(f.flag, arr);
    }
    for (const [flag, group] of [...byFlag.entries()].sort()) {
      lines.push(`### ${flag} (${group.length})`);
      lines.push("");
      lines.push("| chain | entityId | oldValue | newValue | onchain | note |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const f of group.slice(0, 100)) {
        lines.push(
          `| ${f.chainId} | \`${f.entityId}\` | ${cell(f.oldValue)} | ${cell(f.newValue)} | ${cell(f.onchain)} | ${cell(f.note)} |`,
        );
      }
      if (group.length > 100) {
        lines.push("");
        lines.push(`_…and ${group.length - 100} more._`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.id, r);
  return m;
}

async function main(): Promise<void> {
  process.stderr.write(`OLD: ${OLD_URL}\n`);
  process.stderr.write(`NEW: ${NEW_URL}\n`);

  const counts: SampleCounts = {
    oldPools: 0,
    newPools: 0,
    oldTokens: 0,
    newTokens: 0,
    oldUsers: 0,
    newUsers: 0,
    oldNfps: 0,
    newNfps: 0,
    oldVeNFTs: 0,
    newVeNFTs: 0,
    oldSuperSwaps: 0,
    newSuperSwaps: 0,
    base795Probe: 0,
  };

  // Probes that don't need per-chain iteration
  process.stderr.write("\n[probe] SuperSwap counts...\n");
  const [oldSS, newSS] = await Promise.all([
    countSuperSwaps(OLD_URL),
    countSuperSwaps(NEW_URL),
  ]);
  counts.oldSuperSwaps = oldSS;
  counts.newSuperSwaps = newSS;
  if (newSS === 0 && oldSS === 0) {
    record({
      flag: "[SUPERSWAP_EMPTY]",
      classification: "OPEN_GAP",
      entity: "SuperSwap/NEW",
      chainId: 0,
      entityId: "*",
      note: "SuperSwap table empty on both deployments (#707 stitch gap still open)",
    });
  } else if (newSS === 0 && oldSS > 0) {
    record({
      flag: "[SUPERSWAP_REGRESSED]",
      classification: "NEW_REGRESSION",
      entity: "SuperSwap/NEW",
      chainId: 0,
      entityId: "*",
      oldValue: oldSS.toString(),
      newValue: "0",
      note: "SuperSwap rows present on OLD, empty on NEW",
    });
  } else if (newSS > 0 && oldSS === 0) {
    record({
      flag: "[SUPERSWAP_RECOVERED]",
      classification: "EXPECTED_FIX",
      entity: "SuperSwap/NEW",
      chainId: 0,
      entityId: "*",
      oldValue: "0",
      newValue: newSS.toString(),
      note: "SuperSwap rows now exist (#707 stitch closed)",
    });
  }

  process.stderr.write("[probe] Base NFPM 0xc741beb2 (#795)...\n");
  counts.base795Probe = await countNFP795Probe(NEW_URL);
  if (counts.base795Probe === 0) {
    record({
      flag: "[BASE_NFPM_GAP_795]",
      classification: "NEW_REGRESSION",
      entity: "NonFungiblePosition/NEW",
      chainId: 8453,
      entityId: BASE_NFPM_795,
      note: "Base NFPM 0xc741beb2 still has zero rows on NEW (#795 should have populated)",
    });
  }

  // Per-chain sweep
  for (const chainId of CHAIN_IDS) {
    process.stderr.write(`\n[chain ${chainId}]\n`);

    process.stderr.write("  fetching pools (OLD/NEW)...\n");
    const [oldPools, newPools] = await Promise.all([
      sampleTopPools(OLD_URL, chainId, "OLD"),
      sampleTopPools(NEW_URL, chainId, "NEW"),
    ]);
    counts.oldPools += oldPools.length;
    counts.newPools += newPools.length;

    const oldPoolById = indexById(oldPools);
    const v2Pools = new Set(
      newPools
        .filter((p) => !p.isCL)
        .map((p) => `${p.chainId}-${p.poolAddress}`),
    );

    // Run pool invariants
    for (const p of newPools) {
      checkPoolInvariants(p, oldPoolById.get(p.id), "NEW");
    }
    for (const p of oldPools) {
      checkPoolInvariants(p, undefined, "OLD");
    }

    // On-chain checks for NEW pools (subset: 10 V2 + 10 CL static-fee)
    const v2Sample = newPools.filter((p) => !p.isCL).slice(0, 10);
    const clStaticSample = newPools
      .filter((p) => p.isCL && p.feeCap == null)
      .slice(0, 10);
    const onchainSample = [...v2Sample, ...clStaticSample];
    if (onchainSample.length > 0) {
      process.stderr.write(
        `  on-chain check (${onchainSample.length} pools)...\n`,
      );
      await mapConcurrent(onchainSample, 5, async (p) => {
        await checkPoolOnchain(p);
      });
    }

    process.stderr.write("  fetching tokens...\n");
    const [oldWl, newWl] = await Promise.all([
      sampleWhitelistedTokens(OLD_URL, chainId),
      sampleWhitelistedTokens(NEW_URL, chainId),
    ]);
    const [oldNonWl, newNonWl] = await Promise.all([
      sampleNonWhitelistedTokens(OLD_URL, chainId),
      sampleNonWhitelistedTokens(NEW_URL, chainId),
    ]);
    const oldTokens = [...oldWl, ...oldNonWl];
    const newTokens = [...newWl, ...newNonWl];
    counts.oldTokens += oldTokens.length;
    counts.newTokens += newTokens.length;
    const oldTokenById = indexById(oldTokens);
    for (const t of newTokens) {
      checkTokenInvariants(t, oldTokenById.get(t.id), "NEW");
    }
    for (const t of oldTokens) {
      checkTokenInvariants(t, undefined, "OLD");
    }

    process.stderr.write("  fetching user stats...\n");
    const [oldUsers, newUsers] = await Promise.all([
      sampleTopLPs(OLD_URL, chainId),
      sampleTopLPs(NEW_URL, chainId),
    ]);
    counts.oldUsers += oldUsers.length;
    counts.newUsers += newUsers.length;
    const oldUserById = indexById(oldUsers);
    for (const u of newUsers) {
      checkUserStatsInvariants(u, oldUserById.get(u.id), "NEW", v2Pools);
    }
    for (const u of oldUsers) {
      checkUserStatsInvariants(u, undefined, "OLD", v2Pools);
    }

    process.stderr.write("  fetching NFPs...\n");
    const [oldNfps, newNfps] = await Promise.all([
      sampleNFPsRecent(OLD_URL, chainId),
      sampleNFPsRecent(NEW_URL, chainId),
    ]);
    counts.oldNfps += oldNfps.length;
    counts.newNfps += newNfps.length;
    for (const n of newNfps) checkNfp(n, "NEW");
    for (const n of oldNfps) checkNfp(n, "OLD");

    if (chainId === 10 || chainId === 8453) {
      process.stderr.write("  fetching veNFTs...\n");
      const [oldVe, newVe] = await Promise.all([
        sampleVeNFTs(OLD_URL, chainId),
        sampleVeNFTs(NEW_URL, chainId),
      ]);
      counts.oldVeNFTs += oldVe.length;
      counts.newVeNFTs += newVe.length;
      for (const v of newVe) checkVeNFT(v, "NEW");
      for (const v of oldVe) checkVeNFT(v, "OLD");
    }
  }

  // Hyperlane Metal domain → chainId mapping (#811). Only meaningful when
  // SuperSwap is non-empty on NEW.
  if (counts.newSuperSwaps > 0) {
    process.stderr.write(
      "\n[probe] SuperSwap Metal domain mapping (#811)...\n",
    );
    const q = `query {
      SuperSwap(
        where: { destinationChainId: { _eq: "${HYPERLANE_METAL_DOMAIN}" } }
        limit: 1
      ) { id destinationChainId }
    }`;
    const data = await gql<{
      SuperSwap: { id: string; destinationChainId: string }[];
    }>(NEW_URL, q);
    if (data.SuperSwap.length > 0) {
      record({
        flag: "[METAL_DOMAIN_UNMAPPED]",
        classification: "NEW_REGRESSION",
        entity: "SuperSwap/NEW",
        chainId: 1750,
        entityId: data.SuperSwap[0].id,
        newValue: data.SuperSwap[0].destinationChainId,
        note: `Hyperlane Metal domain ${HYPERLANE_METAL_DOMAIN} stored unmapped — should be 1750 (#811)`,
      });
    }
  }

  process.stderr.write(`\n[done] ${findings.length} findings\n`);
  process.stdout.write(renderReport(counts));
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(
    `\nFATAL: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
