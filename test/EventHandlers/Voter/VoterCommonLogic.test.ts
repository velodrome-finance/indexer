import type { Token, VeNFTState } from "envio";
import { toChecksumAddress } from "../../../src/Constants";
import { getTokenDetails } from "../../../src/Effects/Index";
import type { handlerContext } from "../../../src/EntityTypes";
import type { VoterCommonResult } from "../../../src/EventHandlers/Voter/VoterCommonLogic";
import {
  VoterEventType,
  buildPoolDiffFromDistribute,
  computeVoterDistributeValues,
  computeVoterRelatedEntitiesDiff,
} from "../../../src/EventHandlers/Voter/VoterCommonLogic";
import { setupCommon } from "../Pool/common";

function makeMockContext(effects: {
  tokenGet?: Token | undefined;
  tokenDetails?: { name: string; symbol: string; decimals: number };
  logs?: { warns: string[]; infos: string[]; errors: string[] };
  capturedSets?: Token[];
}): handlerContext {
  const logs = effects.logs || { warns: [], infos: [], errors: [] };
  const capturedSets = effects.capturedSets || [];
  const tokenGet = effects.tokenGet;
  const tokenDetails = effects.tokenDetails || {
    name: "N/A",
    symbol: "N/A",
    decimals: 18,
  };

  const tokenApi: {
    get: (id: string) => Promise<Token | undefined>;
    set: (t: Token) => void;
  } = {
    get: async (_id: string) => tokenGet,
    set: (t: Token) => {
      capturedSets.push(t);
    },
  };

  return {
    effect: async (effectDef: unknown, _input: unknown) => {
      if (effectDef === getTokenDetails) {
        return tokenDetails;
      }
      throw new Error("Unexpected effect call");
    },
    Token: tokenApi as unknown,
    log: {
      warn: (msg: unknown) => logs.warns.push(String(msg)),
      info: (msg: unknown) => logs.infos.push(String(msg)),
      error: (msg: unknown) => logs.errors.push(String(msg)),
    },
  } as unknown as handlerContext;
}

describe("computeVoterDistributeValues", () => {
  const { createMockPool } = setupCommon();
  const E18 = 10n ** 18n;
  const gauge = toChecksumAddress("0x0000000000000000000000000000000000000abc");
  const makeToken = (overrides: Partial<Token>): Token =>
    ({
      id: "token-1",
      address: toChecksumAddress("0x0000000000000000000000000000000000000001"),
      decimals: 18n,
      pricePerUSDNew: 2n * E18, // $2 in 1e18
      lastUpdatedTimestamp: new Date(0),
      isWhitelisted: true,
      name: "TKN",
      symbol: "TKN",
      ...overrides,
    }) as unknown as Token;
  const newLogs = () => ({
    warns: [] as string[],
    infos: [] as string[],
    errors: [] as string[],
  });

  it("derives the gauge balance after the distribution from the pool's event totals", () => {
    const pool = createMockPool({
      totalEmissions: 100n * E18,
      totalEmissionsRedistributed: 7n * E18,
      totalEmissionsForfeited: 2n * E18,
      totalGaugeRewardsClaimed: 60n * E18,
      totalGaugeEarlyWithdrawPenalties: 5n * E18,
    });
    const logs = newLogs();

    const result = computeVoterDistributeValues(
      makeToken({}),
      pool,
      gauge,
      3n * E18, // 3 tokens emitted now
      pool.chainId,
      makeMockContext({ logs }),
      true,
    );

    expect(result.isAlive).toBe(true);
    // 100 + 3 + 7 - 2 - 60 - 5 = 43
    expect(result.tokensDeposited).toBe(43n * E18);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(86n * E18);
    expect(result.normalizedEmissionsAmount).toBe(3n * E18);
    expect(result.normalizedEmissionsAmountUsd).toBe(6n * E18);
    expect(logs.warns).toHaveLength(0);
    expect(logs.errors).toHaveLength(0);
  });

  it("combines 1e18 emissions with raw totals of a non-18-decimal reward token and returns raw units", () => {
    // totalEmissions is stored 1e18-normalized; claims, penalties and
    // Redistributor totals are raw reward-token units (6 decimals here).
    const pool = createMockPool({
      totalEmissions: 10n * E18, // 10 tokens
      totalEmissionsRedistributed: 1_000_000n, // 1 token
      totalEmissionsForfeited: 0n,
      totalGaugeRewardsClaimed: 4_000_000n, // 4 tokens
      totalGaugeEarlyWithdrawPenalties: 500_000n, // 0.5 token
    });

    const result = computeVoterDistributeValues(
      makeToken({ decimals: 6n, pricePerUSDNew: E18 }),
      pool,
      gauge,
      2_000_000n, // 2 tokens emitted now
      pool.chainId,
      makeMockContext({}),
      true,
    );

    expect(result.normalizedEmissionsAmount).toBe(2n * E18);
    // 10 + 2 + 1 - 4 - 0.5 = 8.5 tokens, in raw 6-decimal units
    expect(result.tokensDeposited).toBe(8_500_000n);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(85n * 10n ** 17n);
  });

  it("clamps a negative derived balance to zero and warns", () => {
    const pool = createMockPool({
      totalEmissions: E18,
      totalEmissionsRedistributed: 0n,
      totalEmissionsForfeited: 0n,
      totalGaugeRewardsClaimed: 5n * E18,
      totalGaugeEarlyWithdrawPenalties: 0n,
    });
    const logs = newLogs();

    const result = computeVoterDistributeValues(
      makeToken({}),
      pool,
      gauge,
      E18,
      pool.chainId,
      makeMockContext({ logs }),
      true,
    );

    expect(result.tokensDeposited).toBe(0n);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(0n);
    expect(logs.warns).toHaveLength(1);
    expect(logs.warns[0]).toContain("is negative");
  });

  it("computes zero USD values when token price is zero", () => {
    const localPool = createMockPool({ totalEmissions: E18 });
    const result = computeVoterDistributeValues(
      makeToken({ pricePerUSDNew: 0n }),
      localPool,
      gauge,
      1n,
      localPool.chainId,
      makeMockContext({}),
      false,
    );

    expect(result.normalizedEmissionsAmountUsd).toBe(0n);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(0n);
    expect(result.isAlive).toBe(false);
  });

  it("zeros emissions + votes-deposited USD when reward token is non-whitelisted (#755 trust gate)", () => {
    // A non-WL reward token whose price the indexer cannot trust contributes
    // 0n to both USD aggregates; the raw amounts are unaffected.
    const pool = createMockPool({
      totalEmissions: 2n * E18,
      totalEmissionsRedistributed: 0n,
      totalEmissionsForfeited: 0n,
      totalGaugeRewardsClaimed: 0n,
      totalGaugeEarlyWithdrawPenalties: 0n,
    });

    const result = computeVoterDistributeValues(
      makeToken({ isWhitelisted: false }),
      pool,
      gauge,
      3n * E18,
      pool.chainId,
      makeMockContext({}),
      true,
    );

    expect(result.normalizedEmissionsAmount).toBe(3n * E18);
    expect(result.tokensDeposited).toBe(5n * E18);
    expect(result.normalizedEmissionsAmountUsd).toBe(0n);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(0n);
  });
});

