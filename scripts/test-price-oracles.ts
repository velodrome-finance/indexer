/**
 * Price Oracle Test Suite
 *
 * Tests each oracle version (V1-V4) across all chains using viem RPC calls.
 * Cross-references results with CoinGecko for price verification.
 * Saves results to scripts/results/ (git-ignored) and caches by timestamp.
 *
 * Usage:
 *   npx tsx scripts/test-price-oracles.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  type PublicClient,
  createPublicClient,
  http,
  type Chain,
} from "viem";
import {
  base,
  optimism,
  lisk,
  mode,
  celo,
  fraxtal,
  ink,
  soneium,
  unichain,
} from "viem/chains";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
config({ path: join(__dirname, "..", ".env") });

// Results directory
const RESULTS_DIR = join(__dirname, "results", "price-oracle-tests");
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// CoinGecko cache file
const CG_CACHE_PATH = join(RESULTS_DIR, "coingecko-cache.json");
let cgCache: Record<string, number> = {};
if (existsSync(CG_CACHE_PATH)) {
  try {
    cgCache = JSON.parse(readFileSync(CG_CACHE_PATH, "utf-8"));
  } catch { /* fresh cache */ }
}

function saveCgCache() {
  writeFileSync(CG_CACHE_PATH, JSON.stringify(cgCache, null, 2));
}

// Custom chain definitions for chains not in viem
const metalL2: Chain = {
  id: 1750,
  name: "Metal L2",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://metall2.drpc.org"] } },
};

const swellchain: Chain = {
  id: 1923,
  name: "Swell",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.ankr.com/swell"] } },
};

// ============================================================================
// Config
// ============================================================================

interface OracleVersionConfig {
  version: string;
  address: string;
  blocks: (number | "latest")[];
  type: "v1v2" | "v3v4";
}

interface ChainTestConfig {
  name: string;
  chain: Chain;
  rpcUrl: string;
  token: string;
  tokenName: string;
  destinationToken: string;
  destinationTokenDecimals: number;
  weth: string;
  systemToken: string;
  connectors: string[];
  oracles: OracleVersionConfig[];
  cgId: string | null;
}

