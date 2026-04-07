/**
 * Audit all price connectors across all chains.
 * For each connector, check: bytecode exists, symbol, decimals, total supply, oracle price.
 * Flags: no code, $0 oracle price, very low supply.
 * Usage: pnpm tsx scripts/audit-connectors.ts
 */
import { http, createPublicClient, formatUnits, parseAbi } from "viem";
import {
  base,
  celo,
  fraxtal,
  ink,
  lisk,
  metalL2,
  mode,
  optimism,
  soneium,
  swellchain,
} from "viem/chains";
import PriceConnectors from "../src/constants/price_connectors.json";

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const ORACLE_ABI = parseAbi([
  "function getManyRatesWithCustomConnectors(address[] srcTokens, address dstToken, bool useWrappers, address[] customConnectors, uint256 thresholdFilter) view returns (uint256[])",
]);

interface ChainCfg {
  name: string;
  chainId: number;
  chain: any;
  rpc: string;
  oracle: string;
  destToken: string;
  destDecimals: number;
  weth: string;
  systemToken: string;
  connectors: { address: string; createdBlock: number }[];
}

const CHAINS: ChainCfg[] = [
  {
    name: "Optimism",
    chainId: 10,
    chain: optimism,
    rpc: "https://mainnet.optimism.io",
    oracle: "0x59114D308C6DE4A84F5F8cD80485a5481047b99f",
    destToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    connectors: PriceConnectors.optimism,
  },
  {
    name: "Base",
    chainId: 8453,
    chain: base,
    rpc: "https://base-rpc.publicnode.com",
    oracle: "0x8456038bdae8672f552182B0FC39b1917dE9a41A",
    destToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    connectors: PriceConnectors.base,
  },
  {
    name: "Celo",
    chainId: 42220,
    chain: celo,
    rpc: "https://celo.drpc.org",
    oracle: "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327",
    destToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    destDecimals: 6,
    weth: "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.celo,
  },
  {
    name: "Soneium",
    chainId: 1868,
    chain: soneium,
    rpc: "https://soneium.drpc.org",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.soneium,
  },
  {
    name: "Swell",
    chainId: 1923,
    chain: swellchain,
    rpc: "https://rpc.ankr.com/swell",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    destDecimals: 18,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.swellchain,
  },
  {
    name: "Mode",
    chainId: 34443,
    chain: mode,
    rpc: "https://1rpc.io/mode",
    oracle: "0xbAEe949B52cb503e39f1Df54Dcee778da59E11bc",
    destToken: "0xd988097fb8612cc24eeC14542bC03424c656005f",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0xDfc7C877a950e49D2610114102175A06C2e3167a",
    connectors: PriceConnectors.mode,
  },
  {
    name: "Lisk",
    chainId: 1135,
    chain: lisk,
    rpc: "https://lisk.drpc.org",
    oracle: "0x024503003fFE9AF285f47c1DaAaA497D9f1166D0",
    destToken: "0x05D032ac25d322df992303dCa074EE7392C117b9",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.lisk,
  },
  {
    name: "Fraxtal",
    chainId: 252,
    chain: fraxtal,
    rpc: "https://fraxtal.drpc.org",
    oracle: "0x4817f8D70aE32Ee96e5E6BFA24eb7Fcfa83bbf29",
    destToken: "0xFc00000000000000000000000000000000000001",
    destDecimals: 18,
    weth: "0xFC00000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.fraxtal,
  },
  {
    name: "Ink",
    chainId: 57073,
    chain: ink,
    rpc: "https://ink.drpc.org",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    destToken: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.ink,
  },
  {
    name: "Metal",
    chainId: 1750,
    chain: metalL2,
    rpc: "https://metall2.drpc.org",
    oracle: "0x3e71CCdf495d9628D3655A600Bcad3afF2ddea98",
    destToken: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.metal,
  },
];

