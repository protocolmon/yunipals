// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PortalGates} from "./PortalGates.sol";
import {SerumCatalogue} from "./SerumCatalogue.sol";

/// @notice The existing catalogue conditioned on finding a serum. No reroll or no-find outcome.
library CrewSerumDraw {
    function draw(SerumCatalogue catalogue, bytes32 entropy, uint16 sequence)
        internal view returns (SerumCatalogue.Dose memory dose)
    {
        uint32[7] memory odds = catalogue.weights(sequence);
        uint256 total;
        for (uint8 i = 1; i < 7; ++i) total += odds[i];
        uint256 roll = PortalGates.uniform(keccak256(abi.encode(entropy, "rarity")), total);
        uint8 bucket = 1;
        while (roll >= odds[bucket]) roll -= odds[bucket++];
        uint8[6] memory counts = [9, 27, 28, 17, 19, 21];
        uint256 selected = PortalGates.uniform(keccak256(abi.encode(entropy, "serum")), counts[bucket - 1]);
        for (uint8 id = 1; id <= 121; ++id) {
            if (catalogue.rarity(id) == bucket - 1) {
                if (selected == 0) { dose.serumId = id; break; }
                --selected;
            }
        }
        roll = PortalGates.uniform(keccak256(abi.encode(entropy, "presence")), 1_000_000);
        dose.presenceId = roll < 10000 ? 1 : uint8(2 + (roll - 10000) / 99000);
        dose.catalogueVersion = catalogue.VERSION();
    }
}
