// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {BoosterAdmin} from "./BoosterAdmin.sol";

interface IPortalCompetitionGrading {
    function competitionResult(uint256 requestId)
        external
        view
        returns (bool eligible, bool completed, address submitter, bytes32 rubric, uint8[4] memory scores);
}

/// @notice Fixed admission-order competitions. All monetary values are six-decimal USDC units.
/// @dev Upgrade authority and the authorized AI grading source remain trust dependencies.
contract PortalGradingCompetition is BoosterAdmin, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    uint256 public constant BATCH_SIZE = 111;
    uint256 public constant CONTRIBUTION = 500_000;
    bytes32 public constant RULES_HASH =
        keccak256("YunipalsCompetitionV2:111:500000:sum4:earlier-entry:50,30,20:submitter:sequential-themes");
    bytes32 public constant THEME_ROLE = keccak256("THEME_ROLE");

    struct Theme {
        bytes32 hash;
        bytes32 sourcesHash;
        bytes32 artifactHash;
        bytes32 modelPolicy;
        string title;
        string brief;
        string uri;
    }

    struct Entry {
        uint256 requestId;
        address submitter;
        uint16 score;
        bool completed;
    }

    struct Batch {
        bytes32 rubric;
        uint16 funded;
        uint16 completed;
        bool settled;
        uint256[3] leaders;
        bool[3] paid;
    }

    address public grading;
    IERC20 public usdc;
    uint256 public entryCount;
    uint256 public totalLiability;
    mapping(uint256 => Entry) private _entries;
    mapping(uint256 => Batch) private _batches;
    mapping(uint256 => uint256) public entryForRequest;
    uint256[] private _readyBatches;
    uint256[] private _pendingBatches;
    mapping(uint256 => uint256) private _pendingIndex;
    mapping(uint256 => Theme) private _themes;
    uint256 public firstThemedBatch;
    uint256[38] private __gap;

    event ThemePublished(uint256 indexed batchId, bytes32 indexed themeHash, bytes32 sourcesHash);

    event CompetitionEntered(
        uint256 indexed batchId,
        uint256 indexed entryId,
        uint256 indexed requestId,
        address submitter,
        uint256 amount
    );
    event CompetitionResult(
        uint256 indexed batchId, uint256 indexed entryId, uint256 indexed requestId, uint16 score
    );
    event CompetitionReady(uint256 indexed batchId);
    event CompetitionSettled(uint256 indexed batchId, uint256 first, uint256 second, uint256 third);
    event CompetitionPrizePaid(
        uint256 indexed batchId, uint8 indexed rank, address indexed winner, uint256 amount
    );
    event CompetitionPrizeDeferred(uint256 indexed batchId, uint8 indexed rank);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address grading_, IERC20 usdc_) external initializer {
        require(grading_.code.length != 0 && address(usdc_).code.length != 0, "invalid contracts");
        require(IERC20Metadata(address(usdc_)).decimals() == 6, "USDC decimals must be six");
        __BoosterAdmin_init(admin);
        __ReentrancyGuard_init();
        grading = grading_;
        usdc = usdc_;
        _grantRole(THEME_ROLE, admin);
        _startThemes();
    }

    /// @notice Optional boundary-only activation for a pre-theme proxy upgrade.
    function enableThemes() external onlyRole(CONFIG_ROLE) {
        require(firstThemedBatch == 0 && entryCount % BATCH_SIZE == 0, "theme activation boundary");
        _grantRole(THEME_ROLE, msg.sender);
        _startThemes();
    }

    function _startThemes() private {
        firstThemedBatch = entryCount / BATCH_SIZE + 1;
        if (firstThemedBatch == 1) {
            _publishTheme(1, bytes32(0), bytes32(0), bytes32(0), "Open imagination",
                "Create your own original transformation. There is no required subject for this opening challenge.", "");
        }
    }

    function getTheme(uint256 batchId) external view returns (Theme memory) { return _themes[batchId]; }

    function admissionsOpen() public view returns (bool) {
        return firstThemedBatch == 0 || _themes[entryCount / BATCH_SIZE + 1].hash != bytes32(0);
    }

    /// @notice A quote pins both the next entry's batch and its immutable theme.
    function admissionHash() external view returns (bytes32) {
        if (firstThemedBatch == 0) return RULES_HASH;
        uint256 batchId = entryCount / BATCH_SIZE + 1;
        return keccak256(abi.encode(RULES_HASH, block.chainid, address(this), batchId, _themes[batchId].hash));
    }

    function themeSourcesHash(uint256 batchId) public view returns (bytes32) {
        require(batchId > 1 && ready(batchId - 1), "previous grades pending");
        uint256[3] memory winners = _batches[batchId - 1].leaders;
        uint256[3] memory requests;
        for (uint256 i; i < 3; ++i) requests[i] = _entries[winners[i]].requestId;
        return keccak256(abi.encode(block.chainid, address(this), batchId - 1, winners, requests));
    }

    /// @notice Publication never depends on prize settlement and cannot change a published theme.
    function publishTheme(uint256 batchId, bytes32 sourcesHash, bytes32 artifactHash,
        bytes32 modelPolicy, string calldata title, string calldata brief, string calldata uri)
        external onlyRole(THEME_ROLE)
    {
        require(firstThemedBatch != 0 && batchId >= firstThemedBatch, "themes disabled");
        require(entryCount % BATCH_SIZE == 0 && batchId == entryCount / BATCH_SIZE + 1, "wrong next batch");
        require(sourcesHash == themeSourcesHash(batchId), "winner sources changed");
        require(artifactHash != bytes32(0) && modelPolicy != bytes32(0), "missing theme evidence");
        _text(title, 96); _text(brief, 768); _text(uri, 512);
        require(bytes(uri).length >= 8 && (bytes8(bytes(uri)) == bytes8("https://") || bytes7(bytes(uri)) == bytes7("ipfs://")), "theme URI scheme");
        _publishTheme(batchId, sourcesHash, artifactHash, modelPolicy, title, brief, uri);
    }

    function _publishTheme(uint256 batchId, bytes32 sourcesHash, bytes32 artifactHash,
        bytes32 modelPolicy, string memory title, string memory brief, string memory uri) private
    {
        require(_themes[batchId].hash == bytes32(0), "theme already published");
        bytes32 hash = keccak256(abi.encode(block.chainid, address(this), batchId, sourcesHash, artifactHash, modelPolicy, title, brief, uri));
        _themes[batchId] = Theme(hash, sourcesHash, artifactHash, modelPolicy, title, brief, uri);
        emit ThemePublished(batchId, hash, sourcesHash);
    }

    function _text(string memory value, uint256 maximum) private pure {
        bytes memory data = bytes(value);
        require(data.length > 0 && data.length <= maximum, "invalid theme text");
        for (uint256 i; i < data.length; ++i) require(uint8(data[i]) >= 32 && uint8(data[i]) < 127, "theme text ASCII");
    }

    function batchCount() public view returns (uint256) {
        return (entryCount + BATCH_SIZE - 1) / BATCH_SIZE;
    }

    function batchOf(uint256 entryId) public pure returns (uint256) {
        require(entryId != 0, "unknown entry");
        return (entryId - 1) / BATCH_SIZE + 1;
    }

    function canChangePolicy() external view returns (bool) {
        return entryCount % BATCH_SIZE == 0;
    }

    function getEntry(uint256 entryId) external view returns (Entry memory) {
        return _entries[entryId];
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function readyCount() external view returns (uint256) {
        return _readyBatches.length;
    }

    function readyAt(uint256 index) external view returns (uint256) {
        return _readyBatches[index];
    }

    function pendingCount() external view returns (uint256) {
        return _pendingBatches.length;
    }

    function pendingAt(uint256 index) external view returns (uint256) {
        return _pendingBatches[index];
    }

    function ready(uint256 batchId) public view returns (bool) {
        Batch storage batch = _batches[batchId];
        return batch.funded == BATCH_SIZE && batch.completed == BATCH_SIZE;
    }

    /// @dev The grading contract checks the exact balance increase before registering this deposit.
    function registerEntry(uint256 requestId, address submitter, bytes32 rubric)
        external
        nonReentrant
        returns (bytes32)
    {
        require(msg.sender == grading, "grading only");
        require(admissionsOpen(), "next theme pending");
        require(
            requestId != 0 && entryForRequest[requestId] == 0 && submitter != address(0)
                && rubric != bytes32(0),
            "invalid entry"
        );
        require(usdc.balanceOf(address(this)) >= totalLiability + CONTRIBUTION, "unfunded entry");
        uint256 entryId = ++entryCount;
        uint256 batchId = batchOf(entryId);
        Batch storage batch = _batches[batchId];
        if (batch.funded == 0) batch.rubric = rubric;
        require(batch.rubric == rubric, "batch rubric changed");
        batch.funded++;
        _entries[entryId] = Entry(requestId, submitter, 0, false);
        entryForRequest[requestId] = entryId;
        totalLiability += CONTRIBUTION;
        emit CompetitionEntered(batchId, entryId, requestId, submitter, CONTRIBUTION);
        return keccak256(
            abi.encode(
                keccak256("YunipalsCompetitionAdmissionV2"),
                block.chainid,
                grading,
                requestId,
                address(this),
                RULES_HASH,
                entryId,
                CONTRIBUTION,
                _themes[batchId].hash
            )
        );
    }

    /// @notice Anyone can recover a missed result notification from the final onchain grade.
    function recordCompleted(uint256 requestId) external nonReentrant {
        uint256 entryId = entryForRequest[requestId];
        require(entryId != 0, "request not entered");
        Entry storage entry = _entries[entryId];
        if (entry.completed) return;
        (bool eligible, bool completed, address submitter, bytes32 rubric, uint8[4] memory scores) =
            IPortalCompetitionGrading(grading).competitionResult(requestId);
        uint256 batchId = batchOf(entryId);
        Batch storage batch = _batches[batchId];
        require(
            eligible && completed && submitter == entry.submitter && rubric == batch.rubric,
            "result not eligible"
        );
        uint16 sum;
        for (uint256 i; i < 4; ++i) {
            require(scores[i] >= 1 && scores[i] <= 100, "invalid score");
            sum += scores[i];
        }
        entry.completed = true;
        entry.score = sum;
        batch.completed++;
        for (uint256 rank; rank < 3; ++rank) {
            uint256 current = batch.leaders[rank];
            if (
                current == 0 || sum > _entries[current].score
                    || (sum == _entries[current].score && entryId < current)
            ) {
                for (uint256 next = 2; next > rank; --next) {
                    batch.leaders[next] = batch.leaders[next - 1];
                }
                batch.leaders[rank] = entryId;
                break;
            }
        }
        emit CompetitionResult(batchId, entryId, requestId, sum);
        if (ready(batchId)) {
            _readyBatches.push(batchId);
            _pendingIndex[batchId] = _pendingBatches.length;
            _pendingBatches.push(batchId);
            emit CompetitionReady(batchId);
        }
    }

    function prize(uint8 rank) public pure returns (uint256) {
        require(rank < 3, "invalid rank");
        return BATCH_SIZE * CONTRIBUTION * (rank == 0 ? 50 : rank == 1 ? 30 : 20) / 100;
    }

    /// @notice Settlement and payout are permissionless, including during admissions pauses.
    function settle(uint256 batchId) external nonReentrant {
        require(ready(batchId), "batch not ready");
        Batch storage batch = _batches[batchId];
        if (!batch.settled) {
            batch.settled = true;
            emit CompetitionSettled(batchId, batch.leaders[0], batch.leaders[1], batch.leaders[2]);
        }
        // Each failed token transfer rolls back only its own subcall, preserving all entitlements.
        for (uint8 rank; rank < 3; ++rank) {
            if (batch.paid[rank]) continue;
            try this.payPrize(batchId, rank) {}
                catch {
                emit CompetitionPrizeDeferred(batchId, rank);
            }
        }
    }

    function payPrize(uint256 batchId, uint8 rank) external {
        require(rank < 3, "invalid rank");
        Batch storage batch = _batches[batchId];
        require(batch.settled, "batch not settled");
        if (batch.paid[rank]) return;
        // The external self-call from settle already holds the reentrancy guard.
        if (msg.sender == address(this)) _pay(batchId, rank);
        else _payGuarded(batchId, rank);
    }

    function _payGuarded(uint256 batchId, uint8 rank) private nonReentrant {
        _pay(batchId, rank);
    }

    function _pay(uint256 batchId, uint8 rank) private {
        Batch storage batch = _batches[batchId];
        uint256 amount = prize(rank);
        address winner = _entries[batch.leaders[rank]].submitter;
        batch.paid[rank] = true;
        totalLiability -= amount;
        usdc.safeTransfer(winner, amount);
        if (batch.paid[0] && batch.paid[1] && batch.paid[2]) {
            uint256 index = _pendingIndex[batchId];
            uint256 moved = _pendingBatches[_pendingBatches.length - 1];
            _pendingBatches[index] = moved;
            _pendingIndex[moved] = index;
            _pendingBatches.pop();
            delete _pendingIndex[batchId];
        }
        emit CompetitionPrizePaid(batchId, rank, winner, amount);
    }
}
