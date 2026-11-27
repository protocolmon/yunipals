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
    function evolutionIntegrationVersion() external view returns (uint256);
    function metadataURI(uint256 tokenId) external view returns (string memory);
    function pendingRequest(uint256 tokenId) external view returns (uint256);
    function historyCount(uint256 tokenId) external view returns (uint256);
}

interface IEvolvedCardMetadata {
    function cards() external view returns (address);
    function metadataURI(uint256 tokenId) external view returns (string memory);
    function artwork(uint256 tokenId) external view returns (string memory uri, bytes32 hash, uint64 version);
}

interface IEvolutionBinding {
    function adventures() external view returns (address);
}

interface IOriginalClaimState {
    function evolutionClaimLocks() external view returns (bool);
    function originals(uint256 tokenId) external view returns
        (uint256, uint256 pending, uint64, uint32, uint32, uint32, bool);
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

    struct Fusion {
        uint256 parentA;
        uint256 parentB;
        uint256[4] sources;
        uint16 sequenceSum;
        uint8 sourceCount;
        uint8 level;
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
    address public evolutionController;
    address public adventureController;
    mapping(uint256 => address) public cardReservation;
    mapping(uint256 => bool) public transferLocked;
    mapping(uint256 => Fusion) private _fusions;
    uint256[37] private __gap;

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
    event EvolutionConfigured(address indexed evolution, address indexed adventures);
    event CardReserved(uint256 indexed tokenId, address indexed controller, bool transferLocked);
    event CardReleased(uint256 indexed tokenId, address indexed controller);
    event FusionMinted(uint256 indexed tokenId, uint256 indexed parentA, uint256 indexed parentB,
        address recipient, uint8 level, uint256[4] sources, uint16 sequenceSum, uint8 sourceCount);

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
        (id,) = _mintOffspring(originalId, recipient, variantId);
    }

    function mintOffspringWithSequence(
        uint256 originalId,
        address recipient,
        uint32 variantId,
        uint32 sequence
    ) external {
        (uint256 id, uint32 totalVariants) = _mintOffspring(originalId, recipient, variantId);
        _writeCardFacts(id, sequence, uint64(block.timestamp), false, totalVariants);
    }

    function _mintOffspring(uint256 originalId, address recipient, uint32 variantId)
        private
        returns (uint256 id, uint32 totalVariants)
    {
        Provenance storage parent = provenance[originalId];
        totalVariants = _checkEngine(parent.packTypeId);
        require(parent.isOriginal && ownerOf(originalId) == recipient, "invalid parent or owner");
        id = nextTokenId++;
        _mintMonster(id, originalId, parent.packTypeId, recipient, variantId, false);
    }

