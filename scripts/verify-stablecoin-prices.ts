/**
 * Verify stablecoin hardcoding + connector fixes produce correct USD values.
 * Tests both early blocks (oracle bootstrap gaps) and recent blocks.
 * Usage: pnpm tsx scripts/verify-stablecoin-prices.ts
 */
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
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
import StablecoinsJson from "../src/constants/stablecoins.json";

const ORACLE_ABI = parseAbi([
  "function getManyRatesWithCustomConnectors(address[] srcTokens, address dstToken, bool useWrappers, address[] customConnectors, uint256 thresholdFilter) view returns (uint256[])",
]);

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

interface ChainCfg {
  name: string;
  chainId: number;
  chain: Parameters<typeof createPublicClient>[0]["chain"];
  rpc: string;
  oracle: string;
  oracleStartBlock: number;
  destToken: string;
  destDecimals: number;
  weth: string;
  systemToken: string;
  connectors: { address: string; createdBlock: number }[];
  stablecoins: string[];
}

const CHAINS: ChainCfg[] = [
  {
    name: "Celo",
    chainId: 42220,
    chain: celo,
    rpc: "https://celo.drpc.org",
    oracle: "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327",
    oracleStartBlock: 31690441,
    destToken: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    destDecimals: 6,
    weth: "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.celo,
    stablecoins: StablecoinsJson.celo,
  },
  {
    name: "Swell",
    chainId: 1923,
    chain: swellchain,
    rpc: "https://rpc.ankr.com/swell",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    oracleStartBlock: 3733759,
    destToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    destDecimals: 18,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.swellchain,
    stablecoins: StablecoinsJson.swellchain,
  },
  {
    name: "Soneium",
    chainId: 1868,
    chain: soneium,
    rpc: "https://soneium.drpc.org",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    oracleStartBlock: 1863998,
    destToken: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.soneium,
    stablecoins: StablecoinsJson.soneium,
  },
  {
    name: "Optimism",
    chainId: 10,
    chain: optimism,
    rpc: "https://mainnet.optimism.io",
    oracle: "0x59114D308C6DE4A84F5F8cD80485a5481047b99f",
    oracleStartBlock: 105896796,
    destToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    connectors: PriceConnectors.optimism,
    stablecoins: StablecoinsJson.optimism,
  },
  {
    name: "Base",
    chainId: 8453,
    chain: base,
    rpc: "https://base-rpc.publicnode.com",
    oracle: "0x8456038bdae8672f552182B0FC39b1917dE9a41A",
    oracleStartBlock: 3200550,
    destToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    connectors: PriceConnectors.base,
    stablecoins: StablecoinsJson.base,
  },
  {
    name: "Mode",
    chainId: 34443,
    chain: mode,
    rpc: "https://1rpc.io/mode",
    oracle: "0xbAEe949B52cb503e39f1Df54Dcee778da59E11bc",
    oracleStartBlock: 7103932,
    destToken: "0xd988097fb8612cc24eeC14542bC03424c656005f",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0xDfc7C877a950e49D2610114102175A06C2e3167a",
    connectors: PriceConnectors.mode,
    stablecoins: StablecoinsJson.mode,
  },
  {
    name: "Lisk",
    chainId: 1135,
    chain: lisk,
    rpc: "https://lisk.drpc.org",
    oracle: "0x024503003fFE9AF285f47c1DaAaA497D9f1166D0",
    oracleStartBlock: 1639961,
    destToken: "0x05D032ac25d322df992303dCa074EE7392C117b9",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.lisk,
    stablecoins: StablecoinsJson.lisk,
  },
  {
    name: "Fraxtal",
    chainId: 252,
    chain: fraxtal,
    rpc: "https://fraxtal.drpc.org",
    oracle: "0x4817f8D70aE32Ee96e5E6BFA24eb7Fcfa83bbf29",
    oracleStartBlock: 1,
    destToken: "0xFc00000000000000000000000000000000000001",
    destDecimals: 18,
    weth: "0xFC00000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.fraxtal,
    stablecoins: StablecoinsJson.fraxtal,
  },
  {
    name: "Ink",
    chainId: 57073,
    chain: ink,
    rpc: "https://ink.drpc.org",
    oracle: "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE",
    oracleStartBlock: 3361885,
    destToken: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.ink,
    stablecoins: StablecoinsJson.ink,
  },
  {
    name: "Metal",
    chainId: 1750,
    chain: metalL2,
    rpc: "https://metall2.drpc.org",
    oracle: "0x3e71CCdf495d9628D3655A600Bcad3afF2ddea98",
    oracleStartBlock: 11438647,
    destToken: "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189",
    destDecimals: 6,
    weth: "0x4200000000000000000000000000000000000006",
    systemToken: "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
    connectors: PriceConnectors.metal,
    stablecoins: StablecoinsJson.metal,
  },
];

