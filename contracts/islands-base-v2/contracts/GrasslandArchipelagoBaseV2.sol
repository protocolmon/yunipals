// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Replaces the first Base airdrop, preserving IDs and published arena assignments.
/// @dev The distribution is fixed by a Merkle root of snapshot token/owner pairs.
contract GrasslandArchipelagoBaseV2 is ERC721Enumerable, Ownable {
    error AirdropAlreadyFinalized();
    error AirdropSupplyIncomplete(uint256 actual, uint256 expected);
    error InvalidDistribution();
    error InvalidProof(uint256 tokenId, address recipient);
    error InvalidBatch();
    error UnsupportedTokenId(uint256 tokenId);
    error UseFinalizeAirdrop();

    event AirdropBatchMinted(address indexed operator, uint256 count);
    event AirdropFinalized(uint256 totalSupply, uint256 sourceBlockNumber, bytes32 sourceBlockHash, bytes32 distributionSha256);

    uint256 public constant SOURCE_CHAIN_ID = 1;
    address public constant SOURCE_CONTRACT = 0xA22e2F53CA787414Dc0643C399F92234949e2305;
    uint256 public constant SOURCE_BLOCK_NUMBER = 25_694_139;
    bytes32 public constant SOURCE_BLOCK_HASH = 0x7d1947e957b1c7ddc734682913b9d31f15ce5a80856a2a4ca163b870aa431109;
    bytes32 public constant SNAPSHOT_JSON_SHA256 = 0x1c22d608123555d9bdf63d99cf8c77e481d00c195c017e20da55d9f03a02448e;
    bytes32 public constant DISTRIBUTION_CSV_SHA256 = 0x315ecead989a95686a7c41fcdeac9b9ed2e1f586b5e7fae8806a37e8662a0282;
    address public constant REPLACES_CONTRACT = 0x1058F1a6FedcAEC94e488D6Ec3C639E541fAF066;
    bytes32 public constant REVEAL_COMMITMENT_SHA256 = 0xd65a6414bc8c927bf047f0430862f5bb2e451deb9a84e15151100af4f1cdbdd4;
    bytes32 public constant REVEAL_ASSIGNMENTS_SHA256 = 0xcfdc7ea0a31f1779e1ef5e2a6e00a1f262b411226022b318f797697dfbb3fc2e;
    uint256 public constant EXPECTED_SUPPLY = 898;
    string public constant BASE_METADATA_URI = "https://islands-meta.yunipals.com/v2/base-islands/";

    bytes32 public immutable DISTRIBUTION_ROOT;
    uint256 public immutable REPLACEMENT_SNAPSHOT_BLOCK;
    bytes32 public immutable REPLACEMENT_SNAPSHOT_HASH;
    bytes32 public immutable REPLACEMENT_SNAPSHOT_SHA256;
    bool public airdropFinalized;

    constructor(address initialOwner, bytes32 distributionRoot, uint256 snapshotBlock, bytes32 snapshotHash, bytes32 snapshotSha256)
        ERC721("Grassland Archipelago", "PGA") Ownable(initialOwner)
    {
        if (distributionRoot == bytes32(0) || snapshotBlock == 0 || snapshotHash == bytes32(0) || snapshotSha256 == bytes32(0)) {
            revert InvalidDistribution();
        }
        DISTRIBUTION_ROOT = distributionRoot;
        REPLACEMENT_SNAPSHOT_BLOCK = snapshotBlock;
        REPLACEMENT_SNAPSHOT_HASH = snapshotHash;
        REPLACEMENT_SNAPSHOT_SHA256 = snapshotSha256;
    }

    function airdropBatch(address[] calldata recipients, uint256[] calldata tokenIds, bytes32[][] calldata proofs) external onlyOwner {
        if (airdropFinalized) revert AirdropAlreadyFinalized();
        if (tokenIds.length == 0 || tokenIds.length > 40 || tokenIds.length != recipients.length || tokenIds.length != proofs.length) revert InvalidBatch();
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            if (!((tokenId >= 1 && tokenId <= 525) || (tokenId >= 1001 && tokenId <= 1373))) revert UnsupportedTokenId(tokenId);
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(tokenId, recipients[i]))));
            if (!MerkleProof.verifyCalldata(proofs[i], DISTRIBUTION_ROOT, leaf)) revert InvalidProof(tokenId, recipients[i]);
            // Mirror the existing airdrop's no-callback minting to preserve contract recipients.
            _mint(recipients[i], tokenId);
        }
        emit AirdropBatchMinted(msg.sender, tokenIds.length);
    }

    function finalizeAirdrop() external onlyOwner {
        if (airdropFinalized) revert AirdropAlreadyFinalized();
        uint256 supply = totalSupply();
        if (supply != EXPECTED_SUPPLY) revert AirdropSupplyIncomplete(supply, EXPECTED_SUPPLY);
        airdropFinalized = true;
        emit AirdropFinalized(supply, SOURCE_BLOCK_NUMBER, SOURCE_BLOCK_HASH, DISTRIBUTION_CSV_SHA256);
        _transferOwnership(address(0));
    }

    function renounceOwnership() public view override onlyOwner {
        revert UseFinalizeAirdrop();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(BASE_METADATA_URI, Strings.toString(tokenId));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
