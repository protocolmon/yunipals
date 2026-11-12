// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {BoosterAdmin} from "./BoosterAdmin.sol";
import {BoosterProofRecovery, IProofWrapper, IProofCoordinator} from "./BoosterProofRecovery.sol";
import {PortalRules} from "./PortalRules.sol";

/// @notice Direct-funded VRF with the pack engine's authenticated same-proof recovery.
/// Callbacks only retain entropy; permissionless follow-on calls do the actual work.
abstract contract PortalRandomness is BoosterAdmin, ReentrancyGuardUpgradeable, BoosterProofRecovery {
    struct RandomRequest {
        uint256 seed;
        bool requested;
        bool received;
    }

    IVRFV2PlusWrapper public wrapper;
    uint16 public confirmations;
    bool public randomnessPaused;
    mapping(uint256 => RandomRequest) public randomRequests;
    mapping(address => uint256) public refundCredits;
    uint256 public totalRefundLiability;
    PortalRules public rules;
    uint32 public constant CALLBACK_GAS = 160_000;

    event RandomnessRequested(uint256 indexed requestId, address indexed payer, uint256 paid);
    event RandomnessReceived(uint256 indexed requestId, uint256 seed);
    event RefundCredited(address indexed payer, uint256 amount);
    event RandomnessPaused(bool paused);

    function __PortalRandomness_init(
        address admin,
        IVRFV2PlusWrapper wrapper_,
        uint16 confirmations_,
        PortalRules rules_
    ) internal onlyInitializing {
        require(address(wrapper_).code.length != 0, "invalid wrapper");
        require(confirmations_ >= 3 && confirmations_ <= 200, "invalid confirmations");
        __BoosterAdmin_init(admin);
        __ReentrancyGuard_init();
        wrapper = wrapper_;
        confirmations = confirmations_;
        require(address(rules_).code.length != 0, "invalid portal rules");
        rules = rules_;
    }

    function quoteRandomness(uint256 gasPrice) public view returns (uint256) {
        return wrapper.estimateRequestPriceNative(CALLBACK_GAS, 1, gasPrice);
    }

    function pauseRandomness(bool paused) external onlyRole(PAUSER_ROLE) {
        randomnessPaused = paused;
        emit RandomnessPaused(paused);
    }

    function _requestRandomness(uint256 maximum) internal returns (uint256 id, uint256 paid) {
        require(!randomnessPaused, "randomness paused");
        paid = wrapper.calculateRequestPriceNative(CALLBACK_GAS, 1);
        require(paid <= maximum && paid <= msg.value, "VRF price exceeds budget");
        address coordinator = IProofWrapper(address(wrapper)).s_vrfCoordinator();
        address store = IProofCoordinator(coordinator).BLOCKHASH_STORE();
        require(coordinator.code.length != 0 && store.code.length != 0, "invalid proof dependencies");
        id = wrapper.requestRandomWordsInNative{value: paid}(
            CALLBACK_GAS,
            confirmations,
            1,
            VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
        );
        require(id != 0 && !randomRequests[id].requested, "invalid request id");
        randomRequests[id].requested = true;
        _recordProofContext(id, coordinator, store, confirmations);
        emit RandomnessRequested(id, msg.sender, paid);
    }

    function rawFulfillRandomWords(uint256 id, uint256[] calldata words) external nonReentrant {
        require(msg.sender == address(wrapper), "wrapper only");
        if (!randomRequests[id].requested || randomRequests[id].received || words.length == 0) return;
        _saveRandomness(id, words[0]);
    }

    function restoreRandomness(uint256 id, Proof calldata proof) external nonReentrant {
        require(randomRequests[id].requested && !randomRequests[id].received, "not awaiting randomness");
        _saveRandomness(id, _verifyRequestProof(id, proof));
    }

    function _verifyRequestProof(uint256 id, Proof calldata proof) internal view override returns (uint256) {
        ProofContext memory context = proofContext(id);
        require(context.requestBlock != 0 && context.chainId == block.chainid, "missing proof context");
        require(block.number >= uint256(context.requestBlock) + context.confirmations, "wait confirmations");
        uint256 actualSeed = uint256(keccak256(abi.encodePacked(proof.seed, _requestBlockhash(context))));
        return rules.verifyProof(id, proof, actualSeed);
    }

    function _saveRandomness(uint256 id, uint256 seed) private {
        randomRequests[id].seed = seed;
        randomRequests[id].received = true;
        emit RandomnessReceived(id, seed);
    }

    function _refundExcess(uint256 paid) internal {
        uint256 amount = msg.value - paid;
        if (amount == 0) return;
        (bool success,) = payable(msg.sender).call{value: amount, gas: 30_000}("");
        if (!success) {
            refundCredits[msg.sender] += amount;
            totalRefundLiability += amount;
            emit RefundCredited(msg.sender, amount);
        }
    }

    function withdrawRefund(address payable recipient) external nonReentrant {
        require(recipient != address(0), "zero recipient");
        uint256 amount = refundCredits[msg.sender];
        require(amount != 0, "no refund");
        refundCredits[msg.sender] = 0;
        totalRefundLiability -= amount;
        (bool success,) = recipient.call{value: amount}("");
        require(success, "refund failed");
    }
}
