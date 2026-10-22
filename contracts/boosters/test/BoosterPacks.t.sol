// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ProofDependencyMocks} from "./ProofDependencyMocks.sol";
import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {VariantDraw} from "../src/VariantDraw.sol";

contract MockProto is ERC20 {
    constructor() ERC20("PROTO", "PROTO") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

contract MockWrapper is ProofDependencyMocks {
    uint256 public constant PRICE = 0.0001 ether;
    uint256 public nextId;
    bool public reject;
    uint256 public lastGasUsed;
    mapping(uint256 => address) public consumers;
    mapping(uint256 => uint32) public limits;
    event CallbackGas(uint256 gasUsed, uint32 gasLimit);

    function setReject(bool value) external {
        reject = value;
    }

    function estimateRequestPriceNative(uint32, uint32, uint256) external pure returns (uint256) {
        return PRICE;
    }

    function calculateRequestPriceNative(uint32, uint32) external pure returns (uint256) {
        return PRICE;
    }

    function requestRandomWordsInNative(uint32 gasLimit, uint16, uint32, bytes calldata)
        external
        payable
        returns (uint256 id)
    {
        require(!reject && msg.value == PRICE, "request failed");
        id = ++nextId;
        consumers[id] = msg.sender;
        limits[id] = gasLimit;
    }

    function fulfill(uint256 id, uint256 word) external {
        require(gasleft() > uint256(limits[id]) + 50_000, "not enough callback gas");
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        uint256 beforeGas = gasleft();
        (bool ok,) = consumers[id].call{gas: limits[id]}(
            abi.encodeCall(BoosterPacks.rawFulfillRandomWords, (id, words))
        );
        lastGasUsed = beforeGas - gasleft();
        emit CallbackGas(lastGasUsed, limits[id]);
        require(ok, "outer callback failed");
    }
}

contract RejectRefund {
    function buy(BoosterPacks engine, MockProto token, uint256 id)
        external
        payable
        returns (uint256 originalId)
    {
        token.approve(address(engine), 1 ether);
        (, originalId) = engine.openPack{value: msg.value}(id, 1 ether, block.timestamp);
    }

    function withdraw(BoosterPacks engine, address payable to) external {
        engine.withdrawRefund(to);
    }
}

contract EngineV2 is BoosterPacks {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract CollectionV2 is YunipalMonsters {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract RegistryV2 is PackRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract DrawHarness {
    using VariantDraw for mapping(uint32 => uint32);
    mapping(uint32 => uint32) private pool;

    function draw(uint32 remaining, bytes32 entropy) external returns (uint32) {
        return pool.draw(remaining, entropy);
    }
}

contract BoosterPacksTest is Test {
    PackRegistry registry;
    YunipalMonsters monsters;
    BoosterPacks engine;
    MockProto proto;
    MockWrapper wrapper;
    address alice = address(0xa11ce);
    address bob = address(0xb0b);
    uint256 packId;

    function setUp() public {
        vm.warp(1_000_000);
        registry = PackRegistry(
            address(
                new ERC1967Proxy(
                    address(new PackRegistry()), abi.encodeCall(PackRegistry.initialize, (address(this)))
                )
            )
        );
        monsters = YunipalMonsters(
            address(
                new ERC1967Proxy(
                    address(new YunipalMonsters()),
                    abi.encodeCall(YunipalMonsters.initialize, (address(this), registry))
                )
            )
        );
        wrapper = new MockWrapper();
        proto = new MockProto();
        engine = BoosterPacks(
            address(
                new ERC1967Proxy(
                    address(new BoosterPacks()),
                    abi.encodeCall(
                        BoosterPacks.initialize,
                        (address(this), registry, monsters, IVRFV2PlusWrapper(address(wrapper)))
                    )
                )
            )
        );
        packId = registry.configureType(0, rules(), catalog());
        registry.activate(packId);
        proto.mint(alice, 100 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        proto.approve(address(engine), type(uint256).max);
    }

    function rules() internal view returns (PackRegistry.Rules memory) {
        return PackRegistry.Rules(
            address(engine),
            address(proto),
            1 ether,
            1 days,
            1,
            7,
            450_000,
            250_000,
            3,
            0,
            keccak256("artwork"),
            "ipfs://catalog",
            "ipfs://variants/"
        );
    }

    function catalog() internal pure returns (PackRegistry.Catalog memory c) {
        c.types = new uint32[](2);
        c.types[0] = 2;
        c.types[1] = 7;
        c.colors = new uint32[](2);
        c.colors[1] = 9;
        c.horns = new uint32[](2);
        c.horns[1] = 6;
        c.glitters = new uint32[](2);
        c.glitters[1] = 1;
        c.allowed = new uint32[](0); // 16 variants
    }

    function buy() internal returns (uint256 requestId, uint256 originalId) {
        vm.prank(alice);
        return engine.openPack{value: 0.001 ether}(packId, 0.001 ether, block.timestamp);
    }

    function reveal() internal returns (uint256 id) {
        (uint256 requestId, uint256 originalId) = buy();
        wrapper.fulfill(requestId, 0);
        assertEq(uint256(engine.getRequest(requestId).status), uint256(BoosterPacks.Status.Completed));
        return originalId;
    }

    function requestClaim(uint256 id, uint32 quantity, address owner) internal returns (uint256 requestId) {
        vm.prank(owner);
        return engine.claim{value: 0.001 ether}(id, quantity, 0.001 ether, block.timestamp);
    }

    function testBurnAndRequestTimeChangeAndZeroWord() public {
        uint256 balance = alice.balance;
        (uint256 r, uint256 id) = buy();
        assertEq(proto.totalSupply(), 99 ether);
        assertEq(proto.balanceOf(address(engine)), 0);
        assertEq(alice.balance, balance - wrapper.PRICE());
        assertEq(address(engine).balance, 0);
        wrapper.fulfill(r, 0);
        assertEq(monsters.ownerOf(id), alice);
        assertEq(engine.getOriginal(id).revealedAt, block.timestamp);
        assertEq(engine.getOriginal(id).remaining, 15);
        wrapper.fulfill(r, 123); // duplicate callback ignored
        assertEq(monsters.nextTokenId(), 2);
    }

    function testAtomicRollbackIfWrapperFailsOrQuoteTooHigh() public {
        wrapper.setReject(true);
        vm.prank(alice);
        vm.expectRevert();
        engine.openPack{value: 1 ether}(packId, 1 ether, block.timestamp);
        assertEq(proto.balanceOf(alice), 100 ether);
        assertEq(monsters.nextTokenId(), 1);
        wrapper.setReject(false);
        vm.prank(alice);
        vm.expectRevert();
        engine.openPack{value: 1 ether}(packId, 0, block.timestamp);
        assertEq(proto.totalSupply(), 100 ether);
        assertEq(registry.getPack(packId).openings, 0);
    }

    function testAccrualFractionalDaysReservationAndTransferPending() public {
        uint256 id = reveal();
        uint256 start = vm.getBlockTimestamp();
        vm.warp(start + 3 days + 12 hours);
        assertEq(engine.claimable(id), 3);
        uint256 r = requestClaim(id, 3, alice);
        assertEq(engine.claimable(id), 0);
        vm.prank(alice);
        vm.expectRevert();
        engine.claim{value: 1 ether}(id, 1, 1 ether, block.timestamp);
        vm.prank(alice);
        monsters.transferFrom(alice, bob, id);
        wrapper.fulfill(r, 7);
        assertEq(monsters.balanceOf(bob), 4);
        assertEq(monsters.balanceOf(alice), 0);
        vm.warp(start + 4 days);
        assertEq(engine.claimable(id), 1);
        assertEq(engine.claimable(id + 1), 0); // offspring have no rights
    }

    function testBurnForfeitsPendingAndFutureRightsKeepsOffspring() public {
        uint256 id = reveal();
        vm.warp(block.timestamp + 2 days);
        uint256 r = requestClaim(id, 1, alice);
        wrapper.fulfill(r, 3);
        uint256 pending = requestClaim(id, 1, alice);
        vm.prank(alice);
        monsters.burn(id);
        wrapper.fulfill(pending, 5);
        assertEq(uint256(engine.getRequest(pending).status), uint256(BoosterPacks.Status.Forfeited));
        assertTrue(engine.getRequest(pending).received);
        assertEq(engine.claimable(id), 0);
        assertEq(monsters.balanceOf(alice), 1);
        assertEq(monsters.ownerOf(2), alice);
        vm.prank(alice);
        monsters.burn(2);
        assertEq(engine.claimable(id), 0);
    }

    function testStoredSeedRecoveryAndBurnBeforeRecovery() public {
        (uint256 r, uint256 id) = buy();
        vm.mockCallRevert(
            address(registry), abi.encodeWithSelector(PackRegistry.traitsFor.selector), "broken renderer"
        );
        wrapper.fulfill(r, 42);
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Seeded));
        assertEq(engine.getOriginal(id).minted, 0);
        uint64 revealedAt = engine.getOriginal(id).revealedAt;
        vm.clearMockedCalls();
        vm.warp(block.timestamp + 2 days);
        engine.recover(r);
        assertEq(engine.getOriginal(id).revealedAt, revealedAt);
        assertEq(engine.claimable(id), 2);
        uint256 pending = requestClaim(id, 2, alice);
        vm.mockCallRevert(
            address(registry), abi.encodeWithSelector(PackRegistry.traitsFor.selector), "mint fails"
        );
        wrapper.fulfill(pending, 8);
        vm.clearMockedCalls();
        assertEq(engine.getOriginal(id).minted, 1); // no partial draws or mints
        vm.prank(alice);
        monsters.burn(id);
        vm.expectRevert();
        engine.recover(pending);
        assertEq(engine.getRequest(pending).seed, 8);
    }

    function testWorstBatchAndCompleteCollectionNoDuplicates() public {
        uint256 id = reveal();
        vm.warp(block.timestamp + 30 days);
        uint256 r = requestClaim(id, 7, alice);
        wrapper.fulfill(r, 1);
        assertEq(engine.getOriginal(id).minted, 8);
        r = requestClaim(id, 7, alice);
        wrapper.fulfill(r, 2);
        assertEq(engine.getOriginal(id).minted, 15);
        r = requestClaim(id, 1, alice);
        wrapper.fulfill(r, 3);
        assertEq(engine.claimable(id), 0);
        assertEq(engine.getOriginal(id).remaining, 0);
        bool[] memory seen = new bool[](16);
        for (uint256 tokenId = 1; tokenId <= 16; ++tokenId) {
            (,, uint32 variantId,,) = monsters.provenance(tokenId);
            assertFalse(seen[variantId]);
            seen[variantId] = true;
        }
        vm.prank(alice);
        monsters.burn(2);
        assertEq(engine.claimable(id), 0);
    }

    function testIndependentOriginalsOutOfOrderCallbacks() public {
        (uint256 a, uint256 originalA) = buy();
        (uint256 b, uint256 originalB) = buy();
        wrapper.fulfill(b, 0);
        wrapper.fulfill(a, 0);
        assertEq(monsters.ownerOf(originalA), alice);
        assertEq(monsters.ownerOf(originalB), alice);
        vm.warp(block.timestamp + 1 days);
        uint256 ca = requestClaim(originalA, 1, alice);
        uint256 cb = requestClaim(originalB, 1, alice);
        wrapper.fulfill(cb, 0);
        wrapper.fulfill(ca, 0);
        assertEq(engine.getOriginal(originalA).minted, 2);
        assertEq(engine.getOriginal(originalB).minted, 2);
    }

    function testRefundRejectingWalletAndWithdraw() public {
        RejectRefund wallet = new RejectRefund();
        proto.mint(address(wallet), 1 ether);
        wallet.buy{value: 0.001 ether}(engine, proto, packId);
        uint256 expected = 0.001 ether - wrapper.PRICE();
        assertEq(engine.refundCredits(address(wallet)), expected);
        assertEq(engine.totalRefundLiability(), expected);
        uint256 beforeBalance = bob.balance;
        wallet.withdraw(engine, payable(bob));
        assertEq(bob.balance, beforeBalance + expected);
        assertEq(engine.totalRefundLiability(), 0);
    }

    function testFrozenRegistryBalancedSubsetAndNewTypeRules() public {
        vm.expectRevert();
        registry.configureType(packId, rules(), catalog());
        PackRegistry.Catalog memory c = catalog();
        c.allowed = new uint32[](2);
        c.allowed[1] = 15;
        PackRegistry.Rules memory r = rules();
        r.intervalSeconds = 2 days;
        r.mintsPerInterval = 2;
        uint256 second = registry.configureType(0, r, c);
        registry.activate(second);
        assertEq(registry.getPack(second).totalVariants, 2);
        c.allowed[1] = 1;
        uint256 bad = registry.configureType(0, rules(), c);
        vm.expectRevert();
        registry.activate(bad);
        c = catalog();
        c.types = new uint32[](0);
        uint256 empty = registry.configureType(0, rules(), c);
        vm.expectRevert();
        registry.activate(empty);
    }

    function testNewPackDifferentPriceRateAndSupplyIntoSameCollection() public {
        PackRegistry.Rules memory r = rules();
        r.price = 2 ether;
        r.intervalSeconds = 2 days;
        r.mintsPerInterval = 3;
        r.supplyCap = 1;
        uint256 second = registry.configureType(0, r, catalog());
        registry.activate(second);
        vm.prank(alice);
        (uint256 requestId, uint256 id) =
            engine.openPack{value: 0.001 ether}(second, 0.001 ether, block.timestamp);
        assertEq(proto.balanceOf(alice), 98 ether);
        wrapper.fulfill(requestId, 8);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        assertEq(engine.claimable(id), 3);
        vm.prank(alice);
        vm.expectRevert();
        engine.openPack{value: 0.001 ether}(second, 0.001 ether, block.timestamp);
        requestId = requestClaim(id, 3, alice);
        wrapper.fulfill(requestId, 9);
        assertEq(monsters.balanceOf(alice), 4);
        (uint256 nftType,,,,) = monsters.provenance(id);
        assertEq(nftType, second);
    }

    function testPausedSalesAllowExistingClaimsAndRecoveries() public {
        uint256 id = reveal();
        registry.pauseSales(packId, true);
        vm.prank(alice);
        vm.expectRevert();
        engine.openPack{value: 1 ether}(packId, 1 ether, block.timestamp);
        vm.warp(block.timestamp + 1 days);
        uint256 r = requestClaim(id, 1, alice);
        engine.pauseRequests(true);
        wrapper.fulfill(r, 0);
        assertEq(engine.getOriginal(id).minted, 2);
    }

    function testUpgradePreservesPendingRightsAndProvenance() public {
        uint256 id = reveal();
        vm.warp(block.timestamp + 3 days);
        uint256 r = requestClaim(id, 3, alice);
        engine.upgradeToAndCall(address(new EngineV2()), "");
        registry.upgradeToAndCall(address(new RegistryV2()), "");
        monsters.upgradeToAndCall(address(new CollectionV2()), "");
        assertEq(EngineV2(address(engine)).version(), 2);
        assertEq(monsters.ownerOf(id), alice);
        assertEq(engine.getRequest(r).quantity, 3);
        wrapper.fulfill(r, 9);
        assertEq(engine.getOriginal(id).minted, 4);
        assertEq(registry.getPack(packId).totalVariants, 16);
    }

    function testUnauthorizedCallbacksMintsUpgradesAndInitializers() public {
        uint256[] memory words = new uint256[](1);
        vm.expectRevert();
        engine.rawFulfillRandomWords(1, words);
        vm.expectRevert();
        monsters.reserveOriginal(packId);
        address upgraded = address(new EngineV2());
        vm.prank(alice);
        vm.expectRevert();
        engine.upgradeToAndCall(upgraded, "");
        vm.expectRevert();
        engine.initialize(address(this), registry, monsters, IVRFV2PlusWrapper(address(wrapper)));
        BoosterPacks impl = new BoosterPacks();
        vm.expectRevert();
        impl.initialize(address(this), registry, monsters, IVRFV2PlusWrapper(address(wrapper)));
    }

    function testFuzzSparseDrawCompletesPermutation(uint256 seed, uint8 count) public {
        uint32 n = uint32(bound(count, 1, 64));
        DrawHarness h = new DrawHarness();
        bool[] memory seen = new bool[](n);
        for (uint32 left = n; left > 0; --left) {
            uint32 value = h.draw(left, keccak256(abi.encode(seed, left)));
            assertLt(value, n);
            assertFalse(seen[value]);
            seen[value] = true;
        }
    }

    function _coolCallbackStorage() internal {
        address[3] memory targets = [address(registry), address(monsters), address(engine)];
        for (uint256 i; i < targets.length; ++i) {
            (bytes32[] memory reads, bytes32[] memory writes) = vm.accesses(targets[i]);
            for (uint256 j; j < reads.length; ++j) {
                vm.coolSlot(targets[i], reads[j]);
            }
            for (uint256 j; j < writes.length; ++j) {
                vm.coolSlot(targets[i], writes[j]);
            }
            vm.cool(targets[i]);
            vm.cool(
                address(
                    uint160(
                        uint256(
                            vm.load(
                                targets[i], 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
                            )
                        )
                    )
                )
            );
        }
    }

    function testColdCallbackGasEnvelope() public {
        vm.record();
        (uint256 r, uint256 id) = buy();
        _coolCallbackStorage();
        wrapper.fulfill(r, 42);
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Completed));
        emit log_named_uint("cold opening callback gas", wrapper.lastGasUsed());
        vm.warp(vm.getBlockTimestamp() + 10 days);
        vm.record();
        r = requestClaim(id, 7, alice);
        _coolCallbackStorage();
        wrapper.fulfill(r, 43);
        assertEq(engine.getOriginal(id).minted, 8);
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Completed));
        emit log_named_uint("cold seven-mint callback gas", wrapper.lastGasUsed());
        assertLt(wrapper.lastGasUsed(), wrapper.limits(r));
    }
}
