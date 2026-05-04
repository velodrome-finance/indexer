import { TokenId, toChecksumAddress } from "./Constants";

export interface RebindTarget {
  readonly chainId: number;
  readonly address: string;
}

/**
 * Tokens whose on-chain price oracle is structurally unusable: every read either
 * returns a value derived from a broken DEX pool (no real off-chain market exists
 * to disagree) or is silent except for transient swap-time spikes that contaminate
 * lifetime totals. For these, the only correct price is 0 — pool-USD calcs already
 * route through the counterparty when one side is $0.
 *
 * Issue #669: $Manatee (no real market; tBTC/$Manatee pool routes price through
 * tBTC and produces $76K-$92K; alETH/$Manatee disagrees with alUSD/$Manatee by 10x).
 * Issue #669: SQUID (oracle returns 0 at every stable read; the $13B contaminated
 * total comes from transient single-block spikes during swaps).
 * Issue #671: ION/Lisk (one-sided pool 11.2M ION + 0.24 WETH; oracle reports $17
 * but the pool's own reserve ratio implies ~$5e-5, inflating TVL to $196M for a
 * pool with $22K lifetime volume across 24K swaps — no real swappable market).
 */
const BLACKLIST: ReadonlySet<string> = new Set([
  TokenId(10, toChecksumAddress("0x7909Bda52eAf7C3cc12745E727Eb527a485241D8")), // $Manatee / Optimism
  TokenId(
    57073,
    toChecksumAddress("0x2e3b82891d1B2b90655597110cCA9b6587607e0c"),
  ), // SQUID / Ink
  TokenId(
    1135,
    toChecksumAddress("0x3f608A49a3ab475dA7fBb167C1Be6b7a45cD7013"),
  ), // ION / Lisk
]);

/**
 * Chains where Velodrome's SuperERC20 deployments live at the same address as
 * their canonical Optimism counterpart (1:1 mint/burn through Hyperlane).
 */
const SUPERCHAINS = [
  252, // Fraxtal
  1135, // Lisk
  34443, // Mode
  1750, // Metal
  1923, // Swell
  1868, // Soneium
  42220, // Celo
  130, // Unichain
  57073, // Ink
  5330, // Superseed
] as const;

/**
 * Tokens whose price should be copied verbatim from another (already-priced)
 * Token entity, bypassing the on-chain oracle entirely. Each entry declares a
 * canonical `source` and every `target` (chain + address) that mirrors it.
 *
 * Two patterns:
 *  - Bridged 1:1 superchain tokens (XVELO across all superchains -> canonical
 *    VELO on Optimism; SuperERC20 mint/burn through Hyperlane preserves parity)
 *  - LST/LRT cross-chain duals (rsETH on Swell -> wrsETH on Base; both are Kelp
 *    wrappers of the same underlying restaked-ETH position; Aerodrome's deep
 *    wrsETH/WETH pool gives a clean Base price)
 *
 * If the source token has not yet been priced (price === 0), the rebind still
 * fires and writes 0 — explicitly NOT falling back to the corrupt on-chain
 * oracle for the target chain, which is the whole point of the rebind.
 */
const REBINDS: ReadonlyArray<{
  source: RebindTarget;
  targets: ReadonlyArray<RebindTarget>;
}> = [
  {
    // rsETH on Swell -> wrsETH on Base (Aerodrome wrsETH/WETH pool prices it cleanly)
    source: {
      chainId: 8453,
      address: toChecksumAddress("0xEDfa23602D0EC14714057867A78d01e94176BEA0"),
    },
    targets: [
      {
        chainId: 1923,
        address: toChecksumAddress(
          "0xc3eaCf0612346366Db554c991D7858716db09f58",
        ),
      },
    ],
  },
  {
    // XVELO on every superchain -> canonical VELO on Optimism
    source: {
      chainId: 10,
      address: toChecksumAddress("0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db"),
    },
    targets: SUPERCHAINS.map((chainId) => ({
      chainId,
      address: toChecksumAddress("0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81"),
    })),
  },
];

const PRICE_REBIND: ReadonlyMap<string, RebindTarget> = new Map(
  REBINDS.flatMap(({ source, targets }) =>
    targets.map((t): [string, RebindTarget] => [
      TokenId(t.chainId, t.address),
      source,
    ]),
  ),
);

/**
 * Whether this token's price should be forced to 0, bypassing the oracle entirely.
 * @param chainId - Chain the token lives on
 * @param address - Token address (must be EIP-55 checksum-cased to match config)
 * @returns true if the token is blacklisted on that chain
 */
export const isBlacklistedToken = (chainId: number, address: string): boolean =>
  BLACKLIST.has(TokenId(chainId, address));

/**
 * Where this token's price should be copied from, if anywhere.
 * @param chainId - Chain the target token lives on
 * @param address - Target token address (EIP-55 checksum-cased)
 * @returns Source {chainId, address} to read the price from, or undefined if no rebind is configured
 */
export const getRebindTarget = (
  chainId: number,
  address: string,
): RebindTarget | undefined => PRICE_REBIND.get(TokenId(chainId, address));
