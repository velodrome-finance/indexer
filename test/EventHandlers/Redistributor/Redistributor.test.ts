import { createTestIndexer } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { simulateEvent } from "../../testHelpers";
import { type MockPool, setupCommon } from "../Pool/common";
import { makeRedistributorMockEventData } from "./common";

describe("Redistributor Event Handlers", () => {
  const { createMockPool } = setupCommon();
  const chainId = 8453; // Base
  const redistributorAddress = toChecksumAddress(
    "0xEe5b3C7b333e2870B746b3B2b168EF0958e55e15",
  );
  const gaugeAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const unknownGaugeAddress = toChecksumAddress(
    "0x9999999999999999999999999999999999999999",
  );
  const keeperAddress = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const upkeepManagerAddress = toChecksumAddress(
    "0x4444444444444444444444444444444444444444",
  );
  const senderAddress = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const txHash =
    "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca";

  const buildSimulateOpts = (overrides: {
    blockNumber: number;
    timestamp: number;
    blockHash: string;
    logIndex: number;
  }) => {
    const data = makeRedistributorMockEventData({
      ...overrides,
      chainId,
      srcAddress: redistributorAddress,
      txHash,
    });
    return {
      block: data.block,
      transaction: data.transaction,
      srcAddress: redistributorAddress,
      logIndex: data.logIndex,
    };
  };

  const seedPool = (
    existingForfeited = 0n,
    existingRedistributed = 0n,
  ): MockPool =>
    createMockPool({
      chainId,
      gaugeAddress,
      totalEmissionsForfeited: existingForfeited,
      totalEmissionsRedistributed: existingRedistributed,
    });

  describe("Deposited event", () => {
    it("increments totalEmissionsForfeited on the gauge's pool", async () => {
      const pool = seedPool(10n);
      const indexer = createTestIndexer();
      indexer.Pool.set(pool);
      const amount = 1_234_567_890_000_000_000n;

      const simOpts = buildSimulateOpts({
        blockNumber: 987654,
        timestamp: 1_700_000_000,
        blockHash:
          "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash0",
        logIndex: 7,
      });

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "Deposited",
        params: {
          gauge: gaugeAddress,
          to: redistributorAddress,
          amount,
        },
        ...simOpts,
      });

      const updatedPool = await indexer.Pool.get(pool.id);

      expect(updatedPool?.totalEmissionsForfeited).toBe(10n + amount);
      expect(updatedPool?.totalEmissionsRedistributed).toBe(0n);
      expect(updatedPool?.totalEmissions).toBe(pool.totalEmissions);
    });

    it("no-ops when the gauge does not match any pool", async () => {
      const pool = seedPool();
      const indexer = createTestIndexer();
      indexer.Pool.set(pool);

      const simOpts = buildSimulateOpts({
        blockNumber: 987654,
        timestamp: 1_700_000_050,
        blockHash:
          "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash1",
        logIndex: 1,
      });

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "Deposited",
        params: {
          gauge: unknownGaugeAddress,
          to: redistributorAddress,
          amount: 123n,
        },
        ...simOpts,
      });

      const unchangedPool = await indexer.Pool.get(pool.id);

      expect(unchangedPool?.totalEmissionsForfeited).toBe(0n);
      expect(unchangedPool?.totalEmissionsRedistributed).toBe(0n);
      // Guard against the handler synthesising a pool entity on gauge miss.
      expect(Array.from(await indexer.Pool.getAll()).length).toBe(1);
    });
  });

  describe("Redistributed event", () => {
    it("increments totalEmissionsRedistributed on the gauge's pool", async () => {
      const pool = seedPool(0n, 3n);
      const indexer = createTestIndexer();
      indexer.Pool.set(pool);
      const amount = 42_000_000_000_000_000_000n;

      const simOpts = buildSimulateOpts({
        blockNumber: 987700,
        timestamp: 1_700_000_100,
        blockHash:
          "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash2",
        logIndex: 12,
      });

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "Redistributed",
        params: {
          sender: senderAddress,
          gauge: gaugeAddress,
          amount,
        },
        ...simOpts,
      });

      const updatedPool = await indexer.Pool.get(pool.id);

      expect(updatedPool?.totalEmissionsRedistributed).toBe(3n + amount);
      expect(updatedPool?.totalEmissionsForfeited).toBe(0n);
      expect(updatedPool?.totalEmissions).toBe(pool.totalEmissions);
    });

    it("accumulates across multiple Redistributed events in the same tx", async () => {
      const pool = seedPool();
      const indexer = createTestIndexer();
      indexer.Pool.set(pool);

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "Redistributed",
        params: {
          sender: senderAddress,
          gauge: gaugeAddress,
          amount: 1n,
        },
        ...buildSimulateOpts({
          blockNumber: 1,
          timestamp: 1_700_000_200,
          blockHash:
            "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash3",
          logIndex: 1,
        }),
      });

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "Redistributed",
        params: {
          sender: senderAddress,
          gauge: gaugeAddress,
          amount: 2n,
        },
        ...buildSimulateOpts({
          blockNumber: 1,
          timestamp: 1_700_000_200,
          blockHash:
            "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash3",
          logIndex: 2,
        }),
      });

      const updatedPool = await indexer.Pool.get(pool.id);

      expect(updatedPool?.totalEmissionsRedistributed).toBe(3n);
    });
  });

  describe("SetKeeper / SetUpkeepManager", () => {
    it("SetKeeper creates a RedistributorConfig with keeper set and upkeepManager empty", async () => {
      const indexer = createTestIndexer();
      const blockTimestamp = 1_700_000_300;

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "SetKeeper",
        params: {
          keeper: keeperAddress,
        },
        ...buildSimulateOpts({
          blockNumber: 10,
          timestamp: blockTimestamp,
          blockHash:
            "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash4",
          logIndex: 1,
        }),
      });

      const configId = `${chainId}-${redistributorAddress}`;
      const config = await indexer.RedistributorConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.chainId).toBe(chainId);
      expect(config?.redistributorAddress).toBe(redistributorAddress);
      expect(config?.keeper).toBe(keeperAddress);
      expect(config?.upkeepManager).toBe("");
      expect(
        new Date(config?.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(blockTimestamp * 1000).getTime());
    });

    it("SetUpkeepManager after SetKeeper preserves the keeper and updates only upkeepManager", async () => {
      const indexer = createTestIndexer();
      const firstTs = 1_700_000_400;
      const secondTs = 1_700_000_500;

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "SetKeeper",
        params: {
          keeper: keeperAddress,
        },
        ...buildSimulateOpts({
          blockNumber: 20,
          timestamp: firstTs,
          blockHash:
            "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash5",
          logIndex: 1,
        }),
      });

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "SetUpkeepManager",
        params: {
          upkeepManager: upkeepManagerAddress,
        },
        ...buildSimulateOpts({
          blockNumber: 21,
          timestamp: secondTs,
          blockHash:
            "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash6",
          logIndex: 1,
        }),
      });

      const configId = `${chainId}-${redistributorAddress}`;
      const config = await indexer.RedistributorConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.keeper).toBe(keeperAddress);
      expect(config?.upkeepManager).toBe(upkeepManagerAddress);
      expect(
        new Date(config?.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(secondTs * 1000).getTime());
    });

    it("SetUpkeepManager before SetKeeper seeds the config with keeper empty and later SetKeeper preserves upkeepManager", async () => {
      const indexer = createTestIndexer();
      const firstTs = 1_700_000_600;
      const secondTs = 1_700_000_700;

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "SetUpkeepManager",
        params: {
          upkeepManager: upkeepManagerAddress,
        },
        ...buildSimulateOpts({
          blockNumber: 30,
          timestamp: firstTs,
          blockHash:
            "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash7",
          logIndex: 1,
        }),
      });

      await simulateEvent(indexer, chainId, {
        contract: "Redistributor",
        event: "SetKeeper",
        params: {
          keeper: keeperAddress,
        },
        ...buildSimulateOpts({
          blockNumber: 31,
          timestamp: secondTs,
          blockHash:
            "0xblockhashblockhashblockhashblockhashblockhashblockhashblockhash8",
          logIndex: 1,
        }),
      });

      const configId = `${chainId}-${redistributorAddress}`;
      const config = await indexer.RedistributorConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.keeper).toBe(keeperAddress);
      expect(config?.upkeepManager).toBe(upkeepManagerAddress);
      expect(
        new Date(config?.lastUpdatedTimestamp as unknown as string).getTime(),
      ).toBe(new Date(secondTs * 1000).getTime());
    });
  });
});
