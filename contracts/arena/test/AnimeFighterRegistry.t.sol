// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AnimeFighterRegistry} from "../src/AnimeFighterRegistry.sol";

contract RegistryNft {
    mapping(uint256 => address) public ownerOf;

    function setOwner(uint256 id, address holder) external {
        ownerOf[id] = holder;
    }
}

contract AnimeFighterRegistryTest is Test {
    AnimeFighterRegistry registry;
    RegistryNft nft;
    address holder = address(11);
    address curator = address(12);
    bytes32 manifest = sha256("manifest");

    function setUp() public {
        registry = new AnimeFighterRegistry(address(this), curator, "https://assets.example/fighters/v1/");
        vm.etch(registry.BASE_YUNIPALS(), address(new RegistryNft()).code);
        nft = RegistryNft(registry.BASE_YUNIPALS());
        nft.setOwner(1, holder);
        nft.setOwner(2, holder);
        registry.setApplicationsOpen(true);
    }

    function applyOne() internal {
        vm.prank(holder);
        registry.applyForArena(1);
    }

    function approveOne() internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        bytes32[] memory hashes = new bytes32[](1);
        hashes[0] = manifest;
        vm.prank(curator);
        registry.approve(ids, hashes, 1);
    }

    function rejectOne(uint8 code, string memory note) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        uint8[] memory codes = new uint8[](1);
        codes[0] = code;
        string[] memory notes = new string[](1);
        notes[0] = note;
        vm.prank(curator);
        registry.reject(ids, codes, notes);
    }

    function status() internal view returns (AnimeFighterRegistry.Status s) {
        (s,,,) = registry.fighters(1);
    }

    function testStartsClosed() public {
        assertFalse(new AnimeFighterRegistry(address(this), curator, "https://example/").applicationsOpen());
    }

    function testApply() public {
        applyOne();
        assertEq(uint256(status()), 1);
        (,, uint32 count,) = registry.fighters(1);
        assertEq(count, 1);
    }

    function testWrongOwner() public {
        vm.expectRevert(AnimeFighterRegistry.Unauthorized.selector);
        registry.applyForArena(1);
    }

    function testClosed() public {
        registry.setApplicationsOpen(false);
        vm.prank(holder);
        vm.expectRevert(AnimeFighterRegistry.InvalidState.selector);
        registry.applyForArena(1);
    }

    function testDuplicateApply() public {
        applyOne();
        vm.prank(holder);
        vm.expectRevert(AnimeFighterRegistry.InvalidState.selector);
        registry.applyForArena(1);
    }

    function testReapply() public {
        applyOne();
        rejectOne(0, "retry");
        applyOne();
        (,, uint32 count,) = registry.fighters(1);
        assertEq(count, 2);
    }

    function testApprove() public {
        applyOne();
        approveOne();
        (, uint16 recipe,, bytes32 hash) = registry.fighters(1);
        assertEq(recipe, 1);
        assertEq(hash, manifest);
        assertEq(uint256(status()), 2);
    }

    function testApproveNeedsApplication() public {
        vm.expectRevert(AnimeFighterRegistry.InvalidState.selector);
        approveOne();
    }

    function testReject() public {
        applyOne();
        rejectOne(1, "placeholder");
        assertEq(uint256(status()), 3);
    }

    function testRejectNeedsApplication() public {
        vm.expectRevert(AnimeFighterRegistry.InvalidState.selector);
        rejectOne(0, "");
    }

    function testRevoke() public {
        applyOne();
        approveOne();
        vm.prank(curator);
        registry.revoke(1, 5, "traits changed");
        assertEq(uint256(status()), 4);
    }

    function testRevokeNeedsApproval() public {
        vm.prank(curator);
        vm.expectRevert(AnimeFighterRegistry.InvalidState.selector);
        registry.revoke(1, 5, "");
    }

    function testReapproveRevoked() public {
        applyOne();
        approveOne();
        vm.prank(curator);
        registry.revoke(1, 5, "");
        approveOne();
        assertEq(uint256(status()), 2);
    }

    function testRevokedCannotApply() public {
        applyOne();
        approveOne();
        vm.prank(curator);
        registry.revoke(1, 0, "");
        vm.prank(holder);
        vm.expectRevert(AnimeFighterRegistry.InvalidState.selector);
        registry.applyForArena(1);
    }

    function testRejectCannotUseTraitChange() public {
        applyOne();
        vm.expectRevert(AnimeFighterRegistry.InvalidReason.selector);
        rejectOne(5, "");
    }

    function testInvalidCode() public {
        applyOne();
        vm.expectRevert(AnimeFighterRegistry.InvalidReason.selector);
        rejectOne(6, "");
    }

    function testNoteLimit() public {
        applyOne();
        vm.expectRevert(AnimeFighterRegistry.InvalidReason.selector);
        rejectOne(0, string(new bytes(141)));
    }

    function testNoteAtLimit() public {
        applyOne();
        rejectOne(0, string(new bytes(140)));
    }

    function testApproveLengthMismatch() public {
        vm.prank(curator);
        vm.expectRevert(AnimeFighterRegistry.InvalidBatch.selector);
        registry.approve(new uint256[](1), new bytes32[](0), 1);
    }

    function testRejectLengthMismatch() public {
        vm.prank(curator);
        vm.expectRevert(AnimeFighterRegistry.InvalidBatch.selector);
        registry.reject(new uint256[](1), new uint8[](1), new string[](0));
    }

    function testEmptyBatch() public {
        vm.prank(curator);
        vm.expectRevert(AnimeFighterRegistry.InvalidBatch.selector);
        registry.approve(new uint256[](0), new bytes32[](0), 1);
    }

    function testCuratorCannotAdmin() public {
        vm.prank(curator);
        vm.expectRevert();
        registry.setApplicationsOpen(false);
    }

    function testOnlyCuratorApproves() public {
        applyOne();
        vm.expectRevert(AnimeFighterRegistry.Unauthorized.selector);
        registry.approve(new uint256[](1), new bytes32[](1), 1);
    }

    function testCuratorRotation() public {
        registry.setCurator(holder);
        assertEq(registry.curator(), holder);
        vm.prank(curator);
        vm.expectRevert(AnimeFighterRegistry.Unauthorized.selector);
        registry.revoke(1, 0, "");
    }

    function testZeroCurator() public {
        vm.expectRevert(AnimeFighterRegistry.InvalidConfig.selector);
        registry.setCurator(address(0));
    }

    function testOwnershipTwoStep() public {
        registry.transferOwnership(holder);
        assertEq(registry.owner(), address(this));
        vm.prank(holder);
        registry.acceptOwnership();
        assertEq(registry.owner(), holder);
    }

    function testWrongChain() public {
        applyOne();
        approveOne();
        assertFalse(registry.isEligible(1, registry.BASE_YUNIPALS(), 1));
    }

    function testWrongCollection() public {
        applyOne();
        approveOne();
        assertFalse(registry.isEligible(8453, address(123), 1));
    }

    function testUnapprovedIneligible() public {
        applyOne();
        assertFalse(registry.isEligible(8453, registry.BASE_YUNIPALS(), 1));
    }

    function testApprovalFollowsTransfer() public {
        applyOne();
        approveOne();
        nft.setOwner(1, address(99));
        assertTrue(registry.isEligible(8453, registry.BASE_YUNIPALS(), 1));
    }

    function testManifestURI() public view {
        assertEq(registry.manifestURI(1234), "https://assets.example/fighters/v1/1234/manifest.json");
    }

    function testBatchAtomicity() public {
        applyOne();
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = manifest;
        hashes[1] = manifest;
        vm.prank(curator);
        vm.expectRevert(AnimeFighterRegistry.InvalidState.selector);
        registry.approve(ids, hashes, 1);
        assertEq(uint256(status()), 1);
    }
}
