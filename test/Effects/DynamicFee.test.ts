import { expect } from "chai";
import type { logger as Envio_logger } from "envio/src/Envio.gen";
import sinon from "sinon";
import type { PublicClient } from "viem";
import { CHAIN_CONSTANTS } from "../../src/Constants";
import {
  fetchCurrentAccumulatedFeeCL,
  fetchCurrentFee,
  getCurrentAccumulatedFeeCL,
  getCurrentFee,
} from "../../src/Effects/DynamicFee";

describe("Dynamic Fee Effects", () => {
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
  let chainConstantsStub: sinon.SinonStub;

  beforeEach(() => {
    mockEthClient = {
      simulateContract: sinon.stub().resolves({
        result: [
          "0x0000000000000000000000000000000000000000000000000000000000000190",
          "0x00000000000000000000000000000000000000000000000000000000000007d0",
          "0x0000000000000000000000000000000000000000000000000000000000989680",
        ],
      }),
    } as unknown as PublicClient;

    // Mock CHAIN_CONSTANTS by directly setting the property
    (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[10] = {
      eth_client: mockEthClient,
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
    sinon.restore();
  });

  describe("getCurrentFee", () => {
    it("should be a valid effect object", () => {
      expect(getCurrentFee).to.be.an("object");
      expect(getCurrentFee).to.have.property("name", "getCurrentFee");
    });
  });

  describe("getCurrentAccumulatedFeeCL", () => {
    it("should be a valid effect object", () => {
      expect(getCurrentAccumulatedFeeCL).to.be.an("object");
      expect(getCurrentAccumulatedFeeCL).to.have.property(
        "name",
        "getCurrentAccumulatedFeeCL",
      );
    });
  });

  describe("fetchCurrentFee", () => {
    // Define chain IDs and their corresponding dynamic fee module addresses
    const chainConfigs = [
      {
        chainId: 10,
        address: "0xd9eE4FBeE92970509ec795062cA759F8B52d6720",
        name: "Optimism",
      },
      {
        chainId: 8453,
        address: "0xDB45818A6db280ecfeB33cbeBd445423d0216b5D",
        name: "Base",
      },
      {
        chainId: 42220,
        address: "0xbcAE2d4b4E8E34a4100e69E9C73af8214a89572e",
        name: "Celo",
      },
      {
        chainId: 1868,
        address: "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F",
        name: "Soneium",
      },
      {
        chainId: 34443,
        address: "0x479Bec910d4025b4aC440ec27aCf28eac522242B",
        name: "Mode",
      },
      {
        chainId: 1135,
        address: "0xCB885Aa008031cBDb72447Bed78AF4f87a197126",
        name: "Lisk",
      },
      {
        chainId: 130,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Unichain",
      },
      {
        chainId: 252,
        address: "0xB0922e747e906B963dBdA37647DE1Aa709B35B2d",
        name: "Fraxtal",
      },
      {
        chainId: 1750,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Metal",
      },
      {
        chainId: 1923,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Swell2",
      },
      {
        chainId: 57073,
        address: "0x6812eefC19deB79D5191b52f4B763260d9F3C238",
        name: "Ink",
      },
    ];

    for (const { chainId, address, name } of chainConfigs) {
      it(`should fetch current fee for ${name} (chain ${chainId})`, async () => {
        const poolAddress = "0x1234567890123456789012345678901234567890";
        const blockNumber = 12345;

        // Mock CHAIN_CONSTANTS for this chain
        (CHAIN_CONSTANTS as Record<number, { eth_client: PublicClient }>)[
          chainId
        ] = {
          eth_client: mockEthClient,
        };

        // Reset and mock the contract response with a specific fee value
        const mockSimulateContract =
          mockEthClient.simulateContract as sinon.SinonStub;
        mockSimulateContract.reset();
        mockSimulateContract.resolves({
          result: 600n, // current fee
        });

        const result = await fetchCurrentFee(
          poolAddress,
          address, // Use the correct address for this chain
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        );

        expect(result).to.be.a("bigint");
        expect(result).to.equal(600n);

        // Verify correct contract call with chain-specific address
        expect(mockSimulateContract.calledOnce).to.be.true;
        const callArgs = mockSimulateContract.firstCall.args[0];
        // Note: viem normalizes addresses to lowercase
        expect(callArgs.address.toLowerCase()).to.equal(address.toLowerCase());
        expect(callArgs.functionName).to.equal("getFee");
        expect(callArgs.blockNumber).to.equal(BigInt(blockNumber));
        expect(callArgs.args).to.deep.equal([poolAddress]);
      });
    }

    it("should handle contract call errors", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const dynamicFeeModuleAddress =
        "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock simulateContract to throw an error
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("Contract call failed"));

      try {
        await fetchCurrentFee(
          poolAddress,
          dynamicFeeModuleAddress,
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("Contract call failed");
      }

      // Verify error was logged
      expect(mockContext.log.error).to.be.a("function");
    });
  });

  describe("fetchCurrentAccumulatedFeeCL", () => {
    it("should fetch accumulated fee for CL pool from contract", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock the contract response with specific fee values
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.resolves({
        result: [
          1000n, // token0Fees
          2000n, // token1Fees
        ],
      });

      const result = await fetchCurrentAccumulatedFeeCL(
        poolAddress,
        chainId,
        blockNumber,
        mockEthClient,
        mockContext.log,
      );

      expect(result).to.be.an("object");
      expect(result).to.have.property("token0Fees", 1000n);
      expect(result).to.have.property("token1Fees", 2000n);

      // Verify correct contract call
      expect(mockSimulateContract.calledOnce).to.be.true;
      const callArgs = mockSimulateContract.firstCall.args[0];
      expect(callArgs).to.deep.include({
        address: poolAddress,
        functionName: "gaugeFees",
        blockNumber: BigInt(blockNumber),
      });
      expect(callArgs.args).to.deep.equal([]);
    });

    it("should handle contract call errors", async () => {
      const poolAddress = "0x1234567890123456789012345678901234567890";
      const chainId = 10;
      const blockNumber = 12345;

      // Mock simulateContract to throw an error
      const mockSimulateContract =
        mockEthClient.simulateContract as sinon.SinonStub;
      mockSimulateContract.rejects(new Error("Contract call failed"));

      try {
        await fetchCurrentAccumulatedFeeCL(
          poolAddress,
          chainId,
          blockNumber,
          mockEthClient,
          mockContext.log,
        );
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal("Contract call failed");
      }

      // Verify error was logged
      expect(mockContext.log.error).to.be.a("function");
    });
  });
});
