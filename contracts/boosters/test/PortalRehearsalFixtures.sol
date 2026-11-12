// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";

/// @notice Isolated rehearsal currency. Never a production payment token.
contract PortalRehearsalUSDC is ERC20 {
    address public immutable operator = msg.sender;

    constructor() ERC20("Yunipals Rehearsal USDC", "TESTUSDC") {
        require(block.chainid == 84532, "Base Sepolia only");
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        require(msg.sender == operator, "operator only");
        _mint(recipient, amount);
    }
}

/// @notice Creates known matching/mismatching cards without changing real portal odds.
/// The NFT, traits and sequence checks still use the release YunipalMonsters implementation.
contract PortalRehearsalCards {
    PackRegistry public immutable registry;
    address public immutable operator = msg.sender;

    constructor(PackRegistry registry_) {
        require(block.chainid == 84532, "Base Sepolia only");
        registry = registry_;
    }

    function create(YunipalMonsters cards, address recipient, uint32 variant, uint32 sequence) external {
        require(msg.sender == operator, "operator only");
        uint256 original = cards.reserveOriginal(1);
        cards.mintOriginal(original, recipient, variant);
        if (sequence != 0) cards.mintOffspringWithSequence(original, recipient, variant, sequence);
    }

    function onOriginalBurned(uint256) external {}
}
