// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {ProofDependencyMocks} from "./ProofDependencyMocks.sol";

contract BatchPaymentToken is ERC20 {
    uint256 public transfers;
    uint256 public burns;

    constructor() ERC20("PROTO", "PROTO") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        ++transfers;
        return super.transferFrom(from, to, amount);
    }

    function burn(uint256 amount) external {
        ++burns;
        _burn(msg.sender, amount);
    }
}

contract BatchWrapper is ProofDependencyMocks {
    uint256 public constant BASE_PRICE = 0.0001 ether;
    uint256 public nextId;
    uint256 public priceStep;
    uint256 public failAt;
    uint256 public duplicateAt;
    bool public reenter;
    bool public reentryRefused;
    mapping(uint256 => address) public consumers;
    mapping(uint256 => uint32) public limits;

    function configure(uint256 step, uint256 fail, uint256 duplicate, bool enter) external {
        priceStep = step;
        failAt = fail;
        duplicateAt = duplicate;
        reenter = enter;
    }

    function estimateRequestPriceNative(uint32, uint32, uint256) external pure returns (uint256) {
        return BASE_PRICE;
    }

    function calculateRequestPriceNative(uint32, uint32) external view returns (uint256) {
        return BASE_PRICE + priceStep * nextId;
    }

    function requestRandomWordsInNative(uint32 gasLimit, uint16, uint32, bytes calldata)
        external
        payable
        returns (uint256 id)
    {
        require(msg.value == BASE_PRICE + priceStep * nextId, "wrong wrapper payment");
        id = ++nextId;
        require(id != failAt, "wrapper rejected later request");
        if (reenter) {
            (bool ok,) = msg.sender.call(abi.encodeCall(BoosterPacks.openPacks, (1, 1, 0, block.timestamp)));
            require(!ok, "wrapper reentered");
            reentryRefused = true;
        }
        if (id == duplicateAt) return 1;
        consumers[id] = msg.sender;
        limits[id] = gasLimit;
    }

    function fulfill(uint256 id, uint256 seed) external {
        uint256[] memory words = new uint256[](1);
        words[0] = seed;
        (bool ok,) = consumers[id].call{gas: limits[id]}(
            abi.encodeCall(BoosterPacks.rawFulfillRandomWords, (id, words))
        );
        require(ok, "callback failed");
    }
}

contract BatchWallet {
    uint256 public refundCalls;
    bool private reject;
    bool private reenter;

    constructor(bool reject_, bool reenter_) {
        reject = reject_;
        reenter = reenter_;
    }

    function buy(BoosterPacks engine, BatchPaymentToken token, uint256 pack, uint32 count)
        external
        payable
        returns (uint256[] memory, uint256[] memory)
    {
        token.approve(address(engine), type(uint256).max);
        return engine.openPacks{value: msg.value}(pack, count, msg.value, block.timestamp);
    }

    function withdraw(BoosterPacks engine, address payable recipient) external {
        engine.withdrawRefund(recipient);
    }

    receive() external payable {
        require(!reject, "reject refund");
        if (reenter) {
            (bool ok,) = msg.sender.call(abi.encodeCall(BoosterPacks.openPacks, (1, 1, 0, block.timestamp)));
            require(!ok, "refund reentered");
        }
        ++refundCalls;
    }
}

