// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PortalCollection} from "./PortalCollection.sol";
import {PortalRandomness} from "./PortalRandomness.sol";
import {PortalGates} from "./PortalGates.sol";
import {PortalRules} from "./PortalRules.sol";

contract PortalRegistry is PortalRandomness {
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
    // A fixed array bounds every read, write and callback. Legacy slots above stay put.
    Round[12] private windows;
    uint8 private windowCount;
    bool private queueStarted;

    struct Batch {
        uint8 count;
        uint64 afterEnd;
    }
    mapping(uint256 => Batch) public rotationBatches;
    uint256[13] private __gap;

    uint8 public constant MAX_UPCOMING = 11;
    event RotationBatchRequested(uint256 indexed requestId, uint8 count, uint64 afterEnd);

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
        if (queueStarted) {
            current = round;
            for (uint256 i; i < windowCount; ++i) {
                if (windows[i].startsAt > block.timestamp) break;
                current = windows[i];
            }
        }
        accepting = current.id != 0 && block.timestamp >= current.startsAt && block.timestamp < current.endsAt
            && collection.exists(current.portalId);
    }

    /// @notice A revealed round accepts immediately, until its original closing time.
    /// Round identity matters: the same portal can appear in several windows.
    function admissionRound(uint64 roundId) external view returns (Round memory selected, bool accepting) {
        if (queueStarted) {
            for (uint256 i; i < windowCount; ++i) {
                if (windows[i].id == roundId) {
                    selected = windows[i];
                    break;
                }
            }
        } else if (round.id == roundId) {
            selected = round;
        } else if (scheduledRound.id == roundId) {
            selected = scheduledRound;
        }
        accepting = selected.id != 0 && block.timestamp < selected.endsAt
            && collection.exists(selected.portalId);
    }

    function CALLBACK_GAS() public pure override returns (uint32) {
        return 1_600_000;
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
        if (budget > 1_450_000) budget = 1_450_000;
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

    /// @notice Only scheduled rounds strictly after the current block time.
    function upcomingRounds() external view returns (Round[] memory upcoming) {
        if (!queueStarted) {
            bool next = scheduledRound.id != 0 && scheduledRound.startsAt > block.timestamp;
            upcoming = new Round[](next ? 1 : 0);
            if (next) upcoming[0] = scheduledRound;
            return upcoming;
        }
        uint256 count;
        for (uint256 i; i < windowCount; ++i) {
            if (windows[i].startsAt > block.timestamp) ++count;
        }
        upcoming = new Round[](count);
        uint256 at;
        for (uint256 i; i < windowCount; ++i) {
            if (windows[i].startsAt > block.timestamp) upcoming[at++] = windows[i];
        }
    }

    /// @notice Fixed number of new windows a request now would commit to.
    /// An empty schedule needs one current window plus eleven future windows.
    function refillCount() public view returns (uint8) {
        uint8 retained;
        if (!queueStarted) {
            if (round.id != 0 && round.endsAt > block.timestamp) ++retained;
            if (scheduledRound.id != 0 && scheduledRound.endsAt > block.timestamp) ++retained;
        } else {
            for (uint256 i; i < windowCount; ++i) {
                if (windows[i].endsAt > block.timestamp) ++retained;
            }
        }
        return 12 - retained;
    }

    function _compactWindows() private {
        if (!queueStarted) {
            queueStarted = true;
            if (round.id != 0 && round.endsAt > block.timestamp) windows[windowCount++] = round;
            if (scheduledRound.id != 0) {
                if (scheduledRound.endsAt > block.timestamp) windows[windowCount++] = scheduledRound;
                else round = scheduledRound;
                delete scheduledRound;
            }
        }
        uint8 kept;
        uint8 oldCount = windowCount;
        for (uint8 i; i < oldCount; ++i) {
            Round memory item = windows[i];
            if (item.startsAt <= block.timestamp) round = item;
            if (item.endsAt > block.timestamp) windows[kept++] = item;
        }
        for (uint8 i = kept; i < oldCount; ++i) {
            delete windows[i];
        }
        windowCount = kept;
    }

    function requestRotation(uint256 maximum) external payable nonReentrant returns (uint256 id) {
        require(pendingRotation == 0, "rotation pending");
        (uint48 revision, uint256 count) = collection.poolSnapshot(0);
        require(count != 0, "not enough portals");
        _compactWindows();
        uint8 size = 12 - windowCount;
        require(size != 0, "schedule full");
        Round memory tail = windowCount == 0 ? round : windows[windowCount - 1];
        uint256 excluded = count <= 1 ? 0 : collection.liveIndexPlusOne(tail.portalId);
        uint256 paid;
        (id, paid) = _requestRandomness(maximum);
        rotations[id] = Rotation(tail.id + 1, count, excluded);
        rotationPoolRevision[id] = revision;
        rotationBatches[id] = Batch(size, tail.endsAt);
        pendingRotation = id;
        emit RotationRequested(id, tail.id + 1, count, tail.portalId);
        emit RotationBatchRequested(id, size, tail.endsAt);
        _refundExcess(paid);
    }

    /// @notice Recovery for a deferred callback or a result delivered before upgrade.
    /// Reuses the same selection and fulfillment time; never extends a resolved slot.
    function activateNext() external nonReentrant returns (uint256 portalId) {
        return _resolveRotation();
    }

    function _resolveRotation() private returns (uint256 portalId) {
        uint256 id = pendingRotation;
        if (rotationBatches[id].count != 0) return _resolveBatch(id);
        // An in-flight pre-upgrade request must still resolve its single original draw.
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

    function _resolveBatch(uint256 id) private returns (uint256 firstPortal) {
        require(id != 0 && randomRequests[id].received, "rotation not ready");
        Batch memory batch = rotationBatches[id];
        Rotation memory next = rotations[id];
        _compactWindows();
        require(uint256(windowCount) + batch.count <= 12, "schedule overflow");
        uint64 start = rotationReceivedAt > batch.afterEnd ? rotationReceivedAt : batch.afterEnd;
        uint256 excluded = next.excludedIndexPlusOne;
        for (uint8 i; i < batch.count; ++i) {
            uint256 eligible = next.poolSize - (excluded == 0 ? 0 : 1);
            uint256 index = PortalGates.uniform(
                keccak256(abi.encode(randomRequests[id].seed, address(this), id, "rotation-batch", i)),
                eligible
            );
            if (excluded != 0 && index >= excluded - 1) ++index;
            uint256 portalId = collection.portalAtSnapshot(0, rotationPoolRevision[id], index);
            if (i == 0) firstPortal = portalId;
            Round memory item = Round(next.roundId + i, start, start + WINDOW_SECONDS, portalId);
            windows[windowCount++] = item;
            if (collection.exists(portalId)) {
                emit PortalActivated(item.id, portalId, item.startsAt, item.endsAt);
            } else {
                emit PortalRoundUnavailable(item.id, portalId, item.startsAt, item.endsAt);
            }
            excluded = next.poolSize <= 1 ? 0 : index + 1;
            start = item.endsAt;
        }
        rotationReceivedAt = 0;
        pendingRotation = 0;
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
