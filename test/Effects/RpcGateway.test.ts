import type { PublicClient } from "viem";
import {
  CHAIN_CONSTANTS,
  VERY_SLOW_REQUEST_MS,
  toChecksumAddress,
} from "../../src/Constants";
import * as Helpers from "../../src/Effects/Helpers";
import { rpcGateway } from "../../src/Effects/RpcGateway";
import {
  type MockEffect,
  type MockEffectContext,
  createMockEffectContext,
} from "./setup";

const TEST_CHAIN_ID = 10;
const TEST_CONTRACT_ADDRESS = toChecksumAddress(
  "0x1234567890123456789012345678901234567890",
);

describe("RpcGateway", () => {
  let mockContext: MockEffectContext;
  let mockEthClient: PublicClient;
  let originalChainEntry: (typeof CHAIN_CONSTANTS)[typeof TEST_CHAIN_ID];

  beforeEach(() => {
    vi.spyOn(Helpers, "sleep").mockResolvedValue(undefined);

    mockEthClient = {
      readContract: vi.fn(),
    } as unknown as PublicClient;

    originalChainEntry = CHAIN_CONSTANTS[TEST_CHAIN_ID];
    (
      CHAIN_CONSTANTS as Record<
        number,
        { eth_client: PublicClient; lpHelperAddress?: string }
      >
    )[TEST_CHAIN_ID] = {
      eth_client: mockEthClient,
      lpHelperAddress: toChecksumAddress(
        "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34",
      ),
    };

    mockContext = createMockEffectContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalChainEntry !== undefined) {
      CHAIN_CONSTANTS[TEST_CHAIN_ID] = originalChainEntry;
    } else {
      delete (CHAIN_CONSTANTS as Record<number, unknown>)[TEST_CHAIN_ID];
    }
  });

  describe("rpcGateway effect handler", () => {
    it("should return token details on getTokenDetails success", async () => {
      const readContract = vi.mocked(mockEthClient.readContract);
      readContract
        .mockResolvedValueOnce("Test Token")
        .mockResolvedValueOnce(18)
        .mockResolvedValueOnce("TKN");

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toMatchObject({
        name: "Test Token",
        decimals: 18,
        symbol: "TKN",
      });
      expect(readContract).toHaveBeenCalledTimes(3);
    });

    it("should return fallback for getTokenDetails when RPC throws (executeRpcWithFallback path)", async () => {
      vi.mocked(mockEthClient.readContract).mockRejectedValue(
        new Error("execution reverted"),
      );

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toEqual({
        name: "",
        decimals: 0,
        symbol: "",
      });
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("rpcGateway.getTokenDetails"),
        expect.any(Error),
      );
    });

    it("should log and return undefined for unexpected input type (default branch)", async () => {
      const badInput = {
        type: "unexpectedType",
        chainId: TEST_CHAIN_ID,
      } as unknown as Parameters<MockEffect["handler"]>[0]["input"];

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: badInput,
        context: mockContext,
      });

      expect(result).toBeUndefined();
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      expect(mockContext.log.error).toHaveBeenCalledWith(
        "rpcGateway: unexpected input type",
        expect.any(Error),
      );
    });

    it("should log very slow request via log.error when getTokenDetails exceeds VERY_SLOW_REQUEST_MS", async () => {
      const readContract = vi.mocked(mockEthClient.readContract);
      readContract
        .mockResolvedValueOnce("Slow")
        .mockResolvedValueOnce(18)
        .mockResolvedValueOnce("TKN");

      const t0 = 1000000;
      const verySlowMs = VERY_SLOW_REQUEST_MS + 1;
      let dateNowCalls = 0;
      vi.spyOn(Date, "now").mockImplementation(() =>
        ++dateNowCalls === 1 ? t0 : t0 + verySlowMs,
      );

      const result = await (
        rpcGateway as unknown as { handler: MockEffect["handler"] }
      ).handler({
        input: {
          type: "getTokenDetails",
          chainId: TEST_CHAIN_ID,
          contractAddress: TEST_CONTRACT_ADDRESS,
        },
        context: mockContext,
      });

      expect(result).toMatchObject({
        name: "Slow",
        decimals: 18,
        symbol: "TKN",
      });
      expect(mockContext.log.error).toHaveBeenCalledTimes(1);
      expect(mockContext.log.error).toHaveBeenCalledWith(
        expect.stringContaining("Very slow request"),
        expect.any(Error),
      );
    });
  });
});
