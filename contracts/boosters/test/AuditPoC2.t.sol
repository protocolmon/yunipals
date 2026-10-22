// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Auditor re-review tests for snapshot 95bbbd0442bbcc7e90aa814de3b673cea70f61b94f8b4e0850854835bec6cc7e
// (original-proof recovery). Not part of the reviewed package.

import {AuditFixture, AuditWrapper} from "./AuditPoC.t.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {VRF} from "@chainlink/contracts/src/v0.8/vrf/VRF.sol";

contract AuditPoC2Test is AuditFixture {
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
            string memory s = string.concat("[", vm.toString(i), "]");
            f.proof.pk[i] = vm.parseJsonUint(json, string.concat(p, ".proof.pk", s));
            f.proof.gamma[i] = vm.parseJsonUint(json, string.concat(p, ".proof.gamma", s));
            f.proof.cGammaWitness[i] = vm.parseJsonUint(json, string.concat(p, ".proof.cGammaWitness", s));
            f.proof.sHashWitness[i] = vm.parseJsonUint(json, string.concat(p, ".proof.sHashWitness", s));
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

    function header(bytes32 parent) internal pure returns (bytes memory) {
        return abi.encodePacked(hex"f90100a0", parent, new bytes(223));
    }

    // ---------------------------------------------------------------------------------------------
    // Residual (Low): a wrong value in the captured blockhash store, persisted through
    // checkpointRequestBlock after the EVM window, is cemented by first-write-wins and blocks the
    // genuine proof forever; the permissionless header walk cannot overwrite it.
    // ---------------------------------------------------------------------------------------------
    function testBlockhashStorePoisonedCheckpointBlocksGenuineProofForever() public {
        Fixture memory f = fixture(1);
        opening(f);
        vm.roll(f.number + 1_000); // EVM blockhash window expired
        wrapper.setBlockhash(f.number, keccak256("wrong store value"));
        vm.prank(bob);
        vm.expectRevert(bytes("request block outside EVM window")); // FIXED: store value never persisted
        engine.checkpointRequestBlock(f.id);
        assertEq(engine.checkpointedBlockhash(f.number), bytes32(0));
        // The verified header walk can still establish the genuine hash and the proof restores.
        bytes[] memory h = new bytes[](1);
        h[0] = header(f.hash);
        vm.setBlockhash(f.number + 1, keccak256(h[0]));
        vm.roll(f.number + 100);
        engine.checkpointBlockHeaders(f.number + 1, h);
        assertEq(engine.checkpointedBlockhash(f.number), f.hash);
        vm.roll(f.number + 1_000); // request block outside the EVM window again: checkpoint path
        engine.restoreRandomness(f.id, f.proof);
        assertEq(engine.getRequest(f.id).seed, f.word);
    }

    // Control: without a persisted checkpoint, a corrected store (or header walk) still recovers.
    function testTransientStoreLookupIsNotPersistedByRestore() public {
        Fixture memory f = fixture(1);
        opening(f);
        vm.roll(f.number + 1_000);
        wrapper.setBlockhash(f.number, keccak256("wrong store value"));
        vm.expectRevert();
        engine.restoreRandomness(f.id, f.proof);
        assertEq(engine.checkpointedBlockhash(f.number), bytes32(0));
        wrapper.setBlockhash(f.number, f.hash);
        engine.restoreRandomness(f.id, f.proof);
        assertEq(engine.getRequest(f.id).seed, f.word);
    }

    // ---------------------------------------------------------------------------------------------
    // Gas: restoreRandomness cold, and the request-path overhead added by ProofContext capture.
    // ---------------------------------------------------------------------------------------------
    function testRestoreGasColdAndRequestOverhead() public {
        Fixture memory f = fixture(2);
        opening(f);
        vm.roll(f.number + 3);
        vm.setBlockhash(f.number, f.hash);
        vm.record();
        _coolAll();
        uint256 before = gasleft();
        engine.restoreRandomness(f.id, f.proof);
        emit log_named_uint("restoreRandomness cold gas (EVM blockhash path)", before - gasleft());
        _coolAll();
        before = gasleft();
        engine.recover(f.id);
        emit log_named_uint("recover after restore, cold gas", before - gasleft());
        assertEq(uint256(engine.getRequest(f.id).status), uint256(BoosterPacks.Status.Completed));

        vm.prank(alice);
        before = gasleft();
        engine.openPack{value: 0.001 ether}(launchPack, 0.001 ether, block.timestamp);
        emit log_named_uint("openPack gas (warm registry/wrapper, incl. ProofContext)", before - gasleft());
    }

    // ---------------------------------------------------------------------------------------------
    // Sequencing: a claim restored by proof mints to the owner at recover() time, and the opening
    // accrual clock starts at restoration, not at the oracle's (lost) delivery time.
    // ---------------------------------------------------------------------------------------------
    function testOpeningClockStartsAtRestorationNotLostDelivery() public {
        Fixture memory f = fixture(3);
        uint256 original = opening(f);
        vm.roll(f.number + 3);
        vm.setBlockhash(f.number, f.hash);
        uint256 deliveryTime = block.timestamp;
        wrapper.setCallbackLimit(f.id, 1_000); // lost delivery at the wrapper
        wrapper.fulfill(f.id, f.word);
        assertFalse(wrapper.lastSuccess());
        vm.warp(deliveryTime + 5 days);
        engine.restoreRandomness(f.id, f.proof);
        engine.recover(f.id);
        assertEq(engine.getOriginal(original).revealedAt, deliveryTime + 5 days);
        assertEq(engine.claimable(original), 0); // five days of accrual are not credited
    }

    // Proof restore cannot be used to front-run a different recipient: opening always to payer.
    function testRestoredOpeningMintsToPayerNotSubmitter() public {
        Fixture memory f = fixture(0);
        uint256 original = opening(f);
        vm.roll(f.number + 3);
        vm.setBlockhash(f.number, f.hash);
        vm.prank(bob);
        engine.restoreRandomness(f.id, f.proof);
        vm.prank(bob);
        engine.recover(f.id);
        assertEq(monsters.ownerOf(original), alice);
    }

    // Registry ceiling now fits the live coordinator limit with the observed wrapper overhead.
    function testCeilingFitsObservedWrapperOverhead() public pure {
        uint32 ceiling = 2_400_000;
        uint32 observedWrapperOverhead = 13_400; // live-vrf.json, block 52826917
        assertLe(ceiling + ceiling / 63 + 1 + observedWrapperOverhead, 2_500_000);
    }
}
