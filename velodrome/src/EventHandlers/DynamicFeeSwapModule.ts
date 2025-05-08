import { DynamicFeeSwapModule,
    DynamicFeeSwapModule_CustomFeeSet,
    DynamicFeeSwapModule_FeeCapSet,
    DynamicFeeSwapModule_ScalingFactorSet,
    DynamicFeeSwapModule_SecondsAgoSet,
} from "generated";

DynamicFeeSwapModule.CustomFeeSet.handler(async ({ event, context }) => {
    const entity: DynamicFeeSwapModule_CustomFeeSet = {
        id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
        pool: event.params.pool,
        fee: event.params.fee,
        timestamp: new Date(event.block.timestamp * 1000),
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        logIndex: event.logIndex,
        chainId: event.chainId,
    };

    context.DynamicFeeSwapModule_CustomFeeSet.set(entity);
});

DynamicFeeSwapModule.SecondsAgoSet.handler(async ({ event, context }) => {
    const entity: DynamicFeeSwapModule_SecondsAgoSet = {
        id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
        secondsAgo: event.params.secondsAgo,
        timestamp: new Date(event.block.timestamp * 1000),
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        logIndex: event.logIndex,
        chainId: event.chainId,
    };

    context.DynamicFeeSwapModule_SecondsAgoSet.set(entity);
});

DynamicFeeSwapModule.ScalingFactorSet.handler(async ({ event, context }) => {
    const entity: DynamicFeeSwapModule_ScalingFactorSet = {
        id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
        pool: event.params.pool,
        scalingFactor: event.params.scalingFactor,
        timestamp: new Date(event.block.timestamp * 1000),
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        logIndex: event.logIndex,
        chainId: event.chainId,
    };

    context.DynamicFeeSwapModule_ScalingFactorSet.set(entity);
});

DynamicFeeSwapModule.FeeCapSet.handler(async ({ event, context }) => {
    const entity: DynamicFeeSwapModule_FeeCapSet = {
        id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
        pool: event.params.pool,
        feeCap: event.params.feeCap,
        timestamp: new Date(event.block.timestamp * 1000),
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        logIndex: event.logIndex,
        chainId: event.chainId,
    };

    context.DynamicFeeSwapModule_FeeCapSet.set(entity);
});
