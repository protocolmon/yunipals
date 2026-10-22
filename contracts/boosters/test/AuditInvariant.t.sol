// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Stateful invariant harness added by the auditor (snapshot 03855c82...). Not part of the reviewed package.

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {AuditProto, AuditWrapper} from "./AuditPoC.t.sol";

contract Handler is Test {
    PackRegistry registry;
    YunipalMonsters monsters;
    BoosterPacks engine;
    AuditProto proto;
    AuditWrapper wrapper;
    uint256 packId;
    uint32 totalVariants;

    address[] public actors;
    uint256[] public originals; // reserved original ids
    uint256[] public pendingIds; // request ids not yet delivered
    mapping(uint256 => uint256) public offspringAtBurn; // originalId => minted count at burn
    mapping(uint256 => bool) public burnedOriginal;
    mapping(uint256 => uint256) public reservedRequest; // originalId => opening request id
    uint256 public calls;

    constructor(PackRegistry r, YunipalMonsters m, BoosterPacks e, AuditProto p, AuditWrapper w, uint256 id) {
        registry = r;
        monsters = m;
        engine = e;
        proto = p;
        wrapper = w;
        packId = id;
        totalVariants = registry.getPack(id).totalVariants;
        actors.push(address(0xa11ce));
        actors.push(address(0xb0b));
        actors.push(address(0xca401));
        for (uint256 i; i < actors.length; ++i) {
            proto.mint(actors[i], 10_000 ether);
            vm.deal(actors[i], 1000 ether);
            vm.prank(actors[i]);
            proto.approve(address(engine), type(uint256).max);
        }
    }

    function originalCount() external view returns (uint256) {
        return originals.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function open(uint256 seed) external {
        ++calls;
        address a = _actor(seed);
        vm.prank(a);
        (uint256 r, uint256 id) = engine.openPack{value: 0.001 ether}(packId, 0.001 ether, block.timestamp);
        originals.push(id);
        pendingIds.push(r);
        reservedRequest[id] = r;
    }

    function fulfill(uint256 seed, uint256 word, bool breakMint) external {
        ++calls;
        if (pendingIds.length == 0) return;
        uint256 idx = seed % pendingIds.length;
        uint256 r = pendingIds[idx];
        pendingIds[idx] = pendingIds[pendingIds.length - 1];
        pendingIds.pop();
        if (breakMint) {
            vm.mockCallRevert(
                address(registry), abi.encodeWithSelector(PackRegistry.traitsFor.selector), "broken"
            );
        }
        wrapper.fulfill(r, word);
        vm.clearMockedCalls();
        require(wrapper.lastSuccess(), "outer callback must never fail");
    }

    function claim(uint256 seed, uint32 q) external {
        ++calls;
        if (originals.length == 0) return;
        uint256 id = originals[seed % originals.length];
        BoosterPacks.Original memory o = engine.getOriginal(id);
        if (o.minted == 0 || o.burned || o.pendingRequest != 0) return;
        uint32 c = engine.claimable(id);
        if (c == 0) return;
        q = uint32(bound(q, 1, c > 7 ? 7 : c));
        address owner = monsters.ownerOf(id);
        vm.prank(owner);
        uint256 r = engine.claim{value: 0.001 ether}(id, q, 0.001 ether, block.timestamp);
        pendingIds.push(r);
    }

    function recover(uint256 seed) external {
        ++calls;
        if (originals.length == 0) return;
        uint256 id = originals[seed % originals.length];
        uint256 r = engine.getOriginal(id).pendingRequest;
        if (r == 0) return;
        BoosterPacks.Request memory req = engine.getRequest(r);
        if (req.status != BoosterPacks.Status.Seeded) return;
        engine.recover(r);
    }

    function transfer(uint256 seed, uint256 to) external {
        ++calls;
        if (originals.length == 0) return;
        uint256 id = originals[seed % originals.length];
        if (engine.getOriginal(id).minted == 0 || burnedOriginal[id]) return;
        address owner = monsters.ownerOf(id);
        vm.prank(owner);
        monsters.transferFrom(owner, _actor(to), id);
    }

    function burnOriginal(uint256 seed) external {
        ++calls;
        if (originals.length == 0) return;
        uint256 id = originals[seed % originals.length];
        if (engine.getOriginal(id).minted == 0 || burnedOriginal[id]) return;
        address owner = monsters.ownerOf(id);
        offspringAtBurn[id] = engine.getOriginal(id).minted;
        burnedOriginal[id] = true;
        vm.prank(owner);
        monsters.burn(id);
    }

    function burnOffspring(uint256 seed) external {
        ++calls;
        uint256 n = monsters.nextTokenId();
        if (n <= 1) return;
        uint256 tokenId = 1 + (seed % (n - 1));
        (,,,, bool isOriginal) = monsters.provenance(tokenId);
        if (isOriginal) return;
        try monsters.ownerOf(tokenId) returns (address owner) {
            vm.prank(owner);
            monsters.burn(tokenId);
        } catch {}
    }

    function warp(uint256 secondsAhead) external {
        ++calls;
        vm.warp(block.timestamp + bound(secondsAhead, 1, 10 days));
    }
}

/// forge-config: default.invariant.runs = 48
/// forge-config: default.invariant.depth = 60
/// forge-config: default.invariant.fail-on-revert = true
contract AuditInvariantTest is Test {
    PackRegistry registry;
    YunipalMonsters monsters;
    BoosterPacks engine;
    AuditProto proto;
    AuditWrapper wrapper;
    Handler handler;
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
        // Small catalog (12 variants) so exhaustion is reachable within a run; launch-shaped rules.
        PackRegistry.Catalog memory c;
        c.types = new uint32[](3);
        c.types[0] = 1;
        c.types[1] = 2;
        c.types[2] = 3;
        c.colors = new uint32[](2);
        c.colors[0] = 1;
        c.colors[1] = 2;
        c.horns = new uint32[](1);
        c.horns[0] = 1;
        c.glitters = new uint32[](2);
        c.glitters[0] = 0;
        c.glitters[1] = 1;
        packId = registry.configureType(
            0,
            PackRegistry.Rules(
                address(engine),
                address(proto),
                1 ether,
                86400,
                1,
                7,
                450_000,
                250_000,
                3,
                0,
                keccak256("artwork"),
                "ipfs://m",
                "ipfs://v/"
            ),
            c
        );
        registry.activate(packId);
        handler = new Handler(registry, monsters, engine, proto, wrapper, packId);
        targetContract(address(handler));
    }

    function invariant_accountingAndUniqueness() public view {
        uint32 total = registry.getPack(packId).totalVariants;
        uint256 n = handler.originalCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.originals(i);
            BoosterPacks.Original memory o = engine.getOriginal(id);
            if (o.minted == 0) {
                assertEq(o.remaining, total, "unrevealed pool intact");
                continue;
            }
            assertEq(uint256(o.minted) + o.remaining, total, "minted + remaining == total");
            assertLe(o.dailyCommitted, total - 1, "committed within cap");
            uint256 earned = ((block.timestamp - o.revealedAt) / 86400);
            if (earned > total - 1) earned = total - 1;
            assertLe(o.dailyCommitted, earned, "committed never exceeds earned");
            assertLe(uint256(o.minted) - 1, o.dailyCommitted, "fulfilled offspring <= committed");
            if (o.burned) {
                assertEq(o.minted, handler.offspringAtBurn(id), "no mint after burn");
                assertEq(o.pendingRequest, 0, "burned has no pending");
                assertEq(engine.claimable(id), 0, "burned earns nothing");
            }
            if (o.pendingRequest != 0) {
                BoosterPacks.Request memory r = engine.getRequest(o.pendingRequest);
                assertEq(r.originalId, id, "pending points back");
                assertTrue(
                    r.status == BoosterPacks.Status.Pending || r.status == BoosterPacks.Status.Seeded,
                    "pending is live"
                );
            }
        }
        // Per-original variant uniqueness and provenance consistency across the whole collection.
        uint256 next = monsters.nextTokenId();
        for (uint256 a = 1; a < next; ++a) {
            (uint256 packA, uint256 parentA, uint32 vA,, bool origA) = monsters.provenance(a);
            if (packA == 0) continue; // reserved, unminted
            assertEq(packA, packId);
            if (origA) assertEq(parentA, a);
            else assertEq(engine.claimable(a), 0, "offspring earn nothing");
            for (uint256 b = a + 1; b < next; ++b) {
                (uint256 packB, uint256 parentB, uint32 vB,,) = monsters.provenance(b);
                if (packB == 0 || parentB != parentA) continue;
                assertTrue(vA != vB, "duplicate variant within one original");
            }
        }
        assertGe(address(engine).balance, engine.totalRefundLiability(), "ETH solvency");
        assertEq(proto.balanceOf(address(engine)), 0, "engine never holds PROTO");
    }
}
