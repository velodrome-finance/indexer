/**
 * Check which WETH address Celo pools actually use, and test oracle pricing for common tokens.
 * Usage: pnpm tsx scripts/test-celo-pools.ts
 */
import {
  http,
  createPublicClient,
  formatUnits,
  parseAbi,
  parseAbiItem,
} from "viem";
import { celo, soneium, swellchain } from "viem/chains";

const FACTORY_ABI = parseAbi([
  "function allPools(uint256) view returns (address)",
  "function allPoolsLength() view returns (uint256)",
]);

const POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function stable() view returns (bool)",
]);

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const ORACLE_ABI = parseAbi([
  "function getManyRatesWithCustomConnectors(address[] srcTokens, address dstToken, bool useWrappers, address[] customConnectors, uint256 thresholdFilter) view returns (uint256[])",
]);

// ── CHAIN CONFIGS ──────────────────────────────────────────────────────
interface ChainConfig {
  name: string;
  chainId: number;
  chain: any;
  rpc: string;
  poolFactory: string;
  clFactory: string;
  oracle: string;
  destToken: string;
  destDecimals: number;
  wethConfigured: string;
  systemToken: string;
  connectors: string[];
}

const CONFIGS: Record<string, ChainConfig> = {
  celo: {
    name: "Celo",
    chainId: 42220,
    chain: celo,
    rpc: "https://celo.drpc.org",
    poolFactory: "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    clFactory: "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
    oracle: "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327",
    destToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    destDecimals: 6,
    wethConfigured: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: [
      "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
      "0x471EcE3750Da237f93B8E339c536989b8978a438",
      "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
      "0xef4229c8c3250C675F21BCefa42f58EfbfF6002a",
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    ],
  },
  soneium: {
    name: "Soneium",
    chainId: 1868,
    chain: soneium,
    rpc: "https://soneium.drpc.org",
    poolFactory: "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    clFactory: "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    destDecimals: 6,
    wethConfigured: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: [
      "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
      "0x4200000000000000000000000000000000000006",
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    ],
  },
  swell: {
    name: "Swell",
    chainId: 1923,
    chain: swellchain,
    rpc: "https://rpc.ankr.com/swell",
    poolFactory: "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    clFactory: "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    destDecimals: 18,
    wethConfigured: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: [
      "0x4200000000000000000000000000000000000006",
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
      "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
      "0x0000bAa0b1678229863c0A941C1056b83a1955F5",
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
      "0x99a38322cAF878Ef55AE4d0Eda535535eF8C7960",
    ],
  },
};

async function getTokenInfo(client: any, addr: string) {
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
    return { symbol: symbol as string, decimals: Number(decimals) };
  } catch {
    return { symbol: "???", decimals: 18 };
  }
}

async function queryOraclePrice(
  client: any,
  config: ChainConfig,
  tokenAddress: string,
  tokenDecimals: number,
) {
  const filteredConnectors = config.connectors
    .filter((c) => c.toLowerCase() !== tokenAddress.toLowerCase())
    .filter((c) => c.toLowerCase() !== config.wethConfigured.toLowerCase())
    .filter((c) => c.toLowerCase() !== config.destToken.toLowerCase())
    .filter((c) => c.toLowerCase() !== config.systemToken.toLowerCase());

  const tokenAddressArray = [
    ...filteredConnectors,
    config.systemToken,
    config.wethConfigured,
    config.destToken,
  ];

  try {
    const result = await client.readContract({
      address: config.oracle as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "getManyRatesWithCustomConnectors",
      args: [[tokenAddress], config.destToken, false, tokenAddressArray, 10],
    });
    const raw = BigInt((result as bigint[])[0]);
    const adjusted =
      (raw * 10n ** BigInt(tokenDecimals)) / 10n ** BigInt(config.destDecimals);
    return formatUnits(adjusted, 18);
  } catch {
    return "ERROR";
  }
}

