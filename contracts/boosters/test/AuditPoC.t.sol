// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Independent audit reproductions for snapshot 03855c82b4f74ca350f161b6c927bebcb94d4b4831629a631930af7f42bd10d0.
// Original auditor tests are archived in docs/boosters/audit/response-2026-10-19/test/.
// Adapted below for F-01/F-08 fixes, with additional activation regressions. F-02 absent-proof cases remain negative controls; original-proof recovery is tested separately.

import {ProofDependencyMocks} from "./ProofDependencyMocks.sol";
import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {VariantDraw} from "../src/VariantDraw.sol";

contract AuditProto is ERC20 {
    constructor() ERC20("PROTO", "PROTO") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

/// @dev Mirrors the real VRFV2PlusWrapper 1.4.0 fulfillment path: exact-gas call, failure swallowed,
///      request consumed either way (the random word is lost if the consumer reverts).
contract AuditWrapper is ProofDependencyMocks {
    uint256 public constant PRICE = 0.0001 ether;
    uint256 public nextId;
    bool public disabled;
    uint256 public lastGasUsed;
    bool public lastSuccess;
    mapping(uint256 => address) public consumers;
    mapping(uint256 => uint32) public limits;

    function setNextId(uint256 id) external {
        nextId = id - 1;
    }

    function setCallbackLimit(uint256 id, uint32 limit) external {
        limits[id] = limit;
    }

    function setDisabled(bool value) external {
        disabled = value;
    }

    function estimateRequestPriceNative(uint32, uint32, uint256) external view returns (uint256) {
        require(!disabled, "wrapper is disabled");
        return PRICE;
    }

    function calculateRequestPriceNative(uint32, uint32) external view returns (uint256) {
        require(!disabled, "wrapper is disabled");
        return PRICE;
    }

    function requestRandomWordsInNative(uint32 gasLimit, uint16, uint32, bytes calldata)
        external
        payable
        returns (uint256 id)
    {
        require(!disabled, "wrapper is disabled");
        require(msg.value >= PRICE, "fee too low");
        id = ++nextId;
        consumers[id] = msg.sender;
        limits[id] = gasLimit;
    }

    /// @dev Exact-gas delivery like the production wrapper; never reverts on consumer failure.
    function fulfill(uint256 id, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        _deliver(id, abi.encodeCall(BoosterPacks.rawFulfillRandomWords, (id, words)));
    }

    function fulfillWords(uint256 id, uint256[] memory words) external {
        _deliver(id, abi.encodeCall(BoosterPacks.rawFulfillRandomWords, (id, words)));
    }

    function _deliver(uint256 id, bytes memory data) private {
        uint32 limit = limits[id];
        require(gasleft() > uint256(limit) + uint256(limit) / 64 + 60_000, "not enough callback gas");
        address target = consumers[id];
        delete consumers[id];
        uint256 before = gasleft();
        (bool ok,) = target.call{gas: limit}(data);
        lastGasUsed = before - gasleft();
        lastSuccess = ok;
    }
}

contract FreshDrawHarness {
    using VariantDraw for mapping(uint32 => uint32);

    mapping(uint32 => uint32) private pool;

    /// @dev On an empty pool the drawn result equals the written index, so clearing it restores emptiness.
    function drawFresh(uint32 remaining, bytes32 entropy) external returns (uint32 r) {
        r = pool.draw(remaining, entropy);
        delete pool[r];
    }
}

contract HolderWithoutReceiver {
    function claim(BoosterPacks engine, uint256 id) external payable returns (uint256) {
        return engine.claim{value: msg.value}(id, 1, msg.value, block.timestamp);
    }
}

abstract contract AuditFixture is Test {
    PackRegistry registry;
    YunipalMonsters monsters;
    BoosterPacks engine;
    AuditProto proto;
    AuditWrapper wrapper;
    address alice = address(0xa11ce);
    address bob = address(0xb0b);
    uint256 launchPack;

    uint32 constant TOTAL = 264;

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
        wrapper = new AuditWrapper();
        proto = new AuditProto();
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
        launchPack = registry.configureType(0, launchRules(450_000, 250_000, 7), launchCatalog());
        registry.activate(launchPack);
        proto.mint(alice, 100_000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.prank(alice);
        proto.approve(address(engine), type(uint256).max);
    }

    // Launch draft (base-standard-v1): 1e18 PROTO, 86400 s, 1/interval, batch 7, 450k + 250k*q, 3 conf,
    // unlimited supply. URIs at the maximum length the registry accepts (512 bytes) to bound gas.
    function launchRules(uint32 baseGas, uint32 perMintGas, uint32 maxBatch)
        internal
        view
        returns (PackRegistry.Rules memory)
    {
        bytes memory longBase = new bytes(512);
        for (uint256 i; i < 511; ++i) {
            longBase[i] = bytes1(uint8(97 + (i % 26)));
        }
        longBase[511] = "/";
        bytes memory longManifest = new bytes(512);
        for (uint256 i; i < 512; ++i) {
            longManifest[i] = bytes1(uint8(97 + (i % 26)));
        }
        return PackRegistry.Rules(
            address(engine),
            address(proto),
            1 ether,
            86400,
            1,
            maxBatch,
            baseGas,
            perMintGas,
            3,
            0,
            keccak256("artwork"),
            string(longManifest),
            string(longBase)
        );
    }

    function launchCatalog() internal pure returns (PackRegistry.Catalog memory c) {
        c.types = new uint32[](11);
        for (uint32 i; i < 11; ++i) {
            c.types[i] = i + 1;
        }
        c.colors = new uint32[](6);
        for (uint32 i; i < 6; ++i) {
            c.colors[i] = i + 1;
        }
        c.horns = new uint32[](2);
        c.horns[0] = 1;
        c.horns[1] = 2;
        c.glitters = new uint32[](2);
        c.glitters[0] = 0;
        c.glitters[1] = 1;
        c.allowed = new uint32[](0);
    }

    function buy(uint256 packId) internal returns (uint256 requestId, uint256 originalId) {
        vm.prank(alice);
        return engine.openPack{value: 0.001 ether}(packId, 0.001 ether, block.timestamp);
    }

    function reveal(uint256 packId, uint256 word) internal returns (uint256 originalId) {
        (uint256 r, uint256 id) = buy(packId);
        wrapper.fulfill(r, word);
        assertTrue(wrapper.lastSuccess(), "outer callback failed");
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Completed));
        return id;
    }

    function claimAs(address owner, uint256 id, uint32 q) internal returns (uint256) {
        vm.prank(owner);
        return engine.claim{value: 0.001 ether}(id, q, 0.001 ether, block.timestamp);
    }

    function _coolAll() internal {
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
        vm.cool(address(wrapper));
        vm.cool(alice);
    }
}

