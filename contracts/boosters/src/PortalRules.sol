// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {PortalGates} from "./PortalGates.sol";
import {PackRegistry} from "./PackRegistry.sol";
import {VRF} from "@chainlink/contracts/src/v0.8/vrf/VRF.sol";

/// @notice Stateless gate arithmetic and metadata rendering kept outside the NFT's code-size budget.
contract PortalRules is VRF {
    /// @notice Shared one-time catalog validation keeps grading proxies within the runtime size limit.
    function validateGradingCatalog(PackRegistry catalogRegistry, uint256 packId)
        external
        view
        returns (bytes32)
    {
        PackRegistry.Pack memory pack = catalogRegistry.getPack(packId);
        require(pack.active && pack.totalVariants == 264, "unsupported TCG catalog");
        PackRegistry.Catalog memory catalog = catalogRegistry.getCatalog(packId);
        require(
            catalog.types.length == 11 && catalog.colors.length == 6 && catalog.horns.length == 2
                && catalog.glitters.length == 2 && catalog.allowed.length == 0,
            "unsupported trait dictionary"
        );
        for (uint256 i; i < 11; ++i) {
            require(catalog.types[i] == i + 1, "type dictionary");
        }
        for (uint256 i; i < 6; ++i) {
            require(catalog.colors[i] == i + 1, "color dictionary");
        }
        require(
            catalog.horns[0] == 1 && catalog.horns[1] == 2 && catalog.glitters[0] == 0
                && catalog.glitters[1] == 1,
            "finish dictionary"
        );
        return pack.catalogHash;
    }

    function verifyProof(uint256 id, Proof calldata proof, uint256 actualSeed)
        external
        view
        returns (uint256)
    {
        require(
            uint256(keccak256(abi.encode(keccak256(abi.encode(proof.pk)), proof.seed))) == id,
            "proof request mismatch"
        );
        return uint256(keccak256(abi.encode(_randomValueFromVRFProof(proof, actualSeed), uint256(0))));
    }

    function validateKind(
        string calldata name,
        string calldata image,
        bytes32 artworkHash,
        uint16 cap,
        PortalGates.Odds calldata odds
    ) external pure {
        require(cap > 0 && cap <= 1000 && artworkHash != bytes32(0), "invalid kind");
        _validateText(bytes(name), 64);
        _validateText(bytes(image), 512);
        bytes memory uri = bytes(image);
        require(_startsWith(uri, "https://") || _startsWith(uri, "ipfs://"), "image URI scheme");
        PortalGates.validate(odds);
    }

    function _validateText(bytes memory value, uint256 maximum) private pure {
        require(value.length > 0 && value.length <= maximum, "invalid text length");
        for (uint256 i; i < value.length; ++i) {
            require(
                uint8(value[i]) >= 32 && uint8(value[i]) < 127 && value[i] != "\"" && value[i] != "\\",
                "invalid text character"
            );
        }
    }

    function _startsWith(bytes memory value, bytes memory prefix) private pure returns (bool) {
        if (value.length <= prefix.length) return false;
        for (uint256 i; i < prefix.length; ++i) {
            if (value[i] != prefix[i]) return false;
        }
        return true;
    }

    function rainbowOdds() external pure returns (PortalGates.Odds memory) {
        return PortalGates.rainbowOdds();
    }

    function validate(PortalGates.Odds calldata odds) external pure {
        PortalGates.validate(odds);
    }

    function draw(bytes32 entropy, PortalGates.Odds calldata odds)
        external
        pure
        returns (PortalGates.Gates memory)
    {
        return PortalGates.draw(entropy, odds);
    }

    function metadata(
        string calldata name,
        string calldata image,
        uint256 tokenId,
        uint256 kindId,
        PortalGates.Gates calldata g
    ) external pure returns (string memory) {
        bytes memory attributes = abi.encodePacked(
            '{"trait_type":"Card type","value":"Portal"},',
            _numberTrait("Portal kind", kindId),
            ",",
            _numberTrait("Sequence start", g.sequenceStart),
            ",",
            _numberTrait("Sequence length", g.sequenceLength),
            ",",
            _numberTrait("Color gate", g.colorGate),
            ",",
            _numberTrait("Type gate", g.typeGate),
            ",",
            _numberTrait("Original only", g.originalOnly ? 1 : 0),
            ",",
            _numberTrait("Glitter required", g.glitterGate ? 1 : 0),
            ",",
            _numberTrait("Diamond required", g.diamondGate ? 1 : 0)
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                abi.encodePacked(
                    '{"name":"',
                    name,
                    " #",
                    Strings.toString(tokenId),
                    '","description":"A collectible Yunipals TCG portal card. The active portal accepts matching cards during its 11-minute window. Portal fees accumulate with this NFT; its owner must burn it to claim the USDC.","image":"',
                    image,
                    '","attributes":[',
                    attributes,
                    "]}"
                )
            )
        );
    }

    function _numberTrait(string memory name, uint256 value) private pure returns (bytes memory) {
        return abi.encodePacked('{"trait_type":"', name, '","value":', Strings.toString(value), "}");
    }
}
