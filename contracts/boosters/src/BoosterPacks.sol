// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {BoosterAdmin} from "./BoosterAdmin.sol";
import {PackRegistry} from "./PackRegistry.sol";
import {YunipalMonsters} from "./YunipalMonsters.sol";
import {VariantDraw} from "./VariantDraw.sol";
import {BoosterProofRecovery, IProofWrapper, IProofCoordinator} from "./BoosterProofRecovery.sol";

interface IBurnable {
    function burn(uint256 amount) external;
}

contract BoosterPacks is BoosterAdmin, ReentrancyGuardUpgradeable, BoosterProofRecovery {
    using SafeERC20 for IERC20;
    using VariantDraw for mapping(uint32 => uint32);

    error PaymentAccountingMismatch();
    error InvalidProofDependencies();
    error InvalidRequestId();

    enum Status {
        Unknown,
        Pending,
        Seeded,
        Completed,
        Forfeited
    }

    struct Original {
        uint256 packTypeId;
        uint256 pendingRequest;
        uint64 revealedAt;
        uint32 remaining;
        uint32 minted;
        uint32 dailyCommitted;
        bool burned;
    }

    struct Request {
        uint256 originalId;
        address payer;
        uint256 paid;
        uint256 seed;
        bytes32 ruleHash;
        uint64 receivedAt;
        uint32 quantity;
        uint32 executionGas;
        Status status;
        bool opening;
        bool received;
    }

    // Fixed for this engine version. A new wrapper uses a new registered engine.
    IVRFV2PlusWrapper public wrapper;
    PackRegistry public registry;
    YunipalMonsters public monsters;
    bool public requestsPaused;
    mapping(uint256 => Original) public originals;
    mapping(uint256 => Request) public requests;
    mapping(uint256 => mapping(uint32 => uint32)) private _pools;
    mapping(address => uint256) public refundCredits;
    uint256 public totalRefundLiability;
    uint256[41] private __gap;

    bytes32 public constant PAYMENT_ADAPTER_ROLE = keccak256("PAYMENT_ADAPTER_ROLE");
    uint32 public constant CALLBACK_RESERVE = 150_000;
    uint32 public constant MAX_OPEN_PACKS = 10;
    uint256 public constant PERMIT_OPEN_VERSION = 1;
    event RequestsPaused(bool paused);
    event RequestCreated(
        uint256 indexed requestId,
        uint256 indexed originalId,
        uint256 indexed packTypeId,
        address payer,
        uint32 quantity,
        bool opening,
        uint256 paid,
        bytes32 ruleHash,
        uint32 callbackGas
    );
    event PaymentBurned(uint256 indexed requestId, address indexed payer, address token, uint256 amount);
    event RandomnessReceived(uint256 indexed requestId, uint256 seed, uint64 receivedAt);
    event OriginalRevealed(
        uint256 indexed originalId, uint256 indexed packTypeId, uint64 revealedAt, uint32 totalVariants
    );
    event RequestCompleted(
        uint256 indexed requestId,
        uint256 indexed originalId,
        address recipient,
        uint32 quantity,
        uint32 minted,
        uint32 remaining
    );
    event RecoveryRequired(uint256 indexed requestId);
    event RandomnessRestored(uint256 indexed requestId, address indexed submitter);
    event RequestForfeited(uint256 indexed requestId, uint256 indexed originalId);
    event RefundReturned(address indexed requester, uint256 amount);
    event RefundCredited(address indexed requester, uint256 amount);
    event RefundWithdrawn(address indexed requester, address indexed recipient, uint256 amount);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, PackRegistry registry_, YunipalMonsters monsters_, IVRFV2PlusWrapper wrapper_)
        external
        initializer
    {
        require(
            address(registry_).code.length != 0 && address(monsters_).code.length != 0
                && address(wrapper_).code.length != 0,
            "invalid contracts"
        );
        require(address(monsters_.registry()) == address(registry_), "registry mismatch");
        __BoosterAdmin_init(admin);
        __ReentrancyGuard_init();
        registry = registry_;
        monsters = monsters_;
        wrapper = wrapper_;
    }

    function pauseRequests(bool paused) external onlyRole(PAUSER_ROLE) {
        requestsPaused = paused;
        emit RequestsPaused(paused);
    }

    function getOriginal(uint256 id) external view returns (Original memory) {
        return originals[id];
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return requests[id];
    }

    function quote(uint256 packTypeId, uint32 quantity, uint256 gasPrice)
        public
        view
        returns (uint256 price, uint32 callbackGas)
    {
        PackRegistry.Pack memory pack = registry.getPack(packTypeId);
        require(pack.active && pack.rules.engine == address(this), "invalid type");
        callbackGas = _callbackGas(pack.rules, quantity);
        price = wrapper.estimateRequestPriceNative(callbackGas, 1, gasPrice);
    }

    /// @notice Total VRF estimate; callbackGas applies to each independent original.
    function quoteOpenPacks(uint256 packTypeId, uint32 count, uint256 gasPrice)
        external
        view
        returns (uint256 price, uint32 callbackGas)
    {
        if (count == 0 || count > MAX_OPEN_PACKS) revert("invalid batch size");
        (price, callbackGas) = quote(packTypeId, 1, gasPrice);
        price *= count;
    }

    function claimable(uint256 originalId) public view returns (uint32) {
        Original storage s = originals[originalId];
        if (s.minted == 0 || s.burned) return 0;
        PackRegistry.Pack memory pack = registry.getPack(s.packTypeId);
        uint256 earned = ((block.timestamp - s.revealedAt) / pack.rules.intervalSeconds) * pack.rules.mintsPerInterval;
        uint256 maxEarned = pack.totalVariants - 1;
        if (earned > maxEarned) earned = maxEarned;
        return uint32(earned - s.dailyCommitted);
    }

    function openPack(uint256 packTypeId, uint256 maxVrfPrice, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 requestId, uint256 originalId)
    {
        PackRegistry.Pack memory pack = _openingPack(packTypeId, deadline);
        _burnPayment(pack.rules.paymentToken, pack.rules.price);
        uint256 paid;
        (requestId, originalId, paid) = _open(packTypeId, pack, _paymentBudget(maxVrfPrice), msg.sender);
        _refund(msg.sender, msg.value - paid);
    }

    /// @notice Buy independent originals atomically with one payment and ETH refund.
    function openPacks(uint256 packTypeId, uint32 count, uint256 maxTotalVrfPrice, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256[] memory requestIds, uint256[] memory originalIds)
    {
        return _openPacks(packTypeId, count, maxTotalVrfPrice, _openingPacks(packTypeId, count, deadline), msg.sender);
    }

    /// @notice Best-effort EIP-2612 permit and one atomic purchase of independent originals.
    /// @dev Permit signs exactly price * count for this caller and engine. A consumed
    /// or unavailable permit is harmless if existing allowance still pays the burn.
    /// RequestCreated events identify every new request and original.
    function openPacksWithPermit(
        uint256 packTypeId,
        uint32 count,
        uint256 maxTotalVrfPrice,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable nonReentrant {
        PackRegistry.Pack memory pack = _openingPacks(packTypeId, count, deadline);
        uint256 amount;
        // A uint128 price times at most ten cannot overflow uint256.
        unchecked {
            amount = uint256(pack.rules.price) * count;
        }
        address tokenAddress = pack.rules.paymentToken;
        bytes memory permitData =
            abi.encodeCall(IERC20Permit.permit, (msg.sender, address(this), amount, deadline, v, r, s));
        // No ETH or return-data copy. Payment below remains authoritative after
        // failure, including a permit already submitted by a front-runner.
        assembly ("memory-safe") {
            pop(call(gas(), tokenAddress, 0, add(permitData, 32), mload(permitData), 0, 0))
        }
        _openPacks(packTypeId, count, maxTotalVrfPrice, pack, msg.sender);
    }

    /// @notice A granted payment adapter funds a purchase for its authenticated buyer.
    /// @dev Tokens are pulled from the adapter; requests, NFTs and VRF refunds belong
    /// to the buyer. Existing request storage and event semantics stay unchanged.
    function openPacksFor(address buyer, uint256 packTypeId, uint32 count, uint256 maxTotalVrfPrice, uint256 deadline)
        external
        payable
        nonReentrant
        onlyRole(PAYMENT_ADAPTER_ROLE)
        returns (uint256[] memory requestIds, uint256[] memory originalIds)
    {
        require(buyer != address(0), "zero buyer");
        return _openPacks(packTypeId, count, maxTotalVrfPrice, _openingPacks(packTypeId, count, deadline), buyer);
    }

    function _openPacks(
        uint256 packTypeId,
        uint32 count,
        uint256 maxTotalVrfPrice,
        PackRegistry.Pack memory pack,
        address buyer
    ) private returns (uint256[] memory requestIds, uint256[] memory originalIds) {
        uint256 amount;
        // A uint128 price times at most ten cannot overflow uint256.
        unchecked {
            amount = uint256(pack.rules.price) * count;
        }
        _burnPayment(pack.rules.paymentToken, amount);
        requestIds = new uint256[](count);
        originalIds = new uint256[](count);
        uint256 paid;
        uint256 budget = _paymentBudget(maxTotalVrfPrice);
        for (uint256 i; i < count; ++i) {
            uint256 price;
            (requestIds[i], originalIds[i], price) = _open(packTypeId, pack, budget - paid, buyer);
            paid += price;
        }
        _refund(buyer, msg.value - paid);
    }

    function _openingPacks(uint256 packTypeId, uint32 count, uint256 deadline)
        private
        view
        returns (PackRegistry.Pack memory)
    {
        if (count == 0 || count > MAX_OPEN_PACKS) revert("invalid batch size");
        return _openingPack(packTypeId, deadline);
    }

    function _openingPack(uint256 packTypeId, uint256 deadline) private view returns (PackRegistry.Pack memory pack) {
        require(!requestsPaused && block.timestamp <= deadline, "requests paused or expired");
        pack = registry.getPack(packTypeId);
        require(pack.rules.engine == address(this), "invalid engine");
    }

    function _burnPayment(address paymentToken, uint256 amount) private {
        IERC20 token = IERC20(paymentToken);
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 beforeSupply = token.totalSupply();
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != beforeBalance + amount) revert PaymentAccountingMismatch();
        IBurnable(address(token)).burn(amount);
        if (token.balanceOf(address(this)) != beforeBalance || token.totalSupply() != beforeSupply - amount) {
            revert PaymentAccountingMismatch();
        }
    }

    function _open(uint256 packTypeId, PackRegistry.Pack memory pack, uint256 budget, address buyer)
        private
        returns (uint256 requestId, uint256 originalId, uint256 paid)
    {
        registry.reserveOpening(packTypeId);
        originalId = monsters.reserveOriginal(packTypeId);
        originals[originalId].packTypeId = packTypeId;
        originals[originalId].remaining = pack.totalVariants;
        (requestId, paid) = _request(originalId, 1, true, pack, budget, buyer);
        emit PaymentBurned(requestId, buyer, pack.rules.paymentToken, pack.rules.price);
    }

    function claim(uint256 originalId, uint32 quantity, uint256 maxVrfPrice, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 requestId)
    {
        require(!requestsPaused && block.timestamp <= deadline, "requests paused or expired");
        Original storage s = originals[originalId];
        require(s.minted > 0 && !s.burned && monsters.ownerOf(originalId) == msg.sender, "owner only");
        require(s.pendingRequest == 0 && quantity > 0 && quantity <= claimable(originalId), "unavailable credits");
        PackRegistry.Pack memory pack = registry.getPack(s.packTypeId);
        s.dailyCommitted += quantity;
        uint256 paid;
        (requestId, paid) = _request(originalId, quantity, false, pack, _paymentBudget(maxVrfPrice), msg.sender);
        _refund(msg.sender, msg.value - paid);
    }

    function _request(
        uint256 originalId,
        uint32 quantity,
        bool opening,
        PackRegistry.Pack memory pack,
        uint256 paymentBudget,
        address buyer
    ) private returns (uint256 id, uint256 price) {
        uint32 callbackGas = _callbackGas(pack.rules, quantity);
        price = wrapper.calculateRequestPriceNative(callbackGas, 1);
        require(price <= paymentBudget, "VRF price exceeds budget");
        address coordinator = IProofWrapper(address(wrapper)).s_vrfCoordinator();
        address blockhashStore = IProofCoordinator(coordinator).BLOCKHASH_STORE();
        if (coordinator.code.length == 0 || blockhashStore.code.length == 0) revert InvalidProofDependencies();
        id = wrapper.requestRandomWordsInNative{value: price}(
            callbackGas,
            pack.rules.confirmations,
            1,
            VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
        );
        if (id == 0 || requests[id].status != Status.Unknown) revert InvalidRequestId();
        _recordProofContext(id, coordinator, blockhashStore, pack.rules.confirmations);
        requests[id] = Request(
            originalId,
            buyer,
            price,
            0,
            pack.ruleHash,
            0,
            quantity,
            callbackGas - CALLBACK_RESERVE,
            Status.Pending,
            opening,
            false
        );
        originals[originalId].pendingRequest = id;
        emit RequestCreated(
            id,
            originalId,
            originals[originalId].packTypeId,
            buyer,
            quantity,
            opening,
            price,
            pack.ruleHash,
            callbackGas
        );
    }

    /// @notice Wrapper authentication is stored in proxy storage, not a constructor immutable.
    function rawFulfillRandomWords(uint256 id, uint256[] calldata words) external nonReentrant {
        require(msg.sender == address(wrapper), "wrapper only");
        Request storage r = requests[id];
        if (r.status == Status.Unknown || r.received) return;
        // One word is requested. Ignore an empty response without fabricating entropy;
        // accepting the first word also avoids reverting on an unexpected extra word.
        if (words.length == 0) return;
        _receiveRandomness(id, words[0]);
        if (r.status == Status.Seeded) _attempt(id, r.executionGas);
    }

    /// @notice Restore the exact original VRF word after a lost callback, without another request.
    /// @dev This only saves the verified word. Finish minting with recover(id), so
    /// a failing mint cannot roll back this proof and lose the recovered randomness.
    function restoreRandomness(uint256 id, Proof calldata proof) external nonReentrant {
        Request storage r = requests[id];
        require(r.status == Status.Pending && !r.received, "not awaiting randomness");
        require(!originals[r.originalId].burned && originals[r.originalId].pendingRequest == id, "rights ended");
        uint256 word = _verifyRequestProof(id, proof);
        _receiveRandomness(id, word);
        emit RandomnessRestored(id, msg.sender);
        emit RecoveryRequired(id);
    }

    function _receiveRandomness(uint256 id, uint256 word) private {
        Request storage r = requests[id];
        r.received = true;
        r.seed = word;
        r.receivedAt = uint64(block.timestamp);
        emit RandomnessReceived(id, word, r.receivedAt);
        if (originals[r.originalId].burned) {
            _forfeit(id);
            return;
        }
        r.status = Status.Seeded;
        if (r.opening) originals[r.originalId].revealedAt = r.receivedAt;
    }

    function recover(uint256 id) external nonReentrant {
        Request storage r = requests[id];
        require(r.status == Status.Seeded && r.received, "not recoverable");
        require(gasleft() > uint256(r.executionGas) + CALLBACK_RESERVE, "insufficient recovery gas");
        // Recovery reuses the committed seed, but may need more gas than the frozen
        // request-time estimate (for example after gas repricing).
        _attempt(id, gasleft() - CALLBACK_RESERVE);
        // Ordinary recovery transactions must actually finish. This lets wallets
        // estimate the required gas instead of accepting a cheaper failed attempt.
        require(r.status == Status.Completed || r.status == Status.Forfeited, "recovery failed");
    }

    function _attempt(uint256 id, uint256 gasBudget) private {
        Request storage r = requests[id];
        if (originals[r.originalId].burned) {
            _forfeit(id);
            return;
        }
        // Preserve enough gas for the outer callback to persist the result on any inner failure.
        if (gasleft() < gasBudget + 40_000) {
            emit RecoveryRequired(id);
            return;
        }
        try this.execute{gas: gasBudget}(id) {}
        catch {
            emit RecoveryRequired(id);
        }
    }

    /// @dev Atomic draw + mint: rollback all tentative changes together if any mint fails.
    function execute(uint256 id) external {
        require(msg.sender == address(this), "self only");
        Request storage r = requests[id];
        Original storage s = originals[r.originalId];
        require(r.status == Status.Seeded && !s.burned, "invalid execution");
        address recipient = r.opening ? r.payer : monsters.ownerOf(r.originalId);
        for (uint256 i; i < r.quantity; ++i) {
            bytes32 entropy =
                keccak256(abi.encode(r.seed, block.chainid, address(this), id, r.originalId, r.ruleHash, i));
            uint32 variantId = _pools[r.originalId].draw(s.remaining, entropy);
            --s.remaining;
            if (r.opening) monsters.mintOriginal(r.originalId, recipient, variantId);
            else monsters.mintOffspring(r.originalId, recipient, variantId);
        }
        s.minted += r.quantity;
        s.pendingRequest = 0;
        r.status = Status.Completed;
        if (r.opening) emit OriginalRevealed(r.originalId, s.packTypeId, s.revealedAt, s.remaining + 1);
        emit RequestCompleted(id, r.originalId, recipient, r.quantity, s.minted, s.remaining);
    }

    function onOriginalBurned(uint256 originalId) external nonReentrant {
        require(msg.sender == address(monsters), "collection only");
        Original storage s = originals[originalId];
        s.burned = true;
        if (s.pendingRequest != 0) _forfeit(s.pendingRequest);
    }

    function _forfeit(uint256 id) private {
        Request storage r = requests[id];
        if (r.status != Status.Forfeited) emit RequestForfeited(id, r.originalId);
        r.status = Status.Forfeited;
        originals[r.originalId].pendingRequest = 0;
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

    function _refund(address requester, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(requester).call{value: amount, gas: 30_000}("");
        if (ok) {
            emit RefundReturned(requester, amount);
        } else {
            refundCredits[requester] += amount;
            totalRefundLiability += amount;
            emit RefundCredited(requester, amount);
        }
    }

    function _callbackGas(PackRegistry.Rules memory rules, uint32 quantity) private pure returns (uint32) {
        require(quantity > 0 && quantity <= rules.maxBatch, "invalid batch size");
        return rules.baseGas + rules.perMintGas * quantity;
    }

    function _paymentBudget(uint256 maximum) private view returns (uint256) {
        return msg.value < maximum ? msg.value : maximum;
    }
}
