// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {BoosterEthPayment, IExactOutputV3} from "../src/BoosterEthPayment.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BatchWrapper, BatchPaymentToken} from "./BoosterMultiPack.t.sol";

contract BackedPaymentToken is ERC20 {
    BatchPaymentToken public immutable pmon;

    constructor(BatchPaymentToken p) ERC20("Wrapper", "WRAP") {
        pmon = p;
    }

    function wrap(uint256 amount) external {
        pmon.transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function unwrap(uint256 amount) external {
        _burn(msg.sender, amount);
        pmon.transfer(msg.sender, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        pmon.transfer(address(0xdead), amount);
    }
}

contract ExactOutputRouterMock is IExactOutputV3 {
    BatchPaymentToken public pmon;
    BackedPaymentToken public proto;
    uint256 public price = 0.001 ether;
    bool public shortOutput;

    constructor(BatchPaymentToken p, BackedPaymentToken pr) {
        pmon = p;
        proto = pr;
    }
    receive() external payable {}

    function setShortOutput(bool value) external {
        shortOutput = value;
    }

    function swapETHForExactTokens(uint256 out, address[] calldata, address recipient, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts)
    {
        require(block.timestamp <= deadline && msg.value >= price, "swap limit");
        proto.transfer(recipient, shortOutput ? out - 1 : out);
        amounts = new uint256[](2);
        amounts[0] = price;
        amounts[1] = out;
        (bool ok,) = msg.sender.call{value: msg.value - price}("");
        require(ok);
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256) {
        require(params.amountInMaximum >= price && msg.value >= price, "swap limit");
        pmon.transfer(params.recipient, shortOutput ? params.amountOut - 1 : params.amountOut);
        return price;
    }

    function refundETH() external payable {
        // Retain the swap's price, as a real router transfers it to the pool.
        uint256 refund = address(this).balance - price;
        (bool ok,) = msg.sender.call{value: refund}("");
        require(ok);
    }
}

contract RejectingEthBuyer {
    function buy(BoosterEthPayment adapter, uint256 pack, uint8 route) external payable {
        adapter.openPacks{value: msg.value}(pack, 1, route, 0.01 ether, 0.01 ether, block.timestamp);
    }

    function withdraw(BoosterEthPayment adapter, BoosterPacks engine, address payable recipient) external {
        adapter.withdrawRefund(recipient);
        engine.withdrawRefund(recipient);
    }

    receive() external payable {
        revert("no refund");
    }
}

contract BoosterEthPaymentTest is Test {
    BoosterPacks internal engine;
    PackRegistry internal registry;
    YunipalMonsters internal monsters;
    BatchWrapper internal wrapper;
    BatchPaymentToken internal pmon;
    BackedPaymentToken internal proto;
    BackedPaymentToken internal ypal;
    ExactOutputRouterMock internal router;
    BoosterEthPayment internal adapter;
    uint256 internal packId;
    address internal constant BUYER = address(0xb0b);

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        vm.deal(BUYER, 100 ether);
        registry = PackRegistry(
            address(
                new ERC1967Proxy(address(new PackRegistry()), abi.encodeCall(PackRegistry.initialize, (address(this))))
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
        wrapper = new BatchWrapper();
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
        pmon = new BatchPaymentToken();
        proto = new BackedPaymentToken(pmon);
        ypal = new BackedPaymentToken(pmon);
        router = new ExactOutputRouterMock(pmon, proto);
        pmon.mint(address(router), 1000 ether);
        pmon.mint(address(this), 1000 ether);
        pmon.approve(address(proto), 1000 ether);
        proto.wrap(1000 ether);
        proto.transfer(address(router), 1000 ether);
        adapter = new BoosterEthPayment(
            engine, address(ypal), address(proto), address(pmon), address(router), address(router)
        );
        engine.grantRole(engine.PAYMENT_ADAPTER_ROLE(), address(adapter));
        PackRegistry.Rules memory rules = PackRegistry.Rules(
            address(engine),
            address(ypal),
            1 ether,
            1 days,
            1,
            7,
            450_000,
            250_000,
            3,
            0,
            keccak256("art"),
            "ipfs://catalog",
            "ipfs://variants/"
        );
        PackRegistry.Catalog memory catalog;
        catalog.types = new uint32[](11);
        for (uint32 i; i < 11; ++i) {
            catalog.types[i] = i;
        }
        catalog.colors = new uint32[](6);
        for (uint32 i; i < 6; ++i) {
            catalog.colors[i] = i;
        }
        catalog.horns = new uint32[](2);
        catalog.horns[1] = 1;
        catalog.glitters = new uint32[](2);
        catalog.glitters[1] = 1;
        packId = registry.configureType(0, rules, catalog);
        registry.activate(packId);
    }

    function buy(uint8 route, uint32 count) internal returns (uint256[] memory ids, uint256[] memory originals) {
        vm.prank(BUYER);
        return adapter.openPacks{value: 0.02 ether}(packId, count, route, 0.01 ether, 0.01 ether, block.timestamp);
    }

    function testFuzzBothRoutesExactBurnBuyerAndRefund(uint8 route, uint8 rawCount) public {
        route = uint8(bound(route, 0, 1));
        uint32 count = uint32(bound(rawCount, 1, 10));
        uint256 before = BUYER.balance;
        (uint256[] memory ids, uint256[] memory originals) = buy(route, count);
        assertEq(BUYER.balance, before - router.price() - count * wrapper.BASE_PRICE());
        assertEq(ypal.totalSupply(), 0);
        assertEq(pmon.balanceOf(address(ypal)), 0);
        assertEq(pmon.balanceOf(address(0xdead)), count * 1 ether);
        assertEq(address(adapter).balance, 0);
        assertEq(address(engine).balance, 0);
        assertEq(ypal.allowance(address(adapter), address(engine)), 0);
        assertEq(pmon.allowance(address(adapter), address(ypal)), 0);
        assertEq(pmon.balanceOf(address(adapter)), 0);
        assertEq(proto.balanceOf(address(adapter)), 0);
        for (uint256 i; i < count; ++i) {
            assertEq(engine.getRequest(ids[i]).payer, BUYER);
            wrapper.fulfill(ids[i], i + 20);
            assertEq(monsters.ownerOf(originals[i]), BUYER);
        }
        vm.warp(block.timestamp + 1 days);
        vm.prank(BUYER);
        uint256 daily = engine.claim{value: 0.01 ether}(originals[0], 1, 0.01 ether, block.timestamp);
        wrapper.fulfill(daily, 21);
        assertEq(engine.getOriginal(originals[0]).minted, 2);
    }

    function testUnauthorizedForwardingCannotSetBuyer() public {
        vm.prank(BUYER);
        vm.expectRevert();
        engine.openPacksFor(BUYER, packId, 1, 0, block.timestamp);
        engine.revokeRole(engine.PAYMENT_ADAPTER_ROLE(), address(adapter));
        vm.expectRevert();
        buy(0, 1);
        assertEq(registry.getPack(packId).openings, 0);
    }

    function testRejectedRefundsAreOwnedByBuyerAndWithdrawable() public {
        RejectingEthBuyer buyer = new RejectingEthBuyer();
        buyer.buy{value: 0.02 ether}(adapter, packId, 1);
        uint256 a = adapter.refundCredits(address(buyer));
        uint256 e = engine.refundCredits(address(buyer));
        assertEq(a, 0.01 ether - router.price());
        assertEq(e, 0.01 ether - wrapper.BASE_PRICE());
        assertEq(adapter.refundCredits(address(adapter)), 0);
        // Another buyer cannot receive either the rejected refund or its backing.
        buy(1, 2);
        assertEq(adapter.refundCredits(address(buyer)), a);
        assertEq(engine.refundCredits(address(buyer)), e);
        assertEq(address(adapter).balance, a);
        assertEq(address(engine).balance, e);
        buyer.withdraw(adapter, engine, payable(BUYER));
        assertEq(adapter.totalRefundLiability(), 0);
        assertEq(engine.totalRefundLiability(), 0);
    }

    function testSwapBoundsAndVrfBoundsRollBackSwapAndBurn() public {
        vm.prank(BUYER);
        vm.expectRevert(bytes("swap limit"));
        adapter.openPacks{value: 0.01 ether}(packId, 1, 0, 1, 0.01 ether - 1, block.timestamp);
        vm.prank(BUYER);
        vm.expectRevert(bytes("VRF price exceeds budget"));
        adapter.openPacks{value: 0.01 ether}(packId, 1, 1, 0.01 ether - 1, 1, block.timestamp);
        assertEq(proto.totalSupply(), 1000 ether);
        assertEq(pmon.balanceOf(address(0xdead)), 0);
        assertEq(registry.getPack(packId).openings, 0);
        assertEq(wrapper.nextId(), 0);
    }

    function testBadOutputAndPausedOrExpiredPurchasesRevert() public {
        router.setShortOutput(true);
        vm.expectRevert();
        buy(0, 1);
        vm.expectRevert();
        buy(1, 1);
        router.setShortOutput(false);
        engine.pauseRequests(true);
        vm.expectRevert(bytes("pack unavailable"));
        buy(0, 1);
        engine.pauseRequests(false);
        vm.prank(BUYER);
        vm.expectRevert(bytes("invalid purchase"));
        adapter.openPacks{value: 0.02 ether}(packId, 1, 0, 0.01 ether, 0.01 ether, block.timestamp - 1);
        vm.expectRevert(bytes("invalid purchase"));
        buy(2, 1);
        vm.expectRevert(bytes("invalid purchase"));
        buy(0, 0);
        vm.expectRevert(bytes("invalid purchase"));
        buy(0, 11);
    }

    function testForcedEthAndTokenDonationsCannotBeSpentByLaterBuyers() public {
        vm.deal(address(adapter), 3 ether);
        pmon.mint(address(adapter), 5 ether);
        buy(0, 1);
        assertEq(address(adapter).balance, 3 ether);
        assertEq(pmon.balanceOf(address(adapter)), 5 ether);
    }
}
