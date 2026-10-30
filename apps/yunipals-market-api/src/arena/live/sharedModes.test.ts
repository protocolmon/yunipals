import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import {
  arenaDeploymentId,
  arenaEventKind,
  nextArenaTournamentId,
  parseArenaDeployment
} from "@protopals/yunipals-market-core/arenaProtocol";
import { arenaClientReceiptEvidence } from "./clientReceiptEvidence";
import { transactionAction } from "./clientTransactions";
import {
  readArenaNextId,
  readArenaPaused,
  readArenaSettings
} from "./protocol";

const contract = `0x${"12".repeat(20)}` as Address;
const wallet = `0x${"34".repeat(20)}` as Address;
const recipient = `0x${"56".repeat(20)}` as Address;
const hash = `0x${"ab".repeat(32)}` as const;

test("shared identities separate modes while canonical event addresses remain unchanged", () => {
  const video = arenaDeploymentId(contract, "video", 2),
    anime = arenaDeploymentId(contract, "anime", 2);
  assert.notEqual(video, anime);
  assert.equal(parseArenaDeployment(anime).canonicalPrefix, `8453:${contract}`);
  assert.equal(parseArenaDeployment(anime).contract, contract);
  assert.equal(arenaDeploymentId(contract), `8453:${contract}`);
  assert.equal(nextArenaTournamentId(undefined, "video", 2), 1n);
  assert.equal(nextArenaTournamentId(undefined, "anime", 2), 2n);
  assert.equal(nextArenaTournamentId("2", "anime", 2), 4n);
  assert.equal(nextArenaTournamentId("2", "video", 1), 3n);
  assert.throws(() => nextArenaTournamentId("2", "video", 2), /another/);
  assert.throws(
    () => nextArenaTournamentId(String(2n ** 256n - 1n), "video", 2),
    /overflow/
  );
  assert.equal(arenaEventKind({ id: 2n, mode: 1 }), "anime");
  assert.equal(arenaEventKind({ id: "3" }), "video");
  assert.equal(arenaEventKind({ mode: 1 }), "anime");
  assert.equal(arenaEventKind({}), null);
  for (const args of [
    { id: 2n, mode: 0 },
    { id: "0" },
    { id: "02" },
    { id: 2n ** 256n },
    { mode: 2 }
  ])
    assert.throws(() => arenaEventKind(args));
});

test("mode settings, pause and lobby reads use the selected mode without changing legacy calls", async () => {
  const calls: { functionName: string; args?: readonly unknown[] }[] = [];
  const client = {
    readContract: async (input: (typeof calls)[number]) => {
      calls.push(input);
      return input.functionName === "modeConfig"
        ? {
            entryFee: 1000000n,
            winnerBps: 8000,
            islandBps: 500,
            rulesHash: hash,
            eligibility: recipient
          }
        : 2n;
    },
    multicall: async ({ contracts }: { contracts: typeof calls }) =>
      contracts.map((c) =>
        c.functionName === "paymentToken"
          ? wallet
          : c.functionName === "poolHash"
            ? hash
            : 86400
      )
  } as unknown as PublicClient;
  const anime = {
    contract,
    contractVersion: 2 as const,
    mediaKind: "anime" as const
  };
  await readArenaPaused(client, anime, 9n);
  await readArenaNextId(client, anime, 9n);
  const settings = await readArenaSettings(client, anime);
  assert.deepEqual(
    calls.map((c) => [c.functionName, c.args]),
    [
      ["entriesPaused", [1n]],
      ["nextTournamentId", [1n]],
      ["modeConfig", [1]]
    ]
  );
  assert.equal(settings.entryFee, 1000000n);
  assert.equal(settings.eligibility, recipient);
  await readArenaPaused(client, { ...anime, contractVersion: 1 });
  assert.equal(calls.at(-1)!.args, undefined);
});

function receipt(name: "Claimed" | "RandomnessRefundClaimed", mode: 0 | 1) {
  const item = arenaV2Abi.find((i) => i.type === "event" && i.name === name)!;
  if (item.type !== "event") throw new Error("Missing event fixture");
  const args = { mode, player: wallet, recipient, amount: 100n };
  const inputs = item.inputs.filter((i) => !i.indexed);
  return {
    blockNumber: 10n,
    blockHash: hash,
    transactionHash: hash,
    transactionIndex: 0,
    logs: [
      {
        address: contract,
        blockNumber: 10n,
        blockHash: hash,
        transactionHash: hash,
        transactionIndex: 0,
        logIndex: 0,
        removed: false,
        topics: encodeEventTopics({ abi: arenaV2Abi, eventName: name, args }),
        data: encodeAbiParameters(
          inputs,
          inputs.map((i) => args[i.name as keyof typeof args])
        )
      }
    ]
  } as unknown as TransactionReceipt;
}

test("refund receipt evidence binds its asset, mode and chosen recipient", () => {
  const action = transactionAction({
    kind: "claim",
    asset: "randomness-refund",
    recipient
  });
  assert.ok(action.kind === "claim");
  const check = (r: TransactionReceipt, kind: "anime" | "video" = "anime") =>
    arenaClientReceiptEvidence(
      { action, wallet },
      r,
      contract,
      wallet,
      true,
      1000000n,
      2,
      kind
    );
  assert.equal(check(receipt("RandomnessRefundClaimed", 1))?.amount, "100");
  assert.equal(check(receipt("RandomnessRefundClaimed", 0)), null);
  assert.equal(check(receipt("RandomnessRefundClaimed", 1), "video"), null);
  assert.equal(check(receipt("Claimed", 1)), null);
  assert.equal(
    arenaClientReceiptEvidence(
      { action: { ...action, recipient: wallet }, wallet },
      receipt("RandomnessRefundClaimed", 1),
      contract,
      wallet,
      true,
      1000000n,
      2,
      "anime"
    ),
    null
  );
  assert.throws(
    () => transactionAction({ kind: "claim", recipient }),
    /recipient/
  );
  assert.throws(
    () =>
      transactionAction({
        kind: "claim",
        asset: "randomness-refund",
        recipient: `0x${"0".repeat(40)}`
      }),
    /recipient/
  );
  const usdc = { action: { kind: "claim" as const }, wallet };
  assert.equal(
    arenaClientReceiptEvidence(
      usdc,
      receipt("RandomnessRefundClaimed", 1),
      contract,
      wallet,
      true,
      1000000n,
      2,
      "anime"
    ),
    null
  );
});
