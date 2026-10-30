import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import {
  encodeAbiParameters,
  encodeEventTopics,
  decodeFunctionData,
  keccak256,
  TransactionReceiptNotFoundError,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
  type PublicClient,
  type LocalAccount,
  type TransactionReceipt
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { migrateArena } from "./schema";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { arenaPrivateTables } from "./identitySchema";
import type { NativeArenaObservation } from "./nativeSource";
import type { NativeIntent } from "./nativeTransactions";
import { NativeArenaControl } from "./nativeControl";
import { NativeArenaSettlement } from "./nativeSettlement";
import { ArenaSettlement } from "./settlement";
import { ArenaCapacity } from "./capacity";
import type { ArenaInputCompiler } from "./input";
import { NativeArenaExecution } from "./nativeExecution";
import { mediaFolder } from "./media";
import { publishedPayoutFilm } from "./payout";
import {
  publishedMediaTypes,
  commitMediaPublication,
  type MediaPublicationManifest
} from "./mediaPublication";

async function fixture(existsInitially = true, poolMax = 5) {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.ok(["/arena", "/yunipals_arena_test"].includes(parsed.pathname));
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    connectionTimeoutMillis: 1000
  });
  await migrateArena(pool);
  const contract = `0x${randomBytes(20).toString("hex")}` as Address,
    deployment = `8453:${contract}`;
  const account = privateKeyToAccount(generatePrivateKey()),
    hash = (c: string) => `0x${c.repeat(64)}` as Hex;
  const zero = hash("0"),
    zeroAddress = `0x${"0".repeat(40)}`;
  let exists = existsInitially,
    openingHash = hash("a"),
    openingNumber = 1n,
    openingTx = hash("b"),
    head = 10n,
    complete = 10n,
    finalized = 0n,
    nonce = 0,
    finalityUnavailable = false,
    finalityReads = 0,
    estimate = 100000n;
  let onHealth: (() => void) | undefined;
  let loseBroadcast = false;
  const blocks = new Map<bigint, Hex>([
    [1n, openingHash],
    [2n, hash("2")],
    [10n, hash("9")]
  ]);
  const state: ArenaTournament = {
    id: "1",
    phase: "open",
    deadline: Math.floor(Date.now() / 1000) - 10,
    rulesHash: hash("c"),
    poolHash: hash("d"),
    treasury: account.address.toLowerCase() as Address,
    islandId: null,
    islandBeneficiary: null,
    requestId: null,
    randomWord: null,
    ticket: null,
    inputHash: null,
    commitments: null,
    resultHash: null,
    winners: null,
    videoHash: null,
    automaticStrategyMask: 0,
    seats: []
  };
  let last:
    | NonNullable<NativeArenaObservation["tournament"]>["last"]
    | undefined;
  let freeze: NonNullable<NativeArenaObservation["tournament"]>["inputFrozen"] =
    null;
  function observe(): NativeArenaObservation {
    const opened = {
      id: `${deployment}:${openingTx}:0`,
      transactionHash: openingTx,
      blockNumber: String(openingNumber),
      blockHash: openingHash,
      logIndex: 0
    };
    return {
      releaseId: hash("e"),
      sourceId: `arena:${deployment}`,
      indexedThroughBlock: String(complete),
      observedThroughBlock: String(head),
      tournament: exists
        ? {
            deployment,
            id: "1",
            state: structuredClone(state),
            opened,
            last: last ?? opened,
            inputFrozen: freeze,
            incarnation: manifestDigest({
              deployment,
              tournamentId: "1",
              openedEventId: opened.id,
              openedBlockHash: opened.blockHash
            })
          }
        : null
    };
  }
  const source = {
    read: async (
      id: string,
      options: { requiredThroughBlock?: bigint } = {}
    ) => {
      if (id === "0" && onHealth) {
        const action = onHealth;
        onHealth = undefined;
        action();
      }
      if (
        options.requiredThroughBlock !== undefined &&
        options.requiredThroughBlock > complete
      )
        throw new Error("still indexing required block");
      return id === "0" ? { ...observe(), tournament: null } : observe();
    },
    list: async () => ({ ...observe(), ids: exists ? ["1"] : [] }),
    work: async () => ({
      ...observe(),
      ids:
        exists && state.phase !== "expired" && state.videoHash === null
          ? ["1"]
          : []
    })
  };
  const broadcasts: Hex[] = [],
    receipts = new Map<string, TransactionReceipt>();
  const client = {
    getChainId: async () => 8453,
    getBlock: async (input: { blockTag?: string; blockNumber?: bigint }) => {
      if (input.blockTag === "finalized") finalityReads++;
      if (input.blockTag === "finalized" && finalityUnavailable)
        throw new Error("finality unavailable");
      const number =
        input.blockNumber ??
        (input.blockTag === "finalized" ? finalized : head);
      return {
        number,
        hash: blocks.get(number) ?? hash("f"),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      };
    },
    readContract: async (input: { functionName: string }) => {
      switch (input.functionName) {
        case "nextTournamentId":
          return exists ? 2n : 1n;
        case "entriesPaused":
          return false;
        case "lobbyOperator":
        case "referee":
          return account.address;
        case "publishedVideoHash":
          return state.videoHash ?? zero;
        case "automaticStrategyMask":
          return state.automaticStrategyMask ?? 0;
        case "tournament":
          return {
            phase: {
              open: 1,
              strategies: 2,
              resolving: 3,
              settled: 4,
              expired: 5
            }[state.phase],
            count: state.seats.length,
            deadline: BigInt(state.deadline),
            inputHash: state.inputHash ?? zero,
            resultHash: state.resultHash ?? zero,
            requestId: BigInt(state.requestId ?? "0"),
            randomnessReceived: state.randomWord !== null,
            randomWord: BigInt(state.randomWord ?? "0"),
            islandId: Number(state.islandId ?? "0"),
            islandBeneficiary: state.islandBeneficiary ?? zeroAddress,
            treasuryBeneficiary: state.treasury ?? zeroAddress,
            semifinalOneWinner: state.winners?.[0] ?? 0,
            semifinalTwoWinner: state.winners?.[1] ?? 0,
            champion: state.winners?.[2] ?? 0
          };
        default:
          throw new Error("Unexpected native action RPC");
      }
    },
    estimateGas: async () => estimate,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n
    }),
    getTransactionCount: async () => nonce,
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const value = receipts.get(hash);
      if (!value) throw new TransactionReceiptNotFoundError({ hash });
      return value;
    },
    sendRawTransaction: async ({
      serializedTransaction
    }: {
      serializedTransaction: Hex;
    }) => {
      broadcasts.push(serializedTransaction);
      if (loseBroadcast) {
        loseBroadcast = false;
        throw new Error("injected lost broadcast response");
      }
      return keccak256(serializedTransaction);
    }
  } as unknown as PublicClient;
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,1,'unified')",
    [deployment, contract]
  );
  const service = new ArenaIntake(
    pool,
    deployment,
    contract,
    "https://www.yunipals.com",
    new StrategyCipher(randomBytes(32)),
    { message: verifyMessage, strategy: verifyTypedData },
    source
  );
  const compiler = {} as ArenaInputCompiler;
  const capacity = new ArenaCapacity(pool, deployment, service);
  await capacity.save({
    runwareMicrousd: 100000000,
    openaiBudgetMicrousd: 100000000,
    openaiBudgetExpiresAt: Date.now() + 86400000,
    vrfAvailableWei: "100",
    vrfQuoteWei: "1",
    vrfMaxWei: "2",
    refereeGasWei: "10000000000000000",
    operatorGasWei: "10000000000000000",
    diskFreeBytes: 10000000000
  });
  const control = (signer: LocalAccount = account, storage?: string) =>
    new NativeArenaControl(
      service,
      compiler,
      client,
      signer,
      1000000000000n,
      capacity,
      storage
    );
  async function mine(
    intent: NativeIntent,
    status: "success" | "reverted" = "success",
    nextBlock = head,
    blockHash = blocks.get(nextBlock) ?? hash("8")
  ) {
    head = nextBlock;
    complete = head;
    blocks.set(head, blockHash);
    nonce = Number(intent.nonce) + 1;
    const call = decodeFunctionData({
      abi: arenaAbi,
      data: (await import("viem")).parseTransaction(intent.raw_transaction)
        .data!
    });
    let name = "TournamentExpired",
      args: Record<string, unknown> = { id: 1n };
    if (status === "success") {
      if (intent.purpose === "open-lobby") {
        exists = true;
        openingTx = intent.tx_hash;
        openingHash = blockHash;
        openingNumber = head;
        state.phase = "open";
        state.deadline = 0;
        name = "TournamentOpened";
        args = {
          id: 1n,
          rulesHash: state.rulesHash,
          poolHash: state.poolHash,
          deadline: 0n
        };
      } else if (intent.purpose === "settle") {
        state.phase = "settled";
        state.resultHash = call.args![1] as Hex;
        state.winners = [
          Number(call.args![2]),
          Number(call.args![3]),
          Number(call.args![4])
        ];
        name = "ResultSettled";
        args = {
          id: 1n,
          resultHash: state.resultHash,
          semifinalOneWinner: state.winners[0],
          semifinalTwoWinner: state.winners[1],
          champion: state.winners[2]
        };
      } else if (intent.purpose === "release-payouts") {
        state.videoHash = call.args![1] as Hex;
        name = "PayoutsReleased";
        args = { id: 1n, videoHash: state.videoHash };
      } else state.phase = "expired";
    }
    const item = arenaAbi.find(
      (item) => item.type === "event" && item.name === name
    )!;
    assert.equal(item.type, "event");
    const fields = item.inputs.filter((input) => !input.indexed);
    const topics = encodeEventTopics({
      abi: arenaAbi,
      eventName: name as "TournamentExpired",
      args
    });
    const data = encodeAbiParameters(
      fields,
      fields.map((input) => args[input.name!])
    );
    const log = {
      address: contract,
      topics,
      data,
      removed: false,
      logIndex: 0,
      transactionIndex: 0,
      transactionHash: intent.tx_hash,
      blockNumber: head,
      blockHash
    };
    const receipt = {
      transactionHash: intent.tx_hash,
      transactionIndex: 0,
      from: account.address,
      to: contract,
      blockNumber: head,
      blockHash,
      status,
      logs: status === "success" ? [log] : []
    } as unknown as TransactionReceipt;
    receipts.set(intent.tx_hash, receipt);
    if (status === "success")
      last = {
        id: `${deployment}:${intent.tx_hash}:0`,
        transactionHash: intent.tx_hash,
        blockNumber: String(head),
        blockHash,
        logIndex: 0
      };
    return receipt;
  }
  return {
    pool,
    service,
    client,
    account,
    state,
    control,
    capacity,
    observe,
    broadcasts,
    receipts,
    hash,
    mine,
    setComplete: (value: bigint) => {
      complete = value;
    },
    setFinalized: (value: bigint) => {
      finalized = value;
    },
    finalityReads: () => finalityReads,
    loseBroadcastOnce: () => {
      loseBroadcast = true;
    },
    setEstimate: (value: bigint) => {
      estimate = value;
    },
    rollbackOnNextHealth: () => {
      onHealth = () => {
        state.phase = "open";
        last = undefined;
      };
    },
    setFinalityUnavailable: () => {
      finalityUnavailable = true;
    },
    forkOpening: () => {
      openingHash = hash("7");
      blocks.set(openingNumber, openingHash);
      last = undefined;
    },
    orphan: (intent: NativeIntent, opening = false) => {
      receipts.delete(intent.tx_hash);
      nonce = Number(intent.nonce);
      blocks.set(head, hash("6"));
      if (opening) {
        exists = false;
        last = undefined;
      } else {
        state.phase = "open";
        last = undefined;
      }
    },
    resolving: () => {
      Object.assign(state, {
        phase: "resolving",
        deadline: Math.floor(Date.now() / 1000) + 3600,
        inputHash: hash("1"),
        commitments: [hash("3"), hash("3"), hash("3"), hash("3")],
        seats: Array.from({ length: 4 }, (_, seat) => ({
          seat,
          player: account.address.toLowerCase(),
          nftChainId: 8453,
          collection: contract,
          tokenId: String(seat + 1)
        }))
      });
      freeze = {
        id: `${deployment}:${hash("4")}:0`,
        transactionHash: hash("4"),
        blockNumber: "2",
        blockHash: hash("2"),
        logIndex: 0
      };
      last = freeze;
    },
    cleanup: async () => {
      for (const table of [
        "opening_action_observation",
        "transaction_receipt_history"
      ])
        await pool.query(
          `DELETE FROM yunipals_arena.${table} WHERE action_id IN (SELECT action_id FROM yunipals_arena.transaction_intent WHERE deployment=$1)`,
          [deployment]
        );
      for (const table of arenaPrivateTables)
        await pool.query(
          `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
          [deployment]
        );
      await pool.query(
        "DELETE FROM yunipals_arena.media_publication WHERE deployment=$1",
        [deployment]
      );
      await pool.query(
        "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
        [deployment]
      );
      await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
        deployment
      ]);
      await pool.end();
    }
  };
}

test("native pending lobby actions need no invented origin and retain receipts across re-inclusion", async () => {
  const f = await fixture(false);
  try {
    const control = f.control(),
      intent = await control.prepare("open-lobby", "1");
    assert.equal(intent.incarnation, null);
    await assert.rejects(
      f.pool.query(
        `INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash,incarnation)
      VALUES($1,'settle',1,$2,1,$3,$4,NULL)`,
        [
          f.service.deployment,
          f.account.address.toLowerCase(),
          intent.raw_transaction,
          intent.tx_hash
        ]
      ),
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23514"
    );
    const other = `8453:0x${randomBytes(20).toString("hex")}`;
    await f.pool.query(
      "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,1,'unified')",
      [other, other.slice(5)]
    );
    try {
      await assert.rejects(
        f.pool.query(
          `INSERT INTO yunipals_arena.transaction_intent(deployment,purpose,tournament_id,signer,nonce,raw_transaction,tx_hash,incarnation)
        VALUES($1,'open-lobby',1,$2,0,$3,$4,NULL)`,
          [
            other,
            f.account.address.toLowerCase(),
            intent.raw_transaction,
            intent.tx_hash
          ]
        ),
        (error: unknown) =>
          !!error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
      );
    } finally {
      await f.pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
        other
      ]);
    }
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.tournament_identity WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0].n,
      0
    );
    assert.equal((await control.advance("open-lobby", "1")).state, "submitted");
    assert.equal(f.broadcasts[0], intent.raw_transaction);
    await f.mine(intent);
    const accepted = await control.advance("open-lobby", "1");
    assert.equal(accepted.state, "confirmed");
    assert.equal(accepted.receipt_finalized, false);
    assert.equal(
      f.finalityReads(),
      0,
      "First latest-state acceptance must not wait on the finalized RPC tag"
    );
    f.orphan(intent, true);
    assert.equal((await control.advance("open-lobby", "1")).state, "submitted");
    assert.deepEqual(f.broadcasts, [
      intent.raw_transaction,
      intent.raw_transaction
    ]);
    await f.mine(intent, "success", 11n, f.hash("8"));
    f.setComplete(10n);
    await assert.rejects(control.advance("open-lobby", "1"), /still indexing/);
    f.setComplete(11n);
    assert.equal((await control.advance("open-lobby", "1")).state, "confirmed");
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.opening_action_observation WHERE action_id=$1",
          [intent.action_id]
        )
      ).rows[0].n,
      2
    );
    const history = (
      await f.pool.query(
        "SELECT block_number::text,canonical FROM yunipals_arena.transaction_receipt_history WHERE action_id=$1 ORDER BY block_number",
        [intent.action_id]
      )
    ).rows;
    assert.deepEqual(history, [
      { block_number: "10", canonical: false },
      { block_number: "11", canonical: true }
    ]);
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.transaction_intent SET raw_transaction='0x12' WHERE action_id=$1",
        [intent.action_id]
      ),
      /signed intent is immutable/
    );
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.transaction_receipt_history SET receipt='{}' WHERE action_id=$1",
        [intent.action_id]
      ),
      /receipt history is immutable/
    );
    f.setFinalized(11n);
    assert.equal(
      (await control.advance("open-lobby", "1")).receipt_finalized,
      true
    );
    f.setFinalityUnavailable();
    assert.equal(
      (await control.advance("open-lobby", "1")).receipt_finalized,
      true
    );
    f.receipts.delete(intent.tx_hash);
    await assert.rejects(
      control.advance("open-lobby", "1"),
      /finalized native receipt/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT halted FROM yunipals_arena.deployment WHERE id=$1",
          [f.service.deployment]
        )
      ).rows[0].halted,
      true
    );
  } finally {
    await f.cleanup();
  }
});

test("native control never rebroadcasts an old opening's intent into its replacement", async () => {
  const f = await fixture();
  try {
    const control = f.control(),
      intent = await control.prepare("expire", "1");
    assert.equal(intent.incarnation, f.observe().tournament!.incarnation);
    f.loseBroadcastOnce();
    await assert.rejects(
      control.advanceIntent(intent),
      /lost broadcast response/
    );
    await control.advanceIntent(intent);
    await f.mine(intent);
    assert.equal((await control.advanceIntent(intent)).state, "confirmed");
    f.orphan(intent);
    await control.advanceIntent(intent);
    assert.deepEqual(f.broadcasts, [
      intent.raw_transaction,
      intent.raw_transaction,
      intent.raw_transaction
    ]);
    f.forkOpening();
    assert.equal((await control.advanceIntent(intent)).state, "orphaned");
    assert.equal(f.broadcasts.length, 3);
    await assert.rejects(control.prepare("expire", "1"), /saved transaction/);
  } finally {
    await f.cleanup();
  }
});

test("native signing rejects an opening change without committing signed bytes", async () => {
  const f = await fixture();
  try {
    const signTransaction: LocalAccount["signTransaction"] = async (input) => {
      const raw = await f.account.signTransaction(input);
      f.forkOpening();
      return raw;
    };
    await assert.rejects(
      f.control({ ...f.account, signTransaction }).prepare("expire", "1"),
      /opening changed|state changed|head changed/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.transaction_intent WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0].n,
      0
    );
    assert.equal(f.broadcasts.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("native settlement uses only the current incarnation's disclosed and validated input", async () => {
  const f = await fixture();
  const storage = await mkdtemp("/tmp/yunipals-native-payout-test-");
  try {
    f.resolving();
    const context = await transaction(f.pool, (db) =>
      f.service.tournamentContext("1", db, true)
    );
    const proof = context.observation!.tournament.inputFrozen!;
    const candidate = { fixture: "retained deterministic candidate" },
      outcome = `0x${sha256(canonicalJson(candidate))}`;
    await f.pool.query(
      `INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,incarnation,input_hash,ciphertext,revealed_at,revealed_event_id,revealed_block_hash)
      VALUES($1,1,$2,$3,'fixture',now(),$4,$5)`,
      [
        f.service.deployment,
        context.incarnation,
        context.state.inputHash,
        proof.id,
        proof.blockHash
      ]
    );
    await f.pool.query(
      `INSERT INTO yunipals_arena.adjudication(deployment,tournament_id,incarnation,input_hash,outcome_hash,candidate,validation,state,winners)
      VALUES($1,1,$2,$3,$4,$5,$6,'valid','[0,2,0]')`,
      [
        f.service.deployment,
        context.incarnation,
        context.state.inputHash,
        outcome,
        candidate,
        { valid: true, errors: [], matches: [] }
      ]
    );
    const settlement = new NativeArenaSettlement(
      f.service,
      f.client,
      f.account,
      1000000000000n
    );
    const intent = await settlement.prepare("1");
    assert.equal(intent.incarnation, context.incarnation);
    await settlement.advanceIntent(intent);
    await f.mine(intent);
    assert.equal((await settlement.advanceIntent(intent)).state, "confirmed");
    const settled = await f.service.tournamentContext("1");
    const bytes = Buffer.from("fixture published film");
    const filmHash = sha256(bytes.toString("utf8"));
    await f.pool.query(
      "INSERT INTO yunipals_arena.media_job(deployment,tournament_id,incarnation,input_hash,outcome_hash) VALUES($1,1,$2,$3,$4)",
      [
        f.service.deployment,
        context.incarnation,
        settled.state.inputHash,
        settled.state.resultHash
      ]
    );
    const oldFolder = mediaFolder(
      join(storage, "published"),
      f.service.deployment,
      "1"
    );
    await mkdir(oldFolder, { recursive: true });
    await writeFile(
      join(oldFolder, "film.mp4"),
      "a different origin's old film"
    );
    await assert.rejects(
      publishedPayoutFilm(f.pool, f.service.deployment, "1", storage, settled),
      /completed published film/
    );
    const folder = mediaFolder(
      join(storage, "published"),
      f.service.deployment,
      "1",
      context.incarnation
    );
    await mkdir(folder, { recursive: true });
    const files: MediaPublicationManifest["files"] = {};
    for (const name of Object.keys(publishedMediaTypes)) {
      await writeFile(join(folder, name), bytes);
      files[name] = { sha256: filmHash, bytes: bytes.length };
    }
    const manifest: MediaPublicationManifest = {
      version: 1,
      deployment: f.service.deployment,
      tournamentId: "1",
      incarnation: context.incarnation,
      inputHash: settled.state.inputHash!,
      outcomeHash: settled.state.resultHash!,
      filmSha256: filmHash,
      files
    };
    const publicationHash = `0x${sha256(canonicalJson(manifest))}`;
    const observed = settled.observation!;
    await transaction(f.pool, (db) =>
      commitMediaPublication(
        db,
        f.service,
        { manifest, publicationHash },
        {
          deployment: f.service.deployment,
          tournamentId: "1",
          incarnation: context.incarnation,
          releaseId: observed.releaseId,
          openedEventId: observed.tournament.opened.id,
          openedBlockHash: observed.tournament.opened.blockHash,
          frozenEventId: observed.tournament.inputFrozen!.id,
          frozenBlockHash: observed.tournament.inputFrozen!.blockHash,
          inputHash: manifest.inputHash,
          resultHash: manifest.outcomeHash
        }
      )
    );
    assert.equal(
      await publishedPayoutFilm(
        f.pool,
        f.service.deployment,
        "1",
        storage,
        settled
      ),
      `0x${filmHash}`
    );
    // Dependent latest-state progress does not wait for the prior receipt to finalize.
    const payout = f.control(f.account, storage),
      release = await payout.prepare("release-payouts", "1");
    assert.equal(release.nonce, "1");
    await payout.advanceIntent(release);
    await f.mine(release);
    assert.equal((await payout.advanceIntent(release)).state, "confirmed");
    const legacy = new ArenaSettlement(
      f.pool,
      f.client,
      f.account,
      f.service.deployment,
      f.service.contract,
      1000000000000n
    );
    await assert.rejects(legacy.advance("1"), /Legacy settlement is fenced/);
    f.forkOpening();
    f.state.phase = "resolving";
    f.state.resultHash = null;
    f.state.winners = null;
    f.state.videoHash = null;
    await assert.rejects(settlement.prepare("1"), /validated candidate/);
    assert.equal(f.broadcasts.length, 2);
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.tournament WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await rm(storage, { recursive: true, force: true });
    await f.cleanup();
  }
});

test("native execution schedules control and resumes its durable pending intent without a public mirror", async () => {
  const f = await fixture();
  try {
    const control = f.control(),
      settlement = new NativeArenaSettlement(
        f.service,
        f.client,
        f.account,
        1000000000000n
      );
    const work = new NativeArenaExecution(
      f.service,
      f.account.address,
      "referee",
      control,
      settlement
    );
    const submitted = await work.tick();
    assert.equal(submitted?.purpose, "expire");
    assert.equal(submitted?.state, "submitted");
    await f.mine(submitted!);
    const accepted = await work.tick();
    assert.equal(accepted?.state, "confirmed");
    assert.equal(accepted?.receipt_finalized, false);
    assert.equal(await work.tick(), null);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("native capacity counts a replacement opening's new obligations and retains orphaned spending", async () => {
  const f = await fixture();
  try {
    const old = await transaction(f.pool, (db) =>
      f.service.tournamentContext("1", db, true)
    );
    await f.pool.query(
      `INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,incarnation,kind,asset,request_id,request,reserved_microusd,state)
      VALUES($1,1,$2,'referee','candidate-1',$3,'{}',700000,'completed')`,
      [f.service.deployment, old.incarnation, crypto.randomUUID()]
    );
    f.forkOpening();
    await f.pool.query(
      "UPDATE yunipals_arena.capacity SET snapshot=jsonb_set(snapshot,'{openaiBudgetMicrousd}','1000000') WHERE deployment=$1",
      [f.service.deployment]
    );
    await assert.rejects(f.capacity.check(false), /referee funds/);
  } finally {
    await f.cleanup();
  }
});

test("a reverted native lobby receipt consumes its nonce without inventing a tournament", async () => {
  const f = await fixture(false);
  try {
    const control = f.control(),
      intent = await control.prepare("open-lobby", "1");
    await control.advanceIntent(intent);
    await f.mine(intent, "reverted");
    assert.equal((await control.advanceIntent(intent)).state, "reverted");
    assert.equal(f.observe().tournament, null);
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM yunipals_arena.tournament_identity WHERE deployment=$1",
          [f.service.deployment]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await f.cleanup();
  }
});

test("native rebroadcast retains saved bytes when gas or the execution cap no longer permits the call", async () => {
  const f = await fixture();
  try {
    const control = f.control(),
      intent = await control.prepare("expire", "1");
    f.setEstimate(200000n);
    await assert.rejects(
      control.advanceIntent(intent),
      /no longer has enough gas/
    );
    f.setEstimate(100000n);
    const capped = new NativeArenaControl(
      f.service,
      {} as ArenaInputCompiler,
      f.client,
      f.account,
      1n
    );
    await assert.rejects(
      capped.advanceIntent(intent),
      /current execution fee cap/
    );
    const saved = (
      await f.pool.query(
        "SELECT state,raw_transaction FROM yunipals_arena.transaction_intent WHERE action_id=$1",
        [intent.action_id]
      )
    ).rows[0];
    assert.equal(saved.state, "prepared");
    assert.equal(saved.raw_transaction, intent.raw_transaction);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("native receipt acceptance rejects a source rollback after the RPC checks", async () => {
  const f = await fixture();
  try {
    const control = f.control(),
      intent = await control.prepare("expire", "1");
    await control.advanceIntent(intent);
    await f.mine(intent);
    f.rollbackOnNextHealth();
    await assert.rejects(
      control.advanceIntent(intent),
      /state changed during receipt acceptance/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT state FROM yunipals_arena.transaction_intent WHERE action_id=$1",
          [intent.action_id]
        )
      ).rows[0].state,
      "submitted"
    );
  } finally {
    await f.cleanup();
  }
});

test("native lobby capacity, signing and receipt reconciliation fit three connections", async () => {
  const f = await fixture(false, 3);
  try {
    const control = f.control();
    const intent = await control.prepare("open-lobby", "1");
    assert.equal(intent.state, "prepared");
    assert.equal((await control.advance("open-lobby", "1")).state, "submitted");
    await f.mine(intent);
    assert.equal((await control.advance("open-lobby", "1")).state, "confirmed");
  } finally {
    await f.cleanup();
  }
});