contract AuditPoCTest is AuditFixture {
    // ---------------------------------------------------------------------------------------------
    // D / L: full 264-variant exhaustion on the exact launch catalog, duplicate-free, traits decode.
    // ---------------------------------------------------------------------------------------------
    function testLaunchCatalogFullExhaustionNoDuplicatesAndTraitDecode() public {
        assertEq(registry.getPack(launchPack).totalVariants, TOTAL);
        uint256 id = reveal(launchPack, uint256(keccak256("seed")));
        assertEq(engine.getOriginal(id).remaining, TOTAL - 1);
        // Max accrual: credits bank without expiry; 263 additional claims via 37 batches of 7 + 2.
        vm.warp(block.timestamp + 400 days);
        assertEq(engine.claimable(id), TOTAL - 1);
        uint32 claimed = 1;
        uint256 word = 1;
        while (claimed < TOTAL) {
            uint32 q = TOTAL - claimed >= 7 ? 7 : TOTAL - claimed;
            uint256 r = claimAs(alice, id, q);
            wrapper.fulfill(r, uint256(keccak256(abi.encode(word++))));
            assertTrue(wrapper.lastSuccess());
            assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Completed));
            claimed += q;
        }
        BoosterPacks.Original memory o = engine.getOriginal(id);
        assertEq(o.minted, TOTAL);
        assertEq(o.remaining, 0);
        assertEq(o.dailyCommitted, TOTAL - 1);
        assertEq(engine.claimable(id), 0);
        vm.prank(alice);
        vm.expectRevert();
        engine.claim{value: 0.001 ether}(id, 1, 0.001 ether, block.timestamp);
        assertEq(monsters.balanceOf(alice), TOTAL);
        // Every variant id 0..263 exactly once; every (type,color,horn,glitter) tuple exactly once.
        bool[] memory seenVariant = new bool[](TOTAL);
        bool[] memory seenTuple = new bool[](TOTAL);
        for (uint256 tokenId = 1; tokenId <= TOTAL; ++tokenId) {
            (uint256 packType, uint256 parent, uint32 variantId, PackRegistry.Traits memory t, bool isOrig) =
                monsters.provenance(tokenId);
            assertEq(packType, launchPack);
            assertEq(parent, id);
            assertEq(isOrig, tokenId == id);
            assertLt(variantId, TOTAL);
            assertFalse(seenVariant[variantId], "duplicate variant");
            seenVariant[variantId] = true;
            assertTrue(t.monsterType >= 1 && t.monsterType <= 11);
            assertTrue(t.color >= 1 && t.color <= 6);
            assertTrue(t.horn >= 1 && t.horn <= 2);
            assertTrue(t.glitter <= 1);
            // Rank with glitter fastest, then horn, color, type.
            uint256 rank = (((t.monsterType - 1) * 6 + (t.color - 1)) * 2 + (t.horn - 1)) * 2 + t.glitter;
            assertEq(rank, variantId, "trait decode mismatch");
            assertFalse(seenTuple[rank], "duplicate tuple");
            seenTuple[rank] = true;
            PackRegistry.Traits memory again = registry.traitsFor(launchPack, variantId);
            assertEq(again.monsterType, t.monsterType);
            assertEq(again.glitter, t.glitter);
        }
    }

    // First draw from a fresh 264 pool is uniform over all ranks (rejection sampling), not just the fixture.
    // 13,200 fresh-pool draws through the real library (expected 50 per rank).
    function testFirstDrawUniformOverAllTwoHundredSixtyFour() public {
        FreshDrawHarness h = new FreshDrawHarness();
        uint256 samples = 13_200;
        uint256[] memory hits = new uint256[](TOTAL);
        for (uint256 i; i < samples; ++i) {
            ++hits[h.drawFresh(TOTAL, keccak256(abi.encode("vrf", i)))];
        }
        uint256 minHits = type(uint256).max;
        uint256 maxHits;
        for (uint256 v; v < TOTAL; ++v) {
            if (hits[v] < minHits) minHits = hits[v];
            if (hits[v] > maxHits) maxHits = hits[v];
        }
        emit log_named_uint("expected hits per variant", samples / TOTAL);
        emit log_named_uint("min hits", minHits);
        emit log_named_uint("max hits", maxHits);
        // ~4 sd bounds around 50 (sd ~7); every rank reachable and none dominant.
        assertGt(minHits, 20);
        assertLt(maxHits, 80);
    }

    // ---------------------------------------------------------------------------------------------
    // B: production-size gas envelope. 264 catalog, 512-byte URIs, all storage cold, exact-gas delivery.
    // ---------------------------------------------------------------------------------------------
    function testColdGasEnvelopeLaunchConfigFullCatalogLongURIs() public {
        vm.record();
        (uint256 r, uint256 id) = buy(launchPack);
        _coolAll();
        wrapper.fulfill(r, 42);
        assertTrue(wrapper.lastSuccess());
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Completed));
        emit log_named_uint("opening: callback gas limit", wrapper.limits(r));
        emit log_named_uint("opening: cold total callback gas used", wrapper.lastGasUsed());

        vm.warp(block.timestamp + 10 days);
        vm.record();
        r = claimAs(alice, id, 7);
        _coolAll();
        wrapper.fulfill(r, 43);
        assertTrue(wrapper.lastSuccess());
        assertEq(engine.getOriginal(id).minted, 8);
        emit log_named_uint("first 7-batch: callback gas limit", wrapper.limits(r));
        emit log_named_uint("first 7-batch: cold total callback gas used", wrapper.lastGasUsed());
        assertLt(wrapper.lastGasUsed(), wrapper.limits(r));

        // Late batch: pool dense with relocated entries (different SSTORE profile).
        vm.warp(block.timestamp + 300 days);
        uint32 claimed = 8;
        while (TOTAL - claimed > 7) {
            uint32 q = TOTAL - claimed - 7 >= 7 ? 7 : TOTAL - claimed - 7;
            uint256 rr = claimAs(alice, id, q);
            wrapper.fulfill(rr, uint256(keccak256(abi.encode(claimed))));
            assertTrue(wrapper.lastSuccess());
            claimed += q;
        }
        assertEq(TOTAL - claimed, 7);
        vm.record();
        r = claimAs(alice, id, 7);
        _coolAll();
        wrapper.fulfill(r, 44);
        assertTrue(wrapper.lastSuccess());
        assertEq(engine.getOriginal(id).remaining, 0);
        emit log_named_uint(
            "final 7-batch (pool exhaustion): cold total callback gas used", wrapper.lastGasUsed()
        );
        assertLt(wrapper.lastGasUsed(), wrapper.limits(r));
    }

    // Single-offspring claim at launch config (q=1 => executionGas 550k).
    function testColdGasEnvelopeSingleClaim() public {
        uint256 id = reveal(launchPack, 7);
        vm.warp(block.timestamp + 1 days);
        vm.record();
        uint256 r = claimAs(alice, id, 1);
        _coolAll();
        wrapper.fulfill(r, 9);
        assertTrue(wrapper.lastSuccess());
        assertEq(engine.getOriginal(id).minted, 2);
        emit log_named_uint("single claim: cold total callback gas used", wrapper.lastGasUsed());
    }

    // F-01 regression: reject the old floor for new activations and recover an
    // already-recorded request whose frozen execution estimate is too low.
    function testRegistryRejectsUnderfundedCallbackFloor() public {
        uint256 floorPack = registry.configureType(0, launchRules(200_000, 180_000, 1), launchCatalog());
        vm.expectRevert(bytes("unsafe gas floor"));
        registry.activate(floorPack);
        assertFalse(registry.getPack(floorPack).active);
    }

    function testLegacyUnderestimatedRequestRecoversWithAdditionalGas() public {
        PackRegistry.Pack memory legacy = registry.getPack(launchPack);
        legacy.rules.baseGas = 200_000;
        legacy.rules.perMintGas = 180_000;
        // Model a pack activated before the floor fix; the real registry now rejects this config.
        vm.mockCall(address(registry), abi.encodeCall(PackRegistry.getPack, (launchPack)), abi.encode(legacy));
        vm.record();
        (uint256 r, uint256 id) = buy(launchPack);
        vm.clearMockedCalls();
        assertEq(engine.getRequest(r).executionGas, 230_000);
        _coolAll();
        wrapper.fulfill(r, 123);
        assertTrue(wrapper.lastSuccess(), "outer callback survives inner OOG");
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Seeded));
        _coolAll();
        vm.expectRevert(bytes("recovery failed"));
        engine.recover{gas: 400_000}(r); // still not enough: must keep the same word
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Seeded));
        assertEq(engine.getRequest(r).seed, 123);
        _coolAll();
        engine.recover{gas: 3_000_000}(r);
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Completed));
        assertEq(engine.getRequest(r).seed, 123);
        assertEq(monsters.ownerOf(id), alice);
        assertEq(engine.getOriginal(id).minted, 1);
        assertEq(engine.getOriginal(id).pendingRequest, 0);
        bytes32 entropy = keccak256(
            abi.encode(uint256(123), block.chainid, address(engine), r, id, legacy.ruleHash, uint256(0))
        );
        FreshDrawHarness h = new FreshDrawHarness();
        (,, uint32 variantId,,) = monsters.provenance(id);
        assertEq(variantId, h.drawFresh(TOTAL, entropy), "recovery preserves the committed outcome");
        vm.expectRevert(bytes("not recoverable"));
        engine.recover(r);
    }

    function testNewMinimumGasCompletesColdOpeningAndSevenClaims() public {
        uint256 floorPack = registry.configureType(0, launchRules(400_000, 200_000, 7), launchCatalog());
        registry.activate(floorPack);
        vm.record();
        (uint256 r, uint256 id) = buy(floorPack);
        _coolAll();
        wrapper.fulfill(r, 123);
        assertTrue(wrapper.lastSuccess());
        assertEq(engine.getOriginal(id).minted, 1);
        vm.warp(block.timestamp + 7 days);
        vm.record();
        r = claimAs(alice, id, 7);
        _coolAll();
        wrapper.fulfill(r, 124);
        assertTrue(wrapper.lastSuccess());
        assertEq(engine.getOriginal(id).minted, 8);
    }

    function testActivationRejectsWrongRegistryAndExcessConfirmations() public {
        PackRegistry.Rules memory rules = launchRules(450_000, 250_000, 7);
        rules.confirmations = 201;
        uint256 id = registry.configureType(0, rules, launchCatalog());
        vm.expectRevert(bytes("invalid batch"));
        registry.activate(id);
        rules.confirmations = 200;
        registry.configureType(id, rules, launchCatalog());
        vm.mockCall(address(engine), abi.encodeWithSignature("registry()"), abi.encode(address(0x1234)));
        vm.expectRevert(bytes("registry mismatch"));
        registry.activate(id);
        assertFalse(registry.getPack(id).active);
        vm.clearMockedCalls();
        registry.activate(id);
        assertTrue(registry.getPack(id).active);
    }

    // ---------------------------------------------------------------------------------------------
    // FINDING: a request the oracle never delivers (or whose delivery failed at the wrapper level)
    // leaves pendingRequest set forever. For a claim this bricks the ORIGINAL's entire future
    // (all remaining credits), not just the lost batch. No owner/admin path can clear it.
    // ---------------------------------------------------------------------------------------------
    function testUndeliveredClaimBricksOriginalForever() public {
        uint256 id = reveal(launchPack, 1);
        vm.warp(block.timestamp + 7 days);
        uint256 r = claimAs(alice, id, 7);
        assertEq(engine.getOriginal(id).pendingRequest, r);
        // Oracle never calls back. Years pass; credits keep accruing but can never be committed.
        vm.warp(block.timestamp + 1000 days);
        assertEq(engine.claimable(id), TOTAL - 1 - 7);
        vm.prank(alice);
        vm.expectRevert(bytes("unavailable credits"));
        engine.claim{value: 0.001 ether}(id, 1, 0.001 ether, block.timestamp);
        vm.expectRevert(bytes("not recoverable")); // nothing to recover: no seed was ever stored
        engine.recover(r);
        // Transfer does not help the buyer either.
        vm.prank(alice);
        monsters.transferFrom(alice, bob, id);
        vm.prank(bob);
        vm.expectRevert(bytes("unavailable credits"));
        engine.claim{value: 0.001 ether}(id, 1, 0.001 ether, block.timestamp);
    }

    function testUndeliveredOpeningBurnsPaymentWithNoAsset() public {
        uint256 supplyBefore = proto.totalSupply();
        (uint256 r, uint256 id) = buy(launchPack);
        assertEq(proto.totalSupply(), supplyBefore - 1 ether);
        vm.warp(block.timestamp + 365 days);
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Pending));
        vm.expectRevert();
        monsters.ownerOf(id);
        vm.expectRevert(bytes("not recoverable"));
        engine.recover(r);
    }

    // ---------------------------------------------------------------------------------------------
    // Wrapper disabled by Chainlink (s_disabled): quote/open/claim all revert; recover still works.
    // The wrapper address has no setter, so only a UUPS upgrade restores service.
    // ---------------------------------------------------------------------------------------------
    function testWrapperDisableHaltsOpeningsAndClaimsRecoveryStillWorks() public {
        uint256 id = reveal(launchPack, 1);
        vm.warp(block.timestamp + 2 days);
        vm.mockCallRevert(
            address(registry), abi.encodeWithSelector(PackRegistry.traitsFor.selector), "transient failure"
        );
        uint256 r = claimAs(alice, id, 2);
        wrapper.fulfill(r, 5);
        vm.clearMockedCalls();
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Seeded));
        wrapper.setDisabled(true);
        vm.expectRevert();
        engine.quote(launchPack, 1, 1 gwei);
        vm.prank(alice);
        vm.expectRevert();
        engine.openPack{value: 0.001 ether}(launchPack, 0.001 ether, block.timestamp);
        engine.recover(r); // saved seed still recoverable
        assertEq(engine.getOriginal(id).minted, 3);
        vm.prank(alice);
        vm.expectRevert();
        engine.claim{value: 0.001 ether}(id, 1, 0.001 ether, block.timestamp);
    }

    // F-08 regression: ignore unknown/duplicate delivery, use the first word if extra
    // words arrive, and never manufacture entropy from an empty response.
    function testUnknownAndDuplicateIgnoredAndExtraWordsAccepted() public {
        (uint256 r, uint256 id) = buy(launchPack);
        uint256[] memory two = new uint256[](2);
        two[0] = 123;
        two[1] = 456;
        vm.prank(address(wrapper));
        engine.rawFulfillRandomWords(r + 1000, two);
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Pending));
        wrapper.fulfillWords(r, two);
        assertTrue(wrapper.lastSuccess());
        assertEq(engine.getRequest(r).seed, 123);
        assertEq(monsters.ownerOf(id), alice);
        two[0] = 789;
        vm.prank(address(wrapper));
        engine.rawFulfillRandomWords(r, two);
        assertEq(engine.getRequest(r).seed, 123);
        assertEq(engine.getOriginal(id).minted, 1);
    }

    function testEmptyWordsDoNotRevertOrInventRandomness() public {
        (uint256 r, uint256 id) = buy(launchPack);
        wrapper.fulfillWords(r, new uint256[](0));
        assertTrue(wrapper.lastSuccess());
        assertFalse(engine.getRequest(r).received);
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Pending));
        assertEq(engine.getOriginal(id).minted, 0);
        // No word exists to recover: F-02 remains open; do not claim this fixes lost delivery.
        vm.expectRevert(bytes("not recoverable"));
        engine.recover(r);
    }

    // ---------------------------------------------------------------------------------------------
    // Accepted trade-off evidence: _mint without receiver check lets offspring land in a contract that
    // can never move them (the current owner at execution time, e.g. an escrow or a bare contract).
    // ---------------------------------------------------------------------------------------------
    function testOffspringMintedIntoContractWithoutReceiverAreStuck() public {
        uint256 id = reveal(launchPack, 1);
        HolderWithoutReceiver holder = new HolderWithoutReceiver();
        vm.deal(address(holder), 1 ether);
        vm.prank(alice);
        monsters.transferFrom(alice, address(holder), id);
        vm.warp(block.timestamp + 1 days);
        uint256 r = holder.claim{value: 0.001 ether}(engine, id);
        wrapper.fulfill(r, 77);
        assertTrue(wrapper.lastSuccess());
        assertEq(monsters.ownerOf(id + 1), address(holder));
        // ETH overpayment to a contract without receive() was credited rather than lost.
        assertEq(engine.refundCredits(address(holder)), 0.001 ether - wrapper.PRICE());
    }

    // Fee-on-transfer / dishonest token for a future type is rejected atomically.
    function testFeeOnTransferTokenRejectedAtomically() public {
        FeeToken fee = new FeeToken();
        PackRegistry.Rules memory r = launchRules(450_000, 250_000, 7);
        r.paymentToken = address(fee);
        uint256 feePack = registry.configureType(0, r, launchCatalog());
        registry.activate(feePack);
        fee.mint(alice, 10 ether);
        vm.startPrank(alice);
        fee.approve(address(engine), type(uint256).max);
        vm.expectRevert(BoosterPacks.PaymentAccountingMismatch.selector);
        engine.openPack{value: 0.001 ether}(feePack, 0.001 ether, block.timestamp);
        vm.stopPrank();
        assertEq(fee.balanceOf(alice), 10 ether);
        assertEq(registry.getPack(feePack).openings, 0);
        assertEq(monsters.nextTokenId(), 1);
    }

    // Registry gas ceiling vs coordinator: 2.4M + EIP-150 overhead + wrapper overhead must fit 2.5M.
    function testGasCeilingHeadroomArithmetic() public pure {
        uint32 ceiling = 2_400_000;
        uint32 eip150 = ceiling / 63 + 1; // VRFV2PlusWrapper._getEIP150Overhead
        uint32 coordinatorMax = 2_500_000; // Base mainnet per Chainlink docs
        uint32 headroomForWrapperOverhead = coordinatorMax - ceiling - eip150;
        assertEq(headroomForWrapperOverhead, 61_904);
        uint32 launch = 2_200_000;
        assertEq(coordinatorMax - launch - (launch / 63 + 1), 265_079);
    }

    function _seeded(uint256 packId, uint32 q, uint256 id) internal returns (uint256 r) {
        vm.mockCallRevert(address(registry), abi.encodeWithSelector(PackRegistry.traitsFor.selector), "defer");
        if (q == 0) {
            (r,) = buy(packId);
        } else {
            r = claimAs(alice, id, q);
        }
        wrapper.fulfill(r, uint256(keccak256(abi.encode("inner", q))));
        vm.clearMockedCalls();
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Seeded));
    }

    function _innerCold(uint256 r) internal returns (uint256 used) {
        vm.record();
        _coolAll();
        vm.prank(address(engine));
        uint256 before = gasleft();
        engine.execute(r);
        used = before - gasleft();
        assertEq(uint256(engine.getRequest(r).status), uint256(BoosterPacks.Status.Completed));
    }

    function testInnerExecuteColdCost() public {
        uint256 r = _seeded(launchPack, 0, 0);
        uint256 id = engine.getRequest(r).originalId;
        uint256 opening = _innerCold(r);
        emit log_named_uint("inner execute, opening, cold (incl. proxy hop)", opening);
        emit log_named_uint(
            "executionGas available at launch config for opening", engine.getRequest(r).executionGas
        );
        vm.warp(block.timestamp + 1 days);
        r = _seeded(launchPack, 1, id);
        emit log_named_uint("inner execute, 1 offspring, cold", _innerCold(r));
        vm.warp(block.timestamp + 10 days);
        r = _seeded(launchPack, 7, id);
        uint256 seven = _innerCold(r);
        emit log_named_uint("inner execute, 7 offspring, cold", seven);
        emit log_named_uint(
            "executionGas available at launch config for 7", engine.getRequest(r).executionGas
        );
    }
}

contract FeeToken is ERC20 {
    constructor() ERC20("FEE", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}