async function queryOraclePrice(
  client: any,
  cfg: ChainCfg,
  tokenAddress: string,
  tokenDecimals: number,
): Promise<{ raw: bigint; usd: string; error?: string }> {
  // Skip if token is the destination (oracle can't price against itself)
  if (tokenAddress.toLowerCase() === cfg.destToken.toLowerCase()) {
    return { raw: 10n ** 18n, usd: "$1.00 (destination)" };
  }

  const filteredConnectors = cfg.connectors
    .map((c) => c.address)
    .filter((c) => c.toLowerCase() !== tokenAddress.toLowerCase())
    .filter((c) => c.toLowerCase() !== cfg.weth.toLowerCase())
    .filter((c) => c.toLowerCase() !== cfg.destToken.toLowerCase())
    .filter((c) => c.toLowerCase() !== cfg.systemToken.toLowerCase());

  const tokenAddressArray = [
    ...filteredConnectors,
    cfg.systemToken,
    cfg.weth,
    cfg.destToken,
  ];

  try {
    const result = await client.readContract({
      address: cfg.oracle as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "getManyRatesWithCustomConnectors",
      args: [[tokenAddress], cfg.destToken, false, tokenAddressArray, 10],
    });
    const raw = BigInt((result as bigint[])[0]);
    const adjusted =
      (raw * 10n ** BigInt(tokenDecimals)) / 10n ** BigInt(cfg.destDecimals);
    return { raw, usd: `$${formatUnits(adjusted, 18)}` };
  } catch (e: any) {
    return { raw: 0n, usd: "ERROR", error: e.message?.slice(0, 80) };
  }
}

async function auditChain(cfg: ChainCfg) {
  console.log(`\n${"=".repeat(90)}`);
  console.log(
    `${cfg.name} (chainId ${cfg.chainId}) — ${cfg.connectors.length} connectors`,
  );
  console.log(`${"=".repeat(90)}`);
  console.log(
    `${"Address".padEnd(44)} ${"Symbol".padEnd(10)} ${"Dec".padEnd(4)} ${"Supply".padEnd(18)} ${"Oracle Price".padEnd(24)} Flags`,
  );
  console.log("-".repeat(120));

  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc, { timeout: 30000, retryCount: 3 }),
  });

  const issues: string[] = [];

  for (const connector of cfg.connectors) {
    const addr = connector.address;
    const flags: string[] = [];

    // Check bytecode
    let hasCode = false;
    try {
      const code = await client.getCode({
        address: addr as `0x${string}`,
      });
      hasCode = !!code && code !== "0x" && code.length > 4;
    } catch {
      hasCode = false;
    }
    if (!hasCode) {
      flags.push("NO_CODE");
    }

    // Get token info
    let symbol = "???";
    let decimals = 18;
    let supplyStr = "???";
    let supplyNum = 0;
    try {
      const [sym, dec, supply] = await Promise.all([
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
        client.readContract({
          address: addr as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "totalSupply",
        }),
      ]);
      symbol = sym as string;
      decimals = Number(dec);
      supplyNum = Number(supply) / 10 ** decimals;
      if (supplyNum < 1000) {
        supplyStr = supplyNum.toFixed(2);
        flags.push("LOW_SUPPLY");
      } else if (supplyNum < 1_000_000) {
        supplyStr = `${(supplyNum / 1000).toFixed(1)}k`;
        if (supplyNum < 10_000) flags.push("LOW_SUPPLY");
      } else {
        supplyStr = `${(supplyNum / 1_000_000).toFixed(2)}M`;
      }
    } catch {
      flags.push("ERC20_FAIL");
    }

    // Check oracle price
    const priceResult = await queryOraclePrice(client, cfg, addr, decimals);
    if (priceResult.raw === 0n && !priceResult.error) {
      flags.push("ORACLE_$0");
    }
    if (priceResult.error) {
      flags.push("ORACLE_ERR");
    }

    const flagStr =
      flags.length > 0 ? flags.map((f) => `[${f}]`).join(" ") : "";
    const hasIssue = flags.some(
      (f) => f !== "ORACLE_$0" || symbol !== cfg.systemToken,
    );

    console.log(
      `${addr.padEnd(44)} ${symbol.padEnd(10)} ${String(decimals).padEnd(4)} ${supplyStr.padEnd(18)} ${priceResult.usd.slice(0, 24).padEnd(24)} ${flagStr}`,
    );

    if (flags.length > 0) {
      issues.push(`  ${symbol} (${addr}): ${flags.join(", ")}`);
    }
  }

  if (issues.length > 0) {
    console.log(`\n  ISSUES FOUND:`);
    for (const issue of issues) {
      console.log(issue);
    }
  } else {
    console.log(`\n  All connectors healthy.`);
  }
}

async function main() {
  console.log("Price Connector Audit — All Chains");
  console.log(
    "Checks: bytecode exists, ERC20 readable, supply, oracle price\n",
  );

  for (const chain of CHAINS) {
    try {
      await auditChain(chain);
    } catch (e: any) {
      console.log(
        `\n${chain.name}: CHAIN AUDIT FAILED — ${e.message?.slice(0, 100)}`,
      );
    }
  }
}

main().catch(console.error);
