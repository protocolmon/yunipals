// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {VRF} from "@chainlink/contracts/src/v0.8/vrf/VRF.sol";

interface IProofWrapper {
    function s_vrfCoordinator() external view returns (address);
}

interface IProofCoordinator {
    function BLOCKHASH_STORE() external view returns (address);
}

interface IProofBlockhashStore {
    function getBlockhash(uint256 number) external view returns (bytes32);
}

/// @dev Base uses the coordinator's ordinary EVM block.number/blockhash seed derivation.
/// No new oracle, replacement request, administrator seed, or supplied block hash is accepted.
abstract contract BoosterProofRecovery is VRF {
    struct ProofContext {
        address coordinator;
        uint64 requestBlock;
        uint16 confirmations;
        address blockhashStore;
        uint256 chainId;
    }

    /// @custom:storage-location erc7201:yunipals.storage.BoosterProofRecovery
    struct ProofStorage {
        mapping(uint256 => ProofContext) contexts;
        mapping(uint256 => bytes32) blockhashes;
    }

    // keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PROOF_STORAGE =
        0x662f6d83212ab62fbd2ff0a5bd5af8d487c6522e7bedb030325db3dd4b12cb00;

    event ProofContextRecorded(
        uint256 indexed requestId,
        address indexed coordinator,
        address blockhashStore,
        uint64 requestBlock,
        uint16 confirmations
    );
    event BlockhashCheckpointed(uint256 indexed blockNumber, bytes32 blockHash);

    function _proofStorage() private pure returns (ProofStorage storage s) {
        assembly {
            s.slot := PROOF_STORAGE
        }
    }

    function proofContext(uint256 id) public view returns (ProofContext memory) {
        return _proofStorage().contexts[id];
    }

    function checkpointedBlockhash(uint256 number) public view returns (bytes32) {
        return _proofStorage().blockhashes[number];
    }

    function _recordProofContext(uint256 id, address coordinator, address store, uint16 confirmations)
        internal
    {
        require(block.number > 0 && block.number <= type(uint64).max, "invalid request block");
        _proofStorage().contexts[id] =
            ProofContext(coordinator, uint64(block.number), confirmations, store, block.chainid);
        emit ProofContextRecorded(id, coordinator, store, uint64(block.number), confirmations);
    }

    /// @notice Anyone may preserve a request block hash, even before its proof is available.
    function checkpointRequestBlock(uint256 id) external returns (bytes32 hash) {
        ProofContext memory context = proofContext(id);
        require(context.requestBlock != 0 && context.chainId == block.chainid, "missing proof context");
        // Persist only an EVM-derived hash. The external store is consulted transiently at
        // restore time and can still be superseded by a verified header walk (R-01).
        hash = blockhash(context.requestBlock);
        require(hash != bytes32(0), "request block outside EVM window");
        _checkpoint(context.requestBlock, hash);
    }

    /// @notice Backfill old hashes without trusting a caller or a new service.
    /// @dev Headers run backwards: childBlock, childBlock-1, ...; start from an EVM
    /// block hash or a previously verified checkpoint. Only the final parent is stored.
    /// Split long history into batches of <=64 headers, resuming at that checkpoint.
    function checkpointBlockHeaders(uint256 childBlock, bytes[] calldata headers) external {
        require(headers.length > 0 && headers.length <= 64 && childBlock >= headers.length, "invalid headers");
        bytes32 expected = blockhash(childBlock);
        if (expected == bytes32(0)) expected = checkpointedBlockhash(childBlock);
        require(expected != bytes32(0), "unknown checkpoint");
        for (uint256 i; i < headers.length; ++i) {
            bytes calldata header = headers[i];
            // Canonical Ethereum headers are an RLP long list with a two-byte
            // length, whose first item is the 32-byte parentHash (same as Chainlink BHS).
            require(
                header.length >= 36 && header[0] == 0xf9 && header[3] == 0xa0
                    && (uint256(uint8(header[1])) * 256 + uint8(header[2])) == header.length - 3,
                "unsupported header encoding"
            );
            require(keccak256(header) == expected, "header hash mismatch");
            assembly {
                expected := calldataload(add(header.offset, 4))
            }
            require(expected != bytes32(0), "zero parent hash");
        }
        _checkpoint(childBlock - headers.length, expected);
    }

    function _checkpoint(uint256 number, bytes32 hash) private {
        bytes32 previous = checkpointedBlockhash(number);
        require(previous == bytes32(0) || previous == hash, "checkpoint conflict");
        if (previous == bytes32(0)) {
            _proofStorage().blockhashes[number] = hash;
            emit BlockhashCheckpointed(number, hash);
        }
    }

    function _requestBlockhash(ProofContext memory context) private view returns (bytes32 hash) {
        require(context.requestBlock != 0 && context.chainId == block.chainid, "missing proof context");
        hash = blockhash(context.requestBlock);
        if (hash == bytes32(0)) hash = checkpointedBlockhash(context.requestBlock);
        if (hash == bytes32(0)) {
            // Same historical blockhash authority that the original coordinator uses.
            // If unavailable, checkpointBlockHeaders provides a permissionless fallback.
            try IProofBlockhashStore(context.blockhashStore).getBlockhash(context.requestBlock) returns (
                bytes32 stored
            ) {
                hash = stored;
            } catch {}
        }
        require(hash != bytes32(0), "checkpoint request block first");
    }

    function _verifyRequestProof(uint256 id, Proof calldata proof) internal view returns (uint256 word) {
        ProofContext memory context = proofContext(id);
        require(context.requestBlock != 0 && context.chainId == block.chainid, "missing proof context");
        require(block.number >= uint256(context.requestBlock) + context.confirmations, "wait confirmations");
        // requestId is returned directly by the recorded wrapper at purchase/claim.
        // Matching it binds BOTH the oracle public key and pre-seed; a different key
        // or request cannot be substituted even after coordinator state is deleted.
        require(
            uint256(keccak256(abi.encode(keccak256(abi.encode(proof.pk)), proof.seed))) == id,
            "proof request mismatch"
        );
        uint256 actualSeed = uint256(keccak256(abi.encodePacked(proof.seed, _requestBlockhash(context))));
        uint256 output = _randomValueFromVRFProof(proof, actualSeed);
        // Coordinator expands its verified output into words; we always request word 0.
        return uint256(keccak256(abi.encode(output, uint256(0))));
    }
}
