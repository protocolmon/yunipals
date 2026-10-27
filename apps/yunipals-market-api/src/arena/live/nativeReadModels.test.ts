import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test, type TestContext } from "node:test";
import pg from "pg";
import type { Address, Hex } from "viem";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import {
  readArenaBrowse,
  type ArenaBrowseRequest
} from "@protopals/yunipals-indexer-server/arena";
import {
  manifestDigest,
  sourceManifestHash
} from "@protopals/yunipals-indexer-server/identity";
import type {
  IndexerReader,
  SourceStatus
} from "@protopals/yunipals-indexer-server/readers";
import { canonicalJson, sha256 } from "../draw";
import { transaction } from "@/db/pool";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { migrateArena } from "./schema";
import { NativeArenaReadModels } from "./nativeReadModels";
import { publishedMediaTypes } from "./mediaPublication";

// Separate, explicitly local database; never the production or shared Arena DB.
const connectionString =
  process.env.ARENA_READ_MODELS_TEST_DATABASE_URL ??
  "postgres://arena_readmodels_20261022:synthetic-local-arena-readmodels-only@127.0.0.1:56967/arena_readmodels_20261022";
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/arena_readmodels_20261022");
const pool = new pg.Pool({ connectionString, max: 6 });
type RegisteredRelease = IndexerReader["release"];
const h = (byte: string) => `0x${byte.repeat(64)}` as Hex;
const wallet = `0x${"1".repeat(40)}` as Address;
const other = `0x${"2".repeat(40)}` as Address;
const collection = `0x${"3".repeat(40)}` as Address;
before(async () => {
  await migrateArena(pool);
});
after(async () => {
  await pool.end();
});

