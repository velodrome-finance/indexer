/**
 * Confirms on-chain what a custom-fee value of 420 / 0 means for the three
 * fee-setting contracts the indexer listens to (issue: V2 custom-fee sentinels):
 *
 *   - V2 `PoolFactory.setCustomFee` / `getFee(pool, stable)`
 *   - CL `CustomSwapFeeModule.setCustomFee` / `getFee(pool)`
 *   - CL `DynamicSwapFeeModule.setCustomFee` (event `CustomFeeSet`) / `getFee(pool)`
 *
 * No pool on any indexed chain has ever been given a custom fee of 420 or 0
 * (checked over the full SetCustomFee / CustomFeeSet history with HyperSync),
 * so there is no real pool to read in either state. Instead this script takes
 * a real pool that has a custom fee, locates the `customFee` mapping slot with
 * `eth_getStorageAt`, and re-runs the contract's own `getFee` with an
 * `eth_call` state override writing 420, 0, the factory default and the real
 * value into that slot. The contract code then tells us what each value charges.
 *
 * Usage: npx -y tsx@4.19.2 scripts/verify-fee-sentinels.ts ["<target label>"]
 * Request count: printed at the end (about 15–25 per target).
 */
import "dotenv/config";
import {
  http,
  type PublicClient,
  createPublicClient,
  encodeAbiParameters,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from "viem";
import { RPC_CHAINS, resolveRpcEndpoints } from "../src/Effects/RpcConfig";

type Target = {
  label: string;
  chainId: number;
  kind: "v2" | "clCustom" | "clDynamic";
  contract: `0x${string}`;
  pool: `0x${string}`;
};

const TARGETS: Target[] = [
  {
    label: "Base V2 PoolFactory",
    chainId: 8453,
    kind: "v2",
    contract: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    pool: "0x07f78058685b75f89288f025a0a154a96021ac45",
  },
  {
    label: "Optimism V2 PoolFactory",
    chainId: 10,
    kind: "v2",
    contract: "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a",
    pool: "0xde85628bcbc392efa5d44cbfb6ebf753318a2565",
  },
  {
    label: "Base CustomSwapFeeModule",
    chainId: 8453,
    kind: "clCustom",
    contract: "0xF4171B0953b52Fa55462E4d76ecA1845Db69af00",
    pool: "0xb099c658e784b41ee435d48a8eb67e8f27285c93",
  },
  {
    label: "Optimism CustomSwapFeeModule",
    chainId: 10,
    kind: "clCustom",
    contract: "0x7361E9079920fb75496E9764A2665d8ee5049D5f",
    pool: "0xf9e06512342997ab79694a077132ce3f380144cd",
  },
  {
    label: "Base DynamicSwapFeeModule",
    chainId: 8453,
    kind: "clDynamic",
    contract: "0x090b2A6bb475c00e2256e2095A60887cD710803b",
    pool: "0xdfe5f275020def30993f042174fc2d335678b626",
  },
  {
    label: "Optimism DynamicSwapFeeModule",
    chainId: 10,
    kind: "clDynamic",
    contract: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
    pool: "0x84ce89b4f6f67e523a81a82f9f2f14d84b726f6b",
  },
];

const ABI = parseAbi([
  "function ZERO_FEE_INDICATOR() view returns (uint256)",
  "function customFee(address) view returns (uint256)",
  "function stableFee() view returns (uint256)",
  "function volatileFee() view returns (uint256)",
  "function getFee(address,bool) view returns (uint256)",
  "function factory() view returns (address)",
  "function stable() view returns (bool)",
  "function tickSpacing() view returns (int24)",
  "function tickSpacingToFee(int24) view returns (uint24)",
]);
const ABI_CL_GETFEE = parseAbi([
  "function getFee(address) view returns (uint24)",
]);

let requests = 0;
const clients = new Map<number, PublicClient>();
function client(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({
      chain: RPC_CHAINS[chainId].viemChain,
      transport: http(resolveRpcEndpoints(chainId).primary.url, {
        batch: false,
        retryCount: 1,
        onFetchRequest: () => {
          requests++;
        },
      }),
      batch: { multicall: false },
    }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

/** Storage slot of `mapping(address => …)` at declaration index `index`. */
function mappingSlot(key: `0x${string}`, index: number): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [key, BigInt(index)],
    ),
  );
}

