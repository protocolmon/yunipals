import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import {
  encodeFunctionData,
  keccak256,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { strategyCommitment } from "@protopals/yunipals-market-core/arena";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { StrategyCipher } from "./crypto";
import { migrateArena } from "./schema";
import { projectEvent } from "./projection";
import { adoptLegacyTournamentIdentity } from "./tournamentIdentity";
import { ArenaIntake, ArenaRequestError } from "./intake";
import type { NativeArenaObservation } from "./nativeSource";
import { ArenaRollbackSource, arenaRollbackSourceId } from "./rollbackSource";
import { ArenaSourceSwitch, arenaSourceSwitchVerifier } from "./sourceSwitch";
import { selectedArenaSource } from "./sourceSelection";
import { NativeArenaProvider } from "./nativeProvider";
import { ArenaRefereeApi, refereeRequest } from "./refereeApi";
import { NativeArenaTransactions } from "./nativeTransactions";
import { verifyNativeArenaAction } from "./nativeAction";
import { arenaMediaRead } from "./mediaRead";
import { createArenaApp } from "./http";
import { mediaFolder } from "./mediaPaths";
import {
  commitMediaPublication,
  publishedMediaTypes,
  type MediaPublicationManifest
} from "./mediaPublication";

async function fixture() {
  const url =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
  assert.equal(parsed.pathname, "/arena");
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  await migrateArena(pool);
  const hash = () => `0x${randomBytes(32).toString("hex")}` as Hex,
    address = () => `0x${randomBytes(20).toString("hex")}` as Address;
  const contract = address(),
    deployment = `8453:${contract}`,
    nativeRelease = hash(),
    rollbackId = hash(),
    headHash = hash();
  const cipher = new StrategyCipher(randomBytes(32));
  const storage = await mkdtemp("/tmp/yunipals-arena-rollback-");
  const blocks = new Map<bigint, Hex>([[100n, headHash]]);
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,cursor,cursor_hash,finalized_at) VALUES($1,$2,1,100,$3,now())",
    [deployment, contract, headHash]
  );
  let blockNumber = 0n;
  async function event(
    id: string,
    eventName: string,
    args: Record<string, unknown>
  ) {
    blockNumber++;
    const blockHash = hash();
    blocks.set(blockNumber, blockHash);
    await transaction(pool, (db) =>
      projectEvent(db, deployment, {
        blockNumber,
        blockHash,
        transactionHash: hash(),
        logIndex: 0,
        eventName,
        args: { id, ...args }
      })
    );
  }
  const inputs = new Map<string, unknown>();
  for (const id of ["1", "2", "3"]) {
    await event(id, "TournamentOpened", {
      rulesHash: hash(),
      poolHash: hash(),
      deadline: Math.floor(Date.now() / 1000) - 60
    });
    if (id === "3") continue;
    await event(id, "TournamentTreasuryAssigned", { beneficiary: address() });
    const strategies = [];
    for (let seat = 0; seat < 4; seat++) {
      const player = address(),
        salt = hash(),
        text = `Strategy ${id}/${seat}`,
        commitment = strategyCommitment(contract, BigInt(id), seat, text, salt),
        signature = hash();
      await event(id, "Entered", {
        seat,
        player,
        nftChainId: 8453,
        collection: address(),
        tokenId: String(seat + 1)
      });
      await pool.query(
        "INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          deployment,
          id,
          seat,
          player,
          commitment,
          signature,
          cipher.seal(`${deployment}/${id}/seat/${seat}`, { text, salt })
        ]
      );
      strategies.push({
        seat,
        text,
        salt,
        commitment,
        signature,
        source: "player"
      });
    }
    await event(id, "IslandRequested", { requestId: id });
    await event(id, "RandomnessReceived", { word: "42" });
    await event(id, "IslandSelected", {
      islandId: "17",
      ticket: 42,
      beneficiary: address()
    });
    await event(id, "StrategiesOpened", {
      deadline: Math.floor(Date.now() / 1000) + 3600
    });
    const input = { id, fixture: "rollback" },
      inputHash = `0x${sha256(canonicalJson(input))}`;
    inputs.set(id, input);
    await pool.query(
      "INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,input_hash,ciphertext) VALUES($1,$2,$3,$4)",
      [
        deployment,
        id,
        inputHash,
        cipher.seal(`${deployment}/${id}/input`, { input, strategies })
      ]
    );
    await event(id, "InputFrozen", {
      inputHash,
      strategyCommitments: strategies.map((s) => s.commitment),
      deadline: Math.floor(Date.now() / 1000) + 3600
    });
    if (id === "2") {
      const candidate = { id, film: "accepted" },
        outcomeHash = `0x${sha256(canonicalJson(candidate))}`;
      await pool.query(
        "INSERT INTO yunipals_arena.adjudication(deployment,tournament_id,input_hash,outcome_hash,candidate,validation,state,winners) VALUES($1,$2,$3,$4,$5,'{}','valid','[0,2,0]')",
        [deployment, id, inputHash, outcomeHash, candidate]
      );
      await event(id, "ResultSettled", {
        resultHash: outcomeHash,
        semifinalOneWinner: 0,
        semifinalTwoWinner: 2,
        champion: 0
      });
    }
  }
  const observations = new Map<
    string,
    NonNullable<NativeArenaObservation["tournament"]>
  >();
  for (const id of ["1", "2", "3"]) {
    const state = (
      await pool.query(
        "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2",
        [deployment, id]
      )
    ).rows[0]!.state;
    const events = (
      await pool.query(
        "SELECT * FROM yunipals_arena.chain_event WHERE deployment=$1 AND args->>'id'=$2 ORDER BY block_number,log_index",
        [deployment, id]
      )
    ).rows;
    const proof = (e: (typeof events)[number]) => ({
      id: `${deployment}:${e.transaction_hash}:${e.log_index}`,
      blockNumber: String(e.block_number),
      blockHash: e.block_hash,
      transactionHash: e.transaction_hash,
      logIndex: e.log_index
    });
    const opened = proof(events[0]!),
      freeze = events.find((e) => e.event_name === "InputFrozen");
    observations.set(id, {
      deployment,
      id,
      state,
      opened,
      last: proof(events.at(-1)!),
      inputFrozen: freeze ? proof(freeze) : null,
      incarnation: manifestDigest({
        deployment,
        tournamentId: id,
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      })
    });
  }
  const nft = observations.get("1")!.state.seats[0]!;
  await pool.query(
    `INSERT INTO yunipals_arena.admission(deployment,tournament_id,wallet,nft_chain_id,collection,token_id,ownership_block,ownership_hash,expiry,signature)
    VALUES($1,1,$2,$3,$4,$5,100,$6,$7,$8)`,
    [
      deployment,
      nft.player,
      nft.nftChainId,
      nft.collection,
      nft.tokenId,
      headHash,
      Math.floor(Date.now() / 1000) + 3600,
      hash()
    ]
  );
  const snapshot = { displayName: "Retained fighter", fixture: "rollback" };
  await pool.query(
    `INSERT INTO yunipals_arena.fighter_snapshot(deployment,tournament_id,nft_chain_id,collection,token_id,snapshot,snapshot_hash)
    VALUES($1,1,$2,$3,$4,$5,$6)`,
    [
      deployment,
      nft.nftChainId,
      nft.collection,
      nft.tokenId,
      snapshot,
      manifestDigest(snapshot)
    ]
  );
  const schema = `arena_rollback_${randomBytes(8).toString("hex")}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const table of ["deployment", "tournament", "chain_event", "credit"])
    await pool.query(
      `CREATE TABLE ${schema}.${table} AS SELECT * FROM yunipals_arena.${table} WHERE ${table === "deployment" ? "id" : "deployment"}=$1`,
      [deployment]
    );
  // Models a separate old database with actual PostgreSQL transactions and
  // tables. Runtime additionally verifies distinct physical database identity.
  const legacyPool = {
    connect: async () => {
      const db = await pool.connect();
      return new Proxy(db, {
        get(target, key) {
          if (key === "query")
            return (sql: string, parameters?: unknown[]) =>
              target.query(
                sql.replaceAll("yunipals_arena.", `${schema}.`),
                parameters
              );
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
  } as pg.Pool;
  let broadcasts: Hex[] = [];
  const account = privateKeyToAccount(generatePrivateKey());
  const client = {
    getChainId: async () => 8453,
    getBlock: async (request: { blockNumber?: bigint }) => ({
      number: request.blockNumber ?? 100n,
      hash: blocks.get(request.blockNumber ?? 100n),
      timestamp: BigInt(Math.floor(Date.now() / 1000))
    }),
    readContract: async (request: { functionName: string; args: bigint[] }) => {
      const state = observations.get(String(request.args[0]))!.state;
      if (request.functionName === "automaticStrategyMask")
        return state.automaticStrategyMask ?? 0;
      if (request.functionName === "publishedVideoHash")
        return state.videoHash ?? `0x${"0".repeat(64)}`;
      return {
        phase: { open: 1, strategies: 2, resolving: 3, settled: 4, expired: 5 }[
          state.phase
        ],
        count: state.seats.length,
        deadline: BigInt(state.deadline),
        inputHash: state.inputHash ?? `0x${"0".repeat(64)}`,
        resultHash: state.resultHash ?? `0x${"0".repeat(64)}`,
        requestId: BigInt(state.requestId ?? "0"),
        randomnessReceived: state.randomWord !== null,
        randomWord: BigInt(state.randomWord ?? "0"),
        islandId: BigInt(state.islandId ?? "0"),
        islandBeneficiary: state.islandBeneficiary ?? `0x${"0".repeat(40)}`,
        treasuryBeneficiary: state.treasury ?? `0x${"0".repeat(40)}`,
        semifinalOneWinner: state.winners?.[0] ?? 0,
        semifinalTwoWinner: state.winners?.[1] ?? 0,
        champion: state.winners?.[2] ?? 0
      };
    },
    estimateGas: async () => 100000n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 1n
    }),
    getTransactionCount: async () => 0,
    getTransactionReceipt: async () => {
      throw new TransactionReceiptNotFoundError({ hash: hash() });
    },
    sendRawTransaction: async ({
      serializedTransaction
    }: {
      serializedTransaction: Hex;
    }) => {
      broadcasts.push(serializedTransaction);
      return keccak256(serializedTransaction);
    }
  } as unknown as PublicClient;
  const read = async (id: string): Promise<NativeArenaObservation> => ({
    releaseId: nativeRelease,
    sourceId: `arena:${deployment}`,
    indexedThroughBlock: "100",
    observedThroughBlock: "100",
    tournament: structuredClone(observations.get(id) ?? null)
  });
  const source = {
    read,
    list: async () => ({
      releaseId: nativeRelease,
      sourceId: `arena:${deployment}`,
      indexedThroughBlock: "100",
      observedThroughBlock: "100",
      ids: ["3", "2", "1"]
    })
  };
  await pool.query(
    "UPDATE yunipals_arena.deployment SET indexer_mode='unified',halted=true WHERE id=$1",
    [deployment]
  );
  for (const id of observations.keys())
    await transaction(pool, (db) =>
      adoptLegacyTournamentIdentity(db, {
        ...{
          releaseId: nativeRelease,
          sourceId: `arena:${deployment}`,
          indexedThroughBlock: "100",
          observedThroughBlock: "100"
        },
        tournament: observations.get(id)!
      })
    );
  await pool.query(
    "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
    [deployment]
  );
  const makeService = (
    native: typeof source | ArenaRollbackSource,
    binding?: Awaited<ReturnType<typeof selectedArenaSource>>
  ) =>
    new ArenaIntake(
      pool,
      deployment,
      contract,
      "https://www.yunipals.com",
      cipher,
      { message: async () => true, strategy: async () => true },
      native,
      binding
        ? {
            epoch: binding.epoch,
            kind: binding.kind,
            sourceId: binding.source_id
          }
        : undefined
    );
  const service = makeService(source);
  for (const id of ["1", "2"])
    assert.equal(
      await service.reconcileInputFrozen(id, (observed) =>
        verifyNativeArenaAction(client, observed)
      ),
      true
    );
  const context = await service.tournamentContext("2"),
    bytes = Buffer.from("preserved historical film"),
    filmHash = sha256(bytes.toString());
  const folder = mediaFolder(join(storage, "published"), deployment, "2");
  await mkdir(folder, { recursive: true });
  const files: MediaPublicationManifest["files"] = {};
  for (const name of Object.keys(publishedMediaTypes)) {
    await writeFile(join(folder, name), bytes);
    files[name] = { sha256: filmHash, bytes: bytes.length };
  }
  const manifest: MediaPublicationManifest = {
    version: 1,
    deployment,
    tournamentId: "2",
    incarnation: context.incarnation,
    inputHash: context.state.inputHash!,
    outcomeHash: context.state.resultHash!,
    filmSha256: filmHash,
    files
  };
  const publicationHash = manifestDigest(manifest);
  await pool.query(
    "INSERT INTO yunipals_arena.media_job(deployment,tournament_id,incarnation,input_hash,outcome_hash) VALUES($1,2,$2,$3,$4)",
    [deployment, context.incarnation, manifest.inputHash, manifest.outcomeHash]
  );
  await transaction(pool, (db) =>
    commitMediaPublication(
      db,
      service,
      { manifest, publicationHash },
      {
        deployment,
        tournamentId: "2",
        incarnation: context.incarnation,
        releaseId: nativeRelease,
        openedEventId: context.observation!.tournament.opened.id,
        openedBlockHash: context.observation!.tournament.opened.blockHash,
        frozenEventId: context.observation!.tournament.inputFrozen!.id,
        frozenBlockHash: context.observation!.tournament.inputFrozen!.blockHash,
        inputHash: manifest.inputHash,
        resultHash: manifest.outcomeHash
      }
    )
  );
  const rollback = new ArenaRollbackSource(
    legacyPool,
    rollbackId,
    contract,
    1n,
    { block: "100", hash: headHash },
    client
  );
  return {
    pool,
    contract,
    deployment,
    client,
    account,
    cipher,
    service,
    source,
    rollback,
    rollbackId,
    nativeRelease,
    headHash,
    observations,
    inputs,
    storage,
    schema,
    manifest,
    publicationHash,
    makeService,
    broadcasts,
    close: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
      await rm(storage, { recursive: true, force: true });
    }
  };
}

test("forward adoption and source rollback retain pending provider UUIDs, signed bytes and films", async () => {
  const f = await fixture();
  try {
    const origin = f.observations.get("1")!.incarnation;
    let posts = 0,
      gets = 0;
    const fetcher = (async (_url, options) => {
      if (options?.method === "POST") posts++;
      else gets++;
      return new Response(
        JSON.stringify({
          id: "resp_rollback_saved",
          status: options?.method === "POST" ? "queued" : "completed"
        })
      );
    }) as typeof fetch;
    const guard = (service: ArenaIntake) =>
      new NativeArenaProvider(
        service,
        (observed) => verifyNativeArenaAction(f.client, observed),
        async () => {}
      );
    const first = new ArenaRefereeApi(
      f.pool,
      "fixture-not-a-key",
      fetcher,
      guard(f.service)
    );
    await first.reserve(
      f.deployment,
      "1",
      refereeRequest(
        "fixture",
        {
          sourceInputSha256: f.observations.get("1")!.state.inputHash!.slice(2),
          input: f.inputs.get("1")
        },
        {}
      ),
      2000000,
      origin
    );
    await first.step(f.deployment, "1", origin);
    const pending = (
      await f.pool.query(
        "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.deployment]
      )
    ).rows[0]!;
    const before = new NativeArenaTransactions(
      f.service,
      f.client,
      f.account,
      1000000000000n
    );
    const build = async () =>
      encodeFunctionData({ abi: arenaAbi, functionName: "expire", args: [3n] });
    const signed = await before.prepare(
      "expire",
      "3",
      build,
      f.observations.get("3")!.incarnation
    );
    const clientHash = `0x${randomBytes(32).toString("hex")}`;
    await f.pool.query(
      "INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action,reader_mode,tournament_id,incarnation) VALUES($1,$2,$3,$4,'unified',1,$5)",
      [
        f.deployment,
        clientHash,
        f.account.address.toLowerCase(),
        { kind: "approval", tournamentId: "1", incarnation: origin },
        origin
      ]
    );
    const privateBefore = (
      await f.pool.query(
        "SELECT ciphertext,revealed_event_id,revealed_block_hash FROM yunipals_arena.frozen_input WHERE deployment=$1 ORDER BY tournament_id",
        [f.deployment]
      )
    ).rows;
    const fixedPrivate = async () =>
      Promise.all(
        [
          "submission",
          "admission",
          "fighter_snapshot",
          "adjudication",
          "media_publication"
        ].map(async (table) => [
          table,
          (
            await f.pool.query(
              `SELECT to_jsonb(t) AS body FROM yunipals_arena.${table} t WHERE deployment=$1 ORDER BY to_jsonb(t)::text`,
              [f.deployment]
            )
          ).rows
        ])
      );
    const fixedBefore = await fixedPrivate();
    await f.pool.query(
      "UPDATE yunipals_arena.provider_task SET actual_microusd=123456 WHERE request_id=$1",
      [pending.request_id]
    );
    const filmBefore = await arenaMediaRead(
      f.pool,
      f.deployment,
      f.storage,
      f.service
    ).status("2");
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
      [f.deployment]
    );
    const change = new ArenaSourceSwitch(
      f.service,
      { kind: "legacy_rollback", sourceId: f.rollbackId, source: f.rollback },
      f.client,
      arenaSourceSwitchVerifier(f.client)
    );
    const review = await change.run();
    assert.equal(review.applied, false);
    const apply = await change.run(review.reviewHash);
    assert.equal(apply.applied, true);
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.source_switch_history SET review='{}' WHERE deployment=$1",
        [f.deployment]
      ),
      /history is immutable/
    );
    await assert.rejects(
      f.pool.query(
        "DELETE FROM yunipals_arena.source_selection WHERE deployment=$1",
        [f.deployment]
      ),
      /history is immutable/
    );
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.source_selection SET epoch=$2 WHERE deployment=$1",
        [f.deployment, randomUUID()]
      ),
      /no matching immutable review/
    );
    await assert.rejects(f.service.assertSourceSelection(), /epoch changed/);
    await assert.rejects(
      first.step(f.deployment, "1", origin),
      /epoch changed/
    );
    await assert.rejects(before.advance(signed, build), /epoch changed/);
    const binding = await selectedArenaSource(f.pool, f.deployment),
      service = f.makeService(f.rollback, binding);
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
      [f.deployment]
    );
    const health = await (
      await createArenaApp(service, { entriesEnabled: false }).request(
        "/health"
      )
    ).json();
    assert.equal(health.sourceKind, "legacy_rollback");
    assert.equal(health.sourceEpoch, binding!.epoch);
    assert.equal((await service.tournamentContext("1")).incarnation, origin);
    assert.equal(
      (await service.tournamentContext("1")).cipherContext,
      `${f.deployment}/1`
    );
    assert.equal(
      await service.reconcileInputFrozen("1", (observed) =>
        verifyNativeArenaAction(f.client, observed)
      ),
      true
    );
    await new ArenaRefereeApi(
      f.pool,
      "fixture-not-a-key",
      fetcher,
      guard(service)
    ).step(f.deployment, "1", origin);
    const completed = (
      await f.pool.query(
        "SELECT * FROM yunipals_arena.provider_task WHERE request_id=$1",
        [pending.request_id]
      )
    ).rows[0]!;
    assert.equal(completed.state, "completed");
    assert.equal(completed.provider_id, pending.provider_id);
    assert.equal(completed.request_id, pending.request_id);
    assert.equal(completed.reserved_microusd, pending.reserved_microusd);
    assert.equal(completed.actual_microusd, "123456");
    assert.equal(posts, 1);
    assert.equal(gets, 1);
    const resumed = new NativeArenaTransactions(
      service,
      f.client,
      f.account,
      1000000000000n
    );
    const same = await resumed.prepare(
      "expire",
      "3",
      build,
      f.observations.get("3")!.incarnation
    );
    assert.equal(same.action_id, signed.action_id);
    assert.equal(same.raw_transaction, signed.raw_transaction);
    await resumed.advance(same, build);
    assert.deepEqual(f.broadcasts, [signed.raw_transaction]);
    assert.deepEqual(
      (
        await f.pool.query(
          "SELECT ciphertext,revealed_event_id,revealed_block_hash FROM yunipals_arena.frozen_input WHERE deployment=$1 ORDER BY tournament_id",
          [f.deployment]
        )
      ).rows,
      privateBefore
    );
    assert.deepEqual(await fixedPrivate(), fixedBefore);
    assert.deepEqual(
      await arenaMediaRead(f.pool, f.deployment, f.storage, service).status(
        "2"
      ),
      filmBefore
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT hash FROM yunipals_arena.client_transaction WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0]!.hash,
      clientHash
    );
    const proof = await f.rollback.transaction(
      f.observations.get("1")!.opened.transactionHash,
      {
        tournamentId: "1",
        blockNumber: BigInt(f.observations.get("1")!.opened.blockNumber),
        blockHash: f.observations.get("1")!.opened.blockHash
      }
    );
    assert.equal(proof.inclusion, "canonical");
    assert.equal(proof.origin!.incarnation, origin);
    assert.equal(proof.finalizedThroughBlock, null);
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
      [f.deployment]
    );
    const forward = new ArenaSourceSwitch(
      service,
      { kind: "unified", sourceId: f.nativeRelease, source: f.source },
      f.client,
      arenaSourceSwitchVerifier(f.client)
    );
    const resume = await forward.run();
    await forward.run(resume.reviewHash);
    await assert.rejects(service.assertSourceSelection(), /epoch changed/);
    const fresh = f.makeService(
      f.source,
      await selectedArenaSource(f.pool, f.deployment)
    );
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
      [f.deployment]
    );
    assert.equal((await fresh.tournamentContext("1")).incarnation, origin);
    assert.equal(
      (await arenaMediaRead(f.pool, f.deployment, f.storage, fresh).status("2"))
        .publication,
      f.publicationHash
    );
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
      [f.deployment]
    );
    assert.equal(apply.applied, true);
    if (!apply.applied) throw new Error("Expected applied rollback.");
    await assert.rejects(
      f.pool.query(
        `UPDATE yunipals_arena.source_selection SET epoch=$2,kind='legacy_rollback',source_id=$3,
      accepted_block=100,accepted_hash=$4,review_hash=$5 WHERE deployment=$1`,
        [f.deployment, apply.epoch, f.rollbackId, f.headHash, apply.reviewHash]
      ),
      /current predecessor/
    );
    await assert.rejects(
      f.pool.query(
        "UPDATE yunipals_arena.source_operational_cursor SET indexed_block=99 WHERE deployment=$1",
        [f.deployment]
      ),
      /floor cannot decrease/
    );
    await assert.rejects(
      f.pool.query(
        "DELETE FROM yunipals_arena.source_operational_cursor WHERE deployment=$1",
        [f.deployment]
      ),
      /floor cannot be deleted/
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT count(*)::integer AS n FROM yunipals_arena.source_switch_history WHERE deployment=$1",
          [f.deployment]
        )
      ).rows[0]!.n,
      2
    );
  } finally {
    await f.close();
  }
});

test("rollback source refuses stale/incomplete coverage, changed input and changed openings", async () => {
  const f = await fixture();
  try {
    await f.pool.query(
      `UPDATE ${f.schema}.deployment SET finalized_at=now()-interval '4 minutes'`
    );
    await assert.rejects(f.rollback.read("1"), /stale/);
    await f.pool.query(
      `UPDATE ${f.schema}.deployment SET finalized_at=now(),cursor=99`
    );
    await assert.rejects(f.rollback.read("1"), /below its accepted floor/);
    await f.pool.query(`UPDATE ${f.schema}.deployment SET cursor=100`);
    await assert.rejects(
      f.rollback.read("1", { requiredThroughBlock: 101n }),
      /required block/
    );
    await f.pool.query(
      `UPDATE ${f.schema}.tournament SET state=jsonb_set(state,'{inputHash}',to_jsonb($1::text)) WHERE id=1`,
      [`0x${"9".repeat(64)}`]
    );
    await assert.rejects(f.rollback.read("1"), /frozen input differs/);
    await f.pool.query(
      `UPDATE ${f.schema}.tournament SET state=$1 WHERE id=1`,
      [f.observations.get("1")!.state]
    );
    await f.pool.query(
      `UPDATE ${f.schema}.chain_event SET transaction_hash=$1 WHERE event_name='TournamentOpened' AND args->>'id'='1'`,
      [`0x${"8".repeat(64)}`]
    );
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
      [f.deployment]
    );
    const change = new ArenaSourceSwitch(
      f.service,
      { kind: "legacy_rollback", sourceId: f.rollbackId, source: f.rollback },
      f.client,
      async () => {}
    );
    await assert.rejects(change.run(), /changed an accepted opening/);
    assert.equal(await selectedArenaSource(f.pool, f.deployment), undefined);
  } finally {
    await f.close();
  }
});

test("source publication waits for a whole external action and rejects a changed review", async () => {
  const f = await fixture();
  try {
    let release!: () => void, started!: () => void;
    const running = new Promise<void>((resolve) => {
        started = resolve;
      }),
      done = new Promise<void>((resolve) => {
        release = resolve;
      });
    const api = new ArenaRefereeApi(
      f.pool,
      "fixture-not-a-key",
      (async () => {
        started();
        await done;
        return new Response(
          JSON.stringify({ id: "resp_source_lease", status: "queued" })
        );
      }) as typeof fetch,
      new NativeArenaProvider(
        f.service,
        (observed) => verifyNativeArenaAction(f.client, observed),
        async () => {}
      )
    );
    const origin = f.observations.get("1")!.incarnation;
    await api.reserve(
      f.deployment,
      "1",
      refereeRequest(
        "fixture",
        {
          sourceInputSha256: f.observations.get("1")!.state.inputHash!.slice(2)
        },
        {}
      ),
      2000000,
      origin
    );
    const held = api.step(f.deployment, "1", origin);
    await running;
    await f.pool.query(
      "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
      [f.deployment]
    );
    const change = new ArenaSourceSwitch(
      f.service,
      { kind: "legacy_rollback", sourceId: f.rollbackId, source: f.rollback },
      f.client,
      async () => {}
    );
    await assert.rejects(change.run(), /in-flight action/);
    const direct = await f.pool.connect();
    try {
      await direct.query("BEGIN");
      await direct.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(
        direct.query(
          `INSERT INTO yunipals_arena.source_selection(deployment,epoch,kind,source_id,accepted_block,accepted_hash,review_hash)
        VALUES($1,$2,'legacy_rollback',$3,100,$4,$4)`,
          [f.deployment, randomUUID(), f.rollbackId, f.headHash]
        ),
        (error: unknown) =>
          !!error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "55P03"
      );
    } finally {
      await direct.query("ROLLBACK");
      direct.release();
    }
    release();
    await held;
    const review = await change.run();
    await f.pool.query(
      "INSERT INTO yunipals_arena.client_transaction(deployment,hash,wallet,action,reader_mode) VALUES($1,$2,$3,'{\"kind\":\"claim\"}','unified')",
      [f.deployment, `0x${"a".repeat(64)}`, f.account.address.toLowerCase()]
    );
    await assert.rejects(change.run(review.reviewHash), /review changed/);
    assert.equal(await selectedArenaSource(f.pool, f.deployment), undefined);
    const request = (
      await f.pool.query(
        "SELECT provider_id,state FROM yunipals_arena.provider_task WHERE deployment=$1",
        [f.deployment]
      )
    ).rows[0]!;
    assert.deepEqual(request, {
      provider_id: "resp_source_lease",
      state: "queued"
    });
  } finally {
    await f.close();
  }
});

test("rollback source fingerprint excludes credentials but pins endpoint, deployment and ABI", () => {
  const contract = `0x${"1".repeat(40)}`;
  const first = arenaRollbackSourceId(
    "postgres://first:secret@127.0.0.1:5432/public?sslmode=disable",
    contract,
    1n
  );
  assert.equal(
    first,
    arenaRollbackSourceId(
      "postgres://second:different@127.0.0.1:5432/public?sslmode=require",
      contract,
      1n
    )
  );
  assert.notEqual(
    first,
    arenaRollbackSourceId(
      "postgres://first:secret@127.0.0.1:5432/other",
      contract,
      1n
    )
  );
  assert.notEqual(
    first,
    arenaRollbackSourceId(
      "postgres://first:secret@127.0.0.1:5433/public",
      contract,
      1n
    )
  );
});

test(
  "repeatable-read disclosure rolls back when its pre-lease snapshot predates a reviewed source switch",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    let resume!: () => void, pinned!: () => void;
    const released = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const snapshot = new Promise<void>((resolve) => {
      pinned = resolve;
    });
    let intercepted = false;
    let pending: Promise<boolean> | undefined;
    try {
      await f.pool.query(
        `UPDATE yunipals_arena.frozen_input SET revealed_at=NULL,revealed_event_id=NULL,revealed_block_hash=NULL WHERE deployment=$1 AND tournament_id=1`,
        [f.deployment]
      );
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
        [f.deployment]
      );
      const change = new ArenaSourceSwitch(
        f.service,
        { kind: "legacy_rollback", sourceId: f.rollbackId, source: f.rollback },
        f.client,
        arenaSourceSwitchVerifier(f.client)
      );
      const review = await change.run();
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
        [f.deployment]
      );
      const before = (
        await f.pool.query(
          "SELECT * FROM yunipals_arena.source_operational_cursor WHERE deployment=$1",
          [f.deployment]
        )
      ).rows;
      const delayedPool = new Proxy(f.pool, {
        get(target, key) {
          if (key === "connect")
            return async () => {
              const db = await target.connect();
              return new Proxy(db, {
                get(client, property) {
                  if (property === "query")
                    return async (sql: string, parameters?: unknown[]) => {
                      const result = await client.query(sql, parameters);
                      if (
                        !intercepted &&
                        sql ===
                          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
                      ) {
                        intercepted = true;
                        // The advisory-lock statement can capture this same old RR
                        // snapshot before waiting. Pin it explicitly so scheduling
                        // the source change remains deterministic in this test.
                        const old = await client.query<{ halted: boolean }>(
                          "SELECT halted FROM yunipals_arena.deployment WHERE id=$1",
                          [f.deployment]
                        );
                        assert.equal(old.rows[0]?.halted, false);
                        pinned();
                        await released;
                      }
                      return result;
                    };
                  const value = Reflect.get(client, property);
                  return typeof value === "function"
                    ? value.bind(client)
                    : value;
                }
              });
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      const old = new ArenaIntake(
        delayedPool,
        f.deployment,
        f.contract,
        "https://www.yunipals.com",
        f.cipher,
        { message: async () => true, strategy: async () => true },
        f.source
      );
      pending = old.reconcileInputFrozen("1", (observed) =>
        verifyNativeArenaAction(f.client, observed)
      );
      const settled = pending.then(
        () => {
          throw new Error("Disclosure completed before reaching its RR fence.");
        },
        (error: unknown) => {
          throw error;
        }
      );
      // Observe failures instead of leaving a detached rejection while the switch
      // runs. The snapshot branch wins during the intended schedule.
      await Promise.race([snapshot, settled]);
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
        [f.deployment]
      );
      assert.equal((await change.run(review.reviewHash)).applied, true);
      resume();
      await assert.rejects(
        pending,
        (error: unknown) =>
          !!error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "40001"
      );
      const proof = (
        await f.pool.query(
          "SELECT revealed_at,revealed_event_id,revealed_block_hash FROM yunipals_arena.frozen_input WHERE deployment=$1 AND tournament_id=1",
          [f.deployment]
        )
      ).rows[0];
      assert.deepEqual(proof, {
        revealed_at: null,
        revealed_event_id: null,
        revealed_block_hash: null
      });
      assert.deepEqual(
        (
          await f.pool.query(
            "SELECT * FROM yunipals_arena.source_operational_cursor WHERE deployment=$1",
            [f.deployment]
          )
        ).rows,
        before
      );
      const binding = await selectedArenaSource(f.pool, f.deployment);
      await assert.rejects(old.assertSourceSelection(), /epoch changed/);
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
        [f.deployment]
      );
      assert.equal(
        await f
          .makeService(f.rollback, binding)
          .reconcileInputFrozen("1", (observed) =>
            verifyNativeArenaAction(f.client, observed)
          ),
        true
      );
    } finally {
      resume();
      await pending?.catch(() => {});
      await f.close();
    }
  }
);

test(
  "public view rechecks the selected source after committing a pre-lease repeatable-read snapshot",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    let resume!: () => void, pinned!: () => void;
    const released = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const snapshot = new Promise<void>((resolve) => {
      pinned = resolve;
    });
    let intercepted = false;
    let pending: ReturnType<ArenaIntake["publicView"]> | undefined;
    try {
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
        [f.deployment]
      );
      const change = new ArenaSourceSwitch(
        f.service,
        { kind: "legacy_rollback", sourceId: f.rollbackId, source: f.rollback },
        f.client,
        arenaSourceSwitchVerifier(f.client)
      );
      const review = await change.run();
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
        [f.deployment]
      );
      const delayedPool = new Proxy(f.pool, {
        get(target, key) {
          if (key === "connect")
            return async () => {
              const db = await target.connect();
              return new Proxy(db, {
                get(client, property) {
                  if (property === "query")
                    return async (sql: string, parameters?: unknown[]) => {
                      const result = await client.query(sql, parameters);
                      if (
                        !intercepted &&
                        sql ===
                          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
                      ) {
                        intercepted = true;
                        const old = await client.query<{ halted: boolean }>(
                          "SELECT halted FROM yunipals_arena.deployment WHERE id=$1",
                          [f.deployment]
                        );
                        assert.equal(old.rows[0]?.halted, false);
                        pinned();
                        await released;
                      }
                      return result;
                    };
                  const value = Reflect.get(client, property);
                  return typeof value === "function"
                    ? value.bind(client)
                    : value;
                }
              });
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      const old = new ArenaIntake(
        delayedPool,
        f.deployment,
        f.contract,
        "https://www.yunipals.com",
        f.cipher,
        { message: async () => true, strategy: async () => true },
        f.source
      );
      pending = old.publicView("1");
      await Promise.race([
        snapshot,
        pending.then(() => {
          throw new Error("Public view returned before reaching its RR fence.");
        })
      ]);
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1",
        [f.deployment]
      );
      assert.equal((await change.run(review.reviewHash)).applied, true);
      resume();
      await assert.rejects(
        pending,
        (error: unknown) =>
          error instanceof ArenaRequestError &&
          error.status === 503 &&
          /source epoch changed/.test(error.message)
      );
      const binding = await selectedArenaSource(f.pool, f.deployment);
      await f.pool.query(
        "UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",
        [f.deployment]
      );
      const current = await f.makeService(f.rollback, binding).publicView("1");
      assert.equal(current.incarnation, f.observations.get("1")!.incarnation);
      assert.equal(current.phase, f.observations.get("1")!.state.phase);
      assert.equal(current.strategies?.length, 4);
      assert.equal(f.broadcasts.length, 0);
    } finally {
      resume();
      await pending?.catch(() => {});
      await f.close();
    }
  }
);
