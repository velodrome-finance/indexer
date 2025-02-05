import dotenv from "dotenv";
import { Web3 } from "web3";
import { optimism, base, lisk, mode, fraxtal, ink, soneium } from 'viem/chains';
import { createPublicClient, http, PublicClient } from 'viem';

import PriceConnectors from "./constants/price_connectors.json";

dotenv.config();

export const TEN_TO_THE_3_BI = BigInt(10 ** 3);
export const TEN_TO_THE_6_BI = BigInt(10 ** 6);
export const TEN_TO_THE_18_BI = BigInt(10 ** 18);

export const SECONDS_IN_AN_HOUR = BigInt(3600);
export const SECONDS_IN_A_DAY = BigInt(86400);
export const SECONDS_IN_A_WEEK = BigInt(604800);

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

export const toChecksumAddress = (address: string) =>
  Web3.utils.toChecksumAddress(address);

// Object containing all the constants for a chain
type chainConstants = {
  weth: string;
  usdc: string;
  oracle: {
    getAddress: (blockNumber: number) => string;
    startBlock: number;
    updateDelta: number;
    priceConnectors: PriceConnector[];
  };
  rewardToken: (blockNumber: number) => string;
  eth_client: PublicClient;
};

// Constants for Optimism
const OPTIMISM_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  oracle: {
    getAddress: (blockNumber: number) => {
      return blockNumber < 124076662
        ? "0x395942C2049604a314d39F370Dfb8D87AAC89e16"
        : "0x6a3af44e23395d2470f7c81331add6ede8597306";
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
  eth_client: createPublicClient({
    chain: optimism,
    transport: http(process.env.ENVIO_OPTIMISM_RPC_URL || "https://rpc.ankr.com/optimism", {
      retryCount: 10,
      retryDelay: 1000,
      batch: false
    }),
  }) as PublicClient,
};

// Constants for Base
const BASE_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  oracle: {
    getAddress: (blockNumber: number) => {
      return blockNumber < 18480097
        ? "0xe58920a8c684CD3d6dCaC2a41b12998e4CB17EfE"
        : "0xcbf5b6abf55fb87271338097fdd03e9d82a9d63f";
    },
    startBlock: 3219857,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: BASE_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: Number) =>
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  eth_client: createPublicClient({
    chain: base,
    transport: http(process.env.ENVIO_BASE_RPC_URL || "https://base.publicnode.com", {
      retryCount: 10,
      retryDelay: 1000,
    }),
  }) as PublicClient
};

// Constants for Lisk
const LISK_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xF242275d3a6527d877f2c927a82D9b057609cc71",
  oracle: {
    getAddress: (blockNumber: number) => {
      return "0xE50621a0527A43534D565B67D64be7C79807F269";
    },
    startBlock: 8380726,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: LISK_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  eth_client: createPublicClient({
    chain: lisk,
    transport: http(process.env.ENVIO_LISK_RPC_URL || "https://lisk.drpc.org", {
      retryCount: 10,
      retryDelay: 1000,
    }),
  }) as PublicClient
};

// Constants for Mode
const MODE_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xd988097fb8612cc24eeC14542bC03424c656005f",
  oracle: {
    getAddress: (blockNumber: number) => {
      return "0xE50621a0527A43534D565B67D64be7C79807F269";
    },
    startBlock: 15591759,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: MODE_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  eth_client: createPublicClient({
    chain: mode,
    transport: http(process.env.ENVIO_MODE_RPC_URL || "https://mainnet.mode.network", {
      retryCount: 10,
      retryDelay: 1000,
    }),
  }) as PublicClient,
};

// Constants for Soneium
const SONEIUM_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369",
  oracle: {
    getAddress: (blockNumber: number) => {
      return "0xE50621a0527A43534D565B67D64be7C79807F269";
    },
    startBlock: 0, // TODO: Get start block
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: SONEIUM_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  eth_client: createPublicClient({
    chain: soneium,
    transport: http(process.env.ENVIO_SONEIUM_RPC_URL || "https://rpc.soneium.com", {
      retryCount: 10,
      retryDelay: 1000,
    }),
  }) as PublicClient,
};


// Constants for Fraxtal
const FRAXTAL_CONSTANTS: chainConstants = {
  weth: "0xFC00000000000000000000000000000000000006",
  usdc: "0xFc00000000000000000000000000000000000001",
  oracle: {
    getAddress: (blockNumber: number) => {
      return "0xE50621a0527A43534D565B67D64be7C79807F269";
    },
    startBlock: 12640176,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: FRAXTAL_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  eth_client: createPublicClient({
    chain: fraxtal,
    transport: http(process.env.ENVIO_FRAXTAL_RPC_URL || "https://rpc.frax.com", {
      retryCount: 10,
      retryDelay: 1000,
    }),
  }) as PublicClient,
};

// Constants for Ink
const INK_CONSTANTS: chainConstants = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0xF1815bd50389c46847f0Bda824eC8da914045D14",
  oracle: {
    getAddress: (blockNumber: number) => {
      return "0xE50621a0527A43534D565B67D64be7C79807F269";
    },
    startBlock: 3422094,
    updateDelta: 60 * 60, // 1 hour
    priceConnectors: INK_PRICE_CONNECTORS,
  },
  rewardToken: (blockNumber: number) =>
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81",
  eth_client: createPublicClient({
    chain: ink,
    transport: http(process.env.ENVIO_INK_RPC_URL || "https://rpc-gel.inkonchain.com", {
      retryCount: 10,
      retryDelay: 1000,
    }),
  }) as PublicClient,
};

/**
 * Create a unique ID for a token on a specific chain. Really should only be used for Token Entities.
 * @param address
 * @param chainId
 * @returns string Merged Token ID.
 */
export const TokenIdByChain = (address: string, chainId: number) =>
  `${toChecksumAddress(address)}-${chainId}`;

/**
 * Create a unique ID for a token on a specific chain at a specific block. Really should only be used
 * for TokenPrice Entities.
 * @param address
 * @param chainId
 * @param blockNumber
 * @returns string Merged Token ID.
 */
export const TokenIdByBlock = (
  address: string,
  chainId: number,
  blockNumber: number
) => `${chainId}_${toChecksumAddress(address)}_${blockNumber}`;

// Key is chain ID
export const CHAIN_CONSTANTS: Record<number, chainConstants> = {
  10: OPTIMISM_CONSTANTS,
  8453: BASE_CONSTANTS,
  34443: MODE_CONSTANTS,
  1135: LISK_CONSTANTS,
  252: FRAXTAL_CONSTANTS,
  1868: SONEIUM_CONSTANTS,
  57073: INK_CONSTANTS
};

export const CacheCategory = {
  Token: "token",
  GuageToPool: "guageToPool",
  BribeToPool: "bribeToPool",
  WhitelistedPoolIds: "whitelistedPoolIds",
  PoolToTokens: "poolToTokens",
  TokenPrices: "tokenPrices",
} as const;

export type CacheCategory = (typeof CacheCategory)[keyof typeof CacheCategory];
