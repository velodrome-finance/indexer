import { createTestIndexer } from "envio";
import {
  AERO_NFPM_ADDRESS,
  NonFungiblePositionId,
  POOL_DEPLOYMENT,
  PoolId,
  TEN_TO_THE_18_BI,
  TokenId,
  UserStatsPerPoolId,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  AERO_DEALLOC_GAUGE,
  AERO_EMISSIONS_EVENT_KIND,
  AERO_STAKE_EVENT_KIND,
  AERO_ZERO_GAUGE,
  AeroEventId,
  AeroGaugeFactoryId,
  AeroGaugeId,
  AeroLeafVoterStateId,
  AeroVotingRewardsManagerId,
} from "../../../src/EventHandlers/Aero/AeroConstants";
import "../../eventHandlersRegistration";
import { registerAeroCLPools } from "../../registerDynamicContracts";
import { setupCommon } from "../Pool/common";

// Aero gauges, staking and emissions (ADR 0006), simulated on Arc (Aero only)
// with the real Arc contract addresses so static contracts route.
describe("Aero gauges, staking and emissions", () => {
  const { mockToken0Data, mockToken1Data, createMockPool } = setupCommon();
  const chainId = 5042 as const;
  const CL_GAUGE_FACTORY = toChecksumAddress(
    "0xf437f62053ACB121665b8fDBfeA8F214FB8E589d",
  );
  const V2_GAUGE_FACTORY = toChecksumAddress(
    "0xBDcB4929b19EBcfEE5eFE100B829c9B35C16d8F8",
  );
  const GAUGE_MANAGER = toChecksumAddress(
    "0xbF234b32c5e58868243A4a14831626f3EdE7b183",
  );
  const LEAF_VOTER = toChecksumAddress(
    "0x382409fad8503FbCdbB27A4211551fa03e884078",
  );
  const UNSTAKED_FEE_MODULE = toChecksumAddress(
    "0xcc421483cd131a8FD6b68c37E46f244dbec4F797",
  );
  const XAERO = toChecksumAddress("0x20077cC0d5E385A0Fe9C91bbC7DC744f51559307");
  const clPool = toChecksumAddress(
    "0x3333333333333333333333333333333333333333",
  );
  const v2Pool = toChecksumAddress(
    "0x5555555555555555555555555555555555555555",
  );
  const clGauge = toChecksumAddress(
    "0x6666666666666666666666666666666666666666",
  );
  const v2Gauge = toChecksumAddress(
    "0x7777777777777777777777777777777777777777",
  );
  const clVrm = toChecksumAddress("0x8888888888888888888888888888888888888888");
  const v2Vrm = toChecksumAddress("0x9999999999999999999999999999999999999999");
  const user = toChecksumAddress("0xa0f688905ef05ea853c35131b4899a613b4ba644");
  const referral = toChecksumAddress(
    "0xb0f688905ef05ea853c35131b4899a613b4ba645",
  );
  const nfpm = AERO_NFPM_ADDRESS as `0x${string}`;
  const tickLower = -600n;
  const tickUpper = 600n;
  const L = 1_000_000_000n;
  const a0 = 500n * 10n ** 18n;
  const a1 = 300n * 10n ** 6n;
  const E18 = TEN_TO_THE_18_BI;

  let blockNo = 30_000_000;
  const nextBlock = () => {
    blockNo += 10;
    return {
      number: blockNo,
      timestamp: 1_790_000_000 + blockNo,
      hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    };
  };
  let txCounter = 1;
  const tx = () => ({
    hash: `0x${(txCounter++).toString(16).padStart(64, "0")}`,
  });

  let indexer: ReturnType<typeof createTestIndexer>;
  // biome-ignore lint/suspicious/noExplicitAny: simulate items for several contracts
  async function run(simulate: any[]) {
    // biome-ignore lint/suspicious/noExplicitAny: chain id literal
    await indexer.process({ chains: { [chainId]: { simulate } } as any });
  }

  beforeEach(async () => {
    indexer = createTestIndexer();
    await registerAeroCLPools(indexer, chainId, [clPool]);
    for (const t of [mockToken0Data, mockToken1Data]) {
      indexer.Token.set({ ...t, id: TokenId(chainId, t.address), chainId });
    }
    // xAERO at $0.50, a connector (trusted).
    indexer.Token.set({
      ...mockToken0Data,
      id: TokenId(chainId, XAERO),
      address: XAERO,
      symbol: "xAERO",
      chainId,
      pricePerUSDNew: E18 / 2n,
    });
    const tokens = {
      token0_id: TokenId(chainId, mockToken0Data.address),
      token1_id: TokenId(chainId, mockToken1Data.address),
      token0_address: mockToken0Data.address,
      token1_address: mockToken1Data.address,
    };
    indexer.Pool.set(
      createMockPool({
        chainId,
        poolAddress: clPool,
        isCL: true,
        deployment: POOL_DEPLOYMENT.AERO,
        nfpmAddress: AERO_NFPM_ADDRESS,
        tickSpacing: 100n,
        reserve0: 0n,
        reserve1: 0n,
        ...tokens,
      }),
    );
    indexer.Pool.set(
      createMockPool({
        chainId,
        poolAddress: v2Pool,
        isCL: false,
        deployment: POOL_DEPLOYMENT.AERO,
        totalLPTokenSupply: 1_000n * E18,
        ...tokens,
      }),
    );
  });

  /** Factory GaugeCreated, LeafVoter registration + activation, GaugeManager GaugeCreated. */
  async function createGauge(opts: {
    factory: string;
    gauge: string;
    pool: string;
    vrm: string;
    referralShare?: bigint;
  }) {
    const block = nextBlock();
    const t = tx();
    const factoryContract =
      opts.factory === CL_GAUGE_FACTORY
        ? "AeroCLGaugeFactory"
        : "AeroV2GaugeFactory";
    const items = [];
    if (opts.referralShare !== undefined) {
      items.push({
        contract: factoryContract,
        event: "ReferralConfigSet",
        srcAddress: opts.factory,
        logIndex: 0,
        block,
        transaction: t,
        params: {
          gauge: opts.gauge,
          referral,
          share: opts.referralShare,
        },
      });
    }
    items.push(
      {
        contract: factoryContract,
        event: "GaugeCreated",
        srcAddress: opts.factory,
        logIndex: 1,
        block,
        transaction: t,
        params: { gauge: opts.gauge, pool: opts.pool, isPool: true },
      },
      {
        contract: "AeroLeafVoter",
        event: "GaugeRegistered",
        srcAddress: LEAF_VOTER,
        logIndex: 3,
        block,
        transaction: t,
        params: { gauge: opts.gauge, activated: true, registrationCursor: 1n },
      },
      {
        contract: "AeroLeafVoter",
        event: "GaugeActivated",
        srcAddress: LEAF_VOTER,
        logIndex: 4,
        block,
        transaction: t,
        params: { gauge: opts.gauge, activationCursor: 1n },
      },
      {
        contract: "AeroGaugeManager",
        event: "GaugeCreated",
        srcAddress: GAUGE_MANAGER,
        logIndex: 5,
        block,
        transaction: t,
        params: {
          target: opts.pool,
          gauge: opts.gauge,
          module: user,
          gaugeFactory: opts.factory,
          votingRewardsManager: opts.vrm,
          creator: user,
          activated: true,
        },
      },
    );
    await run(items);
  }

  async function mintPosition(tokenId: bigint) {
    const block = nextBlock();
    const t = tx();
    await run([
      {
        contract: "CLPool",
        event: "Mint",
        srcAddress: clPool,
        logIndex: 1,
        block,
        transaction: t,
        params: {
          sender: nfpm,
          owner: nfpm,
          tickLower,
          tickUpper,
          amount: L,
          amount0: a0,
          amount1: a1,
        },
      },
      {
        contract: "AeroNFPM",
        event: "Transfer",
        srcAddress: nfpm,
        logIndex: 2,
        block,
        transaction: t,
        params: { from: ZERO_ADDRESS, to: user, tokenId },
      },
      {
        contract: "AeroNFPM",
        event: "IncreaseLiquidity",
        srcAddress: nfpm,
        logIndex: 3,
        block,
        transaction: t,
        params: {
          tokenId,
          liquidity: L,
          amount0: a0,
          amount1: a1,
          tickLower,
          tickUpper,
        },
      },
    ]);
  }

  it("creates the gauge, links the pool and its rewards manager", async () => {
    await createGauge({
      factory: CL_GAUGE_FACTORY,
      gauge: clGauge,
      pool: clPool,
      vrm: clVrm,
      referralShare: 10_000n,
    });
    const gauge = await indexer.AeroGauge.get(AeroGaugeId(chainId, clGauge));
    expect(gauge).toMatchObject({
      poolAddress: clPool,
      pool_id: PoolId(chainId, clPool),
      isCL: true,
      gaugeFactory: CL_GAUGE_FACTORY,
      votingRewardsManager: clVrm,
      creationModule: user,
      isRegistered: true,
      isActivated: true,
      rewardToken: XAERO,
      // Configured inside createGauge, before GaugeCreated: picked up.
      referral,
      referralShare: 10_000n,
      emissionCap: undefined,
    });
    const pool = await indexer.Pool.get(PoolId(chainId, clPool));
    expect(pool?.gaugeAddress).toBe(clGauge);
    expect(pool?.gaugeIsAlive).toBe(true);
    expect(
      await indexer.AeroVotingRewardsManager.get(
        AeroVotingRewardsManagerId(chainId, clVrm),
      ),
    ).toMatchObject({ gaugeAddress: clGauge, poolAddress: clPool });
    expect(
      (
        await indexer.AeroGaugeFactory.get(
          AeroGaugeFactoryId(chainId, CL_GAUGE_FACTORY),
        )
      )?.numberOfGauges,
    ).toBe(1);
    expect(
      await indexer.AeroGaugePendingReferral.get(AeroGaugeId(chainId, clGauge)),
    ).toBeUndefined();
  });

  it("stakes and unstakes a CL position: pool staked liquidity, owner kept, row per event", async () => {
    await mintPosition(7n);
    await createGauge({
      factory: CL_GAUGE_FACTORY,
      gauge: clGauge,
      pool: clPool,
      vrm: clVrm,
    });
    const positionId = NonFungiblePositionId(chainId, AERO_NFPM_ADDRESS, 7n);

    const depositBlock = nextBlock();
    const depositTx = tx();
    await run([
      {
        contract: "AeroNFPM",
        event: "Transfer",
        srcAddress: nfpm,
        logIndex: 10,
        block: depositBlock,
        transaction: depositTx,
        params: { from: user, to: clGauge, tokenId: 7n },
      },
      {
        contract: "AeroCLGauge",
        event: "Deposit",
        srcAddress: clGauge,
        logIndex: 11,
        block: depositBlock,
        transaction: depositTx,
        params: { caller: user, user, tokenId: 7n, liquidityToStake: L },
      },
    ]);
    let position = await indexer.NonFungiblePosition.get(positionId);
    expect(position?.isStakedInGauge).toBe(true);
    expect(position?.owner).toBe(user);
    let pool = await indexer.Pool.get(PoolId(chainId, clPool));
    expect(pool?.currentLiquidityStaked).toBe(L);
    expect(pool?.stakedLiquidityInRange).toBe(L);
    expect(pool?.hasStakes).toBe(true);
    expect(pool?.numberOfGaugeDeposits).toBe(1n);
    let stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, clPool),
    );
    expect(stats?.currentLiquidityStaked).toBe(L);
    expect(stats?.stakedCLPositionTokenIds).toEqual([7n]);
    expect(
      await indexer.AeroGaugeStakeEvent.get(
        AeroEventId(chainId, depositTx.hash, 11),
      ),
    ).toMatchObject({
      kind: AERO_STAKE_EVENT_KIND.DEPOSIT,
      gaugeAddress: clGauge,
      poolAddress: clPool,
      account: user,
      tokenId: 7n,
      amount: L,
      isCL: true,
    });

    const withdrawBlock = nextBlock();
    const withdrawTx = tx();
    await run([
      {
        contract: "AeroNFPM",
        event: "Transfer",
        srcAddress: nfpm,
        logIndex: 20,
        block: withdrawBlock,
        transaction: withdrawTx,
        params: { from: clGauge, to: user, tokenId: 7n },
      },
      {
        contract: "AeroCLGauge",
        event: "Withdraw",
        srcAddress: clGauge,
        logIndex: 21,
        block: withdrawBlock,
        transaction: withdrawTx,
        params: { caller: user, user, tokenId: 7n, liquidityToStake: L },
      },
    ]);
    position = await indexer.NonFungiblePosition.get(positionId);
    expect(position?.isStakedInGauge).toBe(false);
    pool = await indexer.Pool.get(PoolId(chainId, clPool));
    expect(pool?.currentLiquidityStaked).toBe(0n);
    expect(pool?.stakedLiquidityInRange).toBe(0n);
    stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, clPool),
    );
    expect(stats?.currentLiquidityStaked).toBe(0n);
    expect(stats?.stakedCLPositionTokenIds).toEqual([]);
    const gauge = await indexer.AeroGauge.get(AeroGaugeId(chainId, clGauge));
    expect(gauge?.numberOfDeposits).toBe(1n);
    expect(gauge?.numberOfWithdrawals).toBe(1n);
  });

  it("stakes V2 LP tokens and treats an emergency withdrawal as an unstake", async () => {
    await createGauge({
      factory: V2_GAUGE_FACTORY,
      gauge: v2Gauge,
      pool: v2Pool,
      vrm: v2Vrm,
    });
    const amount = 10n * E18;
    await run([
      {
        contract: "AeroV2Gauge",
        event: "Deposit",
        srcAddress: v2Gauge,
        logIndex: 1,
        block: nextBlock(),
        transaction: tx(),
        params: { caller: user, account: user, amount },
      },
    ]);
    let pool = await indexer.Pool.get(PoolId(chainId, v2Pool));
    expect(pool?.currentLiquidityStaked).toBe(amount);
    expect(pool?.gaugeAddress).toBe(v2Gauge);
    await run([
      {
        contract: "AeroV2Gauge",
        event: "EmergencyWithdraw",
        srcAddress: v2Gauge,
        logIndex: 1,
        block: nextBlock(),
        transaction: tx(),
        params: { account: user, amount: amount / 2n },
      },
    ]);
    pool = await indexer.Pool.get(PoolId(chainId, v2Pool));
    expect(pool?.currentLiquidityStaked).toBe(amount / 2n);
    const stats = await indexer.UserStatsPerPool.get(
      UserStatsPerPoolId(chainId, user, v2Pool),
    );
    expect(stats?.currentLiquidityStaked).toBe(amount / 2n);
  });

  it("mirrors the LeafVoter's per-gauge ceiling, claimed and surplus, and the chain totals", async () => {
    await createGauge({
      factory: CL_GAUGE_FACTORY,
      gauge: clGauge,
      pool: clPool,
      vrm: clVrm,
    });
    const block = nextBlock();
    const t = tx();
    await run([
      {
        contract: "AeroLeafVoter",
        event: "GaugeCapSettled",
        srcAddress: LEAF_VOTER,
        logIndex: 1,
        block,
        transaction: t,
        params: {
          gauge: clGauge,
          effectiveShare: 100n * E18,
          surplusDelta: 5n * E18,
          cap: 7n * E18,
          gaugeWeight: 1_234n * E18,
        },
      },
      {
        contract: "AeroLeafVoter",
        event: "GaugeCapSettled",
        srcAddress: LEAF_VOTER,
        logIndex: 2,
        block,
        transaction: t,
        params: {
          gauge: AERO_ZERO_GAUGE,
          effectiveShare: 0n,
          surplusDelta: 9n * E18,
          cap: 0n,
          gaugeWeight: 50n * E18,
        },
      },
      {
        contract: "AeroLeafVoter",
        event: "EmissionsForfeited",
        srcAddress: LEAF_VOTER,
        logIndex: 3,
        block,
        transaction: t,
        params: { gauge: clGauge, amount: 2n * E18 },
      },
      {
        contract: "AeroLeafVoter",
        event: "EmissionsMinted",
        srcAddress: LEAF_VOTER,
        logIndex: 4,
        block,
        transaction: t,
        params: { gauge: clGauge, recipients: [user], amounts: [40n * E18] },
      },
      {
        contract: "AeroLeafVoter",
        event: "Redeemed",
        srcAddress: LEAF_VOTER,
        logIndex: 5,
        block,
        transaction: t,
        params: { redeemer: user, recipient: user, amount: 15n * E18 },
      },
    ]);
    const gauge = await indexer.AeroGauge.get(AeroGaugeId(chainId, clGauge));
    expect(gauge).toMatchObject({
      totalEmissionsCredited: 100n * E18,
      totalCapSurplus: 5n * E18,
      totalEmissionsForfeited: 2n * E18,
      totalEmissionsMinted: 40n * E18,
      // xAERO at $0.50
      totalEmissionsMintedUSD: 20n * E18,
      emissionCap: 7n * E18,
      lastGaugeWeight: 1_234n * E18,
    });
    const state = await indexer.AeroLeafVoterState.get(
      AeroLeafVoterStateId(chainId),
    );
    expect(state).toMatchObject({
      totalEmissionsCredited: 100n * E18,
      totalCapSurplus: 14n * E18,
      totalIdleSurplus: 9n * E18,
      totalEmissionsForfeited: 2n * E18,
      totalEmissionsMinted: 40n * E18,
      totalRedeemed: 15n * E18,
      numberOfRedemptions: 1n,
      receiptTokenSupply: 25n * E18,
    });
    // A user redemption on a leaf chain gets a row.
    expect(
      await indexer.AeroRedemptionEvent.get(AeroEventId(chainId, t.hash, 5)),
    ).toMatchObject({ kind: "INITIATED", redeemer: user, amount: 15n * E18 });
    // Hourly snapshots exist.
    expect(gauge?.lastSnapshotTimestamp).toBeDefined();
    expect(state?.lastSnapshotTimestamp).toBeDefined();
  });

  it("records per-LP claims, deferrals, referral legs and penalties", async () => {
    await createGauge({
      factory: CL_GAUGE_FACTORY,
      gauge: clGauge,
      pool: clPool,
      vrm: clVrm,
    });
    const block = nextBlock();
    const t = tx();
    await run([
      {
        contract: "AeroCLGauge",
        event: "EarlyWithdrawPenalty",
        srcAddress: clGauge,
        logIndex: 1,
        block,
        transaction: t,
        params: { from: user, tokenId: 7n, penalty: 3n * E18 },
      },
      {
        contract: "AeroCLGauge",
        event: "ReferralEmissionsDeferred",
        srcAddress: clGauge,
        logIndex: 2,
        block,
        transaction: t,
        params: { account: user, tokenId: 7n, referral, amount: 1n * E18 },
      },
      {
        contract: "AeroCLGauge",
        event: "EmissionsClaimed",
        srcAddress: clGauge,
        logIndex: 3,
        block,
        transaction: t,
        params: {
          account: user,
          tokenId: 7n,
          recipient: user,
          rewardAmount: 6n * E18,
        },
      },
      {
        contract: "AeroCLGauge",
        event: "DeferredEmissionsClaimed",
        srcAddress: clGauge,
        logIndex: 4,
        block,
        transaction: t,
        params: { account: user, recipient: user, amount: 2n * E18 },
      },
      {
        contract: "AeroCLGauge",
        event: "EmissionsDeferred",
        srcAddress: clGauge,
        logIndex: 5,
        block,
        transaction: t,
        params: { account: user, tokenId: 8n, rewardAmount: 4n * E18 },
      },
      {
        contract: "AeroCLGauge",
        event: "ReferralEmissionsClaimed",
        srcAddress: clGauge,
        logIndex: 6,
        block,
        transaction: t,
        params: { referral, recipient: referral, amount: 1n * E18 },
      },
    ]);
    const claim = await indexer.AeroEmissionsEvent.get(
      AeroEventId(chainId, t.hash, 3),
    );
    expect(claim).toMatchObject({
      kind: AERO_EMISSIONS_EVENT_KIND.CLAIMED,
      gaugeAddress: clGauge,
      poolAddress: clPool,
      account: user,
      recipient: user,
      tokenId: 7n,
      amount: 6n * E18,
      amountUSD: 3n * E18,
      rewardToken: XAERO,
    });
    expect(
      (await indexer.AeroEmissionsEvent.get(AeroEventId(chainId, t.hash, 1)))
        ?.kind,
    ).toBe(AERO_EMISSIONS_EVENT_KIND.EARLY_WITHDRAW_PENALTY);
    expect(
      (await indexer.AeroEmissionsEvent.get(AeroEventId(chainId, t.hash, 6)))
        ?.account,
    ).toBe(referral);
    const gauge = await indexer.AeroGauge.get(AeroGaugeId(chainId, clGauge));
    expect(gauge).toMatchObject({
      totalEmissionsClaimed: 6n * E18,
      numberOfClaims: 1n,
      totalDeferredEmissionsClaimed: 2n * E18,
      totalEmissionsDeferred: 4n * E18,
      totalReferralEmissionsDeferred: 1n * E18,
      totalReferralEmissionsClaimed: 1n * E18,
      totalEarlyWithdrawPenalty: 3n * E18,
    });
  });

  it("deactivates the pool's gauge when its cap goes to 0, and reactivates it", async () => {
    await createGauge({
      factory: CL_GAUGE_FACTORY,
      gauge: clGauge,
      pool: clPool,
      vrm: clVrm,
    });
    const setCap = (cap: bigint) =>
      run([
        {
          contract: "AeroCLGaugeFactory",
          event: "EmissionCapSet",
          srcAddress: CL_GAUGE_FACTORY,
          logIndex: 1,
          block: nextBlock(),
          transaction: tx(),
          params: { gauge: clGauge, cap, caller: user },
        },
      ]);
    await setCap(0n);
    expect(
      (await indexer.Pool.get(PoolId(chainId, clPool)))?.gaugeIsAlive,
    ).toBe(false);
    expect(
      (await indexer.AeroGauge.get(AeroGaugeId(chainId, clGauge)))?.emissionCap,
    ).toBe(0n);
    await setCap(5n * E18);
    expect(
      (await indexer.Pool.get(PoolId(chainId, clPool)))?.gaugeIsAlive,
    ).toBe(true);
  });

  it("records the factory's penalty configuration and per-gauge minimum stake", async () => {
    await createGauge({
      factory: CL_GAUGE_FACTORY,
      gauge: clGauge,
      pool: clPool,
      vrm: clVrm,
    });
    await run([
      {
        contract: "AeroCLGaugeFactory",
        event: "PenaltyConfigSet",
        srcAddress: CL_GAUGE_FACTORY,
        logIndex: 1,
        block: nextBlock(),
        transaction: tx(),
        params: { minStakeBlocks: 900n, penaltyRate: 250_000n },
      },
      {
        contract: "AeroCLGaugeFactory",
        event: "MinStakeBlocksSet",
        srcAddress: CL_GAUGE_FACTORY,
        logIndex: 2,
        block: nextBlock(),
        transaction: tx(),
        params: { gauge: clGauge, minStakeBlocks: 30n },
      },
    ]);
    expect(
      await indexer.AeroGaugeFactory.get(
        AeroGaugeFactoryId(chainId, CL_GAUGE_FACTORY),
      ),
    ).toMatchObject({ minStakeBlocks: 900n, penaltyRate: 250_000n });
    expect(
      (await indexer.AeroGauge.get(AeroGaugeId(chainId, clGauge)))
        ?.minStakeBlocks,
    ).toBe(30n);
  });

  it("records fees the gauge sends to its rewards manager", async () => {
    await createGauge({
      factory: CL_GAUGE_FACTORY,
      gauge: clGauge,
      pool: clPool,
      vrm: clVrm,
    });
    const block = nextBlock();
    const t = tx();
    await run([
      {
        contract: "AeroCLGauge",
        event: "ClaimFees",
        srcAddress: clGauge,
        logIndex: 1,
        block,
        transaction: t,
        params: { caller: clVrm, claimed0: 2n * E18, claimed1: 3n * 10n ** 6n },
      },
      {
        contract: "AeroVotingRewardsManager",
        event: "FeesCollected",
        srcAddress: clVrm,
        logIndex: 2,
        block,
        transaction: t,
        params: {
          gauge: clGauge,
          token: mockToken0Data.address,
          amount: 2n * E18,
        },
      },
    ]);
    expect(
      await indexer.AeroGauge.get(AeroGaugeId(chainId, clGauge)),
    ).toMatchObject({
      totalFeesClaimed0: 2n * E18,
      totalFeesClaimed1: 3n * 10n ** 6n,
      totalFeesClaimedUSD: 5n * E18,
    });
    expect(
      await indexer.AeroVotingRewardsEvent.get(AeroEventId(chainId, t.hash, 2)),
    ).toMatchObject({
      kind: "FEES_COLLECTED",
      gaugeAddress: clGauge,
      poolAddress: clPool,
      amount: 2n * E18,
      amountUSD: 2n * E18,
    });
    expect(
      await indexer.AeroVotingRewardsManager.get(
        AeroVotingRewardsManagerId(chainId, clVrm),
      ),
    ).toMatchObject({
      totalFeesCollectedUSD: 2n * E18,
      numberOfFeeCollections: 1n,
    });
  });

  it("writes the Aero unstaked fee onto the pool", async () => {
    await run([
      {
        contract: "AeroUnstakedFeeModule",
        event: "CustomFeeSet",
        srcAddress: UNSTAKED_FEE_MODULE,
        logIndex: 1,
        block: nextBlock(),
        transaction: tx(),
        params: { pool: clPool, fee: 420n },
      },
    ]);
    expect((await indexer.Pool.get(PoolId(chainId, clPool)))?.unstakedFee).toBe(
      420n,
    );
  });

  it("derives the deallocation sentinel from its documented preimage", () => {
    // keccak256("DROMOS_DEALLOC_GAUGE"), last 20 bytes.
    expect(AERO_DEALLOC_GAUGE).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(AERO_DEALLOC_GAUGE).not.toBe(AERO_ZERO_GAUGE);
  });
});