async function run(t: Target) {
  const c = client(t.chainId);
  const read = <T>(
    address: `0x${string}`,
    functionName: string,
    args: unknown[] = [],
  ) =>
    c.readContract({
      address,
      abi: ABI,
      functionName,
      args,
    } as never) as Promise<T>;

  const block = await c.getBlockNumber();
  const zeroIndicator = await read<bigint>(t.contract, "ZERO_FEE_INDICATOR");
  const actual = await read<bigint>(t.contract, "customFee", [t.pool]);

  // Locate the customFee mapping slot by matching the stored value. CL modules
  // store a uint24, which some versions pack at offset 0 of a per-pool struct
  // (DynamicSwapFeeModule: {customFee, feeCap, scalingFactor}), so match the low
  // 24 bits and keep the upper bits intact when overriding.
  const mask = t.kind === "v2" ? (1n << 256n) - 1n : (1n << 24n) - 1n;
  let slot: `0x${string}` | undefined;
  let upperBits = 0n;
  for (let i = 0; i < 16 && !slot; i++) {
    const s = mappingSlot(t.pool, i);
    const v = await c.getStorageAt({
      address: t.contract,
      slot: s,
      blockNumber: block,
    });
    if (v && (BigInt(v) & mask) === actual && actual !== 0n) {
      slot = s;
      upperBits = BigInt(v) & ~mask;
    }
  }
  if (!slot) {
    console.log(`${t.label}: could not locate customFee slot; skipped`);
    return;
  }

  // Factory default the contract falls back to.
  let defaultFee: bigint;
  let stable = false;
  if (t.kind === "v2") {
    stable = await read<boolean>(t.pool, "stable");
    defaultFee = await read<bigint>(
      t.contract,
      stable ? "stableFee" : "volatileFee",
    );
  } else {
    const factory = await read<`0x${string}`>(t.contract, "factory");
    const ts = await read<number>(t.pool, "tickSpacing");
    defaultFee = BigInt(await read<number>(factory, "tickSpacingToFee", [ts]));
  }

  const feeWith = async (stored: bigint): Promise<bigint | string> => {
    try {
      const v = await c.readContract({
        address: t.contract,
        abi: t.kind === "v2" ? ABI : ABI_CL_GETFEE,
        functionName: "getFee",
        args: t.kind === "v2" ? [t.pool, stable] : [t.pool],
        blockNumber: block,
        stateOverride: [
          {
            address: t.contract,
            stateDiff: [
              {
                slot: slot as `0x${string}`,
                value: pad(toHex(upperBits | stored), { size: 32 }),
              },
            ],
          },
        ],
      } as never);
      return BigInt(v as bigint);
    } catch (e) {
      return `ERROR ${(e as Error).message.split("\n")[0]}`;
    }
  };

  const fActual = await feeWith(actual);
  const f420 = await feeWith(420n);
  const f0 = await feeWith(0n);
  const fDefault = await feeWith(defaultFee);
  const ok420 = f420 === 0n;
  const ok0 = f0 === fDefault;
  console.log(
    `${t.label.padEnd(30)} block=${block} ZERO_FEE_INDICATOR=${zeroIndicator} pool=${t.pool} customFee=${actual} default=${defaultFee}${t.kind === "v2" ? ` (stable=${stable})` : ""}`,
  );
  console.log(
    `${"".padEnd(30)} getFee: stored=${actual}->${fActual}  stored=420->${f420}  stored=0->${f0}  stored=default(${defaultFee})->${fDefault}  [420 means zero fee: ${ok420 ? "YES" : "NO"}; 0 means default: ${ok0 ? "YES" : "NO"}]`,
  );
}

async function main() {
  const only = process.argv[2];
  for (const t of TARGETS.filter((x) => !only || x.label === only)) {
    await run(t);
  }
  console.log(`RPC requests: ${requests}`);
}
main();
