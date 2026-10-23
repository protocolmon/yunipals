// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "boosters-src/PackRegistry.sol";
import {YunipalMonsters} from "boosters-src/YunipalMonsters.sol";
import {BoosterPacks} from "boosters-src/BoosterPacks.sol";

interface IYPAL is IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function owner() external view returns (address);
    function isLocked() external view returns (bool);
    function pmon() external view returns (address);
    function burnAddress() external view returns (address);
    function wrap(uint256 amount) external;
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address owner) external view returns (uint256);
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract YPALBoosterForkTest is Test {
    address private constant PMON = 0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7;
    address private constant DESTINATION = 0xff2Ba07e6F84D22730eD78D1117735a4B041c6EF;
    address private constant CREATOR = 0xB3883Cd96d72B08b8226452305A28D65974a3727;

    function testPinnedBasePMONAndFreshYPALPermitBatch() public {
        exercise(false);
    }

    function testPinnedBaseConsumedYPALPermitStillPurchasesFromExactAllowance() public {
        exercise(true);
    }

    function exercise(bool consumed) private {
        string memory rpc = vm.envOr("YPAL_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 pinned = vm.envUint("YPAL_FORK_BLOCK");
        vm.createSelectFork(rpc, pinned);
        assertEq(block.chainid, 8453);
        bytes memory init =
            abi.encodePacked(vm.getCode("out/YPAL.sol/YPAL.json"), abi.encode(PMON, DESTINATION));
        address deployed;
        vm.prank(CREATOR);
        assembly ("memory-safe") { deployed := create(0, add(init, 32), mload(init)) }
        assertTrue(deployed != address(0));
        IYPAL token = IYPAL(deployed);
        assertEq(token.owner(), CREATOR);
        assertEq(token.name(), "Yunipals");
        assertEq(token.symbol(), "YPAL");
        assertEq(token.pmon(), PMON);
        assertEq(token.burnAddress(), DESTINATION);
        assertFalse(token.isLocked());
        assertEq(token.totalSupply(), 0);
        uint256 key = 0xA11CE;
        address payer = vm.addr(key);
        deal(PMON, payer, 3 ether);
        vm.deal(payer, 10 ether);
        vm.startPrank(payer);
        IERC20(PMON).approve(deployed, 3 ether);
        token.wrap(3 ether);
        vm.stopPrank();
        PackRegistry registry = PackRegistry(
            address(
                new ERC1967Proxy(
                    address(new PackRegistry()), abi.encodeCall(PackRegistry.initialize, (address(this)))
                )
            )
        );
        YunipalMonsters monsters = YunipalMonsters(
            address(
                new ERC1967Proxy(
                    address(new YunipalMonsters()),
                    abi.encodeCall(YunipalMonsters.initialize, (address(this), registry))
                )
            )
        );
        IVRFV2PlusWrapper wrapper = IVRFV2PlusWrapper(0xb0407dbe851f8318bd31404A49e658143C982F23);
        BoosterPacks engine = BoosterPacks(
            address(
                new ERC1967Proxy(
                    address(new BoosterPacks()),
                    abi.encodeCall(BoosterPacks.initialize, (address(this), registry, monsters, wrapper))
                )
            )
        );
        assertEq(engine.PERMIT_OPEN_VERSION(), 1);
        assertEq(engine.MAX_OPEN_PACKS(), 10);
        PackRegistry.Catalog memory catalog;
        catalog.types = new uint32[](11);
        catalog.colors = new uint32[](4);
        catalog.horns = new uint32[](2);
        catalog.glitters = new uint32[](3);
        for (uint32 i; i < 11; ++i) {
            catalog.types[i] = i;
        }
        for (uint32 i; i < 4; ++i) {
            catalog.colors[i] = i;
        }
        for (uint32 i; i < 2; ++i) {
            catalog.horns[i] = i;
        }
        for (uint32 i; i < 3; ++i) {
            catalog.glitters[i] = i;
        }
        uint256 packId = registry.configureType(
            0,
            PackRegistry.Rules(
                address(engine),
                deployed,
                1 ether,
                86400,
                1,
                7,
                450000,
                250000,
                3,
                0,
                keccak256("local fork catalog fixture"),
                "https://fixture.invalid/manifest.json",
                "https://fixture.invalid/"
            ),
            catalog
        );
        assertEq(packId, 1);
        assertEq(registry.typeCount(), 1);
        registry.activate(packId);
        assertEq(registry.getPack(packId).totalVariants, 264);
        uint256 backing = IERC20(PMON).balanceOf(deployed);
        uint256 destination = IERC20(PMON).balanceOf(DESTINATION);
        uint256 pmonSupply = IERC20(PMON).totalSupply();
        uint256 deadline = block.timestamp + 600;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256(
                            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                        ),
                        payer,
                        address(engine),
                        3 ether,
                        token.nonces(payer),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        if (consumed) token.permit(payer, address(engine), 3 ether, deadline, v, r, s);
        vm.txGasPrice(1 gwei);
        (uint256 fee,) = engine.quoteOpenPacks(packId, 3, 1 gwei);
        vm.recordLogs();
        vm.prank(payer);
        engine.openPacksWithPermit{value: fee}(packId, 3, fee, deadline, v, r, s);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic =
            keccak256("RequestCreated(uint256,uint256,uint256,address,uint32,bool,uint256,bytes32,uint32)");
        uint256 requests;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(engine) || logs[i].topics[0] != topic) continue;
            uint256 requestId = uint256(logs[i].topics[1]);
            uint256 originalId = uint256(logs[i].topics[2]);
            assertEq(uint256(logs[i].topics[3]), packId);
            assertEq(engine.getRequest(requestId).payer, payer);
            assertEq(engine.getRequest(requestId).quantity, 1);
            assertEq(engine.proofContext(requestId).requestBlock, pinned);
            uint256[] memory words = new uint256[](1);
            words[0] = requests + 1;
            // Synthetic callback only; actual wrapper/coordinator state and fees are used above.
            vm.prank(address(wrapper));
            engine.rawFulfillRandomWords(requestId, words);
            assertEq(monsters.ownerOf(originalId), payer);
            ++requests;
        }
        assertEq(requests, 3);
        assertEq(token.nonces(payer), 1);
        assertEq(token.allowance(payer, address(engine)), 0);
        assertEq(token.balanceOf(payer), 0);
        assertEq(token.totalSupply(), 0);
        assertEq(IERC20(PMON).balanceOf(deployed), backing - 3 ether);
        assertEq(IERC20(PMON).balanceOf(DESTINATION), destination + 3 ether);
        assertEq(IERC20(PMON).totalSupply(), pmonSupply);
        emit log_named_uint("pinned Base block", pinned);
        emit log_named_uint("actual wrapper aggregate quote wei", fee);
    }
}
