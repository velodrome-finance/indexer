import { toChecksumAddress } from "../../src/Constants";
import { hasContractBytecode } from "../../src/Effects/Bytecode";
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
    } as never);

    const result = await mockContext.effect(hasContractBytecode as never, {
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
    });

    expect(result).toEqual({ hasCode: true });
    expect(mockContext.cache).toBeUndefined();
  });

  it("disables cache for this run when the gateway used the fail-open default (usedDefault:true)", async () => {
    mockContext.cache = undefined;
    vi.spyOn(RpcGatewayModule, "callRpcGateway").mockResolvedValue({
      hasCode: true,
      usedDefault: true,
    } as never);

    const result = await mockContext.effect(hasContractBytecode as never, {
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
    });

    expect(result).toEqual({ hasCode: true });
    expect(mockContext.cache).toBe(false);
  });

  it("does not disable cache for a real hasCode:false (EOA) result", async () => {
    mockContext.cache = undefined;
    vi.spyOn(RpcGatewayModule, "callRpcGateway").mockResolvedValue({
      hasCode: false,
      usedDefault: false,
    } as never);

    await mockContext.effect(hasContractBytecode as never, {
      address: TEST_ADDRESS,
      chainId: TEST_CHAIN_ID,
    });

    expect(mockContext.cache).toBeUndefined();
  });
});
