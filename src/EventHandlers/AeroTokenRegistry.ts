import type { EvmEvent, Token } from "envio";
import { indexer } from "envio";
import { TokenId } from "../Constants";
import { getRehydrated } from "../EntityTimestamps";
import type { handlerContext } from "../EntityTypes";
import { createTokenEntity } from "../PriceOracle";
import { getGateDecisionFromSignals } from "../PriceTrust";

/**
 * Records an Aero TokenRegistry listing change on the Token and recomputes its
 * price-trust decision.
 *
 * The TokenRegistry (one per Aero chain, curated by Aero governance) is Aero's
 * token list, the successor of the legacy Voter whitelist, which was switched
 * off at the merge (the Base Voter emitted 466 WhitelistToken(false) on
 * 2026-10-21). A listed token is trusted for USD aggregates (reason `LISTED`,
 * ADR 0005), so the token legs of Aero pools on the Aero-only chains, where no
 * legacy whitelist exists, are valued like whitelisted ones. `isWhitelisted`
 * keeps its legacy meaning. The price-refresh clock (`lastUpdatedTimestamp`)
 * is not touched.
 *
 * @param event - TokenRegistry.ListingSet
 * @param context - Handler context
 * @returns Promise that resolves once the Token update (or creation) is staged
 */
async function processListingSet(
  event: EvmEvent<"AeroTokenRegistry", "ListingSet">,
  context: handlerContext,
): Promise<void> {
  const tokenAddress = event.params.token;
  let token: Token | null | undefined = await getRehydrated(
    context.Token,
    "Token",
    TokenId(event.chainId, tokenAddress),
  );
  if (!token) {
    // Cached metadata read; null when the address has no bytecode (#677).
    token = await createTokenEntity(
      tokenAddress,
      event.chainId,
      event.block.number,
      context,
      event.block.timestamp,
    );
    if (!token) return;
  }
  const decision = getGateDecisionFromSignals(
    event.chainId,
    tokenAddress,
    token.isWhitelisted,
    event.params.listed,
  );
  context.Token.set({
    ...token,
    isListedOnAero: event.params.listed,
    priceTrustOutcome: decision.outcome,
    priceTrustReason: decision.reason,
  });
}

indexer.onEvent(
  { contract: "AeroTokenRegistry", event: "ListingSet" },
  async ({ event, context }) => {
    await processListingSet(event, context);
  },
);
