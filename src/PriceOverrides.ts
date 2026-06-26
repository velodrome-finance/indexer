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
 * Not every entry fits that enumeration: issue #786 added two WHITELISTED
 * tokens whose oracle route froze at a wrong-high but SMALL per-token constant
 * (well under $10^28), invisible to the sweep above — see the #786 block at the
 * end of the list for that distinct failure mode.
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
 * Issue #720: 12 implausibly-priced tokens on Optimism (10), Soneium (1868),
 * and Unichain (130) — same Mode A shape (first non-zero oracle read was a
 * spike that became a locked anchor; merged spike-guard/V3-fallback PRs cannot
 * heal an already-poisoned anchor going forward). Whitelisted Tier-1 inflated
 * tokens rsETH/Swell and SolvBTC/Ink are handled via canonical rebinds (see
 * REBINDS below); XAUt0/Ink and KING/Swell were also whitelisted but have no
 * canonical priced source on any indexed chain, so they fall under blacklist
 * (see #721 below).
 * Issue #721: XAUt0/Ink (gold-pegged, on-chain oracle reports ~$4.7K vs ~$2.5K
 * spot; no canonical XAUt0 is priced on any indexed chain, so cross-chain rebind
 * isn't available — blacklist is the only honest valuation until a priced source
 * appears in the indexer footprint).
 * Issue #721: KING/Swell (on-chain oracle reports $222 with no canonical
 * cross-chain source identified; blacklist pending ground-truth pricing
 * investigation and an eventual de-whitelist).
 *
 * Mode A follow-up (no separate issue): 9 additional Base tokens surfaced by
 * a counterparty-leg pool-significance scan — same locked-anchor shape, all
 * paired with WETH or USDC in pools with <$1K real TVL but enough historical
 * volume to contaminate chain-level aggregates. Plus one DAI-symbol spoof
 * (0x1397aA9eF11eeC24658F09CFd53446158F39b38A) that the initial stablecoin
 * audit pinned to $1; later identified as not legitimate DAI.
 *
 * Comprehensive-scan follow-up: 15 additional Base tokens surfaced by a
 * full sweep of every Token whose current `pricePerUSDNew` exceeds $10K
 * (10^22 in 1e18-fixed) and which is not a BTC variant. Same locked-anchor
 * shape as the rest of the Mode A entries.
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
  TokenId(
    57073,
    toChecksumAddress("0xF50258D3c1dd88946C567920B986A12e65b50dAc"),
  ), // XAUt0 / Ink (issue #721)
  TokenId(
    1923,
    toChecksumAddress("0xc2606AADe4bdd978a4fa5a6edb3b66657acEe6F8"),
  ), // KING / Swell (issue #721)
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
  // Issue #720: implausibly-priced tokens on Optimism (chainId 10) — Mode A
  TokenId(10, toChecksumAddress("0xc32e6bb2958e5633b2Bb9c49Dbbd22dB831c8c66")), // STABLECOIN
  TokenId(10, toChecksumAddress("0x1eb8C65f5aFE1cBF62dfb2FD114809F0ec87EBFf")), // BITCOINBR
  TokenId(10, toChecksumAddress("0xCb8e85c739B115FAE175e1F5741E1792cE2a2569")), // JEWT
  TokenId(10, toChecksumAddress("0xFC366d0F92F5E03f25d867C82B451B89E17907a3")), // ET
  TokenId(10, toChecksumAddress("0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6")), // LINK (impostor)
  TokenId(10, toChecksumAddress("0xf5ACDd10CD97Cb96c256A337e00478715Df55759")), // HKD (impostor — real HKD ~$0.13)
  TokenId(10, toChecksumAddress("0x9d36F8f62347538440a212e9162f534f797542df")), // SATS
  TokenId(10, toChecksumAddress("0xB9243C495117343981EC9f8AA2ABfFEe54396Fc0")), // USDpy (stable)
  TokenId(10, toChecksumAddress("0xCF9326e24EBfFBEF22ce1050007A43A3c0B6DB55")), // sUSDC (stable)
  // Issue #720: implausibly-priced token on Soneium (chainId 1868) — Mode A
  TokenId(
    1868,
    toChecksumAddress("0xAffEb8576b927050f5a3B6fbA43F360D2883A118"),
  ), // SolvBTC.JUP
  // Issue #720: implausibly-priced token on Unichain (chainId 130) — Mode A
  TokenId(130, toChecksumAddress("0x749Fb1c53bd3dC7269b42bc7ffDaB111532e664a")), // GUEDDY🌹♱
  // Mode A follow-up: 9 additional Base tokens surfaced by counterparty-leg
  // pool-significance scan. All locked-anchor (single or stuck inflated read),
  // negligible real TVL on the legit (WETH or USDC) side of every pool.
  TokenId(
    8453,
    toChecksumAddress("0xcE683b7F1ad1Cdc1A27069450fFDeDfb32FB80C1"),
  ), // FERFIE
  TokenId(
    8453,
    toChecksumAddress("0x67AA700Ab0110Cc52bf7F308fe25068E87a0f581"),
  ), // PUNDIAI
  TokenId(
    8453,
    toChecksumAddress("0x692C3e95db7DAc415cfA48584DBd1385D650fdf3"),
  ), // REAL
  TokenId(
    8453,
    toChecksumAddress("0x53EB7233b443a9043292b14c86ff11688bd35a4A"),
  ), // BIFY
  TokenId(
    8453,
    toChecksumAddress("0xC1dfE6106cCF467FF271075daB41c1A5e30acA42"),
  ), // H3
  TokenId(
    8453,
    toChecksumAddress("0x14A7d168148E31B7c68eCdaD815258f3c20e1A3C"),
  ), // KTAMACH
  TokenId(
    8453,
    toChecksumAddress("0x89428C1e3B80dd646d53f14981dC135B6A244478"),
  ), // FNK
  TokenId(
    8453,
    toChecksumAddress("0x78E0096BE1021a408dcA71E9585C4d81D0E57D5f"),
  ), // PEAOIN
  TokenId(
    8453,
    toChecksumAddress("0xac853112b19286fB159d7C283c7cA11A95c7D255"),
  ), // IPFUN
  // DAI-symbol spoof on Base — initial stablecoin-audit pinned it to $1 (symbol
  // trusted, price was a stable ~$0.99), but it is not legitimate DAI. Real
  // DAI on Base is 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb.
  TokenId(
    8453,
    toChecksumAddress("0x1397aA9eF11eeC24658F09CFd53446158F39b38A"),
  ), // DAI (spoof)
  // Comprehensive-scan follow-up: 15 additional Base tokens with current
  // `pricePerUSDNew` > $10K (locked anchors, all non-BTC).
  TokenId(
    8453,
    toChecksumAddress("0x5BfA4c00839bde2c2973AEBFE8f5aE42269b7b06"),
  ), // SPLIT (~$76.6M)
  TokenId(
    8453,
    toChecksumAddress("0xd4EAE162F19c4DFCDC0238c0995AB5d6586aa919"),
  ), // CETUS (~$2B; impostor — real CETUS is on Sui)
  TokenId(
    8453,
    toChecksumAddress("0xD3f0AF6eE15e66844e1471bF88F5Cf260d391457"),
  ), // LEKLI (~$34.8M)
  TokenId(
    8453,
    toChecksumAddress("0x7442740CA87e9B7E9eC726cC21B078cf0C32a29F"),
  ), // Ak6 (~$5.1M)
  TokenId(
    8453,
    toChecksumAddress("0x13d81329bC45f1E55b72eCc733ac6bb0b7559c1A"),
  ), // xae (~$1.6M)
  TokenId(
    8453,
    toChecksumAddress("0x9E8d4B4701B6a0f6DF0f67e6fd2B0778c514b9D2"),
  ), // SMART (~$1.1M)
  TokenId(
    8453,
    toChecksumAddress("0x55Af813F856e4E6A3d1A408Ddb554d71fF666a8d"),
  ), // GAME (~$104K)
  TokenId(
    8453,
    toChecksumAddress("0x7A467F510434dF4D14D00E9c18DaAd1D07b7fC56"),
  ), // COPYRIGHT© (~$93K)
  TokenId(
    8453,
    toChecksumAddress("0xdC006E5F6AcAd20E5d2703a1e34e9a0b7F16a5d3"),
  ), // COPYRIGHT (~$75K)
  TokenId(
    8453,
    toChecksumAddress("0xedc0Ec4E3944fa97613104b34C6ad7b72ADfe379"),
  ), // KRYON (~$71K)
  TokenId(
    8453,
    toChecksumAddress("0x5F32E3CA03Ab53556b3C36F6039555F0E395909F"),
  ), // PB (~$29.3K)
  TokenId(
    8453,
    toChecksumAddress("0x95Fcb37b56A508bE7Ad14c10faF61a5cFABBcD67"),
  ), // pBARIO (~$30K)
  TokenId(
    8453,
    toChecksumAddress("0xc1276167f1884761F7CC249519d5191742D35240"),
  ), // ALPHECCA2 (~$29K)
  TokenId(
    8453,
    toChecksumAddress("0x172a3E283B8Df81fbE9837ce40289Bc21841BcD6"),
  ), // MINTDAO (~$25K)
  TokenId(
    8453,
    toChecksumAddress("0x3F328768C598F6A685B0698E269E09B267C3EBdD"),
  ), // 🍕 (~$13.8K)
  // Issue #731: second-pass audit extension — Base tokens driving the bulk of
  // the $2.29-sextillion top-1000 Base V2 TVL inflation. All are Mode A
  // locked-anchor shape (stored pricePerUSDNew on the order of $0.998-$128 vs
  // realistic value ~$0.001-$0.005, or symbol-spoofs of legitimate USDC/BTC).
  TokenId(
    8453,
    toChecksumAddress("0x047Cfd8f966F97c20528e5c1aEB549dB52F613ff"),
  ), // HENLO (stored $128.57 vs ~$0.005 real)
  TokenId(
    8453,
    toChecksumAddress("0x5C985C58562FA7b2F017490c72817ba4984313E7"),
  ), // DE / Degen (stored $0.998 vs ~$0.001)
  TokenId(
    8453,
    toChecksumAddress("0xf9fac6ccA82D7acea96Eb33880d628fdcbf07c96"),
  ), // Ragdoll (variant 1)
  TokenId(
    8453,
    toChecksumAddress("0xF5E89006CBeFf2dabCfda0Def5Bf45Ebe7f8429f"),
  ), // Ragdoll (variant 2)
  TokenId(
    8453,
    toChecksumAddress("0x0fb741B7203c610585206b8cb56E0a0b45062ff2"),
  ), // CHIDO
  TokenId(
    8453,
    toChecksumAddress("0x62b1473641f38AC7cD57054DB093a2008BB9C577"),
  ), // AUD
  TokenId(
    8453,
    toChecksumAddress("0xFC366d0F92F5E03f25d867C82B451B89E17907a3"),
  ), // ET / Base (Optimism counterpart at same address already blacklisted via #720)
  TokenId(
    8453,
    toChecksumAddress("0x52fA342C288060b37776caDF98D8f81C57EBA2B9"),
  ), // USBA (variant 1)
  TokenId(
    8453,
    toChecksumAddress("0xb0e400A463F1e0b20Eb831B32DC19eD32EF9Ce61"),
  ), // USBA (variant 2)
  TokenId(
    8453,
    toChecksumAddress("0x8feeE3Dc6F8bA55dd54228a909D883bE78422870"),
  ), // TOORBOLG / GLOB-ROOT
  TokenId(
    8453,
    toChecksumAddress("0xa7F9101d91121251d6bA7C1383B39a7f1321cDF3"),
  ), // FD121
  TokenId(
    8453,
    toChecksumAddress("0x9D848D49819897738FB82C4026414140fEED7eb2"),
  ), // FDOTC
  TokenId(
    8453,
    toChecksumAddress("0x5Bca90d1481081c36E6ac308e8ba5403D6c99e1b"),
  ), // HTE
  TokenId(
    8453,
    toChecksumAddress("0x4753ee21f0521B953e0Ac99449126dD457e85080"),
  ), // PTTH
  TokenId(
    8453,
    toChecksumAddress("0xEF708582Ab333d602aBcFc740410224352e71D83"),
  ), // CTB
  TokenId(
    8453,
    toChecksumAddress("0x44B6FBbA989F018c2C0fE7EE0bf4340B21255C2C"),
  ), // ORC
  // Issue #731 follow-up: BAIBAI on Base. Oracle output is structurally
  // broken — V4 returns ~$5e+8/token at recent blocks against a memecoin
  // whose totalSupply is 10^15 raw (0.001 whole tokens at 18 decimals). The
  // 8× jump from the stored $65M anchor → $528M oracle output is below the
  // ≥10× spike-guard threshold, so neither #689 nor #742 catches it.
  TokenId(
    8453,
    toChecksumAddress("0x23FA9a1a634222C03F3C02124242DFf56bD90787"),
  ), // BAIBAI
  // Issue #786: frozen oracle-route constants on WHITELISTED tokens. Distinct
  // from every entry above (which are wrong-HIGH in absolute per-token terms
  // and surface via the `pricePerUSDNew > 10^28` enumeration). Here the route
  // returns a flat wrong-high constant that is SMALL per-token — PEPE froze at
  // ~$0.259302, wOptiDoge at ~$0.0515 — so it is invisible to both the >$10^28
  // sweep and the absolute price ceiling, and the spike-guard/re-anchor logic
  // (#784/#785) cannot see it either: the oracle keeps returning the stuck
  // value, so every read AGREES with the bad anchor (no upward disagreement to
  // re-anchor against). Because both tokens are protocol-whitelisted, the
  // frozen value leaks straight into USD aggregates (#786 reports ~$238B
  // phantom TVL across WETH/PEPE, PEPE/GIZA, VELO/wOptiDoge, WETH/wOptiDoge).
  // Blacklisting forces price 0 → trust-gated out of USD → pool TVL routes
  // through the counterparty leg. The root question — WHY the connector route
  // freezes at a constant for these two — is tracked as a separate
  // investigation (see #786 cross-reference); this is the immediate stopgap.
  TokenId(
    8453,
    toChecksumAddress("0x52b492a33E447Cdb854c7FC19F1e57E8BfA1777D"),
  ), // PEPE / Base (whitelisted; frozen route)
  TokenId(10, toChecksumAddress("0xC26921B5b9ee80773774d36C84328ccb22c3a819")), // wOptiDoge / Optimism (whitelisted; frozen route)
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
    // Issue #721: SolvBTC on Ink -> SolvBTC on Base. Same Solv-issued 1:1 BTC
    // wrapper; Base is whitelisted in Aerodrome and carries a deep SolvBTC/cbBTC
    // pool that prices it cleanly. Ink's local oracle reports ~$450K vs ~$100K
    // spot — driving $5.19B + $17.06M phantom TVL across two kBTC/SolvBTC CL
    // pools because SolvBTC is whitelisted on Ink as a price anchor.
    source: {
      chainId: 8453,
      address: toChecksumAddress("0x3B86Ad95859b6AB773f55f8d94B4b9d443EE931f"),
    },
    targets: [
      {
        chainId: 57073,
        address: toChecksumAddress(
          "0xaE4EFbc7736f963982aACb17EFA37fCBAb924cB3",
        ),
      },
    ],
  },
  {
    // Issue #721 follow-up: ezETH on Swell/Ink -> ezETH on Optimism.
    // Renzo's ezETH is deployed at the same address across chains
    // (`0x2416092f143378750bb29b79eD961ab195CcEea5`). Optimism's local oracle
    // prices it cleanly (~$2.5K); Swell reports $257 (~10x deflation) and Ink
    // reports $0. Mode prices cleanly locally (~$2.4K) so no rebind needed;
    // Fraxtal/Base ezETH entries are stale (no fresh exposure today).
    // Source chain is Optimism because CHAIN_ANCHORS only covers OP + Base.
    source: {
      chainId: 10,
      address: toChecksumAddress("0x2416092f143378750bb29b79eD961ab195CcEea5"),
    },
    targets: [
      {
        chainId: 1923,
        address: toChecksumAddress(
          "0x2416092f143378750bb29b79eD961ab195CcEea5",
        ),
      },
      {
        chainId: 57073,
        address: toChecksumAddress(
          "0x2416092f143378750bb29b79eD961ab195CcEea5",
        ),
      },
    ],
  },
  {
    // Issue #892: WETH on Metal -> WETH on Optimism. Both are the canonical
    // OP-stack WETH at `0x4200…0006`. Metal's local oracle prices everything
    // against oUSDT, which reads structurally high (~+28%), inflating Metal WETH
    // to ~$2,005 vs the ~$1,565 cross-chain consensus. Optimism prices WETH
    // cleanly; copying it makes WETH a trustworthy hard anchor on Metal for the
    // directional TVL cap (Piece 1). The broader Metal oUSDT unit inflation is a
    // separate, sub-10× follow-up.
    source: {
      chainId: 10,
      address: toChecksumAddress("0x4200000000000000000000000000000000000006"),
    },
    targets: [
      {
        chainId: 1750,
        address: toChecksumAddress(
          "0x4200000000000000000000000000000000000006",
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
