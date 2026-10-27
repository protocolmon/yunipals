// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BatchWrapper, BatchPaymentToken} from "./BoosterMultiPack.t.sol";

contract PermitPaymentToken is ERC20, ERC20Permit {
    uint256 public permitValue;
    bool public reenter;
    bool public reentryRefused;
    bytes public reentryData;

    constructor() ERC20("PROTO", "PROTO") ERC20Permit("PROTO") {}

    function mint(address owner, uint256 amount) external {
        _mint(owner, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function configureReentry(bytes calldata data) external {
        reenter = true;
        reentryData = data;
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public override {
        super.permit(owner, spender, value, deadline, v, r, s);
        permitValue = value;
        if (reenter) {
            (bool ok, bytes memory reason) = spender.call(reentryData);
            require(
                !ok && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")),
                "reentry not guarded"
            );
            reentryRefused = true;
        }
    }
}

contract BoosterPermitTest is Test {
    uint256 private constant KEY = 0xA11CE;
    bytes32 private constant TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    address private alice;
    address private constant BOB = address(0xB0B);
    PackRegistry private registry;
    YunipalMonsters private monsters;
    BoosterPacks private engine;
    PermitPaymentToken private token;
    BatchWrapper private wrapper;
    uint256 private packId;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        alice = vm.addr(KEY);
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
        token = new PermitPaymentToken();
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
        packId = configure(address(token));
        token.mint(alice, 100 ether);
        vm.deal(alice, 10 ether);
        vm.deal(BOB, 10 ether);
    }

    function configure(address payment) private returns (uint256 id) {
        PackRegistry.Rules memory rules = PackRegistry.Rules(
            address(engine),
            payment,
            1 ether,
            1 days,
            1,
            7,
            450_000,
            250_000,
            3,
            0,
            keccak256("permit-art"),
            "ipfs://catalog",
            "ipfs://variants/"
        );
        PackRegistry.Catalog memory c;
        c.types = new uint32[](1);
        c.colors = new uint32[](1);
        c.horns = new uint32[](1);
        c.glitters = new uint32[](1);
        id = registry.configureType(0, rules, c);
        registry.activate(id);
    }

    function signature(uint256 value, uint256 deadline, address spender)
        private
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(TYPEHASH, alice, spender, value, token.nonces(alice), deadline))
            )
        );
        return vm.sign(KEY, digest);
    }

    function buy(uint32 count) private returns (uint256[] memory requests_, uint256[] memory originals_) {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(uint256(count) * 1 ether, deadline, address(engine));
        vm.recordLogs();
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, count, 0.01 ether, deadline, v, r, s);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        requests_ = new uint256[](count);
        originals_ = new uint256[](count);
        uint256 found;
        for (uint256 i; i < entries.length; ++i) {
            Vm.Log memory entry = entries[i];
            if (
                entry.emitter != address(engine)
                    || entry.topics[0]
                        != keccak256(
                            "RequestCreated(uint256,uint256,uint256,address,uint32,bool,uint256,bytes32,uint32)"
                        )
            ) continue;
            assertEq(entry.topics.length, 4);
            assertEq(uint256(entry.topics[3]), packId);
            requests_[found] = uint256(entry.topics[1]);
            originals_[found++] = uint256(entry.topics[2]);
        }
        assertEq(found, count);
    }

    function unchanged() private view {
        assertEq(token.nonces(alice), 0);
        assertEq(token.allowance(alice, address(engine)), 0);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.totalSupply(), 100 ether);
        assertEq(token.balanceOf(address(engine)), 0);
        assertEq(registry.getPack(packId).openings, 0);
        assertEq(monsters.nextTokenId(), 1);
        assertEq(wrapper.nextId(), 0);
        assertEq(address(engine).balance, 0);
    }

    function testPermitBatchBurnsExactTotalAndKeepsEachOriginalWithPayer() public {
        assertEq(engine.PERMIT_OPEN_VERSION(), 1);
        (uint256[] memory ids, uint256[] memory originals_) = buy(3);
        assertEq(ids.length, 3);
        assertEq(originals_.length, 3);
        assertEq(token.permitValue(), 3 ether);
        assertEq(token.nonces(alice), 1);
        assertEq(token.allowance(alice, address(engine)), 0);
        assertEq(token.totalSupply(), 97 ether);
        assertEq(address(wrapper).balance, 3 * wrapper.BASE_PRICE());
        for (uint256 i; i < 3; ++i) {
            assertEq(engine.getRequest(ids[i]).payer, alice);
            assertEq(engine.getRequest(ids[i]).originalId, originals_[i]);
            wrapper.fulfill(ids[i], i + 1);
            assertEq(monsters.ownerOf(originals_[i]), alice);
        }
    }

    function testPermitSupportsOneAndTenIndependentPacks() public {
        (uint256[] memory one,) = buy(1);
        assertEq(one.length, 1);
        (uint256[] memory ten,) = buy(10);
        assertEq(ten.length, 10);
        assertEq(token.nonces(alice), 2);
        assertEq(token.totalSupply(), 89 ether);
        assertEq(registry.getPack(packId).openings, 11);
    }

    function testFrontRunPermitUsesAlreadyGrantedAllowance() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(3 ether, deadline, address(engine));
        vm.prank(BOB);
        token.permit(alice, address(engine), 3 ether, deadline, v, r, s);
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 3, 0.01 ether, deadline, v, r, s);
        assertEq(wrapper.nextId(), 3);
        assertEq(token.nonces(alice), 1);
        assertEq(token.allowance(alice, address(engine)), 0);
    }

    function testInvalidPermitMayUseExistingAllowance() public {
        vm.prank(alice);
        token.approve(address(engine), 2 ether);
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 2, 0.01 ether, block.timestamp + 60, 0, 0, 0);
        assertEq(wrapper.nextId(), 2);
        assertEq(token.nonces(alice), 0);
        assertEq(token.allowance(alice, address(engine)), 0);
    }

    function testInvalidSignatureWithoutAllowanceRevertsAtomically() public {
        vm.expectRevert();
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, block.timestamp + 60, 0, 0, 0);
        unchanged();
    }

    function testWrongAmountWithoutAllowanceRevertsAtomically() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, address(engine));
        vm.expectRevert();
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 2, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testWrongSpenderWithoutAllowanceRevertsAtomically() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, BOB);
        vm.expectRevert();
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testAnotherCallerCannotUseOwnersPermit() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, address(engine));
        vm.expectRevert();
        vm.prank(BOB);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testExpiredPermitAndPurchaseDoNotChangeState() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, address(engine));
        vm.expectRevert("requests paused or expired");
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testReplayedPermitCannotBuyAgainAfterAllowanceSpent() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, address(engine));
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        vm.expectRevert();
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        assertEq(token.nonces(alice), 1);
        assertEq(token.totalSupply(), 99 ether);
        assertEq(wrapper.nextId(), 1);
    }

    function testLaterWrapperFailureRollsBackPermitNonceAndEntireBatch() public {
        wrapper.configure(0, 2, 0, false);
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(3 ether, deadline, address(engine));
        vm.expectRevert("wrapper rejected later request");
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 3, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testAggregateBudgetFailureRollsBackPermitNonceAndEntireBatch() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(3 ether, deadline, address(engine));
        uint256 budget = wrapper.BASE_PRICE() * 2;
        vm.expectRevert("VRF price exceeds budget");
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 3, budget, deadline, v, r, s);
        unchanged();
    }

    function testPermitReentrancyIsRefusedByExistingGuard() public {
        token.configureReentry(
            abi.encodeCall(
                BoosterPacks.openPacksWithPermit,
                (packId, 1, 0, block.timestamp + 60, 0, bytes32(0), bytes32(0))
            )
        );
        buy(1);
        assertTrue(token.reentryRefused());
    }

    function testCountBoundsAndPausePrecedePermit() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, address(engine));
        engine.pauseRequests(true);
        vm.expectRevert("requests paused or expired");
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        unchanged();
        engine.pauseRequests(false);
        vm.expectRevert("invalid batch size");
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 0, 0.01 ether, deadline, v, r, s);
        unchanged();
        vm.expectRevert("invalid batch size");
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 11, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testNonPermitFutureTokenWithExistingAllowanceStillWorks() public {
        BatchPaymentToken plain = new BatchPaymentToken();
        uint256 id = configure(address(plain));
        plain.mint(alice, 2 ether);
        vm.prank(alice);
        plain.approve(address(engine), 2 ether);
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(id, 2, 0.01 ether, block.timestamp + 60, 0, 0, 0);
        assertEq(wrapper.nextId(), 2);
        assertEq(plain.totalSupply(), 0);
        assertEq(plain.allowance(alice, address(engine)), 0);
    }

    function testPriceUpperBoundTimesTenIsExact() public {
        PackRegistry.Pack memory current = registry.getPack(packId);
        current.rules.price = type(uint128).max;
        uint256 id = registry.configureType(0, current.rules, currentCatalog());
        registry.activate(id);
        uint256 amount = uint256(type(uint128).max) * 10;
        token.mint(alice, amount);
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(amount, deadline, address(engine));
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(id, 10, 0.01 ether, deadline, v, r, s);
        assertEq(token.permitValue(), amount);
        assertEq(token.allowance(alice, address(engine)), 0);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(registry.getPack(id).openings, 10);
    }

    function currentCatalog() private pure returns (PackRegistry.Catalog memory c) {
        c.types = new uint32[](1);
        c.colors = new uint32[](1);
        c.horns = new uint32[](1);
        c.glitters = new uint32[](1);
    }

    function testPermitForAnotherChainCannotSpendWithoutAllowance() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, address(engine));
        vm.chainId(block.chainid + 1);
        vm.expectRevert();
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testPausedSalesRollBackPermitNonceAndAllowance() public {
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = signature(1 ether, deadline, address(engine));
        registry.pauseSales(packId, true);
        vm.expectRevert("sales unavailable");
        vm.prank(alice);
        engine.openPacksWithPermit{value: 0.01 ether}(packId, 1, 0.01 ether, deadline, v, r, s);
        unchanged();
    }

    function testRuntimeFitsEip170() public {
        assertLe(address(new BoosterPacks()).code.length, 24576);
    }
}
