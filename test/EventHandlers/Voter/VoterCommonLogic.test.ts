import type {
  LiquidityPoolAggregator,
  PendingVote,
  Token,
  VeNFTState,
  handlerContext,
} from "generated";
import * as LiquidityPoolAggregatorModule from "../../../src/Aggregators/LiquidityPoolAggregator";
import {
  PendingVoteId,
  RootGaugeRootPoolId,
  toChecksumAddress,
} from "../../../src/Constants";
import {
  getTokenDetails,
  getTokensDeposited,
} from "../../../src/Effects/Index";
import type { VoterCommonResult } from "../../../src/EventHandlers/Voter/VoterCommonLogic";
import {
  VoterEventType,
  buildLpDiffFromDistribute,
  computeVoterDistributeValues,
  computeVoterRelatedEntitiesDiff,
  createPendingVoteForDeferredProcessing,
  resolveLeafPoolForRootGauge,
} from "../../../src/EventHandlers/Voter/VoterCommonLogic";

function makeMockContext(effects: {
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
      if (effectDef === getTokensDeposited) {
        // Return undefined if not provided (simulating effect error)
        return effects.tokensDeposited !== undefined
          ? effects.tokensDeposited
          : undefined;
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
      address: toChecksumAddress("0x0000000000000000000000000000000000000001"),
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
      tokensDeposited: 5000000000000000000n, // 5 tokens with 18 decimals
      logs,
    });

    const result = await computeVoterDistributeValues(
      token,
      toChecksumAddress("0x0000000000000000000000000000000000000abc"),
      3000000000000000000n, // 3 tokens emitted
      12345,
      1,
      context,
      true,
    );

    // gaugeIsAlive is passed through to result.isAlive
    expect(result.isAlive).toBe(true);
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
      address: toChecksumAddress("0x0000000000000000000000000000000000000002"),
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

    const result = await computeVoterDistributeValues(
      token,
      toChecksumAddress("0x0000000000000000000000000000000000000000"),
      1n,
      1,
      1,
      context,
      false,
    );

    expect(result.normalizedEmissionsAmountUsd).toBe(0n);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(0n);
    expect(result.isAlive).toBe(false);
    expect(logs.warns).toHaveLength(1);
  });

  it("handles undefined tokensDeposited effect return by using default and logging error", async () => {
    const token: Token = {
      id: "token-undefined",
      address: toChecksumAddress("0x0000000000000000000000000000000000000003"),
      chainId: 1,
      decimals: 18n,
      pricePerUSDNew: 1_000000000000000000n, // $1 in 1e18
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

    // Don't provide tokensDeposited - effect will return undefined; gaugeIsAlive is passed in
    const context = makeMockContext({ logs });

    const result = await computeVoterDistributeValues(
      token,
      toChecksumAddress("0x0000000000000000000000000000000000000abc"),
      1000000000000000000n, // 1 token emitted
      12345,
      1,
      context,
      true,
    );

    // gaugeIsAlive is passed through; tokensDeposited defaults to 0n when effect fails
    expect(result.isAlive).toBe(true);
    expect(result.tokensDeposited).toBe(0n);

    // Should log error for undefined tokensDeposited only
    expect(logs.errors).toHaveLength(1);
    expect(logs.errors[0]).toContain("Failed to fetch tokensDeposited");

    // Calculations should still work with defaults
    expect(result.normalizedEmissionsAmount).toBe(1000000000000000000n);
    expect(result.normalizedVotesDepositedAmountUsd).toBe(0n);
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
    const gaugeAddress = toChecksumAddress(
      "0x0000000000000000000000000000000000000abc",
    );
    const diff = buildLpDiffFromDistribute(res, ts, gaugeAddress);
    expect(diff.totalVotesDeposited).toBe(10n);
    expect(diff.totalVotesDepositedUSD).toBe(20n);
    expect(diff.incrementalTotalEmissions).toBe(3n);
    expect(diff.incrementalTotalEmissionsUSD).toBe(6n);
    expect(diff.gaugeIsAlive).toBe(true);
    expect(diff.lastUpdatedTimestamp).toEqual(new Date(ts));
    expect(diff.gaugeAddress).toBe(gaugeAddress);
  });

  it("omits gaugeAddress when not provided (cross-chain case)", () => {
    const res: VoterCommonResult = {
      isAlive: true,
      tokensDeposited: 5n,
      normalizedEmissionsAmount: 1n,
      normalizedEmissionsAmountUsd: 2n,
      normalizedVotesDepositedAmountUsd: 10n,
    };
    const ts = 1_700_000_000_000;
    const diff = buildLpDiffFromDistribute(res, ts);
    expect(diff.totalVotesDeposited).toBe(5n);
    expect(diff.gaugeAddress).toBeUndefined();
  });
});

