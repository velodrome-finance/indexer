import { expect } from "chai";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import sinon from "sinon";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS, toChecksumAddress } from "../../src/Constants";
import {
  fetchRootPoolAddress,
  getRootPoolAddress,
} from "../../src/Effects/RootPool";

describe("RootPool Effects", () => {
  let mockContext: {
    effect: (
      effect: {
        name: string;
        handler: (args: { input: unknown; context: unknown }) => unknown;
      },
      input: unknown,
    ) => unknown;
    ethClient: PublicClient;
    log: Envio_logger;
  };
  let mockEthClient: PublicClient;
  let sandbox: sinon.SinonSandbox;

  const mockLpHelperAddress = "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34";
  const mockFactory = "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0";
  const mockToken0 = "0xDcc0F2D8F90FDe85b10aC1c8Ab57dc0AE946A543";
  const mockToken1 = "0xFc00000000000000000000000000000000000001";
  const mockType = 0;
  const mockRootPoolAddress = "0x98dcff98d17f21e35211c923934924af65fbdd66";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockEthClient = {
      simulateContract: sinon.stub().resolves({
        result: mockRootPoolAddress.toLowerCase(), // viem returns lowercase
      }),
    } as unknown as PublicClient;

    // Mock CHAIN_CONSTANTS for Fraxtal (chainId 252)
    (
      CHAIN_CONSTANTS as Record<
        number,
        { eth_client: PublicClient; lpHelperAddress: string }
      >
    )[252] = {
      eth_client: mockEthClient,
      lpHelperAddress: mockLpHelperAddress,
    };

    mockContext = {
      effect: (
        effect: {
          name: string;
          handler: (args: { input: unknown; context: unknown }) => unknown;
        },
        input: unknown,
      ) => effect.handler({ input, context: mockContext }),
      ethClient: mockEthClient,
      log: {
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      } as unknown as Envio_logger,
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getRootPoolAddress", () => {
    it("should be a valid effect object", () => {
      expect(getRootPoolAddress).to.be.an("object");
      expect(getRootPoolAddress).to.have.property("name", "getRootPoolAddress");
    });
  });

  describe("fetchRootPoolAddress", () => {
    it("should fetch root pool address and return checksummed format", async () => {
      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      expect(result).to.be.a("string");
      // Should return checksummed address (use actual checksummed value)
      const expectedChecksummed = toChecksumAddress(mockRootPoolAddress);
      expect(result).to.equal(expectedChecksummed);

      // Verify simulateContract was called
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      expect(mockSimulateContract.calledOnce).to.be.true;
    });

    it("should handle array result from simulateContract", async () => {
      // Mock simulateContract to return an array (some viem versions return arrays)
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: [mockRootPoolAddress.toLowerCase()], // Array with single value
      });

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      expect(result).to.be.a("string");
      const expectedChecksummed = toChecksumAddress(mockRootPoolAddress);
      expect(result).to.equal(expectedChecksummed);
    });

    it("should handle direct string result from simulateContract", async () => {
      // Mock simulateContract to return a direct string
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: mockRootPoolAddress.toLowerCase(),
      });

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      expect(result).to.be.a("string");
      const expectedChecksummed = toChecksumAddress(mockRootPoolAddress);
      expect(result).to.equal(expectedChecksummed);
    });

    it("should handle contract call errors", async () => {
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      const error = new Error("Contract call failed");
      mockSimulateContract.rejects(error);

      try {
        await fetchRootPoolAddress(
          mockEthClient,
          mockLpHelperAddress,
          mockFactory,
          mockToken0,
          mockToken1,
          mockType,
          mockContext.log,
        );
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.be.instanceOf(Error);
        expect((err as Error).message).to.include("Contract call failed");
      }
    });

    it("should normalize lowercase addresses to checksum format", async () => {
      const lowercaseAddress = "0xabcdef1234567890abcdef1234567890abcdef12";
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: lowercaseAddress,
      });

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      // Should be checksummed (use actual checksummed value)
      const expectedChecksummed = toChecksumAddress(lowercaseAddress);
      expect(result).to.equal(expectedChecksummed);
      expect(result).to.not.equal(lowercaseAddress);
    });

    it("should return empty string and log error when address is null/undefined", async () => {
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: null,
      });

      const result = await fetchRootPoolAddress(
        mockEthClient,
        mockLpHelperAddress,
        mockFactory,
        mockToken0,
        mockToken1,
        mockType,
        mockContext.log,
      );

      // Should return empty string instead of throwing
      expect(result).to.equal("");

      // Should log an error
      const errorStub = mockContext.log.error as sinon.SinonStub;
      expect(errorStub.calledOnce).to.be.true;
      expect(
        errorStub.calledWith(
          "[fetchRootPoolAddress] No root pool address found. Returning empty address",
        ),
      ).to.be.true;
    });
  });
});
