// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";

interface IProtoLive is IERC20 {
    function pmon() external view returns (address);
    function burnAddress() external view returns (address);
    function wrap(uint256 amount) external;
}

contract ProtoForkTest is Test {
    /// @dev Opt-in, read-only remote fork. All writes occur in local fork memory.
    function testPinnedBaseProtoBurnAndWrapperRequest() public {
        string memory rpc = vm.envOr("BOOSTER_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 blockNumber = vm.envUint("BOOSTER_FORK_BLOCK");
        vm.createSelectFork(rpc, blockNumber);
        IProtoLive proto = IProtoLive(0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3);
        IVRFV2PlusWrapper wrapper = IVRFV2PlusWrapper(0xb0407dbe851f8318bd31404A49e658143C982F23);
        IERC20 pmon = IERC20(proto.pmon());
        address payer = address(0xa11ce);
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
        vm.startPrank(payer);
        proto.approve(address(engine), 1 ether);
        (uint256 requestId, uint256 originalId) = engine.openPack{value: fee}(packId, fee, block.timestamp);
        vm.stopPrank();
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
