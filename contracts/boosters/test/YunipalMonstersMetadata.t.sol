// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";

contract MetadataEngine {
    PackRegistry public immutable registry;
    mapping(uint256 => bool) public burned;

    constructor(PackRegistry registry_) {
        registry = registry_;
    }

    function reserve(YunipalMonsters monsters, uint256 packId) external returns (uint256) {
        return monsters.reserveOriginal(packId);
    }

    function original(YunipalMonsters monsters, uint256 id, address to, uint32 variantId) external {
        monsters.mintOriginal(id, to, variantId);
    }

    function offspring(YunipalMonsters monsters, uint256 parent, address to, uint32 variantId)
        external
        returns (uint256)
    {
        return monsters.mintOffspring(parent, to, variantId);
    }

    function onOriginalBurned(uint256 tokenId) external {
        burned[tokenId] = true;
    }
}

contract MetadataPaymentToken {}

contract YunipalMonstersMetadataTest is Test {
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant LEGACY_CREATION_HASH =
        0xb5cd2840832687faf05dabe39f08208e527d9324802a626f9858f683fb7c47b3;
    string private constant TOKEN_BASE =
        "https://api.yunipals.com/yunipals-indexer/v1/boosters/metadata/0x105319be2182018c31fb10b1be198c3cf238a146/";
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant CAROL = address(0xca401);
    address private constant OPERATOR = address(0x1234);
    address private constant CONFIGURATOR = address(0xc0f16);
    PackRegistry private registry;
    YunipalMonsters private monsters;
    MetadataEngine private engine;
    uint256 private packId;
    address private legacyImplementation;

    event TokenMetadataBaseURISet(string previousURI, string newURI);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    function setUp() public {
        registry = PackRegistry(
            address(
                new ERC1967Proxy(
                    address(new PackRegistry()), abi.encodeCall(PackRegistry.initialize, (address(this)))
                )
            )
        );
        // Deploy the exact creation payload from the committed mainnet package,
        // not a hand-written approximation of the old storage or ERC721 state.
        bytes memory creation = vm.parseJsonBytes(
            vm.readFile("test/fixtures/YunipalMonsters.deployed-baseline.json"), ".creationBytecode"
        );
        assertEq(keccak256(creation), LEGACY_CREATION_HASH);
        address deployed;
        assembly { deployed := create(0, add(creation, 32), mload(creation)) }
        require(deployed != address(0), "legacy deployment failed");
        legacyImplementation = deployed;
        monsters = YunipalMonsters(
            address(
                new ERC1967Proxy(
                    deployed, abi.encodeCall(YunipalMonsters.initialize, (address(this), registry))
                )
            )
        );
        engine = new MetadataEngine(registry);
        PackRegistry.Rules memory rules = PackRegistry.Rules(
            address(engine),
            address(new MetadataPaymentToken()),
            1 ether,
            1 days,
            1,
            7,
            450_000,
            250_000,
            3,
            0,
            keccak256("artwork"),
            "ipfs://catalog",
            "ipfs://variants/"
        );
        PackRegistry.Catalog memory catalog;
        catalog.types = new uint32[](2);
        catalog.types[0] = 3;
        catalog.types[1] = 7;
        catalog.colors = new uint32[](2);
        catalog.colors[1] = 9;
        catalog.horns = new uint32[](2);
        catalog.horns[1] = 6;
        catalog.glitters = new uint32[](2);
        catalog.glitters[1] = 1;
        packId = registry.configureType(0, rules, catalog);
        registry.activate(packId);
        engine.original(monsters, engine.reserve(monsters, packId), ALICE, 0);
        engine.original(monsters, engine.reserve(monsters, packId), ALICE, 1);
        // Same variant across two independent originals is permitted.
        assertEq(engine.offspring(monsters, 2, ALICE, 0), 3);
        assertEq(engine.reserve(monsters, packId), 4);
        vm.startPrank(ALICE);
        monsters.approve(BOB, 1);
        monsters.setApprovalForAll(OPERATOR, true);
        monsters.transferFrom(ALICE, CAROL, 3);
        vm.stopPrank();
        monsters.grantRole(monsters.CONFIG_ROLE(), CONFIGURATOR);
    }

    function upgrade() private returns (address implementation) {
        implementation = address(new YunipalMonsters());
        monsters.upgradeToAndCall(implementation, "");
    }

    function provenanceHash(uint256 tokenId) private view returns (bytes32) {
        (bool ok, bytes memory raw) =
            address(monsters).staticcall(abi.encodeWithSignature("provenance(uint256)", tokenId));
        require(ok, "provenance read failed");
        return keccak256(raw);
    }

    function testUpgradePreservesDeployedProxyStateAndFrozenRules() public {
        bytes32[4] memory prefix;
        for (uint256 i; i < 4; ++i) {
            prefix[i] = vm.load(address(monsters), bytes32(i));
        }
        bytes32[3] memory provenanceBefore = [provenanceHash(1), provenanceHash(2), provenanceHash(3)];
        bytes32 rulesBefore = keccak256(abi.encode(registry.getPack(packId)));
        assertEq(monsters.tokenURI(1), "ipfs://variants/0.json");
        address implementation = upgrade();
        assertEq(address(uint160(uint256(vm.load(address(monsters), IMPLEMENTATION_SLOT)))), implementation);
        assertEq(monsters.tokenMetadataBaseURI(), "");
        for (uint256 i; i < 4; ++i) {
            assertEq(vm.load(address(monsters), bytes32(i)), prefix[i]);
        }
        for (uint256 i; i < 3; ++i) {
            assertEq(provenanceHash(i + 1), provenanceBefore[i]);
        }
        assertEq(address(monsters.registry()), address(registry));
        assertEq(monsters.nextTokenId(), 5);
        assertEq(monsters.reservedType(4), packId);
        assertEq(monsters.ownerOf(1), ALICE);
        assertEq(monsters.ownerOf(2), ALICE);
        assertEq(monsters.ownerOf(3), CAROL);
        assertEq(monsters.balanceOf(ALICE), 2);
        assertEq(monsters.balanceOf(CAROL), 1);
        assertEq(monsters.getApproved(1), BOB);
        assertTrue(monsters.isApprovedForAll(ALICE, OPERATOR));
        assertTrue(monsters.hasRole(monsters.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(monsters.hasRole(monsters.UPGRADER_ROLE(), address(this)));
        assertTrue(monsters.hasRole(monsters.CONFIG_ROLE(), CONFIGURATOR));
        assertTrue(monsters.hasRole(monsters.PAUSER_ROLE(), address(this)));
        monsters.setTokenMetadataBaseURI(TOKEN_BASE);
        assertEq(keccak256(abi.encode(registry.getPack(packId))), rulesBefore);
        engine.original(monsters, 4, ALICE, 3);
        assertEq(monsters.tokenURI(4), string.concat(TOKEN_BASE, "4.json"));
        assertEq(engine.offspring(monsters, 2, ALICE, 2), 5);
        assertEq(monsters.tokenURI(5), string.concat(TOKEN_BASE, "5.json"));
        assertEq(monsters.nextTokenId(), 6);
    }

    function testMatchingVariantOriginalAndOffspringGetDifferentTokenURIs() public {
        upgrade();
        (,, uint32 firstVariant,,) = monsters.provenance(1);
        (,, uint32 offspringVariant,,) = monsters.provenance(3);
        assertEq(firstVariant, offspringVariant);
        assertEq(monsters.tokenURI(1), monsters.tokenURI(3));
        monsters.setTokenMetadataBaseURI(TOKEN_BASE);
        assertEq(monsters.tokenURI(1), string.concat(TOKEN_BASE, "1.json"));
        assertEq(monsters.tokenURI(3), string.concat(TOKEN_BASE, "3.json"));
        assertTrue(keccak256(bytes(monsters.tokenURI(1))) != keccak256(bytes(monsters.tokenURI(3))));
        monsters.setTokenMetadataBaseURI("");
        assertEq(monsters.tokenURI(1), "ipfs://variants/0.json");
        assertEq(monsters.tokenURI(3), "ipfs://variants/0.json");
    }

    function testConfigRoleAndUpgradeRoleRemainSeparate() public {
        upgrade();
        bytes32 role = monsters.CONFIG_ROLE();
        vm.expectRevert(
            abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", BOB, role)
        );
        vm.prank(BOB);
        monsters.setTokenMetadataBaseURI(TOKEN_BASE);
        vm.prank(CONFIGURATOR);
        monsters.setTokenMetadataBaseURI(TOKEN_BASE);
        assertEq(monsters.tokenURI(1), string.concat(TOKEN_BASE, "1.json"));
        address next = address(new YunipalMonsters());
        role = monsters.UPGRADER_ROLE();
        vm.expectRevert(
            abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", CONFIGURATOR, role)
        );
        vm.prank(CONFIGURATOR);
        monsters.upgradeToAndCall(next, "");
    }

    function testAtomicUpgradeAndConfigurationAndFailedConfigRollBack() public {
        monsters.grantRole(monsters.UPGRADER_ROLE(), BOB);
        address next = address(new YunipalMonsters());
        bytes memory configuration = abi.encodeCall(YunipalMonsters.setTokenMetadataBaseURI, (TOKEN_BASE));
        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", BOB, monsters.CONFIG_ROLE()
            )
        );
        vm.prank(BOB);
        monsters.upgradeToAndCall(next, configuration);
        assertEq(
            address(uint160(uint256(vm.load(address(monsters), IMPLEMENTATION_SLOT)))), legacyImplementation
        );
        monsters.upgradeToAndCall(next, configuration);
        assertEq(monsters.tokenURI(1), string.concat(TOKEN_BASE, "1.json"));
    }

    function testMetadataRefreshInterfaceAndAllocatedRange() public {
        upgrade();
        assertTrue(monsters.supportsInterface(0x49064906));
        assertTrue(monsters.supportsInterface(0x80ac58cd));
        assertTrue(monsters.supportsInterface(0x5b5e139f));
        assertTrue(monsters.supportsInterface(0x7965db0b));
        assertFalse(monsters.supportsInterface(0xffffffff));
        vm.expectEmit(false, false, false, true, address(monsters));
        emit TokenMetadataBaseURISet("", TOKEN_BASE);
        vm.expectEmit(false, false, false, true, address(monsters));
        emit BatchMetadataUpdate(0, 4);
        monsters.setTokenMetadataBaseURI(TOKEN_BASE);
    }

    function testMetadataURIGuardsAndIpfsReset() public {
        upgrade();
        string[9] memory invalid = [
            "http://cards.example/",
            "javascript:alert/",
            "https:///",
            "ipfs:///",
            "https://cards.example",
            "https://cards.example/?x/",
            "https://cards.example/#x/",
            "https://user@cards.example/",
            "https://cards.example/a b/"
        ];
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert();
            monsters.setTokenMetadataBaseURI(invalid[i]);
        }
        bytes memory longURI = new bytes(513);
        for (uint256 i; i < longURI.length; ++i) {
            longURI[i] = bytes1("a");
        }
        vm.expectRevert("metadata URI too long");
        monsters.setTokenMetadataBaseURI(string(longURI));
        monsters.setTokenMetadataBaseURI("ipfs://bafyTokenMetadata/monsters/");
        assertEq(monsters.tokenURI(1), "ipfs://bafyTokenMetadata/monsters/1.json");
        monsters.setTokenMetadataBaseURI("");
        assertEq(monsters.tokenURI(1), "ipfs://variants/0.json");
    }

    function testMissingAndBurnedTokensStillHaveNoTokenURI() public {
        upgrade();
        monsters.setTokenMetadataBaseURI(TOKEN_BASE);
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", 4));
        monsters.tokenURI(4);
        vm.prank(ALICE);
        monsters.burn(1);
        assertTrue(engine.burned(1));
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", 1));
        monsters.tokenURI(1);
        assertEq(monsters.ownerOf(3), CAROL);
    }

    function testImplementationInitializerIsStillLocked() public {
        address implementation = upgrade();
        vm.expectRevert(abi.encodeWithSignature("InvalidInitialization()"));
        YunipalMonsters(implementation).initialize(ALICE, registry);
    }
}
