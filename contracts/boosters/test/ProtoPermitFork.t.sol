// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";

interface IProtoPermitLive is IERC20 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function nonces(address owner) external view returns (uint256);
    function pmon() external view returns (address);
    function burnAddress() external view returns (address);
    function wrap(uint256 amount) external;
}

contract ProtoPermitForkTest is Test {
    /// @dev Opt-in, read-only remote fork. All writes occur in local fork memory.
    function testPinnedBaseRealProtoPermitBurnAndWrapperRequest() public {
        string memory rpc = vm.envOr("BOOSTER_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 blockNumber = vm.envUint("BOOSTER_FORK_BLOCK");
        vm.createSelectFork(rpc, blockNumber);
        IProtoPermitLive proto = IProtoPermitLive(0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3);
        IVRFV2PlusWrapper wrapper = IVRFV2PlusWrapper(0xb0407dbe851f8318bd31404A49e658143C982F23);
        IERC20 pmon = IERC20(proto.pmon());
        uint256 payerKey = 0xA11CE; // Synthetic local-fork account, never broadcast.
        address payer = vm.addr(payerKey);
        deal(address(pmon), payer, 1 ether);
        vm.deal(payer, 1 ether);
        vm.startPrank(payer);
        pmon.approve(address(proto), 1 ether);
        proto.wrap(1 ether);
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
        BoosterPacks engine = BoosterPacks(
            address(
                new ERC1967Proxy(
                    address(new BoosterPacks()),
                    abi.encodeCall(BoosterPacks.initialize, (address(this), registry, monsters, wrapper))
                )
            )
        );
        PackRegistry.Catalog memory c;
        c.types = new uint32[](1);
        c.colors = new uint32[](1);
        c.horns = new uint32[](1);
        c.glitters = new uint32[](1);
        uint256 packId = registry.configureType(
            0,
            PackRegistry.Rules(
                address(engine),
                address(proto),
                1 ether,
                86400,
                1,
                7,
                450000,
                250000,
                3,
                0,
                keccak256("test-only artwork"),
                "ipfs://test-only",
                "ipfs://test-only/"
            ),
            c
        );
        registry.activate(packId);
        uint256 supply = proto.totalSupply();
        uint256 destinationBalance = pmon.balanceOf(proto.burnAddress());
        uint256 pmonSupply = pmon.totalSupply();
        vm.txGasPrice(1 gwei);
        (uint256 fee,) = engine.quote(packId, 1, 1 gwei);
        assertEq(proto.allowance(payer, address(engine)), 0);
        uint256 nonceBefore = proto.nonces(payer);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                proto.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256(
                            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                        ),
                        payer,
                        address(engine),
                        1 ether,
                        nonceBefore,
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        vm.recordLogs();
        vm.prank(payer);
        engine.openPacksWithPermit{value: fee}(packId, 1, fee, deadline, v, r, s);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 createdTopic =
            keccak256("RequestCreated(uint256,uint256,uint256,address,uint32,bool,uint256,bytes32,uint32)");
        uint256 requestId;
        uint256 originalId;
        uint256 matched;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].emitter == address(engine) && entries[i].topics[0] == createdTopic) {
                assertEq(entries[i].topics.length, 4);
                requestId = uint256(entries[i].topics[1]);
                originalId = uint256(entries[i].topics[2]);
                assertEq(uint256(entries[i].topics[3]), packId);
                ++matched;
            }
        }
        assertEq(matched, 1);
        assertEq(proto.nonces(payer), nonceBefore + 1);
        assertEq(proto.allowance(payer, address(engine)), 0);
        assertEq(engine.getRequest(requestId).payer, payer);
        assertEq(proto.balanceOf(payer), 0);
        assertEq(proto.totalSupply(), supply - 1 ether);
        assertEq(pmon.balanceOf(proto.burnAddress()), destinationBalance + 1 ether);
        assertEq(pmon.totalSupply(), pmonSupply);
        assertEq(engine.getRequest(requestId).paid, fee);
        assertEq(engine.proofContext(requestId).requestBlock, blockNumber);
        assertEq(engine.proofContext(requestId).chainId, 8453);
        assertEq(engine.proofContext(requestId).coordinator, 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634);
        assertEq(engine.proofContext(requestId).blockhashStore, 0x78b69899C8cD252126cBB1A50171ec37286C3877);
        uint256[] memory words = new uint256[](1);
        vm.prank(address(wrapper));
        engine.rawFulfillRandomWords(requestId, words);
        assertEq(monsters.ownerOf(originalId), payer);
        emit log_named_uint("verified Base fork block", blockNumber);
        emit log_named_uint("wrapper quote wei", fee);
    }
}
