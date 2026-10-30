// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {YunipalsArenaV2} from "../src/YunipalsArenaV2.sol";
import {MockWrapper, MockNft, MockCurrency, MockEligibility} from "./YunipalsArena.t.sol";

contract QuotingWrapper is MockWrapper {
    function estimateRequestPriceNative(uint32, uint32, uint256) external view returns (uint256) {
        return price;
    }
}

contract RefundRejectingEntrant {
    YunipalsArenaV2 reentryArena;
    bool public reentered;

    receive() external payable {
        if (address(reentryArena) == address(0)) revert();
        (reentered,) = address(reentryArena).call(abi.encodeCall(
            reentryArena.claimRandomnessRefund, (YunipalsArenaV2.Mode.Anime, payable(address(this)))
        ));
    }

    function allowReentryAttempt(YunipalsArenaV2 arena) external { reentryArena = arena; }

    function approve(MockCurrency token, address arena) external {
        token.approve(arena, type(uint256).max);
    }

    function enter(
        YunipalsArenaV2 arena,
        uint256 id,
        YunipalsArenaV2.Entry calldata entry,
        uint256 expiry,
        bytes calldata permit,
        uint256 value
    ) external {
        arena.join{value: value}(id, entry, expiry, permit);
    }

    function withdraw(YunipalsArenaV2 arena, YunipalsArenaV2.Mode mode, address payable recipient) external {
        arena.claimRandomnessRefund(mode, recipient);
    }
}

