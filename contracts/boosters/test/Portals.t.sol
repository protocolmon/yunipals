// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {PortalCollection} from "../src/PortalCollection.sol";
import {PortalRegistry} from "../src/PortalRegistry.sol";
import {PortalRegistryV2} from "./fixtures/registry-v2/PortalRegistryV2.sol";
import {PortalRegistryV1} from "./fixtures/registry-v1/PortalRegistryV1.sol";
import {PortalGrading} from "../src/PortalGrading.sol";
import {PortalGradingValidator} from "../src/PortalGradingValidator.sol";
import {PortalGradingCompetition} from "../src/PortalGradingCompetition.sol";
import {PortalGates} from "../src/PortalGates.sol";
import {PortalRules} from "../src/PortalRules.sol";
import {MockWrapper, BoosterPacksTest} from "./BoosterPacks.t.sol";

contract PortalTestUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    address public blockedSender;
    address public reentryTarget;
    bytes public reentryData;
    bool public reentryRefused;
    address public shortRecipient;

    function configureReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function setShortRecipient(address recipient) external {
        shortRecipient = recipient;
    }

    function setBlockedSender(address sender) external {
        blockedSender = sender;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(from != blockedSender || from == address(0), "USDC transfer blocked");
        if (reentryTarget != address(0) && from == reentryTarget) {
            (bool ok, bytes memory reason) = reentryTarget.call(reentryData);
            require(
                !ok && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")),
                "reentry not guarded"
            );
            reentryRefused = true;
        }
        super._update(from, to, to == shortRecipient && amount > 0 ? amount - 1 : amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PortalTestEngine {
    PackRegistry public registry;

    constructor(PackRegistry registry_) {
        registry = registry_;
    }

    function original(YunipalMonsters cards, uint256 kind, address to, uint32 variant)
        external
        returns (uint256 id)
    {
        id = cards.reserveOriginal(kind);
        cards.mintOriginal(id, to, variant);
    }

    function child(YunipalMonsters cards, uint256 parent, address to, uint32 variant, uint32 sequence)
        external
        returns (uint256 id)
    {
        id = cards.mintOffspring(parent, to, variant);
        cards.recordMintFacts(id, sequence);
    }
    function onOriginalBurned(uint256) external {}
}

contract PortalGatesHarness {
    function accepts(uint16 start, uint16 length, uint32 sequence) external pure returns (bool) {
        PortalGates.Gates memory g;
        g.sequenceStart = start;
        g.sequenceLength = length;
        return PortalGates.sequenceMatches(g, sequence);
    }
}

contract PortalsTest is Test {
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant AI_WALLET = address(0xa100);
    address private constant PORTAL_WALLET = address(0xb100);
    uint256 private constant INTAKE_KEY = 0x1A7A;
    bytes32 private constant RUBRIC = keccak256("rubric-v1");
    bytes32 private constant MODELS = keccak256("models-v1");
    bytes32 private constant INPUT = keccak256("original image");
    PackRegistry private packs;
    YunipalMonsters private cards;
    PortalTestEngine private engine;
    PortalTestUSDC private usdc;
    MockWrapper private wrapper;
    PortalCollection private portals;
    PortalRegistry private registry;
    PortalGrading private grading;
    uint256 private card;
    uint256 private packId;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        vm.deal(address(this), 100 ether);
        vm.deal(ALICE, 10 ether);
        packs = PackRegistry(
            address(
                new ERC1967Proxy(
                    address(new PackRegistry()), abi.encodeCall(PackRegistry.initialize, (address(this)))
                )
            )
        );
        cards = YunipalMonsters(
            address(
                new ERC1967Proxy(
                    address(new YunipalMonsters()),
                    abi.encodeCall(YunipalMonsters.initialize, (address(this), packs))
                )
            )
        );
        engine = new PortalTestEngine(packs);
        usdc = new PortalTestUSDC();
        PackRegistry.Catalog memory catalog;
        catalog.types = new uint32[](11);
        catalog.colors = new uint32[](6);
        for (uint32 i; i < 11; ++i) {
            catalog.types[i] = i + 1;
        }
        for (uint32 i; i < 6; ++i) {
            catalog.colors[i] = i + 1;
        }
        catalog.horns = new uint32[](2);
        catalog.horns[0] = 1;
        catalog.horns[1] = 2;
        catalog.glitters = new uint32[](2);
        catalog.glitters[1] = 1;
        PackRegistry.Rules memory rules = PackRegistry.Rules(
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
        );
        packId = packs.configureType(0, rules, catalog);
        packs.activate(packId);
        card = engine.original(cards, packId, ALICE, 0);
        wrapper = new MockWrapper();
        IVRFV2PlusWrapper oracle = IVRFV2PlusWrapper(address(wrapper));
        portals = PortalCollection(
            address(
                new ERC1967Proxy(
                    address(new PortalCollection()),
                    abi.encodeCall(
                        PortalCollection.initialize, (address(this), oracle, uint16(3), new PortalRules())
                    )
                )
            )
        );
        registry = PortalRegistry(
            address(
                new ERC1967Proxy(
                    address(new PortalRegistryV2()),
                    abi.encodeCall(PortalRegistry.initialize, (address(this), portals, oracle, uint16(3)))
                )
            )
        );
        grading = PortalGrading(
            address(
                new ERC1967Proxy(
                    address(new PortalGrading()),
                    abi.encodeCall(
                        PortalGrading.initialize,
                        (
                            address(this),
                            cards,
                            registry,
                            IERC20(address(usdc)),
                            packId,
                            "https://example.com/portals/cards/"
                        )
                    )
                )
            )
        );
        cards.setGradingRegistry(address(grading));
        portals.bindClaimController(address(grading));
        grading.grantRole(grading.GRADER_ROLE(), address(this));
        PortalGates.Odds memory odds = portals.rainbowOdds();
        odds.originalBps = 10000;
        odds.glitterBps = 0;
        odds.diamondBps = 0;
        for (uint256 i; i < 6; ++i) {
            odds.colorWeights[i] = i == 0 ? 1 : 0;
        }
        for (uint256 i; i < 11; ++i) {
            odds.typeWeights[i] = i == 0 ? 1 : 0;
        }
        portals.configureKind(
            0,
            PortalCollection.KindDefinition(
                "Rainbow Portal", "ipfs://rainbow", keccak256("rainbow"), 1000, odds
            )
        );
        _mintPortals(1, 3);
        grading.setPaymentPolicy(1, 245_000, 245_000, AI_WALLET);
        grading.configureRubric(RUBRIC, MODELS, 20, "ipfs://rubric-v1");
        uint32[] memory variants = new uint32[](1);
        PortalGrading.Asset[] memory art = new PortalGrading.Asset[](1);
        art[0] = PortalGrading.Asset("ipfs://original-image", INPUT);
        grading.registerBaseArt(variants, art);
        usdc.mint(ALICE, 100_000_000);
        vm.prank(ALICE);
        usdc.approve(address(grading), type(uint256).max);
        grading.grantRole(grading.INTAKE_ROLE(), vm.addr(INTAKE_KEY));
        _rotate();
        registry.upgradeToAndCall(address(new PortalRegistry()), "");
    }

    function _mintPortals(uint256 kind, uint256 count) private returns (uint256 id) {
        address[] memory recipients = new address[](count);
        for (uint256 i; i < count; ++i) {
            recipients[i] = ALICE;
        }
        id = portals.mintBatch{value: 0.0001 ether}(kind, recipients, 0.0001 ether);
        wrapper.fulfill(id, 0);
        portals.finishMint(id, 32);
    }

    function _rotate() private returns (uint256 portalId) {
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 0);
        (PortalRegistry.Round memory current,) = registry.activePortal();
        portalId = current.portalId;
    }

    function _admission() private view returns (PortalGrading.Admission memory admission) {
        (PortalRegistry.Round memory current,) = registry.activePortal();
        (PortalGrading.Asset memory input, uint64 version) = grading.inputArtwork(card);
        admission = PortalGrading.Admission(
            card,
            current.portalId,
            current.id,
            1,
            version,
            RUBRIC,
            490_000,
            input.hash,
            keccak256("private spell commitment"),
            grading.nonces(ALICE)
        );
    }

    function _receipt(PortalGrading.Admission memory a)
        private
        returns (PortalGradingValidator.Receipt memory)
    {
        return _receiptFor(a, address(0), bytes32(0), ALICE);
    }

    function _receiptFor(PortalGrading.Admission memory a, address pool, bytes32 quote, address submitter)
        private
        returns (PortalGradingValidator.Receipt memory r)
    {
        r.expiresAt = uint64(block.timestamp + 300);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("YunipalsPortalIntake"),
                keccak256("1"),
                block.chainid,
                address(grading)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domain,
                keccak256(
                    abi.encode(
                        keccak256(
                            "StoredSpell(address submitter,bytes32 admissionHash,address competition,bytes32 competitionQuote,uint64 expiresAt)"
                        ),
                        submitter,
                        keccak256(abi.encode(a)),
                        pool,
                        quote,
                        r.expiresAt
                    )
                )
            )
        );
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(INTAKE_KEY, digest);
        r.signature = abi.encodePacked(rr, ss, v);
    }

    function _admit() private returns (uint256 id) {
        PortalGrading.Admission memory admission = _admission();
        vm.prank(ALICE);
        id = grading.admit(admission, _receipt(admission));
    }

    function _result(uint256 id, bool copied) private view returns (PortalGrading.Result memory result) {
        result.requestBinding = grading.requestBinding(id);
        result.artwork = PortalGrading.Asset("ipfs://edited-image", keccak256("edited image"));
        result.scores = [uint8(copied ? 20 : 95), 87, 92, 89];
        result.baseCreativity = 95;
        result.copied = copied;
        result.evidenceHash = copied ? keccak256("earlier published spell") : bytes32(0);
        result.reportHash = keccak256("full report");
        result.modelsHash = MODELS;
        result.reportURI = "ipfs://full-report";
        result.spellURI = "ipfs://published-spell";
    }

    function testStrictExpiryRejectsWithoutUSDCCharge() public {
        PortalGrading.Admission memory admission = _admission();
        (PortalRegistry.Round memory current,) = registry.activePortal();
        vm.warp(current.endsAt);
        (, bool accepting) = registry.activePortal();
        assertFalse(accepting);
        uint256 balance = usdc.balanceOf(ALICE);
        vm.expectRevert("portal window closed or changed");
        vm.prank(ALICE);
        grading.admit(admission, _receipt(admission));
        assertEq(usdc.balanceOf(ALICE), balance);
    }

    function testRotationStagedAndDifferentWithPoolSnapshot() public {
        (PortalRegistry.Round memory previous,) = registry.activePortal();
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 0);
        _mintPortals(1, 2);
        (uint64 expected, uint256 count,) = registry.rotations(id);
        assertEq(expected, previous.id + 1);
        assertEq(count, 3);
        (PortalRegistry.Round memory stillCurrent, bool stillAccepting) = registry.activePortal();
        assertEq(stillCurrent.id, previous.id);
        assertTrue(stillAccepting);
        vm.expectRevert("schedule full");
        registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        vm.warp(previous.endsAt);
        (PortalRegistry.Round memory current, bool accepting) = registry.activePortal();
        assertTrue(current.portalId != previous.portalId && current.portalId <= 3);
        assertEq(current.startsAt, previous.endsAt);
        assertTrue(accepting);
        assertEq(current.endsAt - current.startsAt, 660);
        vm.expectRevert("rotation not ready");
        registry.activateNext();
    }

    function testOnlyOnePendingRotationAndNoSeedOverwrite() public {
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        vm.expectRevert("rotation pending");
        registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 0);
        wrapper.fulfill(id, 999);
        (uint256 seed,, bool received) = registry.randomRequests(id);
        assertTrue(received);
        assertEq(seed, 0);
    }

    function testUtilitySelectionsNeverActivate() public {
        (PortalRegistry.Round memory beforeRound,) = registry.activePortal();
        uint256 id = registry.requestSelection{value: 0.0001 ether}(1, 0.0001 ether);
        (bool ready,) = registry.selectionResult(id);
        assertFalse(ready);
        wrapper.fulfill(id, 0);
        uint256 chosen;
        (ready, chosen) = registry.selectionResult(id);
        assertTrue(ready && chosen > 0 && chosen <= 3);
        (PortalRegistry.Round memory afterRound,) = registry.activePortal();
        assertEq(beforeRound.id, afterRound.id);
        assertEq(beforeRound.portalId, afterRound.portalId);
    }

    function testPaidJobCompletesAfterTransferAndWindowClosure() public {
        uint256 id = _admit();
        assertEq(usdc.balanceOf(AI_WALLET), 245_000);
        assertEq(usdc.balanceOf(address(grading)), 245_000);
        grading.setPaymentPolicy(1, 900_000, 800_000, BOB);
        PortalGrading.Request memory accepted = grading.getRequest(id);
        assertEq(accepted.payment.aiRecipient, AI_WALLET);
        assertEq(accepted.payment.aiFee, 245_000);
        vm.prank(ALICE);
        cards.transferFrom(ALICE, BOB, card);
        vm.warp(block.timestamp + 1000);
        grading.complete(id, _result(id, false));
        assertEq(cards.ownerOf(card), BOB);
        assertEq(grading.artVersion(card), 1);
        assertEq(grading.pendingRequest(card), 0);
        assertEq(cards.tokenURI(card), "https://example.com/portals/cards/1.json");
        PortalGrading.Result memory repeated = _result(id, false);
        vm.expectRevert("request not pending");
        grading.complete(id, repeated);
    }

    function testBurnDoesNotPreventHistoryOrRemintCard() public {
        uint256 id = _admit();
        vm.prank(ALICE);
        cards.burn(card);
        grading.complete(id, _result(id, false));
        assertEq(grading.historyCount(card), 1);
        vm.expectRevert();
        cards.ownerOf(card);
    }

    function testSinglePendingJobAndUnlimitedSerialAttemptsUseLatestArt() public {
        uint256 id = _admit();
        PortalGrading.Admission memory admission = _admission();
        vm.expectRevert("card has pending job");
        vm.prank(ALICE);
        grading.admit(admission, _receipt(admission));
        grading.complete(id, _result(id, false));
        uint256 second = _admit();
        PortalGrading.Request memory request = grading.getRequest(second);
        assertEq(request.artVersion, 1);
        assertEq(request.input.hash, keccak256("edited image"));
        grading.complete(second, _result(second, false));
        assertEq(grading.historyCount(card), 2);
        assertEq(usdc.balanceOf(AI_WALLET), 490_000);
    }

    function testStalePriceArtAndRoundAreRejectedAtomically() public {
        PortalGrading.Admission memory admission = _admission();
        grading.setPaymentPolicy(1, 300_000, 245_000, AI_WALLET);
        vm.expectRevert("price policy changed");
        vm.prank(ALICE);
        grading.admit(admission, _receipt(admission));
        admission.paymentVersion = 2;
        vm.expectRevert("fee exceeds quote");
        vm.prank(ALICE);
        grading.admit(admission, _receipt(admission));
        assertEq(usdc.balanceOf(ALICE), 100_000_000);
        assertEq(grading.nonces(ALICE), 0);
    }

    function testCopyPenaltyEnforcedOnchainAndGraderAuthorityRequired() public {
        uint256 id = _admit();
        PortalGrading.Result memory result = _result(id, true);
        result.scores[0] = 95;
        vm.expectRevert("originality cap mismatch");
        grading.complete(id, result);
        result.scores[0] = 20;
        vm.expectRevert();
        vm.prank(ALICE);
        grading.complete(id, result);
        grading.complete(id, result);
        assertEq(grading.getResult(id).scores[0], 20);
        assertEq(grading.completedBy(id), address(this));
    }

    function testOriginalOnlyBypassesSequenceButKeepsTypeAndColor() public {
        assertTrue(grading.matches(1, card));
        uint256 otherColor = engine.original(cards, packId, ALICE, 4);
        assertFalse(grading.matches(1, otherColor));
        uint256 child = engine.child(cards, card, ALICE, 0, 1);
        assertFalse(grading.matches(1, child));
    }

    function testHistoricalUnknownFactsFailClosedAndImportIsWriteOnce() public {
        bytes32 slot = keccak256(abi.encode(card, uint256(5)));
        vm.store(address(cards), slot, bytes32(0));
        // Legacy deployments have neither the facts nor the sequence bitmap.
        bytes32 family = keccak256(abi.encode(card, uint256(7)));
        vm.store(address(cards), keccak256(abi.encode(uint32(0), family)), bytes32(0));
        assertFalse(grading.matches(1, card));
        uint256[] memory ids = new uint256[](1);
        ids[0] = card;
        uint32[] memory sequences = new uint32[](1);
        uint64[] memory times = new uint64[](1);
        times[0] = uint64(block.timestamp);
        cards.importCardFacts(ids, sequences, times);
        assertTrue(grading.matches(1, card));
        vm.expectRevert("unknown or recorded card");
        cards.importCardFacts(ids, sequences, times);
        cards.closeCardFactsImport();
        vm.expectRevert("import unavailable");
        cards.importCardFacts(ids, sequences, times);
    }

    function testTrueGlitterAndDiamondGatesBothRemainRequiredForOriginals() public {
        PortalCollection.Kind memory kind = portals.getKind(1);
        kind.definition.odds.glitterBps = 10000;
        kind.definition.odds.diamondBps = 10000;
        portals.configureKind(0, kind.definition);
        _mintPortals(2, 1);
        assertFalse(grading.matches(1001, card));
        uint256 onlyGlitter = engine.original(cards, packId, ALICE, 1);
        uint256 onlyDiamond = engine.original(cards, packId, ALICE, 2);
        uint256 both = engine.original(cards, packId, ALICE, 3);
        assertFalse(grading.matches(1001, onlyGlitter));
        assertFalse(grading.matches(1001, onlyDiamond));
        assertTrue(grading.matches(1001, both));
    }

    function testUpgradesPreservePendingGradingRotationAndFixedGates() public {
        uint256 job = _admit();
        uint256 fundedPortal = grading.getRequest(job).portalId;
        uint256 retiredPortal = fundedPortal == 3 ? 2 : 3;
        uint48 originalRevision = portals.poolRevision();
        _claim(retiredPortal, ALICE);
        uint48 liveRevision = portals.poolRevision();
        bytes32 binding = grading.requestBinding(job);
        bytes32 fixedGates = keccak256(abi.encode(portals.gates(1)));
        uint256 rotation = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        address collectionImpl = address(new PortalCollection());
        address registryImpl = address(new PortalRegistry());
        address gradingImpl = address(new PortalGrading());
        vm.expectRevert();
        vm.prank(ALICE);
        portals.upgradeToAndCall(collectionImpl, "");
        portals.upgradeToAndCall(collectionImpl, "");
        registry.upgradeToAndCall(registryImpl, "");
        grading.upgradeToAndCall(gradingImpl, "");
        assertEq(grading.pendingRequest(card), job);
        assertEq(grading.requestBinding(job), binding);
        assertEq(registry.pendingRotation(), rotation);
        assertEq(keccak256(abi.encode(portals.gates(1))), fixedGates);
        assertEq(grading.portalBalances(fundedPortal), 245_000);
        assertEq(grading.totalPortalLiability(), 245_000);
        assertFalse(portals.exists(retiredPortal));
        assertEq(portals.poolRevision(), liveRevision);
        assertEq(portals.portalAtSnapshot(0, originalRevision, retiredPortal - 1), retiredPortal);
        grading.complete(job, _result(job, false));
        wrapper.fulfill(rotation, 123);
        (PortalRegistry.Round memory current,) = registry.activePortal();
        vm.warp(current.endsAt);
        (PortalRegistry.Round memory next, bool accepting) = registry.activePortal();
        assertEq(next.id, current.id + 1);
        assertTrue(accepting);
        assertEq(grading.historyCount(card), 1);
        _claim(fundedPortal, ALICE);
        assertEq(grading.totalPortalLiability(), 0);
    }

    function testCallbackOpensExpiredWindowAndDuplicatesCannotResetIt() public {
        (PortalRegistry.Round memory previous,) = registry.activePortal();
        vm.warp(previous.endsAt + 100);
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        vm.warp(block.timestamp + 10);
        wrapper.fulfill(id, 123);
        (PortalRegistry.Round memory current, bool accepting) = registry.activePortal();
        assertTrue(accepting);
        assertEq(current.startsAt, block.timestamp);
        assertEq(current.endsAt, block.timestamp + 660);
        assertEq(registry.pendingRotation(), 0);
        assertLt(wrapper.lastGasUsed(), registry.CALLBACK_GAS());
        PortalRegistry.Round[] memory upcoming = registry.upcomingRounds();
        PortalRegistry.Round memory last = upcoming[upcoming.length - 1];
        vm.warp(last.endsAt);
        wrapper.fulfill(id, 999);
        (PortalRegistry.Round memory expired, bool open) = registry.activePortal();
        assertFalse(open);
        assertEq(keccak256(abi.encode(expired)), keccak256(abi.encode(last)));
        vm.expectRevert("rotation not ready");
        registry.activateNext();
    }

    function testScheduledBoundaryPreservesAdmissionThenChangesWithoutTransaction() public {
        (PortalRegistry.Round memory previous,) = registry.activePortal();
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 123);
        vm.warp(previous.endsAt - 1);
        _admit(); // Existing grading contract still sees the old active round.
        (PortalRegistry.Round memory current, bool accepting) = registry.activePortal();
        assertEq(current.id, previous.id);
        assertTrue(accepting);
        vm.warp(previous.endsAt);
        (current, accepting) = registry.activePortal();
        assertEq(current.id, previous.id + 1);
        assertTrue(accepting);
        PortalRegistry.Round[] memory future = registry.upcomingRounds();
        uint256 tailPortal = future[future.length - 1].portalId;
        uint256 nextId = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        (, uint256 count, uint256 excluded) = registry.rotations(nextId);
        assertEq(count, 3);
        assertEq(excluded, portals.liveIndexPlusOne(tailPortal));
        wrapper.fulfill(nextId, 4);
        vm.warp(current.endsAt);
        (PortalRegistry.Round memory next, bool nextOpen) = registry.activePortal();
        assertEq(next.id, current.id + 1);
        assertTrue(nextOpen);
        assertTrue(next.portalId != current.portalId);
    }

    function testDeferredCallbackKeepsSeedAndOriginalClock() public {
        (PortalRegistry.Round memory previous,) = registry.activePortal();
        vm.warp(previous.endsAt);
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        vm.mockCallRevert(
            address(portals), abi.encodeWithSelector(portals.portalAtSnapshot.selector), "unavailable"
        );
        uint256 deliveredAt = vm.getBlockTimestamp();
        wrapper.fulfill(id, 123);
        (uint256 seed,, bool received) = registry.randomRequests(id);
        assertEq(seed, 123);
        assertTrue(received);
        assertEq(registry.pendingRotation(), id);
        assertEq(registry.rotationReceivedAt(), deliveredAt);
        vm.clearMockedCalls();
        vm.warp(deliveredAt + 12 * 660 + 40);
        vm.prank(BOB);
        registry.activateNext();
        (PortalRegistry.Round memory current, bool accepting) = registry.activePortal();
        assertEq(current.startsAt, deliveredAt + 11 * 660);
        assertEq(current.endsAt, deliveredAt + 12 * 660);
        assertFalse(accepting); // Recovery cannot buy extra time for a known draw.
    }

    function testUtilityCallbackCannotAdvanceRoundAndSelfEntryIsProtected() public {
        (PortalRegistry.Round memory previous,) = registry.activePortal();
        uint256 rotation = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        uint256 selection = registry.requestSelection{value: 0.0001 ether}(0, 0.0001 ether);
        wrapper.fulfill(selection, 7);
        assertEq(registry.pendingRotation(), rotation);
        assertEq(registry.rotationReceivedAt(), 0);
        (PortalRegistry.Round memory current,) = registry.activePortal();
        assertEq(current.id, previous.id);
        vm.expectRevert("self only");
        registry.resolveRotation(rotation);
        uint256[] memory words = new uint256[](1);
        vm.expectRevert("wrapper only");
        registry.rawFulfillRandomWords(rotation, words);
    }

    function testLegacyUpgradePreservesRoundAndHandlesAlreadyDeliveredSeed() public {
        PortalRegistryV1 old = _legacyRegistry();
        uint256 first = old.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(first, 10);
        old.activateNext();
        (PortalRegistryV1.Round memory previous,) = old.activePortal();
        uint256 id = old.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 20);
        PortalRegistry upgraded = _upgradeLegacy(old);
        (PortalRegistry.Round memory current, bool accepting) = upgraded.activePortal();
        assertEq(keccak256(abi.encode(current)), keccak256(abi.encode(previous)));
        assertTrue(accepting);
        assertEq(upgraded.pendingRotation(), id);
        assertEq(upgraded.rotationPoolRevision(id), old.rotationPoolRevision(id));
        upgraded.activateNext(); // One-time recovery of an already-delivered legacy request.
        vm.warp(previous.endsAt);
        (current, accepting) = upgraded.activePortal();
        assertTrue(accepting);
        assertEq(current.id, previous.id + 1);
        assertTrue(current.portalId != previous.portalId);
    }

    function testLegacyInFlightCallbackUsesOldGasBudgetWithoutLosingSeed() public {
        PortalRegistryV1 old = _legacyRegistry();
        uint256 id = old.requestRotation{value: 0.0001 ether}(0.0001 ether);
        PortalRegistry upgraded = _upgradeLegacy(old);
        assertEq(wrapper.limits(id), 160_000);
        wrapper.fulfill(id, 20);
        (uint256 seed,, bool received) = upgraded.randomRequests(id);
        assertTrue(received);
        assertEq(seed, 20);
        if (upgraded.pendingRotation() != 0) upgraded.activateNext();
        (PortalRegistry.Round memory current, bool accepting) = upgraded.activePortal();
        assertTrue(accepting);
        assertEq(current.id, 1);
        assertEq(upgraded.pendingRotation(), 0);
    }

    function _freshRegistry() private returns (PortalRegistry) {
        return PortalRegistry(
            address(
                new ERC1967Proxy(
                    address(new PortalRegistry()),
                    abi.encodeCall(
                        PortalRegistry.initialize,
                        (address(this), portals, IVRFV2PlusWrapper(address(wrapper)), uint16(3))
                    )
                )
            )
        );
    }

    function testQueueEmptyBootstrapAndEveryBoundary() public {
        PortalRegistry fresh = _freshRegistry();
        assertEq(fresh.refillCount(), 12);
        uint256 id = fresh.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 123);
        assertEq(fresh.pendingRotation(), 0);
        assertEq(fresh.refillCount(), 0);
        PortalRegistry.Round[] memory future = fresh.upcomingRounds();
        assertEq(future.length, 11);
        (PortalRegistry.Round memory previous, bool accepting) = fresh.activePortal();
        assertTrue(accepting);
        assertEq(previous.id, 1);
        vm.expectRevert("schedule full");
        fresh.requestRotation{value: 0.0001 ether}(0.0001 ether);
        for (uint256 i; i < 11; ++i) {
            assertEq(future[i].startsAt, previous.endsAt);
            assertEq(future[i].id, previous.id + 1);
            assertTrue(future[i].portalId != previous.portalId);
            vm.warp(future[i].startsAt - 1);
            (PortalRegistry.Round memory beforeBoundary,) = fresh.activePortal();
            assertEq(beforeBoundary.id, previous.id);
            vm.warp(future[i].startsAt);
            (previous, accepting) = fresh.activePortal();
            assertTrue(accepting);
            assertEq(previous.id, future[i].id);
            assertEq(previous.endsAt - previous.startsAt, 660);
            assertEq(fresh.upcomingRounds().length, 10 - i);
        }
        vm.warp(previous.endsAt);
        (, accepting) = fresh.activePortal();
        assertFalse(accepting);
        assertEq(fresh.refillCount(), 12);
    }

    function testQueueRefillAppendsWithoutChangingPublishedWindows() public {
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 12);
        PortalRegistry.Round[] memory before = registry.upcomingRounds();
        assertEq(before.length, 11);
        vm.warp(before[0].startsAt);
        assertEq(registry.refillCount(), 1);
        id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        (uint8 count, uint64 afterEnd) = registry.rotationBatches(id);
        assertEq(count, 1);
        assertEq(afterEnd, before[10].endsAt);
        wrapper.fulfill(id, 99);
        PortalRegistry.Round[] memory afterQueue = registry.upcomingRounds();
        assertEq(afterQueue.length, 11);
        for (uint256 i; i < 10; ++i) {
            assertEq(keccak256(abi.encode(afterQueue[i])), keccak256(abi.encode(before[i + 1])));
        }
        assertEq(afterQueue[10].startsAt, before[10].endsAt);
        assertTrue(afterQueue[10].portalId != before[10].portalId);
    }

    function testQueueDelayedBatchUsesFixedCountAndFreshFullWindow() public {
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        (uint8 count,) = registry.rotationBatches(id);
        assertEq(count, 11);
        vm.warp(block.timestamp + 50_000);
        wrapper.fulfill(id, 42);
        (PortalRegistry.Round memory current, bool accepting) = registry.activePortal();
        assertTrue(accepting);
        assertEq(current.startsAt, block.timestamp);
        assertEq(registry.upcomingRounds().length, 10);
        assertEq(registry.refillCount(), 1);
    }

    function testQueueSnapshotCannotRerollBurnedSelections() public {
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        for (uint256 i = 1; i <= 3; ++i) {
            _claim(i, ALICE);
        }
        _mintPortals(1, 3);
        wrapper.fulfill(id, 12);
        PortalRegistry.Round[] memory future = registry.upcomingRounds();
        assertEq(future.length, 11);
        for (uint256 i; i < future.length; ++i) {
            assertLe(future[i].portalId, 3);
            vm.warp(future[i].startsAt);
            (PortalRegistry.Round memory current, bool accepting) = registry.activePortal();
            assertEq(current.portalId, future[i].portalId);
            assertFalse(accepting);
        }
    }

    function testV2ScheduledAndPendingRequestsSurviveQueueUpgrade() public {
        PortalRegistryV2 old = PortalRegistryV2(
            address(
                new ERC1967Proxy(
                    address(new PortalRegistryV2()),
                    abi.encodeCall(
                        PortalRegistryV2.initialize,
                        (address(this), portals, IVRFV2PlusWrapper(address(wrapper)), uint16(3))
                    )
                )
            )
        );
        uint256 id = old.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 1);
        (PortalRegistryV2.Round memory first,) = old.activePortal();
        id = old.requestRotation{value: 0.0001 ether}(0.0001 ether);
        assertEq(wrapper.limits(id), 400_000);
        old.upgradeToAndCall(address(new PortalRegistry()), "");
        PortalRegistry upgraded = PortalRegistry(address(old));
        wrapper.fulfill(id, 7);
        if (upgraded.pendingRotation() != 0) upgraded.activateNext();
        assertEq(upgraded.upcomingRounds().length, 1);
        assertEq(upgraded.refillCount(), 10);
        PortalRegistry.Round memory scheduled = upgraded.upcomingRounds()[0];
        assertEq(scheduled.startsAt, first.endsAt);
        id = upgraded.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 8);
        PortalRegistry.Round[] memory future = upgraded.upcomingRounds();
        assertEq(future.length, 11);
        assertEq(keccak256(abi.encode(future[0])), keccak256(abi.encode(scheduled)));
        vm.warp(scheduled.startsAt);
        (PortalRegistry.Round memory active,) = upgraded.activePortal();
        assertEq(active.id, scheduled.id);
    }

    function testV2AlreadyScheduledAndDeliveredRecoveryPreserveClock() public {
        // The current fixture starts with a V2 round, so downgrade only this untouched local queue.
        registry.upgradeToAndCall(address(new PortalRegistryV2()), "");
        uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        vm.mockCallRevert(
            address(portals), abi.encodeWithSelector(portals.portalAtSnapshot.selector), "unavailable"
        );
        wrapper.fulfill(id, 123);
        uint64 delivered = registry.rotationReceivedAt();
        vm.clearMockedCalls();
        registry.upgradeToAndCall(
            address(new PortalRegistry()), abi.encodeCall(PortalRegistry.activateNext, ())
        );
        assertEq(registry.pendingRotation(), 0);
        assertEq(registry.upcomingRounds().length, 1);
        assertGt(delivered, 0);
        PortalRegistry.Round memory scheduled = registry.upcomingRounds()[0];
        // Upgrade a V2 with an already scheduled round, including one whose window has ended.
        registry.upgradeToAndCall(address(new PortalRegistryV2()), "");
        vm.warp(scheduled.endsAt + 1);
        registry.upgradeToAndCall(address(new PortalRegistry()), "");
        (PortalRegistry.Round memory expired, bool accepting) = registry.activePortal();
        assertFalse(accepting);
        assertEq(expired.id, scheduled.id);
        id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(id, 9);
        (PortalRegistry.Round memory current,) = registry.activePortal();
        assertEq(current.id, scheduled.id + 1);
        assertEq(registry.upcomingRounds().length, 11);
    }

    function testFuzzQueueBoundAndConsecutiveRounds(uint256 entropy) public {
        for (uint256 step; step < 20; ++step) {
            entropy = uint256(keccak256(abi.encode(entropy, step)));
            if (registry.refillCount() != 0) {
                uint256 id = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
                vm.warp(block.timestamp + entropy % 2000);
                wrapper.fulfill(id, entropy);
                assertEq(registry.pendingRotation(), 0);
            }
            PortalRegistry.Round[] memory future = registry.upcomingRounds();
            assertLe(future.length, 11);
            (PortalRegistry.Round memory previous,) = registry.activePortal();
            for (uint256 i; i < future.length; ++i) {
                assertEq(future[i].id, previous.id + 1);
                assertEq(future[i].startsAt, previous.endsAt);
                assertTrue(future[i].portalId != previous.portalId);
                previous = future[i];
            }
            vm.warp(block.timestamp + entropy % 10000);
        }
    }

    function _legacyRegistry() private returns (PortalRegistryV1) {
        return PortalRegistryV1(
            address(
                new ERC1967Proxy(
                    address(new PortalRegistryV1()),
                    abi.encodeCall(
                        PortalRegistryV1.initialize,
                        (address(this), portals, IVRFV2PlusWrapper(address(wrapper)), uint16(3))
                    )
                )
            )
        );
    }

    function _upgradeLegacy(PortalRegistryV1 old) private returns (PortalRegistry) {
        address implementation = address(new PortalRegistry());
        vm.expectRevert();
        vm.prank(BOB);
        old.upgradeToAndCall(implementation, "");
        old.upgradeToAndCall(implementation, "");
        PortalRegistry upgraded = PortalRegistry(address(old));
        assertEq(address(upgraded.collection()), address(portals));
        assertEq(address(upgraded.wrapper()), address(wrapper));
        assertEq(upgraded.confirmations(), 3);
        assertTrue(upgraded.hasRole(upgraded.UPGRADER_ROLE(), address(this)));
        return upgraded;
    }

    function testDuplicateFamilySequenceIsRejectedAndWrongResultBindingCannotComplete() public {
        engine.child(cards, card, ALICE, 1, 1);
        vm.expectRevert("family sequence already assigned");
        engine.child(cards, card, ALICE, 2, 1);
        uint256 job = _admit();
        PortalGrading.Result memory result = _result(job, false);
        result.requestBinding = keccak256("a different deployment or request");
        vm.expectRevert();
        grading.complete(job, result);
        assertEq(grading.pendingRequest(card), job);
    }

    function testFrozenKindReservedCapAndSeparateTokenRanges() public {
        PortalCollection.Kind memory kind = portals.getKind(1);
        vm.expectRevert("invalid or frozen kind");
        portals.configureKind(1, kind.definition);
        kind.definition.cap = 2;
        portals.configureKind(0, kind.definition);
        address[] memory recipients = new address[](2);
        recipients[0] = ALICE;
        recipients[1] = BOB;
        uint256 id = portals.mintBatch{value: 0.0001 ether}(2, recipients, 0.0001 ether);
        assertEq(portals.portalCount(2), 0);
        address[] memory extra = new address[](1);
        extra[0] = ALICE;
        vm.expectRevert("kind cap");
        portals.mintBatch{value: 0.0001 ether}(2, extra, 0.0001 ether);
        wrapper.fulfill(id, 0);
        portals.finishMint(id, 1);
        assertEq(portals.ownerOf(1001), ALICE);
        assertEq(portals.portalCount(2), 1);
        portals.finishMint(id, 1);
        assertEq(portals.ownerOf(1002), BOB);
        assertEq(portals.portalCount(2), 2);
    }

    function _claim(uint256 portalId, address owner) private {
        vm.prank(owner);
        grading.burnAndClaim(portalId, 0, uint64(block.timestamp + 600));
    }

    function testBalanceFollowsTransferAndClaimBurnsWhileJobCompletes() public {
        uint256 job = _admit();
        uint256 portalId = grading.getRequest(job).portalId;
        bytes32 binding = grading.requestBinding(job);
        assertEq(grading.claimable(portalId), 245_000);
        assertEq(grading.totalPortalLiability(), 245_000);
        vm.prank(ALICE);
        portals.transferFrom(ALICE, BOB, portalId);
        vm.expectRevert("portal owner only");
        vm.prank(ALICE);
        grading.burnAndClaim(portalId, 0, uint64(block.timestamp + 600));
        _claim(portalId, BOB);
        assertEq(usdc.balanceOf(BOB), 245_000);
        assertEq(grading.claimable(portalId), 0);
        assertEq(grading.totalPortalLiability(), 0);
        assertFalse(portals.exists(portalId));
        assertEq(portals.livePortalCount(0), 2);
        assertEq(portals.portalCount(0), 3);
        assertEq(portals.getKind(1).allocated, 3);
        (, bool accepting) = registry.activePortal();
        assertFalse(accepting);
        assertFalse(grading.matches(portalId, card));
        assertEq(grading.requestBinding(job), binding);
        grading.complete(job, _result(job, false));
        assertEq(grading.historyCount(card), 1);
        vm.expectRevert();
        _claim(portalId, BOB);
        (uint256 kindId,, address owner) = portals.portalRecord(portalId);
        assertEq(kindId, 1);
        assertEq(owner, address(0));
        vm.expectRevert();
        portals.tokenURI(portalId);
    }

    function testClaimsAreOwnerOnlyAndCannotBypassController() public {
        vm.prank(ALICE);
        portals.setApprovalForAll(BOB, true);
        vm.expectRevert("portal owner only");
        vm.prank(BOB);
        grading.burnAndClaim(1, 0, uint64(block.timestamp + 600));
        vm.expectRevert("portal owner only");
        grading.burnAndClaim(1, 0, uint64(block.timestamp + 600));
        vm.expectRevert("claim controller only");
        vm.prank(ALICE);
        portals.burnForClaim(1, ALICE);
        vm.expectRevert("invalid controller");
        portals.bindClaimController(address(grading));
        vm.expectRevert("portal fee must accrue");
        grading.setPaymentPolicy(1, 1, 1, AI_WALLET, PORTAL_WALLET);
        vm.expectRevert("invalid AI recipient");
        grading.setPaymentPolicy(1, 1, 1, address(grading));
    }

    function testPayoutFailureRestoresNFTBalanceAndPoolSnapshot() public {
        uint256 job = _admit();
        uint256 portalId = grading.getRequest(job).portalId;
        uint48 revision = portals.poolRevision();
        usdc.setBlockedSender(address(grading));
        vm.expectRevert("USDC transfer blocked");
        _claim(portalId, ALICE);
        assertEq(portals.ownerOf(portalId), ALICE);
        assertEq(portals.poolRevision(), revision);
        assertEq(portals.livePortalCount(0), 3);
        assertEq(grading.portalBalances(portalId), 245_000);
        assertEq(grading.totalPortalLiability(), 245_000);
        usdc.setBlockedSender(address(0));
        _claim(portalId, ALICE);
        assertEq(grading.totalPortalLiability(), 0);
    }

    function testClaimMinimumDeadlinePausesAndDonations() public {
        uint256 job = _admit();
        uint256 portalId = grading.getRequest(job).portalId;
        vm.expectRevert("claim below minimum");
        vm.prank(ALICE);
        grading.burnAndClaim(portalId, 245_001, uint64(block.timestamp + 600));
        vm.expectRevert("claim deadline expired");
        vm.prank(ALICE);
        grading.burnAndClaim(portalId, 0, uint64(block.timestamp - 1));
        usdc.mint(address(grading), 12_345);
        grading.pauseAdmissions(true);
        registry.pauseRandomness(true);
        portals.pauseRandomness(true);
        uint256 balance = usdc.balanceOf(ALICE);
        _claim(portalId, ALICE);
        assertEq(usdc.balanceOf(ALICE), balance + 245_000);
        assertEq(usdc.balanceOf(address(grading)), 12_345);
        grading.complete(job, _result(job, false));
    }

    function testRetiredRotationKeepsChosenIdAndConsumesClosedWindow() public {
        (PortalRegistry.Round memory beforeRound,) = registry.activePortal();
        uint256 requestId = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(requestId, 42);
        (, uint256 count, uint256 excluded) = registry.rotations(requestId);
        uint256 index = PortalGates.uniform(
            keccak256(abi.encode(uint256(42), address(registry), requestId, "rotation-batch", uint8(0))),
            count - 1
        );
        if (index >= excluded - 1) ++index;
        uint48 revision = registry.rotationPoolRevision(requestId);
        uint256 chosen = portals.portalAtSnapshot(0, revision, index);
        _claim(chosen, ALICE);
        _mintPortals(1, 1);
        assertEq(portals.portalAtSnapshot(0, revision, index), chosen);
        vm.warp(beforeRound.endsAt);
        (PortalRegistry.Round memory unavailable, bool accepting) = registry.activePortal();
        assertEq(unavailable.portalId, chosen);
        assertFalse(accepting);
        assertEq(unavailable.endsAt - unavailable.startsAt, 660);
        uint256 next = registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        wrapper.fulfill(next, 7);
        vm.warp(unavailable.endsAt);
        (PortalRegistry.Round memory survivor, bool open) = registry.activePortal();
        assertTrue(open && portals.exists(survivor.portalId));
    }

    function testUtilitySnapshotAndOneThenZeroLiveSupply() public {
        uint256 requestId = registry.requestSelection{value: 0.0001 ether}(1, 0.0001 ether);
        wrapper.fulfill(requestId, 10);
        (bool ready, uint256 chosen, uint48 revision, bool available) = registry.selectionStatus(requestId);
        assertTrue(ready && available);
        _claim(chosen, ALICE);
        uint256 same;
        (ready, same,, available) = registry.selectionStatus(requestId);
        assertEq(same, chosen);
        assertFalse(available);
        for (uint256 tokenId = 1; tokenId <= 3; ++tokenId) {
            assertEq(portals.portalAtSnapshot(1, revision, tokenId - 1), tokenId);
        }
        uint256 survivor;
        for (uint256 tokenId = 1; tokenId <= 3; ++tokenId) {
            if (portals.exists(tokenId)) {
                if (survivor == 0) survivor = tokenId;
                else _claim(tokenId, ALICE);
            }
        }
        (PortalRegistry.Round memory current,) = registry.activePortal();
        vm.warp(current.endsAt);
        assertEq(_rotate(), survivor);
        (current,) = registry.activePortal();
        vm.warp(current.endsAt);
        assertEq(_rotate(), survivor);
        _claim(survivor, ALICE);
        assertEq(portals.livePortalCount(0), 0);
        vm.expectRevert("not enough portals");
        registry.requestRotation{value: 0.0001 ether}(0.0001 ether);
        vm.expectRevert("empty pool");
        registry.requestSelection{value: 0.0001 ether}(0, 0.0001 ether);
    }

    function testFuzzPoolSnapshotsSurviveBurnsAndRefilledPositions(uint256 seed) public {
        _mintPortals(1, 12);
        (uint48 revision, uint256 count) = portals.poolSnapshot(0);
        for (uint256 i; i < 10; ++i) {
            uint256 at = uint256(keccak256(abi.encode(seed, i))) % portals.livePortalCount(0);
            uint256 tokenId = portals.portalAtSnapshot(0, portals.poolRevision(), at);
            _claim(tokenId, ALICE);
        }
        _mintPortals(1, 5);
        assertEq(portals.livePortalCount(0), 10);
        for (uint256 i; i < count; ++i) {
            assertEq(portals.portalAtSnapshot(0, revision, i), i + 1);
        }
        for (uint256 i; i < 10; ++i) {
            uint256 tokenId = portals.portalAtSnapshot(0, portals.poolRevision(), i);
            assertTrue(portals.exists(tokenId));
            assertEq(portals.liveIndexPlusOne(tokenId), i + 1);
        }
    }

    function testFullKindPoolHasBoundedClaimAndHistoricalRead() public {
        for (uint256 remaining = 997; remaining != 0;) {
            uint256 quantity = remaining > 32 ? 32 : remaining;
            _mintPortals(1, quantity);
            remaining -= quantity;
        }
        (uint48 revision, uint256 count) = portals.poolSnapshot(1);
        assertEq(count, 1000);
        uint256 gasBefore = gasleft();
        _claim(500, ALICE);
        assertLt(gasBefore - gasleft(), 600_000);
        assertEq(portals.portalAtSnapshot(1, revision, 499), 500);
        assertEq(portals.portalAtSnapshot(1, portals.poolRevision(), 499), 1000);
        assertEq(portals.getKind(1).allocated, 1000);
        address[] memory extra = new address[](1);
        extra[0] = ALICE;
        vm.expectRevert("kind cap");
        portals.mintBatch{value: 0.0001 ether}(1, extra, 0.0001 ether);
    }

    function testReentrantPayoutCannotRedeemAnotherPortal() public {
        uint256 job = _admit();
        uint256 funded = grading.getRequest(job).portalId;
        uint256 other = funded == 1 ? 2 : 1;
        vm.prank(ALICE);
        portals.transferFrom(ALICE, address(usdc), other);
        usdc.configureReentry(
            address(grading), abi.encodeCall(grading.burnAndClaim, (other, 0, uint64(block.timestamp + 600)))
        );
        _claim(funded, ALICE);
        assertTrue(usdc.reentryRefused());
        assertTrue(portals.exists(other));
        assertEq(grading.totalPortalLiability(), 0);
    }

    function testShortDepositRevertsAITransferAndAdmission() public {
        usdc.setShortRecipient(address(grading));
        PortalGrading.Admission memory admission = _admission();
        vm.expectRevert("incorrect portal deposit");
        vm.prank(ALICE);
        grading.admit(admission, _receipt(admission));
        assertEq(usdc.balanceOf(AI_WALLET), 0);
        assertEq(usdc.balanceOf(ALICE), 100_000_000);
        assertEq(grading.totalPortalLiability(), 0);
        assertEq(grading.requestCount(), 0);
        assertEq(grading.nonces(ALICE), 0);
    }

    function testZeroFeeAdmissionAndCompletionDoNotCreditAgain() public {
        grading.setPaymentPolicy(1, 0, 0, AI_WALLET);
        PortalGrading.Admission memory admission = _admission();
        admission.paymentVersion = 2;
        admission.maximumFee = 0;
        vm.prank(ALICE);
        uint256 job = grading.admit(admission, _receipt(admission));
        assertEq(usdc.balanceOf(ALICE), 100_000_000);
        _claim(admission.portalId, ALICE);
        grading.complete(job, _result(job, false));
        assertEq(grading.totalPortalLiability(), 0);
        assertEq(grading.portalBalances(admission.portalId), 0);
    }

    function testMultiplePortalLiabilitiesRemainBackedAfterFeeChangesAndClaims() public {
        uint256 first = _admit();
        uint256 firstPortal = grading.getRequest(first).portalId;
        grading.complete(first, _result(first, false));
        (PortalRegistry.Round memory current,) = registry.activePortal();
        vm.warp(current.endsAt);
        uint256 secondPortal = _rotate();
        grading.setPaymentPolicy(1, 1, 500_000, AI_WALLET);
        PortalGrading.Admission memory admission = _admission();
        admission.paymentVersion = 2;
        admission.maximumFee = 500_001;
        vm.prank(ALICE);
        uint256 second = grading.admit(admission, _receipt(admission));
        assertEq(grading.totalPortalLiability(), 745_000);
        assertEq(usdc.balanceOf(address(grading)), 745_000);
        _claim(firstPortal, ALICE);
        assertEq(grading.claimable(secondPortal), 500_000);
        assertEq(grading.totalPortalLiability(), 500_000);
        _claim(secondPortal, ALICE);
        grading.complete(second, _result(second, false));
        assertEq(usdc.balanceOf(address(grading)), 0);
        assertEq(grading.totalPortalLiability(), 0);
    }

    function _competition() private returns (PortalGradingCompetition pool) {
        pool = PortalGradingCompetition(
            address(
                new ERC1967Proxy(
                    address(new PortalGradingCompetition()),
                    abi.encodeCall(
                        PortalGradingCompetition.initialize,
                        (address(this), address(grading), IERC20(address(usdc)))
                    )
                )
            )
        );
        grading.configureCompetition(pool);
    }

    function testCompetitionExactFeesImmediateGradeAndTransfer() public {
        PortalGradingCompetition pool = _competition();
        bytes32 rules = pool.admissionHash();
        PortalGrading.Admission memory admission = _admission();
        admission.maximumFee = 990_000;
        uint256 before = usdc.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 id = grading.admitCompetition(
            admission, address(pool), rules, _receiptFor(admission, address(pool), rules, ALICE)
        );
        assertEq(before - usdc.balanceOf(ALICE), 990_000);
        assertEq(usdc.balanceOf(AI_WALLET), 245_000);
        assertEq(grading.claimable(admission.portalId), 245_000);
        assertEq(usdc.balanceOf(address(pool)), 500_000);
        assertTrue(grading.competitionCommitments(id) != bytes32(0));
        vm.prank(ALICE);
        cards.transferFrom(ALICE, BOB, card);
        vm.prank(ALICE);
        grading.burnAndClaim(admission.portalId, 245_000, uint64(block.timestamp));
        grading.complete(id, _result(id, true));
        assertTrue(grading.getRequest(id).completed);
        assertEq(grading.artVersion(card), 1);
        assertEq(pool.getBatch(1).completed, 1);
        assertFalse(pool.ready(1));
        assertEq(pool.getEntry(1).submitter, ALICE);
        assertEq(pool.getEntry(1).score, 20 + 87 + 92 + 89);
    }

    function testThemedBoundaryRejectsPaymentAndPinsTheReviewedChallenge() public {
        PortalGradingCompetition pool = _competition();
        usdc.mint(ALICE, 200_000_000);
        bytes32 quote = pool.admissionHash();
        for (uint256 i; i < 111; ++i) {
            PortalGrading.Admission memory a = _admission();
            a.maximumFee = 990_000;
            vm.prank(ALICE);
            uint256 id = grading.admitCompetition(
                a, address(pool), quote, _receiptFor(a, address(pool), quote, ALICE)
            );
            grading.complete(id, _result(id, false));
        }
        PortalGrading.Admission memory next = _admission();
        next.maximumFee = 990_000;
        uint256 balance = usdc.balanceOf(ALICE);
        uint256 portalBalance = grading.totalPortalLiability();
        bytes32 waiting = pool.admissionHash();
        vm.prank(ALICE);
        vm.expectRevert("next theme pending");
        grading.admitCompetition(
            next, address(pool), waiting, _receiptFor(next, address(pool), waiting, ALICE)
        );
        assertEq(usdc.balanceOf(ALICE), balance);
        assertEq(pool.totalLiability(), 55_500_000);
        assertEq(grading.totalPortalLiability(), portalBalance);
        assertEq(grading.requestCount(), 111);
        pool.publishTheme(
            2,
            pool.themeSourcesHash(2),
            keccak256("a"),
            keccak256("p"),
            "Guardians",
            "Create your own guardian.",
            "https://example.test/theme"
        );
        vm.prank(ALICE);
        vm.expectRevert(PortalGrading.CompetitionQuote.selector);
        grading.admitCompetition(next, address(pool), quote, _receiptFor(next, address(pool), quote, ALICE));
        assertEq(usdc.balanceOf(ALICE), balance);
        bytes32 fresh = pool.admissionHash();
        vm.prank(ALICE);
        grading.admitCompetition(next, address(pool), fresh, _receiptFor(next, address(pool), fresh, ALICE));
        assertEq(pool.getBatch(2).funded, 1);
        assertEq(balance - usdc.balanceOf(ALICE), 990_000);
    }

    function testCompetitionRejectsOldUnderpricedAndWrongQuotesWithoutCharging() public {
        PortalGradingCompetition pool = _competition();
        bytes32 rules = pool.admissionHash();
        PortalGrading.Admission memory admission = _admission();
        uint256 before = usdc.balanceOf(ALICE);
        vm.expectRevert(PortalGrading.InternalAdmissionOnly.selector);
        grading.admitFor(admission, ALICE, _receipt(admission));
        vm.prank(ALICE);
        vm.expectRevert(PortalGrading.CompetitionQuote.selector);
        grading.admit(admission, _receipt(admission));
        vm.prank(ALICE);
        vm.expectRevert("fee exceeds quote");
        grading.admitCompetition(
            admission, address(pool), rules, _receiptFor(admission, address(pool), rules, ALICE)
        );
        admission.maximumFee = 990_000;
        vm.prank(ALICE);
        vm.expectRevert(PortalGrading.CompetitionQuote.selector);
        grading.admitCompetition(
            admission, address(pool), bytes32(0), _receiptFor(admission, address(pool), bytes32(0), ALICE)
        );
        usdc.setShortRecipient(address(pool));
        vm.prank(ALICE);
        vm.expectRevert(PortalGrading.CompetitionDeposit.selector);
        grading.admitCompetition(
            admission, address(pool), rules, _receiptFor(admission, address(pool), rules, ALICE)
        );
        assertEq(usdc.balanceOf(ALICE), before);
        assertEq(grading.requestCount(), 0);
        assertEq(pool.entryCount(), 0);
        assertEq(grading.totalPortalLiability(), 0);
    }

    function testLegacyRequestBindingAndCompletionAcrossCompetitionActivation() public {
        uint256 id = _admit();
        bytes32 binding = grading.requestBinding(id);
        _competition();
        assertEq(grading.requestBinding(id), binding);
        grading.complete(id, _result(id, false));
        assertEq(grading.competition().entryCount(), 0);
        assertEq(grading.competitionCommitments(id), bytes32(0));
    }

    function testCompetitionPolicyFreezeAndDeferredNotificationRecovery() public {
        PortalGradingCompetition pool = _competition();
        bytes32 rules = pool.admissionHash();
        PortalGrading.Admission memory admission = _admission();
        admission.maximumFee = 990_000;
        vm.prank(ALICE);
        uint256 id = grading.admitCompetition(
            admission, address(pool), rules, _receiptFor(admission, address(pool), rules, ALICE)
        );
        vm.expectRevert(PortalGrading.CompetitionPolicyFrozen.selector);
        grading.configureRubric(keccak256("next"), MODELS, 20, "ipfs://next-rubric");
        vm.mockCallRevert(
            address(pool), abi.encodeCall(pool.recordCompleted, (id)), abi.encode("temporary failure")
        );
        grading.complete(id, _result(id, false));
        assertTrue(grading.getRequest(id).completed);
        assertEq(pool.getBatch(1).completed, 0);
        vm.clearMockedCalls();
        vm.prank(BOB);
        pool.recordCompleted(id);
        assertEq(pool.getBatch(1).completed, 1);
    }

    function testIntakeRejectsMissingExpiredAndRevokedReceiptsWithoutCharging() public {
        PortalGrading.Admission memory a = _admission();
        uint256 balance = usdc.balanceOf(ALICE);
        PortalGradingValidator.Receipt memory missing;
        vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
        vm.prank(ALICE);
        grading.admit(a, missing);
        PortalGradingValidator.Receipt memory r = _receipt(a);
        vm.warp(block.timestamp + 301);
        vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
        vm.prank(ALICE);
        grading.admit(a, r);
        r = _receipt(a);
        grading.revokeRole(grading.INTAKE_ROLE(), vm.addr(INTAKE_KEY));
        vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
        vm.prank(ALICE);
        grading.admit(a, r);
        assertEq(usdc.balanceOf(ALICE), balance);
        assertEq(grading.requestCount(), 0);
        assertEq(grading.totalPortalLiability(), 0);
    }

    function testIntakeBindsEveryAdmissionFieldAndWallet() public {
        PortalGrading.Admission memory original = _admission();
        PortalGradingValidator.Receipt memory r = _receipt(original);
        uint256 balance = usdc.balanceOf(ALICE);
        for (uint256 i; i < 10; ++i) {
            PortalGrading.Admission memory a = abi.decode(abi.encode(original), (PortalGrading.Admission));
            if (i == 0) a.tokenId++;
            if (i == 1) a.portalId++;
            if (i == 2) a.roundId++;
            if (i == 3) a.paymentVersion++;
            if (i == 4) a.artVersion++;
            if (i == 5) a.rubricId = keccak256("other rubric");
            if (i == 6) a.maximumFee++;
            if (i == 7) a.inputHash = keccak256("other image");
            if (i == 8) a.spellCommitment = keccak256("other spell");
            if (i == 9) a.nonce++;
            vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
            vm.prank(ALICE);
            grading.admit(a, r);
        }
        vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
        vm.prank(BOB);
        grading.admit(original, r);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
        vm.prank(ALICE);
        grading.admit(original, r);
        assertEq(usdc.balanceOf(ALICE), balance);
        assertEq(grading.requestCount(), 0);
    }

    function testIntakeBindsCompetitionAndCannotReplayOrBypass() public {
        PortalGrading.Admission memory a = _admission();
        PortalGradingValidator.Receipt memory legacy = _receipt(a);
        PortalGradingCompetition pool = _competition();
        a.maximumFee = 990_000;
        bytes32 quote = pool.admissionHash();
        vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
        vm.prank(ALICE);
        grading.admitCompetition(a, address(pool), quote, legacy);
        PortalGradingValidator.Receipt memory wrong = _receiptFor(a, address(pool), bytes32(0), ALICE);
        vm.expectRevert(PortalGradingValidator.InvalidIntakeReceipt.selector);
        vm.prank(ALICE);
        grading.admitCompetition(a, address(pool), quote, wrong);
        PortalGradingValidator.Receipt memory r = _receiptFor(a, address(pool), quote, ALICE);
        vm.expectRevert(PortalGrading.InternalAdmissionOnly.selector);
        vm.prank(ALICE);
        grading.admitFor(a, ALICE, r);
        vm.prank(ALICE);
        (bool bypass,) = address(grading)
            .call(
                abi.encodeWithSignature(
                    "admitCompetition((uint256,uint256,uint64,uint64,uint64,bytes32,uint256,bytes32,bytes32,uint256),address,bytes32)",
                    a,
                    address(pool),
                    quote
                )
            );
        assertFalse(bypass);
        vm.prank(ALICE);
        uint256 id = grading.admitCompetition(a, address(pool), quote, r);
        grading.complete(id, _result(id, false));
        vm.expectRevert(bytes("invalid spell or nonce"));
        vm.prank(ALICE);
        grading.admitCompetition(a, address(pool), quote, r);
        assertEq(grading.requestCount(), 1);
        assertEq(pool.entryCount(), 1);
        assertEq(usdc.balanceOf(address(pool)), 500_000);
    }

    function testCompetitionSpansIndependentElevenMinutePortals() public {
        PortalGradingCompetition pool = _competition();
        bytes32 quote = pool.admissionHash();
        PortalGrading.Admission memory a = _admission();
        a.maximumFee = 990_000;
        vm.prank(ALICE);
        uint256 first =
            grading.admitCompetition(a, address(pool), quote, _receiptFor(a, address(pool), quote, ALICE));
        grading.complete(first, _result(first, false));
        (PortalRegistry.Round memory previous,) = registry.activePortal();
        vm.warp(previous.endsAt);
        uint256 next = _rotate();
        assertTrue(next != previous.portalId);
        a = _admission();
        a.maximumFee = 990_000;
        vm.prank(ALICE);
        uint256 second =
            grading.admitCompetition(a, address(pool), quote, _receiptFor(a, address(pool), quote, ALICE));
        assertEq(pool.batchOf(pool.entryForRequest(first)), 1);
        assertEq(pool.batchOf(pool.entryForRequest(second)), 1);
        assertEq(pool.getBatch(1).funded, 2);
        assertTrue(pool.admissionsOpen());
        (PortalRegistry.Round memory current,) = registry.activePortal();
        assertEq(current.endsAt - current.startsAt, 660);
    }

    function testFuzzCircularRangesHaveExactCoverage(uint16 startSeed, uint8 lengthSeed) public {
        uint16 start = startSeed % 264;
        uint16 length = lengthSeed % 3 == 0 ? 1 : lengthSeed % 3 == 1 ? 10 : 100;
        PortalGatesHarness harness = new PortalGatesHarness();
        uint256 count;
        for (uint32 sequence; sequence < 264; ++sequence) {
            if (harness.accepts(start, length, sequence)) ++count;
        }
        assertEq(count, length);
        assertFalse(harness.accepts(start, length, 264));
        assertTrue(harness.accepts(260, 10, 3));
        assertFalse(harness.accepts(260, 10, 6));
    }
}

contract CardFactsEngineTest is BoosterPacksTest {
    function testBatchSequenceIsCumulativeAndMintTimeIsActual() public {
        uint256 original = reveal();
        (uint32 sequence, uint64 born, bool known) = monsters.cardFacts(original);
        assertTrue(known);
        assertEq(sequence, 0);
        assertEq(born, block.timestamp);
        vm.warp(block.timestamp + 3 days);
        uint256 firstChild = monsters.nextTokenId();
        vm.prank(alice);
        uint256 id = engine.claim{value: 0.0001 ether}(original, 3, 0.0001 ether, block.timestamp);
        wrapper.fulfill(id, 0);
        for (uint32 i; i < 3; ++i) {
            (sequence, born, known) = monsters.cardFacts(firstChild + i);
            assertTrue(known);
            assertEq(sequence, i + 1);
            assertEq(born, block.timestamp);
        }
    }
}
