import dotenv from "dotenv";
import { http, createPublicClient } from "viem";
import type { Chain, PublicClient } from "viem";
import {
  base,
  celo,
  fraxtal,
  ink,
  lisk,
  metalL2,
  mode,
  optimism,
  soneium,
  swellchain,
  unichain,
} from "viem/chains";
import { Web3 } from "web3";

import PriceConnectors from "./constants/price_connectors.json";

dotenv.config();

export const TEN_TO_THE_3_BI = BigInt(10 ** 3);
export const TEN_TO_THE_6_BI = BigInt(10 ** 6);
export const TEN_TO_THE_18_BI = BigInt(10 ** 18);

export const SECONDS_IN_AN_HOUR = BigInt(3600);
export const SECONDS_IN_A_DAY = BigInt(86400);
export const SECONDS_IN_A_WEEK = BigInt(604800);

export const toChecksumAddress = (address: string) =>
  Web3.utils.toChecksumAddress(address);

// Note:
// These pools factories addresses are hardcoded since we can't check the pool type from the Voter contract
export const VOTER_CLPOOLS_FACTORY_LIST: string[] = [
  "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", // base
  "0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F", // optimism
].map((x) => toChecksumAddress(x));

export const VOTER_NONCL_POOLS_FACTORY_LIST: string[] = [
  "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", // base
  "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a", // optimism
].map((x) => toChecksumAddress(x));

// Note:
// These pools factories addresses are hardcoded since we can't check the pool type from the Voter contract
export const SUPERCHAIN_LEAF_VOTER_CLPOOLS_FACTORY_LIST: string[] = [
  "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F", // All superchain chains have this address
].map((x) => toChecksumAddress(x));

export const SUPERCHAIN_LEAF_VOTER_NONCL_POOLS_FACTORY_LIST: string[] = [
  "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0", // All superchain chains have this address
].map((x) => toChecksumAddress(x));

export const ROOT_POOL_FACTORY_ADDRESS_OPTIMISM = toChecksumAddress(
  "0x31832f2a97Fd20664D76Cc421207669b55CE4BC0",
);

// Effect rate limit constants (calls per second)
export const EFFECT_RATE_LIMITS = {
  TOKEN_EFFECTS: 5000, // Token details and price fetching effects
  VOTER_EFFECTS: 5000, // Voter-related effects
  DYNAMIC_FEE_EFFECTS: 5000, // Dynamic fee effects
  ROOT_POOL_EFFECTS: 5000, // Root pool effects
} as const;

export const OUSDT_ADDRESS = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";
export const OUSDT_DECIMALS = 6;

// Default fee values from PoolFactory contract constructor (non CL pools)
// This is needed for pools that don't have associated SetCustomFee events or
// have been created before the first SetCustomFee event was emitted.
// VAMM -> volatile pools; SAMM -> stable pools;
export const DEFAULT_VAMM_FEE_BPS = 30n;
export const DEFAULT_SAMM_FEE_BPS = 5n;

type PriceConnector = {
  address: string;
  createdBlock: number;
};

export const OPTIMISM_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.optimism as PriceConnector[];

export const BASE_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.base as PriceConnector[];

export const MODE_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.mode as PriceConnector[];

export const LISK_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.lisk as PriceConnector[];

export const FRAXTAL_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.fraxtal as PriceConnector[];

export const SONEIUM_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.soneium as PriceConnector[];

export const INK_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.ink as PriceConnector[];

export const METAL_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.metal as PriceConnector[];

export const UNICHAIN_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.unichain as PriceConnector[];

export const CELO_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.celo as PriceConnector[];

export const SWELL_PRICE_CONNECTORS: PriceConnector[] =
  PriceConnectors.swellchain as PriceConnector[];

export enum PriceOracleType {
  V4 = "v4",
  V3 = "v3",
  V2 = "v2",
  V1 = "v1",
}

/**
 * RPC timeout in milliseconds (60 seconds)
 * Prevents indefinite hangs on slow or unresponsive RPC providers
 */
export const RPC_TIMEOUT_MS = 60000;

export { zeroAddress as ZERO_ADDRESS } from "viem";

/**
 * Default/fallback public RPC URLs for each chain
 * Used as fallback when private RPC fails or doesn't have historical state
 */
export const DefaultRPC = {
  optimism: "https://mainnet.optimism.io",
  base: "https://base-rpc.publicnode.com",
  lisk: "https://lisk.drpc.org",
  mode: "https://1rpc.io/mode",
  celo: "https://celo.drpc.org",
  soneium: "https://soneium.drpc.org",
  unichain: "https://0xrpc.io/uni",
  fraxtal: "https://fraxtal.drpc.org",
  ink: "https://ink.drpc.org",
  metal: "https://metall2.drpc.org",
  swell: "https://rpc.ankr.com/swell",
} as const;

