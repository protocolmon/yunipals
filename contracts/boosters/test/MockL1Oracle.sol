// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Only for the local browser fixture, where no OP L1 fee oracle exists.
contract MockL1Oracle {
    function getL1Fee(bytes calldata) external pure returns (uint256) {
        return 0;
    }
}

/// @dev Local equivalent of Base's read-batching predeploy, used only by the fixture.
contract MockMulticall3 {
    function getEthBalance(address account) external view returns (uint256) {
        return account.balance;
    }

    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory results) {
        results = new Result[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory data) = calls[i].target.call(calls[i].callData);
            require(ok || calls[i].allowFailure, "call failed");
            results[i] = Result(ok, data);
        }
    }
}
