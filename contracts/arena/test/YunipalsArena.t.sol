// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {YunipalsArena} from "../src/YunipalsArena.sol";

interface IConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory words) external;
}

contract MockWrapper {
    uint256 public price = 0.00001 ether;
    uint256 public nextId = 100;
    mapping(uint256 => address) public consumers;

    function link() external pure returns (address) {
        return address(0x123);
    }

    function calculateRequestPriceNative(uint32, uint32) external view returns (uint256) {
        return price;
    }

    function setPrice(uint256 value) external {
        price = value;
    }

    function requestRandomWordsInNative(uint32 gasLimit, uint16 confirmations, uint32 words, bytes calldata)
        external
        payable
        returns (uint256 id)
    {
        require(msg.value == price && gasLimit == 120_000 && confirmations == 10 && words == 1);
        id = nextId++;
        consumers[id] = msg.sender;
    }

    function fulfill(uint256 id, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        IConsumer(consumers[id]).rawFulfillRandomWords(id, words);
    }
}

contract MockNft {
    mapping(uint256 => address) public ownerOf;

    function setOwner(uint256 id, address holder) external {
        ownerOf[id] = holder;
    }
}

contract MockCurrency is ERC20 {
    bool public chargeFee;
    constructor() ERC20("Test USD", "TUSD") {}

    function mint(address holder, uint256 amount) external {
        _mint(holder, amount);
    }

    function setFee(bool value) external {
        chargeFee = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (chargeFee && from != address(0) && to != address(0) && value > 1) {
            super._update(from, address(0), 1);
            super._update(from, to, value - 1);
        } else {
            super._update(from, to, value);
        }
    }
}

contract RejectNative {
    receive() external payable {
        revert();
    }
}

contract MockSmartWallet {
    address immutable signer;

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(digest, signature) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
    receive() external payable {}
}

contract ReenteringRecipient {
    YunipalsArena immutable arena;
    bool public reentrySucceeded;

    constructor(YunipalsArena arena_) {
        arena = arena_;
    }

    receive() external payable {
        try arena.claim(payable(address(this))) {
            reentrySucceeded = true;
        } catch {}
    }
}

