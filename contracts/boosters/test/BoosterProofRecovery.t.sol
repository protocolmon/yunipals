// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AuditFixture, AuditWrapper} from "./AuditPoC.t.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {BoosterProofRecovery} from "../src/BoosterProofRecovery.sol";
import {VRF} from "@chainlink/contracts/src/v0.8/vrf/VRF.sol";

contract ProofEngineV2 is BoosterPacks {}

/// @dev Public Base proofs test the unmodified Chainlink verifier, not a mocked crypto result.
/// The wrapper assigns their actual IDs at their actual blocks. These are fixtures from
/// unrelated live consumers; no claim is made that our undeployed engine requested them.
contract BoosterProofRecoveryTest is AuditFixture {
    struct Fixture {
        uint256 id;
        uint256 number;
        bytes32 hash;
        uint256 word;
        VRF.Proof proof;
    }

    function fixture(uint256 index) internal view returns (Fixture memory f) {
        string memory json = vm.readFile("test/fixtures/base-vrf-proofs.json");
        string memory p = string.concat("[", vm.toString(index), "]");
        f.id = vm.parseJsonUint(json, string.concat(p, ".requestId"));
        f.number = vm.parseJsonUint(json, string.concat(p, ".commitment.blockNum"));
        f.hash = vm.parseJsonBytes32(json, string.concat(p, ".requestBlockHash"));
        f.word = vm.parseJsonUint(json, string.concat(p, ".word"));
        for (uint256 i; i < 2; ++i) {
            string memory suffix = string.concat("[", vm.toString(i), "]");
            f.proof.pk[i] = vm.parseJsonUint(json, string.concat(p, ".proof.pk", suffix));
            f.proof.gamma[i] = vm.parseJsonUint(json, string.concat(p, ".proof.gamma", suffix));
            f.proof.cGammaWitness[i] =
                vm.parseJsonUint(json, string.concat(p, ".proof.cGammaWitness", suffix));
            f.proof.sHashWitness[i] = vm.parseJsonUint(json, string.concat(p, ".proof.sHashWitness", suffix));
        }
        f.proof.c = vm.parseJsonUint(json, string.concat(p, ".proof.c"));
        f.proof.s = vm.parseJsonUint(json, string.concat(p, ".proof.s"));
        f.proof.seed = vm.parseJsonUint(json, string.concat(p, ".proof.seed"));
        f.proof.uWitness = vm.parseJsonAddress(json, string.concat(p, ".proof.uWitness"));
        f.proof.zInv = vm.parseJsonUint(json, string.concat(p, ".proof.zInv"));
    }

    function opening(Fixture memory f) internal returns (uint256 original) {
        vm.chainId(8453);
        vm.roll(f.number);
        wrapper.setNextId(f.id);
        (uint256 id, uint256 o) = buy(launchPack);
        assertEq(id, f.id);
        return o;
    }

    function confirmed(Fixture memory f) internal {
        vm.roll(f.number + 3);
        vm.setBlockhash(f.number, f.hash);
    }

    function testFourRealBaseProofsRestoreExactWordThenMint() public {
        for (uint256 i; i < 4; ++i) {
            Fixture memory f = fixture(i);
            uint256 original = opening(f);
            uint256 supply = proto.totalSupply();
            uint256 feeBalance = address(wrapper).balance;
            confirmed(f);
            vm.warp(block.timestamp + 10 days);
            vm.prank(bob); // Anyone may restore; it never redirects the opening.
            engine.restoreRandomness(f.id, f.proof);
            assertEq(engine.getRequest(f.id).seed, f.word);
            assertEq(uint256(engine.getRequest(f.id).status), uint256(BoosterPacks.Status.Seeded));
            assertEq(engine.getOriginal(original).revealedAt, block.timestamp);
            assertEq(engine.claimable(original), 0);
            engine.recover(f.id);
            assertEq(monsters.ownerOf(original), alice);
            assertEq(engine.getOriginal(original).pendingRequest, 0);
            assertEq(proto.totalSupply(), supply);
            assertEq(address(wrapper).balance, feeBalance);
            vm.warp(block.timestamp + 1 days);
            assertEq(engine.claimable(original), 1);
        }
    }

    function testConsumedFailedDeliveryRecoveredAndLateCallbackCannotChangeSeed() public {
        Fixture memory f = fixture(1);
        uint256 original = opening(f);
        confirmed(f);
        wrapper.setCallbackLimit(f.id, 1_000);
        wrapper.fulfill(f.id, f.word);
        assertFalse(wrapper.lastSuccess());
        assertEq(wrapper.consumers(f.id), address(0));
        assertFalse(engine.getRequest(f.id).received);
        engine.restoreRandomness(f.id, f.proof);
        uint256[] memory late = new uint256[](1);
        late[0] = 77;
        vm.prank(address(wrapper));
        engine.rawFulfillRandomWords(f.id, late);
        assertEq(engine.getRequest(f.id).seed, f.word);
        engine.recover(f.id);
        assertEq(monsters.balanceOf(alice), 1);
        assertEq(engine.getOriginal(original).minted, 1);
        vm.expectRevert("not awaiting randomness");
        engine.restoreRandomness(f.id, f.proof);
    }

    function testNormalCallbackWinsRace() public {
        Fixture memory f = fixture(1);
        opening(f);
        confirmed(f);
        wrapper.fulfill(f.id, f.word);
        vm.expectRevert("not awaiting randomness");
        engine.restoreRandomness(f.id, f.proof);
        assertEq(monsters.balanceOf(alice), 1);
    }

    function pendingDaily(Fixture memory f) internal returns (uint256 original) {
        vm.chainId(8453);
        vm.roll(f.number - 1);
        original = reveal(launchPack, 42);
        vm.warp(block.timestamp + 10 days);
        vm.roll(f.number);
        wrapper.setNextId(f.id);
        assertEq(claimAs(alice, original, 7), f.id);
        confirmed(f);
    }

    function testTransferredPendingBatchFollowsOwnerAndFurtherClaimsResume() public {
        Fixture memory f = fixture(1);
        uint256 original = pendingDaily(f);
        vm.prank(alice);
        monsters.transferFrom(alice, bob, original);
        engine.restoreRandomness(f.id, f.proof);
        engine.recover(f.id);
        assertEq(monsters.balanceOf(bob), 8);
        assertEq(monsters.balanceOf(alice), 0);
        assertEq(engine.getOriginal(original).dailyCommitted, 7);
        assertEq(engine.claimable(original), 3);
        uint256 next = claimAs(bob, original, 3);
        wrapper.fulfill(next, 9);
        assertEq(monsters.balanceOf(bob), 11);
    }

    function testBurnBeforeProofForfeitsAndCannotRestore() public {
        Fixture memory f = fixture(1);
        uint256 original = pendingDaily(f);
        vm.prank(alice);
        monsters.burn(original);
        vm.expectRevert("not awaiting randomness");
        engine.restoreRandomness(f.id, f.proof);
        assertEq(uint256(engine.getRequest(f.id).status), uint256(BoosterPacks.Status.Forfeited));
        assertEq(engine.claimable(original), 0);
    }

    function testBurnAfterProofForfeitsAndCannotMint() public {
        Fixture memory f = fixture(1);
        uint256 original = pendingDaily(f);
        engine.restoreRandomness(f.id, f.proof);
        vm.prank(alice);
        monsters.burn(original);
        vm.expectRevert("not recoverable");
        engine.recover(f.id);
        assertEq(monsters.balanceOf(alice), 0);
    }

    function testProofPersistsAcrossFailedMintAndRecoveryWhilePausedAndDisabled() public {
        Fixture memory f = fixture(1);
        opening(f);
        confirmed(f);
        engine.pauseRequests(true);
        wrapper.setDisabled(true);
        engine.restoreRandomness(f.id, f.proof);
        vm.mockCallRevert(
            address(monsters), abi.encodeWithSelector(monsters.mintOriginal.selector), "broken mint"
        );
        vm.expectRevert("recovery failed");
        engine.recover(f.id);
        assertEq(engine.getRequest(f.id).seed, f.word);
        assertTrue(engine.getRequest(f.id).received);
        vm.clearMockedCalls();
        engine.recover(f.id);
        assertEq(monsters.balanceOf(alice), 1);
    }

    function testRejectUnknownWrongRequestKeyChainBlockAndEarlyProof() public {
        Fixture memory f = fixture(1);
        vm.expectRevert("not awaiting randomness");
        engine.restoreRandomness(f.id, f.proof);
        opening(f);
        vm.expectRevert("wait confirmations");
        engine.restoreRandomness(f.id, f.proof);
        confirmed(f);
        vm.chainId(1);
        vm.expectRevert("missing proof context");
        engine.restoreRandomness(f.id, f.proof);
        vm.chainId(8453);
        ++f.proof.seed;
        vm.expectRevert("proof request mismatch");
        engine.restoreRandomness(f.id, f.proof);
        --f.proof.seed;
        ++f.proof.pk[0];
        vm.expectRevert("proof request mismatch");
        engine.restoreRandomness(f.id, f.proof);
        --f.proof.pk[0];
        vm.setBlockhash(f.number, keccak256("wrong block"));
        vm.expectRevert();
        engine.restoreRandomness(f.id, f.proof);
        assertFalse(engine.getRequest(f.id).received);
    }

    function testFuzzRejectAlteredProof(uint256 delta) public {
        delta = bound(delta, 1, type(uint256).max);
        Fixture memory f = fixture(1);
        opening(f);
        confirmed(f);
        f.proof.c ^= delta;
        vm.expectRevert();
        engine.restoreRandomness(f.id, f.proof);
        assertFalse(engine.getRequest(f.id).received);
    }

    function testCheckpointSurvivesEvmHistoryWindowAndUpgrade() public {
        Fixture memory f = fixture(1);
        opening(f);
        confirmed(f);
        vm.prank(bob);
        assertEq(engine.checkpointRequestBlock(f.id), f.hash);
        engine.upgradeToAndCall(address(new ProofEngineV2()), "");
        vm.roll(f.number + 1_000);
        assertEq(engine.proofContext(f.id).requestBlock, f.number);
        engine.restoreRandomness(f.id, f.proof);
        assertEq(engine.getRequest(f.id).seed, f.word);
        bytes32 slot = keccak256(abi.encode(uint256(keccak256("yunipals.storage.BoosterProofRecovery")) - 1))
            & ~bytes32(uint256(255));
        // contexts mapping is the first field; packed coordinator/block/confirmations live at this slot.
        bytes32 packed = vm.load(address(engine), keccak256(abi.encode(f.id, slot)));
        assertEq(address(uint160(uint256(packed))), address(wrapper));
        assertEq(uint64(uint256(packed) >> 160), f.number);
    }

    function testCapturedCoordinatorStoreSurvivesWrapperChange() public {
        Fixture memory f = fixture(1);
        opening(f);
        wrapper.setBlockhash(f.number, f.hash);
        wrapper.setProofDependencies(address(0), address(0));
        vm.roll(f.number + 1_000);
        engine.restoreRandomness(f.id, f.proof);
        assertEq(engine.getRequest(f.id).seed, f.word);
    }

    function testMissingHistoricalHashFailsWithoutRecordingSeed() public {
        Fixture memory f = fixture(1);
        opening(f);
        vm.roll(f.number + 1_000);
        vm.expectRevert("checkpoint request block first");
        engine.restoreRandomness(f.id, f.proof);
        assertFalse(engine.getRequest(f.id).received);
    }

    // Small synthetic canonical-RLP-prefix headers exercise anchoring independent of crypto fixtures.
    function header(bytes32 parent) internal pure returns (bytes memory) {
        return abi.encodePacked(hex"f90100a0", parent, new bytes(223)); // 256-byte list payload
    }

    function testHistoricalHeadersBackfillAcrossBatchesThenVerifyProof() public {
        Fixture memory f = fixture(1);
        opening(f);
        bytes[] memory older = new bytes[](2);
        older[1] = header(f.hash);
        older[0] = header(keccak256(older[1]));
        bytes[] memory newer = new bytes[](1);
        newer[0] = header(keccak256(older[0]));
        vm.roll(f.number + 258);
        vm.setBlockhash(f.number + 3, keccak256(newer[0])); // recent root, request itself expired
        engine.checkpointBlockHeaders(f.number + 3, newer);
        vm.roll(f.number + 1_000);
        engine.checkpointBlockHeaders(f.number + 2, older);
        assertEq(engine.checkpointedBlockhash(f.number), f.hash);
        engine.restoreRandomness(f.id, f.proof);
        assertEq(engine.getRequest(f.id).seed, f.word);
    }

    function testRealBaseHeaderBackfillAuthenticatesHistoricalProof() public {
        Fixture memory f = fixture(1);
        opening(f);
        string memory json = vm.readFile("test/fixtures/base-block-headers.json");
        bytes[] memory headers = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            headers[i] = vm.parseJsonBytes(json, string.concat("[", vm.toString(2 - i), "].rlp"));
        }
        vm.roll(f.number + 258);
        vm.setBlockhash(f.number + 3, vm.parseJsonBytes32(json, "[2].hash"));
        engine.checkpointBlockHeaders(f.number + 3, headers);
        assertEq(engine.checkpointedBlockhash(f.number), f.hash);
        engine.restoreRandomness(f.id, f.proof);
        assertEq(engine.getRequest(f.id).seed, f.word);
    }

    function testRejectUnanchoredTamperedAndMalformedHeaders() public {
        vm.roll(1_000);
        bytes[] memory headers = new bytes[](1);
        headers[0] = header(keccak256("parent"));
        vm.expectRevert("unknown checkpoint");
        engine.checkpointBlockHeaders(1, headers);
        vm.setBlockhash(999, keccak256(headers[0]));
        headers[0][4] ^= bytes1(uint8(1));
        vm.expectRevert("header hash mismatch");
        engine.checkpointBlockHeaders(999, headers);
        headers[0][0] = 0xfa;
        vm.expectRevert("unsupported header encoding");
        engine.checkpointBlockHeaders(999, headers);
        vm.expectRevert("invalid headers");
        engine.checkpointBlockHeaders(999, new bytes[](65));
        vm.expectRevert("invalid headers");
        engine.checkpointBlockHeaders(999, new bytes[](0));
    }
}
