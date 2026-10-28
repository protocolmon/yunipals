// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {BoosterEthPayment} from "../src/BoosterEthPayment.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";

contract BoosterEthPaymentForkTest is Test {
    BoosterPacks constant ENGINE = BoosterPacks(address(bytes20(hex"df4aaa47fe0e8208b5a33c74898f834b2952189e")));
    address constant OWNER = address(bytes20(hex"b3883cd96d72b08b8226452305a28d65974a3727"));
    address constant YPAL = address(bytes20(hex"cd3709e84fc817b46196fa2d5b7202710ab51346"));
    address constant PROTO = address(bytes20(hex"e5a54a517cde8ed48a336b173044b1138aa2c1a3"));
    address constant WETH = address(bytes20(hex"4200000000000000000000000000000000000006"));
    address constant V2 = address(bytes20(hex"4752ba5dbc23f44d87826276bf6fd6b1c372ad24"));
    address constant V3 = address(bytes20(hex"2626664c2603336e57b271c5c0b26f421741e481"));
    address constant BUYER = address(0xb0b);

    function testBaseForkBothRoutesOneThreeFiveTenAndReveal() public {
        string memory rpc = vm.envOr("BASE_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        uint256 snapshot = vm.snapshotState();
        uint32[4] memory counts = [uint32(1), 3, 5, 10];
        for (uint8 route; route < 2; ++route) {
            for (uint256 k; k < counts.length; ++k) {
                assertTrue(vm.revertToState(snapshot));
                snapshot = vm.snapshotState();
                bytes32 original = keccak256(abi.encode(ENGINE.getOriginal(1)));
                bytes32[49] memory slots;
                for (uint256 i; i < 49; ++i) {
                    slots[i] = vm.load(address(ENGINE), bytes32(i));
                }
                address implementation = address(new BoosterPacks());
                vm.prank(OWNER);
                ENGINE.upgradeToAndCall(implementation, "");
                for (uint256 i; i < 49; ++i) {
                    assertEq(vm.load(address(ENGINE), bytes32(i)), slots[i]);
                }
                assertEq(keccak256(abi.encode(ENGINE.getOriginal(1))), original);
                BoosterEthPayment adapter = new BoosterEthPayment(ENGINE, YPAL, PROTO, WETH, V2, V3);
                vm.prank(OWNER);
                ENGINE.grantRole(keccak256("PAYMENT_ADAPTER_ROLE"), address(adapter));
                vm.deal(BUYER, 1 ether);
                uint256 beforeSupply = IERC20(YPAL).totalSupply();
                vm.prank(BUYER);
                (uint256[] memory requests, uint256[] memory originals) = adapter.openPacks{value: 0.011 ether}(
                    1, counts[k], route, 0.001 ether, 0.01 ether, block.timestamp + 600
                );
                assertEq(IERC20(YPAL).totalSupply(), beforeSupply);
                assertEq(address(adapter).balance, 0);
                for (uint256 i; i < requests.length; ++i) {
                    assertEq(ENGINE.getRequest(requests[i]).payer, BUYER);
                    uint256[] memory words = new uint256[](1);
                    words[0] = 100 + i;
                    // Local fork only: authenticated callback simulation, not a new oracle proof.
                    vm.prank(address(ENGINE.wrapper()));
                    ENGINE.rawFulfillRandomWords(requests[i], words);
                    assertEq(uint8(ENGINE.getRequest(requests[i]).status), uint8(BoosterPacks.Status.Completed));
                    assertEq(ENGINE.monsters().ownerOf(originals[i]), BUYER);
                }
                emit log_named_uint(route == 0 ? "PMON pack count" : "PROTO pack count", counts[k]);
            }
        }
    }
}
