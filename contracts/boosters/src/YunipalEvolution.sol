// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PortalRandomness} from "./PortalRandomness.sol";
import {PortalRules} from "./PortalRules.sol";
import {PortalGates} from "./PortalGates.sol";
import {PortalGradingValidator} from "./PortalGradingValidator.sol";
import {SerumCatalogue} from "./SerumCatalogue.sol";
import {YunipalMonsters} from "./YunipalMonsters.sol";
import {YunipalAdventures} from "./YunipalAdventures.sol";

interface IProgressionArtwork {
    struct Asset {
        string uri;
        bytes32 hash;
    }
    function inputArtwork(uint256 tokenId) external view returns (Asset memory, uint64);
}

/// @notice Paid, durable mutation requests. There is deliberately no cancellation or reroll path.
contract YunipalEvolution is PortalRandomness {
    using SafeERC20 for IERC20;
    uint256 public constant AI_FEE = 100_000;
    bytes32 public constant GENERATOR_ROLE = keccak256("GENERATOR_ROLE");
    PortalGradingValidator private immutable _validator = new PortalGradingValidator();

    struct State {
        uint64 artVersion;
        uint8 localDoses;
        uint8 presence;
        bytes32 historyHash;
    }

    struct Expected {
        uint64 artVersion;
        bytes32 historyHash;
    }

    struct Artifact {
        string uri;
        bytes32 hash;
        string metadataURI;
        bytes32 metadataHash;
    }

    struct Request {
        uint256 parentA;
        uint256 parentB;
        address owner;
        uint64 requestedAt;
        Expected beforeA;
        Expected beforeB;
        IProgressionArtwork.Asset inputA;
        IProgressionArtwork.Asset inputB;
        SerumCatalogue.Dose dose;
        uint8 presenceA;
        uint8 presenceB;
        uint8 resultPresence;
        uint256 randomnessId;
        bool ready;
        bool completed;
        uint256 resultTokenId;
    }

    YunipalMonsters public cards;
    YunipalAdventures public adventures;
    IERC20 public usdc;
    address public feeRecipient;
    bytes32 public renderingPolicy;
    bool public requestsPaused;
    uint256 public requestCount;
    uint256 public feeLiability;
    mapping(uint256 => State) public state;
    mapping(uint256 => Artifact) private _artifacts;
    mapping(uint256 => Request) private _requests;
    mapping(uint256 => SerumCatalogue.Dose[]) private _doses;
    mapping(uint256 => uint256) public pendingRequest;
    mapping(uint256 => uint256) public randomnessJob;

    event EvolutionRequested(
        uint256 indexed requestId,
        uint256 indexed parentA,
        uint256 indexed parentB,
        address owner,
        uint256 randomnessId,
        bytes32 renderingPolicy,
        uint32 catalogueVersion,
        uint8 serumId,
        uint8 presenceId
    );
    event FusionPresenceSettled(uint256 indexed requestId, uint256 indexed randomnessId, uint8 presence);
    event EvolutionCompleted(
        uint256 indexed requestId,
        uint256 indexed tokenId,
        uint64 artVersion,
        uint8 localDoses,
        uint8 presence,
        bytes32 historyHash,
        bytes32 artworkHash,
        string artworkURI,
        bytes32 metadataHash,
        string metadataURI
    );
    event RequestsPaused(bool paused);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        YunipalMonsters cards_,
        YunipalAdventures adventures_,
        IERC20 usdc_,
        address recipient_,
        bytes32 renderingPolicy_,
        IVRFV2PlusWrapper wrapper_,
        uint16 confirmations_,
        PortalRules rules_
    ) external initializer {
        require(
            address(cards_).code.length != 0 && address(adventures_).code.length != 0
                && address(adventures_.cards()) == address(cards_),
            "invalid dependencies"
        );
        require(
            IERC20Metadata(address(usdc_)).decimals() == 6 && recipient_ != address(0)
                && renderingPolicy_ != bytes32(0),
            "invalid fee or policy"
        );
        __PortalRandomness_init(admin, wrapper_, confirmations_, rules_);
        cards = cards_;
        adventures = adventures_;
        usdc = usdc_;
        feeRecipient = recipient_;
        renderingPolicy = renderingPolicy_;
    }

    function pauseRequests(bool paused) external onlyRole(PAUSER_ROLE) {
        requestsPaused = paused;
        emit RequestsPaused(paused);
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function doses(uint256 tokenId) external view returns (SerumCatalogue.Dose[] memory) {
        return _doses[tokenId];
    }

    function metadataURI(uint256 tokenId) external view returns (string memory) {
        return _artifacts[tokenId].metadataURI;
    }

    function artwork(uint256 tokenId) external view returns (string memory, bytes32, uint64) {
        return (_artifacts[tokenId].uri, _artifacts[tokenId].hash, state[tokenId].artVersion);
    }

    function requestBinding(uint256 id) public view returns (bytes32) {
        Request memory request = _requests[id];
        require(request.ready, "randomness pending");
        request.completed = false;
        request.resultTokenId = 0;
        return keccak256(abi.encode(block.chainid, address(this), id, renderingPolicy, request));
    }

    function consumeSerum(
        uint256 tokenId,
        Expected calldata expected,
        SerumCatalogue.Dose calldata dose,
        uint64 deadline
    ) external nonReentrant returns (uint256 id) {
        _checkRequest(deadline);
        require(state[tokenId].localDoses < 11, "dose limit reached");
        SerumCatalogue.Dose memory unused = adventures.unusedSerum(tokenId);
        require(unused.serumId != 0 && keccak256(abi.encode(unused)) == keccak256(abi.encode(dose)), "serum changed");
        IProgressionArtwork.Asset memory input = _reserve(tokenId, expected);
        id = ++requestCount;
        Request storage request = _requests[id];
        request.parentA = tokenId;
        request.owner = msg.sender;
        request.requestedAt = uint64(block.timestamp);
        request.beforeA = expected;
        request.inputA = input;
        request.dose = dose;
        request.presenceA = state[tokenId].presence;
        request.resultPresence = dose.presenceId;
        request.ready = true;
        pendingRequest[tokenId] = id;
        _collectFee();
        emit EvolutionRequested(
            id, tokenId, 0, msg.sender, 0, renderingPolicy, dose.catalogueVersion, dose.serumId, dose.presenceId
        );
    }

    function fuse(
        uint256 a,
        uint256 b,
        Expected calldata expectedA,
        Expected calldata expectedB,
        uint256 maxVrfPrice,
        uint64 deadline
    ) external payable nonReentrant returns (uint256 id) {
        _checkRequest(deadline);
        cards.fusionRecipe(a, b); // Includes canonical parent order, adjacency and lineage checks.
        cards.assertNoPendingClaim(a);
        cards.assertNoPendingClaim(b);
        IProgressionArtwork.Asset memory inputA = _reserve(a, expectedA);
        IProgressionArtwork.Asset memory inputB = _reserve(b, expectedB);
        id = ++requestCount;
        Request storage request = _requests[id];
        request.parentA = a;
        request.parentB = b;
        request.owner = msg.sender;
        request.requestedAt = uint64(block.timestamp);
        request.beforeA = expectedA;
        request.beforeB = expectedB;
        request.inputA = inputA;
        request.inputB = inputB;
        request.presenceA = state[a].presence;
        request.presenceB = state[b].presence;
        pendingRequest[a] = id;
        pendingRequest[b] = id;
        _collectFee();
        uint256 paid;
        if (request.presenceA == request.presenceB) {
            request.resultPresence = request.presenceA;
            request.ready = true;
        } else {
            (request.randomnessId, paid) = _requestRandomness(maxVrfPrice);
            randomnessJob[request.randomnessId] = id;
        }
        emit EvolutionRequested(id, a, b, msg.sender, request.randomnessId, renderingPolicy, 0, 0, 0);
        if (request.ready) emit FusionPresenceSettled(id, 0, request.resultPresence);
        _refundExcess(paid);
    }

    function _afterRandomness(uint256 randomnessId) internal override {
        _settlePresence(randomnessId);
    }

    function settlePresence(uint256 randomnessId) external nonReentrant {
        _settlePresence(randomnessId);
    }

    function _settlePresence(uint256 randomnessId) private {
        uint256 id = randomnessJob[randomnessId];
        Request storage request = _requests[id];
        require(id != 0 && randomRequests[randomnessId].received, "randomness unavailable");
        if (request.ready) return;
        bytes32 entropy = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                id,
                randomnessId,
                request.parentA,
                request.parentB,
                request.beforeA,
                request.beforeB,
                randomRequests[randomnessId].seed
            )
        );
        request.resultPresence = PortalGates.uniform(entropy, 2) == 0 ? request.presenceA : request.presenceB;
        request.ready = true;
        emit FusionPresenceSettled(id, randomnessId, request.resultPresence);
    }

    function complete(uint256 id, bytes32 binding, Artifact calldata artifact)
        external
        onlyRole(GENERATOR_ROLE)
        nonReentrant
        returns (uint256 tokenId)
    {
        Request storage request = _requests[id];
        require(request.ready && !request.completed && binding == requestBinding(id), "request not ready or changed");
        _validator.validateAsset(artifact.uri, artifact.hash);
        _validator.validateAsset(artifact.metadataURI, artifact.metadataHash);
        _checkReserved(id, request.parentA, request.owner, request.beforeA);
        if (request.parentB != 0) {
            _checkReserved(id, request.parentB, request.owner, request.beforeB);
            tokenId = cards.completeFusion(request.parentA, request.parentB, request.owner);
            adventures.inheritState(tokenId, request.parentA, request.parentB);
            state[tokenId].historyHash = keccak256(
                abi.encode(
                    "fusion", request.beforeA.historyHash, request.beforeB.historyHash, request.resultPresence, binding
                )
            );
            state[tokenId].artVersion = 1;
            delete pendingRequest[request.parentB];
        } else {
            tokenId = request.parentA;
            _doses[tokenId].push(request.dose);
            ++state[tokenId].localDoses;
            state[tokenId].artVersion = request.beforeA.artVersion + 1;
            state[tokenId].historyHash = keccak256(abi.encode("dose", request.beforeA.historyHash, request.dose));
            adventures.clearSerum(tokenId);
            cards.releaseCard(tokenId);
        }
        state[tokenId].presence = request.resultPresence;
        _artifacts[tokenId] = artifact;
        request.completed = true;
        request.resultTokenId = tokenId;
        delete pendingRequest[request.parentA];
        feeLiability -= AI_FEE;
        cards.notifyGradingUpdate(tokenId);
        usdc.safeTransfer(feeRecipient, AI_FEE);
        State memory current = state[tokenId];
        emit EvolutionCompleted(
            id,
            tokenId,
            current.artVersion,
            current.localDoses,
            current.presence,
            current.historyHash,
            artifact.hash,
            artifact.uri,
            artifact.metadataHash,
            artifact.metadataURI
        );
    }

    function _checkRequest(uint64 deadline) private view {
        require(!requestsPaused && block.timestamp <= deadline, "paused or expired");
        require(
            cards.evolutionController() == address(this) && cards.adventureController() == address(adventures)
                && cards.gradingRegistry() != address(0),
            "controller unbound"
        );
    }

    function _reserve(uint256 tokenId, Expected calldata expected)
        private
        returns (IProgressionArtwork.Asset memory input)
    {
        require(cards.ownerOf(tokenId) == msg.sender, "owner only");
        require(state[tokenId].historyHash == expected.historyHash, "history changed");
        cards.reserveCard(tokenId, true);
        uint64 version;
        (input, version) = IProgressionArtwork(cards.gradingRegistry()).inputArtwork(tokenId);
        require(version == expected.artVersion, "artwork changed");
    }

    function _checkReserved(uint256 id, uint256 tokenId, address owner, Expected storage expected) private view {
        require(
            pendingRequest[tokenId] == id && cards.cardReservation(tokenId) == address(this)
                && cards.ownerOf(tokenId) == owner && !cards.hasCompletedGrade(tokenId),
            "input no longer reserved"
        );
        require(
            state[tokenId].historyHash == expected.historyHash && state[tokenId].artVersion == expected.artVersion,
            "input changed"
        );
    }

    function _collectFee() private {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), AI_FEE);
        require(usdc.balanceOf(address(this)) == beforeBalance + AI_FEE, "incorrect fee deposit");
        feeLiability += AI_FEE;
    }
}