describe("computeVoterRelatedEntitiesDiff", () => {
  const mockVeNFTState: VeNFTState = {
    id: "10-1",
    chainId: 10,
    tokenId: 1n,
    owner: toChecksumAddress("0x2222222222222222222222222222222222222222"),
    locktime: 100n,
    lastUpdatedTimestamp: new Date(1000),
    totalValueLocked: 1000n,
    isAlive: true,
  } as VeNFTState;

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

describe("createPendingVoteForDeferredProcessing", () => {
  const chainId = 10;
  const rootPoolAddress = toChecksumAddress(
    "0xC4Cbb0ba3c902Fb4b49B3844230354d45C779F74",
  );
  const tokenId = 1n;
  const weight = 100n;
  const timestamp = new Date(1000000 * 1000);
  const blockNumber = 123456;
  const transactionHash =
    "0x133260f0f7bf0a06d262f09b064a35d3c63178c6b5fd8e4798ba780f357dc7bd";
  const logIndex = 1;

  function makePendingVoteContext(): {
    context: handlerContext;
    pendingVoteSets: PendingVote[];
    warns: string[];
  } {
    const pendingVoteSets: PendingVote[] = [];
    const warns: string[] = [];
    const context = {
      PendingVote: {
        set: (pv: PendingVote) => {
          pendingVoteSets.push(pv);
        },
      },
      log: {
        warn: (msg: unknown) => warns.push(String(msg)),
        info: () => {},
        error: () => {},
      },
    } as unknown as handlerContext;
    return { context, pendingVoteSets, warns };
  }

  it("should call PendingVote.set with correct payload and log.warn for Voted", () => {
    const { context, pendingVoteSets, warns } = makePendingVoteContext();

    createPendingVoteForDeferredProcessing(
      context,
      chainId,
      rootPoolAddress,
      tokenId,
      weight,
      VoterEventType.VOTED,
      timestamp,
      blockNumber,
      transactionHash,
      logIndex,
    );

    expect(pendingVoteSets).toHaveLength(1);
    const pv = pendingVoteSets[0];
    expect(pv.id).toBe(
      PendingVoteId(
        chainId,
        rootPoolAddress,
        tokenId,
        transactionHash,
        logIndex,
      ),
    );
    expect(pv.chainId).toBe(chainId);
    expect(pv.rootPoolAddress).toBe(rootPoolAddress);
    expect(pv.tokenId).toBe(tokenId);
    expect(pv.weight).toBe(weight);
    expect(pv.eventType).toBe("Voted");
    expect(pv.timestamp).toEqual(timestamp);
    expect(pv.blockNumber).toBe(BigInt(blockNumber));
    expect(pv.transactionHash).toBe(transactionHash);

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Vote deferred");
    expect(warns[0]).toContain(rootPoolAddress);
  });

  it("should call PendingVote.set with correct payload and log.warn for Abstained", () => {
    const { context, pendingVoteSets, warns } = makePendingVoteContext();

    createPendingVoteForDeferredProcessing(
      context,
      chainId,
      rootPoolAddress,
      tokenId,
      weight,
      VoterEventType.ABSTAINED,
      timestamp,
      blockNumber,
      transactionHash,
      logIndex,
    );

    expect(pendingVoteSets).toHaveLength(1);
    const pv = pendingVoteSets[0];
    expect(pv.eventType).toBe("Abstained");

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Vote withdrawal deferred");
    expect(warns[0]).toContain(rootPoolAddress);
  });
});

describe("resolveLeafPoolForRootGauge", () => {
  const chainId = 10;
  const gaugeAddress = toChecksumAddress(
    "0xfcD11ec7E9536e7B21C0FA98b95dAF81C0448f33",
  );
  const rootPoolAddress = toChecksumAddress(
    "0x0000000000000000000000000000000000000abc",
  );
  const leafPoolAddress = toChecksumAddress(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const leafChainId = 252;
  const blockNumber = 1000;
  const blockTimestamp = 2000;

  function makeResolveContext(overrides: {
    rootGaugeMapping?: { rootPoolAddress: string } | null;
    rootPoolLeafPools?: { leafPoolAddress: string; leafChainId: number }[];
    /** When true, getWhere returns null (covers ?? [] branch). */
    getWhereReturnsNull?: boolean;
    warns?: string[];
  }): handlerContext {
    const warns = overrides.warns ?? [];
    const rootGaugeMapping = overrides.rootGaugeMapping ?? null;
    const rootPoolLeafPools = overrides.rootPoolLeafPools ?? [];
    const getWhereValue = overrides.getWhereReturnsNull
      ? null
      : rootPoolLeafPools;

    return {
      RootGauge_RootPool: {
        get: vi.fn().mockImplementation(async (id: string) => {
          expect(id).toBe(RootGaugeRootPoolId(chainId, gaugeAddress));
          return rootGaugeMapping ?? undefined;
        }),
      },
      RootPool_LeafPool: {
        getWhere: vi.fn().mockResolvedValue(getWhereValue),
      },
      log: {
        warn: vi.fn((msg: unknown) => warns.push(String(msg))),
        info: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as handlerContext;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null and logs when RootGauge_RootPool has no mapping", async () => {
    const warns: string[] = [];
    const context = makeResolveContext({ warns });

    const result = await resolveLeafPoolForRootGauge(
      context,
      chainId,
      gaugeAddress,
      blockNumber,
      blockTimestamp,
    );

    expect(result).toBeNull();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("No pool address found for the gauge address");
    expect(warns[0]).toContain(gaugeAddress);
    expect(warns[0]).toContain(String(chainId));
  });

  it("returns null and logs when RootPool_LeafPool count is not exactly one (zero)", async () => {
    const warns: string[] = [];
    const context = makeResolveContext({
      rootGaugeMapping: { rootPoolAddress },
      rootPoolLeafPools: [],
      warns,
    });

    const result = await resolveLeafPoolForRootGauge(
      context,
      chainId,
      gaugeAddress,
      blockNumber,
      blockTimestamp,
    );

    expect(result).toBeNull();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(
      "RootPool_LeafPool mapping not found or ambiguous",
    );
    expect(warns[0]).toContain("count: 0");
  });

  it("returns null and logs when RootPool_LeafPool getWhere returns null (?? [] branch)", async () => {
    const warns: string[] = [];
    const context = makeResolveContext({
      rootGaugeMapping: { rootPoolAddress },
      getWhereReturnsNull: true,
      warns,
    });

    const result = await resolveLeafPoolForRootGauge(
      context,
      chainId,
      gaugeAddress,
      blockNumber,
      blockTimestamp,
    );

    expect(result).toBeNull();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(
      "RootPool_LeafPool mapping not found or ambiguous",
    );
    expect(warns[0]).toContain("count: 0");
  });

  it("returns null and logs when RootPool_LeafPool count is not exactly one (multiple)", async () => {
    const warns: string[] = [];
    const context = makeResolveContext({
      rootGaugeMapping: { rootPoolAddress },
      rootPoolLeafPools: [
        { leafPoolAddress: "0x111", leafChainId: 252 },
        { leafPoolAddress: "0x222", leafChainId: 252 },
      ],
      warns,
    });

    const result = await resolveLeafPoolForRootGauge(
      context,
      chainId,
      gaugeAddress,
      blockNumber,
      blockTimestamp,
    );

    expect(result).toBeNull();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("count: 2");
  });

  it("returns null and logs when loadPoolData returns null", async () => {
    vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue(
      null,
    );

    const warns: string[] = [];
    const context = makeResolveContext({
      rootGaugeMapping: { rootPoolAddress },
      rootPoolLeafPools: [{ leafPoolAddress, leafChainId }],
      warns,
    });

    const result = await resolveLeafPoolForRootGauge(
      context,
      chainId,
      gaugeAddress,
      blockNumber,
      blockTimestamp,
    );

    expect(result).toBeNull();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("Leaf pool data not found");
    expect(warns[0]).toContain(leafPoolAddress);
    expect(warns[0]).toContain(String(leafChainId));
  });

  it("returns leaf pool and isCrossChain when resolution succeeds", async () => {
    const mockPool = {
      id: `10-${leafPoolAddress}`,
      poolAddress: leafPoolAddress,
      chainId: leafChainId,
    } as unknown as LiquidityPoolAggregator;

    vi.spyOn(LiquidityPoolAggregatorModule, "loadPoolData").mockResolvedValue({
      liquidityPoolAggregator: mockPool,
      token0Instance: {} as Token,
      token1Instance: {} as Token,
    });

    const context = makeResolveContext({
      rootGaugeMapping: { rootPoolAddress },
      rootPoolLeafPools: [{ leafPoolAddress, leafChainId }],
    });

    const result = await resolveLeafPoolForRootGauge(
      context,
      chainId,
      gaugeAddress,
      blockNumber,
      blockTimestamp,
    );

    expect(result).not.toBeNull();
    expect(result?.pool).toBe(mockPool);
    expect(result?.isCrossChain).toBe(true);
    expect(LiquidityPoolAggregatorModule.loadPoolData).toHaveBeenCalledWith(
      leafPoolAddress,
      leafChainId,
      context,
      blockNumber,
      blockTimestamp,
    );
  });
});
