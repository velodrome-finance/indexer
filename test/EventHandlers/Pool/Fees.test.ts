import { expect } from "chai";
import { MockDb, Pool } from "../../../generated/src/TestHelpers.gen";
import type {
  LiquidityPoolAggregator,
  Token,
  User,
} from "../../../generated/src/Types.gen";
import { setupCommon } from "./common";

describe("Pool Fees Event", () => {
  const { mockToken0Data, mockToken1Data, mockLiquidityPoolData } =
    setupCommon();
  const poolId = mockLiquidityPoolData.id;

  let mockDb: ReturnType<typeof MockDb.createMockDb>;
  let updatedDB: ReturnType<typeof MockDb.createMockDb>;
  const expectations = {
    amount0In: 3n * 10n ** 18n,
    amount1In: 2n * 10n ** 6n,
    totalLiquidityUSD: 0n,
    totalFeesUSDWhitelisted: 0n,
    totalFeesUSD: 0n,
  };

  expectations.totalLiquidityUSD =
    ((mockLiquidityPoolData.reserve0 - expectations.amount0In) *
      mockToken0Data.pricePerUSDNew) /
      10n ** mockToken0Data.decimals +
    ((mockLiquidityPoolData.reserve1 - expectations.amount1In) *
      mockToken1Data.pricePerUSDNew) /
      10n ** mockToken1Data.decimals;

  expectations.totalFeesUSD =
    mockLiquidityPoolData.totalFeesUSD +
    (expectations.amount0In / 10n ** mockToken0Data.decimals) *
      mockToken0Data.pricePerUSDNew +
    (expectations.amount1In / 10n ** mockToken1Data.decimals) *
      mockToken1Data.pricePerUSDNew;

  expectations.totalFeesUSDWhitelisted = expectations.totalFeesUSD;

  let updatedPool: LiquidityPoolAggregator | undefined;
  let createdUser: User | undefined;

  beforeEach(async () => {
    mockDb = MockDb.createMockDb();
    updatedDB = mockDb.entities.Token.set(mockToken0Data as Token);
    updatedDB = updatedDB.entities.Token.set(mockToken1Data as Token);
    updatedDB = updatedDB.entities.LiquidityPoolAggregator.set(
      mockLiquidityPoolData,
    );

    const mockEvent = Pool.Fees.createMockEvent({
      amount0: expectations.amount0In,
      amount1: expectations.amount1In,
      sender: "0x1234567890123456789012345678901234567890",
      mockEventData: {
        block: {
          number: 123456,
          timestamp: 1000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
        },
        chainId: 10,
        srcAddress: poolId,
      },
    });

    const result = await Pool.Fees.processEvent({
      event: mockEvent,
      mockDb: updatedDB,
    });

    updatedPool = result.entities.LiquidityPoolAggregator.get(poolId);
    createdUser = result.entities.User.get(
      "0x1234567890123456789012345678901234567890",
    );
  });

  it("should update LiquidityPoolAggregator", async () => {
    expect(updatedPool).to.not.be.undefined;
    expect(updatedPool?.lastUpdatedTimestamp).to.deep.equal(
      new Date(1000000 * 1000),
    );
  });

  it("should update LiquidityPoolAggregator nominal fees", async () => {
    expect(updatedPool?.totalFees0).to.equal(
      mockLiquidityPoolData.totalFees0 + expectations.amount0In,
    );
    expect(updatedPool?.totalFees1).to.equal(
      mockLiquidityPoolData.totalFees1 + expectations.amount1In,
    );
  });

  it("should update LiquidityPoolAggregator total fees in USD", async () => {
    expect(updatedPool?.totalFeesUSD).to.equal(expectations.totalFeesUSD);
  });

  it("should update LiquidityPoolAggregator total fees in USD whitelisted", async () => {
    expect(updatedPool?.totalFeesUSDWhitelisted).to.equal(
      expectations.totalFeesUSDWhitelisted,
    );
  });

  it("should create a new User entity", async () => {
    expect(createdUser).to.not.be.undefined;
    expect(createdUser?.id).to.equal(
      "0x1234567890123456789012345678901234567890",
    );
    expect(createdUser?.chainId).to.equal(10);
    expect(createdUser?.numberOfSwaps).to.equal(0n);
    expect(createdUser?.totalSwapVolumeUSD).to.equal(0n);
  });

  it("should update User entity with fee contributions", async () => {
    expect(createdUser?.totalFeesContributed0).to.equal(expectations.amount0In);
    expect(createdUser?.totalFeesContributed1).to.equal(expectations.amount1In);

    const expectedUserFeesUSD =
      (expectations.amount0In / 10n ** mockToken0Data.decimals) *
        mockToken0Data.pricePerUSDNew +
      (expectations.amount1In / 10n ** mockToken1Data.decimals) *
        mockToken1Data.pricePerUSDNew;
    expect(createdUser?.totalFeesContributedUSD).to.equal(expectedUserFeesUSD);
  });

  it("should set correct timestamps for User entity", async () => {
    expect(createdUser?.joined_at_timestamp).to.deep.equal(
      new Date(1000000 * 1000),
    );
    expect(createdUser?.last_activity_timestamp).to.deep.equal(
      new Date(1000000 * 1000),
    );
  });

  it("should handle existing user correctly", async () => {
    // Create an existing user
    const existingUser: User = {
      id: "0x1234567890123456789012345678901234567890",
      chainId: 10,
      numberOfSwaps: 5n,
      totalSwapVolumeUSD: 10000n,
      totalFeesContributedUSD: 2000n,
      totalFeesContributed0: 1000n,
      totalFeesContributed1: 800n,
      joined_at_timestamp: new Date(500000 * 1000),
      last_activity_timestamp: new Date(800000 * 1000),
    };

    // Set up the existing user in the database
    updatedDB = updatedDB.entities.User.set(existingUser);

    const mockEvent = Pool.Fees.createMockEvent({
      amount0: 500n,
      amount1: 300n,
      sender: "0x1234567890123456789012345678901234567890",
      mockEventData: {
        block: {
          number: 123457,
          timestamp: 2000000,
          hash: "0x1234567890123456789012345678901234567890123456789012345678901235",
        },
        chainId: 10,
        srcAddress: poolId,
      },
    });

    const result = await Pool.Fees.processEvent({
      event: mockEvent,
      mockDb: updatedDB,
    });

    const updatedUser = result.entities.User.get(
      "0x1234567890123456789012345678901234567890",
    );

    expect(updatedUser).to.not.be.undefined;
    expect(updatedUser?.totalFeesContributed0).to.equal(
      existingUser.totalFeesContributed0 + 500n,
    );
    expect(updatedUser?.totalFeesContributed1).to.equal(
      existingUser.totalFeesContributed1 + 300n,
    );
    expect(updatedUser?.numberOfSwaps).to.equal(existingUser.numberOfSwaps);
    expect(updatedUser?.totalSwapVolumeUSD).to.equal(
      existingUser.totalSwapVolumeUSD,
    );
    expect(updatedUser?.joined_at_timestamp).to.deep.equal(
      existingUser.joined_at_timestamp,
    );
    expect(updatedUser?.last_activity_timestamp).to.deep.equal(
      new Date(2000000 * 1000),
    );
  });
});