contract YunipalsArenaV2Test is Test {
    YunipalsArenaV2 arena;
    QuotingWrapper wrapper;
    MockNft islands;
    MockNft fighters;
    MockCurrency usdc;
    MockEligibility registry;
    address host = address(0xA11);
    address treasury = address(0xB22);
    uint256 signerKey = 0xA11CE;
    uint256[4] playerKeys = [uint256(101), 102, 103, 104];
    bytes32 videoRules = keccak256("video rules");
    bytes32 animeRules = keccak256("anime rules");

    function setUp() public {
        vm.chainId(8453);
        vm.warp(1_000_000);
        wrapper = new QuotingWrapper();
        islands = new MockNft();
        usdc = new MockCurrency();
        registry = new MockEligibility();
        registry.setEligible(true);
        MockNft implementation = new MockNft();
        vm.etch(0x98433dF878e8C898CB907345C3a7756E5F72240f, address(implementation).code);
        fighters = MockNft(0x98433dF878e8C898CB907345C3a7756E5F72240f);
        arena = new YunipalsArenaV2(
            YunipalsArenaV2.Config({
                admin: address(this),
                lobbyOperator: address(0x0B0B),
                admissionSigner: vm.addr(signerKey),
                referee: address(this),
                treasury: treasury,
                islands: address(islands),
                vrfWrapper: address(wrapper),
                paymentToken: address(usdc),
                animeRegistry: address(registry),
                videoRulesHash: videoRules,
                animeRulesHash: animeRules,
                joinWindow: 7 days,
                strategyWindow: 1 days,
                resolutionWindow: 1 days
            })
        );
        for (uint256 i; i < 4; ++i) {
            address player = vm.addr(playerKeys[i]);
            vm.deal(player, 10 ether);
            usdc.mint(player, 100_000_000);
            vm.prank(player);
            usdc.approve(address(arena), type(uint256).max);
            fighters.setOwner(100 + i, player);
        }
        for (uint256 i = 1; i <= 1373; ++i) {
            islands.setOwner(i, host);
        }
    }

    function sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function entry(uint256 seat) internal view returns (YunipalsArenaV2.Entry memory) {
        return YunipalsArenaV2.Entry(vm.addr(playerKeys[seat]), 8453, address(fighters), 100 + seat);
    }

    function open(YunipalsArenaV2.Mode mode) internal returns (uint256) {
        arena.setEntriesPaused(mode, false);
        return arena.openTournament(mode);
    }

    function join(uint256 id, uint256 seat, uint256 value) internal {
        joinExpect(id, seat, value, "");
    }

    function joinExpect(uint256 id, uint256 seat, uint256 value, bytes memory expected) internal {
        YunipalsArenaV2.Entry memory e = entry(seat);
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sign(signerKey, arena.entryDigest(id, e, expiry));
        if (expected.length != 0) vm.expectRevert(expected);
        vm.prank(e.player);
        arena.join{value: value}(id, e, expiry, permit);
    }

    function resolve(uint256 id) internal {
        wrapper.fulfill(arena.tournament(id).requestId, 42);
        arena.finalizeIsland(id);
        bytes32[4] memory commitments;
        bytes[4] memory signatures;
        for (uint8 i; i < 4; ++i) {
            commitments[i] = keccak256(abi.encode(id, i));
            signatures[i] = sign(playerKeys[i], arena.strategyDigest(id, i, commitments[i]));
        }
        arena.freezeInput(id, keccak256("input"), commitments, signatures);
        arena.settle(id, keccak256("result"), 0, 2, 0);
        arena.releasePayouts(id, keccak256("film"));
    }

    function testBothModesStartPausedAndKeepApprovedEconomics() public view {
        assertTrue(arena.entriesPaused(0));
        assertTrue(arena.entriesPaused(1));
        YunipalsArenaV2.ModeConfig memory video = arena.modeConfig(YunipalsArenaV2.Mode.Video);
        YunipalsArenaV2.ModeConfig memory anime = arena.modeConfig(YunipalsArenaV2.Mode.Anime);
        assertEq(video.entryFee, 2_000_000);
        assertEq(video.winnerBps, 7500);
        assertEq(video.islandBps, 500);
        assertEq(anime.entryFee, 1_000_000);
        assertEq(anime.winnerBps, 8000);
        assertEq(anime.islandBps, 500);
        assertEq(anime.eligibility, address(registry));
        assertEq(video.eligibility, address(0));
        assertEq(video.rulesHash, videoRules);
        assertEq(anime.rulesHash, animeRules);
    }

    function testModesHaveIndependentUniqueTournamentIdsAndPause() public {
        assertEq(open(YunipalsArenaV2.Mode.Video), 1);
        assertTrue(arena.entriesPaused(1));
        assertEq(open(YunipalsArenaV2.Mode.Anime), 2);
        assertEq(arena.openTournament(YunipalsArenaV2.Mode.Video), 3);
        assertEq(arena.openTournament(YunipalsArenaV2.Mode.Anime), 4);
        arena.setEntriesPaused(YunipalsArenaV2.Mode.Anime, true);
        join(1, 0, wrapper.price());
        vm.expectRevert(YunipalsArenaV2.InvalidState.selector);
        arena.openTournament(YunipalsArenaV2.Mode.Anime);
    }

    function testFirstEntrantPaysOracleWithNoOperatorReserve() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        address player = entry(0).player;
        uint256 beforeEth = player.balance;
        join(id, 0, wrapper.price());
        assertEq(player.balance, beforeEth - wrapper.price());
        assertEq(address(arena).balance, 0);
        assertEq(address(wrapper).balance, wrapper.price());
        assertEq(usdc.balanceOf(address(arena)), 1_000_000);
        assertEq(arena.paymentLiability(), 1_000_000);
        assertEq(arena.tournament(id).count, 1);
    }

    function testQuoteUsesFeeOnlyForTheFirstSeat() public {
        uint256 id = open(YunipalsArenaV2.Mode.Video);
        (bool first, uint256 fee) = arena.quoteJoin(id, 1);
        assertTrue(first);
        assertEq(fee, wrapper.price());
        join(id, 0, fee);
        (first, fee) = arena.quoteJoin(id, 1);
        assertFalse(first);
        assertEq(fee, 0);
    }

    function testUnusedBufferIsRefundedAndNoFixedDrawCapRemains() public {
        uint256 id = open(YunipalsArenaV2.Mode.Video);
        wrapper.setPrice(0.005 ether);
        address player = entry(0).player;
        uint256 balance = player.balance;
        join(id, 0, 0.01 ether);
        assertEq(player.balance, balance - 0.005 ether);
        assertEq(address(arena).balance, 0);
        assertEq(arena.randomnessRefundLiability(), 0);
    }

    function testSimultaneousFirstQuotesNeverChargeTheLaterEntrant() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        uint256 quote = wrapper.price();
        join(id, 0, quote);
        address later = entry(1).player;
        uint256 beforeEth = later.balance;
        join(id, 1, quote);
        assertEq(later.balance, beforeEth);
        assertEq(wrapper.nextId(), 101);
        join(id, 2, 0);
        join(id, 3, 0);
        assertEq(wrapper.nextId(), 101);
        assertEq(usdc.balanceOf(address(arena)), 4_000_000);
    }

    function testUnderpaymentCannotSpendTheArenaBalanceAndRollsBackUsdcAndSeat() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        vm.deal(address(arena), 1 ether);
        joinExpect(
            id,
            0,
            wrapper.price() - 1,
            abi.encodeWithSelector(
                YunipalsArenaV2.IncorrectRandomnessPayment.selector, wrapper.price(), wrapper.price() - 1
            )
        );
        assertEq(usdc.balanceOf(address(arena)), 0);
        assertEq(arena.paymentLiability(), 0);
        assertEq(arena.tournament(id).count, 0);
        assertEq(wrapper.nextId(), 100);
        assertEq(arena.activeNftTournament(arena.nftKey(entry(0))), 0);
    }

    function testPriceIncreaseRequiresANewUserApprovedPayment() public {
        uint256 id = open(YunipalsArenaV2.Mode.Video);
        (, uint256 quote) = arena.quoteJoin(id, 1);
        wrapper.setPrice(quote * 2);
        joinExpect(
            id,
            0,
            quote,
            abi.encodeWithSelector(YunipalsArenaV2.IncorrectRandomnessPayment.selector, quote * 2, quote)
        );
        assertEq(usdc.balanceOf(address(arena)), 0);
        assertEq(arena.tournament(id).count, 0);
    }

    function rejectedRefund() internal returns (RefundRejectingEntrant wallet, uint256 id, uint256 unused) {
        wallet = new RefundRejectingEntrant();
        id = open(YunipalsArenaV2.Mode.Anime);
        usdc.mint(address(wallet), 1_000_000);
        wallet.approve(usdc, address(arena));
        fighters.setOwner(500, address(wallet));
        vm.deal(address(wallet), 1 ether);
        YunipalsArenaV2.Entry memory e = YunipalsArenaV2.Entry(address(wallet), 8453, address(fighters), 500);
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sign(signerKey, arena.entryDigest(id, e, expiry));
        unused = 0.001 ether;
        wallet.enter(arena, id, e, expiry, permit, wrapper.price() + unused);
    }

    function testRefundRejectingWalletCanEnterAndRecoverToAnotherRecipient() public {
        (RefundRejectingEntrant wallet, uint256 id, uint256 unused) = rejectedRefund();
        assertEq(arena.tournament(id).count, 1);
        assertEq(arena.randomnessRefund(YunipalsArenaV2.Mode.Anime, address(wallet)), unused);
        assertEq(arena.randomnessRefundLiability(), unused);
        uint256 balance = host.balance;
        wallet.withdraw(arena, YunipalsArenaV2.Mode.Anime, payable(host));
        assertEq(host.balance, balance + unused);
        assertEq(arena.randomnessRefundLiability(), 0);
        assertEq(address(arena).balance, 0);
    }

    function testOwnerCannotWithdrawRefundCredit() public {
        (,, uint256 unused) = rejectedRefund();
        assertEq(address(arena).balance, unused);
        assertEq(arena.availableNativeSurplus(), 0);
        vm.expectRevert(YunipalsArenaV2.InvalidState.selector);
        arena.withdrawNativeSurplus(payable(treasury), 1);
    }

    function testRefundWithdrawalFailureRetainsItsCredit() public {
        (RefundRejectingEntrant wallet,, uint256 unused) = rejectedRefund();
        vm.expectRevert(YunipalsArenaV2.TransferFailed.selector);
        wallet.withdraw(arena, YunipalsArenaV2.Mode.Anime, payable(address(wallet)));
        assertEq(arena.randomnessRefund(YunipalsArenaV2.Mode.Anime, address(wallet)), unused);
        assertEq(arena.randomnessRefundLiability(), unused);
    }

    function testRefundWithdrawalCannotReenterOrCollectTwice() public {
        (RefundRejectingEntrant wallet,, uint256 unused) = rejectedRefund();
        wallet.allowReentryAttempt(arena);
        uint256 beforeBalance = address(wallet).balance;
        wallet.withdraw(arena, YunipalsArenaV2.Mode.Anime, payable(address(wallet)));
        assertFalse(wallet.reentered());
        assertEq(address(wallet).balance, beforeBalance + unused);
        assertEq(arena.randomnessRefundLiability(), 0);
        assertEq(arena.randomnessRefund(YunipalsArenaV2.Mode.Anime, address(wallet)), 0);
        vm.expectRevert(YunipalsArenaV2.InvalidState.selector);
        wallet.withdraw(arena, YunipalsArenaV2.Mode.Anime, payable(host));
    }

    function testTaxedUsdcRollsBackTheSeatBeforeRequestingRandomness() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        usdc.setFee(true);
        joinExpect(id, 0, wrapper.price(), abi.encodeWithSelector(YunipalsArenaV2.IncorrectPayment.selector));
        assertEq(arena.tournament(id).count, 0);
        assertEq(wrapper.nextId(), 100);
        assertEq(arena.paymentLiability(), 0);
        assertEq(usdc.balanceOf(address(arena)), 0);
        assertEq(arena.activeNftTournament(arena.nftKey(entry(0))), 0);
    }

    function testLateAndDuplicateOracleCallbacksCannotReopenAnExpiredMode() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        join(id, 0, wrapper.price());
        uint256 request = arena.tournament(id).requestId;
        vm.warp(arena.tournament(id).deadline);
        arena.expire(id);
        wrapper.fulfill(request, 42);
        wrapper.fulfill(request, 99);
        arena.finalizeIsland(id);
        YunipalsArenaV2.Tournament memory t = arena.tournament(id);
        assertEq(uint256(t.phase), uint256(YunipalsArenaV2.Phase.Expired));
        assertEq(t.randomWord, 42);
        assertTrue(t.islandId > 0);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Anime, entry(0).player), 1_000_000);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Video, entry(0).player), 0);
    }

    function testMissingStrategiesUseTheCorrectModeRulesWithoutMoreRandomness() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        for (uint256 i; i < 4; ++i) join(id, i, i == 0 ? wrapper.price() : 0);
        wrapper.fulfill(arena.tournament(id).requestId, 42);
        arena.finalizeIsland(id);
        bytes32[4] memory commitments;
        bytes[4] memory signatures;
        for (uint8 i; i < 4; ++i) {
            uint8 attack = uint8(uint256(keccak256(abi.encode(
                arena.FALLBACK_DOMAIN(), block.chainid, address(arena), id, i, animeRules, uint256(42)
            ))) % 4);
            assertEq(arena.fallbackAttack(id, i), attack);
            commitments[i] = arena.fallbackCommitment(id, i);
        }
        vm.warp(arena.tournament(id).deadline);
        arena.freezeInputWithFallback(id, keccak256("input"), commitments, signatures, 15);
        assertEq(arena.automaticStrategyMask(id), 15);
        assertEq(wrapper.nextId(), 101);
    }

    function testAnimeRequiresApprovalWhileVideoDoesNot() public {
        uint256 anime = open(YunipalsArenaV2.Mode.Anime);
        uint256 video = open(YunipalsArenaV2.Mode.Video);
        registry.setEligible(false);
        joinExpect(anime, 0, wrapper.price(), abi.encodeWithSelector(YunipalsArenaV2.InvalidEntry.selector));
        join(video, 0, wrapper.price());
    }

    function testAnimeRejectsForeignNftEvenIfAHookSaysEligible() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        YunipalsArenaV2.Entry memory e = entry(0);
        e.nftChainId = 1;
        e.collection = arena.OTHER_YUNIPALS();
        uint256 expiry = block.timestamp + 300;
        bytes memory permit = sign(signerKey, arena.entryDigest(id, e, expiry));
        uint256 fee = wrapper.price();
        vm.expectRevert(YunipalsArenaV2.InvalidEntry.selector);
        vm.prank(e.player);
        arena.join{value: fee}(id, e, expiry, permit);
    }

    function testNftCannotOccupyBothModes() public {
        uint256 video = open(YunipalsArenaV2.Mode.Video);
        uint256 anime = open(YunipalsArenaV2.Mode.Anime);
        join(video, 0, wrapper.price());
        joinExpect(anime, 0, wrapper.price(), abi.encodeWithSelector(YunipalsArenaV2.InvalidEntry.selector));
    }

    function testBothPayoutSchedulesStaySeparateAndClaimable() public {
        uint256 video = open(YunipalsArenaV2.Mode.Video);
        for (uint256 i; i < 4; ++i) {
            join(video, i, i == 0 ? wrapper.price() : 0);
        }
        resolve(video);
        uint256 anime = open(YunipalsArenaV2.Mode.Anime);
        for (uint256 i; i < 4; ++i) {
            join(anime, i, i == 0 ? wrapper.price() : 0);
        }
        resolve(anime);
        address champion = entry(0).player;
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Video, champion), 6_000_000);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Anime, champion), 3_200_000);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Video, host), 400_000);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Anime, host), 200_000);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Video, treasury), 1_600_000);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Anime, treasury), 600_000);
        vm.prank(champion);
        arena.claim(YunipalsArenaV2.Mode.Anime, payable(champion));
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Video, champion), 6_000_000);
        assertEq(arena.paymentLiability(), 8_800_000);
    }

    function testExpiryRefundsUsdcButDoesNotInventAnOracleFeeRefund() public {
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        join(id, 0, wrapper.price());
        vm.warp(arena.tournament(id).deadline);
        arena.expire(id);
        assertEq(arena.claimable(YunipalsArenaV2.Mode.Anime, entry(0).player), 1_000_000);
        assertEq(arena.randomnessRefund(YunipalsArenaV2.Mode.Anime, entry(0).player), 0);
        assertEq(address(wrapper).balance, wrapper.price());
    }

    function testFuzzFirstEntrantPaysOnlyTheActualOracleFee(uint96 rawFee, uint96 rawBuffer) public {
        uint256 fee = bound(uint256(rawFee), 1, 0.1 ether);
        uint256 buffer = bound(uint256(rawBuffer), 0, 0.1 ether);
        wrapper.setPrice(fee);
        uint256 id = open(YunipalsArenaV2.Mode.Anime);
        address player = entry(0).player;
        uint256 balance = player.balance;
        join(id, 0, fee + buffer);
        assertEq(player.balance, balance - fee);
        assertEq(address(arena).balance, 0);
        assertEq(arena.randomnessRefundLiability(), 0);
        assertEq(wrapper.nextId(), 101);
    }
}
