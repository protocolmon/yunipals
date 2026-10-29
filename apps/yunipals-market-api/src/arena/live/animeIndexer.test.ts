import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  readAnimeFighter,
  readAnimeFighters
} from "@protopals/yunipals-indexer-server/anime";
import type {
  IndexerReader,
  SourceStatus
} from "@protopals/yunipals-indexer-server/readers";
import {
  manifestDigest,
  sourceManifestHash
} from "@protopals/yunipals-indexer-server/identity";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import { transaction } from "@/db/pool";
const h = (v: string) => `0x${v.repeat(64)}`;
test("registry reader binds FIFO pages, public notes and reapplication to complete canonical evidence", async () => {
  const connectionString =
    process.env.ARENA_TEST_DATABASE_URL ??
    "postgres://postgres:arena-local-test@127.0.0.1:55441/arena";
  const url = new URL(connectionString);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/arena");
  const pool = new pg.Pool({ connectionString, max: 3 });
  const schema = `anime_test_${randomBytes(4).toString("hex")}`;
  const registry = `0x${"1".repeat(40)}`,
    applicant = `0x${"2".repeat(40)}`;
  let stale = false;
  try {
    await pool.query(`CREATE SCHEMA ${schema};
   CREATE TABLE ${schema}._ponder_meta(key text,value jsonb);
   CREATE TABLE ${schema}._ponder_checkpoint(chain_id bigint,chain_name text,latest_checkpoint text,safe_checkpoint text,finalized_checkpoint text);
   CREATE TABLE ${schema}.chain_checkpoint(chain_id int,block_number bigint,block_hash text,parent_hash text,timestamp bigint);
   CREATE TABLE ${schema}.indexer_source(id text,chain_id int,manifest_hash text,definition text);
   CREATE TABLE ${schema}.anime_fighter(id text PRIMARY KEY,status int,recipe_version int,manifest_hash text,applicant text,applications int,reason_code int,note text,applied_block bigint,last_event_id text,block_number bigint,block_hash text);
   CREATE TABLE ${schema}.canonical_event(id text PRIMARY KEY,source_id text,chain_id int,address text,abi_hash text,name text,args text,block_number bigint,block_hash text,transaction_hash text,log_index int);`);
    const manifest = {
      version: 1 as const,
      ponderVersion: "0.17.5" as const,
      ordering: "multichain" as const,
      coverage: "ponder-live-blocks-v1" as const,
      sources: [
        {
          id: "anime-registry:8453",
          feature: "anime-registry" as const,
          chainId: 8453,
          contractName: "AnimeFighterRegistry",
          address: registry,
          startBlock: "1",
          endBlock: null,
          enabled: true,
          abiHash: manifestDigest(animeRegistryAbi),
          events: animeRegistryAbi
            .filter((e) => e.type === "event")
            .map((e) => e.name),
          receiptRequirement: "none" as const,
          policies: [
            { kind: "latest" as const },
            { kind: "depth" as const, subsequentBlocks: 5 }
          ]
        }
      ]
    };
    const release = {
      id: h("e"),
      schema,
      buildId: "anime-fixture",
      manifestHash: sourceManifestHash(manifest),
      manifest
    };
    const checkpoint =
      "0000000100" +
      String(8453).padStart(16, "0") +
      "100".padStart(16, "0") +
      "9".repeat(33);
    await pool.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
      {
        version: "6",
        build_id: release.buildId,
        heartbeat_at: Date.now(),
        is_locked: 1,
        is_ready: 1,
        is_dev: 0
      }
    ]);
    await pool.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES(8453,'base',$1,$1,$1)`,
      [checkpoint]
    );
    await pool.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,8453,$2,$3)`,
      [
        manifest.sources[0]!.id,
        release.manifestHash,
        JSON.stringify(manifest.sources[0])
      ]
    );
    const reader = {
      release,
      snapshot: async <T>(
        _id: string,
        _policy: unknown,
        read: (
          db: pg.PoolClient,
          context: { status: SourceStatus }
        ) => Promise<T>
      ) =>
        transaction(pool, (db) =>
          read(db, {
            status: {
              readiness: { reason: stale ? "stale" : "ready" },
              anchor: { number: "100", hash: h("a") }
            } as SourceStatus
          })
        )
    } as unknown as IndexerReader;
    async function insert(
      tokenId: string,
      block: number,
      status = 1,
      note: string | null = null,
      applications = 1
    ) {
      const tx = h("b"),
        log = Number(tokenId),
        eventId = `8453:${registry}:${tx}:${log}`;
      const name = ["None", "Applied", "Approved", "Rejected", "Revoked"][
        status
      ]!;
      const args =
        status === 1
          ? { tokenId, owner: applicant, application: applications }
          : { tokenId, reasonCode: 2, note };
      await pool.query(
        `INSERT INTO ${schema}.canonical_event VALUES($1,'anime-registry:8453',8453,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,args=EXCLUDED.args,block_number=EXCLUDED.block_number`,
        [
          eventId,
          registry,
          manifestDigest(animeRegistryAbi),
          name,
          JSON.stringify(args),
          block,
          h("a"),
          tx,
          log
        ]
      );
      await pool.query(
        `INSERT INTO ${schema}.anime_fighter VALUES($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$8,$10) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,applications=EXCLUDED.applications,reason_code=EXCLUDED.reason_code,note=EXCLUDED.note,applied_block=EXCLUDED.applied_block,block_number=EXCLUDED.block_number`,
        [
          tokenId,
          status,
          h("0"),
          applicant,
          applications,
          status === 1 ? null : 2,
          note,
          block,
          eventId,
          h("a")
        ]
      );
    }
    await insert("2", 80);
    await insert("10", 80);
    await insert("3", 90, 3, "Public curator note");
    const first = await readAnimeFighters(reader, {
      status: "Applied",
      limit: 1,
      registry
    });
    assert.equal(first.items[0]!.tokenId, "2");
    assert.equal(first.indexedThroughBlock, "100");
    assert.equal(first.counts.Rejected, 1);
    const second = await readAnimeFighters(reader, {
      status: "Applied",
      limit: 1,
      cursor: first.nextCursor!,
      registry
    });
    assert.equal(second.items[0]!.tokenId, "10");
    assert.equal(second.nextCursor, null);
    assert.equal(
      (await readAnimeFighter(reader, "3", registry)).fighter!.note,
      "Public curator note"
    );
    await insert("2", 95, 1, null, 2);
    assert.equal(
      (await readAnimeFighter(reader, "2", registry)).fighter!.queuePosition,
      2
    );
    await assert.rejects(
      readAnimeFighters(reader, {
        status: "Rejected",
        cursor: first.nextCursor!
      }),
      /cursor changed/
    );
    stale = true;
    await assert.rejects(readAnimeFighter(reader, "2"), /catching up/);
    stale = false;
    await pool.query(
      `UPDATE ${schema}.anime_fighter SET block_hash=$1 WHERE id='2'`,
      [h("f")]
    );
    await assert.rejects(
      readAnimeFighter(reader, "2"),
      /canonical event disagree/
    );
    await pool.query(
      `UPDATE ${schema}.anime_fighter SET block_hash=$1,block_number=101 WHERE id='2'`,
      [h("a")]
    );
    await assert.rejects(readAnimeFighters(reader), /indexing a block/);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
