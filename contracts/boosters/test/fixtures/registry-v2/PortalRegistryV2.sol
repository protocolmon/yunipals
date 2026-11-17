// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PortalCollection} from "../../../src/PortalCollection.sol";
import {PortalRandomness} from "../../../src/PortalRandomness.sol";
import {PortalGates} from "../../../src/PortalGates.sol";
import {PortalRules} from "../../../src/PortalRules.sol";

contract PortalRegistryV2 is PortalRandomness {
    struct Round {
        uint64 id;
        uint64 startsAt;
        uint64 endsAt;
        uint256 portalId;
    }

    struct Rotation {
        uint64 roundId;
        uint256 poolSize;
        uint256 excludedIndexPlusOne;
    }

    struct Selection {
        uint256 kindId;
        uint256 poolSize;
    }

    uint64 public constant WINDOW_SECONDS = 660;
    PortalCollection public collection;
    Round public round;
    uint256 public pendingRotation;
    mapping(uint256 => Rotation) public rotations;
    mapping(uint256 => Selection) public selections;
    mapping(uint256 => uint48) public rotationPoolRevision;
    mapping(uint256 => uint48) public selectionPoolRevision;
    // A delivered rotation may start after the current slot. Readers switch at
    // startsAt without requiring a transaction at that time.
    Round public scheduledRound;
    uint64 public rotationReceivedAt;
    uint256[39] private __gap;

    event RotationRequested(
        uint256 indexed requestId, uint64 indexed roundId, uint256 poolSize, uint256 excludedPortal
    );
    event PortalActivated(uint64 indexed roundId, uint256 indexed portalId, uint64 startsAt, uint64 endsAt);
    event SelectionRequested(uint256 indexed requestId, uint256 indexed kindId, uint256 poolSize);
    event PortalRoundUnavailable(
        uint64 indexed roundId, uint256 indexed portalId, uint64 startsAt, uint64 endsAt
    );

    event RotationResolutionDeferred(uint256 indexed requestId);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        PortalCollection collection_,
        IVRFV2PlusWrapper wrapper_,
        uint16 confirmations_
    ) external initializer {
        require(address(collection_).code.length != 0, "invalid collection");
        __PortalRandomness_init(admin, wrapper_, confirmations_, collection_.rules());
        collection = collection_;
    }

    function activePortal() public view returns (Round memory current, bool accepting) {
        current =
            scheduledRound.id != 0 && block.timestamp >= scheduledRound.startsAt ? scheduledRound : round;
        accepting = current.id != 0 && block.timestamp >= current.startsAt && block.timestamp < current.endsAt
            && collection.exists(current.portalId);
    }

    function CALLBACK_GAS() public pure override returns (uint32) {
        return 400_000;
    }

    function _afterRandomness(uint256 id) internal override {
        if (id != pendingRotation) return;
        rotationReceivedAt = uint64(block.timestamp);
        // Preserve the seed and fulfillment time even if historical pool reads
        // fail or exhaust their budget. Also works for pre-upgrade 160k requests.
        uint256 remaining = gasleft();
        if (remaining < 40_000) {
            emit RotationResolutionDeferred(id);
            return;
        }
        uint256 budget = remaining - 30_000;
        if (budget > 250_000) budget = 250_000;
        try this.resolveRotation{gas: budget}(id) {}
        catch {
            emit RotationResolutionDeferred(id);
        }
    }

    /// @dev Only the callback can enter while the outer reentrancy guard is held.
    function resolveRotation(uint256 id) external {
        require(msg.sender == address(this), "self only");
        require(id == pendingRotation, "stale rotation");
        _resolveRotation();
    }

    function requestRotation(uint256 maximum) external payable nonReentrant returns (uint256 id) {
        require(pendingRotation == 0, "rotation pending");
        if (scheduledRound.id != 0) {
            require(block.timestamp >= scheduledRound.startsAt, "next window scheduled");
            round = scheduledRound;
            delete scheduledRound;
        }
        (uint48 revision, uint256 count) = collection.poolSnapshot(0);
        uint256 excluded = count <= 1 ? 0 : collection.liveIndexPlusOne(round.portalId);
        require(count != 0, "not enough portals");
        uint256 paid;
        (id, paid) = _requestRandomness(maximum);
        rotations[id] = Rotation(round.id + 1, count, excluded);
        rotationPoolRevision[id] = revision;
        pendingRotation = id;
        emit RotationRequested(id, round.id + 1, count, round.portalId);
        _refundExcess(paid);
    }

    /// @notice Recovery for a deferred callback or a result delivered before upgrade.
    /// Reuses the same selection and fulfillment time; never extends a resolved slot.
    function activateNext() external nonReentrant returns (uint256 portalId) {
        return _resolveRotation();
    }

    function _resolveRotation() private returns (uint256 portalId) {
        uint256 id = pendingRotation;
        Rotation memory next = rotations[id];
        require(id != 0 && randomRequests[id].received && next.roundId == round.id + 1, "rotation not ready");
        uint256 eligible = next.poolSize - (next.excludedIndexPlusOne == 0 ? 0 : 1);
        uint256 index = PortalGates.uniform(
            keccak256(abi.encode(randomRequests[id].seed, address(this), id, "rotation")), eligible
        );
        if (next.excludedIndexPlusOne != 0 && index >= next.excludedIndexPlusOne - 1) ++index;
        portalId = collection.portalAtSnapshot(0, rotationPoolRevision[id], index);
        uint64 deliveredAt = rotationReceivedAt;
        // Already-delivered legacy requests have no recorded fulfillment time.
        if (deliveredAt == 0) deliveredAt = uint64(block.timestamp);
        uint64 start = deliveredAt > round.endsAt ? deliveredAt : round.endsAt;
        Round memory resolved = Round(next.roundId, start, start + WINDOW_SECONDS, portalId);
        if (start > block.timestamp) scheduledRound = resolved;
        else round = resolved;
        rotationReceivedAt = 0;
        pendingRotation = 0;
        if (collection.exists(portalId)) {
            emit PortalActivated(next.roundId, portalId, start, start + WINDOW_SECONDS);
        } else {
            emit PortalRoundUnavailable(next.roundId, portalId, start, start + WINDOW_SECONDS);
        }
    }

    /// @notice A utility selection never activates a portal or grants admission.
    function requestSelection(uint256 kindId, uint256 maximum)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        (uint48 revision, uint256 count) = collection.poolSnapshot(kindId);
        require(count != 0, "empty pool");
        uint256 paid;
        (id, paid) = _requestRandomness(maximum);
        selections[id] = Selection(kindId, count);
        selectionPoolRevision[id] = revision;
        emit SelectionRequested(id, kindId, count);
        _refundExcess(paid);
    }

    /// @notice Historical selected ID; use selectionStatus to check current availability.
    function selectionResult(uint256 id) public view returns (bool ready, uint256 portalId) {
        Selection memory selection = selections[id];
        ready = selection.poolSize != 0 && randomRequests[id].received;
        if (ready) {
            uint256 index = PortalGates.uniform(
                keccak256(abi.encode(randomRequests[id].seed, address(this), id, "selection")),
                selection.poolSize
            );
            portalId = collection.portalAtSnapshot(selection.kindId, selectionPoolRevision[id], index);
        }
    }

    function selectionStatus(uint256 id)
        external
        view
        returns (bool ready, uint256 portalId, uint48 revision, bool available)
    {
        (ready, portalId) = selectionResult(id);
        return (ready, portalId, selectionPoolRevision[id], ready && collection.exists(portalId));
    }
}
