import type { PublicClient } from "viem";
import { toChecksumAddress } from "../../src/Constants";
import {
  fetchHasContractBytecode,
  hasContractBytecode,
} from "../../src/Effects/Bytecode";
import * as RpcGatewayModule from "../../src/Effects/RpcGateway";
import { type MockEffectContext, createMockEffectContext } from "./setup";

const TEST_CHAIN_ID = 10;
const TEST_ADDRESS = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);

describe("hasContractBytecode", () => {
  let mockContext: MockEffectContext;

  beforeEach(() => {
    mockContext = createMockEffectContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the gateway hasCode value and does not disable cache when usedDefault:false", async () => {
    // Start with cache undefined (Envio default = on) so we can detect any handler write to false.
    mockContext.cache = undefined;
    vi.spyOn(RpcGatewayModule, "callRpcGateway").mockResolvedValue({
      hasCode: true,
      usedDefault: false,
      errorClass: undefined,
    } as never);

    const result = await mockContext.effect(hasContractBytecode as never, {
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
    });

    expect(result).toEqual({ hasCode: true });
    expect(mockContext.cache).toBeUndefined();
  });

  it("disables cache for this run when the fail-open default fires on a transient error (usedDefault:true, NETWORK_ERROR)", async () => {
    mockContext.cache = undefined;
    vi.spyOn(RpcGatewayModule, "callRpcGateway").mockResolvedValue({
      hasCode: true,
      usedDefault: true,
      errorClass: "NETWORK_ERROR",
    } as never);

    const result = await mockContext.effect(hasContractBytecode as never, {
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
    });

    expect(result).toEqual({ hasCode: true });
    expect(mockContext.cache).toBe(false);
  });

  it("keeps cache on for deterministic-revert fallbacks (errorClass:CONTRACT_REVERT, issue #692)", async () => {
    mockContext.cache = undefined;
    vi.spyOn(RpcGatewayModule, "callRpcGateway").mockResolvedValue({
      hasCode: true,
      usedDefault: true,
      errorClass: "CONTRACT_REVERT",
    } as never);

    await mockContext.effect(hasContractBytecode as never, {
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
    });

    expect(mockContext.cache).toBeUndefined();
  });

  it("does not disable cache for a real hasCode:false (EOA) result", async () => {
    mockContext.cache = undefined;
    vi.spyOn(RpcGatewayModule, "callRpcGateway").mockResolvedValue({
      hasCode: false,
      usedDefault: false,
      errorClass: undefined,
    } as never);

    await mockContext.effect(hasContractBytecode as never, {
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
    });

    expect(mockContext.cache).toBeUndefined();
  });
});

/**
 * Issue #736: hasContractBytecode used to gate solely on `eth_getCode` length,
 * which lets non-ERC20 contracts (bytecode present but `decimals()` reverts)
 * past the gate. Verified case: 8453-0xBd0bD2F62…5528 has 44,286 bytes of
 * bytecode but all of symbol()/name()/decimals() revert. The fetcher is
 * extended to also probe decimals(); reject when bytecode exists but
 * decimals() reverts deterministically or returns a non-uint8 value.
 */
describe("fetchHasContractBytecode — ERC20-compliance probe (#736)", () => {
  let mockEthClient: PublicClient;

  beforeEach(() => {
    mockEthClient = {
      getCode: vi.fn(),
      readContract: vi.fn(),
    } as unknown as PublicClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when address has no bytecode (EOA)", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue(undefined);

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(false);
    expect(mockEthClient.readContract).not.toHaveBeenCalled();
  });

  it("returns false when eth_getCode returns '0x'", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x");

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(false);
    expect(mockEthClient.readContract).not.toHaveBeenCalled();
  });

  it("returns true when bytecode exists and decimals() returns a valid uint8", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockResolvedValue(
      18 as unknown as number,
    );

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(true);
  });

  it("returns true for legit 0-decimal tokens (e.g. IDRX)", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockResolvedValue(
      0 as unknown as number,
    );

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(true);
  });

  it("returns true at the 255 boundary", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockResolvedValue(
      255 as unknown as number,
    );

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(true);
  });

  it("returns false when bytecode exists but decimals() reverts (the #736 case)", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockRejectedValue(
      new Error("execution reverted"),
    );

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(false);
  });

  it("returns false when decimals() returns a value > 255", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockResolvedValue(
      256 as unknown as number,
    );

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(false);
  });

  it("returns false when decimals() returns a negative value", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockResolvedValue(
      -1 as unknown as number,
    );

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(false);
  });

  it("returns false when decimals() returns a non-numeric value", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockResolvedValue(
      "not a number" as unknown as number,
    );

    const result = await fetchHasContractBytecode(TEST_ADDRESS, mockEthClient);

    expect(result).toBe(false);
  });

  it("propagates transient network errors from decimals() so retry/fallback runs", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockRejectedValue(
      new Error("network error: ETIMEDOUT"),
    );

    await expect(
      fetchHasContractBytecode(TEST_ADDRESS, mockEthClient),
    ).rejects.toThrow("network error: ETIMEDOUT");
  });

  it("propagates rate-limit errors from decimals() so retry/fallback runs", async () => {
    vi.mocked(mockEthClient.getCode).mockResolvedValue("0x60806040...");
    vi.mocked(mockEthClient.readContract).mockRejectedValue(
      new Error("429 too many requests"),
    );

    await expect(
      fetchHasContractBytecode(TEST_ADDRESS, mockEthClient),
    ).rejects.toThrow("429 too many requests");
  });

  it("propagates eth_getCode RPC errors so retry/fallback runs", async () => {
    vi.mocked(mockEthClient.getCode).mockRejectedValue(
      new Error("network error: connection closed"),
    );

    await expect(
      fetchHasContractBytecode(TEST_ADDRESS, mockEthClient),
    ).rejects.toThrow("connection closed");
    expect(mockEthClient.readContract).not.toHaveBeenCalled();
  });
});
