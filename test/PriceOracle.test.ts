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

    describe("when pricePerUSDNew is 0n", () => {
      let updatedToken: Token;
      beforeEach(async () => {
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
        updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
      });
      it("should refresh price even if less than 1 hour has passed", async () => {
        expect(vi.mocked(mockContext.Token?.set)).toHaveBeenCalled();
        expect(updatedToken.pricePerUSDNew).toBe(
          mockTokenPriceData.pricePerUSDNew,
        );
      });
    });

    describe("Issue #673: pre-oracle stranding regression", () => {
      // Reward tokens (VELO/OP, AERO/Base, XVELO/OP) were stuck at $0 with
      // 2023 timestamps because their Token entities are created before the
      // chain's oracle deploys. While the oracle is unreachable, the price
      // refresh keeps returning 0; with timestamp preservation, the 30-day
      // backoff trips before the oracle ever runs, stranding the token.
      // Fix: only preserve the timestamp once the oracle has actually been
      // queryable at this block.

      it("advances lastUpdatedTimestamp when oracle is not yet deployed (lets the 30-day clock count from oracle deploy, not creation)", async () => {
        vi.mocked(mockContext.Token?.set)?.mockClear();

        const preOracleBlock = startBlock - 1;
        // Mock effects: getTokenDetails works, getTokenPrice returns $0 (the
        // ORACLE_DEPLOYED gate inside handleGetTokenPrice does the same in prod).
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenPrice") {
              return { pricePerUSDNew: 0n };
            }
            if (name === "getTokenDetails") {
              return { name: "VELO", decimals: 18, symbol: "VELO" };
            }
            return {};
          },
        );

        const creationDate = new Date(blockDatetime.getTime());
        const fetchedToken = {
          ...mockToken0Data,
          pricePerUSDNew: 0n,
          lastUpdatedTimestamp: creationDate,
        };
        // 1 hour later, still pre-oracle
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
        // Critical: timestamp must move forward so the 30-day backoff resets.
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBe(
          blockTimestamp * 1000,
        );
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBeGreaterThan(
          creationDate.getTime(),
        );
      });

      it("preserves lastUpdatedTimestamp once oracle is deployed and price stays $0 (existing 30-day backoff behavior intact)", async () => {
        vi.mocked(mockContext.Token?.set)?.mockClear();

        const postOracleBlock = startBlock + 1;
        vi.mocked(mockContext.effect)?.mockImplementation(
          async (effect: unknown, _input: unknown) => {
            const name = (effect as { name?: string }).name;
            if (name === "getTokenPrice") {
              return { pricePerUSDNew: 0n };
            }
            if (name === "getTokenDetails") {
              return { name: "VELO", decimals: 18, symbol: "VELO" };
            }
            return {};
          },
        );

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
        // Post-oracle preservation must still apply — bounds RPC waste for
        // genuinely unpriceable tokens.
        expect(updatedToken.lastUpdatedTimestamp.getTime()).toBe(
          earlierTimestamp.getTime(),
        );
      });
    });

    describe("when pricePerUSDNew is 0n for more than 30 days (unpriceable)", () => {
      beforeEach(async () => {
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
      });
      it("should NOT retry price fetch after 30-day backoff", async () => {
        // Token.set should not be called — shouldRefresh returns false
        expect(vi.mocked(mockContext.Token?.set)).not.toHaveBeenCalled();
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

      it("rejects an UP-spike (≥10×) and persists the previous accepted price", async () => {
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

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(anchorPrice);
        const warnCall = vi.mocked(mockContext.log?.warn)?.mock.lastCall;
        expect(warnCall?.[0]).toContain("[priceSpikeRejected]");
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

        await PriceOracle.refreshTokenPrice(
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

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(anchorPrice);
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

      it("rejects a DOWN-spike (≥10×) symmetrically", async () => {
        // Anchor at $100; oracle returns $1 — 100× drop, must be rejected.
        // Mirrors FXB20291231's Jan 2 2025 collapse to constant 485 wei.
        const anchorPrice = 100n * 10n ** 18n;
        const spikePrice = 1n * 10n ** 18n;

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

        await PriceOracle.refreshTokenPrice(
          fetchedToken,
          blockNumber,
          blockDatetime.getTime() / 1000,
          chainId,
          mockContext as handlerContext,
        );

        const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
          .lastCall?.[0] as Token;
        expect(updatedToken.pricePerUSDNew).toBe(anchorPrice);
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

  describe("rpcGateway bypass for affected chains (Change C)", () => {
    const CELO_CHAIN_ID = 42220;
    const celoStartBlock = CHAIN_CONSTANTS[CELO_CHAIN_ID].oracle.startBlock;
    const celoBlockNumber = celoStartBlock + 1;
    const celoToken = {
      ...mockToken0Data,
      id: `${CELO_CHAIN_ID}-${mockToken0Data.address}`,
      chainId: CELO_CHAIN_ID,
      pricePerUSDNew: 0n,
      lastUpdatedTimestamp: new Date(blockDatetime.getTime()),
    };

    it("should call rpcGateway bypass when getTokenPrice returns $0 on affected chain", async () => {
      const bypassPrice = 5n * 10n ** 18n;
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "CELO", decimals: 18, symbol: "CELO" };
          }
          if (name === "rpcGateway") {
            return { pricePerUSDNew: bypassPrice, priceOracleType: "v3" };
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        celoToken,
        celoBlockNumber,
        blockDatetime.getTime() / 1000,
        CELO_CHAIN_ID,
        mockContext as handlerContext,
      );

      // 2 effect calls: getTokenPrice + rpcGateway bypass
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(2);
      const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
        .lastCall?.[0] as Token;
      expect(updatedToken.pricePerUSDNew).toBe(bypassPrice);
    });

    it("should NOT call rpcGateway bypass when getTokenPrice returns non-zero on affected chain", async () => {
      const nonZeroToken = {
        ...celoToken,
        pricePerUSDNew: 1n * 10n ** 18n,
        lastUpdatedTimestamp: new Date(
          blockDatetime.getTime() - 61 * 60 * 1000,
        ),
      };
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 3n * 10n ** 18n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "CELO", decimals: 18, symbol: "CELO" };
          }
          if (name === "rpcGateway") {
            throw new Error("rpcGateway bypass should not be called");
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        nonZeroToken,
        celoBlockNumber,
        blockDatetime.getTime() / 1000,
        CELO_CHAIN_ID,
        mockContext as handlerContext,
      );

      // 1 effect call: getTokenPrice (no rpcGateway bypass)
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(1);
    });

    it("should NOT call rpcGateway bypass on unaffected chains even with $0 price", async () => {
      const optimismToken = {
        ...mockToken0Data,
        pricePerUSDNew: 0n,
        lastUpdatedTimestamp: new Date(blockDatetime.getTime()),
      };
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "Test Token", decimals: 18, symbol: "TEST" };
          }
          if (name === "rpcGateway") {
            throw new Error("rpcGateway bypass should not be called");
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        optimismToken,
        blockNumber,
        blockDatetime.getTime() / 1000,
        chainId, // Optimism - not affected
        mockContext as handlerContext,
      );

      // 1 effect call: getTokenPrice (no rpcGateway bypass)
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(1);
    });

    it("should use last known price when bypass also returns $0 on affected chain", async () => {
      const previousPrice = 3n * 10n ** 18n;
      const tokenWithPreviousPrice = {
        ...celoToken,
        pricePerUSDNew: previousPrice,
        lastUpdatedTimestamp: new Date(
          blockDatetime.getTime() - 2 * 60 * 60 * 1000,
        ),
      };
      vi.mocked(mockContext.effect)?.mockImplementation(
        async (effect: unknown, _input: unknown) => {
          const name = (effect as { name?: string }).name;
          if (name === "getTokenPrice") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          if (name === "getTokenDetails") {
            return { name: "CELO", decimals: 18, symbol: "CELO" };
          }
          if (name === "rpcGateway") {
            return { pricePerUSDNew: 0n, priceOracleType: "v3" };
          }
          return {};
        },
      );

      await PriceOracle.refreshTokenPrice(
        tokenWithPreviousPrice,
        celoBlockNumber,
        blockDatetime.getTime() / 1000,
        CELO_CHAIN_ID,
        mockContext as handlerContext,
      );

      // Bypass was called (2 effect calls: getTokenPrice + rpcGateway) but also returned $0
      expect(vi.mocked(mockContext.effect)).toHaveBeenCalledTimes(2);
      const updatedToken = vi.mocked(mockContext.Token?.set)?.mock
        .lastCall?.[0] as Token;
      // Should fall back to last known price (7-day fallback in V3 path)
      expect(updatedToken.pricePerUSDNew).toBe(previousPrice);
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
