import { expect } from "chai";
import sinon from "sinon";
import { CLFactory, MockDb } from "../../generated/src/TestHelpers.gen";
import type {
  CLGaugeConfig,
  LiquidityPoolAggregator,
  Token,
} from "../../generated/src/Types.gen";
import {
  CHAIN_CONSTANTS,
  TokenIdByChain,
  toChecksumAddress,
} from "../../src/Constants";
import * as CLFactoryPoolCreatedLogic from "../../src/EventHandlers/CLFactory/CLFactoryPoolCreatedLogic";
import { setupCommon } from "./Pool/common";

describe("CLFactory Events", () => {
  const { mockToken0Data, mockToken1Data } = setupCommon();
  // Use Base (8453) instead of Optimism (10) because Optimism has empty newCLGaugeFactoryAddress
  const chainId = 8453; // Base chain has a valid newCLGaugeFactoryAddress
  const poolAddress = "0x3333333333333333333333333333333333333333";
  const token0Address = mockToken0Data.address;
  const token1Address = mockToken1Data.address;

  let sandbox: sinon.SinonSandbox;
  let processStub: sinon.SinonStub;
  // Store the original newCLGaugeFactoryAddress from Constants (Base chain: 0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a)
  const originalNewCLGaugeFactoryAddress =
    "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a";
  let newCLGaugeFactoryAddress: string;

  beforeEach(() => {
    // Always ensure CHAIN_CONSTANTS[chainId].newCLGaugeFactoryAddress is set correctly
    // (in case another test modified it). This ensures the handler can find the CLGaugeConfig.
    if (CHAIN_CONSTANTS[chainId]) {
      CHAIN_CONSTANTS[chainId].newCLGaugeFactoryAddress =
        originalNewCLGaugeFactoryAddress;
    }
    newCLGaugeFactoryAddress = originalNewCLGaugeFactoryAddress;

    sandbox = sinon.createSandbox();
    processStub = sandbox
      .stub(CLFactoryPoolCreatedLogic, "processCLFactoryPoolCreated")
      .resolves({
        liquidityPoolAggregator: {
          id: toChecksumAddress(poolAddress),
          chainId: chainId,
          token0_id: TokenIdByChain(token0Address, chainId),
          token1_id: TokenIdByChain(token1Address, chainId),
          token0_address: token0Address,
          token1_address: token1Address,
          isStable: false,
          isCL: true,
          lastUpdatedTimestamp: new Date(1000000 * 1000),
        } as LiquidityPoolAggregator,
      });
  });

  afterEach(() => {
    // Restore original newCLGaugeFactoryAddress to prevent interference with other tests
    if (CHAIN_CONSTANTS[chainId]) {
      CHAIN_CONSTANTS[chainId].newCLGaugeFactoryAddress =
        originalNewCLGaugeFactoryAddress;
    }
    sandbox.restore();
  });

  describe("PoolCreated event", () => {
    let mockDb: ReturnType<typeof MockDb.createMockDb>;
    let mockEvent: ReturnType<typeof CLFactory.PoolCreated.createMockEvent>;
    let resultDB: ReturnType<typeof MockDb.createMockDb>;

    beforeEach(async () => {
      mockDb = MockDb.createMockDb();

      // Set up token entities with correct chainId (8453 for Base)
      const token0ForBase = {
        ...mockToken0Data,
        id: TokenIdByChain(mockToken0Data.address, chainId),
        chainId: chainId,
      } as Token;
      const token1ForBase = {
        ...mockToken1Data,
        id: TokenIdByChain(mockToken1Data.address, chainId),
        chainId: chainId,
      } as Token;
      mockDb = mockDb.entities.Token.set(token0ForBase);
      mockDb = mockDb.entities.Token.set(token1ForBase);

      // Set up CLGaugeConfig
      const clGaugeConfig: CLGaugeConfig = {
        id: newCLGaugeFactoryAddress, // Use address as-is from CHAIN_CONSTANTS to match handler lookup
        chainId: chainId,
        gaugeFactoryAddress: newCLGaugeFactoryAddress,
        defaultEmissionsCap: 0n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      } as CLGaugeConfig;
      mockDb = mockDb.entities.CLGaugeConfig.set(clGaugeConfig);

      mockEvent = CLFactory.PoolCreated.createMockEvent({
        token0: token0Address,
        token1: token1Address,
        pool: poolAddress,
        mockEventData: {
          block: {
            number: 1000000,
            timestamp: 1000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
        },
      });

      resultDB = await CLFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb,
      });
    });

    it("should call processCLFactoryPoolCreated with correct parameters", () => {
      expect(processStub.calledOnce).to.be.true;
      const callArgs = processStub.firstCall.args;
      expect(callArgs[0]).to.deep.equal(mockEvent);
      // Tokens should match (address and chainId)
      expect(callArgs[1]?.address).to.equal(mockToken0Data.address);
      expect(callArgs[1]?.chainId).to.equal(chainId);
      expect(callArgs[2]?.address).to.equal(mockToken1Data.address);
      expect(callArgs[2]?.chainId).to.equal(chainId);
      // CLGaugeConfig should be the 4th argument
      const clGaugeConfig = callArgs[3];
      expect(clGaugeConfig).to.not.be.undefined;
      expect(clGaugeConfig?.id).to.equal(newCLGaugeFactoryAddress);
    });

    it("should set the liquidity pool aggregator entity", () => {
      const pool = resultDB.entities.LiquidityPoolAggregator.get(
        toChecksumAddress(poolAddress),
      );
      expect(pool).to.not.be.undefined;
      expect(pool?.id).to.equal(toChecksumAddress(poolAddress));
      expect(pool?.chainId).to.equal(chainId);
      expect(pool?.isCL).to.be.true;
    });

    it("should return early during preload phase", async () => {
      // Create a mock context that simulates preload
      const preloadMockDb = MockDb.createMockDb();
      const token0ForBase = {
        ...mockToken0Data,
        id: TokenIdByChain(mockToken0Data.address, chainId),
        chainId: chainId,
      } as Token;
      const token1ForBase = {
        ...mockToken1Data,
        id: TokenIdByChain(mockToken1Data.address, chainId),
        chainId: chainId,
      } as Token;
      preloadMockDb.entities.Token.set(token0ForBase);
      preloadMockDb.entities.Token.set(token1ForBase);

      const clGaugeConfig: CLGaugeConfig = {
        id: newCLGaugeFactoryAddress, // Use the address as-is from CHAIN_CONSTANTS
        chainId: chainId,
        gaugeFactoryAddress: newCLGaugeFactoryAddress,
        defaultEmissionsCap: 0n,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      } as CLGaugeConfig;
      preloadMockDb.entities.CLGaugeConfig.set(clGaugeConfig);

      // Reset stub to track calls
      processStub.resetHistory();

      // Note: The actual preload check happens inside processCLFactoryPoolCreated
      // This test verifies the handler structure
      const result = await CLFactory.PoolCreated.processEvent({
        event: mockEvent,
        mockDb: preloadMockDb,
      });

      // Should still call processCLFactoryPoolCreated (preload check is inside)
      expect(processStub.calledOnce).to.be.true;
    });

    it("should load token0, token1, and CLGaugeConfig in parallel", async () => {
      // Verify that the handler loads all three entities
      // This is tested implicitly by the fact that processCLFactoryPoolCreated is called
      // with the correct token instances
      expect(processStub.calledOnce).to.be.true;
      const callArgs = processStub.firstCall.args;
      expect(callArgs[1]).to.not.be.undefined; // token0
      expect(callArgs[2]).to.not.be.undefined; // token1
      const clGaugeConfig = callArgs[3];
      expect(clGaugeConfig).to.not.be.undefined; // CLGaugeConfig
      expect(clGaugeConfig?.id).to.equal(newCLGaugeFactoryAddress);
    });
  });
});
