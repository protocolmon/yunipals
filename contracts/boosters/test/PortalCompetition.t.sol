// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PortalGradingCompetition} from "../src/PortalGradingCompetition.sol";
import {PortalCompetitionReceiver} from "../src/PortalCompetitionReceiver.sol";

contract CompetitionUSDC is ERC20 {
    address public blocked;
    address public reentry;
    bool public refused;
    constructor() ERC20("Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function blockRecipient(address to) external {
        blocked = to;
    }

    function setReentry(address target) external {
        reentry = target;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(to != blocked, "recipient blocked");
        if (reentry != address(0) && from == reentry) {
            (bool ok,) = reentry.call(abi.encodeWithSignature("settle(uint256)", 1));
            require(!ok, "reentry allowed");
            refused = true;
        }
        super._update(from, to, value);
    }
}

contract CompetitionSource {
    struct Result {
        bool eligible;
        bool completed;
        address submitter;
        bytes32 rubric;
        uint8[4] scores;
    }
    mapping(uint256 => Result) public results;

    function admit(PortalGradingCompetition pool, uint256 request, address player, bytes32 rubric) external {
        results[request] = Result(true, false, player, rubric, [uint8(1), 1, 1, 1]);
        pool.registerEntry(request, player, rubric);
    }

    function complete(uint256 request, uint8[4] memory scores) external {
        results[request].completed = true;
        results[request].scores = scores;
    }

    function competitionResult(uint256 request)
        external
        view
        returns (bool, bool, address, bytes32, uint8[4] memory)
    {
        Result memory r = results[request];
        return (r.eligible, r.completed, r.submitter, r.rubric, r.scores);
    }
}

