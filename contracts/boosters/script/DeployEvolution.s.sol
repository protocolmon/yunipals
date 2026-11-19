// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {PortalGrading} from "../src/PortalGrading.sol";
import {PortalRules} from "../src/PortalRules.sol";
import {SerumCatalogue} from "../src/SerumCatalogue.sol";
import {YunipalAdventures} from "../src/YunipalAdventures.sol";
import {YunipalEvolution} from "../src/YunipalEvolution.sol";

/// @notice Simulation by default. Binding and upgrades are separate reviewed administrator calls.
contract DeployEvolution is Script {
    function run()
        external
        returns (SerumCatalogue catalogue, YunipalAdventures adventures, YunipalEvolution evolution)
    {
        require(block.chainid == 8453 || block.chainid == 84532 || block.chainid == 31337, "unsupported chain");
        address admin = vm.envAddress("EVOLUTION_ADMIN");
        YunipalMonsters cards = YunipalMonsters(vm.envAddress("PORTALS_CARDS_ADDRESS"));
        IVRFV2PlusWrapper wrapper = IVRFV2PlusWrapper(vm.envAddress("PORTALS_VRF_WRAPPER"));
        require(admin != address(0), "zero admin");
        vm.startBroadcast();
        PortalRules rules = new PortalRules();
        catalogue = new SerumCatalogue();
        adventures = YunipalAdventures(
            address(
                new ERC1967Proxy(
                    address(new YunipalAdventures()),
                    abi.encodeCall(YunipalAdventures.initialize, (admin, cards, catalogue, wrapper, uint16(3), rules))
                )
            )
        );
        evolution = YunipalEvolution(
            address(
                new ERC1967Proxy(
                    address(new YunipalEvolution()),
                    abi.encodeCall(
                        YunipalEvolution.initialize,
                        (
                            admin,
                            cards,
                            adventures,
                            IERC20(vm.envAddress("PORTALS_USDC_ADDRESS")),
                            vm.envAddress("PORTALS_AI_RECIPIENT"),
                            vm.envBytes32("EVOLUTION_RENDERING_POLICY"),
                            wrapper,
                            uint16(3),
                            rules
                        )
                    )
                )
            )
        );
        // Requests remain unavailable until the reviewed card controller binding is made.
        vm.stopBroadcast();
    }

    function deployUpgradeImplementations()
        external
        returns (YunipalMonsters cards, BoosterPacks engine, PortalGrading grading)
    {
        require(block.chainid == 8453 || block.chainid == 84532 || block.chainid == 31337, "unsupported chain");
        vm.startBroadcast();
        cards = new YunipalMonsters();
        engine = new BoosterPacks();
        grading = new PortalGrading();
        vm.stopBroadcast();
    }
}
