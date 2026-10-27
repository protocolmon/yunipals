// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {YPAL} from "../src/YPAL.sol";
import {PROTO} from "../verified-source/contracts/PROTO.sol";
import {ERC20} from "../verified-source/solady/src/tokens/ERC20.sol";
import {Ownable} from "../verified-source/solady/src/auth/Ownable.sol";

contract MockPMON is ERC20 {
    function name() public pure override returns (string memory) {
        return "PMON";
    }

    function symbol() public pure override returns (string memory) {
        return "PMON";
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RejectETH {
    receive() external payable {
        revert("no ETH");
    }
}

contract YPALTest is Test {
    uint256 internal constant KEY = 0xA11CE;
    address internal alice;
    address internal constant BOB = address(0xB0B);
    address internal constant BURN = address(0xDEAD);
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    MockPMON internal pmon;
    YPAL internal token;
    PROTO internal baseline;

    function setUp() public {
        vm.chainId(8453);
        vm.warp(1_000_000);
        alice = vm.addr(KEY);
        pmon = new MockPMON();
        vm.prank(alice);
        token = new YPAL(address(pmon), BURN);
        vm.prank(alice);
        baseline = new PROTO(address(pmon), BURN);
        pmon.mint(alice, 1_000 ether);
        vm.startPrank(alice);
        pmon.approve(address(token), type(uint256).max);
        pmon.approve(address(baseline), type(uint256).max);
        vm.stopPrank();
    }

    function wrap(uint256 amount) internal {
        vm.prank(alice);
        assertEq(token.wrap(amount), amount);
    }

    function signature(address spender, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, alice, spender, value, nonce, deadline))
            )
        );
        return vm.sign(KEY, digest);
    }

    function testBrandingOwnerAndNoPremint() public view {
        assertEq(token.name(), "Yunipals");
        assertEq(token.symbol(), "YPAL");
        assertEq(token.decimals(), 18);
        assertEq(token.owner(), alice);
        assertEq(address(token.pmon()), address(pmon));
        assertEq(token.burnAddress(), BURN);
        assertFalse(token.isLocked());
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 0);
    }

    function testWrapUnwrapExactlyOneToOne() public {
        wrap(8 ether);
        assertEq(token.totalPMONHeld(), 8 ether);
        assertEq(token.totalSupply(), 8 ether);
        vm.prank(alice);
        assertEq(token.unwrap(3 ether), 3 ether);
        assertEq(token.balanceOf(alice), 5 ether);
        assertEq(pmon.balanceOf(alice), 995 ether);
        assertEq(token.totalPMONHeld(), 5 ether);
    }

    function testBurnDestroysWrapperAndTransfersBackingWithoutBurningPMONSupply() public {
        wrap(8 ether);
        uint256 supply = pmon.totalSupply();
        vm.prank(alice);
        token.burn(3 ether);
        assertEq(token.totalSupply(), 5 ether);
        assertEq(token.totalPMONHeld(), 5 ether);
        assertEq(pmon.balanceOf(BURN), 3 ether);
        assertEq(pmon.totalSupply(), supply);
    }

    function testFuzzNormalizedLifecycleMatchesVerifiedPROTO(uint128 amount, uint128 toBurn) public {
        uint256 value = bound(uint256(amount), 1, 100 ether);
        uint256 burned = bound(uint256(toBurn), 1, value);
        wrap(value);
        vm.prank(alice);
        baseline.wrap(value);
        vm.startPrank(alice);
        token.burn(burned);
        baseline.burn(burned);
        if (value > burned) {
            token.unwrap(value - burned);
            baseline.unwrap(value - burned);
        }
        vm.stopPrank();
        assertEq(token.totalSupply(), baseline.totalSupply());
        assertEq(token.balanceOf(alice), baseline.balanceOf(alice));
        assertEq(token.totalPMONHeld(), baseline.totalPMONHeld());
        assertEq(pmon.balanceOf(BURN), 2 * burned);
    }

    function testPermitUsesYunipalsDomainAndAdvancesNonce() public {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Yunipals"),
                keccak256("1"),
                uint256(8453),
                address(token)
            )
        );
        assertEq(token.DOMAIN_SEPARATOR(), expected);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = signature(BOB, 3 ether, 0, deadline);
        vm.prank(BOB);
        token.permit(alice, BOB, 3 ether, deadline, v, r, s);
        assertEq(token.nonces(alice), 1);
        assertEq(token.allowance(alice, BOB), 3 ether);
    }

    function testFrontRunPermitLeavesExactAllowanceAndReplayRefuses() public {
        wrap(3 ether);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = signature(BOB, 3 ether, 0, deadline);
        token.permit(alice, BOB, 3 ether, deadline, v, r, s);
        vm.expectRevert(ERC20.InvalidPermit.selector);
        token.permit(alice, BOB, 3 ether, deadline, v, r, s);
        vm.prank(BOB);
        token.transferFrom(alice, BOB, 3 ether);
        assertEq(token.allowance(alice, BOB), 0);
        vm.prank(BOB);
        token.burn(3 ether);
        assertEq(token.totalSupply(), 0);
        assertEq(pmon.balanceOf(BURN), 3 ether);
    }

    function testWrongDomainSignatureAndExpiredPermitRefuseWithoutNonceChange() public {
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = signature(BOB, 1 ether, 0, deadline);
        vm.chainId(1);
        vm.expectRevert(ERC20.InvalidPermit.selector);
        token.permit(alice, BOB, 1 ether, deadline, v, r, s);
        vm.chainId(8453);
        vm.warp(deadline + 1);
        vm.expectRevert(ERC20.PermitExpired.selector);
        token.permit(alice, BOB, 1 ether, deadline, v, r, s);
        assertEq(token.nonces(alice), 0);
        assertEq(token.allowance(alice, BOB), 0);
    }

    function testLockFreezesConfigurationButPreservesCoreAndRescueBehavior() public {
        vm.startPrank(alice);
        token.setBurnAddress(BOB);
        token.lockContract();
        vm.expectRevert(YPAL.ContractIsLocked.selector);
        token.setBurnAddress(BURN);
        vm.expectRevert(YPAL.ContractAlreadyLocked.selector);
        token.lockContract();
        token.wrap(4 ether);
        token.unwrap(1 ether);
        token.burn(1 ether);
        vm.stopPrank();
        assertTrue(token.isLocked());
        assertEq(pmon.balanceOf(BOB), 1 ether);
        assertEq(token.totalSupply(), 2 ether);
    }

    function testOnlyExcessBackingCanBeRescuedAndOwnerRequired() public {
        wrap(4 ether);
        pmon.mint(address(token), 3 ether);
        vm.expectRevert(Ownable.Unauthorized.selector);
        token.rescueExcessPMON(BOB);
        vm.prank(alice);
        token.rescueExcessPMON(BOB);
        assertEq(pmon.balanceOf(BOB), 3 ether);
        assertEq(token.totalPMONHeld(), token.totalSupply());
        vm.prank(alice);
        vm.expectRevert(YPAL.NoExcessPMON.selector);
        token.rescueExcessPMON(BOB);
        vm.prank(alice);
        vm.expectRevert(YPAL.CannotRescuePMONToken.selector);
        token.rescue(address(pmon), BOB, 1);
    }

    function testRescueOtherTokenAndETHPreserveBacking() public {
        wrap(2 ether);
        MockPMON other = new MockPMON();
        other.mint(address(token), 3 ether);
        vm.deal(address(token), 2 ether);
        vm.startPrank(alice);
        token.rescue(address(other), BOB, 3 ether);
        token.rescueETH(BOB);
        vm.stopPrank();
        assertEq(other.balanceOf(BOB), 3 ether);
        assertEq(BOB.balance, 2 ether);
        assertEq(token.totalPMONHeld(), 2 ether);
        assertEq(token.totalSupply(), 2 ether);
    }

    function testRescueETHFailureIsAtomicAndOwnerCanTransfer() public {
        vm.deal(address(token), 1 ether);
        RejectETH reject = new RejectETH();
        vm.prank(alice);
        vm.expectRevert("ETH transfer failed");
        token.rescueETH(address(reject));
        assertEq(address(token).balance, 1 ether);
        vm.prank(alice);
        token.transferOwnership(BOB);
        assertEq(token.owner(), BOB);
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        token.lockContract();
    }

    function testZeroBurnDestinationRetainsOriginalBehavior() public {
        YPAL empty = new YPAL(address(pmon), address(0));
        vm.expectRevert(YPAL.BurnAddressNotSet.selector);
        empty.burn(1);
        empty.setBurnAddress(BURN);
        assertEq(empty.burnAddress(), BURN);
    }

    function testOwnerAndInputErrorsMatchOriginal() public {
        vm.expectRevert(YPAL.InvalidPMONAddress.selector);
        new YPAL(address(0), BURN);
        vm.expectRevert(YPAL.AmountMustBeGreaterThanZero.selector);
        token.wrap(0);
        vm.expectRevert(YPAL.AmountMustBeGreaterThanZero.selector);
        token.unwrap(0);
        vm.expectRevert(YPAL.AmountMustBeGreaterThanZero.selector);
        token.burn(0);
        vm.expectRevert(Ownable.Unauthorized.selector);
        token.setBurnAddress(BOB);
        vm.startPrank(alice);
        vm.expectRevert(YPAL.InvalidBurnAddress.selector);
        token.setBurnAddress(address(0));
        vm.expectRevert(YPAL.CannotSetBurnAddressToSelf.selector);
        token.setBurnAddress(address(token));
        vm.expectRevert(YPAL.InvalidRecipientAddress.selector);
        token.rescueExcessPMON(address(0));
        vm.expectRevert(YPAL.InvalidRecipientAddress.selector);
        token.rescueETH(address(0));
        vm.stopPrank();
    }
}
