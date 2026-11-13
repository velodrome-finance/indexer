import { parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import { ErrorType, getErrorType } from "../../src/Effects/Helpers";
import {
  createFallbackRpcClient,
  createPrimaryRpcClient,
} from "../../src/Effects/RpcClient";

describe("RpcClient under a test runner", () => {
  it("every chain's eth_client is a lazily-resolved client (no env needed at import)", () => {
    for (const id of Object.keys(CHAIN_CONSTANTS).map(Number)) {
      expect(CHAIN_CONSTANTS[id].eth_client.chain?.id).toBe(id);
    }
  });

  it("never reaches the network: unmocked clients see an empty chain", async () => {
    const client = createPrimaryRpcClient(8453);
    expect(await client.getChainId()).toBe(8453);
    expect(
      await client.getCode({
        address: "0x000000000000000000000000000000000000dEaD",
      }),
    ).toBeUndefined();
    const err = await client
      .readContract({
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        abi: parseAbi(["function decimals() view returns (uint8)"]),
        functionName: "decimals",
      })
      .catch((e) => e);
    // Empty return data: a deterministic "no contract" answer.
    expect(getErrorType(err)).toBe(ErrorType.CONTRACT_REVERT);
  });

  it("models the OP-stack WETH predeploy as an 18-decimals token (except on Celo)", async () => {
    const abi = parseAbi(["function decimals() view returns (uint8)"]);
    const address = "0x4200000000000000000000000000000000000006";
    expect(
      await createPrimaryRpcClient(1135).readContract({
        address,
        abi,
        functionName: "decimals",
      }),
    ).toBe(18);
    expect(
      await createPrimaryRpcClient(42220).getCode({ address }),
    ).toBeUndefined();
  });

  it("other methods fail as a configuration error", async () => {
    const err = await createPrimaryRpcClient(10)
      .getBlock({ blockNumber: 1n })
      .catch((e) => e);
    expect(getErrorType(err)).toBe(ErrorType.CONFIGURATION);
  });

  it("has no fallback client unless one is injected", () => {
    expect(createFallbackRpcClient(10)).toBeNull();
    expect(createFallbackRpcClient(999999)).toBeNull();
  });

  it("rejects unknown chains", () => {
    expect(() => createPrimaryRpcClient(1)).toThrow(/No RPC configuration/);
  });
});
