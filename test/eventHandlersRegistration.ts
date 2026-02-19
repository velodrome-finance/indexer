/**
 * Event handler registration for tests that use processEvent().
 * Every test file that calls mockDb.processEvents() must import this module at the top.
 * Envio's processEvent() requires the full config (all handlers) to be registered.
 */
import "../src/EventHandlers/FactoryRegistry";
import "../src/EventHandlers/PoolFactory";
import "../src/EventHandlers/RootCLPoolFactory";
import "../src/EventHandlers/CLFactory";
import "../src/EventHandlers/CLPool";
import "../src/EventHandlers/NFPM/NFPM";
import "../src/EventHandlers/VeNFT/VeNFT";
import "../src/EventHandlers/Pool";
import "../src/EventHandlers/Voter/Voter";
import "../src/EventHandlers/Voter/SuperchainLeafVoter";
import "../src/EventHandlers/VotingReward/FeesVotingReward";
import "../src/EventHandlers/VotingReward/BribesVotingReward";
import "../src/EventHandlers/VotingReward/SuperchainIncentiveVotingReward";
import "../src/EventHandlers/CLGaugeFactory/NewCLGaugeFactory";
import "../src/EventHandlers/Gauges/CLGauge";
import "../src/EventHandlers/Gauges/Gauge";
import "../src/EventHandlers/ALM/DeployFactoryV2";
import "../src/EventHandlers/ALM/DeployFactoryV1";
import "../src/EventHandlers/ALM/Core";
import "../src/EventHandlers/ALM/LPWrapperV2";
import "../src/EventHandlers/ALM/LPWrapperV1";
import "../src/EventHandlers/SwapFeeModule/DynamicSwapFeeModule";
import "../src/EventHandlers/SwapFeeModule/CustomSwapFeeModule";
import "../src/EventHandlers/PoolLauncher/CLPoolLauncher";
import "../src/EventHandlers/PoolLauncher/V2PoolLauncher";
import "../src/EventHandlers/SuperswapsHyperlane/VelodromeUniversalRouter";
import "../src/EventHandlers/SuperswapsHyperlane/Mailbox";