describe("buildPoolDiffFromDistribute", () => {
  it("composes snapshot and cumulative fields correctly", () => {
    const res: VoterCommonResult = {
      isAlive: true,
      tokensDeposited: 10n,
      normalizedEmissionsAmount: 3n,
      normalizedEmissionsAmountUsd: 6n,
      normalizedVotesDepositedAmountUsd: 20n,
    };
    const ts = 1_700_000_000_000;
    const gaugeAddress = toChecksumAddress(
      "0x0000000000000000000000000000000000000abc",
    );
    const diff = buildPoolDiffFromDistribute(res, ts, gaugeAddress);
    expect(diff.totalVotesDeposited).toBe(10n);
    expect(diff.totalVotesDepositedUSD).toBe(20n);
    expect(diff.incrementalTotalEmissions).toBe(3n);
    expect(diff.incrementalTotalEmissionsUSD).toBe(6n);
    expect(diff.gaugeIsAlive).toBe(true);
    expect(diff.lastUpdatedTimestamp).toEqual(new Date(ts));
    expect(diff.gaugeAddress).toBe(gaugeAddress);
  });
});

describe("computeVoterRelatedEntitiesDiff", () => {
  const mockVeNFTState: VeNFTState = {
    id: "10-1",
    tokenId: 1n,
    owner: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    locktime: 100n,
    isPermanent: false,
    lastUpdatedTimestamp: new Date(1000),
    totalValueLocked: 1000n,
    isAlive: true,
    lastSnapshotTimestamp: undefined,
  };

  const timestamp = new Date(2000);

  it("returns positive weight delta for VOTED event", () => {
    const totalWeight = 500n;
    const weight = 100n;

    const result = computeVoterRelatedEntitiesDiff(
      totalWeight,
      weight,
      mockVeNFTState,
      timestamp,
      VoterEventType.VOTED,
    );

    expect(result.poolVoteDiff.veNFTamountStaked).toBe(500n);
    expect(result.userStatsPerPoolDiff.incrementalVeNFTamountStaked).toBe(100n);
    expect(result.veNFTPoolVoteDiff.incrementalVeNFTamountStaked).toBe(100n);
    expect(result.veNFTPoolVoteDiff.veNFTStateId).toBe("10-1");
    expect(result.userStatsPerPoolDiff.lastActivityTimestamp).toBe(timestamp);
    expect(result.veNFTPoolVoteDiff.lastUpdatedTimestamp).toBe(timestamp);
  });

  it("returns negative weight delta for ABSTAINED event", () => {
    const totalWeight = 400n;
    const weight = 100n;

    const result = computeVoterRelatedEntitiesDiff(
      totalWeight,
      weight,
      mockVeNFTState,
      timestamp,
      VoterEventType.ABSTAINED,
    );

    expect(result.poolVoteDiff.veNFTamountStaked).toBe(400n);
    expect(result.userStatsPerPoolDiff.incrementalVeNFTamountStaked).toBe(
      -100n,
    );
    expect(result.veNFTPoolVoteDiff.incrementalVeNFTamountStaked).toBe(-100n);
    expect(result.veNFTPoolVoteDiff.veNFTStateId).toBe("10-1");
  });
});
