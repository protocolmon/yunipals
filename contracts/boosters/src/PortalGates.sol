// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library PortalGates {
    struct Gates {
        uint16 sequenceStart;
        uint16 sequenceLength;
        uint8 colorGate;
        uint8 typeGate;
        bool originalOnly;
        bool glitterGate;
        bool diamondGate;
    }

    struct Odds {
        uint16 originalBps;
        uint16 glitterBps;
        uint16 diamondBps;
        uint16 length1Bps;
        uint16 length10Bps;
        uint16 length100Bps;
        uint16[6] colorWeights;
        uint16[11] typeWeights;
    }

    function rainbowOdds() internal pure returns (Odds memory odds) {
        odds.originalBps = 1000;
        odds.glitterBps = 1000;
        odds.diamondBps = 1000;
        odds.length1Bps = 500;
        odds.length10Bps = 2000;
        odds.length100Bps = 7500;
        for (uint256 i; i < 6; ++i) {
            odds.colorWeights[i] = 1;
        }
        for (uint256 i; i < 11; ++i) {
            odds.typeWeights[i] = 1;
        }
    }

    function validate(Odds memory odds) internal pure {
        require(
            odds.originalBps <= 10000 && odds.glitterBps <= 10000 && odds.diamondBps <= 10000, "invalid odds"
        );
        require(
            uint256(odds.length1Bps) + odds.length10Bps + odds.length100Bps == 10000, "invalid range odds"
        );
        uint256 colors;
        uint256 types;
        for (uint256 i; i < 6; ++i) {
            colors += odds.colorWeights[i];
        }
        for (uint256 i; i < 11; ++i) {
            types += odds.typeWeights[i];
        }
        require(colors != 0 && types != 0, "empty trait weights");
    }

    function uniform(bytes32 entropy, uint256 bound) internal pure returns (uint256) {
        require(bound != 0, "empty pool");
        uint256 threshold = (type(uint256).max - bound + 1) % bound;
        uint256 value = uint256(entropy);
        uint256 counter;
        while (value < threshold) value = uint256(keccak256(abi.encode(entropy, ++counter)));
        return value % bound;
    }

    function draw(bytes32 entropy, Odds memory odds) internal pure returns (Gates memory gates) {
        gates.originalOnly = uniform(keccak256(abi.encode(entropy, "original")), 10000) < odds.originalBps;
        gates.glitterGate = uniform(keccak256(abi.encode(entropy, "glitter")), 10000) < odds.glitterBps;
        gates.diamondGate = uniform(keccak256(abi.encode(entropy, "diamond")), 10000) < odds.diamondBps;
        gates.sequenceStart = uint16(uniform(keccak256(abi.encode(entropy, "start")), 264));
        uint256 lengthDraw = uniform(keccak256(abi.encode(entropy, "length")), 10000);
        gates.sequenceLength = lengthDraw < odds.length1Bps
            ? 1
            : lengthDraw < uint256(odds.length1Bps) + odds.length10Bps ? 10 : 100;
        uint256 total;
        for (uint256 i; i < 6; ++i) {
            total += odds.colorWeights[i];
        }
        uint256 selection = uniform(keccak256(abi.encode(entropy, "color")), total);
        for (uint8 i; i < 6; ++i) {
            if (selection < odds.colorWeights[i]) {
                gates.colorGate = i;
                break;
            }
            selection -= odds.colorWeights[i];
        }
        total = 0;
        for (uint256 i; i < 11; ++i) {
            total += odds.typeWeights[i];
        }
        selection = uniform(keccak256(abi.encode(entropy, "type")), total);
        for (uint8 i; i < 11; ++i) {
            if (selection < odds.typeWeights[i]) {
                gates.typeGate = i;
                break;
            }
            selection -= odds.typeWeights[i];
        }
    }

    function sequenceMatches(Gates memory gates, uint32 sequence) internal pure returns (bool) {
        return sequence < 264 && (uint256(sequence) + 264 - gates.sequenceStart) % 264 < gates.sequenceLength;
    }
}
