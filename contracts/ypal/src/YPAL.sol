// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "solady/src/tokens/ERC20.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title YPAL - PMON Wrapper Token
/// @author Yunipals Team
/// @notice Standard ERC20 wrapper token for PMON with 1:1 mapping
/// @dev YPAL is intentionally mirrorless (non-DN404) and behaves like AIMON
contract YPAL is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice The PMON token being wrapped
    IERC20 public immutable pmon;

    /// @notice Address where burned PMON is sent
    address public burnAddress;

    /// @notice Whether the contract configuration is locked
    bool public isLocked;

    // ============ Events ============

    /// @notice Emitted when PMON is wrapped into YPAL
    event Wrap(address indexed user, uint256 amount);

    /// @notice Emitted when YPAL is unwrapped into PMON
    event Unwrap(address indexed user, uint256 amount);

    /// @notice Emitted when YPAL is burned
    event Burn(address indexed user, uint256 amount);

    /// @notice Emitted when the burn address is updated
    event BurnAddressUpdated(address indexed oldAddress, address indexed newAddress);

    /// @notice Emitted when the contract is locked
    event ContractLocked();

    /// @notice Emitted when tokens are rescued
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    /// @notice Emitted when ETH is rescued
    event ETHRescued(address indexed to, uint256 amount);

    /// @notice Emitted when excess PMON is rescued
    event ExcessPMONRescued(address indexed to, uint256 amount);

    // ============ Custom Errors ============

    error AmountMustBeGreaterThanZero();
    error BurnAddressNotSet();
    error ContractIsLocked();
    error InvalidBurnAddress();
    error CannotSetBurnAddressToSelf();
    error ContractAlreadyLocked();
    error CannotRescuePMONToken();
    error InvalidRecipientAddress();
    error InvalidPMONAddress();
    error NoExcessPMON();

    // ============ Constructor ============

    /// @notice Initializes the YPAL token
    /// @param pmon_ The address of the PMON token to wrap
    /// @param burnAddress_ The initial burn address
    constructor(address pmon_, address burnAddress_) {
        if (pmon_ == address(0)) revert InvalidPMONAddress();
        if (burnAddress_ == address(this)) revert CannotSetBurnAddressToSelf();

        _initializeOwner(msg.sender);
        pmon = IERC20(pmon_);
        burnAddress = burnAddress_;
    }

    // ============ ERC20 Metadata ============

    function name() public pure override returns (string memory) {
        return "Yunipals";
    }

    function symbol() public pure override returns (string memory) {
        return "YPAL";
    }

    // ============ Core Functions ============

    /// @notice Wrap PMON tokens to receive YPAL tokens at 1:1 ratio
    function wrap(uint256 amount) external nonReentrant returns (uint256) {
        if (amount == 0) revert AmountMustBeGreaterThanZero();

        pmon.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);

        emit Wrap(msg.sender, amount);

        return amount;
    }

    /// @notice Unwrap YPAL tokens to receive PMON tokens at 1:1 ratio
    function unwrap(uint256 amount) external nonReentrant returns (uint256) {
        if (amount == 0) revert AmountMustBeGreaterThanZero();

        _burn(msg.sender, amount);
        pmon.safeTransfer(msg.sender, amount);

        emit Unwrap(msg.sender, amount);

        return amount;
    }

    /// @notice Burn YPAL and send underlying PMON to burn address
    function burn(uint256 amount) external nonReentrant {
        if (amount == 0) revert AmountMustBeGreaterThanZero();
        if (burnAddress == address(0)) revert BurnAddressNotSet();

        _burn(msg.sender, amount);
        pmon.safeTransfer(burnAddress, amount);

        emit Burn(msg.sender, amount);
    }

    // ============ Admin Functions ============

    function setBurnAddress(address burnAddress_) external onlyOwner {
        if (isLocked) revert ContractIsLocked();
        if (burnAddress_ == address(0)) revert InvalidBurnAddress();
        if (burnAddress_ == address(this)) revert CannotSetBurnAddressToSelf();

        address oldAddress = burnAddress;
        burnAddress = burnAddress_;

        emit BurnAddressUpdated(oldAddress, burnAddress_);
    }

    function lockContract() external onlyOwner {
        if (isLocked) revert ContractAlreadyLocked();

        isLocked = true;

        emit ContractLocked();
    }

    function rescue(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(pmon)) revert CannotRescuePMONToken();
        if (to == address(0)) revert InvalidRecipientAddress();
        if (amount == 0) revert AmountMustBeGreaterThanZero();

        IERC20(token).safeTransfer(to, amount);

        emit TokensRescued(token, to, amount);
    }

    function rescueETH(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipientAddress();

        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = to.call{value: balance}("");
            require(success, "ETH transfer failed");

            emit ETHRescued(to, balance);
        }
    }

    /// @notice Rescue excess PMON accidentally sent directly to this contract
    /// @dev Rescues only PMON balance exceeding YPAL total supply
    function rescueExcessPMON(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipientAddress();

        uint256 pmonBalance = pmon.balanceOf(address(this));
        uint256 protoSupply = totalSupply();

        if (pmonBalance <= protoSupply) revert NoExcessPMON();

        uint256 excess = pmonBalance - protoSupply;
        pmon.safeTransfer(to, excess);

        emit ExcessPMONRescued(to, excess);
    }

    // ============ View Functions ============

    function totalPMONHeld() external view returns (uint256) {
        return pmon.balanceOf(address(this));
    }
}
