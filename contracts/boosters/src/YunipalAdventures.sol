// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PortalRandomness} from "./PortalRandomness.sol";
import {PortalRules} from "./PortalRules.sol";
import {SerumCatalogue} from "./SerumCatalogue.sol";
import {YunipalMonsters} from "./YunipalMonsters.sol";
import {PortalGates} from "./PortalGates.sol";
import {CrewSerumDraw} from "./CrewSerumDraw.sol";
import {PackRegistry} from "./PackRegistry.sol";

interface IAdventurePack {
    function packTypeId() external view returns (uint256);
}

contract YunipalAdventures is PortalRandomness {
    struct Adventure {
        uint256 tokenId;
        address requester;
        uint64 requestedAt;
        uint16 sequence;
        bool settled;
        SerumCatalogue.Dose found;
    }

    YunipalMonsters public cards;
    SerumCatalogue public catalogue;
    mapping(uint256 => Adventure) private _adventures;
    mapping(uint256 => uint256) public pendingRequest;
    mapping(uint256 => uint64) public nextAdventureAt;
    mapping(uint256 => SerumCatalogue.Dose) private _unused;

    struct DailyCrew {
        uint256 requestId;
        uint32 color;
        uint32 monsterType;
        bool ready;
    }
    bool public crewMode;
    mapping(uint64 => DailyCrew) public dailyCrew;
    mapping(uint256 => uint64) private _dailyRequestDayPlusOne;
    mapping(uint256 => uint256[3]) public adventureCrew;

    event CrewAdventuresEnabled();
    event DailyCrewRequested(uint64 indexed day, uint256 indexed requestId);
    event DailyCrewReady(uint64 indexed day, uint256 indexed requestId, uint32 color, uint32 monsterType);
    event CrewCommitted(uint256 indexed requestId, uint64 indexed day, uint256[3] crew, uint256 survivor);

    event AdventureRequested(
        uint256 indexed requestId,
        uint256 indexed tokenId,
        address indexed requester,
        uint16 sequence,
        uint8 tier,
        uint64 nextAdventureAt,
        uint32 catalogueVersion,
        bytes32 rulesHash
    );
    event AdventureSettled(
        uint256 indexed requestId, uint256 indexed tokenId, uint32 catalogueVersion, uint8 serumId, uint8 presenceId
    );
    event AdventureSettlementDeferred(uint256 indexed requestId);
    event SerumCleared(uint256 indexed tokenId);
    event AdventureStateInherited(uint256 indexed tokenId, uint256 parentA, uint256 parentB, uint64 nextAdventureAt);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        YunipalMonsters cards_,
        SerumCatalogue catalogue_,
        IVRFV2PlusWrapper wrapper_,
        uint16 confirmations_,
        PortalRules rules_
    ) external initializer {
        require(address(cards_).code.length != 0 && address(catalogue_).code.length != 0, "invalid dependencies");
        __PortalRandomness_init(admin, wrapper_, confirmations_, rules_);
        cards = cards_;
        catalogue = catalogue_;
    }

    function CALLBACK_GAS() public pure override returns (uint32) {
        return 900_000;
    }

    /// @notice One-way upgrade. Previously accepted solo adventures still settle under their original rules.
    function enableCrewAdventures() external onlyRole(CONFIG_ROLE) {
        require(!crewMode, "crew mode already enabled");
        require(catalogue.VERSION() == 1 && catalogue.RULES_HASH()
            == keccak256("YunipalsSerumsV1:11x11:11tiers24:holy10000:ordered11"), "unsupported catalogue");
        crewMode = true;
        emit CrewAdventuresEnabled();
    }

    function crewRulesHash() public view returns (bytes32) {
        return keccak256(abi.encode(catalogue.RULES_HASH(), "crew-v1:three-distinct:utc-birth:guaranteed"));
    }

    /// @notice One shared, immutable VRF draw for each UTC date. Tomorrow can be prepared in advance.
    function prepareDailyCrew(uint64 day, uint256 maxVrfPrice) external payable nonReentrant returns (uint256 id) {
        require(crewMode, "crew mode unavailable");
        uint256 today = block.timestamp / 1 days;
        require(day >= today && day <= today + 1 && dailyCrew[day].requestId == 0, "day unavailable");
        uint256 paid;
        (id, paid) = _requestRandomness(maxVrfPrice);
        dailyCrew[day].requestId = id;
        _dailyRequestDayPlusOne[id] = day + 1;
        emit DailyCrewRequested(day, id);
        _refundExcess(paid);
    }

    function crewAdventure(uint256[3] calldata crew, uint256 survivor, uint64 day,
        bytes32 expectedRulesHash, uint256 maxVrfPrice, uint64 deadline)
        external payable nonReentrant returns (uint256 id)
    {
        require(crewMode && cards.adventureController() == address(this), "crew mode unavailable");
        require(block.timestamp <= deadline && day == block.timestamp / 1 days
            && expectedRulesHash == crewRulesHash(), "quote expired or changed");
        DailyCrew memory requirements = dailyCrew[day];
        require(requirements.ready, "daily crew not ready");
        require(crew[0] != crew[1] && crew[0] != crew[2] && crew[1] != crew[2], "three distinct cards required");
        require(survivor == crew[0] || survivor == crew[1] || survivor == crew[2], "survivor not in crew");
        bool newborn;
        uint256 packId = IAdventurePack(cards.gradingRegistry()).packTypeId();
        for (uint8 i; i < 3; ++i) {
            uint256 token = crew[i];
            require(cards.ownerOf(token) == msg.sender, "owner only");
            cards.assertNoPendingClaim(token);
            require(block.timestamp >= nextAdventureAt[token] && pendingRequest[token] == 0, "adventure unavailable");
            (uint256[4] memory sources, uint8 count) = cards.sourceCards(token);
            bool matches;
            for (uint8 j; j < count; ++j) {
                (uint256 sourcePackId,,, PackRegistry.Traits memory traits,) = cards.provenance(sources[j]);
                require(cards.registry().compatiblePack(sourcePackId, packId), "unsupported TCG card");
                if ((i == 0 && traits.color == requirements.color) || (i == 1 && traits.horn == 2)
                    || (i == 2 && traits.monsterType == requirements.monsterType)) matches = true;
            }
            require(matches, "crew slot does not match");
            // Only an actual base-card birth counts; fusion cannot manufacture a fresh daily entry.
            (, uint64 mintedAt, bool initialized) = cards.cardFacts(token);
            if (count == 1 && initialized && mintedAt / 1 days == day) newborn = true;
            cards.reserveCard(token, true);
            nextAdventureAt[token] = uint64(block.timestamp + 1 days);
        }
        require(newborn, "one crew member must be born today");
        uint16 sequence = cards.effectiveSequence(survivor);
        uint256 paid;
        (id, paid) = _requestRandomness(maxVrfPrice);
        _adventures[id] = Adventure(survivor, msg.sender, uint64(block.timestamp), sequence, false,
            SerumCatalogue.Dose(0, 0, 0));
        adventureCrew[id] = crew;
        for (uint8 i; i < 3; ++i) pendingRequest[crew[i]] = id;
        emit AdventureRequested(id, survivor, msg.sender, sequence, uint8(sequence / 24 + 1),
            nextAdventureAt[survivor], catalogue.VERSION(), expectedRulesHash);
        emit CrewCommitted(id, day, crew, survivor);
        _refundExcess(paid);
    }

    function getAdventure(uint256 id) external view returns (Adventure memory) {
        return _adventures[id];
    }

    function unusedSerum(uint256 tokenId) external view returns (SerumCatalogue.Dose memory) {
        return _unused[tokenId];
    }

    function adventure(uint256 tokenId, bytes32 expectedRulesHash, uint256 maxVrfPrice, uint64 deadline)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        require(!crewMode, "three-card crew required");
        require(cards.adventureController() == address(this), "controller unbound");
        require(block.timestamp <= deadline && expectedRulesHash == catalogue.RULES_HASH(), "quote expired or changed");
        require(cards.ownerOf(tokenId) == msg.sender, "owner only");
        require(block.timestamp >= nextAdventureAt[tokenId] && pendingRequest[tokenId] == 0, "adventure unavailable");
        (uint256[4] memory sources, uint8 count) = cards.sourceCards(tokenId);
        uint256 packId = IAdventurePack(cards.gradingRegistry()).packTypeId();
        for (uint8 i; i < count; ++i) {
            (uint256 sourcePackId,,,,) = cards.provenance(sources[i]);
            require(sourcePackId == packId, "unsupported TCG card");
        }
        uint16 sequence = cards.effectiveSequence(tokenId);
        cards.reserveCard(tokenId, false);
        nextAdventureAt[tokenId] = uint64(block.timestamp + 1 days);
        uint256 paid;
        (id, paid) = _requestRandomness(maxVrfPrice);
        _adventures[id] =
            Adventure(tokenId, msg.sender, uint64(block.timestamp), sequence, false, SerumCatalogue.Dose(0, 0, 0));
        pendingRequest[tokenId] = id;
        emit AdventureRequested(
            id,
            tokenId,
            msg.sender,
            sequence,
            uint8(sequence / 24 + 1),
            nextAdventureAt[tokenId],
            catalogue.VERSION(),
            catalogue.RULES_HASH()
        );
        _refundExcess(paid);
    }

    function _afterRandomness(uint256 id) internal override {
        // Entropy survives a failed settlement; anyone can settle that same proof later.
        try this.executeSettlement{gas: 750_000}(id) {}
        catch {
            emit AdventureSettlementDeferred(id);
        }
    }

    function executeSettlement(uint256 id) external {
        require(msg.sender == address(this), "self only");
        _settle(id);
    }

    function settle(uint256 id) external nonReentrant {
        _settle(id);
    }

    function _settle(uint256 id) private {
        if (_dailyRequestDayPlusOne[id] != 0) {
            require(randomRequests[id].received, "randomness unavailable");
            uint64 day = _dailyRequestDayPlusOne[id] - 1;
            DailyCrew storage rule = dailyCrew[day];
            if (rule.ready) return;
            bytes32 seed = keccak256(abi.encode(block.chainid, address(this), day, randomRequests[id].seed));
            rule.color = uint32(PortalGates.uniform(keccak256(abi.encode(seed, "color")), 6) + 1);
            rule.monsterType = uint32(PortalGates.uniform(keccak256(abi.encode(seed, "type")), 11) + 1);
            rule.ready = true;
            emit DailyCrewReady(day, id, rule.color, rule.monsterType);
            return;
        }
        Adventure storage request = _adventures[id];
        require(randomRequests[id].received && request.requestedAt != 0, "randomness unavailable");
        if (request.settled) return;
        bytes32 entropy = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                id,
                request.tokenId,
                request.sequence,
                catalogue.RULES_HASH(),
                randomRequests[id].seed
            )
        );
        uint256[3] memory crew = adventureCrew[id];
        bool isCrew = crew[0] != 0;
        SerumCatalogue.Dose memory found = isCrew
            ? CrewSerumDraw.draw(catalogue, entropy, request.sequence)
            : catalogue.draw(entropy, request.sequence);
        request.found = found;
        request.settled = true;
        if (found.serumId != 0) _unused[request.tokenId] = found;
        if (isCrew) {
            for (uint8 i; i < 3; ++i) {
                delete pendingRequest[crew[i]];
                if (crew[i] != request.tokenId) {
                    delete _unused[crew[i]];
                    emit SerumCleared(crew[i]);
                    cards.sacrificeAdventureCompanion(crew[i]);
                } else {
                    cards.releaseCard(crew[i]);
                }
            }
        } else {
            delete pendingRequest[request.tokenId];
            cards.releaseCard(request.tokenId);
        }
        emit AdventureSettled(id, request.tokenId, found.catalogueVersion, found.serumId, found.presenceId);
    }

    function clearSerum(uint256 tokenId) external {
        require(msg.sender == cards.evolutionController(), "evolution only");
        delete _unused[tokenId];
        emit SerumCleared(tokenId);
    }

    function inheritState(uint256 tokenId, uint256 a, uint256 b) external {
        require(msg.sender == cards.evolutionController(), "evolution only");
        nextAdventureAt[tokenId] = nextAdventureAt[a] > nextAdventureAt[b] ? nextAdventureAt[a] : nextAdventureAt[b];
        delete _unused[a];
        delete _unused[b];
        emit SerumCleared(a);
        emit SerumCleared(b);
        emit AdventureStateInherited(tokenId, a, b, nextAdventureAt[tokenId]);
    }
}
