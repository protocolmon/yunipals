// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BoosterAdmin} from "./BoosterAdmin.sol";

interface IRegisteredBoosterEngine {
    function registry() external view returns (address);
}

contract PackRegistry is BoosterAdmin {
    struct Rules {
        address engine;
        address paymentToken;
        uint128 price;
        uint64 intervalSeconds;
        uint32 mintsPerInterval;
        uint32 maxBatch;
        uint32 baseGas;
        uint32 perMintGas;
        uint16 confirmations;
        uint64 supplyCap; // zero means unlimited
        bytes32 artworkHash;
        string manifestURI;
        string metadataBaseURI; // durable variant metadata; ends with /
    }

    struct Catalog {
        uint32[] types;
        uint32[] colors;
        uint32[] horns;
        uint32[] glitters;
        uint32[] allowed; // optional balanced subset of Cartesian variant ranks
    }

    struct Pack {
        Rules rules;
        bytes32 catalogHash;
        bytes32 ruleHash;
        uint32 totalVariants;
        uint64 openings;
        bool active;
        bool salesPaused;
    }

    struct Traits {
        uint32 monsterType;
        uint32 color;
        uint32 horn;
        uint32 glitter;
    }

    uint256 public typeCount;
    mapping(uint256 => Pack) private _packs;
    mapping(uint256 => Catalog) private _catalogs;
    uint256[48] private __gap;

    event TypeConfigured(uint256 indexed packTypeId, address indexed engine, bytes32 catalogHash);
    event TypeActivated(
        uint256 indexed packTypeId,
        address indexed engine,
        address paymentToken,
        uint128 price,
        uint64 intervalSeconds,
        uint32 mintsPerInterval,
        uint32 totalVariants,
        uint32 maxBatch,
        bytes32 catalogHash,
        bytes32 ruleHash,
        string manifestURI,
        string metadataBaseURI
    );
    event SalesPaused(uint256 indexed packTypeId, bool paused);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __BoosterAdmin_init(admin);
    }

    function getPack(uint256 id) external view returns (Pack memory) {
        return _packs[id];
    }

    function getCatalog(uint256 id) external view returns (Catalog memory) {
        return _catalogs[id];
    }

    /// @notice id=0 allocates a new draft; all edits are forbidden after activation.
    function configureType(uint256 id, Rules calldata rules, Catalog calldata catalog)
        external
        onlyRole(CONFIG_ROLE)
        returns (uint256)
    {
        if (id == 0) id = ++typeCount;
        require(id <= typeCount && !_packs[id].active, "invalid or frozen type");
        _packs[id].rules = rules;
        _catalogs[id] = catalog;
        _packs[id].catalogHash = keccak256(abi.encode(catalog));
        emit TypeConfigured(id, rules.engine, _packs[id].catalogHash);
        return id;
    }

    function activate(uint256 id) external onlyRole(CONFIG_ROLE) {
        Pack storage p = _packs[id];
        require(id != 0 && id <= typeCount && !p.active, "invalid or frozen type");
        Rules storage r = p.rules;
        require(r.engine.code.length != 0 && r.paymentToken.code.length != 0, "invalid contracts");
        require(IRegisteredBoosterEngine(r.engine).registry() == address(this), "registry mismatch");
        require(r.price > 0 && r.intervalSeconds > 0 && r.mintsPerInterval > 0, "invalid economics");
        require(
            r.maxBatch > 0 && r.maxBatch <= 32 && r.confirmations >= 3 && r.confirmations <= 200,
            "invalid batch"
        );
        require(r.baseGas >= 400_000 && r.perMintGas >= 200_000, "unsafe gas floor");
        require(uint256(r.baseGas) + uint256(r.perMintGas) * r.maxBatch <= 2_400_000, "gas ceiling");
        require(
            r.artworkHash != bytes32(0) && bytes(r.manifestURI).length > 0
                && bytes(r.metadataBaseURI).length > 0,
            "missing metadata"
        );
        require(
            bytes(r.manifestURI).length <= 512 && bytes(r.metadataBaseURI).length <= 512,
            "metadata URI too long"
        );
        require(
            bytes(r.metadataBaseURI)[bytes(r.metadataBaseURI).length - 1] == bytes1("/"),
            "metadata base slash"
        );
        Catalog storage c = _catalogs[id];
        _validateIds(c.types);
        _validateIds(c.colors);
        _validateIds(c.horns);
        _validateIds(c.glitters);
        uint256 product = c.types.length * c.colors.length * c.horns.length * c.glitters.length;
        require(product > 0 && product <= type(uint32).max, "invalid catalog size");
        if (c.allowed.length != 0) _validateSubset(c, product);
        p.totalVariants = uint32(c.allowed.length == 0 ? product : c.allowed.length);
        p.ruleHash = keccak256(abi.encode(r, p.catalogHash));
        p.active = true;
        emit TypeActivated(
            id,
            r.engine,
            r.paymentToken,
            r.price,
            r.intervalSeconds,
            r.mintsPerInterval,
            p.totalVariants,
            r.maxBatch,
            p.catalogHash,
            p.ruleHash,
            r.manifestURI,
            r.metadataBaseURI
        );
    }

    function pauseSales(uint256 id, bool paused) external onlyRole(PAUSER_ROLE) {
        require(_packs[id].active, "inactive type");
        _packs[id].salesPaused = paused;
        emit SalesPaused(id, paused);
    }

    function reserveOpening(uint256 id) external {
        Pack storage p = _packs[id];
        require(p.active && !p.salesPaused && msg.sender == p.rules.engine, "sales unavailable");
        require(p.rules.supplyCap == 0 || p.openings < p.rules.supplyCap, "sold out");
        ++p.openings;
    }

    function traitsFor(uint256 id, uint32 variantId) external view returns (Traits memory traits) {
        Pack storage p = _packs[id];
        require(p.active && variantId < p.totalVariants, "invalid variant");
        Catalog storage c = _catalogs[id];
        uint256 rank = c.allowed.length == 0 ? variantId : c.allowed[variantId];
        traits.glitter = c.glitters[rank % c.glitters.length];
        rank /= c.glitters.length;
        traits.horn = c.horns[rank % c.horns.length];
        rank /= c.horns.length;
        traits.color = c.colors[rank % c.colors.length];
        rank /= c.colors.length;
        traits.monsterType = c.types[rank];
    }

    function _validateIds(uint32[] storage ids) private view {
        require(ids.length > 0 && ids.length <= 256, "invalid trait list");
        for (uint256 i = 1; i < ids.length; ++i) {
            require(ids[i] > ids[i - 1], "traits must be sorted unique");
        }
    }

    function _validateSubset(Catalog storage c, uint256 product) private view {
        // Sorted ranks prove uniqueness; counts prove equal marginal rarity onchain.
        require(c.allowed.length <= 4096, "subset too large");
        uint256[][] memory counts = new uint256[][](4);
        counts[0] = new uint256[](c.types.length);
        counts[1] = new uint256[](c.colors.length);
        counts[2] = new uint256[](c.horns.length);
        counts[3] = new uint256[](c.glitters.length);
        for (uint256 i; i < c.allowed.length; ++i) {
            uint256 rank = c.allowed[i];
            require(rank < product && (i == 0 || rank > c.allowed[i - 1]), "invalid subset rank");
            ++counts[3][rank % c.glitters.length];
            rank /= c.glitters.length;
            ++counts[2][rank % c.horns.length];
            rank /= c.horns.length;
            ++counts[1][rank % c.colors.length];
            rank /= c.colors.length;
            ++counts[0][rank];
        }
        for (uint256 category; category < 4; ++category) {
            for (uint256 j = 1; j < counts[category].length; ++j) {
                require(counts[category][j] == counts[category][0], "unbalanced subset");
            }
        }
    }
}
