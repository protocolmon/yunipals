// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IEligibility} from "./IEligibility.sol";

/// @notice Reviewed anime artwork belongs to the Base OG token, including after transfer.
contract AnimeFighterRegistry is Ownable2Step, IEligibility {
    enum Status {
        None,
        Applied,
        Approved,
        Rejected,
        Revoked
    }

    struct Fighter {
        Status status;
        uint16 recipeVersion;
        uint32 applications;
        bytes32 manifestHash;
    }

    error Unauthorized();
    error InvalidConfig();
    error InvalidState();
    error InvalidBatch();
    error InvalidReason();

    address public constant BASE_YUNIPALS = 0x98433dF878e8C898CB907345C3a7756E5F72240f;
    address public curator;
    bool public applicationsOpen;
    string public baseURI;
    mapping(uint256 tokenId => Fighter) public fighters;

    event Applied(uint256 indexed tokenId, address indexed owner, uint32 application);
    event Approved(uint256 indexed tokenId, bytes32 manifestHash, uint16 recipeVersion);
    event Rejected(uint256 indexed tokenId, uint8 reasonCode, string note);
    event Revoked(uint256 indexed tokenId, uint8 reasonCode, string note);
    event CuratorChanged(address indexed previous, address indexed next);
    event ApplicationsOpenChanged(bool open);
    event BaseURIChanged(string baseURI);

    constructor(address admin, address initialCurator, string memory uri) Ownable(admin) {
        _setCurator(initialCurator);
        _setBaseURI(uri);
    }

    modifier onlyCurator() {
        if (msg.sender != curator) revert Unauthorized();
        _;
    }

    function setCurator(address next) external onlyOwner {
        _setCurator(next);
    }

    function _setCurator(address next) private {
        if (next == address(0) || next == address(this)) revert InvalidConfig();
        emit CuratorChanged(curator, next);
        curator = next;
    }

    function setApplicationsOpen(bool open) external onlyOwner {
        applicationsOpen = open;
        emit ApplicationsOpenChanged(open);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        _setBaseURI(uri);
    }

    function _setBaseURI(string memory uri) private {
        bytes memory value = bytes(uri);
        if (value.length < 9 || value[value.length - 1] != bytes1("/")) revert InvalidConfig();
        baseURI = uri;
        emit BaseURIChanged(uri);
    }

    function applyForArena(uint256 tokenId) external {
        Fighter storage f = fighters[tokenId];
        if (!applicationsOpen || (f.status != Status.None && f.status != Status.Rejected)) {
            revert InvalidState();
        }
        if (IERC721(BASE_YUNIPALS).ownerOf(tokenId) != msg.sender) revert Unauthorized();
        f.status = Status.Applied;
        emit Applied(tokenId, msg.sender, ++f.applications);
    }

    function approve(uint256[] calldata ids, bytes32[] calldata hashes, uint16 recipeVersion)
        external
        onlyCurator
    {
        if (ids.length == 0 || ids.length != hashes.length) revert InvalidBatch();
        if (recipeVersion == 0) revert InvalidConfig();
        for (uint256 i; i < ids.length; ++i) {
            Fighter storage f = fighters[ids[i]];
            if (f.status == Status.Approved) {
                // A reviewed recipe upgrade preserves eligibility and historical
                // content-addressed manifests. Same-version edits and downgrades
                // require an explicit revoke/review instead of a silent replacement.
                if (recipeVersion <= f.recipeVersion || hashes[i] == f.manifestHash) {
                    revert InvalidState();
                }
            } else if (f.status != Status.Applied && f.status != Status.Revoked) {
                revert InvalidState();
            }
            if (hashes[i] == bytes32(0)) revert InvalidConfig();
            f.status = Status.Approved;
            f.manifestHash = hashes[i];
            f.recipeVersion = recipeVersion;
            emit Approved(ids[i], hashes[i], recipeVersion);
        }
    }

    function reject(uint256[] calldata ids, uint8[] calldata codes, string[] calldata notes)
        external
        onlyCurator
    {
        if (ids.length == 0 || ids.length != codes.length || ids.length != notes.length) {
            revert InvalidBatch();
        }
        for (uint256 i; i < ids.length; ++i) {
            Fighter storage f = fighters[ids[i]];
            if (f.status != Status.Applied) revert InvalidState();
            _reason(codes[i], notes[i], false);
            f.status = Status.Rejected;
            emit Rejected(ids[i], codes[i], notes[i]);
        }
    }

    function revoke(uint256 tokenId, uint8 code, string calldata note) external onlyCurator {
        Fighter storage f = fighters[tokenId];
        if (f.status != Status.Approved) revert InvalidState();
        _reason(code, note, true);
        f.status = Status.Revoked;
        emit Revoked(tokenId, code, note);
    }

    // Limit UTF-8 bytes (also bounds characters and event costs). Notes are public event data only.
    function _reason(uint8 code, string calldata note, bool revoking) private pure {
        if (code > 5 || (!revoking && code == 5) || bytes(note).length > 140) revert InvalidReason();
    }

    function isEligible(uint256 chainId, address collection, uint256 tokenId) external view returns (bool) {
        return chainId == 8453 && collection == BASE_YUNIPALS && fighters[tokenId].status == Status.Approved;
    }

    function manifestURI(uint256 tokenId) external view returns (string memory) {
        return string.concat(baseURI, Strings.toString(tokenId), "/manifest.json");
    }
}
