// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {YunipalsArena} from "../src/YunipalsArena.sol";

/// @notice All settings are public. Wallet secrets come from Foundry's encrypted keystore.
/// No broadcasts unless the operator explicitly passes --broadcast. Entries start paused.
contract DeployArena is Script {
    using SafeCast for uint256;

    address constant WRAPPER = 0xb0407dbe851f8318bd31404A49e658143C982F23;
    address constant ISLANDS = 0x79b68a12a2952a9A8d0Cc4D0b3Fb00252C41d168;

    function run() external returns (YunipalsArena arena) {
        require(block.chainid == 8453, "Base mainnet only");
        require(WRAPPER.code.length > 0 && ISLANDS.code.length > 0, "Missing Base deployments");
        address deployer = vm.envAddress("ARENA_DEPLOYER");
        require(deployer != address(0), "Deployer required");
        // No economic defaults: the deployment must use the user's agreed values.
        YunipalsArena.Config memory c = YunipalsArena.Config({
            admin: vm.envAddress("ARENA_ADMIN"),
            lobbyOperator: vm.envAddress("ARENA_LOBBY_OPERATOR"),
            admissionSigner: vm.envAddress("ARENA_ADMISSION_SIGNER"),
            referee: vm.envAddress("ARENA_REFEREE"),
            treasury: deployer,
            islands: ISLANDS,
            vrfWrapper: WRAPPER,
            paymentToken: vm.envAddress("ARENA_PAYMENT_TOKEN"),
            entryFee: vm.envUint("ARENA_ENTRY_FEE_RAW").toUint128(),
            winnerBps: vm.envUint("ARENA_WINNER_BPS").toUint16(),
            islandBps: vm.envUint("ARENA_ISLAND_BPS").toUint16(),
            joinWindow: vm.envUint("ARENA_JOIN_WINDOW_SECONDS").toUint32(),
            strategyWindow: vm.envUint("ARENA_STRATEGY_WINDOW_SECONDS").toUint32(),
            resolutionWindow: vm.envUint("ARENA_RESOLUTION_WINDOW_SECONDS").toUint32(),
            maxVrfCost: vm.envUint("ARENA_MAX_VRF_COST_WEI").toUint128(),
            rulesHash: vm.envBytes32("ARENA_RULES_SHA256")
        });
        require(c.admin == deployer, "Pilot admin must be the selected deployment wallet");
        require(c.paymentToken == 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, "Base native USDC required");
        require(c.entryFee == 2_000_000 && c.winnerBps == 7500 && c.islandBps == 500, "Unapproved economics");
        require(c.joinWindow == 7 days && c.strategyWindow == 24 hours, "Unapproved entry/strategy windows");
        require(c.resolutionWindow == 24 hours, "Unapproved referee window");
        console2.log("Chain: Base mainnet (8453)");
        console2.log("Deployer/admin", deployer);
        console2.log("Payment token (zero = ETH)", c.paymentToken);
        console2.log("Entry fee in raw units", c.entryFee);
        console2.log("Winner bps", c.winnerBps);
        console2.log("Island owner bps", c.islandBps);
        console2.log("Treasury", c.treasury);
        console2.log("Admission signer", c.admissionSigner);
        console2.log("Lobby operator", c.lobbyOperator);
        console2.log("Referee", c.referee);
        console2.log("Rules SHA-256");
        console2.logBytes32(c.rulesHash);
        vm.startBroadcast(deployer);
        arena = new YunipalsArena(c);
        vm.stopBroadcast();
        require(arena.entriesPaused(), "Deployment unexpectedly opened paid entries");
        console2.log("Arena deployed paused", address(arena));
        console2.log("Pool SHA-256");
        console2.logBytes32(arena.poolHash());
    }
}