/**
 * Get default RPC URL by chain ID
 * @param chainId - The chain ID
 * @returns The default RPC URL for the chain, or null if not found
 */
export function getDefaultRPCByChainId(chainId: number): string | null {
  const chainIdMap: Record<number, string> = {
    10: DefaultRPC.optimism,
    8453: DefaultRPC.base,
    1135: DefaultRPC.lisk,
    34443: DefaultRPC.mode,
    42220: DefaultRPC.celo,
    1868: DefaultRPC.soneium,
    130: DefaultRPC.unichain,
    252: DefaultRPC.fraxtal,
    57073: DefaultRPC.ink,
    1750: DefaultRPC.metal,
    1923: DefaultRPC.swell,
  };

  return chainIdMap[chainId] || null;
}

// Object containing all the constants for a chain
type chainConstants = {
  weth: string;
  usdc: string;
  oracle: {
    getType: (blockNumber: number) => PriceOracleType;
    getAddress: (priceOracleType: PriceOracleType) => string;
    startBlock: number;
    updateDelta: number;
    priceConnectors: PriceConnector[];
  };
  rewardToken: (blockNumber: number) => string;
  newCLGaugeFactoryAddress: string;
  eth_client: PublicClient;
  lpHelperAddress: string;
};

// Constants for Optimism
const OPTIMISM_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  oracle: {
    getType: (blockNumber: number) => {
      if (blockNumber > 125484892) {
        return PriceOracleType.V3;
      }
      if (blockNumber > 124076662) {
        return PriceOracleType.V2;
      }
      return PriceOracleType.V1;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      switch (priceOracleType) {
        case PriceOracleType.V3:
          return "0x59114D308C6DE4A84F5F8cD80485a5481047b99f";
        case PriceOracleType.V2:
          return "0x6a3af44e23395d2470f7c81331add6ede8597306";
        case PriceOracleType.V1:
          return "0x395942C2049604a314d39F370Dfb8D87AAC89e16";
        case PriceOracleType.V4:
          throw new Error("V4 oracle not supported on Optimism");
        default:
          throw new Error(`Unsupported oracle type: ${priceOracleType}`);
      }
    },
    startBlock: 107676013,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: OPTIMISM_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) => {
    if (blockNumber < 105896880) {
      return "0x3c8B650257cFb5f272f799F5e2b4e65093a11a05";
    }
    return "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db";
  },
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: optimism satisfies Chain as Chain,
    transport: http(process.env.ENVIO_OPTIMISM_RPC_URL || DefaultRPC.optimism, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0xF313D54f514A810387D77b7Cc20a98ADd5f891f7",
};

