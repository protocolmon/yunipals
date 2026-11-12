// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PortalRandomness} from "./PortalRandomness.sol";
import {PortalGates} from "./PortalGates.sol";
import {PortalRules} from "./PortalRules.sol";
import {PortalPool} from "./PortalPool.sol";

interface IPortalClaimController {
    function registry() external view returns (IPortalClaimRegistry);
}

interface IPortalClaimRegistry {
    function collection() external view returns (address);
}

contract PortalCollection is ERC721Upgradeable, PortalRandomness {
    using PortalPool for PortalPool.Pool;

    struct KindDefinition {
        string name;
        string imageURI;
        bytes32 artworkHash;
        uint16 cap;
        PortalGates.Odds odds;
    }

    struct Kind {
        KindDefinition definition;
        bytes32 configurationHash;
        uint16 allocated;
        bool frozen;
    }

    struct MintRequest {
        uint256 kindId;
        uint16 firstSerial;
        uint16 processed;
        address[] recipients;
    }

    uint256 public kindCount;
    mapping(uint256 => Kind) private _kinds;
    mapping(uint256 => MintRequest) private _mints;
    mapping(uint256 => uint256) public tokenKind;
    mapping(uint256 => PortalGates.Gates) private _gates;
    uint256[] private _allPortals;
    mapping(uint256 => uint256[]) private _kindPortals;
    mapping(uint256 => uint256) public globalIndexPlusOne;
    address public claimController;
    uint48 public poolRevision;
    mapping(uint256 => PortalPool.Pool) private _livePools;
    uint256[40] private __gap;

    event KindConfigured(uint256 indexed kindId, string name, bytes32 configurationHash);
    event MintCommitted(
        uint256 indexed requestId, uint256 indexed kindId, uint16 firstSerial, uint16 quantity
    );
    event PortalMinted(
        uint256 indexed requestId, uint256 indexed tokenId, uint256 indexed kindId, address recipient
    );
    event ClaimControllerBound(address indexed controller);
    event PortalRetired(
        uint256 indexed tokenId, uint256 indexed kindId, address indexed owner, uint48 revision
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, IVRFV2PlusWrapper wrapper_, uint16 confirmations_, PortalRules rules_)
        external
        initializer
    {
        __ERC721_init("Yunipals Portals", "YUNIPORTAL");
        __PortalRandomness_init(admin, wrapper_, confirmations_, rules_);
    }

    function rainbowOdds() external view returns (PortalGates.Odds memory) {
        return rules.rainbowOdds();
    }

    function configureKind(uint256 id, KindDefinition calldata definition)
        external
        onlyRole(CONFIG_ROLE)
        returns (uint256)
    {
        if (id == 0) id = ++kindCount;
        require(id <= type(uint208).max / 1000, "kind ID bound");
        require(id <= kindCount && !_kinds[id].frozen, "invalid or frozen kind");
        rules.validateKind(
            definition.name, definition.imageURI, definition.artworkHash, definition.cap, definition.odds
        );
        Kind storage kind = _kinds[id];
        kind.definition = definition;
        kind.configurationHash = keccak256(abi.encode(definition));
        emit KindConfigured(id, definition.name, kind.configurationHash);
        return id;
    }

    function getKind(uint256 id) external view returns (Kind memory) {
        require(id > 0 && id <= kindCount, "unknown kind");
        return _kinds[id];
    }

    function getMintRequest(uint256 id) external view returns (MintRequest memory) {
        return _mints[id];
    }

    function mintBatch(uint256 kindId, address[] calldata recipients, uint256 maxVrfPrice)
        external
        payable
        onlyRole(CONFIG_ROLE)
        nonReentrant
        returns (uint256 id)
    {
        require(kindId > 0 && kindId <= kindCount, "unknown kind");
        require(recipients.length > 0 && recipients.length <= 100, "invalid mint batch");
        Kind storage kind = _kinds[kindId];
        require(uint256(kind.allocated) + recipients.length <= kind.definition.cap, "kind cap");
        for (uint256 i; i < recipients.length; ++i) {
            require(recipients[i] != address(0), "zero recipient");
        }
        uint16 firstSerial = kind.allocated + 1;
        kind.allocated += uint16(recipients.length);
        kind.frozen = true;
        uint256 paid;
        (id, paid) = _requestRandomness(maxVrfPrice);
        MintRequest storage request = _mints[id];
        request.kindId = kindId;
        request.firstSerial = firstSerial;
        request.recipients = recipients;
        emit MintCommitted(id, kindId, firstSerial, uint16(recipients.length));
        _refundExcess(paid);
    }

    function finishMint(uint256 id, uint16 maximum) external nonReentrant {
        MintRequest storage request = _mints[id];
        require(request.kindId != 0 && randomRequests[id].received, "mint not ready");
        require(
            maximum > 0 && maximum <= 32 && request.processed < request.recipients.length,
            "invalid mint progress"
        );
        Kind storage kind = _kinds[request.kindId];
        uint256 end = uint256(request.processed) + maximum;
        if (end > request.recipients.length) end = request.recipients.length;
        uint48 revision = ++poolRevision;
        for (uint256 i = request.processed; i < end; ++i) {
            uint256 tokenId = (request.kindId - 1) * 1000 + request.firstSerial + i;
            bytes32 entropy = keccak256(
                abi.encode(
                    randomRequests[id].seed, block.chainid, address(this), id, tokenId, kind.configurationHash
                )
            );
            _gates[tokenId] = rules.draw(entropy, kind.definition.odds);
            tokenKind[tokenId] = request.kindId;
            // Commitments cannot be blocked or reassigned by recipient callback code.
            _mint(request.recipients[i], tokenId);
            _allPortals.push(tokenId);
            _kindPortals[request.kindId].push(tokenId);
            globalIndexPlusOne[tokenId] = _allPortals.length;
            _livePools[0].add(tokenId, revision);
            _livePools[request.kindId].add(tokenId, revision);
            emit PortalMinted(id, tokenId, request.kindId, request.recipients[i]);
        }
        request.processed = uint16(end);
    }

    function bindClaimController(address controller) external onlyRole(CONFIG_ROLE) {
        require(claimController == address(0) && controller.code.length != 0, "invalid controller");
        require(
            IPortalClaimController(controller).registry().collection() == address(this),
            "controller collection"
        );
        claimController = controller;
        emit ClaimControllerBound(controller);
    }

    function burnForClaim(uint256 tokenId, address expectedOwner) external nonReentrant {
        require(msg.sender == claimController, "claim controller only");
        require(ownerOf(tokenId) == expectedOwner, "portal owner changed");
        uint256 kindId = tokenKind[tokenId];
        uint48 revision = ++poolRevision;
        _livePools[0].remove(tokenId, revision);
        _livePools[kindId].remove(tokenId, revision);
        _burn(tokenId);
        emit PortalRetired(tokenId, kindId, expectedOwner, revision);
    }

    function exists(uint256 tokenId) public view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    function portalRecord(uint256 tokenId)
        external
        view
        returns (uint256 kindId, PortalGates.Gates memory gate, address owner)
    {
        kindId = tokenKind[tokenId];
        require(kindId != 0, "unknown portal");
        return (kindId, _gates[tokenId], _ownerOf(tokenId));
    }

    function livePortalCount(uint256 kindId) public view returns (uint256) {
        return _livePools[kindId].tokens.length;
    }

    function liveIndexPlusOne(uint256 tokenId) external view returns (uint256) {
        return _livePools[0].indexPlusOne[tokenId];
    }

    function poolSnapshot(uint256 kindId) external view returns (uint48 revision, uint256 count) {
        return (poolRevision, livePortalCount(kindId));
    }

    function portalAtSnapshot(uint256 kindId, uint48 revision, uint256 index)
        external
        view
        returns (uint256)
    {
        require(revision <= poolRevision, "future snapshot");
        return _livePools[kindId].at(revision, index);
    }

    function portalCount(uint256 kindId) public view returns (uint256) {
        return kindId == 0 ? _allPortals.length : _kindPortals[kindId].length;
    }

    function portalAt(uint256 kindId, uint256 index) external view returns (uint256) {
        return kindId == 0 ? _allPortals[index] : _kindPortals[kindId][index];
    }

    function gates(uint256 tokenId) public view returns (PortalGates.Gates memory) {
        _requireOwned(tokenId);
        return _gates[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        PortalGates.Gates memory g = gates(tokenId);
        Kind storage kind = _kinds[tokenKind[tokenId]];
        return rules.metadata(kind.definition.name, kind.definition.imageURI, tokenId, tokenKind[tokenId], g);
    }

    function supportsInterface(bytes4 id)
        public
        view
        override(ERC721Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(id);
    }
}
