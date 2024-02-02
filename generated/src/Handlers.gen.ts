/* TypeScript file generated from Handlers.res by genType. */
/* eslint-disable import/first */


// @ts-ignore: Implicit any on import
const Curry = require('rescript/lib/js/curry.js');

// @ts-ignore: Implicit any on import
const HandlersBS = require('./Handlers.bs');

import type {PoolContract_FeesEvent_eventArgs as Types_PoolContract_FeesEvent_eventArgs} from './Types.gen';

import type {PoolContract_FeesEvent_handlerContextAsync as Types_PoolContract_FeesEvent_handlerContextAsync} from './Types.gen';

import type {PoolContract_FeesEvent_handlerContext as Types_PoolContract_FeesEvent_handlerContext} from './Types.gen';

import type {PoolContract_FeesEvent_loaderContext as Types_PoolContract_FeesEvent_loaderContext} from './Types.gen';

import type {PoolContract_SwapEvent_eventArgs as Types_PoolContract_SwapEvent_eventArgs} from './Types.gen';

import type {PoolContract_SwapEvent_handlerContextAsync as Types_PoolContract_SwapEvent_handlerContextAsync} from './Types.gen';

import type {PoolContract_SwapEvent_handlerContext as Types_PoolContract_SwapEvent_handlerContext} from './Types.gen';

import type {PoolContract_SwapEvent_loaderContext as Types_PoolContract_SwapEvent_loaderContext} from './Types.gen';

import type {PoolContract_SyncEvent_eventArgs as Types_PoolContract_SyncEvent_eventArgs} from './Types.gen';

import type {PoolContract_SyncEvent_handlerContextAsync as Types_PoolContract_SyncEvent_handlerContextAsync} from './Types.gen';

import type {PoolContract_SyncEvent_handlerContext as Types_PoolContract_SyncEvent_handlerContext} from './Types.gen';

import type {PoolContract_SyncEvent_loaderContext as Types_PoolContract_SyncEvent_loaderContext} from './Types.gen';

import type {PoolFactoryContract_PoolCreatedEvent_eventArgs as Types_PoolFactoryContract_PoolCreatedEvent_eventArgs} from './Types.gen';

import type {PoolFactoryContract_PoolCreatedEvent_handlerContextAsync as Types_PoolFactoryContract_PoolCreatedEvent_handlerContextAsync} from './Types.gen';

import type {PoolFactoryContract_PoolCreatedEvent_handlerContext as Types_PoolFactoryContract_PoolCreatedEvent_handlerContext} from './Types.gen';

import type {PoolFactoryContract_PoolCreatedEvent_loaderContext as Types_PoolFactoryContract_PoolCreatedEvent_loaderContext} from './Types.gen';

import type {VoterContract_DistributeRewardEvent_eventArgs as Types_VoterContract_DistributeRewardEvent_eventArgs} from './Types.gen';

import type {VoterContract_DistributeRewardEvent_handlerContextAsync as Types_VoterContract_DistributeRewardEvent_handlerContextAsync} from './Types.gen';

import type {VoterContract_DistributeRewardEvent_handlerContext as Types_VoterContract_DistributeRewardEvent_handlerContext} from './Types.gen';

import type {VoterContract_DistributeRewardEvent_loaderContext as Types_VoterContract_DistributeRewardEvent_loaderContext} from './Types.gen';

import type {VoterContract_GaugeCreatedEvent_eventArgs as Types_VoterContract_GaugeCreatedEvent_eventArgs} from './Types.gen';

import type {VoterContract_GaugeCreatedEvent_handlerContextAsync as Types_VoterContract_GaugeCreatedEvent_handlerContextAsync} from './Types.gen';

import type {VoterContract_GaugeCreatedEvent_handlerContext as Types_VoterContract_GaugeCreatedEvent_handlerContext} from './Types.gen';

import type {VoterContract_GaugeCreatedEvent_loaderContext as Types_VoterContract_GaugeCreatedEvent_loaderContext} from './Types.gen';

import type {eventLog as Types_eventLog} from './Types.gen';

import type {genericContextCreatorFunctions as Context_genericContextCreatorFunctions} from './Context.gen';

import type {t as SyncAsync_t} from './SyncAsync.gen';

// tslint:disable-next-line:interface-over-type-literal
export type handlerFunction<eventArgs,context,returned> = (_1:{ readonly event: Types_eventLog<eventArgs>; readonly context: context }) => returned;

// tslint:disable-next-line:interface-over-type-literal
export type handlerWithContextGetter<eventArgs,context,returned,loaderContext,handlerContextSync,handlerContextAsync> = { readonly handler: handlerFunction<eventArgs,context,returned>; readonly contextGetter: (_1:Context_genericContextCreatorFunctions<loaderContext,handlerContextSync,handlerContextAsync>) => context };