// Constants for Base
const BASE_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  oracle: {
    getType: (blockNumber: number) => {
      if (blockNumber > 37381618) {
        return PriceOracleType.V4;
      }
      if (blockNumber > 19862773) {
        return PriceOracleType.V3;
      }
      if (blockNumber > 18480097) {
        return PriceOracleType.V2;
      }
      return PriceOracleType.V1;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      switch (priceOracleType) {
        case PriceOracleType.V4:
          return "0x8456038bdae8672f552182B0FC39b1917dE9a41A";
        case PriceOracleType.V3:
          return "0x3B06c787711ecb5624cE65AC8F26cde10831eb0C";
        case PriceOracleType.V2:
          return "0xcbf5b6abf55fb87271338097fdd03e9d82a9d63f";
        case PriceOracleType.V1:
          return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
      }
    },
    startBlock: 3219857,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: BASE_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  newCLGaugeFactoryAddress: "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
  eth_client: createPublicClient({
    chain: base satisfies Chain as Chain,
    transport: http(process.env.ENVIO_BASE_RPC_URL || DefaultRPC.base, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0xd48bed8AFaF8A1d0909fe823F6b48a4A96f58224",
};

// Constants for Lisk
const LISK_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xF242275d3a6527d877f2c927a82D9b057609cc71",
  oracle: {
    getType: (blockNumber: number) => {
      if (blockNumber > 8457278) {
        return PriceOracleType.V3;
      }
      return PriceOracleType.V2;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      switch (priceOracleType) {
        case PriceOracleType.V3:
          return "0x024503003fFE9AF285f47c1DaAaA497D9f1166D0";
        case PriceOracleType.V2:
          return "0xE50621a0527A43534D565B67D64be7C79807F269";
        case PriceOracleType.V1:
          return "0xE50621a0527A43534D565B67D64be7C79807F269";
        case PriceOracleType.V4:
          throw new Error("V4 oracle not supported on Lisk");
        default:
          throw new Error(`Unsupported oracle type: ${priceOracleType}`);
      }
    },
    startBlock: 8380726,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: LISK_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: lisk satisfies Chain as Chain,
    transport: http(process.env.ENVIO_LISK_RPC_URL || DefaultRPC.lisk, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0xa2e319aBE4bBEadeD6FcE67F7D0CDDc5d23F8a8A",
};

// Constants for Mode
const MODE_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xd988097fb8612cc24eeC14542bC03424c656005f",
  oracle: {
    getType: (blockNumber: number) => {
      if (blockNumber > 15738649) {
        return PriceOracleType.V3;
      }
      return PriceOracleType.V2;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      switch (priceOracleType) {
        case PriceOracleType.V3:
          return "0xbAEe949B52cb503e39f1Df54Dcee778da59E11bc";
        case PriceOracleType.V2:
          return "0xE50621a0527A43534D565B67D64be7C79807F269";
        case PriceOracleType.V1:
          return "0xE50621a0527A43534D565B67D64be7C79807F269";
        case PriceOracleType.V4:
          throw new Error("V4 oracle not supported on Mode");
        default:
          throw new Error(`Unsupported oracle type: ${priceOracleType}`);
      }
    },
    startBlock: 15591759,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: MODE_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: mode satisfies Chain as Chain,
    transport: http(process.env.ENVIO_MODE_RPC_URL || DefaultRPC.mode, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0xD4738416444ce276289A884fDA4FDAc31f8eC694",
};

// Constants for Celo
const CELO_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xef4229c8c3250C675F21BCefa42f58EfbfF6002a",
  oracle: {
    getType: (blockNumber: number) => {
      return PriceOracleType.V3;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      return "0xbf6d753FC4a10Ec5191c56BB3DC1e414b7572327";
    },
    startBlock: 31690441,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: CELO_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: celo satisfies Chain as Chain,
    transport: http(process.env.ENVIO_CELO_RPC_URL || DefaultRPC.celo, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0xa916A76b052AcD3b0FF6Cc76b55602fba456a85C",
};

// Constants for Soneium
const SONEIUM_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
  oracle: {
    getType: (blockNumber: number) => {
      return PriceOracleType.V3;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
    },
    startBlock: 1863998, // TODO: Get start block
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: SONEIUM_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: soneium satisfies Chain as Chain,
    transport: http(process.env.ENVIO_SONEIUM_RPC_URL || DefaultRPC.soneium, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0x600089ab611E4Cc9942163e68870806Db66e2B08",
};

// Constants for Unichain
const UNICHAIN_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  oracle: {
    getType: (blockNumber: number) => {
      return PriceOracleType.V3;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
    },
    startBlock: 9415475,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: UNICHAIN_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: unichain satisfies Chain as Chain,
    transport: http(process.env.ENVIO_UNICHAIN_RPC_URL || DefaultRPC.unichain, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0x2DCD9B33F0721000Dc1F8f84B804d4CFA23d7713",
};

// Constants for Fraxtal
const FRAXTAL_CONSTANTS: chainConstants = {
  weth: "0xFC00000000000000000000000000000000000006",
  usdc: "0xDcc0F2D8F90FDe85b10aC1c8Ab57dc0AE946A543",
  oracle: {
    getType: (blockNumber: number) => {
      if (blockNumber > 12710720) {
        return PriceOracleType.V3;
      }
      return PriceOracleType.V2;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      switch (priceOracleType) {
        case PriceOracleType.V3:
          return "0x4817f8D70aE32Ee96e5E6BFA24eb7Fcfa83bbf29";
        case PriceOracleType.V2:
          return "0xE50621a0527A43534D565B67D64be7C79807F269";
        case PriceOracleType.V1:
          return "0xE50621a0527A43534D565B67D64be7C79807F269";
        case PriceOracleType.V4:
          throw new Error("V4 oracle not supported on Fraxtal");
        default:
          throw new Error(`Unsupported oracle type: ${priceOracleType}`);
      }
    },
    startBlock: 12640176,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: FRAXTAL_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: fraxtal satisfies Chain as Chain,
    transport: http(process.env.ENVIO_FRAXTAL_RPC_URL || DefaultRPC.fraxtal, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0x2F44BD0Aff1826aec123cE3eA9Ce44445b64BB34",
};

// Constants for Ink
const INK_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
  oracle: {
    getType: (blockNumber: number) => {
      return PriceOracleType.V3;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
    },
    startBlock: 3361885,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: INK_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: ink satisfies Chain as Chain,
    transport: http(process.env.ENVIO_INK_RPC_URL || DefaultRPC.ink, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0x2DCD9B33F0721000Dc1F8f84B804d4CFA23d7713",
};

// Constants for Metal
const METAL_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xb91CFCcA485C6E40E3bC622f9BFA02a8ACdEeBab",
  oracle: {
    getType: (blockNumber: number) => {
      return PriceOracleType.V3;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      return "0x3e71CCdf495d9628D3655A600Bcad3afF2ddea98";
    },
    startBlock: 11438647,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: METAL_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: metalL2 satisfies Chain as Chain,
    transport: http(process.env.ENVIO_METAL_RPC_URL || DefaultRPC.metal, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }),
  lpHelperAddress: "0xcaa7d54453964773FE04B5aD32D06322Fc9d9fE4",
};

// Constants for Swell
const SWELL_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x99a38322cAF878Ef55AE4d0Eda535535eF8C7960",
  oracle: {
    getType: (blockNumber: number) => {
      return PriceOracleType.V3;
    },
    getAddress: (priceOracleType: PriceOracleType) => {
      return "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE";
    },
    startBlock: 3733759,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: SWELL_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  newCLGaugeFactoryAddress: "", // TODO: Update with a real address
  eth_client: createPublicClient({
    chain: swellchain,
    transport: http(process.env.ENVIO_SWELL_RPC_URL || DefaultRPC.swell, {
      batch: true,
      timeout: RPC_TIMEOUT_MS,
    }),
  }) as PublicClient,
  lpHelperAddress: "0x2002618dd63228670698200069E42f4422e82497",
};

/**
 * Create a unique ID for a token on a specific chain. Should only be used for Token entities.
 * @param chainId
 * @param address
 * @returns string Merged Token ID.
 */
export const TokenId = (chainId: number, address: string) =>
  `${chainId}-${address}`;

/**
 * Create a unique ID for a pool on a specific chain as used by LiquidityPoolAggregator.
 * @param chainId
 * @param pool
 * @returns string Combined pool ID.
 */
export const PoolId = (chainId: number, pool: string) => `${chainId}-${pool}`;

/** Entity ID for ALM_LP_Wrapper.
 * @param chainId
 * @param wrapperAddress
 * @returns string Combined wrapper ID.
 */
export const ALMLPWrapperId = (chainId: number, wrapperAddress: string) =>
  `${chainId}-${wrapperAddress}`;

/** Entity ID for UserStatsPerPool.
 * @param chainId
 * @param userAddress
 * @param poolAddress
 * @returns string Combined user ID.
 */
export const UserStatsPerPoolId = (
  chainId: number,
  userAddress: string,
  poolAddress: string,
) => `${chainId}-${userAddress}-${poolAddress}`;

/** Entity ID for VeNFTState.
 * @param chainId
 * @param tokenId
 * @returns string Combined veNFT ID.
 */
export const VeNFTId = (chainId: number, tokenId: bigint) =>
  `${chainId}-${tokenId}`;

/** Entity ID for VeNFTPoolVote.
 * @param chainId
 * @param tokenId
 * @param poolAddress
 * @returns string Combined veNFT pool vote ID.
 */
export const VeNFTPoolVoteId = (
  chainId: number,
  tokenId: bigint,
  poolAddress: string,
) => `${chainId}-${tokenId}-${poolAddress}`;

/** Entity ID for RootPool_LeafPool. rootChainId is typically 10 (Optimism).
 * @param rootChainId
 * @param leafChainId
 * @param rootPoolAddress
 * @param leafPoolAddress
 * @returns string Combined root pool leaf pool ID.
 */
export const RootPoolLeafPoolId = (
  rootChainId: number,
  leafChainId: number,
  rootPoolAddress: string,
  leafPoolAddress: string,
) => `${rootChainId}-${leafChainId}-${rootPoolAddress}-${leafPoolAddress}`;

/** Entity ID for FeeToTickSpacingMapping.
 * @param chainId
 * @param tickSpacing
 * @returns string Combined fee to tick spacing mapping ID.
 */
export const FeeToTickSpacingMappingId = (
  chainId: number,
  tickSpacing: bigint | number,
) => `${chainId}-${tickSpacing}`;

/** Entity ID for NonFungiblePosition (stable id: chainId-poolAddress-tokenId).
 * @param chainId
 * @param poolAddress
 * @param tokenId
 * @returns string Combined non fungible position ID.
 */
export const NonFungiblePositionId = (
  chainId: number,
  poolAddress: string,
  tokenId: bigint,
) => `${chainId}-${poolAddress}-${tokenId}`;

/**
 * Create a unique ID for a token on a specific chain at a specific block. Really should only be used
 * for TokenPrice Entities.
 * @param chainId
 * @param address
 * @param blockNumber
 * @returns string Merged Token ID.
 */
export const TokenIdByBlock = (
  chainId: number,
  address: string,
  blockNumber: number,
) => `${chainId}-${address}-${blockNumber}`;

/** Entity ID for PoolTransferInTx.
 * @param chainId
 * @param txHash
 * @param poolAddress
 * @param logIndex
 */
export const PoolTransferInTxId = (
  chainId: number,
  txHash: string,
  poolAddress: string,
  logIndex: number,
) => `${chainId}-${txHash}-${poolAddress}-${logIndex}`;

/** Entity ID for ALMLPWrapperTransferInTx.
 * @param chainId
 * @param txHash
 * @param wrapperAddress
 * @param logIndex
 */
export const ALMLPWrapperTransferInTxId = (
  chainId: number,
  txHash: string,
  wrapperAddress: string,
  logIndex: number,
) => `${chainId}-${txHash}-${wrapperAddress}-${logIndex}`;

/** Entity ID for CLPoolMintEvent.
 * @param chainId
 * @param poolAddress
 * @param txHash
 * @param logIndex
 */
export const CLPoolMintEventId = (
  chainId: number,
  poolAddress: string,
  txHash: string,
  logIndex: number,
) => `${chainId}-${poolAddress}-${txHash}-${logIndex}`;

/** Entity ID for LiquidityPoolAggregatorSnapshot.
 * @param chainId
 * @param poolAddress
 * @param snapshotTime
 */
export const LiquidityPoolAggregatorSnapshotId = (
  chainId: number,
  poolAddress: string,
  snapshotTime: number,
) => `${chainId}-${poolAddress}-${snapshotTime}`;

/** Entity ID for DispatchId_event and ProcessId_event (Mailbox events).
 * @param transactionHash
 * @param chainId
 * @param messageId
 */
export const MailboxMessageId = (
  transactionHash: string,
  chainId: number,
  messageId: string,
) => `${transactionHash}-${chainId}-${messageId}`;

/** Entity ID for OUSDTSwaps.
 * @param transactionHash
 * @param chainId
 * @param tokenInPool
 * @param amountIn
 * @param tokenOutPool
 * @param amountOut
 */
export const OUSDTSwapsId = (
  transactionHash: string,
  chainId: number,
  tokenInPool: string,
  amountIn: bigint,
  tokenOutPool: string,
  amountOut: bigint,
) =>
  `${transactionHash}-${chainId}-${tokenInPool}-${amountIn}-${tokenOutPool}-${amountOut}`;

/** Entity ID for SuperSwap.
 * @param transactionHash
 * @param originChainId
 * @param destinationDomain
 * @param oUSDTamount
 * @param messageId
 * @param sourceChainToken
 * @param sourceChainTokenAmountSwapped
 * @param destinationChainToken
 * @param destinationChainTokenAmountSwapped
 */
export const SuperSwapId = (
  transactionHash: string,
  originChainId: number,
  destinationDomain: bigint,
  oUSDTamount: bigint,
  messageId: string,
  sourceChainToken: string,
  sourceChainTokenAmountSwapped: bigint,
  destinationChainToken: string,
  destinationChainTokenAmountSwapped: bigint,
) =>
  `${transactionHash}-${originChainId}-${destinationDomain}-${oUSDTamount}-${messageId}-${sourceChainToken}-${sourceChainTokenAmountSwapped}-${destinationChainToken}-${destinationChainTokenAmountSwapped}`;

// Key is chain ID
export const CHAIN_CONSTANTS: Record<number, chainConstants> = {
  10: OPTIMISM_CONSTANTS,
  8453: BASE_CONSTANTS,
  34443: MODE_CONSTANTS,
  1135: LISK_CONSTANTS,
  252: FRAXTAL_CONSTANTS,
  1750: METAL_CONSTANTS,
  1868: SONEIUM_CONSTANTS,
  57073: INK_CONSTANTS,
  130: UNICHAIN_CONSTANTS,
  42220: CELO_CONSTANTS,
  1923: SWELL_CONSTANTS,
};
