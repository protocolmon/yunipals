// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IEligibility {
    function isEligible(uint256 chainId, address collection, uint256 tokenId) external view returns (bool);
}
