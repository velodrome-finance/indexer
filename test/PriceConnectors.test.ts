/**
 * Regression tests for chain price connector configuration.
 *
 * Motivated by issue #600: Fraxtal `getManyRatesWithConnectors` reverts were
 * producing structural $0 TVL on chain 252. These tests assert invariants
 * that keep each chain's connector list routable and guard against the
 * Fraxtal-specific gap where the reward token (XVELO) was implicit rather
 * than explicit in the connector list.
 */
import PriceConnectors from "../src/constants/price_connectors.json";

type PriceConnector = { address: string; createdBlock: number };
type ConnectorsJson = Record<string, PriceConnector[]>;

const connectorsJson = PriceConnectors as ConnectorsJson;

const CHAINS = [
  "optimism",
  "base",
  "mode",
  "lisk",
  "fraxtal",
  "soneium",
  "ink",
  "metal",
  "unichain",
  "celo",
  "superseed",
  "swellchain",
] as const;

function lowercasedAddresses(chain: string): string[] {
  return connectorsJson[chain].map((c) => c.address.toLowerCase());
}

describe("price_connectors.json", () => {
  describe.each(CHAINS)("%s", (chain) => {
    test("has a non-empty connector list", () => {
      expect(connectorsJson[chain]).toBeDefined();
      expect(connectorsJson[chain].length).toBeGreaterThan(0);
    });

    test("addresses are unique (no duplicates)", () => {
      const addrs = lowercasedAddresses(chain);
      expect(new Set(addrs).size).toBe(addrs.length);
    });

    test("every entry has a non-negative createdBlock", () => {
      for (const c of connectorsJson[chain]) {
        expect(c.createdBlock).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // Issue #600: WFRAX (wfrxETH, 0xFC00…0006) had 20 oracle reverts on chain
  // 252 during the Apr 2026 audit, propagating $0 prices across every
  // Fraxtal pool. The fraxtal connector list must carry the core WETH, the
  // destination (frxUSD), and the reward token XVELO so that the oracle
  // always has a reachable quote path for these canonical tokens.
  describe("fraxtal (issue #600)", () => {
    const WFRX_ETH = "0xfc00000000000000000000000000000000000006";
    const FRX_USD = "0xfc00000000000000000000000000000000000001";
    const XVELO = "0x7f9adfbd38b669f03d1d11000bc76b9aaea28a81";

    test("contains wfrxETH (WETH) as a connector", () => {
      expect(lowercasedAddresses("fraxtal")).toContain(WFRX_ETH);
    });

    test("contains frxUSD (destination token) as a connector", () => {
      expect(lowercasedAddresses("fraxtal")).toContain(FRX_USD);
    });

    test("contains XVELO (reward/system token) as an explicit connector", () => {
      // XVELO is appended implicitly by RpcGateway via systemTokenAddress,
      // but listing it explicitly here matches the superchain convention
      // (lisk, ink, metal, unichain, celo, soneium, superseed, swellchain
      // all list it) and makes the config self-documenting.
      expect(lowercasedAddresses("fraxtal")).toContain(XVELO);
    });
  });
});
