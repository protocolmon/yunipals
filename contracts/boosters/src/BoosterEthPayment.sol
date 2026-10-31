// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BoosterPacks} from "./BoosterPacks.sol";
import {PackRegistry} from "./PackRegistry.sol";

interface IPmonWrapper {
    function pmon() external view returns (address);
    function wrap(uint256 amount) external;
    function unwrap(uint256 amount) external;
}

interface IExactOutputV2 {
    function swapETHForExactTokens(uint256 amountOut, address[] calldata path, address recipient, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
}

interface IExactOutputV3 {
    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }
    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn);
    function refundETH() external payable;
}

/// @notice Fixed-route, exact-output ETH payment for existing YPAL packs.
/// @dev No arbitrary calls, recipient selection, administrator or token custody.
/// The engine must grant this contract PAYMENT_ADAPTER_ROLE before use.
contract BoosterEthPayment is ReentrancyGuard {
    using SafeERC20 for IERC20;

    BoosterPacks public immutable engine;
    address public immutable ypal;
    address public immutable pmon;
    address public immutable proto;
    address public immutable weth;
    address public immutable v2Router;
    address public immutable v3Router;
    uint256 public constant VERSION = 1;
    uint24 public constant PMON_POOL_FEE = 10_000;
    // 0 = WETH/PMON V3; 1 = WETH/PROTO V2, then unwrap PROTO.
    mapping(address => uint256) public refundCredits;
    uint256 public totalRefundLiability;

    event EthPackPurchased(
        address indexed buyer,
        uint256 indexed packTypeId,
        uint8 route,
        uint32 count,
        uint256 ypalAmount,
        uint256 ethSpent
    );
    event RefundCredited(address indexed buyer, uint256 amount);
    event RefundWithdrawn(address indexed buyer, address indexed recipient, uint256 amount);

    constructor(BoosterPacks engine_, address ypal_, address proto_, address weth_, address v2_, address v3_) {
        require(
            address(engine_).code.length != 0 && ypal_.code.length != 0 && proto_.code.length != 0
                && weth_.code.length != 0 && v2_.code.length != 0 && v3_.code.length != 0,
            "invalid contracts"
        );
        address underlying = IPmonWrapper(ypal_).pmon();
        require(underlying.code.length != 0 && IPmonWrapper(proto_).pmon() == underlying, "wrapper mismatch");
        engine = engine_;
        ypal = ypal_;
        pmon = underlying;
        proto = proto_;
        weth = weth_;
        v2Router = v2_;
        v3Router = v3_;
    }

    receive() external payable {
        require(msg.sender == v2Router || msg.sender == v3Router, "router refunds only");
    }

    function openPacks(
        uint256 packTypeId,
        uint32 count,
        uint8 route,
        uint256 maxSwapPrice,
        uint256 maxVrfPrice,
        uint256 deadline
    ) external payable nonReentrant returns (uint256[] memory requestIds, uint256[] memory originalIds) {
        require(route <= 1 && count > 0 && count <= 10 && block.timestamp <= deadline, "invalid purchase");
        require(maxSwapPrice > 0 && msg.value == maxSwapPrice + maxVrfPrice, "invalid ETH budget");
        PackRegistry.Pack memory pack = engine.registry().getPack(packTypeId);
        require(
            pack.active && !pack.salesPaused && pack.rules.engine == address(engine) && pack.rules.paymentToken == ypal
                && !engine.requestsPaused(),
            "pack unavailable"
        );
        uint256 amount = uint256(pack.rules.price) * count;
        require(amount > 0, "zero price");
        // Balance deltas exclude forced donations and other buyers' refund credits.
        uint256 ethBefore = address(this).balance - msg.value;
        uint256 pmonBefore = IERC20(pmon).balanceOf(address(this));
        uint256 ypalBefore = IERC20(ypal).balanceOf(address(this));
        uint256 spent;
        if (route == 0) {
            spent = IExactOutputV3(v3Router).exactOutputSingle{value: maxSwapPrice}(
                IExactOutputV3.ExactOutputSingleParams(
                    weth, pmon, PMON_POOL_FEE, address(this), amount, maxSwapPrice, 0
                )
            );
            IExactOutputV3(v3Router).refundETH();
        } else {
            uint256 protoBefore = IERC20(proto).balanceOf(address(this));
            address[] memory path = new address[](2);
            path[0] = weth;
            path[1] = proto;
            uint256[] memory amounts = IExactOutputV2(v2Router).swapETHForExactTokens{value: maxSwapPrice}(
                amount, path, address(this), deadline
            );
            spent = amounts[0];
            require(IERC20(proto).balanceOf(address(this)) == protoBefore + amount, "PROTO amount mismatch");
            IPmonWrapper(proto).unwrap(amount);
            require(IERC20(proto).balanceOf(address(this)) == protoBefore, "PROTO residue");
        }
        require(
            spent <= maxSwapPrice && IERC20(pmon).balanceOf(address(this)) == pmonBefore + amount,
            "swap amount mismatch"
        );
        IERC20(pmon).forceApprove(ypal, amount);
        IPmonWrapper(ypal).wrap(amount);
        IERC20(pmon).forceApprove(ypal, 0);
        require(
            IERC20(pmon).balanceOf(address(this)) == pmonBefore
                && IERC20(ypal).balanceOf(address(this)) == ypalBefore + amount,
            "wrap amount mismatch"
        );
        IERC20(ypal).forceApprove(address(engine), amount);
        (requestIds, originalIds) =
            engine.openPacksFor{value: maxVrfPrice}(msg.sender, packTypeId, count, maxVrfPrice, deadline);
        IERC20(ypal).forceApprove(address(engine), 0);
        require(IERC20(ypal).balanceOf(address(this)) == ypalBefore, "YPAL residue");
        require(address(this).balance >= ethBefore + maxSwapPrice - spent, "refund mismatch");
        // Include any router surplus, but never funds present before this call.
        uint256 refund = address(this).balance - ethBefore;
        if (refund > 0) {
            (bool ok,) = payable(msg.sender).call{value: refund, gas: 30_000}("");
            if (!ok) {
                refundCredits[msg.sender] += refund;
                totalRefundLiability += refund;
                emit RefundCredited(msg.sender, refund);
            }
        }
        emit EthPackPurchased(msg.sender, packTypeId, route, count, amount, spent);
    }

    function withdrawRefund(address payable recipient) external nonReentrant {
        require(recipient != address(0), "zero recipient");
        uint256 amount = refundCredits[msg.sender];
        require(amount != 0, "no refund");
        refundCredits[msg.sender] = 0;
        totalRefundLiability -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "refund failed");
        emit RefundWithdrawn(msg.sender, recipient, amount);
    }
}
