import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import { EvolutionReader } from "../../../packages/yunipals-indexer-server/src/evolution.js";
import { manifestDigest } from "../../../packages/yunipals-indexer-server/src/identity.js";
import { migrateIndexerControl } from "../lib/unified/control-schema.js";
import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.js";

const address = (byte: string) => `0x${byte.repeat(20)}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const env = {
  BOOSTER_REGISTRY: address("31"),
  BOOSTER_ENGINE: address("32"),
  BOOSTER_MONSTERS: address("33"),
  BOOSTER_WRAPPER: address("34"),
  BOOSTER_DEPLOYMENT_BLOCK: "1",
  UNIFIED_PORTALS_JSON: JSON.stringify(
    Object.fromEntries(
      ["collection", "registry", "grading", "competition"].map((kind, i) => [
        kind,
        {
          address: address(String(51 + i)),
          startBlock: 1
        }
      ])
    )
  ),
  UNIFIED_EVOLUTION_JSON: JSON.stringify({
    cards: { address: address("33"), startBlock: 1 },
    adventures: { address: address("61"), startBlock: 1 },
    evolution: { address: address("62"), startBlock: 1 }
  })
};

it("adds the evolution ownership boundary without changing existing subscriptions or history", () => {
  const enabled = buildSourceManifest(env);
  const disabled = buildSourceManifest({
    ...env,
    UNIFIED_EVOLUTION_JSON: undefined
  });
  for (const before of disabled.sources) {
    const after = enabled.sources.find((source) => source.id === before.id)!;
    expect(after).toEqual(
      before.id === "boosters:boostermonsters"
        ? {
            ...before,
            policies: [
              ...before.policies,
              { kind: "depth", subsequentBlocks: 12 }
            ]
          }
        : before
    );
  }
  expect(sourceManifestHash(enabled)).not.toBe(sourceManifestHash(disabled));
});

it("reads a real registered evolution manifest and fails closed on missing coverage or a changed branch", async () => {
  const db = new PGlite();
  const query = async (sql: string, params?: unknown[]) => {
    const result = params
      ? await db.query(sql, params)
      : (await db.exec(sql)).at(-1)!;
    return { ...result, rowCount: result.rows.length };
  };
  const pool = {
    query,
    connect: async () => ({ query, release() {} })
  } as unknown as Pool;
  try {
    await migrateIndexerControl(pool);
    const manifest = buildSourceManifest(env);
    const identity = {
      schema: "evolution_ready",
      buildId: "fixture",
      manifestHash: sourceManifestHash(manifest)
    };
    const releaseId = manifestDigest(identity);
    const now = Date.now();
    await db.exec(`
      CREATE SCHEMA evolution_ready;
      CREATE TABLE evolution_ready._ponder_meta(key text PRIMARY KEY, value jsonb);
      CREATE TABLE evolution_ready._ponder_checkpoint(chain_name text, chain_id bigint, latest_checkpoint text, safe_checkpoint text, finalized_checkpoint text);
      CREATE TABLE evolution_ready.chain_checkpoint(chain_id integer, block_number bigint, block_hash text, parent_hash text, timestamp bigint);
      CREATE TABLE evolution_ready.chain_block(chain_id integer, block_number bigint, block_hash text);
      CREATE TABLE evolution_ready.indexer_source(id text, chain_id integer, manifest_hash text, definition text);
      CREATE TABLE evolution_ready.canonical_event(chain_id integer,address text,name text,args jsonb,block_number bigint);
    `);
    await db.query(
      "INSERT INTO evolution_ready._ponder_meta VALUES ('app',$1)",
      [
        JSON.stringify({
          version: "6",
          build_id: identity.buildId,
          heartbeat_at: now,
          is_ready: 1,
          is_locked: 1,
          is_dev: 0
        })
      ]
    );
    const checkpoint = `0000001000${"8453".padStart(16, "0")}${"1000".padStart(16, "0")}${"9".repeat(33)}`;
    await db.query(
      "INSERT INTO evolution_ready._ponder_checkpoint VALUES ('base',8453,$1,$1,$1)",
      [checkpoint]
    );
    await db.query(
      "INSERT INTO evolution_ready.chain_checkpoint VALUES (8453,1000,$1,$2,1000)",
      [hash(1000), hash(999)]
    );
    await db.query(
      "INSERT INTO evolution_ready.chain_block VALUES (8453,1000,$1)",
      [hash(1000)]
    );
    for (const source of manifest.sources)
      await db.query(
        "INSERT INTO evolution_ready.indexer_source VALUES ($1,$2,$3,$4)",
        [
          source.id,
          source.chainId,
          identity.manifestHash,
          JSON.stringify(source)
        ]
      );
    await db.query(
      "INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest) VALUES ($1,$2,$3,$4,$5)",
      [
        releaseId,
        identity.schema,
        identity.buildId,
        identity.manifestHash,
        JSON.stringify(manifest)
      ]
    );
    await db.query(
      `INSERT INTO yunipals_indexer_control.chain_status
      (release_id,chain_id,head_number,head_hash,head_timestamp,witness_number,witness_hash,observed_at_ms,anchors)
      VALUES ($1,8453,1000,$2,1000,1000,$2,$3,$4)`,
      [
        releaseId,
        hash(1000),
        now,
        JSON.stringify({
          "988": { number: "988", hash: hash(988), timestamp: "988" },
          "1000": { number: "1000", hash: hash(1000), timestamp: "1000" }
        })
      ]
    );
    const reader = new EvolutionReader(pool, releaseId);
    await db.query(
      `INSERT INTO evolution_ready.canonical_event VALUES
      (8453,$1,'EvolutionCompleted',$2,980), (8453,$1,'EvolutionCompleted',$3,999)`,
      [
        address("62"),
        JSON.stringify({ artworkHash: hash(10), metadataHash: hash(11) }),
        JSON.stringify({ artworkHash: hash(12), metadataHash: hash(13) })
      ]
    );
    expect(await reader.publications(hash(10))).toHaveLength(1);
    expect(await reader.publications(hash(12))).toHaveLength(0);
    const context = await reader.snapshot(async (_db, context) => context);
    expect(context).toMatchObject({
      block: 988n,
      hash: hash(988),
      cards: env.BOOSTER_MONSTERS,
      adventures: address("61"),
      evolution: address("62"),
      deployment: `8453:${address("62")}`
    });
    await db.query(
      "UPDATE evolution_ready._ponder_meta SET value=jsonb_set(value,'{is_locked}','0') WHERE key='app'"
    );
    await db.query(
      "UPDATE yunipals_indexer_control.chain_status SET observed_at_ms=1,error_code='rpc_unavailable' WHERE release_id=$1",
      [releaseId]
    );
    await expect(reader.snapshot(async () => true)).rejects.toThrow(
      "confirmed indexer coverage"
    );
    expect(await reader.publications(hash(10))).toHaveLength(1);
    expect(await reader.publications(hash(12))).toHaveLength(0);
    await db.query(
      "UPDATE yunipals_indexer_control.chain_status SET halted=true WHERE release_id=$1",
      [releaseId]
    );
    await expect(reader.publications(hash(10))).rejects.toThrow(
      "evidence is unavailable"
    );
    await db.query(
      "UPDATE evolution_ready._ponder_meta SET value=jsonb_set(value,'{is_locked}','1') WHERE key='app'"
    );
    await db.query(
      "UPDATE yunipals_indexer_control.chain_status SET halted=false,observed_at_ms=$2,error_code=NULL WHERE release_id=$1",
      [releaseId, now]
    );
    await db.query(
      "UPDATE yunipals_indexer_control.chain_status SET anchors=anchors-'988' WHERE release_id=$1",
      [releaseId]
    );
    await expect(reader.snapshot(async () => true)).rejects.toThrow(
      "confirmed indexer coverage"
    );
    await expect(reader.publications(hash(10))).rejects.toThrow(
      "branch is unverified"
    );
    await db.query(
      "UPDATE yunipals_indexer_control.chain_status SET anchors=jsonb_set(anchors,'{988}',$2::jsonb) WHERE release_id=$1",
      [
        releaseId,
        JSON.stringify({ number: "988", hash: hash(988), timestamp: "988" })
      ]
    );
    await db.query("UPDATE evolution_ready.chain_block SET block_hash=$1", [
      hash(2000)
    ]);
    await expect(reader.snapshot(async () => true)).rejects.toThrow(
      "confirmed indexer coverage"
    );
  } finally {
    await db.close();
  }
});
