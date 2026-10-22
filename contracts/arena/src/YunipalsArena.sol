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
import {IslandPool} from "./IslandPool.sol";

/// @notice Four NFT seats, one VRF island draw, private server intake and an attested result.
/// @dev The referee is trusted to match the public input/result hashes to its LLM execution.
/// VRF proves island selection, NOT the fairness of the referee. NFTs remain with their owners.
contract YunipalsArena is Ownable2Step, ReentrancyGuard, EIP712, VRFV2PlusWrapperConsumerBase {
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

    struct Config {
        address admin;
        address lobbyOperator;
        address admissionSigner;
        address referee;
        address treasury;
        address islands;
        address vrfWrapper;
        address paymentToken; // zero = native ETH; otherwise a standard, non-rebasing ERC20
        uint128 entryFee;
        uint16 winnerBps;
        uint16 islandBps;
        uint32 joinWindow;
        uint32 strategyWindow;
        uint32 resolutionWindow;
        uint128 maxVrfCost;
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
    error InsufficientVrfFunding();
    error TransferFailed();

    event TournamentOpened(uint256 indexed id, bytes32 rulesHash, bytes32 poolHash, uint64 deadline);
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
    event Claimed(address indexed player, address indexed recipient, uint256 amount);
    event EntryPauseChanged(bool paused);
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
    uint128 public immutable entryFee;
    uint16 public immutable winnerBps;
    uint16 public immutable islandBps;
    uint32 public immutable joinWindow;
    uint32 public immutable strategyWindow;
    uint32 public immutable resolutionWindow;
    uint128 public immutable maxVrfCost;
    bytes32 public immutable rulesHash;

    bool public entriesPaused = true;
    uint256 public nextTournamentId = 1;
    // All escrow plus unclaimed payouts/refunds. Settlement never reduces this number.
    uint256 public paymentLiability;
    mapping(uint256 => Tournament) private _tournaments;
    mapping(uint256 => Entry[4]) private _entries;
    mapping(uint256 => uint256) public requestTournament;
    mapping(bytes32 => uint256) public activeNftTournament;
    mapping(address => uint256) public claimable;
    mapping(uint256 => bytes32) public publishedVideoHash;
    mapping(uint256 => uint8) public automaticStrategyMask;

    constructor(Config memory c)
        Ownable(c.admin)
        EIP712("YunipalsArena", "1")
        VRFV2PlusWrapperConsumerBase(c.vrfWrapper)
    {
        if (
            c.lobbyOperator == address(0) || c.admissionSigner == address(0) || c.referee == address(0)
                || c.treasury == address(0) || c.islands.code.length == 0 || c.entryFee == 0
                || c.rulesHash == bytes32(0) || uint256(c.winnerBps) + c.islandBps > 10_000
                || c.maxVrfCost == 0 || c.joinWindow < 10 minutes || c.joinWindow > 30 days
                || c.strategyWindow < 10 minutes || c.strategyWindow > 7 days || c.resolutionWindow < 1 hours
                || c.resolutionWindow > 30 days
                || (c.paymentToken != address(0) && c.paymentToken.code.length == 0)
        ) revert InvalidConfig();
        admissionSigner = c.admissionSigner;
        referee = c.referee;
        treasury = c.treasury;
        lobbyOperator = c.lobbyOperator;
        islands = IERC721(c.islands);
        paymentToken = c.paymentToken;
        entryFee = c.entryFee;
        winnerBps = c.winnerBps;
        islandBps = c.islandBps;
        joinWindow = c.joinWindow;
        strategyWindow = c.strategyWindow;
        resolutionWindow = c.resolutionWindow;
        maxVrfCost = c.maxVrfCost;
        rulesHash = c.rulesHash;
    }

    receive() external payable {} // Operator-funded VRF reserve; never player collateral.

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

    function setEntriesPaused(bool paused) external onlyOwner {
        entriesPaused = paused;
        emit EntryPauseChanged(paused);
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

    function openTournament() external returns (uint256 id) {
        if (msg.sender != owner() && msg.sender != lobbyOperator) revert Unauthorized();
        if (entriesPaused) revert InvalidState();
        id = nextTournamentId++;
        Tournament storage t = _tournaments[id];
        t.phase = Phase.Open;
        t.treasuryBeneficiary = treasury;
        // An empty lobby has no deadline; the first successful payment starts its clock.
        emit TournamentOpened(id, rulesHash, IslandPool.SHA256, t.deadline);
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
        if (entriesPaused || t.phase != Phase.Open || t.count >= 4) revert InvalidState();
        if (t.count != 0 && block.timestamp >= t.deadline) revert DeadlinePassed();
        if (
            e.player != msg.sender || expiry < block.timestamp || expiry > block.timestamp + 10 minutes
                || !supportedCollection(e.nftChainId, e.collection)
        ) revert InvalidEntry();
        if (!SignatureChecker.isValidSignatureNow(admissionSigner, entryDigest(id, e, expiry), permit)) {
            revert InvalidSignature();
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
        _takePayment();
        emit Entered(id, seat, e.player, e.nftChainId, e.collection, e.tokenId);
        if (seat == 0) {
            t.deadline = (block.timestamp + joinWindow).toUint64();
            emit JoinWindowStarted(id, t.deadline);
            uint256 price = i_vrfV2PlusWrapper.calculateRequestPriceNative(CALLBACK_GAS_LIMIT, 1);
            if (price > maxVrfCost || price > availableVrfFunds()) revert InsufficientVrfFunding();
            (uint256 requestId, uint256 paid) = requestRandomnessPayInNative(
                CALLBACK_GAS_LIMIT,
                REQUEST_CONFIRMATIONS,
                1,
                VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
            );
            if (requestId == 0 || requestTournament[requestId] != 0) revert InvalidState();
            t.requestId = requestId;
            requestTournament[requestId] = id;
            emit IslandRequested(id, requestId, paid);
        }
        _openStrategies(id, t);
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
                        FALLBACK_DOMAIN, block.chainid, address(this), id, seat, rulesHash, t.randomWord
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
                rulesHash,
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
        uint256 pot = uint256(entryFee) * 4;
        uint256 winnerAmount = pot * winnerBps / 10_000;
        uint256 islandAmount = pot * islandBps / 10_000;
        claimable[_entries[id][t.champion].player] += winnerAmount;
        claimable[t.islandBeneficiary] += islandAmount;
        claimable[t.treasuryBeneficiary] += pot - winnerAmount - islandAmount;
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
            claimable[_entries[id][i].player] += entryFee;
        }
        _releaseNfts(id, t.count);
        emit TournamentExpired(id);
    }

    function claim(address payable recipient) external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0 || recipient == address(0)) revert InvalidState();
        claimable[msg.sender] = 0;
        paymentLiability -= amount;
        emit Claimed(msg.sender, recipient, amount);
        if (paymentToken == address(0)) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(paymentToken).safeTransfer(recipient, amount);
        }
    }

    function availableVrfFunds() public view returns (uint256) {
        return address(this).balance - (paymentToken == address(0) ? paymentLiability : 0);
    }

    function withdrawVrfFunds(address payable recipient, uint256 amount) external nonReentrant onlyOwner {
        if (recipient == address(0) || amount > availableVrfFunds()) revert InsufficientVrfFunding();
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
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

    function _takePayment() private {
        if (paymentToken == address(0)) {
            if (msg.value != entryFee) revert IncorrectPayment();
        } else {
            if (msg.value != 0) revert IncorrectPayment();
            IERC20 token = IERC20(paymentToken);
            uint256 beforeBalance = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), entryFee);
            if (token.balanceOf(address(this)) - beforeBalance != entryFee) revert IncorrectPayment();
        }
        paymentLiability += entryFee;
    }

    function _releaseNfts(uint256 id, uint8 count) private {
        for (uint8 i; i < count; ++i) {
            delete activeNftTournament[nftKey(_entries[id][i])];
        }
    }
}