contract BoosterMultiPackTest is Test {
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    PackRegistry private registry;
    YunipalMonsters private monsters;
    BoosterPacks private engine;
    BatchPaymentToken private token;
    BatchWrapper private wrapper;
    uint256 private packId;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
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
        token = new BatchPaymentToken();
        wrapper = new BatchWrapper();
        engine = deployEngine(address(new BoosterPacks()));
        packId = createPack(address(engine), 0);
        token.mint(ALICE, 100 ether);
        vm.deal(ALICE, 20 ether);
        vm.prank(ALICE);
        token.approve(address(engine), type(uint256).max);
    }

    function deployEngine(address implementation) private returns (BoosterPacks) {
        return BoosterPacks(
            address(
                new ERC1967Proxy(
                    implementation,
                    abi.encodeCall(
                        BoosterPacks.initialize,
                        (address(this), registry, monsters, IVRFV2PlusWrapper(address(wrapper)))
                    )
                )
            )
        );
    }

    function createPack(address consumer, uint64 cap) private returns (uint256 id) {
        PackRegistry.Rules memory rules = PackRegistry.Rules(
            consumer,
            address(token),
            1 ether,
            1 days,
            1,
            7,
            450_000,
            250_000,
            3,
            cap,
            keccak256("batch-art"),
            "ipfs://catalog",
            "ipfs://variants/"
        );
        PackRegistry.Catalog memory catalog;
        catalog.types = new uint32[](2);
        catalog.types[0] = 2;
        catalog.types[1] = 7;
        catalog.colors = new uint32[](2);
        catalog.colors[1] = 9;
        catalog.horns = new uint32[](2);
        catalog.horns[1] = 6;
        catalog.glitters = new uint32[](2);
        catalog.glitters[1] = 1;
        id = registry.configureType(0, rules, catalog);
        registry.activate(id);
    }

    function buy(uint32 count, uint256 value, uint256 budget)
        private
        returns (uint256[] memory requests_, uint256[] memory originals_)
    {
        vm.prank(ALICE);
        return engine.openPacks{value: value}(packId, count, budget, block.timestamp);
    }

    function assertRolledBack(uint256 id, uint256 balance, uint256 supply, uint256 nextToken) private view {
        assertEq(token.balanceOf(ALICE), balance);
        assertEq(token.totalSupply(), supply);
        assertEq(token.balanceOf(address(engine)), 0);
        assertEq(registry.getPack(id).openings, 0);
        assertEq(monsters.nextTokenId(), nextToken);
        assertEq(wrapper.nextId(), 0);
        assertEq(address(wrapper).balance, 0);
        assertEq(address(engine).balance, 0);
        assertEq(token.burns(), 0);
        assertEq(token.transfers(), 0);
    }

    function testAggregateBurnIndependentRequestsAndSingleRefund() public {
        BatchWallet wallet = new BatchWallet(false, false);
        token.mint(address(wallet), 3 ether);
        vm.recordLogs();
        (uint256[] memory ids, uint256[] memory originals_) =
            wallet.buy{value: 1 ether}(engine, token, packId, 3);
        assertEq(ids.length, 3);
        assertEq(originals_.length, 3);
        assertEq(token.totalSupply(), 100 ether);
        assertEq(token.balanceOf(address(wallet)), 0);
        assertEq(token.burns(), 1);
        assertEq(token.transfers(), 1);
        assertEq(wallet.refundCalls(), 1);
        assertEq(address(wallet).balance, 1 ether - 3 * wrapper.BASE_PRICE());
        assertEq(address(wrapper).balance, 3 * wrapper.BASE_PRICE());
        assertEq(address(engine).balance, 0);
        uint256 burnedEvents;
        for (uint256 i; i < 3; ++i) {
            assertEq(ids[i], i + 1);
            assertEq(originals_[i], i + 1);
            BoosterPacks.Request memory request = engine.getRequest(ids[i]);
            assertEq(request.originalId, originals_[i]);
            assertEq(request.quantity, 1);
            assertTrue(request.opening);
            assertEq(request.payer, address(wallet));
            assertEq(request.paid, wrapper.BASE_PRICE());
            assertEq(engine.getOriginal(originals_[i]).pendingRequest, ids[i]);
            assertEq(engine.proofContext(ids[i]).requestBlock, block.number);
            assertEq(engine.proofContext(ids[i]).coordinator, address(wrapper));
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(engine)
                    && logs[i].topics[0] == keccak256("PaymentBurned(uint256,address,address,uint256)")
            ) {
                ++burnedEvents;
                (address paidToken, uint256 amount) = abi.decode(logs[i].data, (address, uint256));
                assertEq(paidToken, address(token));
                assertEq(amount, 1 ether);
            }
        }
        assertEq(burnedEvents, 3);
    }

    function testQuotesUseOneOriginalCallbackPerPackAndCountBounds() public {
        (uint256 price, uint32 callbackGas) = engine.quoteOpenPacks(packId, 10, 1 gwei);
        assertEq(price, 10 * wrapper.BASE_PRICE());
        assertEq(callbackGas, 700_000);
        (uint256 singlePrice, uint32 singleGas) = engine.quote(packId, 1, 1 gwei);
        assertEq(price, singlePrice * 10);
        assertEq(callbackGas, singleGas);
        assertEq(engine.MAX_OPEN_PACKS(), 10);
        vm.expectRevert(bytes("invalid batch size"));
        engine.quoteOpenPacks(packId, 0, 1 gwei);
        vm.expectRevert(bytes("invalid batch size"));
        engine.quoteOpenPacks(packId, 11, 1 gwei);
        vm.expectRevert(bytes("invalid batch size"));
        buy(0, 1 ether, 1 ether);
        vm.expectRevert(bytes("invalid batch size"));
        buy(11, 1 ether, 1 ether);
    }

    function testTotalVrfCapAndMsgValueAreEachAggregateBudgets() public {
        uint256 total = 3 * wrapper.BASE_PRICE();
        vm.expectRevert(bytes("VRF price exceeds budget"));
        buy(3, 1 ether, total - 1);
        assertRolledBack(packId, 100 ether, 100 ether, 1);
        vm.expectRevert(bytes("VRF price exceeds budget"));
        buy(3, total - 1, 1 ether);
        assertRolledBack(packId, 100 ether, 100 ether, 1);
        buy(3, total, total);
        assertEq(address(engine).balance, 0);
        assertEq(engine.totalRefundLiability(), 0);
    }

    function testEachActualChangingWrapperPriceIsChargedWithinTotalCap() public {
        wrapper.configure(wrapper.BASE_PRICE(), 0, 0, false);
        uint256 total = 6 * wrapper.BASE_PRICE();
        vm.expectRevert(bytes("VRF price exceeds budget"));
        buy(3, 1 ether, total - 1);
        assertRolledBack(packId, 100 ether, 100 ether, 1);
        (uint256[] memory ids,) = buy(3, 1 ether, total);
        for (uint256 i; i < 3; ++i) {
            assertEq(engine.getRequest(ids[i]).paid, (i + 1) * wrapper.BASE_PRICE());
        }
        assertEq(address(wrapper).balance, 6 * wrapper.BASE_PRICE());
    }

    function testLaterWrapperFailureAndDuplicateIdRollbackEntirePurchase() public {
        wrapper.configure(0, 3, 0, false);
        vm.expectRevert(bytes("wrapper rejected later request"));
        buy(3, 1 ether, 1 ether);
        assertRolledBack(packId, 100 ether, 100 ether, 1);
        wrapper.configure(0, 0, 3, false);
        vm.expectRevert(bytes("invalid request id"));
        buy(3, 1 ether, 1 ether);
        assertRolledBack(packId, 100 ether, 100 ether, 1);
    }

    function testSupplyExhaustionRollsBackAllReservationsAndBurns() public {
        uint256 capped = createPack(address(engine), 2);
        vm.prank(ALICE);
        vm.expectRevert(bytes("sold out"));
        engine.openPacks{value: 1 ether}(capped, 3, 1 ether, block.timestamp);
        assertRolledBack(capped, 100 ether, 100 ether, 1);
        vm.prank(ALICE);
        engine.openPacks{value: 1 ether}(capped, 2, 1 ether, block.timestamp);
        assertEq(registry.getPack(capped).openings, 2);
    }

    function testBurnAndTransferAccountingCannotUseUnsupportedToken() public {
        vm.mockCall(address(token), abi.encodeCall(token.totalSupply, ()), abi.encode(100 ether));
        vm.expectRevert(bytes("burn accounting mismatch"));
        buy(3, 1 ether, 1 ether);
        vm.clearMockedCalls();
        assertRolledBack(packId, 100 ether, 100 ether, 1);
        vm.prank(ALICE);
        token.approve(address(engine), 2 ether);
        vm.expectRevert();
        buy(3, 1 ether, 1 ether);
        assertRolledBack(packId, 100 ether, 100 ether, 1);
    }

    function testRejectedAggregateRefundStaysFullyBackedAcrossOtherPurchases() public {
        BatchWallet wallet = new BatchWallet(true, false);
        token.mint(address(wallet), 3 ether);
        wallet.buy{value: 1 ether}(engine, token, packId, 3);
        uint256 credit = 1 ether - 3 * wrapper.BASE_PRICE();
        assertEq(engine.refundCredits(address(wallet)), credit);
        assertEq(engine.totalRefundLiability(), credit);
        assertEq(address(engine).balance, credit);
        vm.expectRevert(bytes("VRF price exceeds budget"));
        buy(2, 0, 1 ether);
        assertEq(engine.refundCredits(address(wallet)), credit);
        buy(2, 1 ether, 1 ether);
        assertEq(address(engine).balance, credit);
        wallet.withdraw(engine, payable(BOB));
        assertEq(BOB.balance, credit);
        assertEq(engine.totalRefundLiability(), 0);
        assertEq(engine.refundCredits(address(wallet)), 0);
        assertEq(address(engine).balance, 0);
    }

    function testWrapperAndRefundCallbacksCannotReenterPurchases() public {
        wrapper.configure(0, 0, 0, true);
        buy(2, 1 ether, 1 ether);
        assertTrue(wrapper.reentryRefused());
        assertEq(wrapper.nextId(), 2);
        assertEq(registry.getPack(packId).openings, 2);
        BatchWallet wallet = new BatchWallet(false, true);
        token.mint(address(wallet), 2 ether);
        wallet.buy{value: 1 ether}(engine, token, packId, 2);
        // If a wallet exceeds the bounded refund gas, the unchanged credit path
        // remains solvent; either way no nested purchase can be committed.
        assertEq(wrapper.nextId(), 4);
        assertEq(registry.getPack(packId).openings, 4);
        assertEq(engine.totalRefundLiability(), engine.refundCredits(address(wallet)));
        assertEq(address(engine).balance, engine.totalRefundLiability());
    }

    function testIndependentOutOfOrderClocksClaimsTransferBurnAndSavedSeedRecovery() public {
        (uint256[] memory ids, uint256[] memory originals_) = buy(3, 1 ether, 1 ether);
        wrapper.fulfill(ids[2], 33);
        uint256 firstReveal = vm.getBlockTimestamp();
        vm.warp(firstReveal + 1 days);
        vm.mockCallRevert(
            address(registry), abi.encodeWithSelector(PackRegistry.traitsFor.selector), "mint failed"
        );
        wrapper.fulfill(ids[0], 11);
        assertEq(uint256(engine.getRequest(ids[0]).status), uint256(BoosterPacks.Status.Seeded));
        assertEq(uint256(engine.getRequest(ids[1]).status), uint256(BoosterPacks.Status.Pending));
        vm.clearMockedCalls();
        engine.recover(ids[0]);
        wrapper.fulfill(ids[1], 22);
        assertEq(engine.getOriginal(originals_[2]).revealedAt, firstReveal);
        assertEq(engine.getOriginal(originals_[0]).revealedAt, firstReveal + 1 days);
        assertEq(engine.claimable(originals_[2]), 1);
        assertEq(engine.claimable(originals_[0]), 0);
        vm.warp(firstReveal + 2 days);
        vm.prank(ALICE);
        monsters.transferFrom(ALICE, BOB, originals_[1]);
        vm.prank(ALICE);
        uint256 a = engine.claim{value: 1 ether}(originals_[0], 1, 1 ether, block.timestamp);
        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        uint256 b = engine.claim{value: 1 ether}(originals_[1], 1, 1 ether, block.timestamp);
        vm.prank(ALICE);
        monsters.burn(originals_[2]);
        wrapper.fulfill(b, 0);
        wrapper.fulfill(a, 0);
        assertEq(monsters.balanceOf(BOB), 2);
        assertEq(monsters.balanceOf(ALICE), 2);
        assertEq(engine.getOriginal(originals_[0]).minted, 2);
        assertEq(engine.getOriginal(originals_[1]).minted, 2);
        assertEq(engine.claimable(originals_[2]), 0);
        wrapper.fulfill(ids[0], 999);
        assertEq(engine.getRequest(ids[0]).seed, 11);
    }

    function testPausesDeadlineAndInvalidTypePreserveSinglePackBehavior() public {
        registry.pauseSales(packId, true);
        vm.expectRevert(bytes("sales unavailable"));
        buy(2, 1 ether, 1 ether);
        registry.pauseSales(packId, false);
        engine.pauseRequests(true);
        vm.expectRevert(bytes("requests paused or expired"));
        buy(2, 1 ether, 1 ether);
        engine.pauseRequests(false);
        vm.prank(ALICE);
        vm.expectRevert(bytes("requests paused or expired"));
        engine.openPacks{value: 1 ether}(packId, 2, 1 ether, block.timestamp - 1);
        vm.prank(ALICE);
        vm.expectRevert(bytes("invalid engine"));
        engine.openPacks{value: 1 ether}(999, 2, 1 ether, block.timestamp);
        assertRolledBack(packId, 100 ether, 100 ether, 1);
        vm.prank(ALICE);
        (uint256 requestId, uint256 originalId) =
            engine.openPack{value: 1 ether}(packId, 1 ether, block.timestamp);
        wrapper.fulfill(requestId, 0);
        assertEq(monsters.ownerOf(originalId), ALICE);
    }

    function testExactLegacyProxyUpgradePreservesPendingRightsPoolsAndRefunds() public {
        bytes memory creation =
            vm.parseJsonBytes(vm.readFile("test/fixtures/BoosterPacks.pre-batch.json"), ".creationBytecode");
        assertEq(keccak256(creation), 0x898335551f9b0a949b0e4ab235105e22ff9d283df3908e4c8da40f2b8c0e11d3);
        address implementation;
        assembly { implementation := create(0, add(creation, 32), mload(creation)) }
        require(implementation != address(0), "old implementation deployment failed");
        BoosterPacks old = deployEngine(implementation);
        uint256 legacyPack = createPack(address(old), 0);
        vm.prank(ALICE);
        token.approve(address(old), type(uint256).max);
        vm.prank(ALICE);
        (uint256 opening, uint256 originalId) =
            old.openPack{value: 1 ether}(legacyPack, 1 ether, block.timestamp);
        wrapper.fulfill(opening, 17);
        (,, uint32 firstVariant,,) = monsters.provenance(originalId);
        vm.warp(block.timestamp + 3 days);
        vm.prank(ALICE);
        uint256 pending = old.claim{value: 1 ether}(originalId, 2, 1 ether, block.timestamp);
        BatchWallet rejecting = new BatchWallet(true, false);
        token.mint(address(rejecting), 1 ether);
        // The old engine has only openPack; use this direct legacy wallet call.
        vm.prank(address(rejecting));
        token.approve(address(old), 1 ether);
        vm.deal(address(rejecting), 1 ether);
        vm.prank(address(rejecting));
        (uint256 reserved,) = old.openPack{value: 1 ether}(legacyPack, 1 ether, block.timestamp);
        old.pauseRequests(true);
        bytes32 originalBefore = keccak256(abi.encode(old.getOriginal(originalId)));
        bytes32 pendingBefore = keccak256(abi.encode(old.getRequest(pending)));
        bytes32 proofBefore = keccak256(abi.encode(old.proofContext(pending)));
        uint256 liability = old.totalRefundLiability();
        bytes32[49] memory slots;
        for (uint256 i; i < 49; ++i) {
            slots[i] = vm.load(address(old), bytes32(i));
        }
        old.upgradeToAndCall(address(new BoosterPacks()), "");
        for (uint256 i; i < 49; ++i) {
            assertEq(vm.load(address(old), bytes32(i)), slots[i]);
        }
        assertEq(keccak256(abi.encode(old.getOriginal(originalId))), originalBefore);
        assertEq(keccak256(abi.encode(old.getRequest(pending))), pendingBefore);
        assertEq(keccak256(abi.encode(old.proofContext(pending))), proofBefore);
        assertEq(old.totalRefundLiability(), liability);
        assertEq(old.refundCredits(address(rejecting)), liability);
        assertTrue(old.requestsPaused());
        assertEq(old.MAX_OPEN_PACKS(), 10);
        wrapper.fulfill(pending, 42);
        wrapper.fulfill(reserved, 19);
        assertEq(old.getOriginal(originalId).minted, 3);
        for (uint256 tokenId = originalId + 2; tokenId < monsters.nextTokenId(); ++tokenId) {
            (uint256 p, uint256 parent, uint32 variant,, bool original_) = monsters.provenance(tokenId);
            if (p == legacyPack && parent == originalId && !original_) assertTrue(variant != firstVariant);
        }
        rejecting.withdraw(old, payable(BOB));
        assertEq(old.totalRefundLiability(), 0);
        old.pauseRequests(false);
        vm.prank(ALICE);
        old.openPacks{value: 1 ether}(legacyPack, 2, 1 ether, block.timestamp);
        assertEq(registry.getPack(legacyPack).openings, 4);
    }

    function testMaximumPurchaseGasAndDeployedSize() public {
        uint256 before = gasleft();
        (uint256[] memory ids, uint256[] memory originals_) = buy(10, 1 ether, 1 ether);
        uint256 used = before - gasleft();
        emit log_named_uint("ten-original purchase local mock gas", used);
        emit log_named_uint("batch engine runtime bytes", address(new BoosterPacks()).code.length);
        assertEq(ids.length, 10);
        assertEq(originals_.length, 10);
        assertLt(used, 8_000_000);
        assertLe(address(new BoosterPacks()).code.length, 24_576);
    }

    function testFuzzAggregatePaidAndCount(uint8 rawCount, uint96 rawExcess) public {
        uint32 count = uint32(bound(rawCount, 1, 10));
        uint256 exact = uint256(count) * wrapper.BASE_PRICE();
        uint256 excess = bound(rawExcess, 0, 1 ether);
        uint256 balance = ALICE.balance;
        buy(count, exact + excess, exact);
        assertEq(ALICE.balance, balance - exact);
        assertEq(token.balanceOf(ALICE), (100 - uint256(count)) * 1 ether);
        assertEq(address(engine).balance, 0);
        assertEq(engine.totalRefundLiability(), 0);
        assertEq(registry.getPack(packId).openings, count);
    }
}
