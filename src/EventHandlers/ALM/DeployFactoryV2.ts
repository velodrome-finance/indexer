import { indexer } from "envio";
import { ALMLPWrapperId } from "../../Constants";
import { findStrategyPosition } from "./DeployFactorySharedLogic";

indexer.contractRegister(
  { contract: "ALMDeployFactoryV2", event: "StrategyCreated" },
  async ({ event, context }) => {
    const { lpWrapper } = event.params.params;
    context.chain.ALMLPWrapperV2.add(lpWrapper);
  },
);

indexer.onEvent(
  { contract: "ALMDeployFactoryV2", event: "StrategyCreated" },
  async ({ event, context }) => {
    const { pool, ammPosition, strategyParams, lpWrapper, caller } =
      event.params.params;

    const {
      strategyType,
      tickNeighborhood,
      tickSpacing,
      width,
      maxLiquidityRatioDeviationX96,
    } = strategyParams;

    // Contract relationship: 1 LP wrapper per pool, 1 strategy per LP wrapper, 1 tokenId per strategy, 1 AMM position per tokenId
    // Therefore ammPosition array should have exactly 1 element (not a loop)
    const { token0, token1, property, tickLower, tickUpper, liquidity } =
      ammPosition[0];

    const timestamp = new Date(event.block.timestamp * 1000);

    const position = await findStrategyPosition(
      event.chainId,
      event.transaction.hash,
      { pool, token0, token1, tickLower, tickUpper, liquidity },
      "[ALMDeployFactoryV2]",
      context,
    );

    if (!position) {
      context.log.error(
        `[ALMDeployFactoryV2] NonFungiblePosition not found for transaction hash ${event.transaction.hash} (chainId: ${event.chainId}, pool: ${pool}) matching tickLower ${tickLower}, tickUpper ${tickUpper}, liquidity ${liquidity}. It should have been created by CLPool event handlers.`,
      );
      return;
    }

    const tokenId = position.tokenId;

    // Fetching LP tokens supply from TotalSupplyLimitUpdated event
    const totalSupplyEvent =
      await context.ALM_TotalSupplyLimitUpdated_event.get(
        ALMLPWrapperId(event.chainId, lpWrapper),
      );

    if (
      !totalSupplyEvent ||
      totalSupplyEvent.transactionHash !== event.transaction.hash
    ) {
      context.log.error(
        `[ALMDeployFactoryV2] ALM_TotalSupplyLimitUpdated_event not found for lpWrapper ${lpWrapper} and chainId ${event.chainId} or transaction hash ${event.transaction.hash} does not match. It should have been created by ALMLPWrapper event handlers.`,
      );
      return;
    }

    const currentTotalSupplyLPTokens =
      totalSupplyEvent.currentTotalSupplyLPTokens;

    // Create ALM_LP_Wrapper (single entity tracks both wrapper and strategy)
    // amount0/amount1 are derived at snapshot time from liquidity + sqrtPriceX96 + ticks
    context.ALM_LP_Wrapper.set({
      id: ALMLPWrapperId(event.chainId, lpWrapper),
      chainId: event.chainId,
      pool: pool,
      token0: token0,
      token1: token1,

      lpAmount: currentTotalSupplyLPTokens,
      lastUpdatedTimestamp: timestamp,

      tokenId: tokenId,
      tickLower: tickLower,
      tickUpper: tickUpper,
      property: property,
      liquidity: liquidity,
      strategyType: strategyType,
      tickNeighborhood: tickNeighborhood,
      tickSpacing: tickSpacing,
      positionWidth: width,
      maxLiquidityRatioDeviationX96: maxLiquidityRatioDeviationX96,
      creationTimestamp: timestamp,
      strategyTransactionHash: event.transaction.hash,
      lastSnapshotTimestamp: undefined,
    });
  },
);
