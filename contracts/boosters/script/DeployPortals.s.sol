// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {PortalRules} from "../src/PortalRules.sol";
import {PortalCollection} from "../src/PortalCollection.sol";
import {PortalRegistry} from "../src/PortalRegistry.sol";
import {PortalGrading} from "../src/PortalGrading.sol";
import {PortalGradingCompetition} from "../src/PortalGradingCompetition.sol";
import {PortalCompetitionReceiver} from "../src/PortalCompetitionReceiver.sol";

/// @notice Simulates unless the operator explicitly supplies --broadcast.
/// Run with the permit/release profile so the existing engine stays within EIP-170.
contract DeployPortals is Script {
    function run()
        external
        returns (
            PortalCollection collection,
            PortalRegistry registry,
            PortalGrading grading,
            PortalGradingCompetition competition
        )
    {
        address admin = vm.envAddress("PORTALS_ADMIN");
        YunipalMonsters cards = YunipalMonsters(vm.envAddress("PORTALS_CARDS_ADDRESS"));
        IVRFV2PlusWrapper wrapper = IVRFV2PlusWrapper(vm.envAddress("PORTALS_VRF_WRAPPER"));
        IERC20 usdc = IERC20(vm.envAddress("PORTALS_USDC_ADDRESS"));
        uint256 pack = vm.envUint("PORTALS_PACK_TYPE_ID");
        require(
            block.chainid == 8453 || block.chainid == 84532 || block.chainid == 31337, "unsupported chain"
        );
        require(admin != address(0), "zero admin");
        vm.startBroadcast();
        PortalRules rules = new PortalRules();
        collection = PortalCollection(
            address(
                new ERC1967Proxy(
                    address(new PortalCollection()),
                    abi.encodeCall(PortalCollection.initialize, (admin, wrapper, uint16(3), rules))
                )
            )
        );
        registry = PortalRegistry(
            address(
                new ERC1967Proxy(
                    address(new PortalRegistry()),
                    abi.encodeCall(PortalRegistry.initialize, (admin, collection, wrapper, uint16(3)))
                )
            )
        );
        grading = PortalGrading(
            address(
                new ERC1967Proxy(
                    address(new PortalGrading()),
                    abi.encodeCall(
                        PortalGrading.initialize,
                        (admin, cards, registry, usdc, pack, vm.envString("PORTALS_METADATA_BASE_URI"))
                    )
                )
            )
        );
        competition = PortalGradingCompetition(
            address(
                new ERC1967Proxy(
                    address(new PortalGradingCompetition()),
                    abi.encodeCall(PortalGradingCompetition.initialize, (admin, address(grading), usdc))
                )
            )
        );
        // The final admin binds claim and competition authority with the unsigned setup calls.
        // Paid admission rejects until that one-time binding is complete.
        require(
            collection.claimController() == address(0) && grading.portalEconomicsVersion() == 2,
            "unexpected portal economics"
        );
        vm.stopBroadcast();
    }

    function deployCompetitionReceiver() external returns (PortalCompetitionReceiver receiver) {
        require(
            block.chainid == 8453 || block.chainid == 84532 || block.chainid == 31337, "unsupported chain"
        );
        vm.startBroadcast();
        receiver = new PortalCompetitionReceiver(
            PortalGradingCompetition(vm.envAddress("PORTALS_COMPETITION_ADDRESS")),
            vm.envAddress("PORTALS_CRE_FORWARDER"),
            vm.envAddress("PORTALS_CRE_WORKFLOW_OWNER"),
            bytes10(vm.envBytes32("PORTALS_CRE_WORKFLOW_NAME"))
        );
        vm.stopBroadcast();
    }

    function deployCardUpgradeImplementations()
        external
        returns (YunipalMonsters cards, BoosterPacks engine)
    {
        vm.startBroadcast();
        cards = new YunipalMonsters();
        engine = new BoosterPacks();
        vm.stopBroadcast();
    }
}
