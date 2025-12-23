import { FactoryRegistry, MockDb } from "../../generated/src/TestHelpers.gen";
import { toChecksumAddress } from "../../src/Constants";

describe("FactoryRegistry Events", () => {
  const factoryRegistryAddress = toChecksumAddress(
    "0xF4c67CdEAaB8360370F41514d06e32CcD8aA1d7B",
  );
  const poolFactoryAddress = toChecksumAddress(
    "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a",
  );
  const votingRewardsFactoryAddress = toChecksumAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const gaugeFactoryAddress = toChecksumAddress(
    "0x2222222222222222222222222222222222222222",
  );
  const chainId = 10;

  describe("Approve event", () => {
    it("should create FactoryRegistryConfig with approved factories", async () => {
      // Setup
      const mockDb = MockDb.createMockDb();
      const blockTimestamp = 1000000;
      const mockEvent = FactoryRegistry.Approve.createMockEvent({
        poolFactory: poolFactoryAddress,
        votingRewardsFactory: votingRewardsFactoryAddress,
        gaugeFactory: gaugeFactoryAddress,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: 123456,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: factoryRegistryAddress,
        },
      });

      // Execute
      const result = await FactoryRegistry.Approve.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check FactoryRegistryConfig was created
      const configId = `${factoryRegistryAddress}_${chainId}`;
      const config = result.entities.FactoryRegistryConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.id).toBe(configId);
      expect(config?.currentActivePoolFactory).toBe(poolFactoryAddress);
      expect(config?.currentActiveVotingRewardsFactory).toBe(
        votingRewardsFactoryAddress,
      );
      expect(config?.currentActiveGaugeFactory).toBe(gaugeFactoryAddress);
      expect(config?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
    });

    it("should update existing FactoryRegistryConfig with new approved factories", async () => {
      // Setup - create existing config
      let mockDb = MockDb.createMockDb();
      const configId = `${factoryRegistryAddress}_${chainId}`;
      const existingConfig = {
        id: configId,
        currentActivePoolFactory: toChecksumAddress(
          "0x3333333333333333333333333333333333333333",
        ),
        currentActiveVotingRewardsFactory: toChecksumAddress(
          "0x4444444444444444444444444444444444444444",
        ),
        currentActiveGaugeFactory: toChecksumAddress(
          "0x5555555555555555555555555555555555555555",
        ),
        lastUpdatedTimestamp: new Date(900000 * 1000),
      };
      mockDb = mockDb.entities.FactoryRegistryConfig.set(existingConfig);

      const blockTimestamp = 2000000;
      const mockEvent = FactoryRegistry.Approve.createMockEvent({
        poolFactory: poolFactoryAddress,
        votingRewardsFactory: votingRewardsFactoryAddress,
        gaugeFactory: gaugeFactoryAddress,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: 2000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: factoryRegistryAddress,
        },
      });

      // Execute
      const result = await FactoryRegistry.Approve.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check FactoryRegistryConfig was updated
      const config = result.entities.FactoryRegistryConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.currentActivePoolFactory).toBe(poolFactoryAddress);
      expect(config?.currentActiveVotingRewardsFactory).toBe(
        votingRewardsFactoryAddress,
      );
      expect(config?.currentActiveGaugeFactory).toBe(gaugeFactoryAddress);
      expect(config?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
      // Verify ID is preserved
      expect(config?.id).toBe(configId);
    });
  });

  describe("Unapprove event", () => {
    it("should clear factory addresses in FactoryRegistryConfig", async () => {
      // Setup - create existing config
      let mockDb = MockDb.createMockDb();
      const configId = `${factoryRegistryAddress}_${chainId}`;
      const existingConfig = {
        id: configId,
        currentActivePoolFactory: poolFactoryAddress,
        currentActiveVotingRewardsFactory: votingRewardsFactoryAddress,
        currentActiveGaugeFactory: gaugeFactoryAddress,
        lastUpdatedTimestamp: new Date(1000000 * 1000),
      };
      mockDb = mockDb.entities.FactoryRegistryConfig.set(existingConfig);

      const blockTimestamp = 2000000;
      const mockEvent = FactoryRegistry.Unapprove.createMockEvent({
        poolFactory: poolFactoryAddress,
        votingRewardsFactory: votingRewardsFactoryAddress,
        gaugeFactory: gaugeFactoryAddress,
        mockEventData: {
          block: {
            timestamp: blockTimestamp,
            number: 2000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: factoryRegistryAddress,
        },
      });

      // Execute
      const result = await FactoryRegistry.Unapprove.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - check FactoryRegistryConfig was updated with empty addresses
      const config = result.entities.FactoryRegistryConfig.get(configId);
      expect(config).toBeDefined();
      expect(config?.currentActivePoolFactory).toBe("");
      expect(config?.currentActiveVotingRewardsFactory).toBe("");
      expect(config?.currentActiveGaugeFactory).toBe("");
      expect(config?.lastUpdatedTimestamp).toEqual(
        new Date(blockTimestamp * 1000),
      );
      // Verify ID is preserved
      expect(config?.id).toBe(configId);
    });

    it("should log warning and return early if FactoryRegistryConfig does not exist", async () => {
      // Setup - no config in mock DB
      const mockDb = MockDb.createMockDb();
      const configId = `${factoryRegistryAddress}_${chainId}`;

      const mockEvent = FactoryRegistry.Unapprove.createMockEvent({
        poolFactory: poolFactoryAddress,
        votingRewardsFactory: votingRewardsFactoryAddress,
        gaugeFactory: gaugeFactoryAddress,
        mockEventData: {
          block: {
            timestamp: 2000000,
            number: 2000000,
            hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
          },
          chainId: chainId,
          logIndex: 1,
          srcAddress: factoryRegistryAddress,
        },
      });

      // Execute
      const result = await FactoryRegistry.Unapprove.processEvent({
        event: mockEvent,
        mockDb,
      });

      // Assert - config should not be created
      const config = result.entities.FactoryRegistryConfig.get(configId);
      expect(config).toBeUndefined();
    });
  });
});
