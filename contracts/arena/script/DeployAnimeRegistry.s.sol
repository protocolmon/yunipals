// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {AnimeFighterRegistry} from "../src/AnimeFighterRegistry.sol";

contract DeployAnimeRegistry is Script {
    function run() external returns (AnimeFighterRegistry registry) {
        require(block.chainid == 8453, "Base mainnet only");
        address admin = vm.envAddress("ARENA_ADMIN");
        require(admin == vm.envAddress("ARENA_DEPLOYER"), "Admin must be selected wallet");
        vm.startBroadcast(admin);
        registry = new AnimeFighterRegistry(admin, admin, "https://assets-anime.yunipals.com/fighters/v1/");
        vm.stopBroadcast();
        require(!registry.applicationsOpen(), "Applications unexpectedly open");
        console2.log("Anime registry deployed closed", address(registry));
    }
}
