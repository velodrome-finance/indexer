/**
 * Check CELO token oracle price monthly from March 2025 to March 2026.
 * Usage: pnpm tsx scripts/verify-celo-monthly.ts
 */
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { celo } from "viem/chains";
import PriceConnectors from "../src/constants/price_connectors.json";

const ORACLE_ABI = parseAbi([
  "function getManyRatesWithCustomConnectors(address[] srcTokens, address dstToken, bool useWrappers, address[] customConnectors, uint256 thresholdFilter) view returns (uint256[])",
]);

const CELO_TOKEN = "0x471EcE3750Da237f93B8E339c536989b8978a438";
const DEST_TOKEN = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"; // USDT, 6 dec
const ORACLE = "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327";
const ORACLE_START = 31690441;
const WETH = "0xD221812de1BD094f35587EE8E174B07B6167D9Af";
const SYS_TOKEN = "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81";
const DEST_DECIMALS = 6;
const TOKEN_DECIMALS = 18; // CELO is 18 decimals

// Approximate block numbers for 1st of each month (Celo ~5s blocks = ~17280/day)
// Celo block at a known anchor: block 31690441 ≈ late Feb 2025
// We'll estimate from there, but also try fetching by timestamp
const BLOCKS_PER_DAY = 17280; // ~5s blocks
const BLOCKS_PER_MONTH = BLOCKS_PER_DAY * 30;

// Known approximate blocks (estimated from chain start)
// Celo mainnet genesis: April 22, 2020, block 0
// Average block time: ~5 seconds
// We'll estimate blocks for each month start

const MONTHS = [
  { label: "2025-03", timestamp: new Date("2025-03-01T00:00:00Z") },
  { label: "2025-04", timestamp: new Date("2025-04-01T00:00:00Z") },
  { label: "2025-05", timestamp: new Date("2025-05-01T00:00:00Z") },
  { label: "2025-06", timestamp: new Date("2025-06-01T00:00:00Z") },
  { label: "2025-07", timestamp: new Date("2025-07-01T00:00:00Z") },
  { label: "2025-08", timestamp: new Date("2025-08-01T00:00:00Z") },
  { label: "2025-09", timestamp: new Date("2025-09-01T00:00:00Z") },
  { label: "2025-10", timestamp: new Date("2025-10-01T00:00:00Z") },
  { label: "2025-11", timestamp: new Date("2025-11-01T00:00:00Z") },
  { label: "2025-12", timestamp: new Date("2025-12-01T00:00:00Z") },
  { label: "2026-01", timestamp: new Date("2026-01-01T00:00:00Z") },
  { label: "2026-02", timestamp: new Date("2026-02-01T00:00:00Z") },
  { label: "2026-03", timestamp: new Date("2026-03-01T00:00:00Z") },
];

async function findBlockByTimestamp(
  client: ReturnType<typeof createPublicClient>,
  targetTimestamp: number,
  latestBlock: number,
): Promise<number> {
  // Binary search for block closest to target timestamp
  let lo = 0;
  let hi = latestBlock;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      const block = await client.getBlock({ blockNumber: BigInt(mid) });
      const blockTime = Number(block.timestamp);
      if (blockTime < targetTimestamp) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    } catch {
      // If block doesn't exist, try a bit higher
      lo = mid + 1;
    }
  }
  return lo;
}

