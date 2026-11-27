// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, StdStorage, stdStorage} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters, IEvolvedCardMetadata} from "../src/YunipalMonsters.sol";
import {PortalGradingValidator} from "../src/PortalGradingValidator.sol";
import {PortalGates} from "../src/PortalGates.sol";
import {PortalRegistry} from "../src/PortalRegistry.sol";
import {PortalRules} from "../src/PortalRules.sol";
import {SerumCatalogue} from "../src/SerumCatalogue.sol";
import {YunipalAdventures} from "../src/YunipalAdventures.sol";
import {YunipalEvolution, IProgressionArtwork} from "../src/YunipalEvolution.sol";
import {PortalTestUSDC, PortalTestEngine} from "./Portals.t.sol";
import {MockWrapper} from "./BoosterPacks.t.sol";

interface ILegacyFusion {
    function fuse(uint256 a, uint256 b, YunipalEvolution.Expected calldata ea, YunipalEvolution.Expected calldata eb, uint256 maxVrfPrice, uint64 deadline) external payable returns (uint256);
}

interface ILegacyEvolution {
    function consumeSerum(uint256 tokenId, YunipalEvolution.Expected calldata expected, SerumCatalogue.Dose calldata dose, uint256 maxVrfPrice, uint64 deadline) external payable returns (uint256);
}

contract EvolutionTestEngine is PortalTestEngine {
    uint256 public pending;
    mapping(uint256 => bool) public burned;
    constructor(PackRegistry registry_) PortalTestEngine(registry_) {}

    function evolutionClaimLocks() external pure returns (bool) {
        return true;
    }

    function setPending(uint256 id) external {
        pending = id;
    }

    function originals(uint256) external view returns (uint256, uint256, uint64, uint32, uint32, uint32, bool) {
        return (1, pending, 1, 263, 1, 0, false);
    }
}

contract EvolutionGradingMock is IProgressionArtwork {
    function evolutionIntegrationVersion() external pure returns (uint256) {
        return 1;
    }
    YunipalMonsters public cards;
    uint256 public constant packTypeId = 1;
    mapping(uint256 => uint256) public historyCount;
    mapping(uint256 => uint256) public pendingRequest;

    constructor(YunipalMonsters cards_) {
        cards = cards_;
    }

    function setGraded(uint256 id) external {
        historyCount[id] = 1;
    }

    function inputArtwork(uint256 id) external view returns (Asset memory a, uint64 v) {
        if (cards.evolutionController() != address(0)) {
            (a.uri, a.hash, v) = IEvolvedCardMetadata(cards.evolutionController()).artwork(id);
        }
        if (a.hash == 0) a = Asset("ipfs://base", keccak256("base"));
    }

    function metadataURI(uint256) external pure returns (string memory) {
        return "";
    }
}

contract EvolutionGateCollection {
    PortalGates.Gates private _gates;

    function exists(uint256) external pure returns (bool) {
        return true;
    }

    function gates(uint256) external view returns (PortalGates.Gates memory) {
        return _gates;
    }

    function set(uint8 color, uint8 species, bool originalOnly) external {
        _gates = PortalGates.Gates(0, 264, color, species, originalOnly, false, false);
    }
}

contract EvolutionGateRegistry {
    EvolutionGateCollection public collection = new EvolutionGateCollection();
}

