// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {PortalRandomness} from "./PortalRandomness.sol";
import {PortalRules} from "./PortalRules.sol";
import {SerumCatalogue} from "./SerumCatalogue.sol";
import {YunipalMonsters} from "./YunipalMonsters.sol";

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
        return 500_000;
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
        try this.executeSettlement{gas: 350_000}(id) {}
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
        SerumCatalogue.Dose memory found = catalogue.draw(entropy, request.sequence);
        request.found = found;
        request.settled = true;
        if (found.serumId != 0) _unused[request.tokenId] = found;
        delete pendingRequest[request.tokenId];
        cards.releaseCard(request.tokenId);
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
