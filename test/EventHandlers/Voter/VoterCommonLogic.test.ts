import type { Token, handlerContext } from "generated";
import {
  getIsAlive,
  getTokenDetails,
  getTokensDeposited,
} from "../../../src/Effects/Index";
import type { VoterCommonResult } from "../../../src/EventHandlers/Voter/VoterCommonLogic";
import {
  buildLpDiffFromDistribute,
  computeVoterDistributeValues,
} from "../../../src/EventHandlers/Voter/VoterCommonLogic";

function makeMockContext(effects: {
  isAlive?: boolean;
  tokensDeposited?: bigint;
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
      if (effectDef === getIsAlive) {
        return effects.isAlive ?? true;
      }
      if (effectDef === getTokensDeposited) {
        return effects.tokensDeposited ?? 0n;
      }
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
  it("returns snapshot votes deposited and cumulative emissions with USD conversions", async () => {
    const token: Token = {
      id: "token-1",
      address: "0x0000000000000000000000000000000000000001",
      chainId: 1,
      decimals: 18n,
      pricePerUSDNew: 2_000000000000000000n, // $2 in 1e18
      // unused by helper but required by type
      lastUpdatedTimestamp: new Date(0),
      isWhitelisted: true,
      name: "TKN",
      symbol: "TKN",
    } as unknown as Token;

    const logs = {
      warns: [] as string[],
      infos: [] as string[],
      errors: [] as string[],
    };

    const context = makeMockContext({
      isAlive: true,
      tokensDeposited: 5000000000000000000n, // 5 tokens with 18 decimals
      logs,
    });

    const result = await computeVoterDistributeValues({
      rewardToken: token,
      gaugeAddress: "0x0000000000000000000000000000000000000abc",
      voterAddress: "0x0000000000000000000000000000000000000def",
      amountEmittedRaw: 3000000000000000000n, // 3 tokens emitted
      blockNumber: 12345,
      chainId: 1,
      context,
    });

    // tokensDeposited is a snapshot passthrough
    expect(result.tokensDeposited).toBe(5000000000000000000n);

    // normalizedEmissionsAmount equals 3e18 (already 18 decimals) -> 3e18
    expect(result.normalizedEmissionsAmount).toBe(3000000000000000000n);

    // USD: 3e18 * $2 (1e18) / 1e18 = 6e18
    expect(result.normalizedEmissionsAmountUsd).toBe(6000000000000000000n);

    // votes deposited USD: 5e18 * $2 = 10e18
    expect(result.normalizedVotesDepositedAmountUsd).toBe(
      10000000000000000000n,
    );

    // no warnings for price zero
    expect(logs.warns).toHaveLength(0);
  });

  it("logs a warning when token price is zero, but still computes values", async () => {
    const token: Token = {
      id: "token-0",
      address: "0x0000000000000000000000000000000000000002",
      chainId: 1,
      decimals: 18n,
      pricePerUSDNew: 0n,
      lastUpdatedTimestamp: new Date(0),
      isWhitelisted: true,
      name: "Z",
      symbol: "Z",
    } as unknown as Token;

    const logs = {
      warns: [] as string[],
      infos: [] as string[],
      errors: [] as string[],
    };
    const context = makeMockContext({ tokensDeposited: 1n, logs });

    const result = await computeVoterDistributeValues({
      rewardToken: token,
      gaugeAddress: "0x0",
      voterAddress: "0x1",
      amountEmittedRaw: 1n,
      blockNumber: 1,
      chainId: 1,
      context,
    });

    expect(result.normalizedEmissionsAmountUsd).toBe(0n);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(0n);
    expect(logs.warns).toHaveLength(1);
  });
});

describe("buildLpDiffFromDistribute", () => {
  it("composes snapshot and cumulative fields correctly", () => {
    const res: VoterCommonResult = {
      isAlive: true,
      tokensDeposited: 10n,
      normalizedEmissionsAmount: 3n,
      normalizedEmissionsAmountUsd: 6n,
      normalizedVotesDepositedAmountUsd: 20n,
    };
    const ts = 1_700_000_000_000;
    const diff = buildLpDiffFromDistribute(res, "0xgauge", ts);
    expect(diff.totalVotesDeposited).toBe(10n);
    expect(diff.totalVotesDepositedUSD).toBe(20n);
    expect(diff.incrementalTotalEmissions).toBe(3n);
    expect(diff.incrementalTotalEmissionsUSD).toBe(6n);
    expect(diff.gaugeIsAlive).toBe(true);
    expect(diff.lastUpdatedTimestamp).toEqual(new Date(ts));
    expect(diff.gaugeAddress).toBe("0xgauge");
  });
});
