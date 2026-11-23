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
        job = evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 0.001 ether, uint64(block.timestamp));
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

    function testFusionStaysPaidAndFusedCardCanUseSponsorship() public {
        uint256 a = original();
        uint256 job = fuse(a, child(a, 1));
        assertFalse(evolution.sponsoredRequest(job));
        assertEq(evolution.sponsoredSerumsUsed(), 0);
        assertEq(evolution.feeLiability(), 100_000);
        uint256 fused = complete(job);
        findSerum(fused);
        complete(drinkWithLimit(fused, 0));
        assertEq(evolution.sponsoredSerumsUsed(), 1);
        assertEq(usdc.balanceOf(FEES), 100_000);
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
        evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 0.001 ether, uint64(block.timestamp));
        engine.setPending(0);
        grading.setGraded(a);
        vm.prank(ALICE);
        vm.expectRevert("card already graded");
        adventures.adventure{value: 0.001 ether}(a, rulesHash, 0.001 ether, uint64(block.timestamp));
        vm.prank(ALICE);
        vm.expectRevert("card already graded");
        evolution.fuse{value: 0.001 ether}(a, b, ea, eb, 0.001 ether, uint64(block.timestamp));
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
}
