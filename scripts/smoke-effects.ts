/**
 * Smoke script to exercise all RPC gateway effects against a real RPC endpoint.
 *
 * Usage:
 *
 *   SMOKE_RPC_URL=https://... npx tsx scripts/smoke-effects.ts
 *
 * Uses Optimism (chainId 10) by default. Requires SMOKE_RPC_URL to be set.
 */

import "dotenv/config";
import { http, createPublicClient } from "viem";
import { optimism } from "viem/chains";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../src/Constants";
import { RPC_HTTP_OPTIONS } from "../src/Constants";
import {
  EffectType,
  type RpcGatewayOutput,
  callRpcGateway,
  rpcGateway,
} from "../src/Effects/RpcGateway";

const CHAIN_ID = 10;
const LISK_CHAIN_ID = 1135;
const MODE_CHAIN_ID = 34443;
const ROOT_FACTORY = toChecksumAddress(
  "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
);
// Lisk: WETH/LSK vAMM
const WETH_LISK = toChecksumAddress(
  "0x4200000000000000000000000000000000000006",
);
const LSK_LISK = toChecksumAddress(
  "0xac485391EB2d7D88253a7F1eF18C37f4242D1A24",
);
// Mode: ezETH/WETH sAMM
const WETH_MODE = toChecksumAddress(
  "0x4200000000000000000000000000000000000006",
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
const GAUGE_OPTIMISM = toChecksumAddress(
  "0xa75127121d28a9BF848F3B70e7Eea26570aa7700",
);
const REWARD_TOKEN_OPTIMISM = toChecksumAddress(
  "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
);
const BLOCK_NUMBER = 130_000_000;

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  const url = process.env.SMOKE_RPC_URL ?? process.env.ENVIO_OPTIMISM_RPC_URL;
  if (!url) {
    console.log(
      "Set SMOKE_RPC_URL or ENVIO_OPTIMISM_RPC_URL to run effects smoke test.",
    );
    console.log(
      "Example: SMOKE_RPC_URL=https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY pnpm run test:smoke",
    );
    process.exit(0);
  }

  const client = createPublicClient({
    chain: optimism,
    transport: http(url, RPC_HTTP_OPTIONS),
  });

  const original = CHAIN_CONSTANTS[CHAIN_ID];
  (
    CHAIN_CONSTANTS as Record<
      number,
      {
        eth_client: ReturnType<typeof createPublicClient>;
        lpHelperAddress?: string;
      }
    >
  )[CHAIN_ID] = {
    ...original,
    eth_client: client,
  } as (typeof CHAIN_CONSTANTS)[typeof CHAIN_ID];

  const context = {
    log: {
      error: (msg: string) => console.error("[error]", msg),
      warn: (msg: string) => console.warn("[warn]", msg),
      info: (msg: string) => console.info("[info]", msg),
      debug: (_msg: string) => {},
      errorWithExn: (_exn: unknown, msg: string) =>
        console.error("[error]", msg),
    },
    cache: true,
    effect: (effect: unknown, input: unknown) =>
      (
        effect as unknown as {
          handler: (args: {
            input: unknown;
            context: unknown;
          }) => Promise<unknown>;
        }
      ).handler({
        input,
        context,
      }) as Promise<RpcGatewayOutput>,
  } as Parameters<typeof callRpcGateway>[0];

  console.log("Smoke testing RPC gateway effects (Optimism, chainId 10)\n");

  await run("getTokenDetails (VELO)", async () => {
    const r = await callRpcGateway(context, {
      type: EffectType.GET_TOKEN_DETAILS,
      chainId: CHAIN_ID,
      contractAddress: REWARD_TOKEN_OPTIMISM,
    });
    if (!r?.symbol) throw new Error(`Unexpected result: ${JSON.stringify(r)}`);
    console.log(`      → ${r.name} (${r.symbol}, ${r.decimals} decimals)`);
  });

  await run("getTokenPrice (VELO)", async () => {
    const r = await callRpcGateway(context, {
      type: EffectType.GET_TOKEN_PRICE,
      tokenAddress: REWARD_TOKEN_OPTIMISM,
      chainId: CHAIN_ID,
      blockNumber: BLOCK_NUMBER,
    });
    if (r?.pricePerUSDNew === undefined)
      throw new Error(`Unexpected result: ${JSON.stringify(r)}`);
    console.log(
      `      → pricePerUSDNew: ${r.pricePerUSDNew}, type: ${r.priceOracleType}`,
    );
  });

  await run("getSwapFee", async () => {
    const r = await callRpcGateway(context, {
      type: EffectType.GET_SWAP_FEE,
      poolAddress: POOL_OPTIMISM,
      factoryAddress: CL_FACTORY_OPTIMISM,
      chainId: CHAIN_ID,
      blockNumber: BLOCK_NUMBER,
    });
    console.log(
      `      → ${r?.value !== undefined ? String(r.value) : "undefined"}`,
    );
  });

  await run("getRootPoolAddress (WETH/LSK vAMM, Lisk)", async () => {
    const r = await callRpcGateway(context, {
      type: EffectType.GET_ROOT_POOL_ADDRESS,
      chainId: LISK_CHAIN_ID,
      factory: ROOT_FACTORY,
      token0: WETH_LISK,
      token1: LSK_LISK,
      poolType: -1, // vAMM
    });
    console.log(`      → ${r?.value ?? "(empty)"}`);
  });

  await run("getRootPoolAddress (ezETH/WETH sAMM, Mode)", async () => {
    const r = await callRpcGateway(context, {
      type: EffectType.GET_ROOT_POOL_ADDRESS,
      chainId: MODE_CHAIN_ID,
      factory: ROOT_FACTORY,
      token0: EZETH_MODE,
      token1: WETH_MODE,
      poolType: 0, // sAMM
    });
    console.log(`      → ${r?.value ?? "(empty)"}`);
  });

  await run("getTokensDeposited", async () => {
    const r = await callRpcGateway(context, {
      type: EffectType.GET_TOKENS_DEPOSITED,
      rewardTokenAddress: REWARD_TOKEN_OPTIMISM,
      gaugeAddress: GAUGE_OPTIMISM,
      blockNumber: BLOCK_NUMBER,
      chainId: CHAIN_ID,
    });
    console.log(
      `      → ${r?.value !== undefined ? String(r.value) : "undefined"}`,
    );
  });

  if (original !== undefined) {
    CHAIN_CONSTANTS[CHAIN_ID] = original;
  }
  console.log("\nDone.");
}

main();
