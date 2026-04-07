/**
 * Simple pool scan — no batching, one call at a time.
 * Usage: pnpm tsx scripts/test-celo-pools-simple.ts
 */
import { http, createPublicClient, formatUnits, parseAbi } from "viem";
import { celo, soneium, swellchain } from "viem/chains";

const FACTORY_ABI = parseAbi([
  "function allPools(uint256) view returns (address)",
  "function allPoolsLength() view returns (uint256)",
]);
const POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const ORACLE_ABI = parseAbi([
  "function getManyRatesWithCustomConnectors(address[] srcTokens, address dstToken, bool useWrappers, address[] customConnectors, uint256 thresholdFilter) view returns (uint256[])",
]);

interface ChainCfg {
  name: string;
  chain: any;
  rpc: string;
  factory: string;
  oracle: string;
  destToken: string;
  destDec: number;
  weth: string;
  sys: string;
  connectors: string[];
}

const CHAINS: Record<string, ChainCfg> = {
  celo: {
    name: "Celo",
    chain: celo,
    rpc: "https://celo.drpc.org",
    factory: "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    oracle: "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327",
    destToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    destDec: 6,
    weth: "0x4200000000000000000000000000000000000006",
    sys: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
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
    chain: soneium,
    rpc: "https://soneium.drpc.org",
    factory: "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    destDec: 6,
    weth: "0x4200000000000000000000000000000000000006",
    sys: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: [
      "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
      "0x4200000000000000000000000000000000000006",
      "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
      "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    ],
  },
  swell: {
    name: "Swell",
    chain: swellchain,
    rpc: "https://rpc.ankr.com/swell",
    factory: "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    destDec: 18,
    weth: "0x4200000000000000000000000000000000000006",
    sys: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
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

async function sym(client: any, addr: string): Promise<string> {
  try {
    return (await client.readContract({
      address: addr as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "symbol",
    })) as string;
  } catch {
    return "???";
  }
}

async function dec(client: any, addr: string): Promise<number> {
  try {
    return Number(
      await client.readContract({
        address: addr as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    );
  } catch {
    return 18;
  }
}

async function price(
  client: any,
  cfg: ChainCfg,
  token: string,
  tokenDec: number,
): Promise<string> {
  const fc = cfg.connectors
    .filter((c) => c.toLowerCase() !== token.toLowerCase())
    .filter((c) => c.toLowerCase() !== cfg.weth.toLowerCase())
    .filter((c) => c.toLowerCase() !== cfg.destToken.toLowerCase())
    .filter((c) => c.toLowerCase() !== cfg.sys.toLowerCase());
  const arr = [...fc, cfg.sys, cfg.weth, cfg.destToken];
  try {
    const r = await client.readContract({
      address: cfg.oracle as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "getManyRatesWithCustomConnectors",
      args: [[token], cfg.destToken, false, arr, 10],
    });
    const raw = BigInt((r as bigint[])[0]);
    const adj = (raw * 10n ** BigInt(tokenDec)) / 10n ** BigInt(cfg.destDec);
    return `$${formatUnits(adj, 18)}`;
  } catch {
    return "ERROR";
  }
}

async function scan(key: string) {
  const cfg = CHAINS[key];
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc, { timeout: 30000, retryCount: 3 }),
  });

  console.log(`\n${"=".repeat(80)}`);
  console.log(`${cfg.name}: Pool scan (configured WETH: ${cfg.weth})`);
  console.log(`${"=".repeat(80)}`);

  const total = Number(
    await client.readContract({
      address: cfg.factory as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "allPoolsLength",
    }),
  );
  console.log(`Total V2 pools: ${total}\n`);

  let wethPoolCount = 0;
  const allTokens = new Set<string>();

  for (let i = 0; i < total; i++) {
    const poolAddr = (await client.readContract({
      address: cfg.factory as `0x${string}`,
      abi: FACTORY_ABI,
      functionName: "allPools",
      args: [BigInt(i)],
    })) as string;

    const t0 = (await client.readContract({
      address: poolAddr as `0x${string}`,
      abi: POOL_ABI,
      functionName: "token0",
    })) as string;
    const t1 = (await client.readContract({
      address: poolAddr as `0x${string}`,
      abi: POOL_ABI,
      functionName: "token1",
    })) as string;

    allTokens.add(t0.toLowerCase());
    allTokens.add(t1.toLowerCase());

    const hasWeth =
      t0.toLowerCase() === cfg.weth.toLowerCase() ||
      t1.toLowerCase() === cfg.weth.toLowerCase();
    const s0 = await sym(client, t0);
    const s1 = await sym(client, t1);
    const d0 = await dec(client, t0);
    const d1 = await dec(client, t1);
    const p0 = await price(client, cfg, t0, d0);
    const p1 = await price(client, cfg, t1, d1);

    const wethFlag = hasWeth ? " ← USES CONFIGURED WETH" : "";
    const priceWarning0 = p0.startsWith("$0.0") || p0 === "$0" ? " ⚠️$0" : "";
    const priceWarning1 = p1.startsWith("$0.0") || p1 === "$0" ? " ⚠️$0" : "";

    console.log(`Pool ${i}: ${poolAddr}`);
    console.log(`  ${s0} (${t0}): ${p0}${priceWarning0}`);
    console.log(`  ${s1} (${t1}): ${p1}${priceWarning1}${wethFlag}`);

    if (hasWeth) wethPoolCount++;
  }

  console.log(`\nSummary: ${wethPoolCount}/${total} pools use configured WETH`);
  console.log(`Unique tokens: ${allTokens.size}`);
}

async function main() {
  await scan("celo");
  await scan("soneium");
  await scan("swell");
}

main().catch(console.error);
