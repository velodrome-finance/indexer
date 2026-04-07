/**
 * Test script to directly query price oracles on Celo, Soneium, and Swell.
 * Usage: npx tsx scripts/test-oracle.ts
 */
import { http, createPublicClient, formatUnits, parseAbi } from "viem";
import { celo, soneium, swellchain } from "viem/chains";

// ── Chain configs ──────────────────────────────────────────────────────────
const CHAINS = {
  celo: {
    chainId: 42220,
    name: "Celo",
    rpc: "https://celo.drpc.org",
    chain: celo,
    oracle: "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327",
    destinationToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", // USDT (6 dec)
    destinationDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: [
      "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
      "0x471EcE3750Da237f93B8E339c536989b8978a438",
      "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
      "0xef4229c8c3250C675F21BCefa42f58EfbfF6002a",
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    ],
    // Test: USDC/CELO pool at 0xa70c1084b65c6f259f698c050b983b925fe30e08
    testPool: "0xa70c1084b65c6f259f698c050b983b925fe30e08",
  },
  soneium: {
    chainId: 1868,
    name: "Soneium",
    rpc: "https://soneium.drpc.org",
    chain: soneium,
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destinationToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    destinationDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: [
      "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
      "0x4200000000000000000000000000000000000006",
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    ],
    testPool: null, // Will test WETH directly
  },
  swell: {
    chainId: 1923,
    name: "Swell",
    rpc: "https://rpc.ankr.com/swell",
    chain: swellchain,
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destinationToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", // USDe (18 dec!)
    destinationDecimals: 18,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: [
      "0x4200000000000000000000000000000000000006",
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
      "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
      "0x0000bAa0b1678229863c0A941C1056b83a1955F5",
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
      "0x99a38322cAF878Ef55AE4d0Eda535535eF8C7960",
    ],
    testPool: null,
  },
} as const;

// ── ABIs ───────────────────────────────────────────────────────────────────
const POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const ORACLE_ABI = parseAbi([
  "function getManyRatesWithCustomConnectors(address[] srcTokens, address dstToken, bool useWrappers, address[] customConnectors, uint256 thresholdFilter) view returns (uint256[])",
  "function connectors() view returns (address[])",
]);

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTokenInfo(client: any, address: string) {
  try {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "name",
      }),
      client.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
      client.readContract({
        address: address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);
    return {
      name: name as string,
      symbol: symbol as string,
      decimals: Number(decimals),
    };
  } catch (e) {
    return { name: "Unknown", symbol: "???", decimals: 18 };
  }
}

async function queryOraclePrice(
  client: any,
  oracleAddress: string,
  tokenAddress: string,
  destinationToken: string,
  destinationDecimals: number,
  connectors: string[],
  weth: string,
  systemToken: string,
  blockNumber?: bigint,
) {
  // Build connector array same way as the indexer
  const filteredConnectors = connectors
    .filter((c) => c.toLowerCase() !== tokenAddress.toLowerCase())
    .filter((c) => c.toLowerCase() !== weth.toLowerCase())
    .filter((c) => c.toLowerCase() !== destinationToken.toLowerCase())
    .filter((c) => c.toLowerCase() !== systemToken.toLowerCase());

  const tokenAddressArray = [
    ...filteredConnectors,
    systemToken,
    weth,
    destinationToken,
  ];

  const args: any = {
    address: oracleAddress as `0x${string}`,
    abi: ORACLE_ABI,
    functionName: "getManyRatesWithCustomConnectors",
    args: [[tokenAddress], destinationToken, false, tokenAddressArray, 10],
  };
  if (blockNumber) {
    args.blockNumber = blockNumber;
  }

  try {
    const result = await client.readContract(args);
    const rawPrice = BigInt((result as bigint[])[0]);
    return { rawPrice, error: null };
  } catch (e: any) {
    return { rawPrice: 0n, error: e.message?.slice(0, 200) };
  }
}

function computeAdjustedPrice(
  rawOraclePrice: bigint,
  tokenDecimals: number,
  destinationDecimals: number,
): bigint {
  // This is the V3/V4 adjustment from RpcGateway.ts lines 418-424
  return (
    (rawOraclePrice * 10n ** BigInt(tokenDecimals)) /
    10n ** BigInt(destinationDecimals)
  );
}