async function queryPrice(
  client: ReturnType<typeof createPublicClient>,
  blockNumber: number,
): Promise<{ price: string; raw: bigint; source: string }> {
  if (blockNumber < ORACLE_START) {
    return { price: "$0.00", raw: 0n, source: "ORACLE_NOT_DEPLOYED" };
  }

  // Use the UPDATED connectors (with real USDC, without dead oUSDT)
  const connectors = PriceConnectors.celo;
  const filteredConnectors = connectors
    .map((c) => c.address)
    .filter((a) => a.toLowerCase() !== CELO_TOKEN.toLowerCase())
    .filter((a) => a.toLowerCase() !== WETH.toLowerCase())
    .filter((a) => a.toLowerCase() !== DEST_TOKEN.toLowerCase())
    .filter((a) => a.toLowerCase() !== SYS_TOKEN.toLowerCase());

  const connectorArray = [...filteredConnectors, SYS_TOKEN, WETH, DEST_TOKEN];

  try {
    const result = await client.readContract({
      address: ORACLE as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "getManyRatesWithCustomConnectors",
      args: [[CELO_TOKEN], DEST_TOKEN, false, connectorArray, 10],
      blockNumber: BigInt(blockNumber),
    });
    const rawPrice = BigInt((result as bigint[])[0]);
    const adjusted =
      (rawPrice * 10n ** BigInt(TOKEN_DECIMALS)) /
      10n ** BigInt(DEST_DECIMALS);
    const usd = Number(formatUnits(adjusted, 18));
    return {
      price: `$${usd.toFixed(4)}`,
      raw: adjusted,
      source: rawPrice === 0n ? "ORACLE_$0" : "ORACLE",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message.slice(0, 80) : String(e);
    return { price: "ERROR", raw: 0n, source: `ERR: ${msg}` };
  }
}

async function main() {
  console.log("CELO Token Oracle Price — Monthly (Mar 2025 → Mar 2026)");
  console.log("Using UPDATED connectors (real USDC, no dead oUSDT)\n");

  const client = createPublicClient({
    chain: celo,
    transport: http("https://celo.drpc.org", {
      timeout: 30000,
      retryCount: 3,
    }),
  });

  const latestBlock = Number(await client.getBlockNumber());
  console.log(`Latest block: ${latestBlock}\n`);

  // First find blocks for each month
  console.log("Finding block numbers for each month (binary search)...\n");

  const monthBlocks: { label: string; block: number }[] = [];
  for (const month of MONTHS) {
    const targetTs = Math.floor(month.timestamp.getTime() / 1000);
    if (targetTs > Date.now() / 1000) {
      // Future month, use latest
      monthBlocks.push({ label: month.label, block: latestBlock });
    } else {
      const block = await findBlockByTimestamp(client, targetTs, latestBlock);
      monthBlocks.push({ label: month.label, block });
      console.log(`  ${month.label} → block ${block}`);
    }
  }

  console.log(
    `\n${"Month".padEnd(10)} ${"Block".padEnd(12)} ${"Oracle Price".padEnd(16)} Source`,
  );
  console.log("-".repeat(60));

  for (const { label, block } of monthBlocks) {
    const result = await queryPrice(client, block);
    const oracleDeployed = block >= ORACLE_START;
    console.log(
      `${label.padEnd(10)} ${String(block).padEnd(12)} ${result.price.padEnd(16)} ${result.source}${!oracleDeployed ? " (oracle not deployed)" : ""}`,
    );
  }

  // Also check a few blocks right after oracle deployment
  console.log("\n--- Around oracle deployment (block ~31690441) ---\n");
  const checkBlocks = [
    { label: "oracle+100", block: ORACLE_START + 100 },
    { label: "oracle+10k", block: ORACLE_START + 10000 },
    { label: "oracle+100k", block: ORACLE_START + 100000 },
    { label: "oracle+500k", block: ORACLE_START + 500000 },
    { label: "oracle+1M", block: ORACLE_START + 1000000 },
    { label: "oracle+5M", block: ORACLE_START + 5000000 },
    { label: "oracle+10M", block: ORACLE_START + 10000000 },
  ];

  for (const { label, block } of checkBlocks) {
    if (block > latestBlock) {
      console.log(`${label.padEnd(15)} block ${block} — beyond latest, skip`);
      continue;
    }
    const result = await queryPrice(client, block);
    console.log(
      `${label.padEnd(15)} block ${String(block).padEnd(12)} ${result.price.padEnd(16)} ${result.source}`,
    );
  }
}

main().catch(console.error);
