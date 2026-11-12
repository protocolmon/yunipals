// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {BoosterAdmin} from "./BoosterAdmin.sol";
import {PackRegistry} from "./PackRegistry.sol";
import {YunipalMonsters} from "./YunipalMonsters.sol";
import {PortalCollection} from "./PortalCollection.sol";
import {PortalRegistry} from "./PortalRegistry.sol";
import {PortalGates} from "./PortalGates.sol";
import {PortalGradingCompetition} from "./PortalGradingCompetition.sol";

contract PortalGrading is BoosterAdmin, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    error CompetitionConfiguration();
    error CompetitionQuote();
    error CompetitionDeposit();
    error CompetitionPolicyFrozen();
    error InternalAdmissionOnly();
    error CompetitionNotificationGas();
    bytes32 public constant GRADER_ROLE = keccak256("GRADER_ROLE");
    bytes32 public constant SPELL_DOMAIN = keccak256("YunipalsPortalSpellV1");

    struct Asset {
        string uri;
        bytes32 hash;
    }

    struct PaymentPolicy {
        uint128 aiFee;
        uint128 portalFee;
        address aiRecipient;
        address portalRecipient;
        uint64 version;
    }

    struct Rubric {
        bytes32 modelPolicy;
        uint8 copyCap;
        string uri;
        bool configured;
    }

    struct Admission {
        uint256 tokenId;
        uint256 portalId;
        uint64 roundId;
        uint64 paymentVersion;
        uint64 artVersion;
        bytes32 rubricId;
        uint256 maximumFee;
        bytes32 inputHash;
        bytes32 spellCommitment;
        uint256 nonce;
    }

    struct Request {
        uint256 tokenId;
        uint256 portalId;
        uint256 kindId;
        address submitter;
        uint64 roundId;
        uint64 acceptedAt;
        uint64 acceptedBlock;
        uint64 artVersion;
        bytes32 spellCommitment;
        bytes32 rubricId;
        Asset input;
        PaymentPolicy payment;
        uint256 nonce;
        bool completed;
    }

    struct Result {
        bytes32 requestBinding;
        Asset artwork;
        uint8[4] scores;
        uint8 baseCreativity;
        bool copied;
        bytes32 evidenceHash;
        bytes32 reportHash;
        bytes32 modelsHash;
        string reportURI;
        string spellURI;
        uint64 completedAt;
    }

    YunipalMonsters public cards;
    PortalRegistry public registry;
    IERC20 public usdc;
    uint256 public packTypeId;
    bytes32 public catalogHash;
    string public metadataBaseURI;
    bool public admissionsPaused;
    bytes32 public activeRubric;
    uint256 public requestCount;
    mapping(uint32 => Asset) private _baseArt;
    mapping(uint256 => PaymentPolicy) public paymentPolicies;
    mapping(bytes32 => Rubric) private _rubrics;
    mapping(uint256 => Request) private _requests;
    mapping(uint256 => Result) private _results;
    mapping(uint256 => uint256) public pendingRequest;
    mapping(uint256 => uint64) public artVersion;
    mapping(uint256 => uint256[]) private _history;
    mapping(address => uint256) public nonces;
    mapping(uint256 => address) public completedBy;
    mapping(uint256 => uint256) public portalBalances;
    uint256 public totalPortalLiability;
    PortalGradingCompetition public competition;
    mapping(uint256 => bytes32) public competitionCommitments;
    uint256[25] private __gap;

    event PaymentPolicySet(
        uint256 indexed kindId,
        uint64 indexed version,
        uint128 aiFee,
        uint128 portalFee,
        address aiRecipient,
        address portalRecipient
    );
    event RubricConfigured(bytes32 indexed rubricId, bytes32 modelPolicy, uint8 copyCap, string uri);
    event ArtworkRegistered(uint32 indexed variantId, bytes32 artworkHash, string uri);
    event GradingRequested(
        uint256 indexed requestId,
        uint256 indexed tokenId,
        uint256 indexed portalId,
        address submitter,
        uint64 roundId,
        uint64 inputVersion,
        bytes32 spellCommitment,
        bytes32 rubricId
    );
    event PaymentAllocated(
        uint256 indexed requestId,
        address indexed aiRecipient,
        address indexed portalRecipient,
        uint256 aiFee,
        uint256 portalFee
    );
    event GradingCompleted(
        uint256 indexed requestId,
        uint256 indexed tokenId,
        address indexed grader,
        uint64 version,
        bytes32 artworkHash,
        uint8[4] scores,
        bool copied,
        bytes32 reportHash
    );
    event AdmissionsPaused(bool paused);
    event PortalFeeAccrued(
        uint256 indexed requestId, uint256 indexed portalId, uint256 amount, uint256 newBalance
    );
    event PortalClaimed(uint256 indexed portalId, address indexed owner, uint256 amount);
    event CompetitionConfigured(address indexed competition, bytes32 rulesHash);
    event CompetitionNotificationDeferred(uint256 indexed requestId);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        YunipalMonsters cards_,
        PortalRegistry registry_,
        IERC20 usdc_,
        uint256 packTypeId_,
        string calldata metadataBase_
    ) external initializer {
        require(
            address(cards_).code.length != 0 && address(registry_).code.length != 0
                && address(usdc_).code.length != 0,
            "invalid contracts"
        );
        require(IERC20Metadata(address(usdc_)).decimals() == 6, "USDC decimals must be six");
        __BoosterAdmin_init(admin);
        __ReentrancyGuard_init();
        cards = cards_;
        registry = registry_;
        usdc = usdc_;
        packTypeId = packTypeId_;
        catalogHash = registry_.collection().rules().validateGradingCatalog(cards_.registry(), packTypeId_);
        _validateURI(metadataBase_);
        require(bytes(metadataBase_)[bytes(metadataBase_).length - 1] == "/", "metadata base slash");
        metadataBaseURI = metadataBase_;
    }

    function setPaymentPolicy(
        uint256 kindId,
        uint128 aiFee,
        uint128 portalFee,
        address aiRecipient,
        address portalRecipient
    ) external onlyRole(CONFIG_ROLE) {
        require(portalRecipient == address(this), "portal fee must accrue");
        _setPaymentPolicy(kindId, aiFee, portalFee, aiRecipient);
    }

    function setPaymentPolicy(uint256 kindId, uint128 aiFee, uint128 portalFee, address aiRecipient)
        external
        onlyRole(CONFIG_ROLE)
    {
        _setPaymentPolicy(kindId, aiFee, portalFee, aiRecipient);
    }

    function _setPaymentPolicy(uint256 kindId, uint128 aiFee, uint128 portalFee, address aiRecipient)
        private
    {
        require(kindId > 0 && kindId <= registry.collection().kindCount(), "unknown portal kind");
        require(aiRecipient != address(0) && aiRecipient != address(this), "invalid AI recipient");
        uint64 version = paymentPolicies[kindId].version + 1;
        paymentPolicies[kindId] = PaymentPolicy(aiFee, portalFee, aiRecipient, address(this), version);
        emit PaymentPolicySet(kindId, version, aiFee, portalFee, aiRecipient, address(this));
    }

    function portalEconomicsVersion() external pure returns (uint256) {
        return 2;
    }

    function claimable(uint256 portalId) external view returns (uint256) {
        return portalBalances[portalId];
    }

    function burnAndClaim(uint256 portalId, uint256 minimumAmount, uint64 deadline) external nonReentrant {
        require(block.timestamp <= deadline, "claim deadline expired");
        PortalCollection collection = registry.collection();
        require(collection.ownerOf(portalId) == msg.sender, "portal owner only");
        uint256 amount = portalBalances[portalId];
        require(amount >= minimumAmount, "claim below minimum");
        portalBalances[portalId] = 0;
        totalPortalLiability -= amount;
        collection.burnForClaim(portalId, msg.sender);
        if (amount != 0) usdc.safeTransfer(msg.sender, amount);
        emit PortalClaimed(portalId, msg.sender, amount);
    }

    function configureRubric(bytes32 id, bytes32 modelPolicy, uint8 copyCap, string calldata uri)
        external
        onlyRole(CONFIG_ROLE)
    {
        require(
            address(competition) == address(0) || competition.canChangePolicy(), CompetitionPolicyFrozen()
        );
        require(id != bytes32(0) && !_rubrics[id].configured && modelPolicy != bytes32(0), "invalid rubric");
        require(copyCap >= 1 && copyCap <= 100, "invalid copy cap");
        _validateURI(uri);
        _rubrics[id] = Rubric(modelPolicy, copyCap, uri, true);
        activeRubric = id;
        emit RubricConfigured(id, modelPolicy, copyCap, uri);
    }

    function rubric(bytes32 id) external view returns (Rubric memory) {
        return _rubrics[id];
    }

    function registerBaseArt(uint32[] calldata variants, Asset[] calldata assets)
        external
        onlyRole(CONFIG_ROLE)
    {
        require(
            variants.length > 0 && variants.length <= 64 && variants.length == assets.length,
            "invalid artwork batch"
        );
        for (uint256 i; i < variants.length; ++i) {
            require(
                variants[i] < 264 && _baseArt[variants[i]].hash == bytes32(0), "artwork already registered"
            );
            _validateAsset(assets[i]);
            _baseArt[variants[i]] = assets[i];
            emit ArtworkRegistered(variants[i], assets[i].hash, assets[i].uri);
        }
    }

    function baseArt(uint32 variant) external view returns (Asset memory) {
        return _baseArt[variant];
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function getResult(uint256 id) external view returns (Result memory) {
        return _results[id];
    }

    function requestBinding(uint256 id) external view returns (bytes32) {
        Request memory request = _requests[id];
        request.completed = false;
        return keccak256(abi.encode(block.chainid, address(this), id, request));
    }

    function historyCount(uint256 tokenId) external view returns (uint256) {
        return _history[tokenId].length;
    }

    function historyAt(uint256 tokenId, uint256 index) external view returns (uint256) {
        return _history[tokenId][index];
    }

    function pauseAdmissions(bool paused) external onlyRole(PAUSER_ROLE) {
        admissionsPaused = paused;
        emit AdmissionsPaused(paused);
    }

    function matches(uint256 portalId, uint256 tokenId) public view returns (bool) {
        if (!registry.collection().exists(portalId)) return false;
        (uint256 packId,,, PackRegistry.Traits memory traits, bool original) = cards.provenance(tokenId);
        if (packId != packTypeId) return false;
        (uint32 sequence,, bool known) = cards.cardFacts(tokenId);
        if (!known) return false;
        try cards.ownerOf(tokenId) returns (address) {}
        catch {
            return false;
        }
        PortalGates.Gates memory gate = registry.collection().gates(portalId);
        if (traits.color != uint32(gate.colorGate) + 1 || traits.monsterType != uint32(gate.typeGate) + 1) {
            return false;
        }
        if (gate.glitterGate && traits.glitter != 1) return false;
        if (gate.diamondGate && traits.horn != 2) return false;
        return gate.originalOnly ? original : PortalGates.sequenceMatches(gate, sequence);
    }

    function inputArtwork(uint256 tokenId) public view returns (Asset memory asset, uint64 version) {
        version = artVersion[tokenId];
        if (version != 0) {
            uint256[] storage history = _history[tokenId];
            asset = _results[history[history.length - 1]].artwork;
        } else {
            (uint256 packId,, uint32 variant,,) = cards.provenance(tokenId);
            require(packId == packTypeId, "unsupported card");
            asset = _baseArt[variant];
        }
        require(asset.hash != bytes32(0), "input artwork unavailable");
    }

    function spellCommitment(
        address submitter,
        uint256 tokenId,
        uint64 version,
        uint256 nonce,
        bytes32 spellHash,
        bytes32 salt
    ) external view returns (bytes32) {
        return keccak256(
            abi.encode(
                SPELL_DOMAIN,
                block.chainid,
                address(this),
                submitter,
                tokenId,
                version,
                nonce,
                spellHash,
                salt
            )
        );
    }

    function configureCompetition(PortalGradingCompetition competition_) external onlyRole(CONFIG_ROLE) {
        require(
            address(competition) == address(0) && address(competition_).code.length != 0,
            CompetitionConfiguration()
        );
        require(
            competition_.grading() == address(this) && address(competition_.usdc()) == address(usdc),
            CompetitionConfiguration()
        );
        competition = competition_;
        emit CompetitionConfigured(address(competition_), competition_.RULES_HASH());
    }

    function competitionResult(uint256 id)
        external
        view
        returns (bool eligible, bool completed, address submitter, bytes32 rubricId, uint8[4] memory scores)
    {
        Request storage request = _requests[id];
        return (
            competitionCommitments[id] != bytes32(0),
            request.completed,
            request.submitter,
            request.rubricId,
            _results[id].scores
        );
    }

    function admit(Admission calldata admission) external returns (uint256 id) {
        require(address(competition) == address(0), CompetitionQuote());
        return this.admitFor(admission, msg.sender);
    }

    function admitCompetition(
        Admission calldata admission,
        address expectedCompetition,
        bytes32 expectedRules
    ) external returns (uint256 id) {
        require(
            expectedCompetition != address(0) && expectedCompetition == address(competition),
            CompetitionQuote()
        );
        require(expectedRules == competition.admissionHash(), CompetitionQuote());
        return this.admitFor(admission, msg.sender);
    }

    /// @dev Self-call keeps one admission implementation in deployed bytecode and preserves the payer.
    function admitFor(Admission calldata admission, address submitter)
        external
        nonReentrant
        returns (uint256 id)
    {
        require(msg.sender == address(this), InternalAdmissionOnly());
        require(!admissionsPaused, "admission paused");
        require(registry.collection().claimController() == address(this), "claim controller unbound");
        (PortalRegistry.Round memory current, bool accepting) = registry.activePortal();
        require(
            accepting && current.portalId == admission.portalId && current.id == admission.roundId,
            "portal window closed or changed"
        );
        require(cards.ownerOf(admission.tokenId) == submitter, "card owner only");
        require(pendingRequest[admission.tokenId] == 0, "card has pending job");
        require(matches(admission.portalId, admission.tokenId), "card does not match gates");
        require(admission.rubricId == activeRubric && _rubrics[activeRubric].configured, "rubric changed");
        require(
            admission.spellCommitment != bytes32(0) && admission.nonce == nonces[submitter],
            "invalid spell or nonce"
        );
        (Asset memory input, uint64 version) = inputArtwork(admission.tokenId);
        require(version == admission.artVersion && input.hash == admission.inputHash, "artwork changed");
        uint256 kindId = registry.collection().tokenKind(admission.portalId);
        PaymentPolicy memory payment = paymentPolicies[kindId];
        require(payment.version != 0 && payment.version == admission.paymentVersion, "price policy changed");
        uint256 competitionFee = address(competition) == address(0) ? 0 : competition.CONTRIBUTION();
        require(
            uint256(payment.aiFee) + payment.portalFee + competitionFee <= admission.maximumFee,
            "fee exceeds quote"
        );
        id = ++requestCount;
        nonces[submitter]++;
        pendingRequest[admission.tokenId] = id;
        Request storage request = _requests[id];
        request.tokenId = admission.tokenId;
        request.portalId = admission.portalId;
        request.kindId = kindId;
        request.submitter = submitter;
        request.roundId = current.id;
        request.acceptedAt = uint64(block.timestamp);
        request.acceptedBlock = uint64(block.number);
        request.artVersion = version;
        request.spellCommitment = admission.spellCommitment;
        request.rubricId = activeRubric;
        request.input = input;
        request.payment = payment;
        request.nonce = admission.nonce;
        if (competitionFee != 0) {
            uint256 beforeCompetition = usdc.balanceOf(address(competition));
            usdc.safeTransferFrom(submitter, address(competition), competitionFee);
            require(
                usdc.balanceOf(address(competition)) == beforeCompetition + competitionFee,
                CompetitionDeposit()
            );
            competitionCommitments[id] = competition.registerEntry(id, submitter, activeRubric);
        }
        if (payment.aiFee != 0) usdc.safeTransferFrom(submitter, payment.aiRecipient, payment.aiFee);
        if (payment.portalFee != 0) {
            uint256 beforeBalance = usdc.balanceOf(address(this));
            usdc.safeTransferFrom(submitter, address(this), payment.portalFee);
            require(
                usdc.balanceOf(address(this)) == beforeBalance + payment.portalFee, "incorrect portal deposit"
            );
        }
        portalBalances[admission.portalId] += payment.portalFee;
        totalPortalLiability += payment.portalFee;
        emit PortalFeeAccrued(id, admission.portalId, payment.portalFee, portalBalances[admission.portalId]);
        emit PaymentAllocated(
            id, payment.aiRecipient, payment.portalRecipient, payment.aiFee, payment.portalFee
        );
        emit GradingRequested(
            id,
            admission.tokenId,
            admission.portalId,
            submitter,
            current.id,
            version,
            admission.spellCommitment,
            activeRubric
        );
    }

    function complete(uint256 id, Result calldata result) external onlyRole(GRADER_ROLE) nonReentrant {
        Request storage request = _requests[id];
        require(
            request.acceptedAt != 0 && !request.completed && pendingRequest[request.tokenId] == id,
            "request not pending"
        );
        require(artVersion[request.tokenId] == request.artVersion, "input version mismatch");
        Rubric storage policy = _rubrics[request.rubricId];
        require(result.requestBinding == this.requestBinding(id), "request binding mismatch");
        require(result.modelsHash == policy.modelPolicy, "model policy mismatch");
        require(result.reportHash != bytes32(0), "missing report hash");
        _validateURI(result.reportURI);
        _validateURI(result.spellURI);
        _validateAsset(result.artwork);
        for (uint256 i; i < 4; ++i) {
            require(result.scores[i] >= 1 && result.scores[i] <= 100, "invalid score");
        }
        require(result.baseCreativity >= 1 && result.baseCreativity <= 100, "invalid base creativity");
        uint8 creativity = result.baseCreativity;
        if (result.copied) {
            require(result.evidenceHash != bytes32(0), "missing copying evidence");
            if (creativity > policy.copyCap) creativity = policy.copyCap;
        }
        require(result.scores[0] == creativity, "originality cap mismatch");
        _results[id] = result;
        _results[id].completedAt = uint64(block.timestamp);
        completedBy[id] = msg.sender;
        request.completed = true;
        pendingRequest[request.tokenId] = 0;
        uint64 version = ++artVersion[request.tokenId];
        _history[request.tokenId].push(id);
        cards.notifyGradingUpdate(request.tokenId);
        emit GradingCompleted(
            id,
            request.tokenId,
            msg.sender,
            version,
            result.artwork.hash,
            result.scores,
            result.copied,
            result.reportHash
        );
        if (competitionCommitments[id] != bytes32(0)) {
            // Prevent eth_estimateGas from choosing a cheaper path that starves the recoverable hook.
            if (gasleft() < 450_000) revert CompetitionNotificationGas();
            // A missed notification can be recovered permissionlessly and must not hold up this card's grade.
            try competition.recordCompleted{gas: 400_000}(id) {}
            catch {
                emit CompetitionNotificationDeferred(id);
            }
        }
    }

    function metadataURI(uint256 tokenId) external view returns (string memory) {
        return
            artVersion[tokenId] == 0 ? "" : string.concat(metadataBaseURI, Strings.toString(tokenId), ".json");
    }

    function _validateAsset(Asset memory asset) private pure {
        require(asset.hash != bytes32(0), "missing asset hash");
        _validateURI(asset.uri);
    }

    function _validateURI(string memory value) private pure {
        bytes memory uri = bytes(value);
        require(uri.length >= 8 && uri.length <= 1024, "invalid URI length");
        bool https = uri.length > 8 && bytes8(uri) == bytes8("https://");
        bool ipfs = bytes7(uri) == bytes7("ipfs://");
        require(https || ipfs, "URI scheme");
        for (uint256 i; i < uri.length; ++i) {
            require(
                uint8(uri[i]) > 32 && uint8(uri[i]) < 127 && uri[i] != '"' && uri[i] != "\\", "URI character"
            );
        }
    }
}
