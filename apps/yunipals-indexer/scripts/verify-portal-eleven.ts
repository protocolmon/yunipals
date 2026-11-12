/** Independent read-only verification of the eleven-entry live AI rehearsal. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseEventLogs,
  toHex,
  type Address,
  type Hex
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  portalCompetitionAbi,
  portalCollectionAbi,
  portalGradingAbi,
  portalRegistryAbi
} from "@protopals/yunipals-market-core/portalAbi";
import { portalSpellCommitment } from "@protopals/yunipals-market-core/portals";
import { portalAssetHash } from "../lib/portals/assets.js";
import {
  rehearsalJson,
  writeRehearsalJson,
  type RehearsalState
} from "../lib/portals/rehearsal.js";

async function main() {
  const directory = process.env.PORTALS_ELEVEN_DIRECTORY;
  const earlier = process.env.PORTALS_COMPETITION_REHEARSAL_DIRECTORY;
  const rpc = process.env.PORTALS_RPC_URL;
  assert(directory && earlier && rpc);
  const json = async (name: string) =>
    JSON.parse(await readFile(join(directory, name), "utf8"));
  const state = (await json("state.json")) as RehearsalState;
  assert.equal(state.chainId, 84532);
  assert.equal(state.observations.completed, true, "Live run is not complete");
  const d = state.observations.deployment as {
    grading: Address;
    competition: Address;
    registry: Address;
    usdc: Address;
    wrapper: Address;
  };
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc, { timeout: 20000 })
  });
  assert.equal(await client.getChainId(), 84532);
  const head = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber: head - 2n });
  const at = { blockNumber: block.number };
  const batch = await client.readContract({
    address: d.competition,
    abi: portalCompetitionAbi,
    functionName: "getBatch",
    args: [1n],
    ...at
  });
  assert.equal(
    await client.readContract({
      address: d.competition,
      abi: portalCompetitionAbi,
      functionName: "BATCH_SIZE",
      ...at
    }),
    11n
  );
  assert.equal(
    await client.readContract({
      address: d.competition,
      abi: portalCompetitionAbi,
      functionName: "entryCount",
      ...at
    }),
    11n
  );
  assert.equal(
    await client.readContract({
      address: d.competition,
      abi: portalCompetitionAbi,
      functionName: "RULES_HASH",
      ...at
    }),
    keccak256(
      toHex(
        "YunipalsCompetitionTestV2:11:500000:sum4:earlier-entry:50,30,20:submitter:sequential-themes"
      )
    )
  );
  assert(
    batch.funded === 11 &&
      batch.completed === 11 &&
      batch.settled &&
      batch.paid.every(Boolean)
  );
  const canonicalReceipts = new Map<
    string,
    Awaited<ReturnType<typeof client.getTransactionReceipt>>
  >();
  for (const [name, tx] of Object.entries(state.transactions)) {
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    assert.equal(receipt.status, "success", name);
    assert.equal(receipt.blockHash, tx.blockHash, name);
    assert(receipt.blockNumber <= block.number);
    assert.equal(
      (await client.getBlock({ blockNumber: receipt.blockNumber })).hash,
      receipt.blockHash
    );
    canonicalReceipts.set(name, receipt);
  }
  const coordinator = await client.readContract({
    address: d.wrapper,
    abi: parseAbi(["function s_vrfCoordinator() view returns(address)"]),
    functionName: "s_vrfCoordinator",
    ...at
  });
  const vrf: { requestId: bigint; transaction: Hex }[] = [];
  for (const [name, saved] of Object.entries(state.transactions)) {
    if (name !== "mint-portal" && !name.startsWith("rotate-")) continue;
    const receipt = canonicalReceipts.get(name)!;
    const requested = parseEventLogs({
      abi: portalCollectionAbi,
      eventName: "RandomnessRequested",
      logs: receipt.logs
    })[0];
    assert(requested && saved.to);
    let found = false;
    for (
      let from = receipt.blockNumber;
      from <= block.number && !found;
      from += 200n
    ) {
      const logs: {
        args: { seed?: bigint };
        transactionHash: Hex | null;
        blockHash: Hex | null;
      }[] = await client.getLogs({
        address: saved.to,
        event: parseAbiItem(
          "event RandomnessReceived(uint256 indexed requestId, uint256 seed)"
        ),
        args: { requestId: requested.args.requestId },
        fromBlock: from,
        toBlock: from + 199n < block.number ? from + 199n : block.number
      });
      for (const log of logs) {
        assert(log.transactionHash);
        const callback = await client.getTransaction({
          hash: log.transactionHash
        });
        const callbackReceipt = await client.getTransactionReceipt({
          hash: log.transactionHash
        });
        assert(callback.to);
        if (callback.to.toLowerCase() !== coordinator.toLowerCase()) {
          // Chainlink may aggregate fulfillments through its batch adapter.
          const forwardedCoordinator = await client.readContract({
            address: callback.to,
            abi: parseAbi(["function COORDINATOR() view returns(address)"]),
            functionName: "COORDINATOR",
            blockNumber: callbackReceipt.blockNumber
          });
          assert.equal(
            forwardedCoordinator.toLowerCase(),
            coordinator.toLowerCase()
          );
        }
        const fulfilled = parseEventLogs({
          abi: parseAbi([
            "event RandomWordsFulfilled(uint256 indexed requestId, uint256 outputSeed, uint256 indexed subId, uint96 payment, bool nativePayment, bool success, bool onlyPremium)"
          ]),
          eventName: "RandomWordsFulfilled",
          logs: callbackReceipt.logs.filter(
            (l) => l.address.toLowerCase() === coordinator.toLowerCase()
          )
        }).find((e) => e.args.requestId === requested.args.requestId);
        assert(fulfilled?.args.success && fulfilled.args.nativePayment);
        assert.equal(callbackReceipt.status, "success");
        assert.equal(callbackReceipt.blockHash, log.blockHash);
        const randomness: readonly [bigint, boolean, boolean] =
          await client.readContract({
            address: saved.to,
            abi: portalCollectionAbi,
            functionName: "randomRequests",
            args: [requested.args.requestId],
            ...at
          });
        assert(randomness[1] && randomness[2]);
        assert.equal(randomness[0], log.args.seed);
        vrf.push({
          requestId: requested.args.requestId,
          transaction: log.transactionHash
        });
        found = true;
      }
    }
    assert(found, "Missing real VRF coordinator fulfillment");
  }
  assert(vrf.length >= 2);
  const results = (await json("results.json")) as {
    ordinal: number;
    tokenId: string;
    spell: string;
    title: string;
  }[];
  assert.equal(results.length, 11);
  const signers = [
    state.wallets.player,
    state.wallets.buyer,
    state.wallets.deployer
  ];
  const ranking: {
    entry: bigint;
    score: number;
    submitter: Address;
    title: string;
    artwork: Hex;
    scores: readonly number[];
  }[] = [];
  for (const row of results) {
    const id = BigInt(row.ordinal);
    const [request, result, entry] = await Promise.all([
      client.readContract({
        address: d.grading,
        abi: portalGradingAbi,
        functionName: "getRequest",
        args: [id],
        ...at
      }),
      client.readContract({
        address: d.grading,
        abi: portalGradingAbi,
        functionName: "getResult",
        args: [id],
        ...at
      }),
      client.readContract({
        address: d.competition,
        abi: portalCompetitionAbi,
        functionName: "getEntry",
        args: [id],
        ...at
      })
    ]);
    assert(request.completed && entry.completed);
    assert.equal(entry.requestId, id);
    assert.equal(request.tokenId, BigInt(row.tokenId));
    assert.equal(
      entry.submitter.toLowerCase(),
      signers[(row.ordinal - 1) % 3].toLowerCase()
    );
    assert.equal(
      request.submitter.toLowerCase(),
      entry.submitter.toLowerCase()
    );
    const saved = state.observations[`admit-${id}`] as { salt: Hex };
    assert.equal(
      request.spellCommitment,
      portalSpellCommitment({
        chainId: 84532,
        grading: d.grading,
        submitter: request.submitter,
        tokenId: request.tokenId,
        artVersion: request.artVersion,
        nonce: request.nonce,
        spell: row.spell,
        salt: saved.salt
      })
    );
    assert.equal(
      result.requestBinding,
      await client.readContract({
        address: d.grading,
        abi: portalGradingAbi,
        functionName: "requestBinding",
        args: [id],
        ...at
      })
    );
    const readAsset = async (uri: string, expected?: Hex) => {
      const name = new URL(uri).pathname.split("/").at(-1)!;
      assert(/^[a-f0-9]{64}\.(png|json)$/.test(name));
      const bytes = await readFile(join(directory, "assets", name));
      assert.equal(portalAssetHash(bytes), `0x${name.split(".")[0]}`);
      if (expected) assert.equal(portalAssetHash(bytes), expected);
      return bytes;
    };
    const image = await readAsset(result.artwork.uri, result.artwork.hash);
    assert(
      image
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
    assert.notEqual(result.artwork.hash, request.input.hash);
    const report = JSON.parse(
      (await readAsset(result.reportURI, result.reportHash)).toString()
    );
    const spell = JSON.parse((await readAsset(result.spellURI)).toString());
    assert.equal(spell.spell, row.spell);
    assert.equal(report.spellHash, keccak256(toHex(row.spell)));
    assert.equal(report.output.hash, result.artwork.hash);
    assert.equal(report.input.hash, request.input.hash);
    assert.equal(report.requestBinding, result.requestBinding);
    assert.deepEqual(
      [
        report.scores.creativity,
        report.scores.harmony,
        report.scores.craft,
        report.scores.impact
      ],
      [...result.scores]
    );
    assert(
      report.usage.image &&
        report.usage.grading &&
        report.effectiveImagePrompt.includes(row.spell)
    );
    assert(result.scores.every((s) => s >= 1 && s <= 100));
    const score = result.scores.reduce((a, b) => a + b, 0);
    assert.equal(entry.score, score);
    const admission = canonicalReceipts.get(`admit-${id}`)!;
    const admissionBlock = await client.getBlock({
      blockNumber: admission.blockNumber
    });
    const active = await client.readContract({
      address: d.registry,
      abi: portalRegistryAbi,
      functionName: "activePortal",
      blockNumber: admission.blockNumber
    });
    assert.equal(active[0].id, request.roundId);
    assert.equal(active[0].portalId, request.portalId);
    assert(
      admissionBlock.timestamp >= active[0].startsAt &&
        admissionBlock.timestamp < active[0].endsAt
    );
    assert.equal(active[0].endsAt - active[0].startsAt, 660n);
    const transfers = parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: admission.logs.filter(
        (l) => l.address.toLowerCase() === d.usdc.toLowerCase()
      )
    });
    assert.equal(
      transfers
        .filter(
          (t) => t.args.from.toLowerCase() === request.submitter.toLowerCase()
        )
        .reduce((sum, t) => sum + t.args.value, 0n),
      990000n
    );
    assert.equal(
      transfers
        .filter((t) => t.args.to.toLowerCase() === d.competition.toLowerCase())
        .reduce((sum, t) => sum + t.args.value, 0n),
      500000n
    );
    assert.equal(
      (
        await client.readContract({
          address: d.grading,
          abi: portalGradingAbi,
          functionName: "inputArtwork",
          args: [request.tokenId],
          ...at
        })
      )[1],
      1n
    );
    ranking.push({
      entry: id,
      score,
      submitter: entry.submitter,
      title: row.title,
      artwork: result.artwork.hash,
      scores: result.scores
    });
  }
  assert.equal(new Set(ranking.map((r) => r.artwork)).size, 11);
  ranking.sort((a, b) => b.score - a.score || Number(a.entry - b.entry));
  assert.deepEqual(
    [...batch.leaders],
    ranking.slice(0, 3).map((r) => r.entry)
  );
  const resolution = canonicalReceipts.get("winner-resolve")!;
  const tx = await client.getTransaction({ hash: resolution.transactionHash });
  assert.equal(tx.to?.toLowerCase(), d.competition.toLowerCase());
  assert.equal(tx.from.toLowerCase(), ranking[0].submitter.toLowerCase());
  assert.deepEqual(
    decodeFunctionData({ abi: portalCompetitionAbi, data: tx.input }),
    { functionName: "settle", args: [1n] }
  );
  const prizes = [2750000n, 1650000n, 1100000n];
  const paid = parseEventLogs({
    abi: portalCompetitionAbi,
    eventName: "CompetitionPrizePaid",
    logs: resolution.logs
  });
  assert.equal(paid.length, 3);
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: resolution.logs.filter(
      (l) => l.address.toLowerCase() === d.usdc.toLowerCase()
    )
  });
  assert.equal(transfers.length, 3);
  const expected = new Map(signers.map((a) => [a.toLowerCase(), 0n]));
  for (let rank = 0; rank < 3; rank++) {
    const p = paid.find((p) => p.args.rank === rank)!;
    assert.equal(p.args.amount, prizes[rank]);
    assert.equal(
      p.args.winner.toLowerCase(),
      ranking[rank].submitter.toLowerCase()
    );
    assert.equal(
      transfers[rank].args.from.toLowerCase(),
      d.competition.toLowerCase()
    );
    assert.equal(
      transfers[rank].args.to.toLowerCase(),
      ranking[rank].submitter.toLowerCase()
    );
    assert.equal(transfers[rank].args.value, prizes[rank]);
    const address = ranking[rank].submitter.toLowerCase();
    expected.set(address, expected.get(address)! + prizes[rank]);
  }
  const baseline = state.observations.prizeBaseline as Record<string, string>;
  for (const address of signers)
    assert.equal(
      (await client.readContract({
        address: d.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
        ...at
      })) - BigInt(baseline[address.toLowerCase()]),
      expected.get(address.toLowerCase())
    );
  assert.equal(
    await client.readContract({
      address: d.competition,
      abi: portalCompetitionAbi,
      functionName: "totalLiability",
      ...at
    }),
    0n
  );
  assert.equal(
    await client.readContract({
      address: d.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [d.competition],
      ...at
    }),
    0n
  );
  const duplicate = canonicalReceipts.get("duplicate-resolution")!;
  assert.equal(
    parseEventLogs({
      abi: portalCompetitionAbi,
      eventName: "CompetitionPrizePaid",
      logs: duplicate.logs
    }).length,
    0
  );
  assert.equal(
    parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: duplicate.logs.filter(
        (l) => l.address.toLowerCase() === d.usdc.toLowerCase()
      )
    }).length,
    0
  );
  const old = JSON.parse(
    await readFile(join(earlier, "state.json"), "utf8")
  ) as RehearsalState;
  const oldPool = old.observations.competition as Address;
  assert.equal(
    await client.readContract({
      address: oldPool,
      abi: portalCompetitionAbi,
      functionName: "BATCH_SIZE",
      ...at
    }),
    111n
  );
  assert.equal(
    await client.readContract({
      address: d.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [oldPool],
      ...at
    }),
    56000000n
  );
  assert.equal(
    (
      await client.readContract({
        address: oldPool,
        abi: portalCompetitionAbi,
        functionName: "getBatch",
        args: [1n],
        ...at
      })
    ).settled,
    false
  );
  const usage = (await json("provider-usage.json")) as {
    endpoint: string;
    model: string;
  }[];
  assert(usage.filter((u) => u.endpoint === "images/edits").length >= 11);
  const proof = {
    verifiedAt: new Date().toISOString(),
    chainId: 84532,
    block: block.number,
    blockHash: block.hash,
    canonicalTransactions: canonicalReceipts.size,
    vrf,
    batchSize: 11,
    realImages: 11,
    uniqueImages: 11,
    realGrades: 11,
    rankings: ranking,
    prizes,
    resolutionTransaction: tx.hash,
    resolvedBy: tx.from,
    duplicateResolutionSafe: true,
    admissionsIn660SecondWindow: true,
    poolReserve: 0,
    totalLiability: 0,
    productionBatchSize: 111,
    previousBatchPreserved: true,
    providerModels: [...new Set(usage.map((u) => u.model))],
    deployment: d
  };
  await writeRehearsalJson(
    join(directory, "independent-verification.json"),
    proof
  );
  console.log(rehearsalJson(proof));
}
main().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error
        ? error.name
        : "Verification failed"
  );
  process.exitCode = 1;
});