// tslint:disable-next-line:interface-over-type-literal
export type handlerWithContextGetterSyncAsync<eventArgs,loaderContext,handlerContextSync,handlerContextAsync> = SyncAsync_t<handlerWithContextGetter<eventArgs,handlerContextSync,void,loaderContext,handlerContextSync,handlerContextAsync>,handlerWithContextGetter<eventArgs,handlerContextAsync,Promise<void>,loaderContext,handlerContextSync,handlerContextAsync>>;

// tslint:disable-next-line:interface-over-type-literal
export type loader<eventArgs,loaderContext> = (_1:{ readonly event: Types_eventLog<eventArgs>; readonly context: loaderContext }) => void;

export const PoolContract_Fees_loader: (loader:loader<Types_PoolContract_FeesEvent_eventArgs,Types_PoolContract_FeesEvent_loaderContext>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Fees.loader(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, contractRegistration:Argcontext.contractRegistration, LiquidityPool:{load:function (Arg12: any, Arg21: any) {
          const result3 = Curry._2(Argcontext.LiquidityPool.load, Arg12, Arg21.loaders);
          return result3
        }}}});
      return result1
    });
  return result
};

export const PoolContract_Fees_handler: (handler:handlerFunction<Types_PoolContract_FeesEvent_eventArgs,Types_PoolContract_FeesEvent_handlerContext,void>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Fees.handler(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolContract_Fees_handlerAsync: (handler:handlerFunction<Types_PoolContract_FeesEvent_eventArgs,Types_PoolContract_FeesEvent_handlerContextAsync,Promise<void>>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Fees.handlerAsync(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolContract_Swap_loader: (loader:loader<Types_PoolContract_SwapEvent_eventArgs,Types_PoolContract_SwapEvent_loaderContext>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Swap.loader(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, contractRegistration:Argcontext.contractRegistration, LiquidityPool:{load:function (Arg12: any, Arg21: any) {
          const result3 = Curry._2(Argcontext.LiquidityPool.load, Arg12, Arg21.loaders);
          return result3
        }}, LiquidityPoolUserMapping:{load:function (Arg13: any, Arg22: any) {
          const result4 = Curry._2(Argcontext.LiquidityPoolUserMapping.load, Arg13, Arg22.loaders);
          return result4
        }}, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolContract_Swap_handler: (handler:handlerFunction<Types_PoolContract_SwapEvent_eventArgs,Types_PoolContract_SwapEvent_handlerContext,void>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Swap.handler(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolContract_Swap_handlerAsync: (handler:handlerFunction<Types_PoolContract_SwapEvent_eventArgs,Types_PoolContract_SwapEvent_handlerContextAsync,Promise<void>>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Swap.handlerAsync(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolContract_Sync_loader: (loader:loader<Types_PoolContract_SyncEvent_eventArgs,Types_PoolContract_SyncEvent_loaderContext>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Sync.loader(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, contractRegistration:Argcontext.contractRegistration, StateStore:{stateStoreLoad:function (Arg12: any, Arg21: any) {
          const result3 = Curry._2(Argcontext.StateStore.stateStoreLoad, Arg12, Arg21.loaders);
          return result3
        }, load:function (Arg13: any, Arg22: any) {
          const result4 = Curry._2(Argcontext.StateStore.load, Arg13, Arg22.loaders);
          return result4
        }}, LiquidityPool:{singlePoolLoad:function (Arg14: any, Arg23: any) {
          const result5 = Curry._2(Argcontext.LiquidityPool.singlePoolLoad, Arg14, Arg23.loaders);
          return result5
        }, stablecoinPoolsLoad:function (Arg15: any, Arg24: any) {
          const result6 = Curry._2(Argcontext.LiquidityPool.stablecoinPoolsLoad, Arg15, Arg24.loaders);
          return result6
        }, whitelistedPoolsLoad:function (Arg16: any, Arg25: any) {
          const result7 = Curry._2(Argcontext.LiquidityPool.whitelistedPoolsLoad, Arg16, Arg25.loaders);
          return result7
        }, load:function (Arg17: any, Arg26: any) {
          const result8 = Curry._2(Argcontext.LiquidityPool.load, Arg17, Arg26.loaders);
          return result8
        }}, Token:Argcontext.Token}});
      return result1
    });
  return result
};

export const PoolContract_Sync_handler: (handler:handlerFunction<Types_PoolContract_SyncEvent_eventArgs,Types_PoolContract_SyncEvent_handlerContext,void>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Sync.handler(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolContract_Sync_handlerAsync: (handler:handlerFunction<Types_PoolContract_SyncEvent_eventArgs,Types_PoolContract_SyncEvent_handlerContextAsync,Promise<void>>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolContract.Sync.handlerAsync(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolFactoryContract_PoolCreated_loader: (loader:loader<Types_PoolFactoryContract_PoolCreatedEvent_eventArgs,Types_PoolFactoryContract_PoolCreatedEvent_loaderContext>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolFactoryContract.PoolCreated.loader(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, contractRegistration:Argcontext.contractRegistration, StateStore:{stateStoreLoad:function (Arg12: any, Arg21: any) {
          const result3 = Curry._2(Argcontext.StateStore.stateStoreLoad, Arg12, Arg21.loaders);
          return result3
        }, load:function (Arg13: any, Arg22: any) {
          const result4 = Curry._2(Argcontext.StateStore.load, Arg13, Arg22.loaders);
          return result4
        }}}});
      return result1
    });
  return result
};

export const PoolFactoryContract_PoolCreated_handler: (handler:handlerFunction<Types_PoolFactoryContract_PoolCreatedEvent_eventArgs,Types_PoolFactoryContract_PoolCreatedEvent_handlerContext,void>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolFactoryContract.PoolCreated.handler(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const PoolFactoryContract_PoolCreated_handlerAsync: (handler:handlerFunction<Types_PoolFactoryContract_PoolCreatedEvent_eventArgs,Types_PoolFactoryContract_PoolCreatedEvent_handlerContextAsync,Promise<void>>) => void = function (Arg1: any) {
  const result = HandlersBS.PoolFactoryContract.PoolCreated.handlerAsync(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const VoterContract_DistributeReward_loader: (loader:loader<Types_VoterContract_DistributeRewardEvent_eventArgs,Types_VoterContract_DistributeRewardEvent_loaderContext>) => void = function (Arg1: any) {
  const result = HandlersBS.VoterContract.DistributeReward.loader(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, contractRegistration:Argcontext.contractRegistration, Gauge:{load:function (Arg12: any, Arg21: any) {
          const result3 = Curry._2(Argcontext.Gauge.load, Arg12, Arg21.loaders);
          return result3
        }}, Token:Argcontext.Token}});
      return result1
    });
  return result
};

export const VoterContract_DistributeReward_handler: (handler:handlerFunction<Types_VoterContract_DistributeRewardEvent_eventArgs,Types_VoterContract_DistributeRewardEvent_handlerContext,void>) => void = function (Arg1: any) {
  const result = HandlersBS.VoterContract.DistributeReward.handler(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const VoterContract_DistributeReward_handlerAsync: (handler:handlerFunction<Types_VoterContract_DistributeRewardEvent_eventArgs,Types_VoterContract_DistributeRewardEvent_handlerContextAsync,Promise<void>>) => void = function (Arg1: any) {
  const result = HandlersBS.VoterContract.DistributeReward.handlerAsync(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const VoterContract_GaugeCreated_loader: (loader:loader<Types_VoterContract_GaugeCreatedEvent_eventArgs,Types_VoterContract_GaugeCreatedEvent_loaderContext>) => void = function (Arg1: any) {
  const result = HandlersBS.VoterContract.GaugeCreated.loader(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, contractRegistration:Argcontext.contractRegistration, LiquidityPool:{load:function (Arg12: any, Arg21: any) {
          const result3 = Curry._2(Argcontext.LiquidityPool.load, Arg12, Arg21.loaders);
          return result3
        }}}});
      return result1
    });
  return result
};

export const VoterContract_GaugeCreated_handler: (handler:handlerFunction<Types_VoterContract_GaugeCreatedEvent_eventArgs,Types_VoterContract_GaugeCreatedEvent_handlerContext,void>) => void = function (Arg1: any) {
  const result = HandlersBS.VoterContract.GaugeCreated.handler(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};

export const VoterContract_GaugeCreated_handlerAsync: (handler:handlerFunction<Types_VoterContract_GaugeCreatedEvent_eventArgs,Types_VoterContract_GaugeCreatedEvent_handlerContextAsync,Promise<void>>) => void = function (Arg1: any) {
  const result = HandlersBS.VoterContract.GaugeCreated.handlerAsync(function (Argevent: any, Argcontext: any) {
      const result1 = Arg1({event:Argevent, context:{log:{debug:Argcontext.log.debug, info:Argcontext.log.info, warn:Argcontext.log.warn, error:Argcontext.log.error, errorWithExn:function (Arg11: any, Arg2: any) {
          const result2 = Curry._2(Argcontext.log.errorWithExn, Arg11, Arg2);
          return result2
        }}, Gauge:Argcontext.Gauge, LatestETHPrice:Argcontext.LatestETHPrice, LiquidityPool:Argcontext.LiquidityPool, LiquidityPoolDailySnapshot:Argcontext.LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot:Argcontext.LiquidityPoolHourlySnapshot, LiquidityPoolUserMapping:Argcontext.LiquidityPoolUserMapping, LiquidityPoolWeeklySnapshot:Argcontext.LiquidityPoolWeeklySnapshot, StateStore:Argcontext.StateStore, Token:Argcontext.Token, TokenDailySnapshot:Argcontext.TokenDailySnapshot, TokenHourlySnapshot:Argcontext.TokenHourlySnapshot, TokenWeeklySnapshot:Argcontext.TokenWeeklySnapshot, User:Argcontext.User}});
      return result1
    });
  return result
};
