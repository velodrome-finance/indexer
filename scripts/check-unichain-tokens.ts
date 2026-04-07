import { createPublicClient, http, parseAbi } from "viem";
import { unichain } from "viem/chains";

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const client = createPublicClient({
  chain: unichain,
  transport: http("https://0xrpc.io/uni", { timeout: 20000, retryCount: 2 }),
});

const addrs = [
  "0x588CE4F028D8e7B53B687865d6A67b3A54C75518",
  "0x8f187aA05619a017077f5308904739877ce9eA21",
];

async function main() {
  for (const addr of addrs) {
    try {
      const [sym, name, dec] = await Promise.all([
        client.readContract({ address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "symbol" }),
        client.readContract({ address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "name" }),
        client.readContract({ address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }),
      ]);
      const isStable = (sym as string).includes("USD") || (name as string).toLowerCase().includes("usd");
      console.log(`${addr} → ${sym} (${name}), ${dec} decimals ${isStable ? "← STABLECOIN" : ""}`);
    } catch (e) {
      console.log(`${addr} → FAILED`);
    }
  }
}
main();
