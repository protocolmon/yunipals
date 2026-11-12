// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BoosterAdmin} from "./BoosterAdmin.sol";
import {PackRegistry} from "./PackRegistry.sol";

interface IOriginalBurn {
    function onOriginalBurned(uint256 tokenId) external;
}

interface IGradedCardMetadata {
    function metadataURI(uint256 tokenId) external view returns (string memory);
}

contract YunipalMonsters is IERC4906, ERC721Upgradeable, BoosterAdmin {
    struct Provenance {
        uint256 packTypeId;
        uint256 originalTokenId;
        uint32 variantId;
        PackRegistry.Traits traits;
        bool isOriginal;
    }

    struct CardFacts {
        uint32 sequence;
        uint64 mintedAt;
        bool initialized;
    }

    PackRegistry public registry;
    uint256 public nextTokenId;
    mapping(uint256 => uint256) public reservedType;
    mapping(uint256 => Provenance) public provenance;
    // Optional token-ID metadata. Existing proxies default to frozen variant metadata.
    string public tokenMetadataBaseURI;
    mapping(uint256 => CardFacts) public cardFacts;
    bool public cardFactsImportClosed;
    address public gradingRegistry;
    // A bitmap prevents duplicate sequence imports without a fresh storage slot per offspring.
    mapping(uint256 => mapping(uint32 => uint256)) private _recordedSequences;
    uint256[42] private __gap;

    event MonsterMinted(
        uint256 indexed tokenId,
        uint256 indexed originalTokenId,
        uint256 indexed packTypeId,
        address recipient,
        uint32 variantId,
        uint32 monsterType,
        uint32 color,
        uint32 horn,
        uint32 glitter,
        bool isOriginal
    );
    event OriginalBurned(uint256 indexed tokenId, uint256 indexed packTypeId);
    event TokenMetadataBaseURISet(string previousURI, string newURI);
    event CardFactsRecorded(uint256 indexed tokenId, uint32 sequence, uint64 mintedAt, bool imported);
    event CardFactsImportClosed();
    event GradingRegistrySet(address indexed gradingRegistry);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, PackRegistry registry_) external initializer {
        require(address(registry_).code.length != 0, "invalid registry");
        __ERC721_init("Yunipals Monsters", "YUNIM");
        __BoosterAdmin_init(admin);
        registry = registry_;
        nextTokenId = 1;
    }

    function reserveOriginal(uint256 packTypeId) external returns (uint256 tokenId) {
        _checkEngine(packTypeId);
        tokenId = nextTokenId++;
        reservedType[tokenId] = packTypeId;
    }

    function mintOriginal(uint256 tokenId, address recipient, uint32 variantId) external {
        uint256 packTypeId = reservedType[tokenId];
        _checkEngine(packTypeId);
        delete reservedType[tokenId];
        _mintMonster(tokenId, tokenId, packTypeId, recipient, variantId, true);
    }

    function mintOffspring(uint256 originalId, address recipient, uint32 variantId)
        external
        returns (uint256 id)
    {
        return _mintOffspring(originalId, recipient, variantId);
    }

    function mintOffspringWithSequence(
        uint256 originalId,
        address recipient,
        uint32 variantId,
        uint32 sequence
    ) external {
        uint256 id = _mintOffspring(originalId, recipient, variantId);
        _writeCardFacts(id, sequence, uint64(block.timestamp), false);
    }

    function _mintOffspring(uint256 originalId, address recipient, uint32 variantId)
        private
        returns (uint256 id)
    {
        Provenance storage parent = provenance[originalId];
        _checkEngine(parent.packTypeId);
        require(parent.isOriginal && ownerOf(originalId) == recipient, "invalid parent or owner");
        id = nextTokenId++;
        _mintMonster(id, originalId, parent.packTypeId, recipient, variantId, false);
    }

    function burn(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "owner only");
        Provenance storage p = provenance[tokenId];
        _burn(tokenId);
        if (p.isOriginal) {
            PackRegistry.Pack memory pack = registry.getPack(p.packTypeId);
            IOriginalBurn(pack.rules.engine).onOriginalBurned(tokenId);
            emit OriginalBurned(tokenId, p.packTypeId);
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (gradingRegistry != address(0)) {
            string memory graded = IGradedCardMetadata(gradingRegistry).metadataURI(tokenId);
            if (bytes(graded).length != 0) return graded;
        }
        if (bytes(tokenMetadataBaseURI).length != 0) {
            return string.concat(tokenMetadataBaseURI, Strings.toString(tokenId), ".json");
        }
        Provenance storage p = provenance[tokenId];
        PackRegistry.Pack memory pack = registry.getPack(p.packTypeId);
        return string.concat(pack.rules.metadataBaseURI, Strings.toString(p.variantId), ".json");
    }

    /// @notice Called atomically by the mint engine with its pre-batch cumulative count.
    function recordMintFacts(uint256 tokenId, uint32 sequence) external {
        _checkEngine(provenance[tokenId].packTypeId);
        _writeCardFacts(tokenId, sequence, uint64(block.timestamp), false);
    }

    /// @notice Direct, write-once historical import. Burned cards retain their provenance.
    function importCardFacts(uint256[] calldata ids, uint32[] calldata sequences, uint64[] calldata times)
        external
        onlyRole(CONFIG_ROLE)
    {
        require(!cardFactsImportClosed && ids.length > 0 && ids.length <= 200, "import unavailable");
        require(ids.length == sequences.length && ids.length == times.length, "length mismatch");
        for (uint256 i; i < ids.length; ++i) {
            _writeCardFacts(ids[i], sequences[i], times[i], true);
        }
    }

    function closeCardFactsImport() external onlyRole(CONFIG_ROLE) {
        require(!cardFactsImportClosed, "import closed");
        cardFactsImportClosed = true;
        emit CardFactsImportClosed();
    }

    function setGradingRegistry(address grading) external onlyRole(CONFIG_ROLE) {
        require(grading.code.length != 0, "invalid grading registry");
        gradingRegistry = grading;
        emit GradingRegistrySet(grading);
        if (nextTokenId > 1) emit BatchMetadataUpdate(1, nextTokenId - 1);
    }

    function notifyGradingUpdate(uint256 tokenId) external {
        require(msg.sender == gradingRegistry, "grading registry only");
        if (_ownerOf(tokenId) != address(0)) emit MetadataUpdate(tokenId);
    }

    function _writeCardFacts(uint256 tokenId, uint32 sequence, uint64 mintedAt, bool imported) private {
        Provenance storage p = provenance[tokenId];
        require(p.originalTokenId != 0 && !cardFacts[tokenId].initialized, "unknown or recorded card");
        require(mintedAt != 0 && mintedAt <= block.timestamp, "invalid mint time");
        require(p.isOriginal == (sequence == 0), "invalid sequence origin");
        require(sequence < registry.getPack(p.packTypeId).totalVariants, "sequence outside family");
        uint32 page = sequence >> 8;
        uint256 mask = uint256(1) << (sequence & 255);
        require(_recordedSequences[p.originalTokenId][page] & mask == 0, "family sequence already assigned");
        CardFacts memory previous = cardFacts[tokenId];
        require(previous.mintedAt == 0 || previous.mintedAt == mintedAt, "mint time mismatch");
        if (!p.isOriginal && cardFacts[p.originalTokenId].initialized) {
            require(mintedAt >= cardFacts[p.originalTokenId].mintedAt, "mint precedes original");
        }
        cardFacts[tokenId] = CardFacts(sequence, mintedAt, true);
        _recordedSequences[p.originalTokenId][page] |= mask;
        emit CardFactsRecorded(tokenId, sequence, mintedAt, imported);
    }

    /// @notice Configure token-specific metadata without editing any activated pack rules.
    /// @dev Empty restores each pack's original variant metadata. No reinitializer is required.
    function setTokenMetadataBaseURI(string calldata baseURI) external onlyRole(CONFIG_ROLE) {
        _validateMetadataBaseURI(bytes(baseURI));
        string memory previousURI = tokenMetadataBaseURI;
        tokenMetadataBaseURI = baseURI;
        emit TokenMetadataBaseURISet(previousURI, baseURI);
        if (nextTokenId > 1) emit BatchMetadataUpdate(0, nextTokenId - 1);
    }

    function _validateMetadataBaseURI(bytes memory uri) private pure {
        uint256 length = uri.length;
        require(length <= 512, "metadata URI too long");
        if (length == 0) return;
        uint256 prefixLength;
        if (length >= 8 && keccak256(bytes("https://")) == keccak256(_prefix(uri, 8))) {
            prefixLength = 8;
        } else if (length >= 7 && keccak256(bytes("ipfs://")) == keccak256(_prefix(uri, 7))) {
            prefixLength = 7;
        } else {
            revert("metadata URI scheme");
        }
        require(length > prefixLength + 1 && _isAlphaNumeric(uri[prefixLength]), "metadata URI authority");
        require(uri[length - 1] == bytes1("/"), "metadata base slash");
        // Keep a literal, unambiguous base: no credentials, query/fragment,
        // escapes, whitespace, control characters or executable URI schemes.
        for (uint256 i = prefixLength; i < length; ++i) {
            bytes1 c = uri[i];
            require(
                _isAlphaNumeric(c) || c == bytes1("-") || c == bytes1(".") || c == bytes1("_")
                    || c == bytes1("~") || c == bytes1(":") || c == bytes1("/"),
                "metadata URI character"
            );
        }
    }

    function _prefix(bytes memory uri, uint256 length) private pure returns (bytes memory result) {
        result = new bytes(length);
        for (uint256 i; i < length; ++i) {
            result[i] = uri[i];
        }
    }

    function _isAlphaNumeric(bytes1 c) private pure returns (bool) {
        return (c >= bytes1("0") && c <= bytes1("9")) || (c >= bytes1("A") && c <= bytes1("Z"))
            || (c >= bytes1("a") && c <= bytes1("z"));
    }

    function _checkEngine(uint256 packTypeId) private view {
        PackRegistry.Pack memory pack = registry.getPack(packTypeId);
        require(pack.active && pack.rules.engine == msg.sender, "unregistered engine");
    }

    function _mintMonster(
        uint256 id,
        uint256 parent,
        uint256 packTypeId,
        address recipient,
        uint32 variantId,
        bool original
    ) private {
        PackRegistry.Traits memory traits = registry.traitsFor(packTypeId, variantId);
        provenance[id] = Provenance(packTypeId, parent, variantId, traits, original);
        // Oracle callbacks must never execute arbitrary ERC721Receiver code.
        _mint(recipient, id);
        if (original) _writeCardFacts(id, 0, uint64(block.timestamp), false);
        else cardFacts[id].mintedAt = uint64(block.timestamp);
        emit MonsterMinted(
            id,
            parent,
            packTypeId,
            recipient,
            variantId,
            traits.monsterType,
            traits.color,
            traits.horn,
            traits.glitter,
            original
        );
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, AccessControlUpgradeable, IERC165)
        returns (bool)
    {
        return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }
}