const chains: ChainTestConfig[] = [
  // ===== BASE (AERO) =====
  {
    name: "Base",
    chain: base,
    rpcUrl: process.env.ENVIO_BASE_RPC_URL!,
    token: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    tokenName: "AERO",
    destinationToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    destinationTokenDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    connectors: [
      "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      "0x4621b7a9c75199271f773ebd9a499dbd165c3191",
      "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
      "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
      "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
      "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
    ],
    cgId: "aerodrome-finance",
    oracles: [
      { version: "V1", address: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE", blocks: [15_000_000, 17_000_000, 18_400_000], type: "v1v2" },
      { version: "V2", address: "0xcbf5b6abf55fb87271338097fdd03e9d82a9d63f", blocks: [18_600_000, 19_200_000, 19_800_000], type: "v1v2" },
      { version: "V3", address: "0x3B06c787711ecb5624cE65AC8F26cde10831eb0C", blocks: [22_000_000, 28_000_000, 37_000_000], type: "v3v4" },
      { version: "V4", address: "0x8456038bdae8672f552182B0FC39b1917dE9a41A", blocks: [38_000_000, 40_000_000, "latest"], type: "v3v4" },
    ],
  },

  // ===== OPTIMISM (VELO) =====
  {
    name: "Optimism",
    chain: optimism,
    rpcUrl: process.env.ENVIO_OPTIMISM_RPC_URL!,
    token: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    tokenName: "VELO",
    destinationToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    destinationTokenDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    connectors: [
      "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
      "0x4200000000000000000000000000000000000042",
      "0x9bcef72be871e61ed4fbbc7630889bee758eb81d",
      "0x2e3d870790dc77a83dd1d18184acc7439a53f475",
      "0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9",
      "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb",
      "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      "0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40",
      "0xc40f949f8a4e094d1b49a23ea9241d289b7b2819",
      "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
      "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
      "0x4200000000000000000000000000000000000006",
      "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
      "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    ],
    cgId: "velodrome-finance",
    oracles: [
      { version: "V1", address: "0x395942C2049604a314d39F370Dfb8D87AAC89e16", blocks: [115_000_000, 120_000_000, 124_000_000], type: "v1v2" },
      { version: "V2", address: "0x6a3af44e23395d2470f7c81331add6ede8597306", blocks: [124_200_000, 124_800_000, 125_400_000], type: "v1v2" },
      { version: "V3", address: "0x59114D308C6DE4A84F5F8cD80485a5481047b99f", blocks: [126_000_000, 128_000_000, "latest"], type: "v3v4" },
    ],
  },

  // ===== SUPERCHAIN (XVELO) =====
  ...[
    { name: "Lisk", chain: lisk, rpcUrl: process.env.ENVIO_LISK_RPC_URL!, oracle: "0x024503003fFE9AF285f47c1DaAaA497D9f1166D0", destinationToken: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", destinationTokenDecimals: 6, weth: "0x4200000000000000000000000000000000000006", connectors: ["0x05D032ac25d322df992303dCa074EE7392C117b9", "0xF242275d3a6527d877f2c927a82D9b057609cc71", "0x4200000000000000000000000000000000000006", "0xac485391EB2d7D88253a7F1eF18C37f4242D1A24", "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81"] },
    { name: "Mode", chain: mode, rpcUrl: process.env.ENVIO_MODE_RPC_URL!, oracle: "0xbAEe949B52cb503e39f1Df54Dcee778da59E11bc", destinationToken: "0xd988097fb8612cc24eeC14542bC03424c656005f", destinationTokenDecimals: 6, weth: "0x4200000000000000000000000000000000000006", connectors: ["0x4200000000000000000000000000000000000006", "0xDfc7C877a950e49D2610114102175A06C2e3167a", "0xd988097fb8612cc24eeC14542bC03424c656005f", "0xf0F161fDA2712DB8b566946122a5af183995e2eD", "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"] },
    { name: "Celo", chain: celo, rpcUrl: process.env.ENVIO_CELO_RPC_URL!, oracle: "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327", destinationToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", destinationTokenDecimals: 6, weth: "0x4200000000000000000000000000000000000006", connectors: ["0xD221812de1BD094f35587EE8E174B07B6167D9Af", "0x471EcE3750Da237f93B8E339c536989b8978a438", "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81", "0xef4229c8c3250C675F21BCefa42f58EfbfF6002a", "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189"] },
    { name: "Soneium", chain: soneium, rpcUrl: process.env.ENVIO_SONEIUM_RPC_URL!, oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE", destinationToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369", destinationTokenDecimals: 6, weth: "0x4200000000000000000000000000000000000006", connectors: ["0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369", "0x4200000000000000000000000000000000000006", "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81", "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189"] },
    { name: "Ink", chain: ink, rpcUrl: process.env.ENVIO_INK_RPC_URL!, oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE", destinationToken: "0xF1815bd50389c46847f0Bda824eC8da914045D14", destinationTokenDecimals: 6, weth: "0x4200000000000000000000000000000000000006", connectors: ["0xF1815bd50389c46847f0Bda824eC8da914045D14", "0x4200000000000000000000000000000000000006", "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81", "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"] },
    { name: "Metal", chain: metalL2, rpcUrl: process.env.ENVIO_METAL_RPC_URL!, oracle: "0x3e71CCdf495d9628D3655A600Bcad3afF2ddea98", destinationToken: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", destinationTokenDecimals: 6, weth: "0x4200000000000000000000000000000000000006", connectors: ["0xb91CFCcA485C6E40E3bC622f9BFA02a8ACdEeBab", "0x4200000000000000000000000000000000000006", "0xBCFc435d8F276585f6431Fc1b9EE9A850B5C00A9", "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81"] },
    { name: "Unichain", chain: unichain, rpcUrl: process.env.ENVIO_UNICHAIN_RPC_URL!, oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE", destinationToken: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", destinationTokenDecimals: 6, weth: "0x4200000000000000000000000000000000000006", connectors: ["0x4200000000000000000000000000000000000006", "0x078D782b760474a361dDA0AF3839290b0EF57AD6", "0x588CE4F028D8e7B53B687865d6A67b3A54C75518", "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81", "0x8f187aA05619a017077f5308904739877ce9eA21", "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189"] },
    { name: "Fraxtal", chain: fraxtal, rpcUrl: process.env.ENVIO_FRAXTAL_RPC_URL!, oracle: "0x4817f8D70aE32Ee96e5E6BFA24eb7Fcfa83bbf29", destinationToken: "0xFc00000000000000000000000000000000000001", destinationTokenDecimals: 18, weth: "0xFC00000000000000000000000000000000000006", connectors: ["0xFC00000000000000000000000000000000000005", "0xFC00000000000000000000000000000000000006", "0xFc00000000000000000000000000000000000001", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2", "0xDcc0F2D8F90FDe85b10aC1c8Ab57dc0AE946A543", "0x4200000000000000000000000000000000000006", "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189"] },
    { name: "Swell", chain: swellchain, rpcUrl: process.env.ENVIO_SWELL_RPC_URL!, oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE", destinationToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", destinationTokenDecimals: 18, weth: "0x4200000000000000000000000000000000000006", connectors: ["0x4200000000000000000000000000000000000006", "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", "0x0000bAa0b1678229863c0A941C1056b83a1955F5", "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189", "0x99a38322cAF878Ef55AE4d0Eda535535eF8C7960"] },
  ].map((sc): ChainTestConfig => ({
    name: sc.name,
    chain: sc.chain,
    rpcUrl: sc.rpcUrl,
    token: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81", // XVELO
    tokenName: "XVELO",
    destinationToken: sc.destinationToken,
    destinationTokenDecimals: sc.destinationTokenDecimals,
    weth: sc.weth,
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: sc.connectors,
    cgId: null, // XVELO not on CoinGecko
    oracles: [
      { version: "V3", address: sc.oracle, blocks: ["latest", -50_000, -100_000], type: "v3v4" },
    ],
  })),
];

// ============================================================================
// ABIs
// ============================================================================

const V1V2_ABI = [
  {
    inputs: [
      { name: "src_len", type: "uint8" },
      { name: "connectors", type: "address[]" },
    ],
    name: "getManyRatesWithConnectors",
    outputs: [{ name: "rates", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const V3V4_ABI = [
  {
    inputs: [
      { name: "srcTokens", type: "address[]" },
      { name: "dstToken", type: "address" },
      { name: "useWrappers", type: "bool" },
      { name: "customConnectors", type: "address[]" },
      { name: "thresholdFilter", type: "uint256" },
    ],
    name: "getManyRatesWithCustomConnectors",
    outputs: [{ name: "weightedRates", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ============================================================================
// Types
// ============================================================================

interface OracleResult {
  chain: string;
  token: string;
  version: string;
  block: string;
  oracleAddr: string;
  rawRate: string;
  priceUsd: number;
  timestamp: number;
  cgPrice: number | null;
  deviation: number | null;
  status: string;
  error?: string;
}

// ============================================================================
// Oracle call functions
// ============================================================================

async function callV3V4(
  client: PublicClient,
  config: ChainTestConfig,
  oracleAddr: string,
  blockNumber: bigint | undefined,
): Promise<{ raw: bigint; price: number }> {
  const customConnectors = [
    ...config.connectors,
    config.systemToken,
    config.weth,
    config.destinationToken,
  ] as `0x${string}`[];

  const result = await client.readContract({
    address: oracleAddr as `0x${string}`,
    abi: V3V4_ABI,
    functionName: "getManyRatesWithCustomConnectors",
    args: [
      [config.token as `0x${string}`],
      config.destinationToken as `0x${string}`,
      false,
      customConnectors,
      10n,
    ],
    blockNumber,
  });

  const raw = result[0];
  // V3/V4 returns price in destination token's decimals
  const price = Number(raw) / 10 ** config.destinationTokenDecimals;
  return { raw, price };
}

async function callV1V2(
  client: PublicClient,
  config: ChainTestConfig,
  oracleAddr: string,
  blockNumber: bigint,
): Promise<{ raw: bigint; price: number }> {
  const connectorsArray = [
    config.token,
    ...config.connectors,
    config.systemToken,
    config.weth,
    config.destinationToken,
  ] as `0x${string}`[];

  const result = await client.readContract({
    address: oracleAddr as `0x${string}`,
    abi: V1V2_ABI,
    functionName: "getManyRatesWithConnectors",
    args: [1, connectorsArray],
    blockNumber,
  });

  const raw = result[0];
  // V1/V2 returns price in 1e18 scale
  const price = Number(raw) / 1e18;
  return { raw, price };
}

// ============================================================================
// CoinGecko with caching and rate limiting
// ============================================================================

let lastCgCall = 0;
const CG_MIN_INTERVAL_MS = 6500; // ~9 req/min (free tier limit)

async function fetchCoinGeckoPrice(
  cgId: string,
  timestamp: number,
): Promise<number | null> {
  // Check cache
  const cacheKey = `${cgId}:${timestamp}`;
  if (cgCache[cacheKey] !== undefined) return cgCache[cacheKey];

  // Rate limit
  const now = Date.now();
  const wait = CG_MIN_INTERVAL_MS - (now - lastCgCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCgCall = Date.now();

  const from = timestamp - 600;
  const to = timestamp + 600;
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`,
    );

    if (resp.status === 429) {
      console.error("    CoinGecko rate limited, waiting 65s...");
      await new Promise((r) => setTimeout(r, 65000));
      lastCgCall = Date.now();
      return fetchCoinGeckoPrice(cgId, timestamp); // retry
    }

    if (!resp.ok) return null;
    const data = await resp.json();
    const prices = data?.prices;
    if (prices?.length > 0) {
      const price = prices[0][1];
      cgCache[cacheKey] = price;
      saveCgCache();
      return price;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function testChain(chainConfig: ChainTestConfig): Promise<OracleResult[]> {
  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl, { timeout: 120_000, retryCount: 2 }),
  });

  const results: OracleResult[] = [];

  // Get latest block number for relative block offsets
  let latestBlock: bigint;
  try {
    latestBlock = await client.getBlockNumber();
  } catch (e) {
    return [{
      chain: chainConfig.name,
      token: chainConfig.tokenName,
      version: "-",
      block: "latest",
      oracleAddr: "-",
      rawRate: "ERROR",
      priceUsd: 0,
      timestamp: 0,
      cgPrice: null,
      deviation: null,
      status: "RPC_UNREACHABLE",
      error: String(e),
    }];
  }

  // Build all call promises
  const callPromises: Array<{
    oracle: OracleVersionConfig;
    block: number | "latest";
    resolvedBlock: bigint | undefined;
  }> = [];

  for (const oracle of chainConfig.oracles) {
    for (const block of oracle.blocks) {
      let resolvedBlock: bigint | undefined;
      let displayBlock: number | "latest";

      if (block === "latest") {
        resolvedBlock = undefined; // viem uses latest by default
        displayBlock = "latest";
      } else if (typeof block === "number" && block < 0) {
        // Relative offset from latest
        resolvedBlock = latestBlock + BigInt(block);
        displayBlock = Number(resolvedBlock);
      } else {
        resolvedBlock = BigInt(block);
        displayBlock = block as number;
      }

      callPromises.push({ oracle, block: displayBlock, resolvedBlock });
    }
  }

  // Execute ALL oracle calls for this chain in parallel
  const callResults = await Promise.allSettled(
    callPromises.map(async ({ oracle, block, resolvedBlock }) => {
      if (oracle.type === "v3v4") {
        return callV3V4(client, chainConfig, oracle.address, resolvedBlock);
      } else {
        return callV1V2(client, chainConfig, oracle.address, resolvedBlock!);
      }
    }),
  );

  // Get timestamps for successful calls (in parallel)
  const timestampPromises = callPromises.map(async ({ resolvedBlock }) => {
    try {
      const blockData = await client.getBlock({
        blockNumber: resolvedBlock,
      });
      return Number(blockData.timestamp);
    } catch {
      return 0;
    }
  });
  const timestamps = await Promise.allSettled(timestampPromises);

  // Process results
  for (let i = 0; i < callPromises.length; i++) {
    const { oracle, block } = callPromises[i];
    const callResult = callResults[i];
    const ts =
      timestamps[i].status === "fulfilled" ? timestamps[i].value : 0;

    if (callResult.status === "rejected") {
      const errMsg = String(callResult.reason).substring(0, 120);
      results.push({
        chain: chainConfig.name,
        token: chainConfig.tokenName,
        version: oracle.version,
        block: String(block),
        oracleAddr: oracle.address,
        rawRate: "ERROR",
        priceUsd: 0,
        timestamp: ts,
        cgPrice: null,
        deviation: null,
        status: "REVERT",
        error: errMsg,
      });
      continue;
    }

    const { raw, price } = callResult.value;

    if (raw === 0n || price === 0) {
      results.push({
        chain: chainConfig.name,
        token: chainConfig.tokenName,
        version: oracle.version,
        block: String(block),
        oracleAddr: oracle.address,
        rawRate: "0",
        priceUsd: 0,
        timestamp: ts,
        cgPrice: null,
        deviation: null,
        status: "ZERO_RATE",
      });
      continue;
    }

    results.push({
      chain: chainConfig.name,
      token: chainConfig.tokenName,
      version: oracle.version,
      block: String(block),
      oracleAddr: oracle.address,
      rawRate: raw.toString(),
      priceUsd: price,
      timestamp: ts,
      cgPrice: null,
      deviation: null,
      status: "OK",
    });
  }

  return results;
}

async function main() {
  console.log("=".repeat(80));
  console.log("  Price Oracle Test Suite");
  console.log(`  ${new Date().toISOString()}`);
  console.log("=".repeat(80));
  console.log();

  // Validate RPC URLs
  const missingRpcs = chains.filter((c) => !c.rpcUrl);
  if (missingRpcs.length > 0) {
    console.error("Missing RPC URLs in .env for:", missingRpcs.map((c) => c.name).join(", "));
    process.exit(1);
  }

  // Current CoinGecko prices
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=aerodrome-finance,velodrome-finance&vs_currencies=usd",
    );
    const data = await resp.json();
    console.log("Current CoinGecko prices:");
    console.log(`  AERO: $${data?.["aerodrome-finance"]?.usd ?? "N/A"}`);
    console.log(`  VELO: $${data?.["velodrome-finance"]?.usd ?? "N/A"}`);
    console.log();
  } catch {
    console.log("Could not fetch current CoinGecko prices\n");
  }

  // Run ALL chains in parallel
  console.log("Running oracle calls across all chains in parallel...\n");
  const allResults = await Promise.allSettled(chains.map((c) => testChain(c)));

  const results: OracleResult[] = [];
  for (let i = 0; i < chains.length; i++) {
    const chainResult = allResults[i];
    if (chainResult.status === "fulfilled") {
      results.push(...chainResult.value);
    } else {
      results.push({
        chain: chains[i].name,
        token: chains[i].tokenName,
        version: "-",
        block: "-",
        oracleAddr: "-",
        rawRate: "ERROR",
        priceUsd: 0,
        timestamp: 0,
        cgPrice: null,
        deviation: null,
        status: "CHAIN_ERROR",
        error: String(chainResult.reason).substring(0, 120),
      });
    }
  }

  // Print oracle results
  for (const r of results) {
    const icon = r.status === "OK" ? "✅" : r.status === "ZERO_RATE" ? "⚠️ " : "❌";
    const priceStr = r.priceUsd > 0 ? `$${r.priceUsd.toFixed(6)}` : r.status;
    console.log(
      `  ${icon} ${r.chain.padEnd(12)} ${r.version.padEnd(4)} block=${String(r.block).padEnd(14)} => ${priceStr}`,
    );
  }

  // CoinGecko verification (sequential due to rate limits)
  console.log("\n--- CoinGecko Verification (rate-limited) ---\n");
  for (const r of results) {
    if (r.status !== "OK" || !r.timestamp) continue;

    // Find cgId for this chain
    const chainConfig = chains.find((c) => c.name === r.chain);
    if (!chainConfig?.cgId) continue;

    const cgPrice = await fetchCoinGeckoPrice(chainConfig.cgId, r.timestamp);
    if (cgPrice !== null && cgPrice > 0) {
      r.cgPrice = cgPrice;
      r.deviation = (Math.abs(r.priceUsd - cgPrice) / cgPrice) * 100;
      if (r.deviation > 10) r.status = "HIGH_DEVIATION";
      const icon = r.deviation > 10 ? "⚠️ " : "✅";
      console.log(
        `  ${icon} ${r.chain.padEnd(12)} ${r.version.padEnd(4)} block=${r.block.padEnd(14)} Oracle=$${r.priceUsd.toFixed(6)} CG=$${cgPrice.toFixed(6)} dev=${r.deviation.toFixed(2)}%`,
      );
    } else {
      console.log(
        `  ❓ ${r.chain.padEnd(12)} ${r.version.padEnd(4)} block=${r.block.padEnd(14)} Oracle=$${r.priceUsd.toFixed(6)} CG=N/A`,
      );
    }
  }

  // Summary table
  console.log("\n" + "=".repeat(110));
  console.log("  SUMMARY TABLE");
  console.log("=".repeat(110));
  console.log(
    `${"Chain".padEnd(12)} ${"Token".padEnd(6)} ${"Ver".padEnd(4)} ${"Block".padEnd(14)} ${"Oracle Price".padEnd(14)} ${"CG Price".padEnd(14)} ${"Deviation".padEnd(12)} Status`,
  );
  console.log("-".repeat(110));

  for (const r of results) {
    const oPrice = r.priceUsd > 0 ? `$${r.priceUsd.toFixed(6)}` : r.status;
    const cgStr = r.cgPrice ? `$${r.cgPrice.toFixed(6)}` : "-";
    const devStr = r.deviation !== null ? `${r.deviation.toFixed(2)}%` : "-";
    console.log(
      `${r.chain.padEnd(12)} ${r.token.padEnd(6)} ${r.version.padEnd(4)} ${r.block.padEnd(14)} ${oPrice.padEnd(14)} ${cgStr.padEnd(14)} ${devStr.padEnd(12)} ${r.status}`,
    );
  }

  // Issues summary
  const zeros = results.filter((r) => r.status === "ZERO_RATE");
  const reverts = results.filter((r) => r.status === "REVERT" || r.status === "CHAIN_ERROR");
  const highDev = results.filter((r) => r.status === "HIGH_DEVIATION");
  const ok = results.filter((r) => r.status === "OK");

  console.log("\n" + "=".repeat(80));
  console.log("  ISSUES DETECTED");
  console.log("=".repeat(80));

  if (zeros.length > 0) {
    console.log(`\n🔴 ZERO PRICE RETURNS (${zeros.length}):`);
    for (const r of zeros) console.log(`   ${r.chain} ${r.version} block=${r.block}`);
  }

  if (reverts.length > 0) {
    console.log(`\n🔴 REVERTS/ERRORS (${reverts.length}):`);
    for (const r of reverts) console.log(`   ${r.chain} ${r.version} block=${r.block} => ${r.error?.substring(0, 80) ?? r.status}`);
  }

  if (highDev.length > 0) {
    console.log(`\n🟡 HIGH DEVIATION >10% (${highDev.length}):`);
    for (const r of highDev) console.log(`   ${r.chain} ${r.version} block=${r.block} oracle=$${r.priceUsd.toFixed(6)} cg=$${r.cgPrice?.toFixed(6)} dev=${r.deviation?.toFixed(2)}%`);
  }

  console.log(
    `\n✅ OK: ${ok.length} | 🔴 Zero: ${zeros.length} | 🔴 Revert: ${reverts.length} | 🟡 High Dev: ${highDev.length}`,
  );

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsPath = join(RESULTS_DIR, `oracle-test-${timestamp}.json`);
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${resultsPath}`);
}

main().catch(console.error);
