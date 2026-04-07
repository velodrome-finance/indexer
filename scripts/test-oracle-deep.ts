/**
 * Deep investigation of price oracle issues on Celo, Soneium, and Swell.
 * Tests historical prices and WETH address validity.
 * Usage: pnpm tsx scripts/test-oracle-deep.ts
 */
import { http, createPublicClient, formatUnits, parseAbi } from "viem";
import { celo, soneium, swellchain } from "viem/chains";

const ORACLE_ABI = parseAbi([
  "function getManyRatesWithCustomConnectors(address[] srcTokens, address dstToken, bool useWrappers, address[] customConnectors, uint256 thresholdFilter) view returns (uint256[])",
]);

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);

const POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

// ── Test 1: Check WETH address validity on Celo ────────────────────────
async function testCeloWethAddress() {
  console.log("\n=== TEST 1: Celo WETH address validity ===\n");

  const client = createPublicClient({
    chain: celo,
    transport: http("https://celo.drpc.org", { timeout: 30000 }),
  });

  const configuredWeth = "0x4200000000000000000000000000000000000006";
  const realWeth = "0xD221812de1BD094f35587EE8E174B07B6167D9Af";

  // Check if the configured WETH has any code deployed
  const [configuredCode, realCode] = await Promise.all([
    client.getCode({ address: configuredWeth as `0x${string}` }),
    client.getCode({ address: realWeth as `0x${string}` }),
  ]);

  console.log(
    `Configured WETH (${configuredWeth}): code size = ${configuredCode ? (configuredCode.length - 2) / 2 : 0} bytes`,
  );
  console.log(
    `Real WETH (${realWeth}): code size = ${realCode ? (realCode.length - 2) / 2 : 0} bytes`,
  );

  if (!configuredCode || configuredCode === "0x") {
    console.log(
      "⚠️  Configured WETH has NO code deployed - this is NOT a valid contract on Celo!",
    );
  }

  // Check token details of each
  for (const addr of [configuredWeth, realWeth]) {
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({
          address: addr as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        client.readContract({
          address: addr as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);
      console.log(`  ${addr}: ${symbol} (${decimals} dec)`);
    } catch (e: any) {
      console.log(
        `  ${addr}: FAILED to read token details - ${e.message?.slice(0, 100)}`,
      );
    }
  }
}

// ── Test 2: Historical USDC prices on Celo ──────────────────────────────
async function testCeloHistoricalUSDC() {
  console.log("\n=== TEST 2: Historical USDC prices on Celo ===\n");

  const client = createPublicClient({
    chain: celo,
    transport: http("https://celo.drpc.org", { timeout: 30000 }),
  });

  const oracle = "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327";
  const destToken = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"; // USDT 6 dec
  const destDecimals = 6;
  // USDC from the pool
  const usdc = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
  const usdcDecimals = 6;
  // CELO
  const celoToken = "0x471EcE3750Da237f93B8E339c536989b8978a438";
  const celoDecimals = 18;

  const weth = "0x4200000000000000000000000000000000000006"; // configured (wrong)
  const systemToken = "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81";

  const connectors = [
    "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
    "0x471EcE3750Da237f93B8E339c536989b8978a438",
    "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    "0xef4229c8c3250C675F21BCefa42f58EfbfF6002a",
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
  ];

  async function queryPrice(
    tokenAddress: string,
    tokenDecimals: number,
    blockNumber: bigint,
  ) {
    const filteredConnectors = connectors
      .filter((c) => c.toLowerCase() !== tokenAddress.toLowerCase())
      .filter((c) => c.toLowerCase() !== weth.toLowerCase())
      .filter((c) => c.toLowerCase() !== destToken.toLowerCase())
      .filter((c) => c.toLowerCase() !== systemToken.toLowerCase());

    const tokenAddressArray = [
      ...filteredConnectors,
      systemToken,
      weth,
      destToken,
    ];

    try {
      const result = await client.readContract({
        address: oracle as `0x${string}`,
        abi: ORACLE_ABI,
        functionName: "getManyRatesWithCustomConnectors",
        args: [[tokenAddress], destToken, false, tokenAddressArray, 10],
        blockNumber,
      });
      const rawPrice = BigInt((result as bigint[])[0]);
      const adjusted =
        (rawPrice * 10n ** BigInt(tokenDecimals)) / 10n ** BigInt(destDecimals);
      return { raw: rawPrice, adjusted, usd: formatUnits(adjusted, 18) };
    } catch (e: any) {
      return {
        raw: 0n,
        adjusted: 0n,
        usd: "ERROR: " + e.message?.slice(0, 80),
      };
    }
  }

  const currentBlock = await client.getBlockNumber();

  // Celo L2 launched around Sep 2024, blocks are ~1 second
  // Oracle start block: 31690441
  // June 2025 would be roughly start + 20M blocks → ~52M
  // March 2026 would be roughly start + 50M blocks → ~82M (but may be > current)

  // Let's test across the range
  const testBlocks = [
    { label: "Oracle start + 1k", block: 31691441n },
    { label: "Oracle start + 100k", block: 31790441n },
    { label: "Oracle start + 1M", block: 32690441n },
    { label: "Oracle start + 5M", block: 36690441n },
    { label: "Oracle start + 10M", block: 41690441n },
    { label: "Oracle start + 15M", block: 46690441n },
    { label: "Oracle start + 20M", block: 51690441n },
    { label: "Oracle start + 25M", block: 56690441n },
    { label: "Oracle start + 30M", block: 61690441n },
    { label: "Current - 100k", block: currentBlock - 100000n },
  ].filter((t) => t.block <= currentBlock);

  console.log("Block     | USDC Price          | CELO Price");
  console.log("-".repeat(70));

  for (const { label, block } of testBlocks) {
    const [usdcPrice, celoPrice] = await Promise.all([
      queryPrice(usdc, usdcDecimals, block),
      queryPrice(celoToken, celoDecimals, block),
    ]);
    console.log(
      `${label.padEnd(25)} | USDC: $${usdcPrice.usd.slice(0, 10).padEnd(12)} (raw: ${usdcPrice.raw}) | CELO: $${celoPrice.usd.slice(0, 10)}`,
    );
  }
}

// ── Test 3: Soneium WETH and historical checks ──────────────────────────
async function testSoneiumHistorical() {
  console.log("\n=== TEST 3: Soneium historical prices ===\n");

  const client = createPublicClient({
    chain: soneium,
    transport: http("https://soneium.drpc.org", { timeout: 30000 }),
  });

  const oracle = "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
  const destToken = "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369"; // USDC.e 6 dec
  const destDecimals = 6;
  const weth = "0x4200000000000000000000000000000000000006";
  const systemToken = "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81";
  const connectors = [
    "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    "0x4200000000000000000000000000000000000006",
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
  ];

  const currentBlock = await client.getBlockNumber();
  const oracleStart = 1863998n;

  async function queryPrice(
    tokenAddress: string,
    tokenDecimals: number,
    blockNumber: bigint,
  ) {
    const filteredConnectors = connectors
      .filter((c) => c.toLowerCase() !== tokenAddress.toLowerCase())
      .filter((c) => c.toLowerCase() !== weth.toLowerCase())
      .filter((c) => c.toLowerCase() !== destToken.toLowerCase())
      .filter((c) => c.toLowerCase() !== systemToken.toLowerCase());

    const tokenAddressArray = [
      ...filteredConnectors,
      systemToken,
      weth,
      destToken,
    ];

    try {
      const result = await client.readContract({
        address: oracle as `0x${string}`,
        abi: ORACLE_ABI,
        functionName: "getManyRatesWithCustomConnectors",
        args: [[tokenAddress], destToken, false, tokenAddressArray, 10],
        blockNumber,
      });
      const rawPrice = BigInt((result as bigint[])[0]);
      const adjusted =
        (rawPrice * 10n ** BigInt(tokenDecimals)) / 10n ** BigInt(destDecimals);
      return { raw: rawPrice, adjusted, usd: formatUnits(adjusted, 18) };
    } catch (e: any) {
      return {
        raw: 0n,
        adjusted: 0n,
        usd: "ERROR: " + e.message?.slice(0, 80),
      };
    }
  }

  const testBlocks = [
    { label: "Oracle start + 1k", block: oracleStart + 1000n },
    { label: "Oracle start + 1M", block: oracleStart + 1000000n },
    { label: "Oracle start + 5M", block: oracleStart + 5000000n },
    { label: "Oracle start + 10M", block: oracleStart + 10000000n },
    { label: "Oracle start + 15M", block: oracleStart + 15000000n },
    { label: "Current - 100k", block: currentBlock - 100000n },
  ].filter((t) => t.block <= currentBlock);

  console.log("Block     | WETH Price          | XVELO Price");
  console.log("-".repeat(70));

  for (const { label, block } of testBlocks) {
    const [wethPrice, xveloPrice] = await Promise.all([
      queryPrice(weth, 18, block),
      queryPrice(systemToken, 18, block),
    ]);
    console.log(
      `${label.padEnd(25)} | WETH: $${wethPrice.usd.slice(0, 10).padEnd(12)} | XVELO: $${xveloPrice.usd.slice(0, 10)}`,
    );
  }
}

// ── Test 4: Swell historical + USDK issue ───────────────────────────────
async function testSwellHistorical() {
  console.log("\n=== TEST 4: Swell historical prices ===\n");

  const client = createPublicClient({
    chain: swellchain,
    transport: http("https://rpc.ankr.com/swell", { timeout: 30000 }),
  });

  const oracle = "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
  const destToken = "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"; // USDe 18 dec
  const destDecimals = 18;
  const weth = "0x4200000000000000000000000000000000000006";
  const systemToken = "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81";
  const connectors = [
    "0x4200000000000000000000000000000000000006",
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    "0x0000bAa0b1678229863c0A941C1056b83a1955F5",
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    "0x99a38322cAF878Ef55AE4d0Eda535535eF8C7960",
  ];

  const currentBlock = await client.getBlockNumber();
  const oracleStart = 3733759n;

  async function queryPrice(
    tokenAddress: string,
    tokenDecimals: number,
    blockNumber: bigint,
  ) {
    const filteredConnectors = connectors
      .filter((c) => c.toLowerCase() !== tokenAddress.toLowerCase())
      .filter((c) => c.toLowerCase() !== weth.toLowerCase())
      .filter((c) => c.toLowerCase() !== destToken.toLowerCase())
      .filter((c) => c.toLowerCase() !== systemToken.toLowerCase());

    const tokenAddressArray = [
      ...filteredConnectors,
      systemToken,
      weth,
      destToken,
    ];

    try {
      const result = await client.readContract({
        address: oracle as `0x${string}`,
        abi: ORACLE_ABI,
        functionName: "getManyRatesWithCustomConnectors",
        args: [[tokenAddress], destToken, false, tokenAddressArray, 10],
        blockNumber,
      });
      const rawPrice = BigInt((result as bigint[])[0]);
      const adjusted =
        (rawPrice * 10n ** BigInt(tokenDecimals)) / 10n ** BigInt(destDecimals);
      return { raw: rawPrice, adjusted, usd: formatUnits(adjusted, 18) };
    } catch (e: any) {
      return {
        raw: 0n,
        adjusted: 0n,
        usd: "ERROR: " + e.message?.slice(0, 80),
      };
    }
  }

  const testBlocks = [
    { label: "Oracle start + 1k", block: oracleStart + 1000n },
    { label: "Oracle start + 1M", block: oracleStart + 1000000n },
    { label: "Oracle start + 5M", block: oracleStart + 5000000n },
    { label: "Oracle start + 10M", block: oracleStart + 10000000n },
    { label: "Oracle start + 15M", block: oracleStart + 15000000n },
    { label: "Current - 100k", block: currentBlock - 100000n },
  ].filter((t) => t.block <= currentBlock);

  console.log(
    "Block     | WETH Price          | XVELO Price         | USDK Price",
  );
  console.log("-".repeat(90));

  const usdk = "0x0000bAa0b1678229863c0A941C1056b83a1955F5";
  for (const { label, block } of testBlocks) {
    const [wethPrice, xveloPrice, usdkPrice] = await Promise.all([
      queryPrice(weth, 18, block),
      queryPrice(systemToken, 18, block),
      queryPrice(usdk, 18, block),
    ]);
    console.log(
      `${label.padEnd(25)} | WETH: $${wethPrice.usd.slice(0, 10).padEnd(12)} | XVELO: $${xveloPrice.usd.slice(0, 10).padEnd(12)} | USDK: $${usdkPrice.usd.slice(0, 10)}`,
    );
  }
}

// ── Test 5: Check what tokens are in popular pools on each chain ────────
async function testPopularPoolTokens() {
  console.log("\n=== TEST 5: Check Soneium WETH address on Celo ===\n");

  // Check if 0x4200000000000000000000000000000000000006 has any code on Celo
  // This is the OP Stack WETH, Celo recently became L2 so it might exist
  const celoClient = createPublicClient({
    chain: celo,
    transport: http("https://celo.drpc.org", { timeout: 30000 }),
  });

  // Check bytecode and try calling it
  const code = await celoClient.getCode({
    address: "0x4200000000000000000000000000000000000006" as `0x${string}`,
  });
  console.log(
    `Celo 0x4200...0006 bytecode length: ${code ? (code.length - 2) / 2 : 0}`,
  );

  if (code && code !== "0x") {
    try {
      const [symbol, name] = await Promise.all([
        celoClient.readContract({
          address:
            "0x4200000000000000000000000000000000000006" as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        celoClient.readContract({
          address:
            "0x4200000000000000000000000000000000000006" as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "name",
        }),
      ]);
      console.log(`  Symbol: ${symbol}, Name: ${name}`);
    } catch {
      console.log(
        "  Could not read ERC20 methods - might be a different contract",
      );
    }
  } else {
    console.log("  NO contract at this address on Celo!");
  }
}

async function main() {
  await testCeloWethAddress();
  await testCeloHistoricalUSDC();
  await testSoneiumHistorical();
  await testSwellHistorical();
  await testPopularPoolTokens();
}

main().catch(console.error);
