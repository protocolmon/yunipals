// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VRF} from "@chainlink/contracts/src/v0.8/vrf/VRF.sol";
import {BoosterPacks} from "../src/BoosterPacks.sol";
import {PackRegistry} from "../src/PackRegistry.sol";
import {YunipalMonsters} from "../src/YunipalMonsters.sol";

interface ILiveWrapperCallbacks {
    function s_callbacks(uint256 id) external view returns (address, uint32, uint64);
    function lastRequestId() external view returns (uint256);
}

interface ILiveCoordinatorState {
    function s_requestCommitments(uint256 id) external view returns (bytes32);
    function getSubscription(uint256 id)
        external
        view
        returns (uint96, uint96 nativeBalance, uint64 reqCount, address, address[] memory);
}

/// @notice Opt-in integration tests of existing Base proxies; no deployments or broadcasts.
/// @dev Daily tests warp local time and inject an authenticated callback. They do not prove a
/// real 24-hour wait or oracle delivery. The lost-delivery test instead replays a genuine
/// coordinator fulfillment, faulting only the exact engine callback in local fork memory.
contract DeployedStateForkTest is Test {
    // PublicNode denied archive reads at this block; this credential-free fallback
    // returned the pinned block, actual engine code and implementation storage.
    string private constant PUBLIC_RPC = "https://mainnet.base.org";
    uint256 private constant FULFILLED_BLOCK = 52_950_531;
    uint256 private constant ORIGINAL = 1;
    uint32 private constant ACTUAL_VARIANT = 73;
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    BoosterPacks private constant engine = BoosterPacks(0x455FaBAd0ac8fF1eA4DF70ca07AA56A272cB2609);
    YunipalMonsters private constant monsters = YunipalMonsters(0x105319be2182018c31FB10B1bE198c3cf238a146);
    PackRegistry private constant registry = PackRegistry(0xeaeE2da120a398f21729D50672AC5d1Dd71d7274);
    address private constant BOB = address(0xb0b);

    struct LiveFixture {
        uint256 id;
        uint256 requestBlock;
        bytes32 requestHash;
        uint256 receivedAt;
        uint256 word;
        uint256 gasPrice;
        uint256 subId;
        address owner;
        address target;
        address sender;
        bytes input;
        VRF.Proof proof;
    }

    bool private enabled;
    LiveFixture private live;

    modifier optedIn() {
        if (!enabled) {
            vm.skip(true, "Set RUN_DEPLOYED_BOOSTER_FORK=true; uses only public Base RPC");
            return;
        }
        _;
    }

    function setUp() public {
        enabled = vm.envOr("RUN_DEPLOYED_BOOSTER_FORK", false);
        if (!enabled) return;
        live = _fixture();
        vm.createSelectFork(PUBLIC_RPC, FULFILLED_BLOCK);
    }

    function _fixture() private view returns (LiveFixture memory f) {
        string memory json = vm.readFile("test/fixtures/first-live-opening-2026-10-22.json");
        assertEq(vm.parseJsonUint(json, ".chainId"), 8453);
        assertEq(vm.parseJsonAddress(json, ".engine"), address(engine));
        assertEq(vm.parseJsonAddress(json, ".collection"), address(monsters));
        assertEq(vm.parseJsonUint(json, ".fulfillmentBlock"), FULFILLED_BLOCK);
        f.id = vm.parseJsonUint(json, ".requestId");
        f.requestBlock = vm.parseJsonUint(json, ".requestBlock");
        f.requestHash = vm.parseJsonBytes32(json, ".requestBlockHash");
        f.receivedAt = vm.parseJsonUint(json, ".receivedAt");
        f.word = vm.parseJsonUint(json, ".word");
        f.gasPrice = vm.parseJsonUint(json, ".fulfillmentGasPrice");
        f.subId = vm.parseJsonUint(json, ".commitment.subId");
        f.owner = vm.parseJsonAddress(json, ".owner");
        f.target = vm.parseJsonAddress(json, ".fulfillmentTarget");
        f.sender = vm.parseJsonAddress(json, ".fulfillmentSender");
        f.input = vm.parseJsonBytes(json, ".fulfillmentInput");
        for (uint256 i; i < 2; ++i) {
            string memory suffix = string.concat("[", vm.toString(i), "]");
            f.proof.pk[i] = vm.parseJsonUint(json, string.concat(".proof.pk", suffix));
            f.proof.gamma[i] = vm.parseJsonUint(json, string.concat(".proof.gamma", suffix));
            f.proof.cGammaWitness[i] = vm.parseJsonUint(json, string.concat(".proof.cGammaWitness", suffix));
            f.proof.sHashWitness[i] = vm.parseJsonUint(json, string.concat(".proof.sHashWitness", suffix));
        }
        f.proof.c = vm.parseJsonUint(json, ".proof.c");
        f.proof.s = vm.parseJsonUint(json, ".proof.s");
        f.proof.seed = vm.parseJsonUint(json, ".proof.seed");
        f.proof.uWitness = vm.parseJsonAddress(json, ".proof.uWitness");
        f.proof.zInv = vm.parseJsonUint(json, ".proof.zInv");
    }

    function _assertActualOpening() private view {
        assertEq(block.chainid, 8453);
        assertEq(address(engine.registry()), address(registry));
        assertEq(address(engine.monsters()), address(monsters));
        assertEq(address(monsters.registry()), address(registry));
        assertGt(address(uint160(uint256(vm.load(address(engine), IMPLEMENTATION_SLOT)))).code.length, 0);
        assertGt(address(uint160(uint256(vm.load(address(monsters), IMPLEMENTATION_SLOT)))).code.length, 0);
        assertGt(address(uint160(uint256(vm.load(address(registry), IMPLEMENTATION_SLOT)))).code.length, 0);
        assertEq(monsters.ownerOf(ORIGINAL), live.owner);
        (uint256 packId, uint256 parent, uint32 variant,, bool original) = monsters.provenance(ORIGINAL);
        assertEq(parent, ORIGINAL);
        assertEq(variant, ACTUAL_VARIANT);
        assertTrue(original);
        PackRegistry.Pack memory pack = registry.getPack(packId);
        assertTrue(pack.active);
        assertEq(pack.totalVariants, 264);
        assertEq(pack.rules.intervalSeconds, 1 days);
        assertEq(pack.rules.mintsPerInterval, 1);
        assertEq(pack.rules.maxBatch, 7);
        assertEq(pack.rules.price, 1 ether);
        BoosterPacks.Request memory r = engine.getRequest(live.id);
        assertEq(uint256(r.status), uint256(BoosterPacks.Status.Completed));
        assertTrue(r.received);
        assertEq(r.seed, live.word);
        assertEq(r.receivedAt, live.receivedAt);
        assertEq(r.originalId, ORIGINAL);
        assertTrue(r.opening);
        BoosterPacks.Original memory o = engine.getOriginal(ORIGINAL);
        assertEq(o.revealedAt, live.receivedAt);
        assertEq(o.remaining, 263);
        assertEq(o.minted, 1);
        assertEq(o.pendingRequest, 0);
        assertEq(o.dailyCommitted, 0);
    }

    function _paymentToken() private view returns (IERC20) {
        return IERC20(registry.getPack(engine.getOriginal(ORIGINAL).packTypeId).rules.paymentToken);
    }

    function _claim(address payer, uint32 quantity) private returns (uint256 id) {
        vm.deal(payer, 1 ether); // Local ETH funding; no token/storage fabrication.
        vm.txGasPrice(live.gasPrice);
        uint256 packId = engine.getOriginal(ORIGINAL).packTypeId;
        (, uint32 callbackGas) = engine.quote(packId, quantity, live.gasPrice);
        uint256 fee = engine.wrapper().calculateRequestPriceNative(callbackGas, 1);
        uint256 ethBefore = payer.balance;
        vm.prank(payer);
        id = engine.claim{value: fee}(ORIGINAL, quantity, fee, block.timestamp);
        assertEq(payer.balance, ethBefore - fee);
        assertEq(engine.getRequest(id).paid, fee);
        (address consumer, uint32 registeredGas,) =
            ILiveWrapperCallbacks(address(engine.wrapper())).s_callbacks(id);
        assertEq(consumer, address(engine));
        assertEq(registeredGas, callbackGas);
    }

    /// @dev Synthetic delivery for daily-rights tests only. The deployed wrapper and
    /// coordinator accepted the actual request, but no oracle proof exists for this fork request.
    function _syntheticDailyDelivery(uint256 id) private {
        uint256[] memory words = new uint256[](1);
        words[0] = uint256(keccak256(abi.encode("fork-only daily entropy", id)));
        vm.prank(address(engine.wrapper()));
        engine.rawFulfillRandomWords(id, words);
        assertEq(uint256(engine.getRequest(id).status), uint256(BoosterPacks.Status.Completed));
    }

    function testDeployedOriginalMatchesGenuineLiveFulfillment() public optedIn {
        _assertActualOpening();
        assertEq(engine.claimable(ORIGINAL), 0);
        (address callback,,) = ILiveWrapperCallbacks(address(engine.wrapper())).s_callbacks(live.id);
        assertEq(callback, address(0));
        vm.expectRevert("not awaiting randomness");
        engine.restoreRandomness(live.id, live.proof);
        uint256[] memory words = new uint256[](1);
        words[0] = live.word;
        vm.expectRevert("wrapper only");
        engine.rawFulfillRandomWords(live.id, words);
    }

    function testDeployedRollingDailyCreditsStartAtActualReveal() public optedIn {
        _assertActualOpening();
        vm.warp(live.receivedAt + 1 days - 1);
        assertEq(engine.claimable(ORIGINAL), 0);
        vm.warp(live.receivedAt + 1 days);
        assertEq(engine.claimable(ORIGINAL), 1);
        vm.warp(live.receivedAt + 3 days);
        assertEq(engine.claimable(ORIGINAL), 3);
        vm.warp(live.receivedAt + 1_000 days);
        assertEq(engine.claimable(ORIGINAL), 263);
    }

    function testDeployedSevenDailyMintsAreUniqueAndChargeNoProto() public optedIn {
        _assertActualOpening();
        vm.warp(live.receivedAt + 7 days);
        IERC20 proto = _paymentToken();
        uint256 supply = proto.totalSupply();
        uint256 balance = proto.balanceOf(live.owner);
        uint256 firstChild = monsters.nextTokenId();
        uint256 id = _claim(live.owner, 7);
        assertEq(engine.claimable(ORIGINAL), 0);
        _syntheticDailyDelivery(id);
        assertEq(proto.totalSupply(), supply);
        assertEq(proto.balanceOf(live.owner), balance);
        assertEq(engine.getOriginal(ORIGINAL).minted, 8);
        assertEq(engine.getOriginal(ORIGINAL).remaining, 256);
        bool[] memory seen = new bool[](264);
        seen[ACTUAL_VARIANT] = true;
        for (uint256 tokenId = firstChild; tokenId < firstChild + 7; ++tokenId) {
            (uint256 packId, uint256 parent, uint32 variant,, bool original) = monsters.provenance(tokenId);
            assertEq(packId, engine.getOriginal(ORIGINAL).packTypeId);
            assertEq(parent, ORIGINAL);
            assertFalse(original);
            assertFalse(seen[variant]);
            seen[variant] = true;
            assertEq(monsters.ownerOf(tokenId), live.owner);
            assertEq(engine.claimable(tokenId), 0);
        }
    }

    function testDeployedPendingBatchFollowsOriginalToBuyer() public optedIn {
        _assertActualOpening();
        vm.warp(live.receivedAt + 10 days);
        uint256 firstChild = monsters.nextTokenId();
        uint256 id = _claim(live.owner, 7);
        vm.prank(live.owner);
        monsters.transferFrom(live.owner, BOB, ORIGINAL);
        vm.expectRevert("owner only");
        vm.prank(live.owner);
        engine.claim(ORIGINAL, 1, 1 ether, block.timestamp);
        _syntheticDailyDelivery(id);
        assertEq(monsters.ownerOf(ORIGINAL), BOB);
        for (uint256 i; i < 7; ++i) {
            assertEq(monsters.ownerOf(firstChild + i), BOB);
        }
        assertEq(engine.claimable(ORIGINAL), 3);
        uint256 nextId = _claim(BOB, 3);
        _syntheticDailyDelivery(nextId);
        assertEq(engine.getOriginal(ORIGINAL).minted, 11);
    }

    function testDeployedBurnForfeitsPendingAndFutureRightsButKeepsOffspring() public optedIn {
        _assertActualOpening();
        vm.warp(live.receivedAt + 3 days);
        uint256 child = monsters.nextTokenId();
        _syntheticDailyDelivery(_claim(live.owner, 1));
        uint256 pending = _claim(live.owner, 2);
        uint256 nextToken = monsters.nextTokenId();
        vm.prank(live.owner);
        monsters.burn(ORIGINAL);
        assertTrue(engine.getOriginal(ORIGINAL).burned);
        assertEq(engine.getOriginal(ORIGINAL).pendingRequest, 0);
        assertEq(uint256(engine.getRequest(pending).status), uint256(BoosterPacks.Status.Forfeited));
        uint256[] memory words = new uint256[](1);
        words[0] = 19;
        vm.prank(address(engine.wrapper()));
        engine.rawFulfillRandomWords(pending, words);
        assertEq(monsters.nextTokenId(), nextToken);
        assertEq(monsters.ownerOf(child), live.owner);
        assertEq(engine.claimable(ORIGINAL), 0);
        assertEq(engine.claimable(child), 0);
        vm.expectRevert("owner only");
        vm.prank(live.owner);
        engine.claim(child, 1, 1 ether, block.timestamp);
        vm.expectRevert("not recoverable");
        engine.recover(pending);
        vm.expectRevert("not awaiting randomness");
        engine.restoreRandomness(pending, live.proof);
    }

    function _beforeGenuineFulfillment() private returns (ILiveCoordinatorState coordinator) {
        vm.createSelectFork(PUBLIC_RPC, FULFILLED_BLOCK - 1);
        assertEq(uint256(engine.getRequest(live.id).status), uint256(BoosterPacks.Status.Pending));
        assertFalse(engine.getRequest(live.id).received);
        assertEq(engine.getOriginal(ORIGINAL).minted, 0);
        assertEq(engine.proofContext(live.id).requestBlock, live.requestBlock);
        coordinator = ILiveCoordinatorState(engine.proofContext(live.id).coordinator);
        assertGt(address(coordinator).code.length, 0);
        assertGt(live.target.code.length, 0);
        (address consumer,,) = ILiveWrapperCallbacks(address(engine.wrapper())).s_callbacks(live.id);
        assertEq(consumer, address(engine));
        assertNotEq(coordinator.s_requestCommitments(live.id), bytes32(0));
        vm.roll(FULFILLED_BLOCK);
        vm.warp(live.receivedAt);
        assertEq(blockhash(live.requestBlock), live.requestHash);
        vm.txGasPrice(live.gasPrice);
    }

    function testDeployedConsumedOuterCallbackLossRecoversExactActualProof() public optedIn {
        ILiveCoordinatorState coordinator = _beforeGenuineFulfillment();
        uint256[] memory words = new uint256[](1);
        words[0] = live.word;
        vm.mockCallRevert(
            address(engine),
            abi.encodeCall(BoosterPacks.rawFulfillRandomWords, (live.id, words)),
            abi.encodeWithSignature("Error(string)", "fork-only lost outer delivery")
        );
        vm.expectEmit(true, true, false, false, address(engine.wrapper()));
        emit WrapperFulfillmentFailed(live.id, address(engine));
        vm.prank(live.sender);
        (bool success, bytes memory result) = live.target.call{gas: 5_000_000}(live.input);
        assertTrue(success, string(result));
        vm.clearMockedCalls();
        (address consumer, uint32 callbackGas, uint64 requestGasPrice) =
            ILiveWrapperCallbacks(address(engine.wrapper())).s_callbacks(live.id);
        assertEq(consumer, address(0));
        assertEq(callbackGas, 0);
        assertEq(requestGasPrice, 0);
        assertEq(coordinator.s_requestCommitments(live.id), bytes32(0));
        assertEq(uint256(engine.getRequest(live.id).status), uint256(BoosterPacks.Status.Pending));
        assertFalse(engine.getRequest(live.id).received);
        assertEq(engine.getOriginal(ORIGINAL).pendingRequest, live.id);
        assertEq(engine.getOriginal(ORIGINAL).minted, 0);
        vm.expectRevert();
        monsters.ownerOf(ORIGINAL);

        IERC20 proto = _paymentToken();
        uint256 supply = proto.totalSupply();
        uint256 ownerProto = proto.balanceOf(live.owner);
        uint256 ownerEth = live.owner.balance;
        uint256 wrapperEth = address(engine.wrapper()).balance;
        uint256 lastRequest = ILiveWrapperCallbacks(address(engine.wrapper())).lastRequestId();
        (, uint96 nativeBalance, uint64 count,,) = coordinator.getSubscription(live.subId);

        VRF.Proof memory wrong = live.proof;
        wrong.seed ^= 1;
        vm.expectRevert("proof request mismatch");
        engine.restoreRandomness(live.id, wrong);
        wrong = live.proof;
        wrong.c ^= 1;
        vm.expectRevert();
        engine.restoreRandomness(live.id, wrong);
        assertFalse(engine.getRequest(live.id).received);
        vm.prank(BOB); // Permissionless proof submission cannot redirect the original.
        engine.restoreRandomness(live.id, live.proof);
        assertEq(engine.getRequest(live.id).seed, live.word);
        assertEq(uint256(engine.getRequest(live.id).status), uint256(BoosterPacks.Status.Seeded));
        words[0] = 777;
        vm.prank(address(engine.wrapper()));
        engine.rawFulfillRandomWords(live.id, words);
        assertEq(engine.getRequest(live.id).seed, live.word);
        engine.recover(live.id);
        _assertActualOpening();
        assertEq(proto.totalSupply(), supply);
        assertEq(proto.balanceOf(live.owner), ownerProto);
        assertEq(live.owner.balance, ownerEth);
        assertEq(address(engine.wrapper()).balance, wrapperEth);
        assertEq(ILiveWrapperCallbacks(address(engine.wrapper())).lastRequestId(), lastRequest);
        (, uint96 nativeAfter, uint64 countAfter,,) = coordinator.getSubscription(live.subId);
        assertEq(nativeAfter, nativeBalance);
        assertEq(countAfter, count);
        vm.expectRevert("not awaiting randomness");
        engine.restoreRandomness(live.id, live.proof);
        vm.expectRevert("not recoverable");
        engine.recover(live.id);
    }

    event WrapperFulfillmentFailed(uint256 indexed requestId, address indexed consumer);
}