contract YunipalsArenaTest is Test {
    YunipalsArena arena;
    MockWrapper wrapper;
    MockNft islands;
    address host = address(0xA11);
    address treasury = address(0xB22);
    uint256 signerKey = 0xA11CE;
    uint256[4] playerKeys = [uint256(101), 102, 103, 104];
    uint128 constant FEE = 0.001 ether; // Test fixture, NOT agreed mainnet economics.

    function setUp() public {
        vm.chainId(8453);
        vm.warp(1_000_000);
        vm.deal(address(this), 100 ether);
        wrapper = new MockWrapper();
        islands = new MockNft();
        arena = new YunipalsArena(config(address(0), FEE));
        vm.deal(address(arena), 1 ether);
        arena.setEntriesPaused(false);
        for (uint256 i; i < 4; ++i) {
            vm.deal(vm.addr(playerKeys[i]), 1 ether);
        }
        for (uint256 i = 1; i <= 1373; ++i) {
            islands.setOwner(i, host);
        }
    }

    function config(address token, uint128 fee) internal view returns (YunipalsArena.Config memory) {
        return YunipalsArena.Config({
            admin: address(this),
            lobbyOperator: address(0x0B0B),
            admissionSigner: vm.addr(signerKey),
            referee: address(this),
            treasury: treasury,
            islands: address(islands),
            vrfWrapper: address(wrapper),
            paymentToken: token,
            entryFee: fee,
            winnerBps: 5000,
            islandBps: 1000,
            joinWindow: 7 days,
            strategyWindow: 1 days,
            resolutionWindow: 1 days,
            maxVrfCost: 0.0001 ether,
            rulesHash: keccak256("test-rules-only")
        });
    }

    function sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function entrant(uint256 i) internal view returns (YunipalsArena.Entry memory) {
        return YunipalsArena.Entry(vm.addr(playerKeys[i]), 1, arena.OTHER_YUNIPALS(), 1000000000 + i);
    }

    function joinSeat(uint256 id, uint256 i) internal {
        _joinSeat(id, i, bytes4(0));
    }

    function _joinSeat(uint256 id, uint256 i, bytes4 expected) internal {
        YunipalsArena.Entry memory e = entrant(i);
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sig(signerKey, arena.entryDigest(id, e, expiry));
        uint256 value = arena.paymentToken() == address(0) ? arena.entryFee() : 0;
        if (expected != bytes4(0)) vm.expectRevert(expected);
        vm.prank(e.player);
        arena.join{value: value}(id, e, expiry, permit);
    }

    function fourSeats(bool fulfill) internal returns (uint256 id) {
        id = arena.openTournament();
        for (uint256 i; i < 4; ++i) {
            joinSeat(id, i);
        }
        if (fulfill) {
            wrapper.fulfill(arena.tournament(id).requestId, 777);
            arena.finalizeIsland(id);
        }
    }

    function signedStrategies(uint256 id)
        internal
        view
        returns (bytes32[4] memory commitments, bytes[4] memory signatures)
    {
        for (uint8 i; i < 4; ++i) {
            commitments[i] = keccak256(abi.encode("strategy with private salt", id, i));
            signatures[i] = sig(playerKeys[i], arena.strategyDigest(id, i, commitments[i]));
        }
    }

    function freeze(uint256 id) internal {
        _freeze(id, bytes4(0));
    }

    function _freeze(uint256 id, bytes4 expected) internal {
        (bytes32[4] memory c, bytes[4] memory s) = signedStrategies(id);
        if (expected != bytes4(0)) vm.expectRevert(expected);
        arena.freezeInput(id, keccak256("frozen input"), c, s);
    }

    function testStartsPausedAndOnlyOwnerOpens() public {
        YunipalsArena fresh = new YunipalsArena(config(address(0), FEE));
        assertTrue(fresh.entriesPaused());
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        fresh.openTournament();
        fresh.setEntriesPaused(false);
        vm.prank(address(999));
        vm.expectRevert();
        fresh.openTournament();
    }

    function testPublishedPoolHasExactlyThreeOrOneTickets() public view {
        uint256[1374] memory counts;
        for (uint256 i; i < 1948; ++i) {
            counts[arena.islandForTicket(i)]++;
        }
        uint256 genesis;
        uint256 personal;
        for (uint256 i = 1; i <= 1373; ++i) {
            if (counts[i] > 0 && i <= 1000) {
                assertEq(counts[i], 3);
                ++genesis;
            } else if (counts[i] > 0) {
                assertEq(counts[i], 1);
                ++personal;
            }
        }
        assertEq(genesis, 525);
        assertEq(personal, 373);
        assertEq(arena.poolHash(), hex"9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c");
    }

    function testFuzzTicketIsBoundedAndReproducible(uint256 id, uint256 word) public view {
        uint16 ticket = arena.drawTicket(id, word);
        assertLt(ticket, 1948);
        assertEq(ticket, arena.drawTicket(id, word));
    }

    function testFirstJoinMakesExactlyOneRequestAndFourPlayersWaitForIsland() public {
        uint256 id = fourSeats(false);
        assertEq(wrapper.nextId(), 101);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Open));
        _freeze(id, YunipalsArena.InvalidState.selector);
        wrapper.fulfill(100, 0); // Zero is a valid VRF result, never a sentinel.
        arena.finalizeIsland(id);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Strategies));
        assertEq(arena.tournament(id).islandBeneficiary, host);
        assertEq(wrapper.nextId(), 101);
    }

    function testIslandBeforeFourthSeatDoesNotOpenStrategies() public {
        uint256 id = arena.openTournament();
        joinSeat(id, 0);
        wrapper.fulfill(100, 17);
        arena.finalizeIsland(id);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Open));
        for (uint256 i = 1; i < 4; ++i) {
            joinSeat(id, i);
        }
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Strategies));
    }

    function testOutOfOrderAndDuplicateCallbacksCannotReroll() public {
        uint256 a = arena.openTournament();
        joinSeat(a, 0);
        uint256 b = arena.openTournament();
        joinSeat(b, 1);
        wrapper.fulfill(101, 22);
        wrapper.fulfill(100, 11);
        wrapper.fulfill(100, 99);
        assertEq(arena.tournament(a).randomWord, 11);
        assertEq(arena.tournament(b).randomWord, 22);
        arena.finalizeIsland(a);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.finalizeIsland(a);
    }

    function testUnauthorizedCallbackFails() public {
        uint256[] memory words = new uint256[](1);
        vm.expectRevert();
        arena.rawFulfillRandomWords(100, words);
    }

    function testDuplicateNftAcrossTournamentsRejected() public {
        uint256 a = arena.openTournament();
        joinSeat(a, 0);
        uint256 b = arena.openTournament();
        _joinSeat(b, 0, YunipalsArena.InvalidEntry.selector);
    }

    function testStolenPermitAndDifferentTournamentRejected() public {
        uint256 id = arena.openTournament();
        YunipalsArena.Entry memory e = entrant(0);
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sig(signerKey, arena.entryDigest(id, e, expiry));
        vm.expectRevert(YunipalsArena.InvalidEntry.selector);
        arena.join{value: FEE}(id, e, expiry, permit);
        uint256 other = arena.openTournament();
        vm.prank(e.player);
        vm.expectRevert(YunipalsArena.InvalidSignature.selector);
        arena.join{value: FEE}(other, e, expiry, permit);
    }

    function testSignatureBoundToDeploymentAndChain() public {
        uint256 id = arena.openTournament();
        YunipalsArena.Entry memory e = entrant(0);
        bytes32 digest = arena.entryDigest(id, e, block.timestamp + 300);
        YunipalsArena other = new YunipalsArena(config(address(0), FEE));
        assertNotEq(digest, other.entryDigest(id, e, block.timestamp + 300));
        vm.chainId(1);
        assertNotEq(digest, arena.entryDigest(id, e, block.timestamp + 300));
    }

    function testBaseOwnershipCheckedEvenWithValidServerPermit() public {
        MockNft nft = new MockNft();
        vm.etch(arena.BASE_YUNIPALS(), address(nft).code);
        YunipalsArena.Entry memory e = entrant(0);
        e.nftChainId = 8453;
        e.collection = arena.BASE_YUNIPALS();
        uint256 id = arena.openTournament();
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sig(signerKey, arena.entryDigest(id, e, expiry));
        vm.prank(e.player);
        vm.expectRevert(YunipalsArena.InvalidEntry.selector);
        arena.join{value: FEE}(id, e, expiry, permit);
        MockNft(e.collection).setOwner(e.tokenId, e.player);
        vm.prank(e.player);
        arena.join{value: FEE}(id, e, expiry, permit);
        assertEq(arena.tournament(id).count, 1);
    }

    function testEntryFundsCannotPayVrfOrBeWithdrawnByAdmin() public {
        vm.deal(address(arena), 0);
        uint256 id = arena.openTournament();
        _joinSeat(id, 0, YunipalsArena.InsufficientVrfFunding.selector);
        assertEq(arena.paymentLiability(), 0);
        assertEq(arena.tournament(id).count, 0);
        vm.deal(address(arena), wrapper.price());
        joinSeat(id, 0);
        assertEq(arena.availableVrfFunds(), 0);
        vm.expectRevert(YunipalsArena.InsufficientVrfFunding.selector);
        arena.withdrawVrfFunds(payable(address(this)), 1);
    }

    function testVrfPriceCapAndPaymentAtomicity() public {
        wrapper.setPrice(1 ether);
        uint256 id = arena.openTournament();
        uint256 beforeBalance = vm.addr(playerKeys[0]).balance;
        _joinSeat(id, 0, YunipalsArena.InsufficientVrfFunding.selector);
        assertEq(vm.addr(playerKeys[0]).balance, beforeBalance);
        assertEq(arena.activeNftTournament(arena.nftKey(entrant(0))), 0);
    }

    function testNoEarlyRefundAndNoEntryAfterDeadline() public {
        uint256 id = arena.openTournament();
        joinSeat(id, 0);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.expire(id);
        vm.warp(arena.tournament(id).deadline);
        _joinSeat(id, 1, YunipalsArena.DeadlinePassed.selector);
        arena.expire(id);
        assertEq(arena.claimable(vm.addr(playerKeys[0])), FEE);
        assertEq(arena.activeNftTournament(arena.nftKey(entrant(0))), 0);
        wrapper.fulfill(100, 42);
        arena.finalizeIsland(id);
        assertEq(arena.tournament(id).randomWord, 42);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Expired));
        assertEq(wrapper.nextId(), 101);
    }

    function testEmptyLobbyWaitsUntilFirstPaymentThenAllowsFullSevenDays() public {
        uint256 id = arena.openTournament();
        assertEq(arena.tournament(id).deadline, 0);
        vm.warp(vm.getBlockTimestamp() + 30 days);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.expire(id);
        assertEq(wrapper.nextId(), 100);

        uint256 enteredAt = vm.getBlockTimestamp();
        joinSeat(id, 0);
        uint64 deadline = arena.tournament(id).deadline;
        assertEq(deadline, enteredAt + 7 days);
        vm.warp(uint256(deadline) - 1);
        joinSeat(id, 1);
        assertEq(arena.tournament(id).deadline, deadline);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.expire(id);

        vm.warp(deadline);
        _joinSeat(id, 2, YunipalsArena.DeadlinePassed.selector);
        arena.expire(id);
        assertEq(arena.claimable(vm.addr(playerKeys[0])), FEE);
        assertEq(arena.claimable(vm.addr(playerKeys[1])), FEE);
        assertEq(arena.activeNftTournament(arena.nftKey(entrant(0))), 0);
        assertEq(arena.activeNftTournament(arena.nftKey(entrant(1))), 0);
    }

    function testRevertedFirstPaymentDoesNotStartJoiningClock() public {
        uint256 id = arena.openTournament();
        vm.deal(address(arena), 0);
        _joinSeat(id, 0, YunipalsArena.InsufficientVrfFunding.selector);
        assertEq(arena.tournament(id).deadline, 0);
        assertEq(arena.tournament(id).count, 0);
        assertEq(arena.paymentLiability(), 0);

        vm.warp(vm.getBlockTimestamp() + 2 days);
        vm.deal(address(arena), 1 ether);
        joinSeat(id, 0);
        assertEq(arena.tournament(id).deadline, vm.getBlockTimestamp() + 7 days);
    }

    function testFullRosterAndIslandImmediatelyStartTwentyFourHourStrategyClock() public {
        uint256 id = arena.openTournament();
        joinSeat(id, 0);
        wrapper.fulfill(arena.tournament(id).requestId, 777);
        arena.finalizeIsland(id);
        uint64 joiningDeadline = arena.tournament(id).deadline;
        vm.warp(vm.getBlockTimestamp() + 2 days);
        joinSeat(id, 1);
        joinSeat(id, 2);
        assertEq(arena.tournament(id).deadline, joiningDeadline);

        joinSeat(id, 3);
        uint64 strategyDeadline = arena.tournament(id).deadline;
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Strategies));
        assertEq(strategyDeadline, vm.getBlockTimestamp() + 24 hours);
        assertLt(strategyDeadline, joiningDeadline);
        vm.warp(uint256(strategyDeadline) - 1);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.expire(id);
        vm.warp(strategyDeadline);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.expire(id);
        vm.warp(uint256(strategyDeadline) + arena.resolutionWindow());
        _freeze(id, YunipalsArena.DeadlinePassed.selector);
        arena.expire(id);
        for (uint256 i; i < 4; ++i) {
            assertEq(arena.claimable(vm.addr(playerKeys[i])), FEE);
        }
    }

    function testStrategyClockWaitsForIslandWhenFourSeatsAreAlreadyFilled() public {
        uint256 id = fourSeats(false);
        uint64 joiningDeadline = arena.tournament(id).deadline;
        vm.warp(vm.getBlockTimestamp() + 6 days);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Open));
        assertEq(arena.tournament(id).deadline, joiningDeadline);
        wrapper.fulfill(arena.tournament(id).requestId, 777);
        arena.finalizeIsland(id);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Strategies));
        assertEq(arena.tournament(id).deadline, vm.getBlockTimestamp() + 24 hours);
    }

    function testDelayedFinalizationCannotReviveExpiredJoinWindow() public {
        uint256 id = fourSeats(false);
        vm.warp(arena.tournament(id).deadline);
        wrapper.fulfill(100, 99);
        arena.finalizeIsland(id);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Open));
        arena.expire(id);
        assertEq(arena.claimable(vm.addr(playerKeys[3])), FEE);
    }

    function testAllFourWalletApprovalsRequiredToFreeze() public {
        uint256 id = fourSeats(true);
        (bytes32[4] memory c, bytes[4] memory s) = signedStrategies(id);
        s[3] = s[0];
        vm.expectRevert(YunipalsArena.InvalidSignature.selector);
        arena.freezeInput(id, keccak256("input"), c, s);
        freeze(id);
        _freeze(id, YunipalsArena.InvalidState.selector);
    }

    function testCannotSettleBeforeInputOrWrongBracketOrTwice() public {
        uint256 id = fourSeats(true);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.settle(id, bytes32(uint256(1)), 0, 2, 0);
        freeze(id);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.settle(id, bytes32(uint256(1)), 0, 1, 0);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.settle(id, bytes32(uint256(1)), 0, 2, 3);
        vm.prank(address(999));
        vm.expectRevert(YunipalsArena.Unauthorized.selector);
        arena.settle(id, bytes32(uint256(1)), 0, 2, 0);
        arena.settle(id, bytes32(uint256(1)), 0, 2, 0);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.settle(id, bytes32(uint256(2)), 1, 3, 3);
    }

    function testFundsStayHeldUntilRefereeAttestsPublishedVideo() public {
        uint256 id = fourSeats(true);
        bytes32 film = keccak256("finished published film");
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.releasePayouts(id, film);
        freeze(id);
        arena.settle(id, keccak256("fixed result"), 0, 2, 0);
        address winner = vm.addr(playerKeys[0]);
        assertEq(arena.claimable(winner), 0);
        assertEq(arena.claimable(host), 0);
        assertEq(arena.claimable(treasury), 0);
        assertEq(arena.paymentLiability(), uint256(FEE) * 4);
        vm.prank(winner);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.claim(payable(winner));
        vm.prank(winner);
        vm.expectRevert(YunipalsArena.Unauthorized.selector);
        arena.releasePayouts(id, film);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.releasePayouts(id, bytes32(0));
        vm.warp(arena.tournament(id).deadline + 1 days);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.expire(id);
        arena.setEntriesPaused(true);
        vm.expectEmit(true, false, false, true);
        emit YunipalsArena.PayoutsReleased(id, film);
        arena.releasePayouts(id, film);
        assertEq(arena.publishedVideoHash(id), film);
        assertEq(arena.claimable(winner), uint256(FEE) * 2);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.releasePayouts(id, film);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.releasePayouts(id, keccak256("replacement"));
        assertEq(arena.claimable(winner), uint256(FEE) * 2);
    }

    function testPayoutConservationAndPullClaims() public {
        uint256 id = fourSeats(true);
        freeze(id);
        arena.settle(id, keccak256("result"), 1, 3, 3);
        arena.releasePayouts(id, keccak256("published film"));
        uint256 pot = uint256(FEE) * 4;
        address winner = vm.addr(playerKeys[3]);
        assertEq(arena.claimable(winner), pot / 2);
        assertEq(arena.claimable(host), pot / 10);
        assertEq(arena.claimable(treasury), pot * 4 / 10);
        assertEq(arena.paymentLiability(), pot);
        vm.prank(winner);
        arena.claim(payable(winner));
        vm.prank(host);
        arena.claim(payable(host));
        vm.prank(treasury);
        arena.claim(payable(treasury));
        assertEq(arena.paymentLiability(), 0);
        vm.prank(winner);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.claim(payable(winner));
    }

    function testTreasurySetterRequiresOwnerAndValidRecipient() public {
        address nextTreasury = address(0xC33);
        vm.prank(nextTreasury);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nextTreasury));
        arena.setTreasury(nextTreasury);
        vm.expectRevert(YunipalsArena.InvalidConfig.selector);
        arena.setTreasury(address(0));
        vm.expectRevert(YunipalsArena.InvalidConfig.selector);
        arena.setTreasury(address(arena));
        vm.expectEmit(true, true, false, true);
        emit YunipalsArena.TreasuryChanged(treasury, nextTreasury);
        arena.setTreasury(nextTreasury);
        assertEq(arena.treasury(), nextTreasury);
    }

    function testLobbyOperatorCanOpenButCannotAdministerOrWithdraw() public {
        address operator = arena.lobbyOperator();
        vm.prank(operator);
        uint256 id = arena.openTournament();
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Open));
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", operator));
        arena.setTreasury(operator);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", operator));
        arena.withdrawVrfFunds(payable(operator), 1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", operator));
        arena.setEntriesPaused(true);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", operator));
        arena.setLobbyOperator(operator);
        vm.stopPrank();
        arena.setEntriesPaused(true);
        vm.prank(operator);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.openTournament();
    }

    function testLobbyOperatorRotationRevokesPreviousOperator() public {
        address previous = arena.lobbyOperator();
        address next = address(0xF00D);
        vm.expectRevert(YunipalsArena.InvalidConfig.selector);
        arena.setLobbyOperator(address(0));
        vm.expectEmit(true, true, false, true);
        emit YunipalsArena.LobbyOperatorChanged(previous, next);
        arena.setLobbyOperator(next);
        vm.prank(previous);
        vm.expectRevert(YunipalsArena.Unauthorized.selector);
        arena.openTournament();
        vm.prank(next);
        uint256 id = arena.openTournament();
        assertEq(id, 1);
    }

    function testTreasuryChangePreservesExistingUsdcPayouts() public {
        MockCurrency currency = new MockCurrency();
        YunipalsArena.Config memory c = config(address(currency), 2_000_000);
        c.winnerBps = 7500;
        c.islandBps = 500;
        arena = new YunipalsArena(c);
        arena.setEntriesPaused(false);
        vm.deal(address(arena), 1 ether);
        for (uint256 i; i < 4; ++i) {
            address player = vm.addr(playerKeys[i]);
            currency.mint(player, 4_000_000);
            vm.prank(player);
            currency.approve(address(arena), 4_000_000);
        }

        uint256 first = fourSeats(true);
        freeze(first);
        address nextTreasury = address(0xC33);
        arena.setTreasury(nextTreasury);
        arena.settle(first, keccak256("first result"), 0, 2, 0);
        arena.releasePayouts(first, keccak256("published film"));
        assertEq(arena.tournament(first).treasuryBeneficiary, treasury);
        assertEq(arena.claimable(treasury), 1_600_000);
        assertEq(arena.claimable(nextTreasury), 0);

        uint256 second = fourSeats(true);
        freeze(second);
        arena.settle(second, keccak256("second result"), 0, 2, 0);
        arena.releasePayouts(second, keccak256("published film"));
        assertEq(arena.tournament(second).treasuryBeneficiary, nextTreasury);
        assertEq(arena.claimable(nextTreasury), 1_600_000);
        address winner = vm.addr(playerKeys[0]);
        assertEq(arena.claimable(winner), 12_000_000);
        assertEq(arena.claimable(host), 800_000);
        assertEq(arena.paymentLiability(), 16_000_000);

        arena.setTreasury(address(0xD44));
        address[4] memory recipients = [winner, host, treasury, nextTreasury];
        uint256[4] memory expected = [uint256(12_000_000), 800_000, 1_600_000, 1_600_000];
        for (uint256 i; i < recipients.length; ++i) {
            vm.prank(recipients[i]);
            arena.claim(payable(recipients[i]));
            assertEq(currency.balanceOf(recipients[i]), expected[i]);
        }
        assertEq(arena.paymentLiability(), 0);
        assertEq(currency.balanceOf(address(arena)), 0);
        assertEq(arena.claimable(address(0xD44)), 0);
    }

    function testUnavailableIslandUsesTournamentTreasuryAfterChange() public {
        uint256 id = fourSeats(false);
        arena.setTreasury(address(0xC33));
        wrapper.fulfill(arena.tournament(id).requestId, 777);
        uint16 island = arena.islandForTicket(arena.drawTicket(id, 777));
        islands.setOwner(island, address(0));
        arena.finalizeIsland(id);
        assertEq(arena.tournament(id).islandBeneficiary, treasury);
        freeze(id);
        arena.settle(id, keccak256("result"), 0, 2, 0);
        arena.releasePayouts(id, keccak256("published film"));
        assertEq(arena.claimable(treasury), uint256(FEE) * 2);
        assertEq(arena.claimable(address(0xC33)), 0);
    }

    function testAdminTransferRequiresAcceptanceBeforeTreasuryControl() public {
        address nextAdmin = address(0xC33);
        arena.transferOwnership(nextAdmin);
        assertEq(arena.owner(), address(this));
        vm.prank(nextAdmin);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nextAdmin));
        arena.setTreasury(nextAdmin);
        vm.prank(nextAdmin);
        arena.acceptOwnership();
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        arena.setTreasury(nextAdmin);
        vm.prank(nextAdmin);
        arena.setTreasury(nextAdmin);
        assertEq(arena.owner(), nextAdmin);
        assertEq(arena.treasury(), nextAdmin);
    }

    function testRejectedClaimPreservesCreditAndCanRedirect() public {
        uint256 id = arena.openTournament();
        joinSeat(id, 0);
        vm.warp(arena.tournament(id).deadline);
        arena.expire(id);
        RejectNative reject = new RejectNative();
        address player = vm.addr(playerKeys[0]);
        vm.prank(player);
        vm.expectRevert(YunipalsArena.TransferFailed.selector);
        arena.claim(payable(address(reject)));
        assertEq(arena.claimable(player), FEE);
        vm.prank(player);
        arena.claim(payable(player));
        assertEq(arena.paymentLiability(), 0);
    }

    function testStalledInputTransitionAndRefereeTimeoutsRefundFullEntries() public {
        uint256 id = fourSeats(true);
        vm.warp(arena.tournament(id).deadline);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.expire(id);
        vm.warp(uint256(arena.tournament(id).deadline) + arena.resolutionWindow());
        _freeze(id, YunipalsArena.DeadlinePassed.selector);
        arena.expire(id);
        uint256 second = fourSeats(true);
        freeze(second);
        vm.warp(arena.tournament(second).deadline);
        vm.expectRevert(YunipalsArena.DeadlinePassed.selector);
        arena.settle(second, bytes32(uint256(1)), 0, 2, 0);
        arena.expire(second);
        for (uint256 i; i < 4; ++i) {
            assertEq(arena.claimable(vm.addr(playerKeys[i])), uint256(FEE) * 2);
        }
    }

    function automaticInput(uint256 id, uint8 mask)
        internal
        view
        returns (bytes32[4] memory c, bytes[4] memory s)
    {
        (c, s) = signedStrategies(id);
        for (uint8 seat; seat < 4; ++seat) {
            if ((mask & (uint8(1) << seat)) != 0) {
                c[seat] = arena.fallbackCommitment(id, seat);
                s[seat] = hex"";
            }
        }
    }

    function testAutomaticInputsRequireDeadlineRefereeAndExactCommitments() public {
        uint256 id = fourSeats(true);
        (bytes32[4] memory c, bytes[4] memory s) = automaticInput(id, 8);
        vm.expectRevert(YunipalsArena.InvalidState.selector);
        arena.freezeInputWithFallback(id, keccak256("input"), c, s, 8);
        vm.warp(arena.tournament(id).deadline);
        vm.prank(vm.addr(playerKeys[0]));
        vm.expectRevert(YunipalsArena.Unauthorized.selector);
        arena.freezeInputWithFallback(id, keccak256("input"), c, s, 8);
        c[3] = bytes32(uint256(123));
        vm.expectRevert(YunipalsArena.InvalidSignature.selector);
        arena.freezeInputWithFallback(id, keccak256("input"), c, s, 8);
        c[3] = arena.fallbackCommitment(id, 3);
        s[0] = hex"";
        vm.expectRevert(YunipalsArena.InvalidSignature.selector);
        arena.freezeInputWithFallback(id, keccak256("input"), c, s, 8);
    }

    function testFuzzMissingStrategyMasksContinueWithFullPot(uint8 rawMask) public {
        uint8 mask = uint8(bound(rawMask, 1, 15));
        uint256 id = fourSeats(true);
        (bytes32[4] memory c, bytes[4] memory s) = automaticInput(id, mask);
        vm.warp(arena.tournament(id).deadline);
        arena.freezeInputWithFallback(id, keccak256("input"), c, s, mask);
        assertEq(arena.automaticStrategyMask(id), mask);
        assertEq(arena.tournament(id).deadline, vm.getBlockTimestamp() + 24 hours);
        for (uint256 i; i < 4; ++i) {
            assertEq(arena.claimable(vm.addr(playerKeys[i])), 0);
        }
        assertEq(arena.paymentLiability(), uint256(FEE) * 4);
        arena.settle(id, keccak256("result"), 0, 2, 0);
        arena.releasePayouts(id, keccak256("film"));
        assertEq(arena.claimable(vm.addr(playerKeys[0])), uint256(FEE) * 2);
        assertEq(arena.claimable(host) + arena.claimable(treasury), uint256(FEE) * 2);
    }

    function testFallbackSeedIsStableAndBoundToTournamentAndSeat() public {
        uint256 id = fourSeats(true);
        bytes32 first = arena.fallbackCommitment(id, 0);
        assertEq(first, arena.fallbackCommitment(id, 0));
        assertTrue(first != arena.fallbackCommitment(id, 1));
        assertLt(arena.fallbackAttack(id, 0), 4);
        vm.warp(arena.tournament(id).deadline + 100);
        assertEq(first, arena.fallbackCommitment(id, 0));
    }

    function testLateFreezeKeepsValidPlayerSignaturesAndHasBoundedRecovery() public {
        uint256 id = fourSeats(true);
        vm.warp(arena.tournament(id).deadline + 10);
        freeze(id);
        assertEq(arena.automaticStrategyMask(id), 0);
        assertEq(uint8(arena.tournament(id).phase), uint8(YunipalsArena.Phase.Resolving));
        arena.settle(id, keccak256("result"), 0, 2, 0);
        uint256 second = fourSeats(true);
        (bytes32[4] memory c, bytes[4] memory s) = automaticInput(second, 15);
        vm.warp(uint256(arena.tournament(second).deadline) + arena.resolutionWindow());
        vm.expectRevert(YunipalsArena.DeadlinePassed.selector);
        arena.freezeInputWithFallback(second, keccak256("input"), c, s, 15);
        arena.expire(second);
    }

    function testPauseCannotBlockRefundsOrChangeExistingEconomics() public {
        uint256 id = arena.openTournament();
        joinSeat(id, 0);
        arena.setEntriesPaused(true);
        vm.warp(arena.tournament(id).deadline);
        arena.expire(id);
        address player = vm.addr(playerKeys[0]);
        vm.prank(player);
        arena.claim(payable(player));
    }

    function testHostSnapshotStaysFixedAndBurnDoesNotReroll() public {
        uint256 id = fourSeats(true);
        islands.setOwner(arena.tournament(id).islandId, address(0x999));
        freeze(id);
        arena.settle(id, bytes32(uint256(1)), 0, 2, 0);
        arena.releasePayouts(id, keccak256("published film"));
        assertEq(arena.claimable(host), uint256(FEE) * 4 / 10);
        uint256 next = fourSeats(false);
        wrapper.fulfill(arena.tournament(next).requestId, 777);
        uint16 token = arena.islandForTicket(arena.drawTicket(next, 777));
        islands.setOwner(token, address(0));
        arena.finalizeIsland(next);
        assertEq(arena.tournament(next).islandId, token);
        assertEq(arena.tournament(next).islandBeneficiary, treasury);
    }

    function testERC20EntrySettlementAndRefund() public {
        MockCurrency currency = new MockCurrency();
        arena = new YunipalsArena(config(address(currency), 1_000_000));
        arena.setEntriesPaused(false);
        vm.deal(address(arena), 1 ether);
        for (uint256 i; i < 4; ++i) {
            address holder = vm.addr(playerKeys[i]);
            currency.mint(holder, 2_000_000);
            vm.prank(holder);
            currency.approve(address(arena), 2_000_000);
        }
        uint256 id = fourSeats(true);
        freeze(id);
        arena.settle(id, bytes32(uint256(1)), 0, 2, 0);
        arena.releasePayouts(id, keccak256("published film"));
        address winner = vm.addr(playerKeys[0]);
        vm.prank(winner);
        arena.claim(payable(winner));
        assertEq(currency.balanceOf(winner), 3_000_000);
        uint256 next = arena.openTournament();
        joinSeat(next, 1);
        vm.warp(arena.tournament(next).deadline);
        arena.expire(next);
        address player = vm.addr(playerKeys[1]);
        vm.prank(player);
        arena.claim(payable(player));
        assertEq(currency.balanceOf(player), 1_000_000);
        assertEq(currency.balanceOf(address(arena)), arena.paymentLiability());
    }

    function testFeeOnTransferCurrencyRejectedWithoutTakingEntry() public {
        MockCurrency currency = new MockCurrency();
        currency.setFee(true);
        arena = new YunipalsArena(config(address(currency), 1_000_000));
        arena.setEntriesPaused(false);
        vm.deal(address(arena), 1 ether);
        address player = vm.addr(playerKeys[0]);
        currency.mint(player, 1_000_000);
        vm.prank(player);
        currency.approve(address(arena), 1_000_000);
        uint256 id = arena.openTournament();
        _joinSeat(id, 0, YunipalsArena.IncorrectPayment.selector);
        assertEq(currency.balanceOf(player), 1_000_000);
        assertEq(arena.paymentLiability(), 0);
    }

    function testFuzzPayoutRoundingNeverLosesFunds(uint128 rawFee, uint16 rawWinner, uint16 rawHost) public {
        uint128 fee = uint128(bound(rawFee, 1, 0.01 ether));
        uint16 winnerShare = uint16(bound(rawWinner, 0, 10_000));
        uint16 hostShare = uint16(bound(rawHost, 0, 10_000 - winnerShare));
        YunipalsArena.Config memory c = config(address(0), fee);
        c.winnerBps = winnerShare;
        c.islandBps = hostShare;
        arena = new YunipalsArena(c);
        arena.setEntriesPaused(false);
        vm.deal(address(arena), 1 ether);
        uint256 id = fourSeats(true);
        freeze(id);
        arena.settle(id, bytes32(uint256(1)), 0, 2, 0);
        arena.releasePayouts(id, keccak256("published film"));
        uint256 pot = uint256(fee) * 4;
        address winner = vm.addr(playerKeys[0]);
        assertEq(arena.claimable(winner) + arena.claimable(host) + arena.claimable(treasury), pot);
        assertEq(arena.paymentLiability(), pot);
        assertEq(arena.availableVrfFunds(), 1 ether - wrapper.price());
        for (uint256 i; i < 3; ++i) {
            address recipient = i == 0 ? winner : i == 1 ? host : treasury;
            if (arena.claimable(recipient) > 0) {
                vm.prank(recipient);
                arena.claim(payable(recipient));
            }
        }
        assertEq(arena.paymentLiability(), 0);
        assertEq(address(arena).balance, 1 ether - wrapper.price());
    }

    function testChangedOrExpiredPermitAndWrongPaymentRejected() public {
        uint256 id = arena.openTournament();
        YunipalsArena.Entry memory e = entrant(0);
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sig(signerKey, arena.entryDigest(id, e, expiry));
        e.tokenId++;
        vm.prank(e.player);
        vm.expectRevert(YunipalsArena.InvalidSignature.selector);
        arena.join{value: FEE}(id, e, expiry, permit);
        e.tokenId--;
        vm.prank(e.player);
        vm.expectRevert(YunipalsArena.IncorrectPayment.selector);
        arena.join{value: FEE - 1}(id, e, expiry, permit);
        vm.warp(expiry + 1);
        vm.prank(e.player);
        vm.expectRevert(YunipalsArena.InvalidEntry.selector);
        arena.join{value: FEE}(id, e, expiry, permit);
    }

    function testSmartAccountCanApproveStrategyAndReceivePayout() public {
        MockSmartWallet wallet = new MockSmartWallet(vm.addr(playerKeys[0]));
        vm.deal(address(wallet), 1 ether);
        uint256 id = arena.openTournament();
        YunipalsArena.Entry memory e = entrant(0);
        e.player = address(wallet);
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sig(signerKey, arena.entryDigest(id, e, expiry));
        vm.prank(address(wallet));
        arena.join{value: FEE}(id, e, expiry, permit);
        for (uint256 i = 1; i < 4; ++i) {
            joinSeat(id, i);
        }
        wrapper.fulfill(100, 123);
        arena.finalizeIsland(id);
        freeze(id);
        arena.settle(id, keccak256("result"), 0, 2, 0);
        arena.releasePayouts(id, keccak256("published film"));
        assertEq(arena.claimable(address(wallet)), uint256(FEE) * 2);
        vm.prank(address(wallet));
        arena.claim(payable(address(wallet)));
        assertEq(address(wallet).balance, 1 ether + FEE);
    }

    function testClaimReentrancyCannotDrainOtherPlayersFunds() public {
        uint256 id = fourSeats(true);
        freeze(id);
        arena.settle(id, keccak256("result"), 0, 2, 0);
        arena.releasePayouts(id, keccak256("published film"));
        ReenteringRecipient receiver = new ReenteringRecipient(arena);
        vm.prank(vm.addr(playerKeys[0]));
        arena.claim(payable(address(receiver)));
        assertFalse(receiver.reentrySucceeded());
        assertEq(address(receiver).balance, uint256(FEE) * 2);
        assertEq(arena.paymentLiability(), uint256(FEE) * 2);
        assertEq(arena.claimable(host) + arena.claimable(treasury), arena.paymentLiability());
    }
}
