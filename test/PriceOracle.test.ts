import { CHAIN_CONSTANTS, toChecksumAddress } from "../src/Constants";
import * as PriceOracle from "../src/PriceOracle";

import type { Token, handlerContext } from "generated";

import { setupCommon } from "./EventHandlers/Pool/common";

describe("PriceOracle", () => {
  const mockContext = {
    effect: vi.fn(),
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    Token: {
      set: vi.fn(),
      get: vi.fn(),
      getOrThrow: vi.fn(),
      getOrCreate: vi.fn(),
      deleteUnsafe: vi.fn(),
      getWhere: {
        address: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
        chainId: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
      },
    },
    TokenPriceSnapshot: {
      set: vi.fn(),
      get: vi.fn(),
      getOrThrow: vi.fn(),
      getOrCreate: vi.fn(),
      deleteUnsafe: vi.fn(),
      getWhere: {
        address: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
        chainId: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
        lastUpdatedTimestamp: {
          eq: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
        },
      },
    },
  } as unknown as Partial<handlerContext>;

  const chainId = 10; // Optimism
  const startBlock = CHAIN_CONSTANTS[chainId].oracle.startBlock;
  const blockNumber = startBlock + 1;
  const blockDatetime = new Date("2023-01-01T00:00:00Z");

  const { mockToken0Data } = setupCommon();

  const defaultEffectImplementation = async (
    effect: unknown,
    input: unknown,
  ) => {
    // Mock the effect calls for testing (effect has .name at runtime from createEffect)
    const name = (effect as { name?: string }).name;
    if (name === "getTokenPrice") {
      return {
        pricePerUSDNew: 2n * 10n ** 18n,
      };
    }
    if (name === "getTokenDetails") {
      return {
        name: "Test Token",
        decimals: 18,
        symbol: "TEST",
      };
    }
    if (name === "hasContractBytecode") {
      return { hasCode: true };
    }
    return {};
  };

  beforeEach(() => {
    // Reset effect mock to default implementation before each test
    vi.mocked(mockContext.effect)?.mockImplementation(
      defaultEffectImplementation,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("refreshTokenPrice", () => {
    let testLastUpdated: Date;

    const mockTokenPriceData = {
      pricePerUSDNew: 2n * 10n ** 18n,
      decimals: mockToken0Data.decimals,
    };

    describe("if the update interval hasn't passed", () => {
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime());
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
      });
      it("should not update prices if the update interval hasn't passed", async () => {
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).not.toHaveBeenCalled();
      });
    });
    describe("if less than 1 hour has passed (e.g. 30 minutes)", () => {
      beforeEach(async () => {
        const thirtyMinutesAgo = new Date(
          blockDatetime.getTime() - 30 * 60 * 1000,
        );
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: thirtyMinutesAgo,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
      });
      it("should not refresh price when only 30 minutes have passed", async () => {
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).not.toHaveBeenCalled();
      });
    });
    describe("if the update interval has passed", () => {
      let updatedToken: Token;
      let testLastUpdated: Date;
      beforeEach(async () => {
        testLastUpdated = new Date(blockDatetime.getTime() - 61 * 60 * 1000);
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
        updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
      });
      it("should update prices if the update interval has passed", async () => {
        expect(updatedToken.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBeGreaterThan(
          testLastUpdated.getTime(),
        );
      });
      it("should create a new TokenPriceSnapshot entity", async () => {
        const tokenPrice = vi.mocked(mockContext.TokenPriceSnapshot?.set)?.mock
          .lastCall?.[0];
        expect(tokenPrice?.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(tokenPrice?.lastUpdatedTimestamp.getTime()).toBeGreaterThan(
          testLastUpdated.getTime(),
        );
        expect(tokenPrice?.isWhitelisted).toBe(mockToken0Data.isWhitelisted);
      });
    });

    describe("when pricePerUSDNew is 0n and <1h has passed", () => {
      // Issue #676: $0 tokens are now subject to the same 1-hour throttle as
      // non-zero tokens. The effect cache rounds to hourly block buckets, so
      // within an hour we'd hit the cache anyway — gating here avoids the
      // extra Token.set and snapshot write.
      beforeEach(async () => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: new Date(blockDatetime.getTime()),
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
      });
      it("does not refresh while inside the 1-hour throttle window", () => {
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).not.toHaveBeenCalled();
      });
    });

    describe("lastUpdatedTimestamp advances on every $0 attempt", () => {
      // Issue #676: the 1-hour throttle is gated on lastUpdatedTimestamp, so
      // it must move forward even when the oracle keeps returning $0 —
      // otherwise an active $0 token would be re-refreshed on every event,
      // wasting writes. This also subsumes the #673 pre-oracle fix (timestamp
      // no longer needs an oracle-deployed gate; it always advances).
      const zeroPriceEffects = async (effect: unknown, _input: unknown) => {
        const name = (effect as { name?: string }).name;
        if (name === "getTokenPrice") return { pricePerUSDNew: 0n };
        if (name === "getTokenDetails") {
          return { name: "VELO", decimals: 18, symbol: "VELO" };
        }
        return {};
      };

      it("advances the timestamp when oracle is not yet deployed (#673 regression)", async () => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.effect)?.mockImplementation(zeroPriceEffects);

        const preOracleBlock = startBlock - 1;
        const creationDate = new Date(blockDatetime.getTime());
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: creationDate,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000 + 60 * 60;

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          preOracleBlock,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(0n);
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBe(
          blockTimestamp * 1000,
        );
      });

      it("advances the timestamp post-oracle when price stays $0 (so the throttle ticks forward)", async () => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.effect)?.mockImplementation(zeroPriceEffects);

        const postOracleBlock = startBlock + 1;
        const earlierTimestamp = new Date(
          blockDatetime.getTime() - 5 * 24 * 60 * 60 * 1000,
        );
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: earlierTimestamp,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          postOracleBlock,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(0n);
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBe(
          blockTimestamp * 1000,
        );
      });
    });

    describe("Issue #676: $0 tokens stale for >30d are still retried (hourly throttle only)", () => {
      // The previous 30-day $0 backoff trapped tokens whose first price
      // attempt happened during a broken-oracle window (e.g. WETH/USDC/OP on
      // Optimism, stuck at $0 since 2023). Replaced with a uniform 1-hour
      // throttle: cost is bounded by Envio's effect cache (hourly-rounded
      // block buckets) and the 1-hour gate, so we no longer need to "stop
      // retrying" — every hourly window gets a fresh fetch attempt.
      it("retries the oracle when a $0 token has been stale for 31 days", async () => {
        vi.mocked(mockContext.Token?.set)?.mockClear();

        const thirtyOneDaysAgo = new Date(
          blockDatetime.getTime() - 31 * 24 * 60 * 60 * 1000,
        );
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: thirtyOneDaysAgo,
        };
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalled();
        expect(updatedToken.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
      });
    });

    describe("when lastUpdatedTimestamp is missing", () => {
      let updatedToken: Token;
      beforeEach(async () => {
        const fetchedToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: undefined,
        } as unknown as Token;
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
        updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
      });
      it("should refresh price when lastUpdatedTimestamp is missing", async () => {
        expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalled();
        expect(updatedToken.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
        expect(updatedToken.lastUpdatedTimestamp).toBeInstanceOf(Date);
      });
    });

    describe("Override path: blacklist + rebind (issue #669)", () => {
      // Issue #669: tokens whose on-chain oracle is structurally unusable get
      // either forced to 0 (blacklist) or copied from another chain's already-
      // priced Token entity (rebind). Both paths bypass the *local* on-chain
      // oracle entirely. The rebind path may dispatch a single cross-chain
      // `getTokenPrice` against the SOURCE chain when the local Token entity
      // for the source token hasn't been priced yet (cold-sync gap).
      const oneHourAndOneMinuteAgo = () =>
        new Date(blockDatetime.getTime() - 61 * 60 * 1000);

      beforeEach(() => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.Token?.get)?.mockReset();
        vi.mocked(mockContext.effect)?.mockClear();
        vi.mocked(mockContext.TokenPriceSnapshot?.set)?.mockClear();
      });

      it("blacklisted token: forces price to 0 and skips the oracle entirely", async () => {
        const MANATEE_OP = toChecksumAddress(
          "0x7909Bda52eAf7C3cc12745E727Eb527a485241D8",
        );
        const fetchedToken = {
          ...mockToken0Data,
          address: MANATEE_OP,
          pricePerUSDNew: 388_328n * 10n ** 18n, // contaminated baseline
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };

        const result = await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          10, // Optimism, where $Manatee is blacklisted
          mockContext as handlerContext,
        );

        expect(result.pricePerUSDNew).toBe(0n);
        expect(vi.mocked(mockContext.effect)).not.toHaveBeenCalled();
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).not.toHaveBeenCalled();
      });

      it("rebind: copies price from the source chain's Token entity", async () => {
        const RSETH_SWELL = toChecksumAddress(
          "0xc3eaCf0612346366Db554c991D7858716db09f58",
        );
        const WRSETH_BASE = toChecksumAddress(
          "0xEDfa23602D0EC14714057867A78d01e94176BEA0",
        );
        const sourcePrice = 2_443n * 10n ** 18n;
        vi.mocked(mockContext.Token?.get)?.mockImplementation(async (id) => {
          if (id === `8453-${WRSETH_BASE}`) {
            return { pricePerUSDNew: sourcePrice } as Token;
          }
          return undefined;
        });

        const fetchedToken = {
          ...mockToken0Data,
          address: RSETH_SWELL,
          pricePerUSDNew: 3_620_000n * 10n ** 18n, // corrupt baseline ($3.62M)
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };

        const result = await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          1923, // Swell, where rsETH rebinds to wrsETH/Base
          mockContext as handlerContext,
        );

        expect(result.pricePerUSDNew).toBe(sourcePrice);
        expect(vi.mocked(mockContext.effect)).not.toHaveBeenCalled();
        // Snapshot should fire when source has a non-zero price
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).toHaveBeenCalled();
      });

      // Worked example for the cross-chain prefetch:
      //   Fraxtal handler firing at wall-clock T (block 9_999_999 on Fraxtal)
      //   wants the price of XVELO (which rebinds to VELO/OP).
      //   Local Token entity for VELO/OP is unpriced (OP indexer is behind).
      //   → estimateBlockAtTimestamp(10, T)  estimates VELO/OP's block at T
      //   → roundBlockToInterval(estimate, 10) snaps to a 1-hour bucket
      //   → context.effect(getTokenPrice, { tokenAddress: VELO_OP, chainId: 10, blockNumber: snapped })
      //   When the OP indexer eventually refreshes VELO at any block in that
      //   same hour, it rounds to the same bucket → cache hit, zero extra RPCs.
      // Both rebind sources (OP, Base) anchor in mid-2023, so prefetch tests
      // pick a timestamp comfortably after both: 2023-11-16 (~unix 1_700_100_000).
      const postAnchorTimestamp = 1_700_100_000;
      const postAnchorDate = new Date(postAnchorTimestamp * 1000);
      const postAnchorOneHourAgo = () =>
        new Date(postAnchorDate.getTime() - 61 * 60 * 1000);

      it("rebind with unpriced source: prefetches the source chain's oracle", async () => {
        const XVELO = toChecksumAddress(
          "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
        );
        const VELO_OP = toChecksumAddress(
          "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
        );
        const sourcePrice = 5n * 10n ** 17n; // $0.50

        // Local Token entity for VELO/OP not yet priced (cold-sync gap).
        vi.mocked(mockContext.Token?.get)?.mockResolvedValue(undefined);

        // Source-chain prefetch returns the live VELO/OP price.
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect, input) => {
            const name = (effect as { name?: string }).name;
            const args = input as { tokenAddress?: string; chainId?: number };
            if (
              name === "getTokenPrice" &&
              args.chainId === 10 &&
              args.tokenAddress === VELO_OP
            ) {
              return { pricePerUSDNew: sourcePrice, priceOracleType: "V3" };
            }
            return { pricePerUSDNew: 0n, priceOracleType: "V1" };
          },
        );

        const fetchedToken = {
          ...mockToken0Data,
          address: XVELO,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: postAnchorOneHourAgo(),
        };

        const result = await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          postAnchorTimestamp,
          252, // Fraxtal — XVELO rebinds to VELO/OP
          mockContext as handlerContext,
        );

        expect(result.pricePerUSDNew).toBe(sourcePrice);
        // The effect must dispatch against the SOURCE chain (10), not the
        // local chain (252). That's what makes the cache key reusable when
        // the OP indexer eventually catches up.
        expect(vi.mocked(mockContext.effect)).toHaveBeenCalledWith(
          expect.objectContaining({ name: "getTokenPrice" }),
          expect.objectContaining({ tokenAddress: VELO_OP, chainId: 10 }),
        );
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).toHaveBeenCalled();
      });

      it("rebind with unpriced source AND prefetch returns 0: writes 0 (no fall-through to local oracle)", async () => {
        const XVELO = toChecksumAddress(
          "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
        );
        vi.mocked(mockContext.Token?.get)?.mockResolvedValue(undefined);
        // Source-chain prefetch also returns 0 (no price path on source oracle).
        vi.mocked(mockContext.effect)?.mockResolvedValue({
          pricePerUSDNew: 0n,
          priceOracleType: "V3",
        });

        const fetchedToken = {
          ...mockToken0Data,
          address: XVELO,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: postAnchorOneHourAgo(),
        };

        const result = await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          postAnchorTimestamp,
          252, // Fraxtal
          mockContext as handlerContext,
        );

        // Prefetched 0 — write 0. We MUST NOT fall through to the local
        // (corrupt) oracle: that's the whole point of the rebind.
        expect(result.pricePerUSDNew).toBe(0n);
        expect(vi.mocked(mockContext.effect)).toHaveBeenCalledWith(
          expect.objectContaining({ name: "getTokenPrice" }),
          expect.objectContaining({ chainId: 10 }),
        );
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).not.toHaveBeenCalled();
      });
    });

    describe("Metadata heal: empty symbol/name (issue #672)", () => {
      // Issue #672: Soneium pools display tokens with `?` (empty symbol). Root
      // cause is a transient RPC failure during the single createTokenEntity
      // call when the pool's PoolCreated event was first seen — the empty
      // symbol/name was persisted and never re-fetched, since ERC20 metadata
      // was treated as immutable. Heal path: whenever refreshTokenPrice runs
      // and observes an empty symbol or name, re-fetch via getTokenDetails
      // and overlay the healed fields onto the Token entity.
      const oneHourAndOneMinuteAgo = () =>
        new Date(blockDatetime.getTime() - 61 * 60 * 1000);

      beforeEach(() => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.effect)?.mockClear();
        vi.mocked(mockContext.log?.error)?.mockClear();
      });

      it("heals empty symbol on refresh by calling getTokenDetails and writing the value", async () => {
        const fetchedToken = {
          ...mockToken0Data,
          symbol: "",
          name: "Tether USD",
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.symbol).toBe("TEST");
        // getTokenDetails must have been invoked
        const detailsCall = vi
          .mocked(mockContext.effect)
          ?.mock.calls.find(
            (c) => (c[0] as { name?: string }).name === "getTokenDetails",
          );
        expect(detailsCall).toBeDefined();
      });

      it("does NOT call getTokenDetails when symbol and name are already populated", async () => {
        const fetchedToken = {
          ...mockToken0Data,
          symbol: "USDT",
          name: "Tether USD",
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const detailsCall = vi
          .mocked(mockContext.effect)
          ?.mock.calls.find(
            (c) => (c[0] as { name?: string }).name === "getTokenDetails",
          );
        expect(detailsCall).toBeUndefined();
      });

      it("preserves the existing empty symbol when getTokenDetails still returns empty", async () => {
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenDetails") {
              return { name: "", decimals: 18, symbol: "" };
            }
            if (name === "getTokenPrice") {
              return { pricePerUSDNew: 2n * 10n ** 18n };
            }
            return {};
          },
        );

        const fetchedToken = {
          ...mockToken0Data,
          symbol: "",
          name: "",
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.symbol).toBe("");
        expect(updatedToken.name).toBe("");
      });

      it("does NOT abort price refresh when getTokenDetails throws", async () => {
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenDetails") {
              throw new Error("RPC down");
            }
            if (name === "getTokenPrice") {
              return { pricePerUSDNew: 2n * 10n ** 18n };
            }
            return {};
          },
        );

        const fetchedToken = {
          ...mockToken0Data,
          symbol: "",
          name: "",
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        // Price should still update; symbol/name preserved as empty
        expect(updatedToken.pricePerUSDNew).toBe(2n * 10n ** 18n);
        expect(updatedToken.symbol).toBe("");
        // Metadata error should be logged
        expect(vi.mocked(mockContext.log?.error)).toHaveBeenCalledWith(
          expect.stringContaining("Error refreshing token metadata"),
        );
      });

      it("heals symbol on the blacklist path (token forced to 0 still gets symbol)", async () => {
        const MANATEE_OP = toChecksumAddress(
          "0x7909Bda52eAf7C3cc12745E727Eb527a485241D8",
        );
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenDetails") {
              return { name: "$Manatee", decimals: 18, symbol: "MANATEE" };
            }
            return {};
          },
        );

        const fetchedToken = {
          ...mockToken0Data,
          address: MANATEE_OP,
          symbol: "",
          name: "",
          pricePerUSDNew: 388_328n * 10n ** 18n,
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          10,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.symbol).toBe("MANATEE");
        expect(updatedToken.pricePerUSDNew).toBe(0n);
      });

      it("heals symbol on the rebind path", async () => {
        const RSETH_SWELL = toChecksumAddress(
          "0xc3eaCf0612346366Db554c991D7858716db09f58",
        );
        const WRSETH_BASE = toChecksumAddress(
          "0xEDfa23602D0EC14714057867A78d01e94176BEA0",
        );
        const sourcePrice = 2_443n * 10n ** 18n;

        vi.mocked(mockContext.Token?.get)?.mockImplementation(async (id) => {
          if (id === `8453-${WRSETH_BASE}`) {
            return { pricePerUSDNew: sourcePrice } as Token;
          }
          return undefined;
        });
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenDetails") {
              return { name: "rsETH", decimals: 18, symbol: "rsETH" };
            }
            return {};
          },
        );

        const fetchedToken = {
          ...mockToken0Data,
          address: RSETH_SWELL,
          symbol: "",
          name: "",
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          1923,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.symbol).toBe("rsETH");
        expect(updatedToken.pricePerUSDNew).toBe(sourcePrice);
      });

      it("heals empty name when symbol is already populated", async () => {
        const fetchedToken = {
          ...mockToken0Data,
          symbol: "USDT",
          name: "",
          lastUpdatedTimestamp: oneHourAndOneMinuteAgo(),
        };
        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.name).toBe("Test Token");
        // Existing non-empty symbol must not be overwritten
        expect(updatedToken.symbol).toBe("USDT");
      });

      // Issue #735: low-volume Base pools were left with `?` symbols because
      // every event after PoolCreated landed inside the 1-hour throttle window,
      // so heal (gated under the throttle short-circuit) never ran. Lifting
      // heal above the throttle gate fixes the residual of #672/#675 without
      // changing price-refresh cadence.
      it("heals empty symbol even when the price-refresh throttle short-circuits (within 1 hour)", async () => {
        const thirtyMinutesAgo = new Date(
          blockDatetime.getTime() - 30 * 60 * 1000,
        );
        const fetchedToken = {
          ...mockToken0Data,
          symbol: "",
          name: "",
          lastUpdatedTimestamp: thirtyMinutesAgo,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        // Heal wrote the populated metadata even though the price-refresh
        // path short-circuited on the 30-minute throttle.
        expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalledTimes(1);
        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.symbol).toBe("TEST");
        expect(updatedToken.name).toBe("Test Token");
        // Price untouched — throttle still gates refresh and snapshot writes
        expect(updatedToken.pricePerUSDNew).toBe(mockToken0Data.pricePerUSDNew);
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).not.toHaveBeenCalled();
      });

      // Issue #735 AC #4: a token whose on-chain symbol() legitimately returns
      // "" must not retry-storm. With heal lifted above the throttle gate, an
      // empty-overlay heal must not churn Token.set writes on every event.
      it("does NOT churn Token.set when getTokenDetails returns empty (throttled refresh)", async () => {
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenDetails") {
              return { name: "", decimals: 18, symbol: "" };
            }
            return {};
          },
        );

        const thirtyMinutesAgo = new Date(
          blockDatetime.getTime() - 30 * 60 * 1000,
        );
        const fetchedToken = {
          ...mockToken0Data,
          symbol: "",
          name: "",
          lastUpdatedTimestamp: thirtyMinutesAgo,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        // No overlay produced AND refresh throttled — heal must not write.
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
      });
    });

    // Issue #735: `healTokenMetadata` is exported so non-refresh handlers can
    // heal directly without going through refreshTokenPrice. These tests pin
    // the standalone semantics: idempotent on healed tokens, no Token.set
    // churn when on-chain metadata is still empty, error-tolerant.
    describe("healTokenMetadata (standalone heal export, issue #735)", () => {
      beforeEach(() => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.effect)?.mockClear();
        vi.mocked(mockContext.log?.error)?.mockClear();
      });

      it("heals an empty-symbol token and writes the result via Token.set", async () => {
        const fetchedToken = { ...mockToken0Data, symbol: "", name: "" };

        const healed = await PriceOracle.healTokenMetadata(
          fetchedToken,
          chainId,
          mockContext as handlerContext,
        );

        expect(healed.symbol).toBe("TEST");
        expect(healed.name).toBe("Test Token");
        expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockContext.Token?.set)?.mock.lastCall?.[0]).toBe(
          healed,
        );
      });

      it("short-circuits without an effect call when symbol and name are already populated", async () => {
        const fetchedToken = {
          ...mockToken0Data,
          symbol: "USDT",
          name: "Tether USD",
        };

        const healed = await PriceOracle.healTokenMetadata(
          fetchedToken,
          chainId,
          mockContext as handlerContext,
        );

        expect(healed).toBe(fetchedToken);
        expect(mockContext.effect).not.toHaveBeenCalled();
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
      });

      it("returns the input unchanged and stages no write when getTokenDetails still returns empty", async () => {
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenDetails") {
              return { name: "", decimals: 18, symbol: "" };
            }
            return {};
          },
        );

        const fetchedToken = { ...mockToken0Data, symbol: "", name: "" };

        const healed = await PriceOracle.healTokenMetadata(
          fetchedToken,
          chainId,
          mockContext as handlerContext,
        );

        expect(healed).toBe(fetchedToken);
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
      });

      it("is idempotent across repeated calls on a healed token", async () => {
        const fetchedToken = { ...mockToken0Data, symbol: "", name: "" };

        const firstPass = await PriceOracle.healTokenMetadata(
          fetchedToken,
          chainId,
          mockContext as handlerContext,
        );
        vi.mocked(mockContext.effect)?.mockClear();
        vi.mocked(mockContext.Token?.set)?.mockClear();

        const secondPass = await PriceOracle.healTokenMetadata(
          firstPass,
          chainId,
          mockContext as handlerContext,
        );

        expect(secondPass).toBe(firstPass);
        expect(mockContext.effect).not.toHaveBeenCalled();
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
      });

      it("logs and returns the input unchanged when getTokenDetails throws", async () => {
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenDetails") throw new Error("RPC down");
            return {};
          },
        );

        const fetchedToken = { ...mockToken0Data, symbol: "", name: "" };

        const healed = await PriceOracle.healTokenMetadata(
          fetchedToken,
          chainId,
          mockContext as handlerContext,
        );

        expect(healed).toBe(fetchedToken);
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
        expect(vi.mocked(mockContext.log?.error)).toHaveBeenCalledWith(
          expect.stringContaining("Error refreshing token metadata"),
        );
      });
    });

    // Issue #668: transient absurd oracle reads (e.g. Fraxtal V3 returning
    // ~$7.59e30 per sfrxETH on 2024-12-18) permanently poison cumulative
    // pool aggregates. The receiver-side guard rejects refreshes whose ratio
    // against the last accepted price exceeds PRICE_SPIKE_RATIO_THRESHOLD,
    // provided the anchor is still fresh. See the issue body for the
    // calibration of 10× and the 14-day staleness window.
    describe("price-spike rejection (issue #668)", () => {
      const oneHourOneMinuteAgo = () =>
        new Date(blockDatetime.getTime() - 61 * 60 * 1000);

      beforeEach(() => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.TokenPriceSnapshot?.set)?.mockClear();
        vi.mocked(mockContext.log?.warn)?.mockClear();
      });

      it("rejects an UP-spike (≥10×) and preserves the previous accepted price", async () => {
        // Anchor at $1; oracle returns $100 — 100× jump, must be rejected.
        // Also pins the [priceSpikeRejected] warn line that downstream
        // observability (alerts, log scans) is expected to grep for.
        const anchorPrice = 1n * 10n ** 18n;
        const spikePrice = 100n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: spikePrice };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
        };

        const result = await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        expect(result.pricePerUSDNew).toBe(anchorPrice);
        const warnCall = vi.mocked(mockContext.log?.warn)?.mock.lastCall;
        expect(warnCall?.[0]).toContain("[priceSpikeRejected]");
      });

      it("preserves lastUpdatedTimestamp on rejection so the 14-day staleness exit can fire", async () => {
        // Issue #730: prior to the fix, the rejection branch bumped
        // `lastUpdatedTimestamp` on every rejected refresh, which reset the
        // `anchorAgeMs` clock. The 14-day staleness exit became unreachable
        // while refresh events kept arriving — anchors stayed poisoned
        // indefinitely (e.g. DTF 8.18 vs DefiLlama 0.0008466 for 111 days).
        // After the fix, rejection is an early return that leaves the anchor
        // timestamp intact, so anchor age grows monotonically and the exit
        // fires once the window elapses.
        const anchorPrice = 1n * 10n ** 18n;
        const spikePrice = 100n * 10n ** 18n;
        const anchorTimestamp = new Date(
          blockDatetime.getTime() - 13 * 24 * 60 * 60 * 1000,
        );

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: spikePrice };
          }
          return {};
        });

        const result = await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            pricePerUSDNew: anchorPrice,
            lastUpdatedTimestamp: anchorTimestamp,
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        expect(result.lastUpdatedTimestamp).toEqual(anchorTimestamp);
        expect(result.pricePerUSDNew).toBe(anchorPrice);
      });

      it("rejects an exact 10× boundary jump", async () => {
        // Boundary case: candidate is exactly 10× the anchor. Spec is "≥10×",
        // so this must still reject. Regression guard against off-by-one
        // boundary regressions.
        const anchorPrice = 1n * 10n ** 18n;
        const boundaryPrice = 10n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: boundaryPrice };
          }
          return {};
        });

        const result = await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            pricePerUSDNew: anchorPrice,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        expect(result.pricePerUSDNew).toBe(anchorPrice);
      });

      it("accepts a sub-threshold jump (5×) as a normal price update", async () => {
        // Anchor at $1; oracle returns $5 — under 10× threshold, must accept.
        const anchorPrice = 1n * 10n ** 18n;
        const newPrice = 5n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: newPrice };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(newPrice);
      });

      it("accepts a first-fetch (anchor == 0) as ground truth regardless of magnitude", async () => {
        // No prior accepted price — accept whatever the oracle returns.
        const newPrice = 1000n * 10n ** 18n; // $1000

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: newPrice };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(newPrice);
      });

      it("accepts a 10×+ jump when the anchor is older than the staleness window", async () => {
        // Anchor 15 days old (> 14d window) — slow legitimate drift can't be
        // permanently frozen. A 100× jump is accepted because the prior
        // anchor is no longer trusted as a recent baseline.
        const anchorPrice = 1n * 10n ** 18n;
        const newPrice = 100n * 10n ** 18n;
        const fifteenDaysAgo = new Date(
          blockDatetime.getTime() - 15 * 24 * 60 * 60 * 1000,
        );

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: newPrice };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          lastUpdatedTimestamp: fifteenDaysAgo,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(newPrice);
      });

      it("accepts the recovery snapshot once the oracle returns to baseline", async () => {
        // Sequence mirrors sfrxETH around 2024-12-18: anchor $1, oracle
        // briefly returns $100 (rejected, anchor preserved), then returns
        // ~$1.02 (1.02× — accepted).
        const anchorPrice = 1n * 10n ** 18n;
        const spikePrice = 100n * 10n ** 18n;
        const recoveryPrice = 102n * 10n ** 16n; // $1.02

        // First refresh — spike, rejected.
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: spikePrice };
          }
          return {};
        });
        const afterSpike = await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            pricePerUSDNew: anchorPrice,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );
        expect(afterSpike.pricePerUSDNew).toBe(anchorPrice);

        // Second refresh — recovery, accepted. Use the returned token shape
        // so the anchor reflects what was actually persisted.
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: recoveryPrice };
          }
          return {};
        });
        const oneHourLater = blockDatetime.getTime() / 1000 + 61 * 60;
        const afterRecovery = await PriceOracle.refreshTokenPrice(
          afterSpike,
          blockNumber,
          oneHourLater,
          chainId,
          mockContext as handlerContext,
        );
        expect(afterRecovery.pricePerUSDNew).toBe(recoveryPrice);
      });

      it("accepts a DOWN candidate (≥10× drop) — asymmetric guard, issue #730", async () => {
        // Issue #730: the failure modes are asymmetric. An upward
        // false-accept (candidate wrongly high) self-heals on the next
        // refresh; a downward false-reject (anchor wrongly high, candidate
        // correct) is permanent — every subsequent correct reading is
        // rejected forever. The DTF case (kept anchor $8.18, rejected
        // candidate $0.000827 — within 2.4% of DefiLlama) is exactly this
        // shape. Drop the symmetric branch so downward candidates are
        // accepted immediately.
        const anchorPrice = 100n * 10n ** 18n;
        const recoveryPrice = 1n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: recoveryPrice };
          }
          return {};
        });

        const result = await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            pricePerUSDNew: anchorPrice,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        expect(result.pricePerUSDNew).toBe(recoveryPrice);
      });
    });

    // Issue #728: locked-anchor poisoning defense. The #668 spike guard needs
    // a prior non-zero anchor to compare ≥10× against, so the very first
    // non-zero oracle read has nothing to validate it. If that first read is
    // inflated, the locked anchor poisons every subsequent pool calc until
    // the token is reactively blacklisted (see PR #722's pattern). Cap rejects
    // any first non-zero anchor > $10K for non-BTC symbols and lets the next
    // hourly refresh retry. Empirical scan: no legitimate non-BTC token has
    // ever priced above $10K — every >$10K observation was a known poison
    // case already handled by REBIND / BLACKLIST / stablecoin pin.
    describe("first-fetch cap (issue #728)", () => {
      const oneHourOneMinuteAgo = () =>
        new Date(blockDatetime.getTime() - 61 * 60 * 1000);

      beforeEach(() => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.TokenPriceSnapshot?.set)?.mockClear();
        vi.mocked(mockContext.log?.warn)?.mockClear();
      });

      it("rejects a non-BTC first-fetch above $10K and logs [FIRST_FETCH_CAP]", async () => {
        // Anchor 0, oracle returns $50K for symbol "USDT" — must be rejected.
        // Mirrors the PR #722 pattern (36 tokens, $13.8K to $2B inflated anchors).
        const inflatedPrice = 50_000n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: inflatedPrice };
          }
          return {};
        });

        await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            symbol: "USDT",
            pricePerUSDNew: 0n,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(0n);
        expect(
          vi.mocked(mockContext.TokenPriceSnapshot?.set),
        ).not.toHaveBeenCalled();
        const warnCall = vi.mocked(mockContext.log?.warn)?.mock.lastCall;
        expect(warnCall?.[0]).toContain("[FIRST_FETCH_CAP]");
      });

      it("accepts a BTC-symbol first-fetch above $10K", async () => {
        // WBTC routinely prices in the tens of thousands; the cap must NOT
        // reject any symbol containing "BTC". $80K is a realistic mid-cycle.
        const btcPrice = 80_000n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: btcPrice };
          }
          return {};
        });

        await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            symbol: "WBTC",
            pricePerUSDNew: 0n,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(btcPrice);
      });

      it("matches the BTC substring case-insensitively (e.g. cbbtc, SolvBTC)", async () => {
        // Substring match must be case-insensitive so lowercase variants like
        // "cbbtc" and mixed-case "SolvBTC" both bypass the cap.
        const btcPrice = 75_000n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: btcPrice };
          }
          return {};
        });

        await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            symbol: "cbbtc",
            pricePerUSDNew: 0n,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(btcPrice);
      });

      it("accepts a non-BTC first-fetch at exactly the $10K cap (boundary)", async () => {
        // Cap is strictly greater-than: a $10,000.00 first-fetch must pass.
        // Regression guard against off-by-one boundary regressions.
        const exactCapPrice = 10_000n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: exactCapPrice };
          }
          return {};
        });

        await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            symbol: "USDT",
            pricePerUSDNew: 0n,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(exactCapPrice);
      });

      it("accepts a non-BTC first-fetch well below the cap", async () => {
        // Sanity: ordinary first-fetches (a few dollars) must pass through
        // untouched. Pins the common case so a refactor that gets the
        // condition inverted is caught immediately.
        const normalPrice = 2n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: normalPrice };
          }
          return {};
        });

        await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            symbol: "USDT",
            pricePerUSDNew: 0n,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(normalPrice);
      });

      it("does NOT cap subsequent (non-first) fetches; spike guard takes over", async () => {
        // Token already has a non-zero anchor — the cap path is for the first
        // anchor only. A 4× jump from $5K to $20K is below the 10× spike
        // threshold, so it should be persisted as-is. Pins the AC line that
        // subsequent fetches are NOT capped.
        const anchorPrice = 5_000n * 10n ** 18n;
        const newPrice = 20_000n * 10n ** 18n;

        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: newPrice };
          }
          return {};
        });

        await PriceOracle.refreshTokenPrice(
          {
            ...mockToken0Data,
            symbol: "USDT",
            pricePerUSDNew: anchorPrice,
            lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          },
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(newPrice);
        const warnCalls = vi.mocked(mockContext.log?.warn)?.mock.calls ?? [];
        for (const [msg] of warnCalls) {
          expect(msg).not.toContain("[FIRST_FETCH_CAP]");
        }
      });
    });

    // Issue #694: V3 last-known-price fallback used `lastUpdatedTimestamp`
    // for two purposes — the 1-hour throttle and the 7-day staleness window
    // guarding the fallback. Because every refresh attempt (including those
    // that fall back) bumps `lastUpdatedTimestamp`, the 7-day window was
    // effectively reset each hour. Once a token entered fallback, the stored
    // non-zero price would pin indefinitely even if the oracle never
    // recovered. Fix: introduce `lastSuccessfulPriceTimestamp`, only bumped
    // on non-zero oracle writes; fallback's staleness window reads from it.
    describe("V3 fallback staleness (issue #694)", () => {
      // V3 oracle on Optimism starts at block 125484892. Use a post-V3 block
      // so the V3 fallback branch in refreshTokenPrice is exercised.
      const v3Block = 125484893;
      const oneHourOneMinuteAgo = () =>
        new Date(blockDatetime.getTime() - 61 * 60 * 1000);

      beforeEach(() => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.TokenPriceSnapshot?.set)?.mockClear();
      });

      it("applies the V3 fallback when the last successful price is recent (<7d) even though lastUpdatedTimestamp keeps advancing", async () => {
        const anchorPrice = 2n * 10n ** 18n;
        const recentSuccess = new Date(
          blockDatetime.getTime() - 2 * 24 * 60 * 60 * 1000,
        );
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: 0n };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          // Throttle clock is recent (1h ago), but the LAST SUCCESSFUL write
          // was 2 days ago — fallback should apply.
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          lastSuccessfulPriceTimestamp: recentSuccess,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v3Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(anchorPrice);
        // Throttle clock advances on every attempt (existing behavior)
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBe(
          blockDatetime.getTime(),
        );
        // Last successful timestamp must NOT advance on a fallback write
        expect(updatedToken.lastSuccessfulPriceTimestamp?.getTime()).toBe(
          recentSuccess.getTime(),
        );
      });

      it("stops re-pinning once last successful price is older than 7 days, even with hourly retries (regression)", async () => {
        const anchorPrice = 2n * 10n ** 18n;
        const eightDaysAgo = new Date(
          blockDatetime.getTime() - 8 * 24 * 60 * 60 * 1000,
        );
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: 0n };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          // Throttle clock has been ticking forward hourly under fallback —
          // imagine the most recent retry was 1h+1min ago. lastSuccessful
          // hasn't moved since the last real oracle hit, which is now 8d old.
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          lastSuccessfulPriceTimestamp: eightDaysAgo,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v3Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        // 7-day window has expired — fallback must NOT apply. Write 0.
        expect(updatedToken.pricePerUSDNew).toBe(0n);
      });

      it("bumps lastSuccessfulPriceTimestamp on a successful non-zero write", async () => {
        const newPrice = 3n * 10n ** 18n;
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: newPrice };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          lastSuccessfulPriceTimestamp: undefined,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v3Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(newPrice);
        expect(updatedToken.lastSuccessfulPriceTimestamp?.getTime()).toBe(
          blockDatetime.getTime(),
        );
      });

      it("does NOT bump lastSuccessfulPriceTimestamp when oracle returns 0 and no fallback is used", async () => {
        // First-priced token: anchor is 0 (never priced), oracle still 0 →
        // shouldn't qualify as a successful write.
        const earlierTimestamp = new Date(
          blockDatetime.getTime() - 2 * 60 * 60 * 1000,
        );
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: 0n };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: earlierTimestamp,
          lastSuccessfulPriceTimestamp: undefined,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v3Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(0n);
        expect(updatedToken.lastSuccessfulPriceTimestamp).toBeUndefined();
      });
    });

    // Issue #775: extending the #694 fallback to V1/V2. Before the fix, the
    // V3-only gate let a transient gateway-fallback {pricePerUSDNew: 0n,
    // usedDefault: true} overwrite a valid non-zero anchor on any V1/V2 block
    // (Optimism V1/V2 ran from ~block 107.6M to ~125.5M — several months of
    // exposure). Five canonical home-chain tokens (WETH-Base, WETH-OP,
    // AERO-Base, VELO-OP, OP-OP) ended at $0 with isWhitelisted=true,
    // poisoning ~$250M of cumulative volume in downstream USD aggregates.
    // Same 7-day staleness window from #694 still bounds how stale we'll
    // preserve.
    describe("V1/V2 fallback staleness (issue #775)", () => {
      // Optimism V1 oracle covers blocks ≤ 124076662 (see Constants.ts). Pick
      // a block in the middle of the V1 window to exercise the V1 path.
      const v1Block = 115_000_000;
      // Optimism V2 oracle covers 124076662 < block ≤ 125484892.
      const v2Block = 125_000_000;
      const oneHourOneMinuteAgo = () =>
        new Date(blockDatetime.getTime() - 61 * 60 * 1000);

      beforeEach(() => {
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.TokenPriceSnapshot?.set)?.mockClear();
      });

      it("applies the fallback on a V1 block when the last successful price is recent (<7d)", async () => {
        const anchorPrice = 2_500n * 10n ** 18n; // WETH-OP shape
        const recentSuccess = new Date(
          blockDatetime.getTime() - 2 * 24 * 60 * 60 * 1000,
        );
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            // Gateway-fallback shape: usedDefault=true → pricePerUSDNew=0n.
            return { pricePerUSDNew: 0n };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          lastSuccessfulPriceTimestamp: recentSuccess,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v1Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        // Anchor preserved — this is the #775 regression check.
        expect(updatedToken.pricePerUSDNew).toBe(anchorPrice);
        // Throttle clock advances on every attempt (existing #694 behavior)
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBe(
          blockDatetime.getTime(),
        );
        // Last successful timestamp must NOT advance on a fallback write
        expect(updatedToken.lastSuccessfulPriceTimestamp?.getTime()).toBe(
          recentSuccess.getTime(),
        );
      });

      it("applies the fallback on a V2 block when the last successful price is recent (<7d)", async () => {
        const anchorPrice = 2_500n * 10n ** 18n;
        const recentSuccess = new Date(
          blockDatetime.getTime() - 2 * 24 * 60 * 60 * 1000,
        );
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: 0n };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          lastSuccessfulPriceTimestamp: recentSuccess,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v2Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(anchorPrice);
      });

      it("stops re-pinning on a V1 block once the last successful price is older than 7 days", async () => {
        const anchorPrice = 2_500n * 10n ** 18n;
        const eightDaysAgo = new Date(
          blockDatetime.getTime() - 8 * 24 * 60 * 60 * 1000,
        );
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: 0n };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: anchorPrice,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          lastSuccessfulPriceTimestamp: eightDaysAgo,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v1Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        // 7-day window has expired — fallback must NOT apply. Write 0.
        expect(updatedToken.pricePerUSDNew).toBe(0n);
      });

      it("preserves 0n on a V1 block when there is no prior anchor (no spurious fallback)", async () => {
        vi.mocked(mockContext.effect)?.mockImplementation(async (effect) => {
          if ((effect as { name?: string }).name === "getTokenPrice") {
            return { pricePerUSDNew: 0n };
          }
          return {};
        });

        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: oneHourOneMinuteAgo(),
          lastSuccessfulPriceTimestamp: undefined,
        };

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          v1Block,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        // shouldUseLastKnownPrice requires anchor > 0n, so fallback is skipped
        // — fall through to the normal write of 0n. No spurious value invented.
        expect(updatedToken.pricePerUSDNew).toBe(0n);
        expect(updatedToken.lastSuccessfulPriceTimestamp).toBeUndefined();
      });
    });

    describe("when price fetch fails", () => {
      let originalToken: Token;
      beforeEach(async () => {
        // Reset mockContext first
        vi.mocked(mockContext.Token?.set)?.mockClear();
        vi.mocked(mockContext.log?.error)?.mockClear();

        // Override effect mock to throw only for getTokenPrice
        // Since refreshTokenPrice calls both effects in parallel, we need to check
        // the effect name and throw conditionally rather than using mockImplementationOnce
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, input: unknown) => {
            if ((effect as { name?: string }).name === "getTokenPrice") {
              throw new Error("Price fetch failed");
            }
            // Use default implementation for other effects
            return defaultEffectImplementation(effect, input);
          },
        );

        const testLastUpdated = new Date(
          blockDatetime.getTime() - 61 * 60 * 1000,
        );
        originalToken = {
          ...mockToken0Data,
          lastUpdatedTimestamp: testLastUpdated,
        } as Token;
        const blockTimestamp = blockDatetime.getTime() / 1000;
        await PriceOracle.refreshTokenPrice(
          originalToken,
          blockNumber,
          blockTimestamp,
          chainId,
          mockContext as handlerContext,
        );
      });
      it("should log error when price fetch fails", async () => {
        // Should log error
        expect(vi.mocked(mockContext.log?.error)).toHaveBeenCalled();
        const errorCall = vi.mocked(mockContext.log?.error)?.mock.lastCall;
        expect(errorCall?.[0]).toContain("Error refreshing token price");
      });
      it("should not update token when price fetch fails", async () => {
        // Token.set should not be called when error occurs
        // The function catches the error and returns the original token
        const setCalls = vi.mocked(mockContext.Token?.set)?.mock.calls;
        // Filter out any calls from previous tests
        const errorRelatedCalls = setCalls?.filter(
          (call) => call[0]?.address === originalToken.address,
        );
        expect(errorRelatedCalls).toHaveLength(0);
      });
    });
  });

  describe("createTokenEntity", () => {
    const tokenAddress = toChecksumAddress(
      "0x1111111111111111111111111111111111111111",
    );
    const blockNumber = 1000000;
    const blockTimestamp = Math.floor(blockDatetime.getTime() / 1000);

    beforeEach(() => {
      // Reset mocks
      vi.mocked(mockContext.Token?.set)?.mockClear();
      vi.mocked(mockContext.effect)?.mockClear();
    });

    it("should create a token entity with correct fields", async () => {
      const token = await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
        blockTimestamp,
      );

      if (!token) throw new Error("expected token to be created");
      expect(token.address).toBe(tokenAddress);
      expect(token.symbol).toBe("TEST");
      expect(token.name).toBe("Test Token");
      expect(token.decimals).toBe(18n);
      expect(token.pricePerUSDNew).toBe(0n);
      expect(token.chainId).toBe(chainId);
      expect(token.isWhitelisted).toBe(false);
      expect(token.lastUpdatedTimestamp).toBeInstanceOf(Date);
    });

    it("should call Token.set with the created entity", async () => {
      await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
        blockTimestamp,
      );

      expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalledTimes(1);
      const setToken = vi.mocked(mockContext.Token?.set)?.mock
        .lastCall?.[0] as Token;
      expect(setToken.address).toBe(tokenAddress);
      expect(setToken.pricePerUSDNew).toBe(0n);
    });

    it("should call getTokenDetails effect", async () => {
      await PriceOracle.createTokenEntity(
        tokenAddress,
        chainId,
        blockNumber,
        mockContext as handlerContext,
        blockTimestamp,
      );

      const detailsCall = vi
        .mocked(mockContext.effect)
        ?.mock.calls.find(
          (c) => (c[0] as { name?: string }).name === "getTokenDetails",
        );
      expect(detailsCall).toBeDefined();
      expect(
        (detailsCall?.[1] as { contractAddress: string }).contractAddress,
      ).toBe(tokenAddress);
      expect((detailsCall?.[1] as { chainId: number }).chainId).toBe(chainId);
    });

    describe("when address has no bytecode (EOA / non-contract)", () => {
      beforeEach(() => {
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "hasContractBytecode") return { hasCode: false };
            if (name === "getTokenDetails")
              return { name: "Test Token", decimals: 18, symbol: "TEST" };
            return {};
          },
        );
      });

      it("returns null and does not call Token.set", async () => {
        const token = await PriceOracle.createTokenEntity(
          tokenAddress,
          chainId,
          blockNumber,
          mockContext as handlerContext,
          blockTimestamp,
        );

        expect(token).toBeNull();
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
      });

      it("does not call getTokenDetails when bytecode is empty", async () => {
        await PriceOracle.createTokenEntity(
          tokenAddress,
          chainId,
          blockNumber,
          mockContext as handlerContext,
          blockTimestamp,
        );

        const detailsCall = vi
          .mocked(mockContext.effect)
          ?.mock.calls.find(
            (c) => (c[0] as { name?: string }).name === "getTokenDetails",
          );
        expect(detailsCall).toBeUndefined();
      });
    });
  });
});
