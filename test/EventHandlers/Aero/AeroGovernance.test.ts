import type { Token } from "envio";
import { createTestIndexer } from "envio";
import {
  POOL_DEPLOYMENT,
  TEN_TO_THE_18_BI,
  TokenId,
  ZERO_ADDRESS,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  AERO_DEALLOC_GAUGE,
  AERO_MAXTIME_SECONDS,
  AERO_WEEK_SECONDS,
  AERO_ZERO_GAUGE,
  AeroContractStateId,
  AeroEventId,
  AeroGaugeId,
  AeroIncentiveProgramId,
  AeroLeafAllocationId,
  AeroLeafTokenStateId,
  AeroLeafVoterStateId,
  AeroRootAllocationId,
  AeroRootChainStateId,
  AeroVotingRewardsManagerId,
  SAERO_MINT_SENTINEL,
  SAeroPositionId,
  aeroVotingPower,
} from "../../../src/EventHandlers/Aero/AeroConstants";
import "../../eventHandlersRegistration";
import { setupCommon } from "../Pool/common";

// Aero governance (ADR 0006): sAERO positions, root and leaf allocations,
// allocator rewards, Minter and migration, on Base (root) with the real
// contract addresses so the static contracts route.
describe("Aero governance", () => {
  const { mockToken0Data, createMockPool } = setupCommon();
  const chainId = 8453 as const;
  const VE = toChecksumAddress("0xBF7977E1521e9a3032bf7243Ee4712f311f13915");
  const VOTER = toChecksumAddress("0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6");
  const MINTER = toChecksumAddress(
    "0x59268A34ba897e82368feE39839FFC661D4f9C97",
  );
  const LEAF_VOTER = toChecksumAddress(
    "0x382409fad8503FbCdbB27A4211551fa03e884078",
  );
  const CL_GAUGE_FACTORY = toChecksumAddress(
    "0xf437f62053ACB121665b8fDBfeA8F214FB8E589d",
  );
  const GAUGE_MANAGER = toChecksumAddress(
    "0xbF234b32c5e58868243A4a14831626f3EdE7b183",
  );
  const AERODROME_MIGRATION = toChecksumAddress(
    "0x22a2F7340a3fB4C7C389D91eE954766B12476721",
  );
  const VELODROME_ENTRYPOINT = toChecksumAddress(
    "0x6daE95FE833f190640dB1176F8C8a2e50C6a66c0",
  );
  const ZERO = toChecksumAddress(ZERO_ADDRESS);
  const alice = toChecksumAddress("0xa0f688905ef05ea853c35131b4899a613b4ba644");
  const bob = toChecksumAddress("0xb0f688905ef05ea853c35131b4899a613b4ba645");
  const gaugeA = toChecksumAddress(
    "0x6666666666666666666666666666666666666666",
  );
  const gaugeB = toChecksumAddress(
    "0x6666666666666666666666666666666666666667",
  );
  const unknownGauge = toChecksumAddress(
    "0x6666666666666666666666666666666666666668",
  );
  const poolA = toChecksumAddress("0x3333333333333333333333333333333333333333");
  const poolB = toChecksumAddress("0x3333333333333333333333333333333333333334");
  const vrmA = toChecksumAddress("0x8888888888888888888888888888888888888888");
  const vrmB = toChecksumAddress("0x8888888888888888888888888888888888888889");
  const E18 = TEN_TO_THE_18_BI;

  let blockNo = 60_000_000;
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
  const item = (
    contract: string,
    srcAddress: string,
    event: string,
    // biome-ignore lint/suspicious/noExplicitAny: params differ per event
    params: any,
    logIndex = 1,
  ) => ({
    contract,
    event,
    srcAddress,
    logIndex,
    params,
  });
  async function runInTx(items: ReturnType<typeof item>[]) {
    const block = nextBlock();
    const transaction = tx();
    await run(items.map((i) => ({ ...i, block, transaction })));
    return transaction;
  }

  beforeEach(() => {
    indexer = createTestIndexer();
    indexer.Token.set({
      ...mockToken0Data,
      id: TokenId(chainId, mockToken0Data.address),
      chainId,
    } as Token);
  });

  describe("sAERO positions (VotingEscrow)", () => {
    it("mints, funds, tops up, downgrades, splits, transfers and withdraws a position", async () => {
      const unlock = 1_900_000_000n;
      await runInTx([
        item(
          "AeroVotingEscrow",
          VE,
          "Transfer",
          { from: ZERO, to: alice, tokenId: 1n },
          1,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Deposit",
          {
            provider: alice,
            tokenId: 1n,
            depositType: 0n,
            value: 100n * E18,
            unstakeTime: 0n,
            ts: 1n,
          },
          2,
        ),
        item("AeroVotingEscrow", VE, "Supply", { supply: 100n * E18 }, 3),
      ]);
      let p1 = await indexer.SAeroPosition.get(SAeroPositionId(chainId, 1n));
      expect(p1).toMatchObject({
        owner: alice,
        amount: 100n * E18,
        isPermanent: true,
        stakeEnd: 0n,
        createdVia: "CREATE_STAKE",
      });
      let escrow = await indexer.SAeroEscrowState.get(`${chainId}`);
      expect(escrow).toMatchObject({
        supply: 100n * E18,
        permanentStakeBalance: 100n * E18,
        numberOfPositions: 1,
        lastTokenId: 1n,
      });

      // A second, decaying position.
      await runInTx([
        item(
          "AeroVotingEscrow",
          VE,
          "Transfer",
          { from: ZERO, to: bob, tokenId: 2n },
          1,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Deposit",
          {
            provider: bob,
            tokenId: 2n,
            depositType: 0n,
            value: 50n * E18,
            unstakeTime: unlock,
            ts: 1n,
          },
          2,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Deposit",
          {
            provider: bob,
            tokenId: 2n,
            depositType: 1n,
            value: 10n * E18,
            unstakeTime: unlock,
            ts: 1n,
          },
          3,
        ),
      ]);
      let p2 = await indexer.SAeroPosition.get(SAeroPositionId(chainId, 2n));
      expect(p2).toMatchObject({
        amount: 60n * E18,
        stakeEnd: unlock,
        isPermanent: false,
      });

      // Downgrade position 1: decays from a fresh four-year, week-aligned unlock.
      const ts = 1_800_000_123n;
      await runInTx([
        item(
          "AeroVotingEscrow",
          VE,
          "DowngradeFromPermanentStake",
          { owner: alice, tokenId: 1n, amount: 100n * E18, ts },
          1,
        ),
      ]);
      p1 = await indexer.SAeroPosition.get(SAeroPositionId(chainId, 1n));
      expect(p1?.isPermanent).toBe(false);
      expect(p1?.stakeEnd).toBe(
        ((ts + AERO_MAXTIME_SECONDS) / AERO_WEEK_SECONDS) * AERO_WEEK_SECONDS,
      );
      escrow = await indexer.SAeroEscrowState.get(`${chainId}`);
      expect(escrow?.permanentStakeBalance).toBe(0n);

      // Split 30 AERO of position 2 into a new position 3 (mint sentinel) plus a
      // 1 AERO fee to the accumulator; the mint inherits position 2's unlock.
      await runInTx([
        item(
          "AeroVotingEscrow",
          VE,
          "Transfer",
          { from: ZERO, to: alice, tokenId: 3n },
          1,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Rebalance",
          {
            sources: [{ tokenId: 2n, amount: 31n * E18 }],
            destinations: [
              {
                tokenId: SAERO_MINT_SENTINEL,
                amount: 30n * E18,
                recipient: alice,
              },
              { tokenId: 0n, amount: 1n * E18, recipient: ZERO },
            ],
          },
          2,
        ),
      ]);
      p2 = await indexer.SAeroPosition.get(SAeroPositionId(chainId, 2n));
      const p3 = await indexer.SAeroPosition.get(SAeroPositionId(chainId, 3n));
      const acc = await indexer.SAeroPosition.get(SAeroPositionId(chainId, 0n));
      expect(p2?.amount).toBe(29n * E18);
      expect(p3).toMatchObject({
        owner: alice,
        amount: 30n * E18,
        stakeEnd: unlock,
        isPermanent: false,
        createdVia: "REBALANCE",
      });
      expect(acc).toMatchObject({ amount: 1n * E18, isPermanent: true });
      escrow = await indexer.SAeroEscrowState.get(`${chainId}`);
      expect(escrow).toMatchObject({
        permanentStakeBalance: 1n * E18,
        accumulatorAmount: 1n * E18,
        numberOfPositions: 3,
      });

      // Transfer and withdraw position 3.
      const wtx = await runInTx([
        item(
          "AeroVotingEscrow",
          VE,
          "Transfer",
          { from: alice, to: bob, tokenId: 3n },
          1,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Withdraw",
          { provider: bob, tokenId: 3n, value: 30n * E18, ts: 1n },
          2,
        ),
        item("AeroVotingEscrow", VE, "Burn", { amount: 1n * E18 }, 3),
      ]);
      expect(
        await indexer.SAeroPosition.get(SAeroPositionId(chainId, 3n)),
      ).toMatchObject({ owner: bob, amount: 0n, totalWithdrawn: 30n * E18 });
      escrow = await indexer.SAeroEscrowState.get(`${chainId}`);
      expect(escrow?.supply).toBe(160n * E18 - 30n * E18 - 1n * E18);
      expect(escrow?.accumulatorAmount).toBe(0n);
      expect(escrow?.totalBurned).toBe(1n * E18);
      expect(
        await indexer.SAeroPositionEvent.get(AeroEventId(chainId, wtx.hash, 2)),
      ).toMatchObject({ kind: "WITHDRAW", tokenId: 3n, amount: 30n * E18 });
    });

    it("computes voting power like the contracts", () => {
      expect(aeroVotingPower(10n * E18, 0n, true, 5n)).toBe(10n * E18);
      expect(aeroVotingPower(10n * E18, 100n, false, 200n)).toBe(0n);
      expect(
        aeroVotingPower(AERO_MAXTIME_SECONDS * 7n, 1_000n, false, 400n),
      ).toBe(7n * 600n);
    });

    it("resolves several mint legs in order and lets a permanent source make mints permanent", async () => {
      await runInTx([
        item(
          "AeroVotingEscrow",
          VE,
          "Transfer",
          { from: ZERO, to: alice, tokenId: 1n },
          1,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Deposit",
          {
            provider: alice,
            tokenId: 1n,
            depositType: 0n,
            value: 90n * E18,
            unstakeTime: 0n,
            ts: 1n,
          },
          2,
        ),
      ]);
      await runInTx([
        item(
          "AeroVotingEscrow",
          VE,
          "Transfer",
          { from: ZERO, to: alice, tokenId: 2n },
          1,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Transfer",
          { from: ZERO, to: bob, tokenId: 3n },
          2,
        ),
        item(
          "AeroVotingEscrow",
          VE,
          "Rebalance",
          {
            sources: [{ tokenId: 1n, amount: 90n * E18 }],
            destinations: [
              {
                tokenId: SAERO_MINT_SENTINEL,
                amount: 60n * E18,
                recipient: alice,
              },
              {
                tokenId: SAERO_MINT_SENTINEL,
                amount: 30n * E18,
                recipient: bob,
              },
            ],
          },
          3,
        ),
      ]);
      expect(
        await indexer.SAeroPosition.get(SAeroPositionId(chainId, 2n)),
      ).toMatchObject({ owner: alice, amount: 60n * E18, isPermanent: true });
      expect(
        await indexer.SAeroPosition.get(SAeroPositionId(chainId, 3n)),
      ).toMatchObject({ owner: bob, amount: 30n * E18, isPermanent: true });
      expect(
        (await indexer.SAeroPosition.get(SAeroPositionId(chainId, 1n)))?.amount,
      ).toBe(0n);
      // Permanent balance is conserved across the split.
      expect(
        (await indexer.SAeroEscrowState.get(`${chainId}`))
          ?.permanentStakeBalance,
      ).toBe(90n * E18);
    });
  });

  describe("root Voter ledger", () => {
    it("parks, allocates, deallocates, rebalances, burns and clears booked power", async () => {
      const t = 25n;
      await runInTx([
        item(
          "AeroVoter",
          VOTER,
          "ParkedOnChain0",
          { tokenId: t, amount: 100n * E18 },
          1,
        ),
        item(
          "AeroVoter",
          VOTER,
          "ChainsAllocated",
          {
            tokenId: t,
            allocations: [
              { chainId: 10n, delta: 40n * E18, gasLimit: 1n, value: 1n },
              { chainId: 8453n, delta: 50n * E18, gasLimit: 0n, value: 0n },
            ],
          },
          2,
        ),
        item(
          "AeroVoter",
          VOTER,
          "GaugesAllocated",
          {
            tokenId: t,
            chainId: 10n,
            gauges: [{ gauge: gaugeA, allocated: 40n * E18, data: "0x" }],
          },
          3,
        ),
      ]);
      const row = async (target: number) =>
        (
          await indexer.AeroRootAllocation.get(
            AeroRootAllocationId(chainId, t, target),
          )
        )?.amount;
      expect(await row(0)).toBe(10n * E18);
      expect(await row(10)).toBe(40n * E18);
      expect(await row(8453)).toBe(50n * E18);
      expect(
        await indexer.AeroRootGaugeVote.get(
          AeroRootAllocationId(chainId, t, 10),
        ),
      ).toMatchObject({ gauges: [gaugeA], amounts: [40n * E18] });

      await runInTx([
        item(
          "AeroVoter",
          VOTER,
          "DeallocationProcessed",
          { chainId: 10n, tokenId: t, amount: 15n * E18 },
          1,
        ),
        item(
          "AeroVoter",
          VOTER,
          "Chain0Rebalanced",
          {
            sources: [{ tokenId: t, amount: 5n * E18 }],
            destinations: [{ tokenId: 0n, amount: 5n * E18, recipient: ZERO }],
          },
          2,
        ),
        item(
          "AeroVoter",
          VOTER,
          "Burned",
          { caller: alice, amount: 2n * E18 },
          3,
        ),
      ]);
      expect(await row(10)).toBe(25n * E18);
      expect(await row(0)).toBe(20n * E18);
      expect(
        (
          await indexer.AeroRootAllocation.get(
            AeroRootAllocationId(chainId, 0n, 0),
          )
        )?.amount,
      ).toBe(3n * E18);
      expect(
        await indexer.AeroRootChainState.get(AeroRootChainStateId(chainId, 0)),
      ).toMatchObject({ totalBurned: 2n * E18, totalAllocated: 23n * E18 });
      expect(
        (
          await indexer.AeroRootChainState.get(
            AeroRootChainStateId(chainId, 10),
          )
        )?.totalAllocated,
      ).toBe(25n * E18);

      await runInTx([
        item(
          "AeroVoter",
          VOTER,
          "TokenCleared",
          { tokenId: t, clearedChains: [0n, 10n, 8453n] },
          1,
        ),
      ]);
      expect(await row(0)).toBe(0n);
      expect(await row(10)).toBe(0n);
      expect(await row(8453)).toBe(0n);
    });

    it("counts every redemption and writes rows only for cross-chain ones", async () => {
      const t = await runInTx([
        item(
          "AeroVoter",
          VOTER,
          "RedeemProcessed",
          {
            chainId: 8453n,
            recipient: alice,
            amount: 3n * E18,
            surplusReported: 7n,
          },
          1,
        ),
        item(
          "AeroVoter",
          VOTER,
          "RedeemProcessed",
          {
            chainId: 10n,
            recipient: bob,
            amount: 4n * E18,
            surplusReported: 9n,
          },
          2,
        ),
        item(
          "AeroMinter",
          MINTER,
          "Minted",
          { recipient: alice, amount: 3n * E18, splitterShare: 1n * E18 },
          3,
        ),
        item("AeroMinter", MINTER, "BaseRateSet", { baseRate: 123n }, 4),
      ]);
      expect(
        await indexer.AeroRedemptionEvent.get(AeroEventId(chainId, t.hash, 1)),
      ).toBeUndefined();
      expect(
        await indexer.AeroRedemptionEvent.get(AeroEventId(chainId, t.hash, 2)),
      ).toMatchObject({
        kind: "PROCESSED",
        sourceChainId: 10,
        amount: 4n * E18,
      });
      expect(
        await indexer.AeroRootChainState.get(
          AeroRootChainStateId(chainId, 8453),
        ),
      ).toMatchObject({ totalRedeemed: 3n * E18, numberOfRedemptions: 1n });
      expect(
        await indexer.AeroMinterState.get(AeroContractStateId(chainId, MINTER)),
      ).toMatchObject({
        totalMinted: 3n * E18,
        totalSplitterShare: 1n * E18,
        numberOfMints: 1n,
        baseRate: 123n,
      });
      expect(
        await indexer.AeroMinterEvent.get(AeroEventId(chainId, t.hash, 4)),
      ).toMatchObject({ kind: "BASE_RATE_SET", value: 123n });
    });
  });

  describe("LeafVoter allocations", () => {
    async function createGauge(gauge: string, pool: string, vrm: string) {
      indexer.Pool.set(
        createMockPool({
          chainId,
          poolAddress: pool,
          isCL: true,
          deployment: POOL_DEPLOYMENT.AERO,
        }),
      );
      await runInTx([
        item(
          "AeroCLGaugeFactory",
          CL_GAUGE_FACTORY,
          "GaugeCreated",
          { gauge, pool, isPool: true },
          1,
        ),
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "GaugeRegistered",
          { gauge, activated: true, registrationCursor: 1n },
          2,
        ),
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "GaugeActivated",
          { gauge, activationCursor: 1n },
          3,
        ),
        item(
          "AeroGaugeManager",
          GAUGE_MANAGER,
          "GaugeCreated",
          {
            target: pool,
            gauge,
            module: alice,
            gaugeFactory: CL_GAUGE_FACTORY,
            votingRewardsManager: vrm,
            creator: alice,
            activated: true,
          },
          4,
        ),
      ]);
    }

    it("books routable gauges, parks the rest idle and returns the dealloc amount", async () => {
      await createGauge(gaugeA, poolA, vrmA);
      await createGauge(gaugeB, poolB, vrmB);
      const t = 77n;
      await runInTx([
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "ChainAllocated",
          {
            tokenId: t,
            allocationDelta: 100n * E18,
            chainAllocation: 100n * E18,
            emissionsPerVP: 5n,
          },
          1,
        ),
      ]);
      // Split: 10 idle (zero gauge), 50 on A, 25 on an unknown gauge (parks
      // idle), 15 returned to root. Strictly ascending, as the LeafVoter requires.
      const allocations = [
        { gauge: AERO_ZERO_GAUGE, allocated: 10n * E18, data: "0x" },
        { gauge: gaugeA, allocated: 50n * E18, data: "0x" },
        { gauge: unknownGauge, allocated: 25n * E18, data: "0x" },
        { gauge: AERO_DEALLOC_GAUGE, allocated: 15n * E18, data: "0x" },
      ].sort((a, b) =>
        a.gauge.toLowerCase() < b.gauge.toLowerCase() ? -1 : 1,
      );
      const split = await runInTx([
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "GaugesAllocated",
          { tokenId: t, allocations, emissionsPerVP: 6n },
          1,
        ),
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "Deallocated",
          { tokenId: t, amount: 15n * E18 },
          2,
        ),
      ]);
      let token = await indexer.AeroLeafTokenState.get(
        AeroLeafTokenStateId(chainId, t),
      );
      expect(token).toMatchObject({
        chainAllocation: 85n * E18,
        gauges: [gaugeA],
        allocations: [50n * E18],
        idleAllocation: 35n * E18,
      });
      expect(
        (await indexer.AeroGauge.get(AeroGaugeId(chainId, gaugeA)))
          ?.totalAllocated,
      ).toBe(50n * E18);
      expect(
        await indexer.AeroLeafVoterState.get(AeroLeafVoterStateId(chainId)),
      ).toMatchObject({
        totalChainAllocation: 85n * E18,
        totalBookedAllocation: 50n * E18,
        emissionsPerVP: 6n,
      });
      // One row per listed entry: requested and booked.
      const legOf = (g: string) => allocations.findIndex((a) => a.gauge === g);
      expect(
        await indexer.AeroAllocationEvent.get(
          AeroEventId(chainId, split.hash, 1, legOf(unknownGauge)),
        ),
      ).toMatchObject({
        kind: "GAUGE_ALLOCATED",
        gaugeAddress: unknownGauge,
        amount: 25n * E18,
        bookedAmount: 0n,
        chainAllocationAfter: 85n * E18,
      });
      expect(
        (
          await indexer.AeroAllocationEvent.get(
            AeroEventId(chainId, split.hash, 1, legOf(gaugeA)),
          )
        )?.bookedAmount,
      ).toBe(50n * E18);

      // Gauge B deactivated (cap 0): a re-split to it parks idle; A is dropped.
      await runInTx([
        item(
          "AeroCLGaugeFactory",
          CL_GAUGE_FACTORY,
          "EmissionCapSet",
          { gauge: gaugeB, cap: 0n, caller: alice },
          1,
        ),
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "GaugesAllocated",
          {
            tokenId: t,
            allocations: [{ gauge: gaugeB, allocated: 85n * E18, data: "0x" }],
            emissionsPerVP: 6n,
          },
          2,
        ),
      ]);
      token = await indexer.AeroLeafTokenState.get(
        AeroLeafTokenStateId(chainId, t),
      );
      expect(token?.gauges).toEqual([]);
      expect(token?.idleAllocation).toBe(85n * E18);
      expect(
        (await indexer.AeroGauge.get(AeroGaugeId(chainId, gaugeA)))
          ?.totalAllocated,
      ).toBe(0n);
      expect(
        (
          await indexer.AeroLeafAllocation.get(
            AeroLeafAllocationId(chainId, t, gaugeA),
          )
        )?.allocated,
      ).toBe(0n);

      // A position allowed onto zero-cap gauges books it.
      await runInTx([
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "CanVoteForZeroCapGaugesSet",
          { tokenId: t, allowed: true },
          1,
        ),
        item(
          "AeroLeafVoter",
          LEAF_VOTER,
          "GaugesAllocated",
          {
            tokenId: t,
            allocations: [{ gauge: gaugeB, allocated: 85n * E18, data: "0x" }],
            emissionsPerVP: 6n,
          },
          2,
        ),
      ]);
      expect(
        (await indexer.AeroGauge.get(AeroGaugeId(chainId, gaugeB)))
          ?.totalAllocated,
      ).toBe(85n * E18);
    });
  });

  describe("allocator rewards", () => {
    it("records incentive programs, their claims and sweeps, and fee claims", async () => {
      // Rewards manager row (normally created by GaugeManager.GaugeCreated).
      indexer.AeroVotingRewardsManager.set({
        id: AeroVotingRewardsManagerId(chainId, vrmA),
        chainId,
        address: vrmA,
        gaugeAddress: gaugeA,
        poolAddress: poolA,
        totalFeesCollectedUSD: 0n,
        numberOfFeeCollections: 0n,
        totalFeesClaimedUSD: 0n,
        numberOfFeeClaims: 0n,
        totalIncentivesFundedUSD: 0n,
        numberOfIncentivePrograms: 0n,
        totalIncentivesClaimedUSD: 0n,
        numberOfIncentiveClaims: 0n,
        lastUpdatedTimestamp: new Date(0),
      });
      // Register the manager contract (GaugeManager.GaugeCreated).
      await runInTx([
        item(
          "AeroGaugeManager",
          GAUGE_MANAGER,
          "GaugeCreated",
          {
            target: poolA,
            gauge: gaugeA,
            module: alice,
            gaugeFactory: CL_GAUGE_FACTORY,
            votingRewardsManager: vrmA,
            creator: alice,
            activated: true,
          },
          1,
        ),
      ]);
      const token = mockToken0Data.address;
      const t = await runInTx([
        item(
          "AeroVotingRewardsManager",
          vrmA,
          "IncentiveCreated",
          {
            programId: 3n,
            token,
            creator: bob,
            amount: 10n * E18,
            start: 1_800_000_000n,
            duration: 86_400n,
          },
          1,
        ),
        item(
          "AeroVotingRewardsManager",
          vrmA,
          "ClaimIncentives",
          { tokenId: 9n, recipient: alice, programId: 3n, amount: 4n * E18 },
          2,
        ),
        item(
          "AeroVotingRewardsManager",
          vrmA,
          "IncentiveSwept",
          { programId: 3n, creator: bob, amount: 1n * E18 },
          3,
        ),
        item(
          "AeroVotingRewardsManager",
          vrmA,
          "ClaimFees",
          { tokenId: 9n, recipient: alice, token, amount: 2n * E18 },
          4,
        ),
      ]);
      expect(
        await indexer.AeroIncentiveProgram.get(
          AeroIncentiveProgramId(chainId, vrmA, 3n),
        ),
      ).toMatchObject({
        token,
        creator: bob,
        amount: 10n * E18,
        amountUSD: 10n * E18,
        totalClaimed: 4n * E18,
        totalSwept: 1n * E18,
        gaugeAddress: gaugeA,
      });
      expect(
        await indexer.AeroVotingRewardsEvent.get(
          AeroEventId(chainId, t.hash, 2),
        ),
      ).toMatchObject({
        kind: "INCENTIVE_CLAIMED",
        token,
        tokenId: 9n,
        amountUSD: 4n * E18,
      });
      expect(
        await indexer.AeroVotingRewardsManager.get(
          AeroVotingRewardsManagerId(chainId, vrmA),
        ),
      ).toMatchObject({
        totalIncentivesFundedUSD: 10n * E18,
        numberOfIncentivePrograms: 1n,
        totalIncentivesClaimedUSD: 4n * E18,
        totalFeesClaimedUSD: 2n * E18,
        numberOfFeeClaims: 1n,
      });
    });
  });

  describe("migration", () => {
    it("records veNFT, liquid and Optimism-settled migrations with totals", async () => {
      const t = await runInTx([
        item(
          "AeroMigration",
          AERODROME_MIGRATION,
          "VeNFTMigrated",
          {
            depositor: alice,
            recipient: alice,
            v2TokenId: 42n,
            amount: 5n * E18,
            out: 5n * E18,
            permanent: true,
            liquid: false,
          },
          1,
        ),
        item(
          "AeroMigration",
          AERODROME_MIGRATION,
          "LiquidMigrated",
          { depositor: bob, recipient: bob, amountIn: 2n * E18, out: 2n * E18 },
          2,
        ),
        item(
          "AeroMigrationEntrypoint",
          VELODROME_ENTRYPOINT,
          "Migrated",
          { nonce: 7n, recipient: bob, tokenAmount: 3n * E18, isLiquid: false },
          3,
        ),
      ]);
      expect(
        await indexer.AeroMigrationEvent.get(AeroEventId(chainId, t.hash, 1)),
      ).toMatchObject({
        kind: "VENFT",
        legacyToken: "AERO_V1",
        legacyTokenId: 42n,
      });
      expect(
        await indexer.AeroMigrationTotals.get(
          AeroContractStateId(chainId, AERODROME_MIGRATION),
        ),
      ).toMatchObject({
        numberOfVeNFTs: 1n,
        veNFTAmountOut: 5n * E18,
        numberOfLiquid: 1n,
        liquidAmountOut: 2n * E18,
      });
      expect(
        await indexer.AeroMigrationTotals.get(
          AeroContractStateId(chainId, VELODROME_ENTRYPOINT),
        ),
      ).toMatchObject({ numberOfSettlements: 1n, settledAmount: 3n * E18 });
    });
  });
});