contract EvolutionTest is Test {
    using stdStorage for StdStorage;
    StdStorage private sponsorStorage;
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant FEES = address(0xfee);
    PackRegistry private packs;
    YunipalMonsters private cards;
    EvolutionTestEngine private engine;
    EvolutionGradingMock private grading;
    PortalTestUSDC private usdc;
    MockWrapper private wrapper;
    SerumCatalogue private catalogue;
    YunipalAdventures private adventures;
    YunipalEvolution private evolution;
    uint256 private packId;

    function setUp() public {
        vm.warp(1_000_000);
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
        packs = PackRegistry(
            address(
                new ERC1967Proxy(address(new PackRegistry()), abi.encodeCall(PackRegistry.initialize, (address(this))))
            )
        );
        cards = YunipalMonsters(
            address(
                new ERC1967Proxy(
                    address(new YunipalMonsters()), abi.encodeCall(YunipalMonsters.initialize, (address(this), packs))
                )
            )
        );
        engine = new EvolutionTestEngine(packs);
        usdc = new PortalTestUSDC();
        PackRegistry.Catalog memory c;
        c.types = new uint32[](11);
        c.colors = new uint32[](6);
        for (uint32 i; i < 11; ++i) {
            c.types[i] = i + 1;
        }
        for (uint32 i; i < 6; ++i) {
            c.colors[i] = i + 1;
        }
        c.horns = new uint32[](2);
        c.horns[0] = 1;
        c.horns[1] = 2;
        c.glitters = new uint32[](2);
        c.glitters[1] = 1;
        packId = packs.configureType(
            0,
            PackRegistry.Rules(
                address(engine),
                address(usdc),
                1,
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
            ),
            c
        );
        packs.activate(packId);
        grading = new EvolutionGradingMock(cards);
        cards.setGradingRegistry(address(grading));
        wrapper = new MockWrapper();
        catalogue = new SerumCatalogue();
        PortalRules rules = new PortalRules();
        adventures = YunipalAdventures(
            address(
                new ERC1967Proxy(
                    address(new YunipalAdventures()),
                    abi.encodeCall(
                        YunipalAdventures.initialize,
                        (address(this), cards, catalogue, IVRFV2PlusWrapper(address(wrapper)), uint16(3), rules)
                    )
                )
            )
        );
        evolution = YunipalEvolution(
            address(
                new ERC1967Proxy(
                    address(new YunipalEvolution()),
                    abi.encodeCall(
                        YunipalEvolution.initialize,
                        (
                            address(this),
                            cards,
                            adventures,
                            IERC20(address(usdc)),
                            FEES,
                            keccak256("render-v1"),
                            IVRFV2PlusWrapper(address(wrapper)),
                            uint16(3),
                            rules
                        )
                    )
                )
            )
        );
        cards.configureEvolution(address(evolution), address(adventures));
        evolution.grantRole(evolution.GENERATOR_ROLE(), address(this));
        usdc.mint(ALICE, 100_000_000);
        vm.prank(ALICE);
        usdc.approve(address(evolution), type(uint256).max);
    }

    function original() private returns (uint256) {
        return engine.original(cards, packId, ALICE, 0);
    }

    function child(uint256 parent, uint32 sequence) private returns (uint256) {
        return engine.child(cards, parent, ALICE, sequence, sequence);
    }

    function expected(uint256 id) private view returns (YunipalEvolution.Expected memory e) {
        (e.artVersion,,, e.historyHash,) = evolution.state(id);
    }

    function fuse(uint256 a, uint256 b) private returns (uint256 job) {
        YunipalEvolution.Expected memory ea = expected(a);
        YunipalEvolution.Expected memory eb = expected(b);
        vm.prank(ALICE);
        job = evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 100_000, 0.001 ether, uint64(block.timestamp));
    }

    function complete(uint256 job) private returns (uint256) {
        if (!evolution.getRequest(job).ready) wrapper.fulfill(evolution.getRequest(job).randomnessId, 123);
        return evolution.complete(
            job,
            evolution.requestBinding(job),
            YunipalEvolution.Artifact("ipfs://evolved", keccak256("art"), "ipfs://metadata", keccak256("metadata"))
        );
    }

    function startAdventure(uint256 id) private returns (uint256 job) {
        address owner = cards.ownerOf(id);
        bytes32 rulesHash = catalogue.RULES_HASH();
        vm.prank(owner);
        job = adventures.adventure{value: 0.001 ether}(id, rulesHash, 0.001 ether, uint64(block.timestamp));
    }

    function seedFor(uint256 requestId, uint256 id, bool find) private view returns (uint256 seed) {
        for (;; ++seed) {
            bytes32 entropy = keccak256(
                abi.encode(
                    block.chainid,
                    address(adventures),
                    requestId,
                    id,
                    cards.effectiveSequence(id),
                    catalogue.RULES_HASH(),
                    seed
                )
            );
            if ((catalogue.draw(entropy, cards.effectiveSequence(id)).serumId != 0) == find) return seed;
        }
    }

    function findSerum(uint256 id) private {
        vm.warp(block.timestamp + 1 days);
        uint256 requestId = startAdventure(id);
        wrapper.fulfill(requestId, seedFor(requestId, id, true));
        assertEq(adventures.pendingRequest(id), 0, "callback must settle within quoted gas");
    }

    function drink(uint256 id) private returns (uint256 job) {
        YunipalEvolution.Expected memory e = expected(id);
        SerumCatalogue.Dose memory dose = adventures.unusedSerum(id);
        vm.prank(ALICE);
        job = evolution.consumeSerum{value: 0.001 ether}(id, e, dose, 100_000, 0.001 ether, uint64(block.timestamp));
        if (!evolution.getRequest(job).ready) wrapper.fulfill(evolution.getRequest(job).randomnessId, 123);
    }

    function testFuzzDoseEscrowAndReplay(uint8 rawCount, uint32 delaySeconds) public {
        setSponsoredUsed(1000);
        uint256 count = bound(rawCount, 1, 11);
        uint256 id = original();
        uint256 initialBalance = usdc.balanceOf(ALICE);
        for (uint256 i; i < count; ++i) {
            findSerum(id);
            uint256 job = drink(id);
            assertEq(evolution.feeLiability(), 100_000);
            assertEq(usdc.balanceOf(address(evolution)), evolution.feeLiability());
            assertEq(usdc.balanceOf(ALICE), initialBalance - (i + 1) * 100_000);
            bytes32 binding = evolution.requestBinding(job);
            vm.warp(block.timestamp + uint256(delaySeconds));
            complete(job);
            assertEq(evolution.feeLiability(), 0);
            assertEq(usdc.balanceOf(FEES), (i + 1) * 100_000);
            assertEq(evolution.doses(id).length, i + 1);
            vm.expectRevert("request not ready or changed");
            evolution.complete(
                job,
                binding,
                YunipalEvolution.Artifact("ipfs://evolved", keccak256("art"), "ipfs://metadata", keccak256("metadata"))
            );
            assertEq(usdc.balanceOf(FEES), (i + 1) * 100_000);
        }
    }

    function setSponsoredUsed(uint256 used) private {
        sponsorStorage.target(address(evolution)).sig("sponsoredSerumsUsed()").checked_write(used);
    }

    function drinkWithLimit(uint256 id, uint256 limit) private returns (uint256 job) {
        YunipalEvolution.Expected memory e = expected(id);
        SerumCatalogue.Dose memory dose = adventures.unusedSerum(id);
        vm.prank(ALICE);
        return evolution.consumeSerum{value: 0.001 ether}(id, e, dose, limit, 0.001 ether, uint64(block.timestamp));
    }

    function testSponsoredDosesNeedNoUsdcAndRetriesKeepOneSlot() public {
        uint256 id = original();
        vm.prank(ALICE);
        usdc.approve(address(evolution), 0);
        deal(address(usdc), ALICE, 0);
        assertEq(evolution.SPONSORED_SERUM_LIMIT(), 1000);
        for (uint256 i; i < 2; ++i) {
            findSerum(id);
            uint256 ethBefore = ALICE.balance;
            uint256 job = drinkWithLimit(id, 0);
            assertEq(ALICE.balance, ethBefore - (i == 0 ? wrapper.PRICE() : 0), "VRF remains player paid");
            assertEq(evolution.sponsoredSerumsUsed(), i + 1);
            assertTrue(evolution.sponsoredRequest(job));
            assertEq(evolution.feeLiability(), 0);
            if (!evolution.getRequest(job).ready) wrapper.fulfill(evolution.getRequest(job).randomnessId, 123);
            bytes32 binding = evolution.requestBinding(job);
            vm.expectRevert();
            evolution.complete(job, binding, YunipalEvolution.Artifact("", 0, "", 0));
            assertEq(evolution.sponsoredSerumsUsed(), i + 1);
            assertEq(cards.cardReservation(id), address(evolution));
            complete(job);
            vm.expectRevert("request not ready or changed");
            evolution.complete(job, binding, YunipalEvolution.Artifact("ipfs://evolved", keccak256("art"), "ipfs://metadata", keccak256("metadata")));
            assertEq(evolution.sponsoredSerumsUsed(), i + 1);
        }
        assertEq(usdc.balanceOf(FEES), 0);
        assertEq(usdc.balanceOf(address(evolution)), 0);
    }

    function testLastSponsoredSlotAndStaleQuoteCannotChargeApprovedWallet() public {
        setSponsoredUsed(999);
        uint256 a = original();
        uint256 b = child(a, 1);
        findSerum(a);
        findSerum(b);
        assertEq(evolution.serumApplicationFee(), 0);
        uint256 freeJob = drinkWithLimit(a, 0);
        assertEq(evolution.sponsoredSerumsUsed(), 1000);
        assertEq(evolution.serumApplicationFee(), 100_000);
        uint256 balance = usdc.balanceOf(ALICE);
        YunipalEvolution.Expected memory e = expected(b);
        SerumCatalogue.Dose memory dose = adventures.unusedSerum(b);
        vm.prank(ALICE);
        vm.expectRevert(YunipalEvolution.AiFeeExceedsBudget.selector);
        evolution.consumeSerum{value: 0.001 ether}(b, e, dose, 0, 0.001 ether, uint64(block.timestamp));
        assertEq(usdc.balanceOf(ALICE), balance);
        assertEq(cards.cardReservation(b), address(0));
        uint256 paidJob = drinkWithLimit(b, 100_000);
        assertFalse(evolution.sponsoredRequest(paidJob));
        assertEq(usdc.balanceOf(ALICE), balance - 100_000);
        assertEq(evolution.feeLiability(), 100_000);
        complete(freeJob);
        assertEq(evolution.feeLiability(), 100_000, "free completion cannot consume another job's escrow");
        complete(paidJob);
        assertEq(evolution.feeLiability(), 0);
        assertEq(usdc.balanceOf(FEES), 100_000);
        assertEq(evolution.sponsoredSerumsUsed(), 1000);
    }

    function testRevertedAdmissionDoesNotUseSponsorship() public {
        uint256 id = original();
        findSerum(id);
        YunipalEvolution.Expected memory e = expected(id);
        SerumCatalogue.Dose memory dose = adventures.unusedSerum(id);
        vm.prank(BOB);
        vm.expectRevert("owner only");
        evolution.consumeSerum{value: 0.001 ether}(id, e, dose, 0, 0.001 ether, uint64(block.timestamp));
        vm.prank(ALICE);
        vm.expectRevert("VRF price exceeds budget");
        evolution.consumeSerum(id, e, dose, 0, 0, uint64(block.timestamp));
        assertEq(evolution.sponsoredSerumsUsed(), 0);
        assertEq(evolution.requestCount(), 0);
        assertEq(cards.cardReservation(id), address(0));
        assertEq(adventures.unusedSerum(id).serumId, dose.serumId);
    }

    function testFusionAndSerumUseIndependentSponsorship() public {
        uint256 a = original();
        uint256 job = fuse(a, child(a, 1));
        assertTrue(evolution.sponsoredRequest(job));
        assertEq(evolution.sponsoredFusionsUsed(), 1);
        assertEq(evolution.sponsoredSerumsUsed(), 0);
        assertEq(evolution.feeLiability(), 0);
        uint256 fused = complete(job);
        findSerum(fused);
        complete(drinkWithLimit(fused, 0));
        assertEq(evolution.sponsoredSerumsUsed(), 1);
        assertEq(usdc.balanceOf(FEES), 0);
    }

    function fuseWithLimit(uint256 a, uint256 b, uint256 feeLimit) private returns (uint256) {
        YunipalEvolution.Expected memory ea = expected(a);
        YunipalEvolution.Expected memory eb = expected(b);
        vm.prank(ALICE);
        return evolution.fuse{value: 0.001 ether}(a, b, ea, eb, feeLimit, 0.001 ether, uint64(block.timestamp));
    }

    function testFusionSponsorshipBoundaryStaleQuoteAndEscrow() public {
        sponsorStorage.target(address(evolution)).sig("sponsoredFusionsUsed()").checked_write(999);
        uint256 a = original();
        uint256 b = child(a, 1);
        uint256 c = child(a, 2);
        uint256 d = child(a, 3);
        uint256 balance = usdc.balanceOf(ALICE);
        uint256 ethBefore = ALICE.balance;
        vm.prank(ALICE);
        usdc.approve(address(evolution), 0);
        uint256 freeJob = fuseWithLimit(a, b, 0);
        assertTrue(evolution.sponsoredRequest(freeJob));
        assertEq(evolution.sponsoredFusionsUsed(), 1000);
        assertEq(evolution.sponsoredSerumsUsed(), 0);
        assertEq(usdc.balanceOf(ALICE), balance);
        assertEq(ALICE.balance, ethBefore - wrapper.PRICE());
        assertEq(evolution.fusionFee(), 100_000);
        vm.prank(ALICE);
        usdc.approve(address(evolution), type(uint256).max);
        YunipalEvolution.Expected memory ec = expected(c);
        YunipalEvolution.Expected memory ed = expected(d);
        vm.prank(ALICE);
        vm.expectRevert(YunipalEvolution.AiFeeExceedsBudget.selector);
        evolution.fuse{value: 0.001 ether}(c, d, ec, ed, 0, 0.001 ether, uint64(block.timestamp));
        assertEq(cards.cardReservation(c), address(0));
        assertEq(usdc.balanceOf(ALICE), balance);
        uint256 paidJob = fuseWithLimit(c, d, 100_000);
        assertFalse(evolution.sponsoredRequest(paidJob));
        assertEq(evolution.feeLiability(), 100_000);
        wrapper.fulfill(evolution.getRequest(freeJob).randomnessId, 123);
        bytes32 binding = evolution.requestBinding(freeJob);
        vm.expectRevert();
        evolution.complete(freeJob, binding, YunipalEvolution.Artifact("", 0, "", 0));
        assertEq(evolution.sponsoredFusionsUsed(), 1000);
        complete(freeJob);
        assertEq(evolution.feeLiability(), 100_000);
        complete(paidJob);
        assertEq(evolution.feeLiability(), 0);
        assertEq(usdc.balanceOf(FEES), 100_000);
        assertEq(evolution.sponsoredFusionsUsed(), 1000);
    }

    function testRejectedFusionDoesNotConsumeSponsorship() public {
        uint256 a = original();
        uint256 b = child(a, 1);
        YunipalEvolution.Expected memory ea = expected(a);
        YunipalEvolution.Expected memory eb = expected(b);
        vm.prank(BOB);
        vm.expectRevert("owner only");
        evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 0, 0.001 ether, uint64(block.timestamp));
        vm.prank(ALICE);
        vm.expectRevert("VRF price exceeds budget");
        evolution.fuse(a, b, ea, eb, 0, 0, uint64(block.timestamp));
        assertEq(evolution.sponsoredFusionsUsed(), 0);
        assertEq(evolution.requestCount(), 0);
        assertEq(cards.cardReservation(a), address(0));
        assertEq(cards.cardReservation(b), address(0));
    }

    function testUpgradePreservesPaidFusionAndSponsoredSerum() public {
        bytes memory code = vm.parseJsonBytes(vm.readFile("test/fixtures/YunipalEvolution.pre-fusion-sponsorship.json"), ".creationBytecode");
        address legacy;
        assembly { legacy := create(0, add(code, 32), mload(code)) }
        require(legacy != address(0), "legacy deployment failed");
        evolution.upgradeToAndCall(legacy, "");
        uint256 a = original();
        uint256 b = child(a, 1);
        uint256 c = original();
        YunipalEvolution.Expected memory ea = expected(a);
        YunipalEvolution.Expected memory eb = expected(b);
        vm.prank(ALICE);
        uint256 paidJob = ILegacyFusion(address(evolution)).fuse{value: 0.001 ether}(a, b, ea, eb, 0.001 ether, uint64(block.timestamp));
        findSerum(c);
        uint256 freeJob = drinkWithLimit(c, 0);
        wrapper.fulfill(evolution.getRequest(paidJob).randomnessId, 123);
        wrapper.fulfill(evolution.getRequest(freeJob).randomnessId, 456);
        bytes32 binding = evolution.requestBinding(paidJob);
        bytes32 serumBinding = evolution.requestBinding(freeJob);
        evolution.upgradeToAndCall(address(new YunipalEvolution()), "");
        assertEq(evolution.requestBinding(paidJob), binding);
        assertEq(evolution.requestBinding(freeJob), serumBinding);
        assertEq(evolution.sponsoredSerumsUsed(), 1);
        assertEq(evolution.sponsoredFusionsUsed(), 0);
        assertFalse(evolution.sponsoredRequest(paidJob));
        assertTrue(evolution.sponsoredRequest(freeJob));
        complete(freeJob);
        assertEq(evolution.feeLiability(), 100_000);
        complete(paidJob);
        assertEq(evolution.feeLiability(), 0);
        assertEq(usdc.balanceOf(FEES), 100_000);
        uint256 newOriginal = original();
        uint256 freeFusion = fuseWithLimit(newOriginal, child(newOriginal, 1), 0);
        complete(freeFusion);
        evolution.upgradeToAndCall(address(new YunipalEvolution()), "");
        assertEq(evolution.sponsoredFusionsUsed(), 1);
        assertEq(evolution.sponsoredSerumsUsed(), 1);
    }

    function testUpgradePreservesLegacyPaidRequestAndBinding() public {
        bytes memory code = vm.parseJsonBytes(
            vm.readFile("test/fixtures/YunipalEvolution.pre-sponsorship.json"), ".creationBytecode"
        );
        address legacy;
        assembly { legacy := create(0, add(code, 32), mload(code)) }
        require(legacy != address(0), "legacy deployment failed");
        evolution.upgradeToAndCall(legacy, "");
        uint256 id = original();
        findSerum(id);
        YunipalEvolution.Expected memory e = expected(id);
        SerumCatalogue.Dose memory dose = adventures.unusedSerum(id);
        vm.prank(ALICE);
        uint256 job = ILegacyEvolution(address(evolution)).consumeSerum{value: 0.001 ether}(id, e, dose, 0.001 ether, uint64(block.timestamp));
        wrapper.fulfill(evolution.getRequest(job).randomnessId, 123);
        bytes32 binding = evolution.requestBinding(job);
        assertEq(evolution.feeLiability(), 100_000);
        evolution.upgradeToAndCall(address(new YunipalEvolution()), "");
        assertEq(evolution.requestBinding(job), binding);
        assertFalse(evolution.sponsoredRequest(job));
        assertEq(evolution.sponsoredSerumsUsed(), 0);
        complete(job);
        assertEq(usdc.balanceOf(FEES), 100_000);
        assertEq(evolution.feeLiability(), 0);
        findSerum(id);
        complete(drinkWithLimit(id, 0));
        assertEq(evolution.sponsoredSerumsUsed(), 1);
        assertEq(usdc.balanceOf(FEES), 100_000);
        evolution.upgradeToAndCall(address(new YunipalEvolution()), "");
        assertEq(evolution.sponsoredSerumsUsed(), 1, "upgrade must not reset allowance");
    }

    function testFinishWaitsForVrfAndPersistsAcrossDosesTransferAndGrade() public {
        uint256 id = original();
        findSerum(id);
        YunipalEvolution.Expected memory e = expected(id);
        SerumCatalogue.Dose memory dose = adventures.unusedSerum(id);
        uint256 balance = ALICE.balance;
        vm.prank(ALICE);
        vm.expectRevert("VRF price exceeds budget");
        evolution.consumeSerum(id, e, dose, 100_000, 0, uint64(block.timestamp));
        assertEq(cards.cardReservation(id), address(0));
        assertEq(evolution.requestCount(), 0);
        vm.prank(ALICE);
        uint256 job = evolution.consumeSerum{value: 0.001 ether}(id, e, dose, 100_000, 0.001 ether, uint64(block.timestamp));
        assertEq(ALICE.balance, balance - wrapper.PRICE());
        YunipalEvolution.Request memory request = evolution.getRequest(job);
        assertFalse(request.ready);
        vm.expectRevert("randomness pending");
        evolution.requestBinding(job);
        wrapper.fulfill(request.randomnessId, 777);
        request = evolution.getRequest(job);
        assertTrue(request.ready, "settlement must fit callback gas");
        uint8 finish = request.resultFinish;
        assertGe(finish, 1);
        assertLe(finish, 3);
        bytes32 binding = evolution.requestBinding(job);
        wrapper.fulfill(request.randomnessId, 999);
        evolution.settlePresence(request.randomnessId);
        assertEq(evolution.requestBinding(job), binding, "cannot reroll");
        complete(job);
        (,,,, uint8 assigned) = evolution.state(id);
        assertEq(assigned, finish);
        findSerum(id);
        uint256 previousVrf = wrapper.nextId();
        balance = ALICE.balance;
        job = drink(id);
        assertEq(wrapper.nextId(), previousVrf, "later serum does not request VRF");
        assertEq(ALICE.balance, balance, "unused ETH refunded");
        assertEq(evolution.getRequest(job).resultFinish, finish);
        complete(job);
        vm.prank(ALICE);
        cards.transferFrom(ALICE, BOB, id);
        grading.setGraded(id);
        (,,,, assigned) = evolution.state(id);
        assertEq(assigned, finish);
    }

    function testFinishThresholds() public view {
        // Values >= 100 avoid uniform()'s low-value rejection region.
        for (uint256 roll; roll < 100; ++roll) {
            assertEq(evolution.drawFinish(bytes32(100 + roll)), roll < 70 ? 1 : roll < 95 ? 2 : 3);
        }
    }

    function testCatalogueCoverageAndTierBoundaries() public view {
        uint256[6] memory count;
        for (uint8 i = 1; i <= 121; ++i) {
            ++count[catalogue.rarity(i)];
        }
        assertEq(count[0], 9);
        assertEq(count[1], 27);
        assertEq(count[2], 28);
        assertEq(count[3], 17);
        assertEq(count[4], 19);
        assertEq(count[5], 21);
        for (uint16 sequence; sequence < 264; ++sequence) {
            uint32[7] memory w = catalogue.weights(sequence);
            uint256 sum;
            for (uint8 j; j < 7; ++j) {
                sum += w[j];
            }
            assertEq(sum, 1_000_000);
            assertEq(w[0], 350_000);
            assertEq(w[6], 100 + 40 * uint32(sequence / 24));
        }
    }

    function testAdventureFollowsTransferNoFindKeepsSerumAndCooldown() public {
        uint256 id = original();
        findSerum(id);
        SerumCatalogue.Dose memory previous = adventures.unusedSerum(id);
        bytes32 rulesHash = catalogue.RULES_HASH();
        vm.prank(ALICE);
        vm.expectRevert("adventure unavailable");
        adventures.adventure{value: 0.001 ether}(id, rulesHash, 0.001 ether, uint64(block.timestamp));
        vm.warp(block.timestamp + 1 days);
        uint256 job = startAdventure(id);
        vm.prank(ALICE);
        cards.transferFrom(ALICE, BOB, id);
        vm.prank(BOB);
        vm.expectRevert("card reserved");
        cards.burn(id);
        wrapper.fulfill(job, seedFor(job, id, false));
        assertEq(cards.ownerOf(id), BOB);
        assertEq(keccak256(abi.encode(adventures.unusedSerum(id))), keccak256(abi.encode(previous)));
        wrapper.fulfill(job, 9999); // Duplicate cannot reroll.
        assertEq(keccak256(abi.encode(adventures.unusedSerum(id))), keccak256(abi.encode(previous)));
    }

    function testDoseIsChargedOnceAndRetriedWithoutUnlocking() public {
        setSponsoredUsed(1000);
        uint256 id = original();
        findSerum(id);
        uint8 presence = adventures.unusedSerum(id).presenceId;
        uint256 job = drink(id);
        assertEq(usdc.balanceOf(FEES), 0);
        assertEq(evolution.feeLiability(), 100_000);
        vm.prank(ALICE);
        vm.expectRevert("card reserved");
        cards.transferFrom(ALICE, BOB, id);
        bytes32 binding = evolution.requestBinding(job);
        vm.expectRevert();
        evolution.complete(job, binding, YunipalEvolution.Artifact("", 0, "", 0));
        assertEq(cards.cardReservation(id), address(evolution));
        vm.warp(block.timestamp + 100 days);
        complete(job);
        (uint64 version, uint8 doses, uint8 current,,) = evolution.state(id);
        assertEq(version, 1);
        assertEq(doses, 1);
        assertEq(current, presence);
        assertEq(usdc.balanceOf(FEES), 100_000);
        assertEq(evolution.feeLiability(), 0);
        assertEq(adventures.unusedSerum(id).serumId, 0);
        vm.expectRevert("request not ready or changed");
        evolution.complete(
            job,
            binding,
            YunipalEvolution.Artifact("ipfs://evolved", keccak256("art"), "ipfs://metadata", keccak256("metadata"))
        );
    }

    function testFusionBurnsOnlyOnSuccessAndUsesSharedAllocator() public {
        uint256 a = original();
        uint256 b = child(a, 1);
        uint256 beforeVrf = wrapper.nextId();
        uint256 job = fuse(a, b);
        assertEq(wrapper.nextId(), beforeVrf + 1, "every fusion needs a new finish roll");
        assertEq(cards.ownerOf(a), ALICE);
        assertEq(cards.ownerOf(b), ALICE);
        uint256 interleaved = original();
        uint256 result = complete(job);
        assertEq(result, interleaved + 1);
        vm.expectRevert();
        cards.ownerOf(a);
        vm.expectRevert();
        cards.ownerOf(b);
        assertEq(cards.ownerOf(result), ALICE);
        (,,,, uint8 finish) = evolution.state(result);
        assertEq(finish, evolution.getRequest(job).resultFinish);
        assertGe(finish, 1);
        assertLe(finish, 3);
        assertEq(cards.fusion(result).level, 1);
        assertEq(cards.fusion(result).sources[0], a);
        (, uint256 fakeOriginal,,,) = cards.provenance(result);
        assertEq(fakeOriginal, 0);
        assertEq(cards.tokenURI(result), "ipfs://metadata");
    }

    function testSecondFusionUsesExactLeafAverageAndStops() public {
        uint256 a = original();
        uint256 a40 = child(a, 40);
        uint256 a41 = child(a, 41);
        uint256 b = original();
        uint256 b201 = child(b, 201);
        uint256 b202 = child(b, 202);
        uint256 f1 = complete(fuse(a40, a41));
        uint256 f2 = complete(fuse(b201, b202));
        uint256 f = complete(fuse(f1, f2));
        assertEq(cards.effectiveSequence(f), 121);
        assertEq(cards.fusion(f).sequenceSum, 484);
        assertEq(cards.fusion(f).sourceCount, 4);
        vm.expectRevert("incompatible fusion levels");
        cards.fusionRecipe(f1, f);
    }

    function testDifferentPresencesRequireFreshRandomnessAndFreezeInputs() public {
        uint256 a = original();
        uint256 b = child(a, 1);
        findSerum(a);
        complete(drink(a));
        uint64 cooldown = adventures.nextAdventureAt(a);
        uint256 job = fuse(a, b);
        YunipalEvolution.Request memory request = evolution.getRequest(job);
        assertFalse(request.ready);
        assertGt(request.randomnessId, 0);
        vm.expectRevert("randomness pending");
        evolution.requestBinding(job);
        wrapper.fulfill(request.randomnessId, 1);
        request = evolution.getRequest(job);
        assertTrue(request.ready);
        assertTrue(request.resultPresence == request.presenceA || request.resultPresence == 0);
        uint256 f = complete(job);
        assertEq(adventures.nextAdventureAt(f), cooldown);
        (, uint8 doses, uint8 presence, bytes32 history,) = evolution.state(f);
        assertEq(doses, 0);
        assertEq(presence, request.resultPresence);
        assertTrue(history != bytes32(0));
        assertEq(evolution.doses(a).length, 1);
    }

    function testGradedAndPendingClaimInputsRejected() public {
        uint256 a = original();
        uint256 b = child(a, 1);
        YunipalEvolution.Expected memory ea = expected(a);
        YunipalEvolution.Expected memory eb = expected(b);
        bytes32 rulesHash = catalogue.RULES_HASH();
        engine.setPending(1);
        vm.prank(ALICE);
        vm.expectRevert("original has pending claim");
        evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 100_000, 0.001 ether, uint64(block.timestamp));
        engine.setPending(0);
        grading.setGraded(a);
        vm.prank(ALICE);
        vm.expectRevert("card already graded");
        adventures.adventure{value: 0.001 ether}(a, rulesHash, 0.001 ether, uint64(block.timestamp));
        vm.prank(ALICE);
        vm.expectRevert("card already graded");
        evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 100_000, 0.001 ether, uint64(block.timestamp));
    }

    function testElevenLocalDosesAndFreshFusionAllowance() public {
        uint256 a = original();
        uint256 b = child(a, 1);
        for (uint8 i; i < 11; ++i) {
            findSerum(a);
            complete(drink(a));
        }
        findSerum(a);
        YunipalEvolution.Expected memory e = expected(a);
        SerumCatalogue.Dose memory dose = adventures.unusedSerum(a);
        vm.prank(ALICE);
        vm.expectRevert("dose limit reached");
        evolution.consumeSerum(a, e, dose, 100_000, 0, uint64(block.timestamp));
        uint256 job = fuse(a, b);
        wrapper.fulfill(evolution.getRequest(job).randomnessId, 0);
        uint256 f = complete(job);
        findSerum(f);
        complete(drink(f));
        (, uint8 local,,,) = evolution.state(f);
        assertEq(local, 1);
        assertEq(evolution.doses(a).length, 11);
    }

    function testPortalWitnessCannotMixTraitsAndRetainsBurnedOriginal() public {
        uint256 a = original();
        uint256 b = engine.child(cards, a, ALICE, 28, 1);
        uint256 f = complete(fuse(a, b));
        EvolutionGateRegistry registry = new EvolutionGateRegistry();
        PortalGradingValidator validator = new PortalGradingValidator();
        registry.collection().set(1, 0, false); // Blue from B + species from A is not a real source.
        assertEq(validator.matchingSource(cards, PortalRegistry(address(registry)), packId, 1, f), 0);
        registry.collection().set(1, 1, false);
        assertEq(validator.matchingSource(cards, PortalRegistry(address(registry)), packId, 1, f), b);
        registry.collection().set(1, 1, true);
        assertEq(validator.matchingSource(cards, PortalRegistry(address(registry)), packId, 1, f), 0);
        registry.collection().set(0, 0, true);
        assertEq(validator.matchingSource(cards, PortalRegistry(address(registry)), packId, 1, f), a);
        EvolutionGradingMock other = new EvolutionGradingMock(cards);
        vm.expectRevert("grading history binding frozen");
        cards.setGradingRegistry(address(other));
    }
    function testSingularityOriginalsTransferIndependentAndTerminal() public {
        vm.warp(20 days + 1);
        uint256 a = original();
        vm.warp(21 days - 1);
        uint256 b = engine.original(cards, packId, BOB, 0);
        vm.prank(BOB);
        cards.transferFrom(BOB, ALICE, b);
        assertEq(cards.fusionRecipe(a, b).level, 3);
        uint256 job = fuseWithLimit(a, b, 0);
        assertEq(cards.ownerOf(a), ALICE);
        assertEq(cards.ownerOf(b), ALICE);
        assertTrue(evolution.sponsoredRequest(job));
        assertEq(evolution.sponsoredFusionsUsed(), 1);
        assertEq(evolution.sponsoredSerumsUsed(), 0);
        uint256 result = complete(job);
        YunipalMonsters.Fusion memory f = cards.fusion(result);
        assertEq(f.level, 3);
        assertEq(f.sourceCount, 2);
        assertEq(f.sources[0], a);
        assertEq(f.sources[1], b);
        assertEq(cards.effectiveSequence(result), 0);
        vm.expectRevert(); cards.ownerOf(a);
        vm.expectRevert(); cards.ownerOf(b);
        uint256 c = original();
        uint256 d = original();
        uint256 other = complete(fuse(c, d));
        vm.expectRevert("incompatible fusion levels");
        cards.fusionRecipe(result, other);
        findSerum(result);
        complete(drink(result));
        (, uint8 doses,,,) = evolution.state(result);
        assertEq(doses, 1);
        EvolutionGateRegistry registry = new EvolutionGateRegistry();
        PortalGradingValidator validator = new PortalGradingValidator();
        registry.collection().set(0, 0, true);
        assertEq(validator.matchingSource(cards, PortalRegistry(address(registry)), packId, 1, result), a);
    }

    function testSingularityRequiresUtcDateNotRollingDay() public {
        vm.warp(30 days - 1);
        uint256 a = original();
        vm.warp(30 days);
        uint256 b = original();
        vm.expectRevert(YunipalMonsters.DifferentMintDates.selector);
        cards.fusionRecipe(a, b);
    }

    function testSingularityMatchesEachTraitAndPackExactly() public {
        uint256 a = original();
        // Variant encoding: glitter, horn, color, species in ascending strides.
        uint32[4] memory variants = [uint32(1), 2, 4, 24];
        for (uint256 i; i < variants.length; ++i) {
            uint256 b = engine.original(cards, packId, ALICE, variants[i]);
            vm.expectRevert(YunipalMonsters.SingularityTraitsMismatch.selector);
            cards.fusionRecipe(a, b);
        }
        // An otherwise identical card from a distinct pack must never qualify.
        PackRegistry.Pack memory pack = packs.getPack(packId);
        uint256 otherPack = packs.configureType(0, pack.rules, packs.getCatalog(packId));
        packs.activate(otherPack);
        uint256 c = engine.original(cards, otherPack, ALICE, 0);
        vm.expectRevert(YunipalMonsters.SingularityTraitsMismatch.selector);
        cards.fusionRecipe(a, c);
    }

    function testSingularitySequenceAndUnfusedUngradedGuards() public {
        uint256 a = original();
        uint256 b = original();
        uint256 x = engine.child(cards, a, ALICE, 7, 17);
        uint256 y = engine.child(cards, b, ALICE, 7, 18);
        vm.expectRevert("different lineages"); cards.fusionRecipe(x, y);
        uint256 z = engine.child(cards, b, ALICE, 7, 17);
        assertEq(cards.fusionRecipe(x, z).sequenceSum, 34);
        grading.setGraded(x);
        YunipalEvolution.Expected memory ex = expected(x);
        YunipalEvolution.Expected memory ez = expected(z);
        vm.prank(ALICE);
        vm.expectRevert("card already graded");
        evolution.fuse{value: 0.001 ether}(x, z, ex, ez, 0, 0.001 ether, uint64(block.timestamp));
        assertEq(evolution.sponsoredFusionsUsed(), 0);
        vm.expectRevert("canonical distinct parents required"); cards.fusionRecipe(a, a);
        vm.expectRevert("canonical distinct parents required"); cards.fusionRecipe(b, a);
        engine.setPending(1);
        YunipalEvolution.Expected memory ea = expected(a);
        YunipalEvolution.Expected memory eb = expected(b);
        vm.prank(ALICE);
        vm.expectRevert("original has pending claim");
        evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 0, 0.001 ether, uint64(block.timestamp));
    }

    function testSingularityRetainsDosesCooldownAndSharedPaidFee() public {
        uint256 a = original();
        uint256 b = original();
        findSerum(a); complete(drink(a));
        findSerum(b); complete(drink(b));
        findSerum(a);
        uint64 cooldown = adventures.nextAdventureAt(a);
        sponsorStorage.target(address(evolution)).sig("sponsoredFusionsUsed()").checked_write(1000);
        uint256 job = fuse(a, b);
        assertFalse(evolution.sponsoredRequest(job));
        assertEq(evolution.feeLiability(), 100_000);
        wrapper.fulfill(evolution.getRequest(job).randomnessId, 123);
        bytes32 binding = evolution.requestBinding(job);
        vm.expectRevert();
        evolution.complete(job, binding, YunipalEvolution.Artifact("", 0, "", 0));
        assertEq(cards.ownerOf(a), ALICE);
        assertEq(cards.cardReservation(a), address(evolution));
        uint256 result = complete(job);
        assertEq(usdc.balanceOf(FEES), 100_000);
        assertEq(adventures.nextAdventureAt(result), cooldown);
        assertEq(adventures.unusedSerum(a).serumId, 0);
        assertEq(evolution.doses(a).length, 1);
        assertEq(evolution.doses(b).length, 1);
        (, uint8 doses, uint8 presence,, uint8 finish) = evolution.state(result);
        assertEq(doses, 0);
        YunipalEvolution.Request memory request = evolution.getRequest(job);
        assertTrue(presence == request.presenceA || presence == request.presenceB);
        assertEq(finish, request.resultFinish);
        assertEq(cards.effectiveSequence(result), 0);
    }

    function testCardsUpgradePreservesLegacyPendingFusionAndSerum() public {
        bytes memory code = vm.parseJsonBytes(vm.readFile("test/fixtures/YunipalMonsters.pre-singularity.json"), ".creationBytecode");
        address legacy;
        assembly { legacy := create(0, add(code, 32), mload(code)) }
        require(legacy != address(0), "legacy deployment failed");
        cards.upgradeToAndCall(legacy, "");
        uint256 a = original();
        uint256 b = child(a, 1);
        uint256 c = original();
        uint256 job = fuse(a, b);
        findSerum(c);
        uint256 serumJob = drink(c);
        wrapper.fulfill(evolution.getRequest(job).randomnessId, 123);
        bytes32 binding = evolution.requestBinding(job);
        bytes32 serumBinding = evolution.requestBinding(serumJob);
        cards.upgradeToAndCall(address(new YunipalMonsters()), "");
        assertEq(evolution.requestBinding(job), binding);
        assertEq(evolution.requestBinding(serumJob), serumBinding);
        assertEq(cards.cardReservation(a), address(evolution));
        uint256 result = complete(job);
        assertEq(cards.fusion(result).level, 1);
        complete(serumJob);
        assertEq(evolution.sponsoredFusionsUsed(), 1);
        assertEq(evolution.sponsoredSerumsUsed(), 1);
        uint256 d = original();
        uint256 e = original();
        assertEq(cards.fusion(complete(fuse(d, e))).level, 3);
    }

    function freshCrew() private returns (uint256[3] memory crew, uint64 day) {
        adventures.enableCrewAdventures();
        day = uint64(vm.getBlockTimestamp() / 1 days);
        vm.prank(ALICE);
        uint256 ruleRequest = adventures.prepareDailyCrew{value: 0.001 ether}(day, 0.001 ether);
        wrapper.fulfill(ruleRequest, 93);
        (, uint32 color, uint32 species, bool ready) = adventures.dailyCrew(day);
        assertTrue(ready);
        uint256 parent = original();
        crew[0] = engine.child(cards, parent, ALICE, (color - 1) * 4, 1);
        crew[1] = engine.child(cards, parent, ALICE, 2, 2);
        crew[2] = engine.child(cards, parent, ALICE, (species - 1) * 24, 3);
    }

    function launchCrew(uint256[3] memory crew, uint256 survivor, uint64 day) private returns (uint256) {
        bytes32 rules = keccak256(abi.encode(keccak256("YunipalsSerumsV1:11x11:11tiers24:holy10000:ordered11"), "crew-v1:three-distinct:utc-birth:guaranteed"));
        vm.prank(ALICE);
        return adventures.crewAdventure{value: 0.001 ether}(crew, survivor, day, rules,
            0.001 ether, uint64(vm.getBlockTimestamp()));
    }

    function testCrewChoosesSurvivorLocksInputsAndAlwaysFindsSerum() public {
        (uint256[3] memory crew, uint64 day) = freshCrew();
        uint256 requestId = launchCrew(crew, crew[1], day);
        for (uint256 i; i < 3; ++i) {
            assertEq(adventures.pendingRequest(crew[i]), requestId);
            vm.prank(ALICE);
            vm.expectRevert("card reserved");
            cards.transferFrom(ALICE, BOB, crew[i]);
        }
        vm.warp(vm.getBlockTimestamp() + 1 days);
        wrapper.fulfill(requestId, 0);
        assertTrue(adventures.getAdventure(requestId).settled, "quoted callback gas must settle crew");
        assertGt(adventures.unusedSerum(crew[1]).serumId, 0);
        assertEq(cards.ownerOf(crew[1]), ALICE);
        for (uint256 i; i < 3; ++i) {
            assertEq(adventures.pendingRequest(crew[i]), 0);
            assertEq(cards.cardReservation(crew[i]), address(0));
            if (i != 1) { vm.expectRevert(); cards.ownerOf(crew[i]); }
        }
        adventures.settle(requestId);
        assertEq(cards.ownerOf(crew[1]), ALICE, "recovery is idempotent");
        bytes32 legacyRules = catalogue.RULES_HASH();
        vm.prank(ALICE);
        vm.expectRevert("three-card crew required");
        adventures.adventure{value: 0.001 ether}(crew[1], legacyRules, 0.001 ether, uint64(vm.getBlockTimestamp()));
    }

    function testCrewRejectsDuplicatesWrongSlotsAndStaleBirths() public {
        (uint256[3] memory crew, uint64 day) = freshCrew();
        uint256[3] memory duplicate = [crew[0], crew[0], crew[2]];
        vm.expectRevert("three distinct cards required");
        launchCrew(duplicate, crew[0], day);
        uint256[3] memory wrong = [crew[0], crew[2], crew[1]];
        vm.expectRevert("crew slot does not match");
        launchCrew(wrong, crew[0], day);
        vm.warp((uint256(day) + 1) * 1 days);
        vm.expectRevert("quote expired or changed");
        launchCrew(crew, crew[0], day);
        uint64 tomorrow = day + 1;
        vm.prank(ALICE);
        uint256 ruleRequest = adventures.prepareDailyCrew{value: 0.001 ether}(tomorrow, 0.001 ether);
        wrapper.fulfill(ruleRequest, 93);
        // Keep today's chosen traits; all the actual births remain on yesterday's date.
        (,uint32 color,uint32 species,) = adventures.dailyCrew(tomorrow);
        (, uint256 parent,,,) = cards.provenance(crew[0]);
        uint256 mintTime = uint256(tomorrow) * 1 days - 1;
        vm.warp(mintTime);
        crew[0] = engine.child(cards, parent, ALICE, (color - 1) * 4, 10);
        crew[1] = engine.child(cards, parent, ALICE, 2, 11);
        crew[2] = engine.child(cards, parent, ALICE, (species - 1) * 24, 12);
        vm.warp(uint256(tomorrow) * 1 days);
        vm.expectRevert("one crew member must be born today");
        launchCrew(crew, crew[0], tomorrow);
    }

    function testCrewUpgradeSettlesAlreadyAcceptedSoloAdventure() public {
        uint256 id = original();
        uint256 pending = startAdventure(id);
        adventures.enableCrewAdventures();
        wrapper.fulfill(pending, seedFor(pending, id, false));
        assertTrue(adventures.getAdventure(pending).settled);
        assertEq(cards.ownerOf(id), ALICE);
        assertEq(adventures.unusedSerum(id).serumId, 0, "legacy draw remains unchanged");
    }

    function testCrewRuntimeFitsChainLimit() public view {
        bytes32 slot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        assertLe(address(uint160(uint256(vm.load(address(cards), slot)))).code.length, 24_576);
        assertLe(address(uint160(uint256(vm.load(address(adventures), slot)))).code.length, 24_576);
    }

    function testFuzzCrewAlwaysSettlesWithinCallbackGas(uint256 seed) public {
        (uint256[3] memory crew, uint64 day) = freshCrew();
        uint256 requestId = launchCrew(crew, crew[2], day);
        wrapper.fulfill(requestId, seed);
        assertTrue(adventures.getAdventure(requestId).settled);
        assertGt(adventures.unusedSerum(crew[2]).serumId, 0);
        assertEq(cards.ownerOf(crew[2]), ALICE);
    }

    function testCrewAcceptsNewPackPolicyWithIdenticalFrozenArtwork() public {
        (uint256[3] memory crew, uint64 day) = freshCrew();
        PackRegistry.Pack memory existing = packs.getPack(packId);
        uint256 newPack = packs.configureType(0, existing.rules, packs.getCatalog(packId));
        packs.setDailyClaimExpiry(newPack, true);
        packs.activate(newPack);
        assertTrue(packs.compatiblePack(newPack, packId));
        uint256 parent = engine.original(cards, newPack, ALICE, 0);
        crew[1] = engine.child(cards, parent, ALICE, 2, 1);
        uint256 requestId = launchCrew(crew, crew[2], day);
        wrapper.fulfill(requestId, 40);
        assertTrue(adventures.getAdventure(requestId).settled);
        existing.rules.artworkHash = keccak256("unapproved artwork");
        uint256 other = packs.configureType(0, existing.rules, packs.getCatalog(packId));
        packs.activate(other);
        assertFalse(packs.compatiblePack(other, packId));
    }

}