contract PortalCompetitionTest is Test {
    CompetitionUSDC token;
    CompetitionSource source;
    PortalGradingCompetition pool;
    bytes32 constant RUBRIC = keccak256("rubric");
    address constant PLAYER = address(0x1234);

    function setUp() public {
        token = new CompetitionUSDC();
        source = new CompetitionSource();
        pool = PortalGradingCompetition(
            address(
                new ERC1967Proxy(
                    address(new PortalGradingCompetition()),
                    abi.encodeCall(
                        PortalGradingCompetition.initialize, (address(this), address(source), token)
                    )
                )
            )
        );
    }

    function admit(uint256 id, address player) internal {
        token.mint(address(pool), 500_000);
        source.admit(pool, id, player, RUBRIC);
    }

    function complete(uint256 id, uint8 score) internal {
        source.complete(id, [score, score, score, score]);
        pool.recordCompleted(id);
    }

    function fill(uint256 start, uint256 end) internal {
        for (uint256 id = start; id <= end; ++id) {
            admit(id, address(uint160(id + 1000)));
        }
    }
    function nextTheme(uint256 batchId) internal {
        pool.publishTheme(batchId, pool.themeSourcesHash(batchId), keccak256("artifact"), keccak256("policy"), "Guardians of light", "Create an original guardian using light in a surprising way.", "https://example.test/theme.json");
    }

    function testAdmissionBoundariesAndOutOfOrderCompletion() public {
        fill(1, 111);
        assertEq(pool.getBatch(1).funded, 111);
        assertEq(pool.getBatch(2).funded, 0);
        assertFalse(pool.admissionsOpen());
        vm.expectRevert("next theme pending");
        source.admit(pool, 112, PLAYER, RUBRIC);
        for (uint256 id = 110; id > 0; --id) {
            complete(id, 70);
        }
        assertFalse(pool.ready(1));
        assertEq(pool.getBatch(1).completed, 110);
        assertEq(pool.getBatch(2).completed, 0);
        assertEq(pool.getBatch(1).leaders[0], 1);
        complete(111, 99);
        assertTrue(pool.ready(1));
        assertEq(pool.readyCount(), 1);
        assertEq(pool.readyAt(0), 1);
        uint256[3] memory leaders = pool.getBatch(1).leaders;
        assertEq(leaders[0], 111);
        assertEq(leaders[1], 1);
        assertEq(leaders[2], 2);
        pool.recordCompleted(111);
        assertEq(pool.readyCount(), 1);
        assertFalse(pool.admissionsOpen());
        nextTheme(2);
        admit(112, PLAYER);
        complete(112, 100);
        assertEq(pool.getBatch(2).completed, 1);
        vm.prank(address(0x9999));
        pool.settle(1);
        assertEq(token.balanceOf(address(111 + 1000)), 27_750_000);
        assertEq(token.balanceOf(address(1 + 1000)), 16_650_000);
        assertEq(token.balanceOf(address(2 + 1000)), 11_100_000);
        assertEq(pool.totalLiability(), 500_000);
        assertEq(token.balanceOf(address(pool)), 500_000);
        pool.settle(1);
        pool.payPrize(1, 0);
        assertEq(pool.totalLiability(), 500_000);
    }

    function testBlockedRecipientIsolationAndPermissionlessRetry() public {
        fill(1, 111);
        for (uint256 id = 1; id <= 111; ++id) {
            complete(id, 50);
        }
        token.blockRecipient(address(1001));
        pool.settle(1);
        assertFalse(pool.getBatch(1).paid[0]);
        assertTrue(pool.getBatch(1).paid[1]);
        assertTrue(pool.getBatch(1).paid[2]);
        assertEq(pool.totalLiability(), 27_750_000);
        token.blockRecipient(address(0));
        vm.prank(PLAYER);
        pool.payPrize(1, 0);
        assertEq(pool.totalLiability(), 0);
    }

    function testSamePlayerCanWinAllThreeAndDonationsAreExcluded() public {
        token.mint(address(pool), 123);
        for (uint256 id = 1; id <= 111; ++id) {
            admit(id, PLAYER);
            complete(id, 100);
        }
        token.setReentry(address(pool));
        pool.settle(1);
        assertTrue(token.refused());
        assertEq(token.balanceOf(PLAYER), 55_500_000);
        assertEq(token.balanceOf(address(pool)), 123);
        assertEq(pool.totalLiability(), 0);
    }

    function testLaterBatchCanSettleWhileEarlierPayoutWaits() public {
        fill(1, 111);
        for (uint256 id = 1; id <= 111; ++id) complete(id, 80);
        nextTheme(2);
        fill(112, 222);
        for (uint256 id = 112; id <= 222; ++id) {
            complete(id, 80);
        }
        pool.settle(2);
        assertEq(pool.readyAt(1), 2);
        assertFalse(pool.getBatch(1).settled);
        assertEq(pool.totalLiability(), 55_500_000);
        pool.settle(1);
        assertEq(pool.totalLiability(), 0);
    }

    function testThemeSourcesImmutabilityAuthorizationAndQuotes() public {
        bytes32 firstQuote=pool.admissionHash();
        assertTrue(pool.getTheme(1).hash!=bytes32(0));
        fill(1,111);
        assertTrue(pool.admissionHash()!=firstQuote);
        vm.expectRevert("previous grades pending");
        pool.publishTheme(2,bytes32(0),keccak256("a"),keccak256("p"),"Theme","Brief","https://example.test/t");
        for(uint256 id=1;id<=111;++id) complete(id,50);
        bytes32 sources=pool.themeSourcesHash(2);
        vm.prank(PLAYER); vm.expectRevert();
        pool.publishTheme(2,sources,keccak256("a"),keccak256("p"),"Theme","Brief","https://example.test/t");
        vm.expectRevert("winner sources changed");
        pool.publishTheme(2,bytes32(0),keccak256("a"),keccak256("p"),"Theme","Brief","https://example.test/t");
        bytes32 waitingQuote=pool.admissionHash();
        nextTheme(2);
        assertTrue(pool.admissionsOpen());
        assertTrue(pool.admissionHash()!=waitingQuote);
        assertEq(pool.getTheme(2).sourcesHash,sources);
        vm.expectRevert("theme already published");
        pool.publishTheme(2,sources,keccak256("artifact"),keccak256("policy"),"Guardians of light","Create an original guardian using light in a surprising way.","https://example.test/theme.json");
        assertFalse(pool.getBatch(1).settled);
    }

    function testUnauthorizedUnfundedUnfinishedAndDuplicateEntries() public {
        vm.expectRevert("grading only");
        pool.registerEntry(1, PLAYER, RUBRIC);
        vm.expectRevert("unfunded entry");
        source.admit(pool, 1, PLAYER, RUBRIC);
        admit(1, PLAYER);
        vm.expectRevert("invalid entry");
        source.admit(pool, 1, PLAYER, RUBRIC);
        vm.expectRevert("result not eligible");
        pool.recordCompleted(1);
        vm.expectRevert("request not entered");
        pool.recordCompleted(2);
        vm.expectRevert("batch not ready");
        pool.settle(1);
        vm.expectRevert("batch not settled");
        pool.payPrize(1, 0);
        vm.expectRevert("invalid rank");
        pool.payPrize(1, 3);
        assertFalse(pool.canChangePolicy());
    }

    function testRubricFrozenWithinBatchAndUpgradesPreserveMoney() public {
        admit(1, PLAYER);
        token.mint(address(pool), 500_000);
        vm.expectRevert("batch rubric changed");
        source.admit(pool, 2, PLAYER, keccak256("other"));
        assertEq(pool.entryCount(), 1);
        pool.upgradeToAndCall(address(new PortalGradingCompetition()), "");
        assertEq(pool.totalLiability(), 500_000);
        assertEq(pool.getEntry(1).submitter, PLAYER);
        assertEq(pool.getBatch(1).rubric, RUBRIC);
    }

    function testCREAuthenticationDomainReplayAndPublicFallback() public {
        fill(1, 111);
        for (uint256 id = 1; id <= 111; ++id) {
            complete(id, 50);
        }
        address forwarder = address(0xf0);
        vm.etch(forwarder, hex"00");
        bytes10 name = bytes10("compete");
        PortalCompetitionReceiver receiver = new PortalCompetitionReceiver(pool, forwarder, PLAYER, name);
        bytes memory metadata = abi.encodePacked(bytes32(uint256(123)), name, PLAYER);
        bytes32 rules = pool.RULES_HASH();
        bytes memory report = abi.encode(block.chainid, address(pool), rules, uint256(1));
        vm.expectRevert("invalid CRE sender or metadata");
        receiver.onReport(metadata, report);
        vm.prank(forwarder);
        vm.expectRevert("wrong CRE workflow");
        receiver.onReport(abi.encodePacked(bytes32(0), name, address(this)), report);
        vm.prank(forwarder);
        vm.expectRevert("wrong report domain");
        receiver.onReport(metadata, abi.encode(block.chainid + 1, address(pool), rules, uint256(1)));
        vm.prank(forwarder);
        receiver.onReport(metadata, report);
        assertEq(pool.totalLiability(), 0);
        vm.prank(forwarder);
        receiver.onReport(metadata, report);
        assertEq(token.balanceOf(address(1001)), 27_750_000);
    }

    function testFuzzTopThreeAndReserves(uint256 seed) public {
        fill(1, 111);
        for (uint256 id = 111; id > 0; --id) {
            complete(id, uint8(1 + uint256(keccak256(abi.encode(seed, id))) % 100));
        }
        uint256[3] memory leaders = pool.getBatch(1).leaders;
        for (uint256 id = 1; id <= 111; ++id) {
            PortalGradingCompetition.Entry memory e = pool.getEntry(id);
            uint256 ahead;
            for (uint256 j = 1; j <= 111; ++j) {
                uint16 other = pool.getEntry(j).score;
                if (other > e.score || (other == e.score && j < id)) ahead++;
            }
            if (ahead < 3) assertEq(leaders[ahead], id);
        }
        assertEq(pool.totalLiability(), 55_500_000);
        pool.settle(1);
        assertEq(pool.totalLiability(), 0);
        assertEq(token.balanceOf(address(pool)), 0);
    }
}