    function burn(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "owner only");
        _burnCard(tokenId);
    }

    function _burnCard(uint256 tokenId) private {
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
        if (evolutionController != address(0)) {
            string memory evolved = IEvolvedCardMetadata(evolutionController).metadataURI(tokenId);
            if (bytes(evolved).length != 0) return evolved;
        }
        require(_fusions[tokenId].level == 0, "fusion metadata unavailable");
        if (bytes(tokenMetadataBaseURI).length != 0) {
            return string.concat(tokenMetadataBaseURI, Strings.toString(tokenId), ".json");
        }
        Provenance storage p = provenance[tokenId];
        PackRegistry.Pack memory pack = registry.getPack(p.packTypeId);
        return string.concat(pack.rules.metadataBaseURI, Strings.toString(p.variantId), ".json");
    }

    /// @notice Called atomically by the mint engine with its pre-batch cumulative count.
    function recordMintFacts(uint256 tokenId, uint32 sequence) external {
        uint32 totalVariants = _checkEngine(provenance[tokenId].packTypeId);
        _writeCardFacts(tokenId, sequence, uint64(block.timestamp), false, totalVariants);
    }

    /// @notice Direct, write-once historical import. Burned cards retain their provenance.
    function importCardFacts(uint256[] calldata ids, uint32[] calldata sequences, uint64[] calldata times)
        external
        onlyRole(CONFIG_ROLE)
    {
        require(!cardFactsImportClosed && ids.length > 0 && ids.length <= 200, "import unavailable");
        require(ids.length == sequences.length && ids.length == times.length, "length mismatch");
        for (uint256 i; i < ids.length; ++i) {
            _writeCardFacts(ids[i], sequences[i], times[i], true,
                registry.getPack(provenance[ids[i]].packTypeId).totalVariants);
        }
    }

    function closeCardFactsImport() external onlyRole(CONFIG_ROLE) {
        require(!cardFactsImportClosed, "import closed");
        cardFactsImportClosed = true;
        emit CardFactsImportClosed();
    }

    function setGradingRegistry(address grading) external onlyRole(CONFIG_ROLE) {
        require(grading.code.length != 0, "invalid grading registry");
        require(evolutionController == address(0) || grading == gradingRegistry, "grading history binding frozen");
        gradingRegistry = grading;
        emit GradingRegistrySet(grading);
        if (nextTokenId > 1) emit BatchMetadataUpdate(1, nextTokenId - 1);
    }

    function notifyGradingUpdate(uint256 tokenId) external {
        require(msg.sender == gradingRegistry || msg.sender == evolutionController, "metadata controller only");
        if (_ownerOf(tokenId) != address(0)) emit MetadataUpdate(tokenId);
    }

    /// @notice Bind once; controllers are upgradeable without abandoning reservations or history.
    function configureEvolution(address evolution, address adventures) external onlyRole(CONFIG_ROLE) {
        require(evolutionController == address(0) && adventureController == address(0), "already configured");
        require(evolution.code.length != 0 && adventures.code.length != 0 && evolution != adventures,
            "invalid controllers");
        require(IEvolvedCardMetadata(evolution).cards() == address(this)
            && IEvolvedCardMetadata(adventures).cards() == address(this), "wrong collection");
        require(IEvolutionBinding(evolution).adventures() == adventures
            && gradingRegistry != address(0) && IEvolvedCardMetadata(gradingRegistry).cards() == address(this)
            && IGradedCardMetadata(gradingRegistry).evolutionIntegrationVersion() == 1,
            "progression dependencies unbound");
        evolutionController = evolution;
        adventureController = adventures;
        emit EvolutionConfigured(evolution, adventures);
    }

    function hasCompletedGrade(uint256 tokenId) public view returns (bool) {
        return gradingRegistry != address(0) && IGradedCardMetadata(gradingRegistry).historyCount(tokenId) != 0;
    }

    error InvalidCardController();
    error ReservationOwnerOnly();
    error TransferLockRequired();
    error AdventureReservationRequired();
    error OriginalReserved();

    function reserveCard(uint256 tokenId, bool lockTransfer) external {
        if (msg.sender != evolutionController && msg.sender != adventureController
            && msg.sender != gradingRegistry) revert InvalidCardController();
        _requireOwned(tokenId);
        require(cardReservation[tokenId] == address(0), "card reserved");
        require(!hasCompletedGrade(tokenId), "card already graded");
        require(gradingRegistry == address(0)
            || IGradedCardMetadata(gradingRegistry).pendingRequest(tokenId) == 0, "grading pending");
        if (!lockTransfer && msg.sender != adventureController) revert TransferLockRequired();
        cardReservation[tokenId] = msg.sender;
        transferLocked[tokenId] = lockTransfer;
        emit CardReserved(tokenId, msg.sender, lockTransfer);
    }

    function releaseCard(uint256 tokenId) external {
        if (cardReservation[tokenId] != msg.sender) revert ReservationOwnerOnly();
        _releaseCard(tokenId);
    }

    function _releaseCard(uint256 tokenId) private {
        address controller = cardReservation[tokenId];
        delete cardReservation[tokenId];
        delete transferLocked[tokenId];
        emit CardReleased(tokenId, controller);
    }

    function fusion(uint256 tokenId) external view returns (Fusion memory) { return _fusions[tokenId]; }

    /// @notice Burned source cards retain their immutable provenance for portal qualification.
    function sourceCards(uint256 tokenId) public view returns (uint256[4] memory sources, uint8 count) {
        Fusion storage f = _fusions[tokenId];
        if (f.level != 0) return (f.sources, f.sourceCount);
        require(provenance[tokenId].originalTokenId != 0, "unknown card");
        sources[0] = tokenId;
        return (sources, 1);
    }

    function effectiveSequence(uint256 tokenId) external view returns (uint16) {
        Fusion storage f = _fusions[tokenId];
        if (f.level != 0) return f.sequenceSum / f.sourceCount;
        require(cardFacts[tokenId].initialized && cardFacts[tokenId].sequence < 264, "unsupported card facts");
        return uint16(cardFacts[tokenId].sequence);
    }

    function assertClaimAvailable(uint256 tokenId, address owner) external view {
        require(ownerOf(tokenId) == owner, "owner only");
        if (transferLocked[tokenId] || (evolutionController != address(0)
            && cardReservation[tokenId] == evolutionController)) revert OriginalReserved();
    }

    function assertNoPendingClaim(uint256 tokenId) external view {
        Provenance storage p = provenance[tokenId];
        if (!p.isOriginal) return;
        IOriginalClaimState engine = IOriginalClaimState(registry.getPack(p.packTypeId).rules.engine);
        require(engine.evolutionClaimLocks(), "engine upgrade required");
        (, uint256 pending,,,,,) = engine.originals(tokenId);
        require(pending == 0, "original has pending claim");
    }

    error SourceFactsUnavailable();
    error SingularityTraitsMismatch();
    error DifferentMintDates();

    /// @notice Supplemental rendering rules for terminal, two-source Singularity fusions.
    /// @dev Hash of singularityArtDirection in the shared serum module; no storage or legacy binding changes.
    bytes32 public constant SINGULARITY_POLICY = 0xceaa7f274e6f323623253543f79504efcc6ace69b501e52196f928adef6cf488;

    function fusionRecipe(uint256 a, uint256 b) public view returns (Fusion memory f) {
        require(a < b, "canonical distinct parents required");
        uint8 level = _fusions[a].level;
        require(level < 2 && level == _fusions[b].level, "incompatible fusion levels");
        f.level = level + 1;
        if (level == 0) {
            Provenance storage pa = provenance[a];
            Provenance storage pb = provenance[b];
            CardFacts storage x = cardFacts[a];
            CardFacts storage y = cardFacts[b];
            if (!x.initialized || !y.initialized || x.sequence >= 264 || y.sequence >= 264) revert SourceFactsUnavailable();
            if (x.sequence == y.sequence) {
                // Activated pack catalogs are immutable with unique trait tuples:
                // (packTypeId, variantId) is exactly (pack, species, color, horn, glitter).
                // Initialized facts already prove a nonzero mint time and a unique sequence per lineage.
                if (pa.packTypeId != pb.packTypeId || pa.variantId != pb.variantId)
                    revert SingularityTraitsMismatch();
                if (x.mintedAt / 1 days != y.mintedAt / 1 days) revert DifferentMintDates();
                // A distinct terminal kind: two sources, never eligible for the level-one path.
                f.level = 3;
            } else {
                require(pa.originalTokenId != 0 && pa.originalTokenId == pb.originalTokenId, "different lineages");
                require(x.sequence + 1 == y.sequence || y.sequence + 1 == x.sequence, "not adjacent");
            }
            f.sources[0] = a;
            f.sources[1] = b;
            f.sourceCount = 2;
        } else {
            require(provenance[_fusions[a].sources[0]].originalTokenId
                != provenance[_fusions[b].sources[0]].originalTokenId, "same lineage");
            f.sources = [_fusions[a].sources[0], _fusions[a].sources[1],
                _fusions[b].sources[0], _fusions[b].sources[1]];
            f.sourceCount = 4;
        }
        for (uint8 i; i < f.sourceCount; ++i) f.sequenceSum += uint16(cardFacts[f.sources[i]].sequence);
        f.parentA = a;
        f.parentB = b;
    }

    function completeFusion(uint256 a, uint256 b, address recipient) external returns (uint256 id) {
        require(msg.sender == evolutionController, "evolution only");
        require(cardReservation[a] == msg.sender && cardReservation[b] == msg.sender, "inputs not reserved");
        require(ownerOf(a) == recipient && ownerOf(b) == recipient, "owner changed");
        require(!hasCompletedGrade(a) && !hasCompletedGrade(b), "graded input");
        Fusion memory f = fusionRecipe(a, b);
        _releaseCard(a);
        _burnCard(a);
        _releaseCard(b);
        _burnCard(b);
        id = nextTokenId++;
        _fusions[id] = f;
        _mint(recipient, id);
        emit FusionMinted(id, a, b, recipient, f.level, f.sources, f.sequenceSum, f.sourceCount);
    }

    /// @notice Only the adventure that holds a transfer lock may sacrifice this companion.
    function sacrificeAdventureCompanion(uint256 tokenId) external {
        if (msg.sender != adventureController || cardReservation[tokenId] != msg.sender
            || !transferLocked[tokenId]) revert AdventureReservationRequired();
        _releaseCard(tokenId);
        _burnCard(tokenId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        // Reuse ERC721's previous owner instead of another SLOAD on every legacy VRF mint.
        // Any reservation failure reverts the entire update, including its Transfer log.
        from = super._update(to, tokenId, auth);
        if (from != address(0)) {
            require(!transferLocked[tokenId] && (to != address(0) || cardReservation[tokenId] == address(0)),
                "card reserved");
            require(evolutionController == address(0) || gradingRegistry == address(0)
                || IGradedCardMetadata(gradingRegistry).pendingRequest(tokenId) == 0, "grading pending");
        }
    }

    function _writeCardFacts(uint256 tokenId, uint32 sequence, uint64 mintedAt, bool imported,
        uint32 totalVariants) private {
        Provenance storage p = provenance[tokenId];
        require(p.originalTokenId != 0 && !cardFacts[tokenId].initialized, "unknown or recorded card");
        require(mintedAt != 0 && mintedAt <= block.timestamp, "invalid mint time");
        require(p.isOriginal == (sequence == 0), "invalid sequence origin");
        require(sequence < totalVariants, "sequence outside family");
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

    function _checkEngine(uint256 packTypeId) private view returns (uint32) {
        PackRegistry.Pack memory pack = registry.getPack(packTypeId);
        require(pack.active && pack.rules.engine == msg.sender, "unregistered engine");
        return pack.totalVariants;
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
        if (original) _writeCardFacts(id, 0, uint64(block.timestamp), false,
            registry.getPack(packTypeId).totalVariants);
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