function formatPriceUSD(pricePerUSD: bigint): string {
  // pricePerUSDNew is stored as 18-decimal bigint where 10^18 = $1
  return `$${formatUnits(pricePerUSD, 18)}`;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function testChain(chainKey: keyof typeof CHAINS) {
  const config = CHAINS[chainKey];
  console.log(`\n${"=".repeat(80)}`);
  console.log(`CHAIN: ${config.name} (chainId ${config.chainId})`);
  console.log(`Oracle: ${config.oracle}`);
  console.log(
    `Destination token: ${config.destinationToken} (${config.destinationDecimals} decimals)`,
  );
  console.log(`${"=".repeat(80)}`);

  const client = createPublicClient({
    chain: config.chain as any,
    transport: http(config.rpc, { timeout: 30000 }),
  });

  // Get current block
  const currentBlock = await client.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);

  // Get destination token info
  const destInfo = await getTokenInfo(client, config.destinationToken);
  console.log(
    `Destination token: ${destInfo.symbol} (${destInfo.name}), ${destInfo.decimals} decimals`,
  );
  console.log(
    `  Configured decimals: ${config.destinationDecimals}, Actual decimals: ${destInfo.decimals}`,
  );
  if (destInfo.decimals !== config.destinationDecimals) {
    console.log(
      `  ⚠️  MISMATCH! Configured ${config.destinationDecimals} vs actual ${destInfo.decimals}`,
    );
  }

  // Get oracle's registered connectors
  try {
    const oracleConnectors = await client.readContract({
      address: config.oracle as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "connectors",
    });
    console.log(
      `\nOracle registered connectors (${(oracleConnectors as any[]).length}):`,
    );
    for (const conn of oracleConnectors as string[]) {
      const info = await getTokenInfo(client, conn);
      console.log(`  ${conn} - ${info.symbol} (${info.decimals} dec)`);
    }
  } catch (e) {
    console.log("  Could not fetch oracle connectors");
  }

  // ── Test tokens ──────────────────────────────────────────────────────
  let tokensToTest: string[] = [];

  if (config.testPool) {
    console.log(`\nPool: ${config.testPool}`);
    try {
      const [token0, token1] = await Promise.all([
        client.readContract({
          address: config.testPool as `0x${string}`,
          abi: POOL_ABI,
          functionName: "token0",
        }),
        client.readContract({
          address: config.testPool as `0x${string}`,
          abi: POOL_ABI,
          functionName: "token1",
        }),
      ]);
      tokensToTest = [token0 as string, token1 as string];
    } catch (e) {
      console.log("  Could not read pool tokens");
    }
  }

  // Also test WETH
  tokensToTest.push(config.weth);
  // Add connectors that aren't already in the list
  for (const c of config.connectors) {
    if (
      !tokensToTest.some((t) => t.toLowerCase() === c.toLowerCase()) &&
      c.toLowerCase() !== config.destinationToken.toLowerCase()
    ) {
      tokensToTest.push(c);
    }
  }

  console.log(`\n--- Token Price Tests (latest block) ---`);
  for (const token of tokensToTest) {
    const info = await getTokenInfo(client, token);
    const { rawPrice, error } = await queryOraclePrice(
      client,
      config.oracle,
      token,
      config.destinationToken,
      config.destinationDecimals,
      config.connectors,
      config.weth,
      config.systemToken,
    );

    if (error) {
      console.log(`\n  ${info.symbol} (${token}): ERROR - ${error}`);
      continue;
    }

    const adjustedPrice = computeAdjustedPrice(
      rawPrice,
      info.decimals,
      destInfo.decimals,
    );
    const usdStr = formatPriceUSD(adjustedPrice);

    console.log(`\n  ${info.symbol} (${token}):`);
    console.log(`    Decimals: ${info.decimals}`);
    console.log(`    Raw oracle price: ${rawPrice}`);
    console.log(`    Adjusted price (V3 formula): ${adjustedPrice}`);
    console.log(`    USD: ${usdStr}`);
    if (rawPrice === 0n) {
      console.log(`    ⚠️  ZERO raw price from oracle!`);
    }
  }

  // ── Historical test for Celo (June 2025 - March 2026 issue) ──────────
  if (chainKey === "celo" && tokensToTest.length > 0) {
    // Test at various historical blocks
    // Celo L2 ~2s blocks, so ~1.8M blocks/day. June 2025 would be roughly...
    // Oracle start block: 31690441
    // Let's test at specific blocks to see price changes
    console.log(`\n--- Historical Price Test (Celo) ---`);
    // We'll try a few block numbers after oracle deployment
    const testBlocks = [
      { label: "Near oracle start (block+1000)", block: 31691441n },
      { label: "Oracle + 500k blocks", block: 32190441n },
      { label: "Oracle + 2M blocks", block: 33690441n },
      { label: "Oracle + 5M blocks", block: 36690441n },
      { label: "Oracle + 10M blocks", block: 41690441n },
      { label: "Recent (current - 100k)", block: currentBlock - 100000n },
      { label: "Current", block: currentBlock },
    ];

    const token0 = tokensToTest[0]; // USDC from pool
    const info0 = await getTokenInfo(client, token0);
    console.log(`Testing ${info0.symbol} (${token0}) at various blocks:`);

    for (const { label, block } of testBlocks) {
      if (block > currentBlock || block < 31690441n) continue;
      const { rawPrice, error } = await queryOraclePrice(
        client,
        config.oracle,
        token0,
        config.destinationToken,
        config.destinationDecimals,
        config.connectors,
        config.weth,
        config.systemToken,
        block,
      );
      if (error) {
        console.log(
          `  ${label} (block ${block}): ERROR - ${error.slice(0, 100)}`,
        );
      } else {
        const adj = computeAdjustedPrice(
          rawPrice,
          info0.decimals,
          destInfo.decimals,
        );
        console.log(
          `  ${label} (block ${block}): raw=${rawPrice}, adjusted=${adj}, USD=${formatPriceUSD(adj)}`,
        );
      }
    }
  }
}

async function main() {
  try {
    await testChain("celo");
  } catch (e: any) {
    console.error(`Celo test failed: ${e.message}`);
  }
  try {
    await testChain("soneium");
  } catch (e: any) {
    console.error(`Soneium test failed: ${e.message}`);
  }
  try {
    await testChain("swell");
  } catch (e: any) {
    console.error(`Swell test failed: ${e.message}`);
  }
}

main();