async function scanPools(chainKey: string) {
  const config = CONFIGS[chainKey];
  console.log(`\n${"=".repeat(80)}`);
  console.log(`${config.name}: Scanning V2 pool factory for WETH usage`);
  console.log(`Configured WETH: ${config.wethConfigured}`);
  console.log(`${"=".repeat(80)}`);

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpc, { timeout: 30000, batch: { batchSize: 50 } }),
  });

  // Get total pool count
  const totalPools = Number(
    await client.readContract({
      address: config.poolFactory as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "allPoolsLength",
    }),
  );

  console.log(`Total V2 pools: ${totalPools}`);

  // Scan all pools
  const poolsWithConfiguredWeth: {
    pool: string;
    token0: string;
    token1: string;
    t0sym: string;
    t1sym: string;
  }[] = [];
  const uniqueTokens = new Set<string>();
  const tokenPriceMap = new Map<
    string,
    { symbol: string; decimals: number; price: string }
  >();

  const batchSize = 20;
  for (let i = 0; i < totalPools; i += batchSize) {
    const end = Math.min(i + batchSize, totalPools);
    const poolAddresses = await Promise.all(
      Array.from({ length: end - i }, (_, j) =>
        client.readContract({
          address: config.poolFactory as `0x${string}`,
          abi: FACTORY_ABI,
          functionName: "allPools",
          args: [BigInt(i + j)],
        }),
      ),
    );

    for (const poolAddr of poolAddresses) {
      try {
        const [token0, token1] = await Promise.all([
          client.readContract({
            address: poolAddr as `0x${string}`,
            abi: POOL_ABI,
            functionName: "token0",
          }),
          client.readContract({
            address: poolAddr as `0x${string}`,
            abi: POOL_ABI,
            functionName: "token1",
          }),
        ]);

        uniqueTokens.add((token0 as string).toLowerCase());
        uniqueTokens.add((token1 as string).toLowerCase());

        const hasConfiguredWeth =
          (token0 as string).toLowerCase() ===
            config.wethConfigured.toLowerCase() ||
          (token1 as string).toLowerCase() ===
            config.wethConfigured.toLowerCase();

        if (hasConfiguredWeth) {
          const [t0info, t1info] = await Promise.all([
            getTokenInfo(client, token0 as string),
            getTokenInfo(client, token1 as string),
          ]);
          poolsWithConfiguredWeth.push({
            pool: poolAddr as string,
            token0: token0 as string,
            token1: token1 as string,
            t0sym: t0info.symbol,
            t1sym: t1info.symbol,
          });
        }
      } catch {
        // skip broken pools
      }
    }
  }

  console.log(
    `\nPools using configured WETH (${config.wethConfigured}): ${poolsWithConfiguredWeth.length} / ${totalPools}`,
  );
  for (const p of poolsWithConfiguredWeth) {
    console.log(
      `  ${p.pool}: ${p.t0sym}/${p.t1sym} (${p.token0} / ${p.token1})`,
    );
  }

  // Now test oracle prices for all unique tokens in pools with configured WETH
  if (poolsWithConfiguredWeth.length > 0) {
    console.log(`\nOracle prices for tokens in affected pools:`);
    const testedTokens = new Set<string>();
    for (const p of poolsWithConfiguredWeth) {
      for (const tokenAddr of [p.token0, p.token1]) {
        const key = tokenAddr.toLowerCase();
        if (testedTokens.has(key)) continue;
        testedTokens.add(key);

        const info = await getTokenInfo(client, tokenAddr);
        const price = await queryOraclePrice(
          client,
          config,
          tokenAddr,
          info.decimals,
        );
        console.log(`  ${info.symbol} (${tokenAddr}): $${price}`);
        tokenPriceMap.set(key, {
          symbol: info.symbol,
          decimals: info.decimals,
          price,
        });
      }
    }
  }

  // Count how many unique tokens get $0 from oracle
  console.log(
    `\nTesting oracle pricing for ALL ${uniqueTokens.size} unique tokens in V2 pools...`,
  );
  let zeroCount = 0;
  let nonZeroCount = 0;
  const zeroTokens: string[] = [];

  const tokenList = Array.from(uniqueTokens);
  for (let i = 0; i < tokenList.length; i += 5) {
    const batch = tokenList.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (addr) => {
        const info = await getTokenInfo(client, addr);
        const price = await queryOraclePrice(
          client,
          config,
          addr,
          info.decimals,
        );
        return { addr, symbol: info.symbol, price };
      }),
    );
    for (const r of results) {
      if (r.price === "0" || r.price === "0.0") {
        zeroCount++;
        zeroTokens.push(`${r.symbol} (${r.addr})`);
      } else {
        nonZeroCount++;
      }
    }
  }

  console.log(`  Tokens with valid price: ${nonZeroCount}`);
  console.log(`  Tokens with $0 price: ${zeroCount}`);
  if (zeroTokens.length > 0 && zeroTokens.length <= 30) {
    console.log(`  Zero-price tokens:`);
    for (const t of zeroTokens) {
      console.log(`    - ${t}`);
    }
  }
}

async function main() {
  await scanPools("celo");
  await scanPools("soneium");
  await scanPools("swell");
}

main().catch(console.error);
