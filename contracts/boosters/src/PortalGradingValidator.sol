// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IPortalIntakeRoles {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @notice Stateless intake/result validation deployed with each grading implementation. No funds or upgrade authority.
contract PortalGradingValidator {
    struct Receipt {
        uint64 expiresAt;
        bytes signature;
    }

    // ABI-only mirror of PortalGrading.Result. Never used as proxy storage.
    struct Asset { string uri; bytes32 hash; }
    struct Result {
        bytes32 requestBinding; Asset artwork; uint8[4] scores; uint8 baseCreativity;
        bool copied; bytes32 evidenceHash; bytes32 reportHash; bytes32 modelsHash;
        string reportURI; string spellURI; uint64 completedAt;
    }

    function validateResult(bytes calldata encoded, uint8 copyCap) external pure {
        Result memory result = abi.decode(encoded, (Result));
        require(result.reportHash != bytes32(0), "missing report hash");
        validateURI(result.reportURI);
        validateURI(result.spellURI);
        validateAsset(result.artwork.uri, result.artwork.hash);
        for (uint256 i; i < 4; ++i) require(result.scores[i] >= 1 && result.scores[i] <= 100, "invalid score");
        require(result.baseCreativity >= 1 && result.baseCreativity <= 100, "invalid base creativity");
        uint8 creativity = result.baseCreativity;
        if (result.copied) {
            require(result.evidenceHash != bytes32(0), "missing copying evidence");
            if (creativity > copyCap) creativity = copyCap;
        }
        require(result.scores[0] == creativity, "originality cap mismatch");
    }

    function validateAsset(string memory uri, bytes32 hash) public pure {
        require(hash != bytes32(0), "missing asset hash");
        validateURI(uri);
    }

    function validateURI(string memory value) public pure {
        bytes memory uri = bytes(value);
        require(uri.length >= 8 && uri.length <= 1024, "invalid URI length");
        bool https = uri.length > 8 && bytes8(uri) == bytes8("https://");
        bool ipfs = bytes7(uri) == bytes7("ipfs://");
        require(https || ipfs, "URI scheme");
        for (uint256 i; i < uri.length; ++i) {
            require(uint8(uri[i]) > 32 && uint8(uri[i]) < 127 && uri[i] != '\"' && uri[i] != "\\", "URI character");
        }
    }

    error InvalidIntakeReceipt();
    bytes32 private constant INTAKE_ROLE = keccak256("INTAKE_ROLE");
    bytes32 private constant DOMAIN_TYPE =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant RECEIPT_TYPE = keccak256(
        "StoredSpell(address submitter,bytes32 admissionHash,address competition,bytes32 competitionQuote,uint64 expiresAt)"
    );

    function digest(
        address grading, address submitter, bytes32 admissionHash,
        address competition, bytes32 competitionQuote, uint64 expiresAt
    ) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPE, keccak256("YunipalsPortalIntake"), keccak256("1"), block.chainid, grading
        ));
        return keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(
            RECEIPT_TYPE, submitter, admissionHash, competition, competitionQuote, expiresAt
        ))));
    }

    function verify(
        address submitter, bytes32 admissionHash, address competition,
        bytes32 competitionQuote, Receipt calldata receipt
    ) external view {
        if (receipt.expiresAt < block.timestamp || receipt.expiresAt > block.timestamp + 300)
            revert InvalidIntakeReceipt();
        address signer = ECDSA.recover(
            digest(msg.sender, submitter, admissionHash, competition, competitionQuote, receipt.expiresAt),
            receipt.signature
        );
        if (!IPortalIntakeRoles(msg.sender).hasRole(INTAKE_ROLE, signer)) revert InvalidIntakeReceipt();
    }
}
