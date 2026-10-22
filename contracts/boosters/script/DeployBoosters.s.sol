// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";

contract DeployBoosters is Script {
    function run() external {
        require(block.chainid == 8453 || block.chainid == 84532, "Base only");
        address admin = vm.envAddress("BOOSTER_ADMIN");
        address wrapper = vm.envAddress("BOOSTER_WRAPPER");
        require(admin != address(0) && wrapper.code.length > 0, "missing deployment inputs");
        vm.startBroadcast();
        PackRegistry registry = PackRegistry(
            address(
                new ERC1967Proxy(
                    address(new PackRegistry()), abi.encodeCall(PackRegistry.initialize, (admin))
                )
            )
        );
        YunipalMonsters monsters = YunipalMonsters(
            address(
                new ERC1967Proxy(
                    address(new YunipalMonsters()),
                    abi.encodeCall(YunipalMonsters.initialize, (admin, registry))
                )
            )
        );
        BoosterPacks engine = BoosterPacks(
            address(
                new ERC1967Proxy(
                    address(new BoosterPacks()),
                    abi.encodeCall(
                        BoosterPacks.initialize, (admin, registry, monsters, IVRFV2PlusWrapper(wrapper))
                    )
                )
            )
        );
        vm.stopBroadcast();
        console2.log("BOOSTER_REGISTRY", address(registry));
        console2.log("BOOSTER_MONSTERS", address(monsters));
        console2.log("BOOSTER_ENGINE", address(engine));
        // No catalog is registered or activated. Sales remain unavailable.
    }
}
