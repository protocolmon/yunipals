// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {PortalGradingCompetition} from "./PortalGradingCompetition.sol";

interface IPortalCREReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice CRE execution adapter. Reports select only a batch; the pool controls all prizes.
contract PortalCompetitionReceiver is IPortalCREReceiver {
    PortalGradingCompetition public immutable competition;
    address public immutable forwarder;
    address public immutable workflowOwner;
    bytes10 public immutable workflowName;

    constructor(PortalGradingCompetition competition_, address forwarder_, address owner_, bytes10 name_) {
        require(address(competition_).code.length != 0 && forwarder_.code.length != 0, "invalid contracts");
        require(owner_ != address(0) && name_ != bytes10(0), "missing workflow identity");
        competition = competition_;
        forwarder = forwarder_;
        workflowOwner = owner_;
        workflowName = name_;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external {
        require(msg.sender == forwarder && metadata.length >= 62, "invalid CRE sender or metadata");
        bytes10 name;
        address owner;
        assembly {
            name := calldataload(add(metadata.offset, 32))
            owner := shr(96, calldataload(add(metadata.offset, 42)))
        }
        require(owner == workflowOwner && name == workflowName, "wrong CRE workflow");
        (uint256 chainId, address pool, bytes32 rules, uint256 batchId) =
            abi.decode(report, (uint256, address, bytes32, uint256));
        require(
            chainId == block.chainid && pool == address(competition) && rules == competition.RULES_HASH(),
            "wrong report domain"
        );
        // Idempotent settlement also retries only unpaid prizes when a report is replayed.
        competition.settle(batchId);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IPortalCREReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
