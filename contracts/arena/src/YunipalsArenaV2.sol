// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    VRFV2PlusWrapperConsumerBase
} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFV2PlusWrapperConsumerBase.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IEligibility} from "./IEligibility.sol";
import {IslandPool} from "./IslandPool.sol";

/// @notice Four NFT seats, one VRF island draw, private server intake and an attested result.
/// @dev The referee is trusted to match the public input/result hashes to its LLM execution.
/// VRF proves island selection, NOT the fairness of the referee. NFTs remain with their owners.
contract YunipalsArenaV2 is Ownable2Step, ReentrancyGuard, EIP712, VRFV2PlusWrapperConsumerBase {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    enum Phase {
        None,
        Open,
        Strategies,
        Resolving,
        Settled,
        Expired
    }

    enum Mode {
        Video,
        Anime
    }

    struct Config {
        address admin;
        address lobbyOperator;
        address admissionSigner;
        address referee;
        address treasury;
        address islands;
        address vrfWrapper;
        address paymentToken;
        address animeRegistry;
        bytes32 videoRulesHash;
        bytes32 animeRulesHash;
        uint32 joinWindow;
        uint32 strategyWindow;
        uint32 resolutionWindow;
    }

    struct ModeConfig {
        address eligibility;
        uint128 entryFee;
        uint16 winnerBps;
        uint16 islandBps;
        bytes32 rulesHash;
    }

    struct Entry {
        address player;
        uint256 nftChainId;
        address collection;
        uint256 tokenId;
    }

    struct Tournament {
        Phase phase;
        uint8 count;
        uint16 islandId;
        bool randomnessReceived;
        uint64 deadline;
        address islandBeneficiary;
        address treasuryBeneficiary;
        uint256 requestId;
        uint256 randomWord;
        bytes32 inputHash;
        bytes32 resultHash;
        uint8 semifinalOneWinner;
        uint8 semifinalTwoWinner;
        uint8 champion;
    }

    error InvalidConfig();
    error InvalidState();
    error DeadlinePassed();
    error Unauthorized();
    error InvalidEntry();
    error InvalidSignature();
    error IncorrectPayment();
    error IncorrectRandomnessPayment(uint256 required, uint256 supplied);
    error TransferFailed();

    event RandomnessRefunded(uint256 indexed id, address indexed player, uint256 amount);
    event RandomnessRefundCredited(uint256 indexed id, address indexed player, uint256 amount);
    event RandomnessRefundClaimed(
        Mode indexed mode, address indexed player, address indexed recipient, uint256 amount
    );

    event TournamentOpened(
        uint256 indexed id, Mode indexed mode, bytes32 rulesHash, bytes32 poolHash, uint64 deadline
    );
    event JoinWindowStarted(uint256 indexed id, uint64 deadline);
    event Entered(
        uint256 indexed id,
        uint8 indexed seat,
        address indexed player,
        uint256 nftChainId,
        address collection,
        uint256 tokenId
    );
    event IslandRequested(uint256 indexed id, uint256 indexed requestId, uint256 cost);
    event RandomnessReceived(uint256 indexed id, uint256 indexed requestId, uint256 word);
    event IslandSelected(uint256 indexed id, uint16 indexed islandId, uint16 ticket, address beneficiary);
    event StrategiesOpened(uint256 indexed id, uint64 deadline);
    event InputFrozen(uint256 indexed id, bytes32 inputHash, bytes32[4] strategyCommitments, uint64 deadline);
    event AutomaticStrategiesAssigned(uint256 indexed id, uint8 seatMask);
    event ResultSettled(
        uint256 indexed id,
        bytes32 resultHash,
        uint8 semifinalOneWinner,
        uint8 semifinalTwoWinner,
        uint8 champion
    );
    event TournamentExpired(uint256 indexed id);
    event PayoutsReleased(uint256 indexed id, bytes32 videoHash);
    event Claimed(Mode indexed mode, address indexed player, address indexed recipient, uint256 amount);
    event EntryPauseChanged(Mode indexed mode, bool paused);
    event TreasuryChanged(address indexed previousTreasury, address indexed newTreasury);
    event TournamentTreasuryAssigned(uint256 indexed id, address indexed beneficiary);
    event LobbyOperatorChanged(address indexed previousOperator, address indexed newOperator);

    bytes32 public constant ENTRY_TYPEHASH = keccak256(
        "EntryPermit(uint256 tournamentId,address player,uint256 nftChainId,address collection,uint256 tokenId,uint256 expiry)"
    );
    bytes32 public constant STRATEGY_TYPEHASH =
        keccak256("StrategyApproval(uint256 tournamentId,uint8 seat,bytes32 commitment)");
    bytes32 public constant DRAW_DOMAIN = keccak256("yunipals-arena/onchain-island/v1");
    bytes32 public constant FALLBACK_DOMAIN = keccak256("yunipals-arena/automatic-attack/v1");
    bytes32 public constant FALLBACK_COMMITMENT_DOMAIN = keccak256("yunipals-arena/automatic-commitment/v1");
    uint32 public constant CALLBACK_GAS_LIMIT = 120_000;
    uint16 public constant REQUEST_CONFIRMATIONS = 10;
    address public constant BASE_YUNIPALS = 0x98433dF878e8C898CB907345C3a7756E5F72240f;
    address public constant OTHER_YUNIPALS = 0x85F0e02cb992aa1F9F47112F815F519EF1A59E2D;

    address public immutable admissionSigner;
    address public immutable referee;
    address public treasury;
    address public lobbyOperator;
    IERC721 public immutable islands;
    address public immutable paymentToken;
    uint32 public immutable joinWindow;
    uint32 public immutable strategyWindow;
    uint32 public immutable resolutionWindow;

    ModeConfig[2] private _modes;
    bool[2] public entriesPaused;
    uint256[2] public nextTournamentId;
    uint256 public paymentLiability;
    uint256 public randomnessRefundLiability;
    mapping(uint256 => Tournament) private _tournaments;
    mapping(uint256 => Entry[4]) private _entries;
    mapping(uint256 => uint256) public requestTournament;
    mapping(bytes32 => uint256) public activeNftTournament;
    mapping(Mode => mapping(address => uint256)) public claimable;
    mapping(Mode => mapping(address => uint256)) public randomnessRefund;
    mapping(uint256 => bytes32) public publishedVideoHash;
    mapping(uint256 => uint8) public automaticStrategyMask;

    constructor(Config memory c)
        Ownable(c.admin)
        EIP712("YunipalsArena", "1")
        VRFV2PlusWrapperConsumerBase(c.vrfWrapper)
    {
        if (
            c.lobbyOperator == address(0) || c.admissionSigner == address(0) || c.referee == address(0)
                || c.treasury == address(0) || c.islands.code.length == 0 || c.paymentToken.code.length == 0
                || c.animeRegistry.code.length == 0 || c.videoRulesHash == bytes32(0)
                || c.animeRulesHash == bytes32(0) || c.videoRulesHash == c.animeRulesHash
                || c.joinWindow < 10 minutes || c.joinWindow > 30 days || c.strategyWindow < 10 minutes
                || c.strategyWindow > 7 days || c.resolutionWindow < 1 hours || c.resolutionWindow > 30 days
        ) revert InvalidConfig();
        admissionSigner = c.admissionSigner;
        referee = c.referee;
        treasury = c.treasury;
        lobbyOperator = c.lobbyOperator;
        islands = IERC721(c.islands);
        paymentToken = c.paymentToken;
        joinWindow = c.joinWindow;
        strategyWindow = c.strategyWindow;
        resolutionWindow = c.resolutionWindow;
        _modes[0] = ModeConfig(address(0), 2_000_000, 7500, 500, c.videoRulesHash);
        _modes[1] = ModeConfig(c.animeRegistry, 1_000_000, 8000, 500, c.animeRulesHash);
        entriesPaused[0] = true;
        entriesPaused[1] = true;
        nextTournamentId[0] = 1;
        nextTournamentId[1] = 2;
    }

    receive() external payable {}

    function modeConfig(Mode mode) public view returns (ModeConfig memory) {
        return _modes[uint8(mode)];
    }

    function tournamentMode(uint256 id) public pure returns (Mode) {
        if (id == 0) revert InvalidState();
        return Mode(uint8((id - 1) % 2));
    }

    function quoteJoin(uint256 id, uint256 gasPrice) external view returns (bool firstEntry, uint256 fee) {
        Tournament storage t = _tournaments[id];
        if (t.phase != Phase.Open || t.count >= 4 || gasPrice == 0) revert InvalidState();
        firstEntry = t.count == 0;
        fee = firstEntry ? i_vrfV2PlusWrapper.estimateRequestPriceNative(CALLBACK_GAS_LIMIT, 1, gasPrice) : 0;
    }

    function poolHash() external pure returns (bytes32) {
        return IslandPool.SHA256;
    }

    function islandForTicket(uint256 ticket) external pure returns (uint16) {
        return IslandPool.islandForTicket(ticket);
    }

    function tournament(uint256 id) external view returns (Tournament memory) {
        return _tournaments[id];
    }

    function entries(uint256 id) external view returns (Entry[4] memory) {
        return _entries[id];
    }

    function setEntriesPaused(Mode mode, bool paused) external onlyOwner {
        entriesPaused[uint8(mode)] = paused;
        emit EntryPauseChanged(mode, paused);
    }

    /// @notice Change the operations recipient for future lobbies. Existing allocations stay fixed.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0) || newTreasury == address(this)) revert InvalidConfig();
        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryChanged(previousTreasury, newTreasury);
    }

    function setLobbyOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0) || newOperator == address(this)) revert InvalidConfig();
        address previousOperator = lobbyOperator;
        lobbyOperator = newOperator;
        emit LobbyOperatorChanged(previousOperator, newOperator);
    }

    function openTournament(Mode mode) external returns (uint256 id) {
        if (msg.sender != owner() && msg.sender != lobbyOperator) revert Unauthorized();
        if (entriesPaused[uint8(mode)]) revert InvalidState();
        id = nextTournamentId[uint8(mode)];
        nextTournamentId[uint8(mode)] += 2;
        Tournament storage t = _tournaments[id];
        t.phase = Phase.Open;
        t.treasuryBeneficiary = treasury;
        // An empty lobby has no deadline; the first successful payment starts its clock.
        emit TournamentOpened(id, mode, _modes[uint8(mode)].rulesHash, IslandPool.SHA256, t.deadline);
        emit TournamentTreasuryAssigned(id, t.treasuryBeneficiary);
    }

    function entryDigest(uint256 id, Entry memory e, uint256 expiry) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ENTRY_TYPEHASH, id, e.player, e.nftChainId, e.collection, e.tokenId, expiry))
        );
    }

    function strategyDigest(uint256 id, uint8 seat, bytes32 commitment) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(STRATEGY_TYPEHASH, id, seat, commitment)));
    }

    function join(uint256 id, Entry calldata e, uint256 expiry, bytes calldata permit)
        external
        payable
        nonReentrant
    {
        Tournament storage t = _tournaments[id];
        Mode mode = tournamentMode(id);
        ModeConfig memory config = _modes[uint8(mode)];
        if (entriesPaused[uint8(mode)] || t.phase != Phase.Open || t.count >= 4) revert InvalidState();
        if (t.count != 0 && block.timestamp >= t.deadline) revert DeadlinePassed();
        if (
            e.player != msg.sender || expiry < block.timestamp || expiry > block.timestamp + 10 minutes
                || !supportedCollection(e.nftChainId, e.collection)
        ) revert InvalidEntry();
        if (mode == Mode.Anime && (e.nftChainId != 8453 || e.collection != BASE_YUNIPALS)) {
            revert InvalidEntry();
        }
        if (!SignatureChecker.isValidSignatureNow(admissionSigner, entryDigest(id, e, expiry), permit)) {
            revert InvalidSignature();
        }
        if (
            config.eligibility != address(0)
                && !IEligibility(config.eligibility).isEligible(e.nftChainId, e.collection, e.tokenId)
        ) {
            revert InvalidEntry();
        }
        bytes32 nft = nftKey(e);
        if (activeNftTournament[nft] != 0) revert InvalidEntry();
        // Foreign-chain ownership is attested by the server after a fresh finalized ownership read.
        // Base ownership is additionally checked in this transaction.
        if (e.nftChainId == block.chainid && IERC721(e.collection).ownerOf(e.tokenId) != msg.sender) {
            revert InvalidEntry();
        }
        uint8 seat = t.count++;
        _entries[id][seat] = e;
        activeNftTournament[nft] = id;
        _takePayment(config.entryFee);
        emit Entered(id, seat, e.player, e.nftChainId, e.collection, e.tokenId);
        uint256 randomnessPaid;
        if (seat == 0) {
            t.deadline = (block.timestamp + joinWindow).toUint64();
            emit JoinWindowStarted(id, t.deadline);
            uint256 price = i_vrfV2PlusWrapper.calculateRequestPriceNative(CALLBACK_GAS_LIMIT, 1);
            if (price > msg.value) revert IncorrectRandomnessPayment(price, msg.value);
            (uint256 requestId, uint256 paid) = requestRandomnessPayInNative(
                CALLBACK_GAS_LIMIT,
                REQUEST_CONFIRMATIONS,
                1,
                VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
            );
            if (paid > msg.value) revert IncorrectRandomnessPayment(paid, msg.value);
            if (requestId == 0 || requestTournament[requestId] != 0) revert InvalidState();
            randomnessPaid = paid;
            t.requestId = requestId;
            requestTournament[requestId] = id;
            emit IslandRequested(id, requestId, paid);
        }
        _openStrategies(id, t);
        _refundRandomness(id, mode, msg.sender, msg.value - randomnessPaid);
    }

    // Deliberately small, no external calls, and accepts valid late fulfillment after a refund.
    // Unknown/duplicate callbacks cannot change a tournament or force an oracle retry.
    function fulfillRandomWords(uint256 requestId, uint256[] memory words) internal override {
        uint256 id = requestTournament[requestId];
        Tournament storage t = _tournaments[id];
        if (id == 0 || t.randomnessReceived || words.length != 1) return;
        t.randomWord = words[0];
        t.randomnessReceived = true;
        emit RandomnessReceived(id, requestId, words[0]);
    }

    /// @notice A permissionless second step keeps external ownerOf calls out of the VRF callback.
    /// The same draw can be materialized after expiry for public audit; it cannot reopen entries.
    function finalizeIsland(uint256 id) external nonReentrant {
        Tournament storage t = _tournaments[id];
        if (!t.randomnessReceived || t.islandId != 0) revert InvalidState();
        uint16 ticket = drawTicket(id, t.randomWord);
        t.islandId = IslandPool.islandForTicket(ticket);
        // The owner at selection finalization receives the hosting share. If an island was burned,
        // retain the draw and allocate that share to the treasury; never redraw another island.
        try islands.ownerOf(t.islandId) returns (address holder) {
            t.islandBeneficiary = holder == address(0) ? t.treasuryBeneficiary : holder;
        } catch {
            t.islandBeneficiary = t.treasuryBeneficiary;
        }
        emit IslandSelected(id, t.islandId, ticket, t.islandBeneficiary);
        _openStrategies(id, t);
    }

    function drawTicket(uint256 id, uint256 word) public view returns (uint16) {
        // Rejection sampling: discard [0, 2^256 % totalWeight). No new VRF request.
        uint256 threshold = (type(uint256).max % IslandPool.TOTAL_WEIGHT + 1) % IslandPool.TOTAL_WEIGHT;
        uint256 counter;
        while (true) {
            uint256 value = uint256(
                keccak256(
                    abi.encode(
                        DRAW_DOMAIN, block.chainid, address(this), id, IslandPool.SHA256, word, counter
                    )
                )
            );
            if (value >= threshold) return uint16(value % IslandPool.TOTAL_WEIGHT);
            ++counter;
        }
        revert InvalidState();
    }

    /// @notice Called after the central server has all four private player strategies.
    /// Commitments include client-generated random salts to prevent prompt dictionary guessing.
    function freezeInput(
        uint256 id,
        bytes32 inputHash,
        bytes32[4] calldata commitments,
        bytes[4] calldata signatures
    ) external nonReentrant {
        _freezeInput(id, inputHash, commitments, signatures, 0);
    }

    /// @notice The central intake attests which seats missed submission. Automatic inputs
    /// are public, reproducible commitments; they never impersonate a player's signature.
    function freezeInputWithFallback(
        uint256 id,
        bytes32 inputHash,
        bytes32[4] calldata commitments,
        bytes[4] calldata signatures,
        uint8 seatMask
    ) external nonReentrant {
        if (seatMask == 0 || seatMask > 15) revert InvalidState();
        _freezeInput(id, inputHash, commitments, signatures, seatMask);
    }

    function fallbackAttack(uint256 id, uint8 seat) public view returns (uint8) {
        Tournament storage t = _tournaments[id];
        if (seat >= 4 || !t.randomnessReceived) revert InvalidState();
        return uint8(
            uint256(
                keccak256(
                    abi.encode(
                        FALLBACK_DOMAIN,
                        block.chainid,
                        address(this),
                        id,
                        seat,
                        _modes[uint8(tournamentMode(id))].rulesHash,
                        t.randomWord
                    )
                )
            ) % 4
        );
    }

    function fallbackCommitment(uint256 id, uint8 seat) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                FALLBACK_COMMITMENT_DOMAIN,
                block.chainid,
                address(this),
                id,
                seat,
                _modes[uint8(tournamentMode(id))].rulesHash,
                _tournaments[id].randomWord,
                fallbackAttack(id, seat)
            )
        );
    }

    function _freezeInput(
        uint256 id,
        bytes32 inputHash,
        bytes32[4] calldata commitments,
        bytes[4] calldata signatures,
        uint8 seatMask
    ) private {
        if (msg.sender != referee) revert Unauthorized();
        Tournament storage t = _tournaments[id];
        if (t.phase != Phase.Strategies || inputHash == bytes32(0)) revert InvalidState();
        if (seatMask != 0 && block.timestamp < t.deadline) revert InvalidState();
        // Give the service one resolution window to recover/freeze after the submission
        // deadline. A prolonged outage can then refund; restarts cannot extend this bound.
        if (block.timestamp >= uint256(t.deadline) + resolutionWindow) revert DeadlinePassed();
        for (uint8 seat; seat < 4; ++seat) {
            if ((seatMask & (uint8(1) << seat)) != 0) {
                if (signatures[seat].length != 0 || commitments[seat] != fallbackCommitment(id, seat)) {
                    revert InvalidSignature();
                }
                continue;
            }
            if (
                commitments[seat] == bytes32(0)
                    || !SignatureChecker.isValidSignatureNow(
                        _entries[id][seat].player,
                        strategyDigest(id, seat, commitments[seat]),
                        signatures[seat]
                    )
            ) revert InvalidSignature();
        }
        t.inputHash = inputHash;
        t.phase = Phase.Resolving;
        t.deadline = (block.timestamp + resolutionWindow).toUint64();
        automaticStrategyMask[id] = seatMask;
        if (seatMask != 0) emit AutomaticStrategiesAssigned(id, seatMask);
        emit InputFrozen(id, inputHash, commitments, t.deadline);
    }

    /// @notice Fix the single accepted result before video production. Funds remain held.
    function settle(uint256 id, bytes32 resultHash, uint8 semiOne, uint8 semiTwo, uint8 champion)
        external
        nonReentrant
    {
        if (msg.sender != referee) revert Unauthorized();
        Tournament storage t = _tournaments[id];
        if (
            t.phase != Phase.Resolving || resultHash == bytes32(0) || semiOne > 1 || semiTwo < 2
                || semiTwo > 3 || (champion != semiOne && champion != semiTwo)
        ) {
            revert InvalidState();
        }
        if (block.timestamp >= t.deadline) revert DeadlinePassed();
        t.phase = Phase.Settled;
        t.resultHash = resultHash;
        t.semifinalOneWinner = semiOne;
        t.semifinalTwoWinner = semiTwo;
        t.champion = champion;
        _releaseNfts(id, t.count);
        emit ResultSettled(id, resultHash, semiOne, semiTwo, champion);
    }

    /// @notice Referee attests that the completed film is published, then unlocks payouts once.
    /// The hash binds the film; the centralized publisher is trusted for its availability.
    function releasePayouts(uint256 id, bytes32 videoHash) external nonReentrant {
        if (msg.sender != referee) revert Unauthorized();
        Tournament storage t = _tournaments[id];
        if (t.phase != Phase.Settled || videoHash == bytes32(0) || publishedVideoHash[id] != bytes32(0)) {
            revert InvalidState();
        }
        publishedVideoHash[id] = videoHash;
        Mode mode = tournamentMode(id);
        ModeConfig memory config = _modes[uint8(mode)];
        uint256 pot = uint256(config.entryFee) * 4;
        uint256 winnerAmount = pot * config.winnerBps / 10_000;
        uint256 islandAmount = pot * config.islandBps / 10_000;
        claimable[mode][_entries[id][t.champion].player] += winnerAmount;
        claimable[mode][t.islandBeneficiary] += islandAmount;
        claimable[mode][t.treasuryBeneficiary] += pot - winnerAmount - islandAmount;
        emit PayoutsReleased(id, videoHash);
    }

    /// @notice Anyone can end a stalled tournament. Missing strategies alone continue with
    /// automatic attacks; failure to freeze for another resolution window permits refunds.
    /// This does not cancel, replace or erase its VRF request/result. No partial strategy reveal.
    function expire(uint256 id) external nonReentrant {
        Tournament storage t = _tournaments[id];
        if (t.phase != Phase.Open && t.phase != Phase.Strategies && t.phase != Phase.Resolving) {
            revert InvalidState();
        }
        if (t.deadline == 0 || block.timestamp < t.deadline) revert InvalidState();
        if (t.phase == Phase.Strategies && block.timestamp < uint256(t.deadline) + resolutionWindow) {
            revert InvalidState();
        }
        t.phase = Phase.Expired;
        for (uint8 i; i < t.count; ++i) {
            Mode mode = tournamentMode(id);
            claimable[mode][_entries[id][i].player] += _modes[uint8(mode)].entryFee;
        }
        _releaseNfts(id, t.count);
        emit TournamentExpired(id);
    }

    function claim(Mode mode, address payable recipient) external nonReentrant {
        uint256 amount = claimable[mode][msg.sender];
        if (amount == 0 || recipient == address(0)) revert InvalidState();
        claimable[mode][msg.sender] = 0;
        paymentLiability -= amount;
        emit Claimed(mode, msg.sender, recipient, amount);
        IERC20(paymentToken).safeTransfer(recipient, amount);
    }

    function claimRandomnessRefund(Mode mode, address payable recipient) external nonReentrant {
        uint256 amount = randomnessRefund[mode][msg.sender];
        if (amount == 0 || recipient == address(0) || recipient == address(this)) revert InvalidState();
        randomnessRefund[mode][msg.sender] = 0;
        randomnessRefundLiability -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RandomnessRefundClaimed(mode, msg.sender, recipient, amount);
    }

    function availableNativeSurplus() public view returns (uint256) {
        return address(this).balance - randomnessRefundLiability;
    }

    function withdrawNativeSurplus(address payable recipient, uint256 amount)
        external
        nonReentrant
        onlyOwner
    {
        if (recipient == address(0) || recipient == address(this) || amount > availableNativeSurplus()) {
            revert InvalidState();
        }
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _refundRandomness(uint256 id, Mode mode, address player, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(player).call{value: amount, gas: 30_000}("");
        if (ok) {
            emit RandomnessRefunded(id, player, amount);
        } else {
            randomnessRefund[mode][player] += amount;
            randomnessRefundLiability += amount;
            emit RandomnessRefundCredited(id, player, amount);
        }
    }

    function supportedCollection(uint256 chainId, address collection) public pure returns (bool) {
        return (chainId == 8453 && collection == BASE_YUNIPALS)
            || ((chainId == 1 || chainId == 137 || chainId == 56) && collection == OTHER_YUNIPALS);
    }

    function nftKey(Entry memory e) public pure returns (bytes32) {
        return keccak256(abi.encode(e.nftChainId, e.collection, e.tokenId));
    }

    function _openStrategies(uint256 id, Tournament storage t) private {
        if (t.phase == Phase.Open && t.count == 4 && t.islandId != 0 && block.timestamp < t.deadline) {
            t.phase = Phase.Strategies;
            t.deadline = (block.timestamp + strategyWindow).toUint64();
            emit StrategiesOpened(id, t.deadline);
        }
    }

    function _takePayment(uint256 entryFee) private {
        IERC20 token = IERC20(paymentToken);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), entryFee);
        if (token.balanceOf(address(this)) - beforeBalance != entryFee) revert IncorrectPayment();
        paymentLiability += entryFee;
    }

    function _releaseNfts(uint256 id, uint8 count) private {
        for (uint8 i; i < count; ++i) {
            delete activeNftTournament[nftKey(_entries[id][i])];
        }
    }
}
