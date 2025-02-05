import { poolRewardAddressMapping } from "./CustomTypes";
import {
  Cache,
  Entry,
  ShapeGuageToPool,
  ShapeBribeToPool,
} from "./cache";
import { CacheCategory } from "./Constants";

export const poolLookupStoreManager = () => {
  /*
  NOTE: here the cache is to make sure this code is restart resistant, it is not for performance optimization (actually the cache will have a negative impact on performance)
  */
  type lookups = {
    gaugeToPoolCache: Entry<ShapeGuageToPool>;
    bribeVotingToPoolCache: Entry<ShapeBribeToPool>;
  };
  const cacheMap = new Map<string | number | bigint, lookups>();

  const getCache = (chainId: string | number | bigint): lookups => {
    const cache = cacheMap.get(chainId);
    if (!cache) {
      const newCache = {
        gaugeToPoolCache: Cache.init(CacheCategory.GuageToPool, chainId),
        bribeVotingToPoolCache: Cache.init(CacheCategory.BribeToPool, chainId),
      };
      cacheMap.set(chainId, newCache);
      return newCache;
    } else {
      return cache;
    }
  };

  const addRewardAddressDetails = (
    chainId: string | number | bigint,
    details: poolRewardAddressMapping
  ) => {
    const { gaugeToPoolCache, bribeVotingToPoolCache } = getCache(chainId);
    gaugeToPoolCache.add({
      [details.gaugeAddress]: {
        poolAddress: details.poolAddress,
      },
    });
    bribeVotingToPoolCache.add({
      [details.bribeVotingRewardAddress]: {
        poolAddress: details.poolAddress,
      },
    });
  };

  const getPoolAddressByGaugeAddress = (
    chainId: string | number | bigint,
    gaugeAddress: string
  ): string | undefined => {
    const { gaugeToPoolCache } = getCache(chainId);
    const result = gaugeToPoolCache.read(gaugeAddress);
    return result ? result.poolAddress : undefined;
  };

  const getPoolAddressByBribeVotingRewardAddress = (
    chainId: string | number | bigint,
    bribeVotingRewardAddress: string
  ): string | undefined => {
    const { bribeVotingToPoolCache } = getCache(chainId);
    const result = bribeVotingToPoolCache.read(
      bribeVotingRewardAddress
    );
    return result ? result.poolAddress : undefined;
  };

  return {
    getPoolAddressByBribeVotingRewardAddress,
    getPoolAddressByGaugeAddress,
    addRewardAddressDetails,
  };
};
