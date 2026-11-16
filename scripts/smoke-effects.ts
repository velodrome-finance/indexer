/**
 * Smoke script: runs every RPC-backed effect handler once against the RPC
 * endpoints configured in the environment (see README "RPC configuration"),
 * through the same retry/fallback/rate-limit path the indexer uses.
 *
 * Usage:
 *
 *   npx -y tsx@4.19.2 scripts/smoke-effects.ts
 *
 * Needs ENVIO_DRPC_API_KEY or ENVIO_OPTIMISM/LISK/MODE_RPC_URL. About 15 requests.
 */

import "dotenv/config";
import { toChecksumAddress } from "../src/Constants";
import { hasContractBytecode } from "../src/Effects/Bytecode";
import { getRootPoolAddress } from "../src/Effects/RootPool";
import { getRpcStats } from "../src/Effects/RpcGateway";
import { getSwapFee } from "../src/Effects/SwapFee";
import { getTokenDetails, getTokenPrice } from "../src/Effects/Token";
import { getTokenMetadata } from "../src/Effects/TokenMetadata";

const CHAIN_ID = 10;
const LISK_CHAIN_ID = 1135;
const MODE_CHAIN_ID = 34443;
const ROOT_FACTORY = toChecksumAddress(
  "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
);
const WETH = toChecksumAddress("0x4200000000000000000000000000000000000006");
const LSK_LISK = toChecksumAddress(
  "0xac485391EB2d7D88253a7F1eF18C37f4242D1A24",
);
const EZETH_MODE = toChecksumAddress(
  "0x2416092f143378750bb29b79eD961ab195CcEea5",
);
const CL_FACTORY_OPTIMISM = toChecksumAddress(
  "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F",
);
const POOL_OPTIMISM = toChecksumAddress(
  "0x478946bcd4a5a22b316470f5486fafb928c0ba25",
);
const VELO = toChecksumAddress("0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db");
const BLOCK_NUMBER = 130_000_000;

type Handler = {
  handler: (a: { input: unknown; context: unknown }) => Promise<unknown>;
};

const log = {
  error: (msg: string) => console.error("    [error]", msg),
  warn: (msg: string) => console.warn("    [warn]", msg),
  info: (msg: string) => console.info("    [info]", msg),
  debug: () => {},
};

/** Envio-like context: each nested effect call gets its own `cache` flag. */
function makeContext(): { cache: boolean; log: typeof log; effect: unknown } {
  const ctx = {
    cache: true,
    log,
    effect: (effect: unknown, input: unknown) =>
      (effect as Handler).handler({ input, context: makeContext() }),
  };
  return ctx;
}

async function run(name: string, effect: unknown, input: unknown) {
  const context = makeContext();
  try {
    const out = await (effect as Handler).handler({ input, context });
    console.log(
      `  ok  ${name} -> ${JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v))} (cache=${context.cache})`,
    );
  } catch (err) {
    console.error(`  ERR ${name}:`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  console.log("Smoke testing RPC effects\n");
  await run("getTokenMetadata (VELO)", getTokenMetadata, {
    address: VELO,
    chainId: CHAIN_ID,
  });
  await run("getTokenDetails (VELO)", getTokenDetails, {
    contractAddress: VELO,
    chainId: CHAIN_ID,
  });
  await run("hasContractBytecode (VELO)", hasContractBytecode, {
    address: VELO,
    chainId: CHAIN_ID,
  });
  await run("getTokenPrice (VELO)", getTokenPrice, {
    tokenAddress: VELO,
    chainId: CHAIN_ID,
    blockNumber: BLOCK_NUMBER,
    tokenDecimals: 18,
  });
  await run("getSwapFee", getSwapFee, {
    poolAddress: POOL_OPTIMISM,
    factoryAddress: CL_FACTORY_OPTIMISM,
    chainId: CHAIN_ID,
    blockNumber: BLOCK_NUMBER,
  });
  await run("getRootPoolAddress (WETH/LSK vAMM, Lisk)", getRootPoolAddress, {
    chainId: LISK_CHAIN_ID,
    factory: ROOT_FACTORY,
    token0: WETH,
    token1: LSK_LISK,
    type: -1,
  });
  await run("getRootPoolAddress (ezETH/WETH sAMM, Mode)", getRootPoolAddress, {
    chainId: MODE_CHAIN_ID,
    factory: ROOT_FACTORY,
    token0: EZETH_MODE,
    token1: WETH,
    type: 0,
  });
  console.log("\nRPC stats:", JSON.stringify(getRpcStats()));
}

main();
