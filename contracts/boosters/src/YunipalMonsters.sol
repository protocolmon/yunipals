// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {
    AccessControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {BoosterAdmin} from "./BoosterAdmin.sol";
import {PackRegistry} from "./PackRegistry.sol";

interface IOriginalBurn {
    function onOriginalBurned(uint256 tokenId) external;
}

contract YunipalMonsters is ERC721Upgradeable, BoosterAdmin {
    struct Provenance {
        uint256 packTypeId;
        uint256 originalTokenId;
        uint32 variantId;
        PackRegistry.Traits traits;
        bool isOriginal;
    }

    PackRegistry public registry;
    uint256 public nextTokenId;
    mapping(uint256 => uint256) public reservedType;
    mapping(uint256 => Provenance) public provenance;
    uint256[46] private __gap;

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
        Provenance storage p = provenance[tokenId];
        PackRegistry.Pack memory pack = registry.getPack(p.packTypeId);
        return string.concat(pack.rules.metadataBaseURI, Strings.toString(p.variantId), ".json");
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
        override(ERC721Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
