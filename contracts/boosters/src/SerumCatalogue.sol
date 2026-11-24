// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PortalGates} from "./PortalGates.sol";

/// @notice Immutable launch catalogue. A new balance requires a new catalogue contract/version.
contract SerumCatalogue {
    uint32 public constant VERSION = 1;
    bytes32 public constant RULES_HASH = keccak256("YunipalsSerumsV1:11x11:11tiers24:holy10000:ordered11");
    uint256 public constant DENOMINATOR = 1_000_000;

    struct Dose {
        uint32 catalogueVersion;
        uint8 serumId;
        uint8 presenceId;
    }

    function minimumRarity(uint8 traitId) public pure returns (uint8) {
        require(traitId > 0 && traitId <= 11, "invalid trait");
        if (traitId <= 3) return 0;
        if (traitId <= 6) return 1;
        if (traitId <= 8) return 2;
        return traitId - 6;
    }

    function rarity(uint8 serumId) public pure returns (uint8) {
        require(serumId > 0 && serumId <= 121, "invalid serum");
        uint8 essence = minimumRarity((serumId - 1) / 11 + 1);
        uint8 form = minimumRarity((serumId - 1) % 11 + 1);
        return essence > form ? essence : form;
    }

    function weights(uint16 sequence) public pure returns (uint32[7] memory) {
        require(sequence < 264, "unsupported sequence");
        uint32 tier = uint32(sequence / 24);
        return [
            uint32(350000),
            400000 - 15000 * tier,
            180000 + 6000 * tier,
            60000 + 6000 * tier,
            9000 + 2600 * tier,
            900 + 360 * tier,
            100 + 40 * tier
        ];
    }

    function draw(bytes32 entropy, uint16 sequence) external pure returns (Dose memory dose) {
        uint32[7] memory odds = weights(sequence);
        uint256 roll = PortalGates.uniform(keccak256(abi.encode(entropy, "rarity")), DENOMINATOR);
        uint8 bucket;
        while (roll >= odds[bucket]) roll -= odds[bucket++];
        if (bucket == 0) return dose;
        uint8[6] memory counts = [9, 27, 28, 17, 19, 21];
        uint256 selected = PortalGates.uniform(keccak256(abi.encode(entropy, "serum")), counts[bucket - 1]);
        for (uint8 id = 1; id <= 121; ++id) {
            if (rarity(id) == bucket - 1) {
                if (selected == 0) {
                    dose.serumId = id;
                    break;
                }
                --selected;
            }
        }
        roll = PortalGates.uniform(keccak256(abi.encode(entropy, "presence")), DENOMINATOR);
        dose.presenceId = roll < 10000 ? 1 : uint8(2 + (roll - 10000) / 99000);
        dose.catalogueVersion = VERSION;
    }
}
