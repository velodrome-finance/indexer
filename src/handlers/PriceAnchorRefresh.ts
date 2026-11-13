import { indexer } from "envio";
import {
  getAnchorRefreshBlockInterval,
  refreshAnchorTokens,
} from "../Pricing/AnchorRefresh";

/**
 * Hourly, time-driven refresh of the tokens other prices depend on (WETH,
 * connectors, reward tokens, canonical sources; ADR 0006). Runs every
 * `getAnchorRefreshBlockInterval(chainId)` blocks, about one hour of blocks per
 * chain, independent of which events arrive. Auto-loaded from `src/handlers/`.
 */
indexer.onBlock(
  {
    name: "PriceAnchorRefresh",
    where: ({ chain }) => {
      const every = getAnchorRefreshBlockInterval(chain.id);
      return every === undefined
        ? false
        : { block: { number: { _every: every } } };
    },
    fields: { block: ["timestamp"] },
  },
  async ({ block, context }) => {
    await refreshAnchorTokens(
      context.chain.id,
      block.number,
      block.timestamp,
      context,
    );
  },
);
