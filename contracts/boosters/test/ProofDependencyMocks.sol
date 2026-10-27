// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Test-only coordinator/blockhash store. Production snapshots the real wrapper's dependencies.
contract ProofDependencyMocks {
    address public s_vrfCoordinator = address(this);
    address public BLOCKHASH_STORE = address(this);
    mapping(uint256 => bytes32) public storedHashes;

    function setProofDependencies(address coordinator, address store) external {
        s_vrfCoordinator = coordinator;
        BLOCKHASH_STORE = store;
    }

    function setBlockhash(uint256 number, bytes32 hash) external {
        storedHashes[number] = hash;
    }

    function getBlockhash(uint256 number) external view returns (bytes32) {
        require(storedHashes[number] != bytes32(0), "not stored");
        return storedHashes[number];
    }
}
