/** Read-only independent proof for the isolated public competition rehearsal. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  erc20Abi,
  http,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  portalCompetitionAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  writeRehearsalJson,
  rehearsalJson,
  type RehearsalState
} from "../lib/portals/rehearsal.js";

async function main() {
  const directory = process.env.PORTALS_COMPETITION_REHEARSAL_DIRECTORY;
  const rpc = process.env.PORTALS_RPC_URL;
  assert(directory && rpc, "Set the public rehearsal directory and RPC");
  const state = JSON.parse(
    await readFile(join(directory, "state.json"), "utf8")
  ) as RehearsalState;
  assert.equal(state.chainId, 84532);
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc, { timeout: 20000 })
  });
  assert.equal(await client.getChainId(), 84532);
  const pool = state.observations.competition as Address;
  assert(pool, "Competition has not been deployed");
  const deployment = state.observations.deployment as {
    grading: Address;
    usdc: Address;
  };
  const block = await client.getBlock();
  const at = { blockNumber: block.number };
  const [first, second, liability, reserves, count, source] = await Promise.all(
    [
      client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "getBatch",
        args: [1n],
        ...at
      }),
      client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "getBatch",
        args: [2n],
        ...at
      }),
      client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "totalLiability",
        ...at
      }),
      client.readContract({
        address: deployment.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pool],
        ...at
      }),
      client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "entryCount",
        ...at
      }),
      client.readContract({
        address: pool,
        abi: portalCompetitionAbi,
        functionName: "grading",
        ...at
      })
    ]
  );
  assert.equal(source.toLowerCase(), deployment.grading.toLowerCase());
  assert.equal(count, 112n);
  assert.equal(first.funded, 111);
  assert.equal(second.funded, 1);
  assert.equal(second.completed, 1);
  assert(reserves >= liability);
  const signers = [
    state.wallets.player,
    state.wallets.buyer,
    state.wallets.deployer
  ];
  for (let start = 1; start <= 112; start += 8) {
    await Promise.all(
      Array.from({ length: Math.min(8, 113 - start) }, async (_, i) => {
        const ordinal = start + i;
        const e = await client.readContract({
          address: pool,
          abi: portalCompetitionAbi,
          functionName: "getEntry",
          args: [BigInt(ordinal)],
          ...at
        });
        assert.equal(e.requestId, BigInt(ordinal + 2));
        assert.equal(
          e.submitter.toLowerCase(),
          signers[(ordinal - 1) % 3].toLowerCase()
        );
        const expected =
          ordinal === 112
            ? 100
            : ordinal >= 109
              ? ordinal - 12
              : 30 + (ordinal % 60);
        if (ordinal !== 111 || first.completed === 111)
          assert(e.completed && e.score === expected * 4);
      })
    );
  }
  const legacyBindings = state.observations.legacyBindings as Hex[];
  for (let i = 0; i < 2; i++)
    assert.equal(
      await client.readContract({
        address: deployment.grading,
        abi: portalGradingAbi,
        functionName: "requestBinding",
        args: [BigInt(i + 1)],
        ...at
      }),
      legacyBindings[i]
    );
  const baselinePath = join(
    directory,
    "winner-balances-before-settlement.json"
  );
  const balances = Object.fromEntries(
    await Promise.all(
      signers.map(async (address) => [
        address.toLowerCase(),
        (
          await client.readContract({
            address: deployment.usdc,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
            ...at
          })
        ).toString()
      ])
    )
  );
  if (!first.settled) {
    assert.equal(liability, 56_000_000n);
    if (first.completed === 110)
      await writeRehearsalJson(baselinePath, { block: block.number, balances });
    await writeRehearsalJson(
      join(directory, "independent-batch-verification.json"),
      {
        chainId: 84532,
        block: block.number,
        competition: pool,
        funded: 112,
        first,
        second,
        liability,
        reserves,
        legacyBindingsPreserved: true,
        liveChainlinkVerified: false
      }
    );
    assert(
      !process.argv.includes("--require-settled"),
      "Live Chainlink settlement remains pending"
    );
    console.log(
      rehearsalJson({
        status:
          first.completed === 110 ? "waiting-final-grade" : "waiting-live-CRE",
        firstCompleted: first.completed,
        nextBatchCompleted: second.completed
      })
    );
    return;
  }
  assert.equal(first.completed, 111);
  assert.deepEqual(first.leaders, [111n, 110n, 109n]);
  assert.deepEqual(first.paid, [true, true, true]);
  assert.equal(liability, 500_000n);
  assert.equal(reserves, 500_000n);
  const forwarder = process.env.PORTALS_CRE_FORWARDER as Address;
  const receiver = process.env.PORTALS_CRE_RECEIVER as Address;
  assert(
    forwarder && receiver,
    "Supply the independently verified real CRE forwarder and receiver"
  );
  const receiverAbi = parseAbi([
    "function forwarder() view returns(address)",
    "function competition() view returns(address)",
    "function workflowOwner() view returns(address)"
  ]);
  assert.equal(
    (
      await client.readContract({
        address: receiver,
        abi: receiverAbi,
        functionName: "forwarder",
        ...at
      })
    ).toLowerCase(),
    forwarder.toLowerCase()
  );
  assert.equal(
    (
      await client.readContract({
        address: receiver,
        abi: receiverAbi,
        functionName: "competition",
        ...at
      })
    ).toLowerCase(),
    pool.toLowerCase()
  );
  const from = BigInt(state.transactions["grade-111"].block!);
  const settled = [];
  for (let start = from; start <= block.number; start += 200n) {
    settled.push(
      ...(await client.getContractEvents({
        address: pool,
        abi: portalCompetitionAbi,
        eventName: "CompetitionSettled",
        args: { batchId: 1n },
        fromBlock: start,
        toBlock: start + 199n < block.number ? start + 199n : block.number
      }))
    );
  }
  assert.equal(settled.length, 1);
  const event = settled[0];
  assert(event.transactionHash && event.blockHash);
  const [tx, receipt, canonical] = await Promise.all([
    client.getTransaction({ hash: event.transactionHash }),
    client.getTransactionReceipt({ hash: event.transactionHash }),
    client.getBlock({ blockNumber: event.blockNumber! })
  ]);
  assert.equal(receipt.status, "success");
  assert.equal(canonical.hash, event.blockHash);
  assert.equal(
    tx.to?.toLowerCase(),
    forwarder.toLowerCase(),
    "Settlement did not originate through the real Chainlink forwarder"
  );
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as {
    balances: Record<string, string>;
  };
  const winnings = [11_100_000n, 16_650_000n, 27_750_000n];
  signers.forEach((address, i) =>
    assert.equal(
      BigInt(balances[address.toLowerCase()]) -
        BigInt(baseline.balances[address.toLowerCase()]),
      winnings[i]
    )
  );
  await writeRehearsalJson(join(directory, "final-verification.json"), {
    chainId: 84532,
    block: block.number,
    competition: pool,
    receiver,
    forwarder,
    settlementTransaction: event.transactionHash,
    transactionFrom: tx.from,
    first,
    second,
    liability,
    reserves,
    winnerBalances: balances,
    deterministicGrades: true,
    legacyBindingsPreserved: true,
    liveChainlinkVerified: true
  });
  console.log(
    rehearsalJson({
      status: "live-Chainlink-settlement-verified",
      transaction: event.transactionHash,
      winners: first.leaders,
      prizes: ["27.75", "16.65", "11.10"],
      nextBatchReserve: "0.50"
    })
  );
}

main().catch(() => {
  console.error(
    "Independent competition verification failed; inspect private records. No credentials are logged."
  );
  process.exitCode = 1;
});
