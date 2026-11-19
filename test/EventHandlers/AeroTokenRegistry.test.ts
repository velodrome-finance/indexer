import type { Token } from "envio";
import { createTestIndexer } from "envio";
import { TokenId, toChecksumAddress } from "../../src/Constants";
import {
  PRICE_TRUST_OUTCOME,
  PRICE_TRUST_REASON,
  getGateDecisionFromSignals,
  isTrusted,
} from "../../src/PriceTrust";
import "../eventHandlersRegistration";
import type { WithChain } from "../testHelpers";
import { setupCommon } from "./Pool/common";

// The Aero TokenRegistry's ListingSet is a price-trust signal (ADR 0005):
// listed tokens count in USD aggregates, like legacy-whitelisted ones.
describe("AeroTokenRegistry.ListingSet", () => {
  const { mockToken0Data } = setupCommon();
  const chainId = 4663 as const; // Robinhood: no legacy whitelist
  const registry = toChecksumAddress(
    "0x564665E023390097f46EA9662a6061a5d700A7E1",
  );
  // SPY on Robinhood: not a connector.
  const spy = toChecksumAddress("0x117cc2133c37b721f49de2a7a74833232b3b4c0c");
  const base: WithChain<Token> = {
    ...mockToken0Data,
    id: TokenId(chainId, spy),
    address: spy,
    chainId,
    isWhitelisted: false,
    isListedOnAero: undefined,
    priceTrustOutcome: PRICE_TRUST_OUTCOME.UNTRUSTED,
    priceTrustReason: PRICE_TRUST_REASON.NON_WL,
  };
  let block = 100_000_000;

  async function listing(
    idx: ReturnType<typeof createTestIndexer>,
    listed: boolean,
  ) {
    block += 1;
    await idx.process({
      chains: {
        [chainId]: {
          simulate: [
            {
              contract: "AeroTokenRegistry",
              event: "ListingSet",
              srcAddress: registry,
              logIndex: 1,
              block: {
                number: block,
                timestamp: 1_790_000_000 + block,
                hash: "0x1234567890123456789012345678901234567890123456789012345678901234",
              },
              params: { token: spy, listed },
            },
          ],
        },
      },
    });
    return idx.Token.get(TokenId(chainId, spy));
  }

  it("trusts a listed token (LISTED) and untrusts it when delisted", async () => {
    const idx = createTestIndexer();
    idx.Token.set(base);
    expect(isTrusted(base, chainId)).toBe(false);

    const listed = await listing(idx, true);
    expect(listed?.isListedOnAero).toBe(true);
    expect(listed?.isWhitelisted).toBe(false);
    expect(listed?.priceTrustOutcome).toBe(PRICE_TRUST_OUTCOME.TRUSTED);
    expect(listed?.priceTrustReason).toBe(PRICE_TRUST_REASON.LISTED);
    expect(isTrusted(listed, chainId)).toBe(true);
    // The price-refresh clock is not touched by a listing change.
    expect(listed?.lastUpdatedTimestamp).toEqual(base.lastUpdatedTimestamp);

    const delisted = await listing(idx, false);
    expect(delisted?.isListedOnAero).toBe(false);
    expect(delisted?.priceTrustReason).toBe(PRICE_TRUST_REASON.NON_WL);
    expect(isTrusted(delisted, chainId)).toBe(false);
  });

  it("ranks WL above LISTED above CONNECTOR, and the blacklist beats all", () => {
    expect(getGateDecisionFromSignals(chainId, spy, true, true).reason).toBe(
      PRICE_TRUST_REASON.WL,
    );
    expect(getGateDecisionFromSignals(chainId, spy, false, true).reason).toBe(
      PRICE_TRUST_REASON.LISTED,
    );
    const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
    expect(getGateDecisionFromSignals(chainId, usdg, false, true).reason).toBe(
      PRICE_TRUST_REASON.LISTED,
    );
    expect(getGateDecisionFromSignals(chainId, usdg, false).reason).toBe(
      PRICE_TRUST_REASON.CONNECTOR,
    );
    // XAUt0 on Ink is operator-blacklisted (#721).
    const xaut0 = "0xF50258D3c1dd88946C567920B986A12e65b50dAc";
    expect(getGateDecisionFromSignals(57073, xaut0, false, true)).toMatchObject(
      { trusted: false, reason: PRICE_TRUST_REASON.BLACKLISTED },
    );
  });
});
