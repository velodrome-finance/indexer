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
 * **Operational pattern.** When a token surfaces with `pricePerUSDNew > 10^28`
 * (i.e. > $10B per whole token in 1e18-fixed), add it to the blacklist below.
 * Pair with re-indexing or a one-shot SQL update zeroing the token's
 * `pricePerUSDNew` for fast cleanup. Reproducible enumeration:
 *
 *     Token(where: {pricePerUSDNew: {_gt: "10000000000000000000000000000"}})
 *
 * Issue #669: $Manatee (no real market; tBTC/$Manatee pool routes price through
 * tBTC and produces $76K-$92K; alETH/$Manatee disagrees with alUSD/$Manatee by 10x).
 * Issue #669: SQUID (oracle returns 0 at every stable read; the $13B contaminated
 * total comes from transient single-block spikes during swaps).
 * Issue #671: ION/Lisk (one-sided pool 11.2M ION + 0.24 WETH; oracle reports $17
 * but the pool's own reserve ratio implies ~$5e-5, inflating TVL to $196M for a
 * pool with $22K lifetime volume across 24K swaps — no real swappable market).
 * Issue #701: 67 inflated-price tokens on Base (chainId 8453, all
 * `decimals: 18`, many sharing symbols with canonical USDC/USDT/AERO at
 * unrelated addresses).
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
  // Issue #701: inflated-price tokens on Base (chainId 8453) with pricePerUSDNew > 10^28
  TokenId(
    8453,
    toChecksumAddress("0x3D6039ce21339BbBc0e107eab061F1E3073f7275"),
  ), // NANO
  TokenId(
    8453,
    toChecksumAddress("0x8c90376d6885Ac25B49950C5ba415Dffc7aeF6E8"),
  ), // aixbtKTA
  TokenId(
    8453,
    toChecksumAddress("0xf511B81FC660DEfD2f287A602f04CB79c8336b26"),
  ), // BDEX
  TokenId(
    8453,
    toChecksumAddress("0x70ca28A35fD265Fd2e173a44ebB0703620FE1324"),
  ), // BNET
  TokenId(
    8453,
    toChecksumAddress("0x0DE6506f5a746CbC8DD6FFC8938abB11351AC982"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x792A85aAdBEB80D5056C33DdDCD51B0A0022e107"),
  ), // SAKI
  TokenId(
    8453,
    toChecksumAddress("0xeBe5Df7466DB12D0330DA9765cD8FD9CCF12339a"),
  ), // BNK
  TokenId(
    8453,
    toChecksumAddress("0x8C5eB7F2bf696D4597602A393AC3ceCA9027e895"),
  ), // GNLR
  TokenId(
    8453,
    toChecksumAddress("0x0F76d71d7eDB9AAA7bEA55deA5B6BcD13B7A3D99"),
  ), // AIKTA
  TokenId(
    8453,
    toChecksumAddress("0xD8505Ee4448ADEd9e713F5EE1e91e8e94F2A0AfB"),
  ), // CRACKCAT
  TokenId(
    8453,
    toChecksumAddress("0xc440DA3E466584AC53248bB9B2e1582daA722a56"),
  ), // I
  TokenId(
    8453,
    toChecksumAddress("0x68599B5731a99B0C955af01b2B438bBa94831E2C"),
  ), // Ss
  TokenId(
    8453,
    toChecksumAddress("0x98d1e64b41b2A597E28c96c84A037Ac2053394D2"),
  ), // GLX
  TokenId(
    8453,
    toChecksumAddress("0x3cA1B6f5B3E15594814C8f138F59718a1605FF26"),
  ), // SUP
  TokenId(
    8453,
    toChecksumAddress("0x52Db46082ce6031347449A278748527e0075B5Ac"),
  ), // AERO (spoof)
  TokenId(
    8453,
    toChecksumAddress("0xC63Df6ae11c286A845ABd86D7bBF7F857fe03581"),
  ), // PARA
  TokenId(
    8453,
    toChecksumAddress("0x86Ab61f37ADdBd516c83F1Bd285ff3Af6C94307b"),
  ), // TINY
  TokenId(
    8453,
    toChecksumAddress("0xb755Ef27C3460E48456919de524CF11b85F7933b"),
  ), // Tuka
  TokenId(
    8453,
    toChecksumAddress("0x36cd0A846ce825ca3523b5620A8da19b9B115373"),
  ), // Pika
  TokenId(
    8453,
    toChecksumAddress("0xEe6f6B1D6fa031d9BA5364C4E7EDfaF3686A3007"),
  ), // Pussy
  TokenId(
    8453,
    toChecksumAddress("0xff074a9dA79111d5BcABeF677A83ed3eFAa3f1c8"),
  ), // Tt
  TokenId(
    8453,
    toChecksumAddress("0xFaff18d1D45cCAfE482Cde113f9BCc317c5Cc6f0"),
  ), // OMNI
  TokenId(
    8453,
    toChecksumAddress("0x40806af123C65463B681cECb1Ca562D0243bCf92"),
  ), // A00
  TokenId(
    8453,
    toChecksumAddress("0xcea5A57E7Eb5DD96535306Dc014160b4d681B7a4"),
  ), // USDT (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x311CCc0Afede966F5b9C6541547E6D879eF0f445"),
  ), // USDT (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x2066f06415aED56Ae01141179f8f346EE89A25Fd"),
  ), // NOISE
  TokenId(
    8453,
    toChecksumAddress("0xbEdF2be6B0c156a4cF79fB32804BDEb2aF195154"),
  ), // 1
  TokenId(
    8453,
    toChecksumAddress("0x5529b77F8fb04Ae87937c71b5332Cf703123F645"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x51D209f7572D3e0C4c6aa57fA7200Cf2530B6b78"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x166498c6306C97AE461eDA6604d8b720E096CD1a"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x5AEe166fd2717C976fe391d54c7f007a89E53c28"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x439bC289E64FcDE439D078fb5ba486F5eAA866B6"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x0E934D350D86A96E5fcE518fb6864def3c23f5C4"),
  ), // QBOT
  TokenId(
    8453,
    toChecksumAddress("0x519B6cdB545c490CEabc4Ba433f93Bd285069366"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x2771ea0E3B9EbF15BA2AC08161aEF0Fb2218AD63"),
  ), // KP
  TokenId(
    8453,
    toChecksumAddress("0xFAF7D3dCFceB09D80115eb2735Fb521F4b41f7C5"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x94c35cb889bdCb5ca105eCe80AF9DDD818eEf4e3"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x9Bfe697C9BB235F459B5D13199A10Af334700633"),
  ), // AWEAVE
  TokenId(
    8453,
    toChecksumAddress("0x83bac924674eDFdf88C5CEf3f6f1b36c8550406C"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x793af6963d96A2E4F0CE077C2e2e7fd6b1c9975a"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x66f8052CA8a44c02853aE0163e817dE43beCBe11"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x9c3000608DF1d4aCf0c3595B3AB976A6C67e9FF9"),
  ), // HDAEMO
  TokenId(
    8453,
    toChecksumAddress("0x3D9b7201354C8FDbdD8CDd29ec32Ca2b96cC358D"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0xCDF708FDEb8298900191e93a850eaE35f465C34a"),
  ), // USDC (spoof)
  TokenId(
    8453,
    toChecksumAddress("0x36CA7F2C710Be7b8E3EADd7Ac32dE89CBADDCeb6"),
  ), // MATRXA
  TokenId(
    8453,
    toChecksumAddress("0x253aa0E92BfB40efeC61c4DeCDC59B0b8c868b93"),
  ), // CR
  TokenId(
    8453,
    toChecksumAddress("0x314c54adB6eF01734874f4FbbE4d60Dc4CC79364"),
  ), // CID
  TokenId(
    8453,
    toChecksumAddress("0x1c5Ba8eaf0D74D51F8A97e91c03d2140845b9516"),
  ), // VT
  TokenId(
    8453,
    toChecksumAddress("0x2220c7490F3e432Ec54E0Df8FbBd5fD9Be4584B1"),
  ), // MIWP
  TokenId(
    8453,
    toChecksumAddress("0x0F9e807d9b2136eE030D27B7d192f16b0DeDf884"),
  ), // ECTRUT
  TokenId(
    8453,
    toChecksumAddress("0x06AE7175f9E0e9F58709067fE4D56F9b1CEA4248"),
  ), // ARG307
  TokenId(
    8453,
    toChecksumAddress("0x78E0096BE1021a408dcA71E9585C4d81D0E57D5f"),
  ), // PEAOIN
  TokenId(
    8453,
    toChecksumAddress("0x88d582BB02b893A2079913b4d7771AB99cf68d73"),
  ), // KICK
  TokenId(
    8453,
    toChecksumAddress("0xdf6054939edb69f609597b63cddd1C8ACeA5E535"),
  ), // CHD
  TokenId(
    8453,
    toChecksumAddress("0xBCC91a44385A7F47c23628dDeCc3BfdE1c0CabC7"),
  ), // THE
  TokenId(
    8453,
    toChecksumAddress("0x89428C1e3B80dd646d53f14981dC135B6A244478"),
  ), // FNK
  TokenId(
    8453,
    toChecksumAddress("0x7473952537Bc9D6adcE13a9c7a3b88717e483517"),
  ), // LIFI
  TokenId(
    8453,
    toChecksumAddress("0x74b7b4Fc4Fae950b13933DD221E88da3408a72c4"),
  ), // CTA
  TokenId(
    8453,
    toChecksumAddress("0x440bB8afDbc1857d17A2c16f2391401cb677c3bb"),
  ), // HAL
  TokenId(
    8453,
    toChecksumAddress("0xcD42BA66cE8Aa8a195E36D85a1174f1f0cfe4049"),
  ), // VM
  TokenId(
    8453,
    toChecksumAddress("0xE28Fe7dE7c50C202AC6074F990fedab4565e8570"),
  ), // ROBOTAXI
  TokenId(
    8453,
    toChecksumAddress("0x9944326D25810904b3e498d56b2e6A5996E33242"),
  ), // vAMM-HELLA/WETH
  TokenId(
    8453,
    toChecksumAddress("0xf83cde146AC35E99dd61b6448f7aD9a4534133cc"),
  ), // EBERT
  TokenId(
    8453,
    toChecksumAddress("0x6a40D8Fc348552deE9fC0C2a0C7aE0CBE2764F4c"),
  ), // MR
  TokenId(
    8453,
    toChecksumAddress("0xc13223E6D86fb2E3E78CC3476F1d9DeC39F4E86c"),
  ), // DVC
  TokenId(
    8453,
    toChecksumAddress("0xc3472ddA969e162D1d3753d7b240A28996A0E9a4"),
  ), // TT
  TokenId(
    8453,
    toChecksumAddress("0xEBCc3B60ED7bD906463BFafEbF5F9b19b5b0Cb7c"),
  ), // ARASH
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
