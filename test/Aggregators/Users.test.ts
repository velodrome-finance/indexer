import { expect } from "chai";
import type { User, handlerContext } from "generated";
import {
  createUserEntity,
  updateUserFeeContribution,
} from "../../src/Aggregators/Users";

describe("Users Aggregator", () => {
  const mockUserAddress = "0x1234567890123456789012345678901234567890";
  const mockChainId = 10;
  const mockTimestamp = new Date(1000000 * 1000);

  describe("createUserEntity", () => {
    it("should create a new user entity with correct initial values", () => {
      const user = createUserEntity(
        mockUserAddress,
        mockChainId,
        mockTimestamp,
      );

      expect(user.id).to.equal(mockUserAddress.toLowerCase());
      expect(user.chainId).to.equal(mockChainId);
      expect(user.numberOfSwaps).to.equal(0n);
      expect(user.totalSwapVolumeUSD).to.equal(0n);
      expect(user.totalFeesContributedUSD).to.equal(0n);
      expect(user.totalFeesContributed0).to.equal(0n);
      expect(user.totalFeesContributed1).to.equal(0n);
      expect(user.joined_at_timestamp).to.deep.equal(mockTimestamp);
      expect(user.last_activity_timestamp).to.deep.equal(mockTimestamp);
    });

    it("should normalize user address to lowercase", () => {
      const upperCaseAddress = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
      const user = createUserEntity(
        upperCaseAddress,
        mockChainId,
        mockTimestamp,
      );

      expect(user.id).to.equal(upperCaseAddress.toLowerCase());
    });
  });

  describe("updateUserFeeContribution", () => {
    let mockContext: handlerContext;

    beforeEach(() => {
      mockContext = {
        User: {
          get: async (id: string) => undefined,
          set: async (user: User) => {},
        },
        log: {
          error: () => {},
          warn: () => {},
          info: () => {},
        },
      } as unknown as handlerContext;
    });

    it("should create new user when user does not exist", async () => {
      let savedUser: User | undefined;
      Object.assign(mockContext.User, {
        set: async (user: User) => {
          savedUser = user;
        },
      });

      const feesContributedUSD = 1000n;
      const feesContributed0 = 500n;
      const feesContributed1 = 300n;

      const result = await updateUserFeeContribution(
        mockUserAddress,
        mockChainId,
        feesContributedUSD,
        feesContributed0,
        feesContributed1,
        mockTimestamp,
        mockContext,
      );

      expect(result).to.not.be.undefined;
      expect(result.id).to.equal(mockUserAddress.toLowerCase());
      expect(result.chainId).to.equal(mockChainId);
      expect(result.totalFeesContributedUSD).to.equal(feesContributedUSD);
      expect(result.totalFeesContributed0).to.equal(feesContributed0);
      expect(result.totalFeesContributed1).to.equal(feesContributed1);
      expect(result.last_activity_timestamp).to.deep.equal(mockTimestamp);
      expect(savedUser).to.deep.equal(result);
    });

    it("should update existing user with additional fee contributions", async () => {
      const existingUser: User = {
        id: mockUserAddress.toLowerCase(),
        chainId: mockChainId,
        numberOfSwaps: 5n,
        totalSwapVolumeUSD: 10000n,
        totalFeesContributedUSD: 2000n,
        totalFeesContributed0: 1000n,
        totalFeesContributed1: 800n,
        joined_at_timestamp: new Date(500000 * 1000),
        last_activity_timestamp: new Date(800000 * 1000),
      };

      Object.assign(mockContext.User, {
        get: async (id: string) => existingUser,
        set: async (user: User) => {
          savedUser = user;
        },
      });

      let savedUser: User | undefined;

      const additionalFeesUSD = 500n;
      const additionalFees0 = 200n;
      const additionalFees1 = 150n;

      const result = await updateUserFeeContribution(
        mockUserAddress,
        mockChainId,
        additionalFeesUSD,
        additionalFees0,
        additionalFees1,
        mockTimestamp,
        mockContext,
      );

      expect(result).to.not.be.undefined;
      expect(result.id).to.equal(mockUserAddress.toLowerCase());
      expect(result.chainId).to.equal(mockChainId);
      expect(result.numberOfSwaps).to.equal(existingUser.numberOfSwaps);
      expect(result.totalSwapVolumeUSD).to.equal(
        existingUser.totalSwapVolumeUSD,
      );
      expect(result.totalFeesContributedUSD).to.equal(
        existingUser.totalFeesContributedUSD + additionalFeesUSD,
      );
      expect(result.totalFeesContributed0).to.equal(
        existingUser.totalFeesContributed0 + additionalFees0,
      );
      expect(result.totalFeesContributed1).to.equal(
        existingUser.totalFeesContributed1 + additionalFees1,
      );
      expect(result.joined_at_timestamp).to.deep.equal(
        existingUser.joined_at_timestamp,
      );
      expect(result.last_activity_timestamp).to.deep.equal(mockTimestamp);
      expect(savedUser).to.deep.equal(result);
    });

    it("should handle multiple fee contributions correctly", async () => {
      let savedUser: User | undefined;
      Object.assign(mockContext.User, {
        get: async (id: string) => savedUser,
        set: async (user: User) => {
          savedUser = user;
        },
      });

      // First contribution
      await updateUserFeeContribution(
        mockUserAddress,
        mockChainId,
        1000n,
        500n,
        300n,
        new Date(1000000 * 1000),
        mockContext,
      );

      // Second contribution
      const result = await updateUserFeeContribution(
        mockUserAddress,
        mockChainId,
        2000n,
        1000n,
        600n,
        new Date(2000000 * 1000),
        mockContext,
      );

      expect(result.totalFeesContributedUSD).to.equal(3000n);
      expect(result.totalFeesContributed0).to.equal(1500n);
      expect(result.totalFeesContributed1).to.equal(900n);
      expect(result.last_activity_timestamp).to.deep.equal(
        new Date(2000000 * 1000),
      );
    });

    it("should normalize user address to lowercase", async () => {
      const upperCaseAddress = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
      let savedUser: User | undefined;
      Object.assign(mockContext.User, {
        set: async (user: User) => {
          savedUser = user;
        },
      });

      const result = await updateUserFeeContribution(
        upperCaseAddress,
        mockChainId,
        1000n,
        500n,
        300n,
        mockTimestamp,
        mockContext,
      );

      expect(result.id).to.equal(upperCaseAddress.toLowerCase());
      expect(savedUser?.id).to.equal(upperCaseAddress.toLowerCase());
    });
  });
});