// Simulate handleGetTokenPrice logic
async function simulateGetTokenPrice(
  client: ReturnType<typeof createPublicClient>,
  cfg: ChainCfg,
  tokenAddress: string,
  blockNumber: number | "latest",
): Promise<{
  price: string;
  source: string;
  raw: bigint;
}> {
  const lowerToken = tokenAddress.toLowerCase();

  // 1. Destination token check
  if (lowerToken === cfg.destToken.toLowerCase()) {
    return { price: "$1.00", source: "DESTINATION_HARDCODE", raw: 10n ** 18n };
  }

  // 2. Stablecoin hardcode check (NEW)
  const stableSet = new Set(cfg.stablecoins.map((s) => s.toLowerCase()));
  if (stableSet.has(lowerToken)) {
    return { price: "$1.00", source: "STABLECOIN_HARDCODE", raw: 10n ** 18n };
  }

  // 3. Oracle check (if deployed at this block)
  if (
    typeof blockNumber === "number" &&
    blockNumber < cfg.oracleStartBlock
  ) {
    return { price: "$0.00", source: "ORACLE_NOT_DEPLOYED", raw: 0n };
  }

  // Get token decimals
  let tokenDecimals = 18;
  try {
    tokenDecimals = Number(
      await client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    );
  } catch {}

  // Build connector array (same as handleGetTokenPrice)
  const filteredConnectors = cfg.connectors
    .map((c) => c.address)
    .filter((a) => a.toLowerCase() !== lowerToken)
    .filter((a) => a.toLowerCase() !== cfg.weth.toLowerCase())
    .filter((a) => a.toLowerCase() !== cfg.destToken.toLowerCase())
    .filter((a) => a.toLowerCase() !== cfg.systemToken.toLowerCase());

  const connectorArray = [
    ...filteredConnectors,
    cfg.systemToken,
    cfg.weth,
    cfg.destToken,
  ];

  try {
    const blockParam =
      blockNumber === "latest" ? {} : { blockNumber: BigInt(blockNumber) };
    const result = await client.readContract({
      address: cfg.oracle as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "getManyRatesWithCustomConnectors",
      args: [[tokenAddress], cfg.destToken, false, connectorArray, 10],
      ...blockParam,
    });
    const rawPrice = BigInt((result as bigint[])[0]);
    // V3/V4 adjustment: (rawPrice * 10^tokenDecimals) / 10^destDecimals
    const adjusted =
      (rawPrice * 10n ** BigInt(tokenDecimals)) /
      10n ** BigInt(cfg.destDecimals);
    const usd = Number(formatUnits(adjusted, 18));
    return {
      price: `$${usd.toFixed(4)}`,
      source: rawPrice === 0n ? "ORACLE_$0" : "ORACLE",
      raw: adjusted,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message.slice(0, 60) : String(e);
    return { price: "ERROR", source: `ORACLE_ERR: ${msg}`, raw: 0n };
  }
}

async function getSymbol(
  client: ReturnType<typeof createPublicClient>,
  addr: string,
): Promise<string> {
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

async function verifyChain(cfg: ChainCfg) {
  console.log(`\n${"=".repeat(90)}`);
  console.log(`${cfg.name} (chainId ${cfg.chainId})`);
  console.log(`${"=".repeat(90)}`);

  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc, { timeout: 30000, retryCount: 3 }),
  });

  // Get latest block
  let latestBlock: number;
  try {
    latestBlock = Number(await client.getBlockNumber());
  } catch {
    console.log("  SKIP: RPC unreachable");
    return;
  }

  const earlyBlock = cfg.oracleStartBlock + 100;
  const issues: string[] = [];

  // --- Verify stablecoins (hardcoded) ---
  console.log(`\n  STABLECOINS (${cfg.stablecoins.length} hardcoded):`);
  if (cfg.stablecoins.length === 0) {
    console.log("    (none)");
  }
  for (const addr of cfg.stablecoins) {
    const sym = await getSymbol(client, addr);

    // At early block: would have been $0 from oracle, now $1 from hardcode
    const earlyResult = await simulateGetTokenPrice(
      client,
      cfg,
      addr,
      earlyBlock,
    );
    // At latest block
    const latestResult = await simulateGetTokenPrice(
      client,
      cfg,
      addr,
      "latest",
    );

    const earlyOk = earlyResult.source === "STABLECOIN_HARDCODE";
    const latestOk = latestResult.source === "STABLECOIN_HARDCODE";

    console.log(
      `    ${sym.padEnd(8)} ${addr.slice(0, 10)}... | early: ${earlyResult.price} (${earlyResult.source}) | latest: ${latestResult.price} (${latestResult.source}) | ${earlyOk && latestOk ? "OK" : "ISSUE"}`,
    );
    if (!earlyOk || !latestOk)
      issues.push(`${sym} not using hardcode path`);
  }

  // --- Verify destination token ---
  console.log("\n  DESTINATION TOKEN:");
  const destSym = await getSymbol(client, cfg.destToken);
  const destResult = await simulateGetTokenPrice(
    client,
    cfg,
    cfg.destToken,
    "latest",
  );
  const destOk = destResult.source === "DESTINATION_HARDCODE";
  console.log(
    `    ${destSym.padEnd(8)} ${cfg.destToken.slice(0, 10)}... | ${destResult.price} (${destResult.source}) | ${destOk ? "OK" : "ISSUE"}`,
  );
  if (!destOk) issues.push(`dest token ${destSym} not using hardcode path`);

  // --- Verify non-stablecoin tokens via oracle (WETH + system token) ---
  console.log("\n  NON-STABLECOIN (oracle path):");
  const tokensToCheck = [
    { addr: cfg.weth, label: "WETH" },
    { addr: cfg.systemToken, label: "SYS" },
  ];

  for (const { addr, label } of tokensToCheck) {
    // Skip if it's the destination token
    if (addr.toLowerCase() === cfg.destToken.toLowerCase()) {
      console.log(`    ${label.padEnd(8)} (is destination, skip oracle)`);
      continue;
    }
    const sym = await getSymbol(client, addr);

    // Early block (oracle just deployed)
    const earlyResult = await simulateGetTokenPrice(
      client,
      cfg,
      addr,
      earlyBlock,
    );
    // Latest block
    const latestResult = await simulateGetTokenPrice(
      client,
      cfg,
      addr,
      "latest",
    );

    const latestUsd = Number(formatUnits(latestResult.raw, 18));
    const latestOk =
      latestResult.source === "ORACLE" && latestUsd > 0;

    console.log(
      `    ${(sym || label).padEnd(8)} ${addr.slice(0, 10)}... | early: ${earlyResult.price} (${earlyResult.source}) | latest: ${latestResult.price} (${latestResult.source}) | ${latestOk ? "OK" : latestResult.source.includes("$0") ? "WARN:$0" : "WARN"}`,
    );
    if (!latestOk && latestResult.source !== "ORACLE_ERR")
      issues.push(`${sym || label}: oracle returned $0 at latest block`);
  }

  // --- Specifically check previously-broken tokens ---
  const specialChecks: { addr: string; label: string }[] = [];
  if (cfg.name === "Celo") {
    // Real USDC that was missing from connectors
    specialChecks.push({
      addr: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      label: "USDC(real)",
    });
    // CELO native token
    specialChecks.push({
      addr: "0x471EcE3750Da237f93B8E339c536989b8978a438",
      label: "CELO",
    });
  }
  if (cfg.name === "Swell") {
    // rUSDC (new connector)
    specialChecks.push({
      addr: "0x9ab96A4668456896d45c301Bc3A15Cee76AA7B8D",
      label: "rUSDC",
    });
  }

  if (specialChecks.length > 0) {
    console.log("\n  SPECIAL CHECKS (previously broken):");
    for (const { addr, label } of specialChecks) {
      const sym = await getSymbol(client, addr);
      const latestResult = await simulateGetTokenPrice(
        client,
        cfg,
        addr,
        "latest",
      );
      const earlyResult = await simulateGetTokenPrice(
        client,
        cfg,
        addr,
        earlyBlock,
      );

      console.log(
        `    ${(sym || label).padEnd(8)} ${addr.slice(0, 10)}... | early: ${earlyResult.price} (${earlyResult.source}) | latest: ${latestResult.price} (${latestResult.source})`,
      );
    }
  }

  if (issues.length > 0) {
    console.log(`\n  ISSUES: ${issues.join("; ")}`);
  } else {
    console.log("\n  All checks passed.");
  }
}

async function main() {
  console.log("Stablecoin Price Verification");
  console.log("Simulates handleGetTokenPrice logic with hardcode + oracle\n");

  for (const chain of CHAINS) {
    try {
      await verifyChain(chain);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.slice(0, 100) : String(e);
      console.log(`\n${chain.name}: VERIFICATION FAILED — ${msg}`);
    }
  }
}

main().catch(console.error);