async function fixture(t: TestContext) {
  const contract = `0x${randomBytes(20).toString("hex")}` as Address;
  const deployment = `8453:${contract}`,
    sourceId = `arena:${deployment}`;
  const schema = `arena_reads_${randomBytes(5).toString("hex")}`;
  await pool.query(`CREATE SCHEMA ${schema};
    CREATE TABLE ${schema}._ponder_meta(key text PRIMARY KEY,value jsonb);
    CREATE TABLE ${schema}._ponder_checkpoint(chain_id bigint,chain_name text,latest_checkpoint text,safe_checkpoint text,finalized_checkpoint text);
    CREATE TABLE ${schema}.chain_checkpoint(chain_id int,block_number bigint,block_hash text,parent_hash text,timestamp bigint);
    CREATE TABLE ${schema}.indexer_source(id text,chain_id int,manifest_hash text,definition text);
    CREATE TABLE ${schema}.chain_block(chain_id int,block_number bigint,block_hash text);
    CREATE TABLE ${schema}.arena_tournament(deployment text,tournament_id text,state jsonb,opened_event_id text,opened_block_hash text,last_event_id text,block_number bigint,block_hash text);
    CREATE TABLE ${schema}.arena_credit(deployment text,wallet text,amount numeric,last_event_id text,block_number bigint,block_hash text);
    CREATE TABLE ${schema}.canonical_event(id text,source_id text,chain_id int,address text,abi_hash text,name text,args text,block_number bigint,block_hash text,transaction_hash text,transaction_index int,log_index int);`);
  const definition = {
    contract,
    startBlock: "1",
    abiHash: manifestDigest(arenaAbi)
  };
  const manifest = {
    version: 1 as const,
    ponderVersion: "0.17.5" as const,
    ordering: "multichain" as const,
    coverage: "ponder-live-blocks-v1" as const,
    sources: [
      {
        id: sourceId,
        feature: "arena" as const,
        chainId: 8453,
        contractName: "Arena",
        address: contract,
        startBlock: "1",
        endBlock: null,
        enabled: true,
        abiHash: definition.abiHash,
        events: [
          "TournamentOpened",
          "InputFrozen",
          "PayoutsReleased",
          "TournamentExpired",
          "Claimed"
        ],
        receiptRequirement: "none" as const,
        policies: [{ kind: "latest" as const }]
      }
    ]
  };
  const release: RegisteredRelease = {
    id: h("e"),
    schema,
    buildId: "native-read-model-fixture",
    manifestHash: sourceManifestHash(manifest),
    manifest
  };
  const checkpoint =
    "0000000100" +
    String(8453).padStart(16, "0") +
    "100".padStart(16, "0") +
    "9".repeat(16) +
    "9" +
    "9".repeat(16);
  await pool.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
    {
      version: "6",
      build_id: release.buildId,
      heartbeat_at: Date.now(),
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    }
  ]);
  await pool.query(
    `INSERT INTO ${schema}._ponder_checkpoint VALUES(8453,'base',$1,$1,$1)`,
    [checkpoint]
  );
  await pool.query(
    `INSERT INTO ${schema}.indexer_source VALUES($1,8453,$2,$3)`,
    [sourceId, release.manifestHash, JSON.stringify(manifest.sources[0])]
  );
  await pool.query(`INSERT INTO ${schema}.chain_block VALUES(8453,100,$1)`, [
    h("a")
  ]);
  await pool.query(
    "INSERT INTO yunipals_arena.deployment(id,contract,start_block,indexer_mode) VALUES($1,$2,1,'unified')",
    [deployment, contract]
  );
  let stale = false;
  const requests: ArenaBrowseRequest[] = [];
  const reader = {
    release,
    snapshot: async <T>(
      _id: string,
      _policy: unknown,
      read: (db: pg.PoolClient, context: { status: SourceStatus }) => Promise<T>
    ) =>
      transaction(pool, async (db) => {
        await db.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
        );
        const status = {
          readiness: { reason: stale ? "stale" : "ready" },
          anchor: { number: "100", hash: h("a") }
        } as SourceStatus;
        return read(db, { status });
      })
  } as unknown as IndexerReader;
  const source = {
    read: async () => {
      throw new Error(
        "The public adapter must use browse, not a legacy/private state lookup."
      );
    },
    browse: async (request: ArenaBrowseRequest) => {
      requests.push(structuredClone(request));
      return readArenaBrowse(reader, definition, request);
    }
  };
  const service = new ArenaIntake(
    pool,
    deployment,
    contract,
    "https://example.invalid",
    new StrategyCipher(randomBytes(32)),
    { message: async () => false, strategy: async () => false },
    source
  );
  const models = new NativeArenaReadModels(service);
  const event = async (
    id: string,
    name: string,
    block: number,
    args: Record<string, unknown>
  ) => {
    const tx = `0x${randomBytes(32).toString("hex")}` as Hex,
      blockHash = h(String(block));
    const eventId = `${deployment}:${tx}:0`;
    await pool.query(
      `INSERT INTO ${schema}.canonical_event VALUES($1,$2,8453,$3,$4,$5,$6,$7,$8,$9,0,0)`,
      [
        eventId,
        sourceId,
        contract,
        definition.abiHash,
        name,
        JSON.stringify(args),
        block,
        blockHash,
        tx
      ]
    );
    return {
      id: eventId,
      blockNumber: String(block),
      blockHash,
      transactionHash: tx,
      logIndex: 0
    };
  };
  const add = async (id: string, changes: Partial<ArenaTournament> = {}) => {
    const state: ArenaTournament = {
      id,
      phase: "open",
      deadline: 100,
      rulesHash: h("c"),
      poolHash: h("d"),
      treasury: wallet,
      islandId: "17",
      islandBeneficiary: wallet,
      requestId: null,
      randomWord: null,
      ticket: null,
      seats: [wallet, wallet, other, contract].map((player, seat) => ({
        seat,
        player,
        nftChainId: 8453,
        collection,
        tokenId: String(seat + 1)
      })),
      inputHash: null,
      commitments: null,
      resultHash: null,
      winners: null,
      videoHash: null,
      automaticStrategyMask: 0,
      ...changes
    };
    const opened = await event(id, "TournamentOpened", 1, { id });
    let frozen = null;
    if (state.inputHash)
      frozen = await event(id, "InputFrozen", 2, {
        id,
        inputHash: state.inputHash,
        strategyCommitments: state.commitments
      });
    const last =
      state.phase === "expired"
        ? await event(id, "TournamentExpired", 3, { id })
        : state.videoHash
          ? await event(id, "PayoutsReleased", 5, { id })
          : (frozen ?? opened);
    const incarnation = manifestDigest({
      deployment,
      tournamentId: id,
      openedEventId: opened.id,
      openedBlockHash: opened.blockHash
    });
    await pool.query(
      `INSERT INTO ${schema}.arena_tournament VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        deployment,
        id,
        state,
        opened.id,
        opened.blockHash,
        last.id,
        last.blockNumber,
        last.blockHash
      ]
    );
    await pool.query(
      `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context) VALUES($1,$2,$3,$4,$5,$6,now(),'synthetic')`,
      [deployment, id, incarnation, opened.id, opened.blockHash, release.id]
    );
    return { state, incarnation, opened, frozen };
  };
  t.after(async () => {
    for (const table of [
      "media_job",
      "media_publication",
      "adjudication",
      "frozen_input",
      "submission",
      "fighter_snapshot",
      "tournament_identity",
      "tournament",
      "chain_event",
      "credit",
      "source_selection"
    ])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [deployment]
      );
    await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
      deployment
    ]);
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  });
  return {
    schema,
    deployment,
    models,
    service,
    source,
    requests,
    release,
    add,
    event,
    setStale: (value: boolean) => {
      stale = value;
    }
  };
}

test("native PostgreSQL pages, summaries, wallet totals, rewards and island history ignore contradictory legacy projections", async (t) => {
  const f = await fixture(t);
  await f.add("1", { phase: "settled", winners: [0, 1, 0], videoHash: h("f") });
  await f.add("2", { phase: "expired" });
  await f.add("3", { phase: "settled", winners: [0, 1, 0] });
  const claimed = await f.event("0", "Claimed", 6, {
    player: wallet,
    recipient: other,
    amount: "700"
  });
  await pool.query(
    `INSERT INTO ${f.schema}.arena_credit VALUES($1,$2,123,$3,6,$4)`,
    [f.deployment, wallet, claimed.id, claimed.blockHash]
  );
  await pool.query(
    "UPDATE yunipals_arena.deployment SET indexer_mode='legacy' WHERE id=$1",
    [f.deployment]
  );
  await pool.query("INSERT INTO yunipals_arena.tournament VALUES($1,999,$2)", [
    f.deployment,
    { id: "999", phase: "expired", seats: [] }
  ]);
  await pool.query("INSERT INTO yunipals_arena.credit VALUES($1,$2,999999)", [
    f.deployment,
    wallet
  ]);
  await pool.query(
    "UPDATE yunipals_arena.deployment SET indexer_mode='unified' WHERE id=$1",
    [f.deployment]
  );
  const first = await f.models.tournaments({}, { limit: 2 });
  assert.deepEqual(
    first.items.map((r) => r.id),
    ["3", "2"]
  );
  assert.ok(first.nextCursor);
  assert.deepEqual(
    (
      await f.models.tournaments({}, { limit: 2, cursor: first.nextCursor! })
    ).items.map((r) => r.id),
    ["1"]
  );
  const totals = await f.models.wallet(wallet);
  assert.deepEqual(
    {
      seats: totals.enteredSeats,
      entries: totals.enteredTournaments,
      host: totals.hostedTournaments,
      won: totals.championships
    },
    { seats: 6, entries: 3, host: 3, won: 2 }
  );
  assert.deepEqual(
    [
      totals.entryPayments,
      totals.winnings,
      totals.hostingRewards,
      totals.operationsRewards,
      totals.refunds,
      totals.pending,
      totals.withdrawals,
      totals.available
    ],
    [
      "12000000",
      "6000000",
      "400000",
      "1600000",
      "4000000",
      "8000000",
      "700",
      "123"
    ]
  );
  const rewards = await f.models.rewards(wallet);
  assert.deepEqual(
    rewards.items.map((r) => r.kind),
    ["withdrawal", "winner", "host", "operations", "refund"]
  );
  assert.equal(rewards.items[0]!.tournamentId, null);
  assert.equal(rewards.items[0]!.recipient, other);
  assert.deepEqual(
    (await f.models.timeline("1")).map((e) => e.event),
    ["TournamentOpened", "PayoutsReleased"]
  );
  const island = await f.models.island("17", { limit: 1 });
  assert.equal(island.hostedTournaments, 3);
  assert.equal(island.items[0]!.id, "3");
  assert.equal(island.releasedRewards, "400000");
  assert.equal(island.pendingRewards, "400000");
  assert.ok(f.requests.slice(1).some((r) => r.cursorAnchor?.hash === h("a")));
});

test("native PostgreSQL private enrichments bind incarnation, actual roster wallet and NFT snapshot checksum", async (t) => {
  const f = await fixture(t),
    current = await f.add("1");
  for (const [seat, player] of [
    [0, other],
    [1, wallet],
    [2, other]
  ] as const)
    await pool.query(
      `INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext,incarnation) VALUES($1,1,$2,$3,$4,'0x00','synthetic',$5)`,
      [f.deployment, seat, player, h("b"), current.incarnation]
    );
  const snapshot = {
    chainId: 8453,
    collection,
    tokenId: "2",
    name: "Canonical companion",
    image: "https://example.invalid/real.png"
  };
  await pool.query(
    `INSERT INTO yunipals_arena.fighter_snapshot(deployment,tournament_id,nft_chain_id,collection,token_id,snapshot,snapshot_hash,incarnation) VALUES($1,1,8453,$2,2,$3,$4,$5)`,
    [
      f.deployment,
      collection,
      snapshot,
      sha256(canonicalJson(snapshot)),
      current.incarnation
    ]
  );
  const row = (await f.models.tournaments()).items[0]!;
  assert.deepEqual(row.submittedSeats, [1, 2]);
  assert.equal(row.fighters[1]!.name, "Canonical companion");
  assert.equal(row.fighters[0]!.image, null);
  // A valid same-ID reopening cannot inherit the orphaned opening's private rows.
  await pool.query(
    `UPDATE ${f.schema}.canonical_event SET block_hash=$1 WHERE name='TournamentOpened'`,
    [h("9")]
  );
  await pool.query(
    `UPDATE ${f.schema}.arena_tournament SET opened_block_hash=$1,block_hash=$1`,
    [h("9")]
  );
  const reopened = (await f.models.tournaments()).items[0]!;
  assert.deepEqual(reopened.submittedSeats, []);
  assert.equal(reopened.fighters[1]!.image, null);
  await pool.query(
    `UPDATE ${f.schema}.canonical_event SET block_hash=$1 WHERE name='TournamentOpened'`,
    [h("1")]
  );
  await pool.query(
    `UPDATE ${f.schema}.arena_tournament SET opened_block_hash=$1,block_hash=$1`,
    [h("1")]
  );
  await pool.query(
    "UPDATE yunipals_arena.fighter_snapshot SET snapshot_hash='tampered' WHERE deployment=$1",
    [f.deployment]
  );
  await assert.rejects(f.models.tournaments(), /history is updating/);
});

test("native PostgreSQL media readiness requires canonical freeze evidence and valid matching publication", async (t) => {
  const f = await fixture(t),
    current = await f.add("1", {
      phase: "settled",
      inputHash: h("b"),
      resultHash: h("c"),
      commitments: [h("1"), h("2"), h("3"), h("4")],
      winners: [0, 1, 0]
    });
  const manifest = {
    version: 1,
    deployment: f.deployment,
    tournamentId: "1",
    incarnation: current.incarnation,
    inputHash: h("b"),
    outcomeHash: h("c"),
    filmSha256: "f".repeat(64),
    files: Object.fromEntries(
      Object.keys(publishedMediaTypes).map((name) => [
        name,
        { sha256: "f".repeat(64), bytes: 1 }
      ])
    )
  };
  const publication = `0x${sha256(canonicalJson(manifest))}`;
  const evidence = {
    deployment: f.deployment,
    tournamentId: "1",
    incarnation: current.incarnation,
    inputHash: h("b"),
    resultHash: h("c"),
    releaseId: f.release.id,
    openedEventId: current.opened.id,
    openedBlockHash: current.opened.blockHash,
    frozenEventId: current.frozen!.id,
    frozenBlockHash: current.frozen!.blockHash
  };
  await pool.query(
    `INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,input_hash,ciphertext,revealed_at,incarnation,revealed_event_id,revealed_block_hash) VALUES($1,1,$2,'synthetic',now(),$3,$4,$5)`,
    [
      f.deployment,
      h("b"),
      current.incarnation,
      current.frozen!.id,
      current.frozen!.blockHash
    ]
  );
  await pool.query(
    `INSERT INTO yunipals_arena.adjudication(deployment,tournament_id,input_hash,outcome_hash,candidate,validation,state,incarnation) VALUES($1,1,$2,$3,'{}','{}','valid',$4)`,
    [f.deployment, h("b"), h("c"), current.incarnation]
  );
  await pool.query(
    `INSERT INTO yunipals_arena.media_publication(deployment,tournament_id,incarnation,publication_hash,manifest,source_evidence) VALUES($1,1,$2,$3,$4,$5)`,
    [f.deployment, current.incarnation, publication, manifest, evidence]
  );
  await pool.query(
    `INSERT INTO yunipals_arena.media_job(deployment,tournament_id,state,film_sha256,incarnation,input_hash,outcome_hash,publication_hash) VALUES($1,1,'ready',$2,$3,$4,$5,$6)`,
    [
      f.deployment,
      manifest.filmSha256,
      current.incarnation,
      h("b"),
      h("c"),
      publication
    ]
  );
  for (const [seat, commitment] of [
    [0, h("9")],
    [1, h("2")]
  ] as const)
    await pool.query(
      `INSERT INTO yunipals_arena.submission(deployment,tournament_id,seat,wallet,commitment,signature,ciphertext,incarnation) VALUES($1,1,$2,$3,$4,'0x00','synthetic',$5)`,
      [f.deployment, seat, wallet, commitment, current.incarnation]
    );
  const published = (await f.models.tournaments()).items[0]!;
  assert.equal(published.videoReady, true);
  assert.deepEqual(published.submittedSeats, [1]);
  await pool.query(
    "UPDATE yunipals_arena.frozen_input SET revealed_block_hash=$2 WHERE deployment=$1",
    [f.deployment, h("9")]
  );
  assert.equal((await f.models.tournaments()).items[0]!.videoReady, false);
});

test("native PostgreSQL canonical cursor, source readiness and partial-block fences never use legacy fallback", async (t) => {
  const f = await fixture(t);
  await f.add("1");
  await f.add("2");
  const first = await f.models.tournaments({}, { limit: 1 });
  await assert.rejects(
    f.models.tournaments(
      { status: "completed" },
      { cursor: first.nextCursor! }
    ),
    /does not match/
  );
  await pool.query(
    `UPDATE ${f.schema}.chain_block SET block_hash=$1 WHERE block_number=100`,
    [h("9")]
  );
  await assert.rejects(
    f.models.tournaments({}, { cursor: first.nextCursor! }),
    /anchor changed/
  );
  await pool.query(
    `UPDATE ${f.schema}.chain_block SET block_hash=$1 WHERE block_number=100`,
    [h("a")]
  );
  f.setStale(true);
  await assert.rejects(f.models.wallet(wallet), /source unavailable/);
  f.setStale(false);
  await pool.query(
    `UPDATE ${f.schema}.arena_tournament SET block_number=101 WHERE tournament_id='1'`
  );
  await assert.rejects(f.models.tournaments(), /still indexing/);
});

test("native PostgreSQL canonical evidence corruption and selected operational source drift fail closed", async (t) => {
  const f = await fixture(t);
  await f.add("1");
  await pool.query(`UPDATE ${f.schema}.canonical_event SET abi_hash=$1`, [
    h("9")
  ]);
  await assert.rejects(f.models.wallet(wallet), /aggregate evidence/);
  await pool.query(`UPDATE ${f.schema}.canonical_event SET abi_hash=$1`, [
    manifestDigest(arenaAbi)
  ]);
  await pool.query(
    "UPDATE yunipals_arena.deployment SET indexer_mode='legacy' WHERE id=$1",
    [f.deployment]
  );
  await assert.rejects(
    f.models.rewards(wallet),
    /source selection is not ready/
  );
});
