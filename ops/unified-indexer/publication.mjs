// Fresh unpublished build, then one independently journalled official CAS.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { installedModules, databaseIdentity, hash } from "./configure-readers.mjs";

export const FORMAT = "yunipals-fresh-publication-v1";
export const SOURCE_REVIEWED = true;
const PROJECT = "/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer";
const PUBLISHER = "/opt/yunipals-unified/nonmarket-consumer-releases/2b104015af8aa0fd6f4710c07bcc73125819e663a3d2f15de8d31443e587cefe";
const READ = "yunipals_ownership_4e77f52b_v5", PHYSICAL = "unified_ypal_20261023_v1";
const RELEASE = "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3";
const IDENTITY = "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab";
const BOUNDARIES = [{ chainId: 1, number: "26236452" }, { chainId: 56, number: "128816538" }, { chainId: 137, number: "95883932" }, { chainId: 8453, number: "52870956" }, { chainId: 8453, number: "52870977" }];

// Exact projection-snapshot.ts pure SQL builder; parameters remain bound values.
export function publicationSourcePredicate(parameter) {
  if (!/^\$[1-9][0-9]*$/.test(parameter)) throw new Error("Invalid snapshot parameter");
  const ponderSchema = '"' + READ + '"', physicalPonderSchema = '"' + PHYSICAL + '"';
  const proof = `${parameter}::jsonb`;
  return `EXISTS(SELECT 1 FROM ${ponderSchema}._unified_read_release v
    JOIN yunipals_indexer_control.release r ON r.id=v.release_id
    WHERE v.singleton AND v.release_id=${proof}->>'releaseId' AND v.identity=${proof}->>'readIdentity'
      AND v.manifest_hash=${proof}->>'manifestHash' AND r.manifest_hash=v.manifest_hash
      AND r.physical_schema=${proof}->>'physicalSchema')
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${proof}->'anchors')
      AS a(collection text,chain_id integer,block_number bigint,block_hash text)
      LEFT JOIN LATERAL ${ponderSchema}.source_boundary(a.collection) b ON true
      WHERE b.ready IS DISTINCT FROM true OR b.chain_id IS DISTINCT FROM a.chain_id
        OR b.release_id IS DISTINCT FROM (${proof}->>'releaseId')
        OR b.manifest_hash IS DISTINCT FROM (${proof}->>'manifestHash')
        OR b.block_number<a.block_number OR NOT EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block canonical
          WHERE canonical.chain_id=a.chain_id AND canonical.block_number=a.block_number AND canonical.block_hash=a.block_hash)
        OR NOT EXISTS(SELECT 1 FROM metadata.chain_readiness c WHERE c.collection=a.collection
          AND c.state='ready' AND c.checkpoint_block IS NOT NULL AND c.verified_at IS NOT NULL))
    AND EXISTS(SELECT 1 FROM ${ponderSchema}.base_metadata_frame(true) f
      JOIN jsonb_to_recordset(${proof}->'anchors')AS a(collection text,block_number bigint,block_hash text)
        ON a.collection='base' AND f.block_number>=a.block_number
      WHERE f.frontier=${proof}->>'baseMetadataFrontier')`;
}

export async function sourceCurrent(db, snapshot, cache) {
  const rows = (await db.query(`SELECT (${publicationSourcePredicate("$1")}) AS accepted`, [JSON.stringify(snapshot)])).rows;
  assert(rows.length === 1 && rows[0].accepted === true, "publication_snapshot_anchors_must_be_current_before_wallet_compute");
  await cache.approval(db);
}

export async function actualPlan(db, reader, generationId) {
  assert(typeof generationId === "string" && /^[1-9][0-9]*$/.test(generationId) && BigInt(generationId) >= 106n);
  const observation = await reader.globalPublicationObservation(db, generationId);
  const snapshot = (await db.query("SELECT validation->'sourceSnapshot' AS value FROM metadata_projection.generation WHERE id=$1", [generationId])).rows[0]?.value;
  assert(observation.pointer.current === "103" && observation.candidate.id === generationId && observation.candidate.state === "ready" && observation.candidate.published === false && observation.candidate.sourceMode === "archive" && observation.archive === observation.candidate.metadataRelease, "fresh_unpublished_candidate_over_103_required");
  assert(observation.candidate.sourceRelease === RELEASE && observation.candidate.readIdentity === IDENTITY && snapshot);
  return { generationId, predecessorGenerationId: "103", metadataReleaseId: observation.archive, sourceRelease: RELEASE, readIdentity: IDENTITY,
    validationSqlSha256: observation.candidate.validationSha256, originalObservationSha256: hash(JSON.stringify(observation)), candidateSourceSnapshot: snapshot, boundaryPoints: structuredClone(BOUNDARIES) };
}

export async function prepare(db, modules) {
  await databaseIdentity(db, "yunipals");
  assert.equal(process.env.PROJECTION_PRESERVE_GENERATION_IDS, "103,105", "preserve_original_103_and_105");
  assert.equal(typeof modules.official.refreshProjectionGeneration, "function", "official_unpublished_generation_builder_required");
  const before = await modules.reader.globalPublicationObservation(db, "105");
  assert(before.pointer.current === "103" && before.candidate.id === "105", "unchanged_original_pointer_and_candidate_required");
  const oldRows = (await db.query("SELECT id::text,to_jsonb(g) AS value FROM metadata_projection.generation g WHERE id=ANY($1::bigint[]) ORDER BY id", [["103", "105"]])).rows;
  assert.equal(oldRows.length, 2); await modules.cache.approval(db);
  const built = await modules.official.refreshProjectionGeneration({ publish: false });
  assert(built.prepared === true && built.predecessor === "103" && typeof built.generationId === "string" && BigInt(built.generationId) >= 106n, "actual_official_fresh_unpublished_build_required");
  assert.deepEqual(await modules.reader.globalPublicationObservation(db, "105"), before, "preparation_cannot_change_pointer_wallets_stamps_or_105");
  assert.deepEqual((await db.query("SELECT id::text,to_jsonb(g) AS value FROM metadata_projection.generation g WHERE id=ANY($1::bigint[]) ORDER BY id", [["103", "105"]])).rows, oldRows, "103_and_105_must_remain_immutable");
  const plan = await actualPlan(db, modules.reader, built.generationId);
  await sourceCurrent(db, plan.candidateSourceSnapshot, modules.cache);
  return { format: FORMAT, prepared: true, published: false, generationId: built.generationId, plan };
}

export async function publish(db, modules, plan, ack) {
  await databaseIdentity(db, "yunipals");
  const current = await actualPlan(db, modules.reader, plan.generationId);
  assert.deepEqual(plan, current, "same_fresh_current_publication_plan_required");
  // Reject expired canonical headers before the costly private wallet build.
  await sourceCurrent(db, plan.candidateSourceSnapshot, modules.cache);
  const authorize = async (phase, value) => {
    const start = process.hrtime.bigint(); assert.equal(await ack(phase, value), true);
    assert(process.hrtime.bigint() - start < 5_000_000_000n, "bounded_five_second_Root_ACK_required"); return true;
  };
  const result = await modules.reader.publishPreparedCandidate(db, modules.official, plan, {
    privatePrepared: value => authorize("wallet-private-prepared", value), beforeCommit: value => authorize("publication-prepared", value)
  });
  return { format: FORMAT, completed: true, generationId: plan.generationId, publication: result, permissionsChanged: false, automaticRepublishAllowed: false };
}

function save(directory, name, value) {
  const fd = openSync(directory + "/" + name, "wx", 0o600);
  try { writeSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(directory, "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length) { console.log(JSON.stringify({ format: FORMAT, staticOnly: true, sourceReviewed: SOURCE_REVIEWED })); return; }
  assert(SOURCE_REVIEWED, "reviewed_official_publication_operator_required"); assert.equal(process.getuid(), 0);
  assert(args.length === 2 && args[0] === "--prepare" || args.length === 4 && args[0] === "--publish" && args[2] === "--journal");
  const journal = resolve(args.at(-1)); mkdirSync(journal, { mode: 0o700 });
  const url = new URL(process.env.DATABASE_URL);
  assert(decodeURIComponent(url.username) === "yunipals" && ["postgres:", "postgresql:"].includes(url.protocol) && ["localhost", "127.0.0.1", "::1"].includes(url.hostname) && (!url.port || url.port === "5432") && decodeURIComponent(url.pathname) === "/yunipals_backfill", "fixed_role_limited_main_database");
  url.searchParams.set("options", [url.searchParams.get("options"), "-c work_mem=64MB"].filter(Boolean).join(" "));
  Object.assign(process.env, { DATABASE_URL: url.toString(), PROJECTION_PRESERVE_GENERATION_IDS: "103,105", DATABASE_SCHEMA: PHYSICAL, READ_DATABASE_SCHEMA: READ, OWNERSHIP_READ_SCHEMA: READ, OWNERSHIP_READ_MODE: "unified", OWNERSHIP_RELEASE_ID: RELEASE, UNIFIED_INDEXER_RELEASE_ID: RELEASE, BASE_METADATA_INGESTION: "native", METADATA_SOURCE_MODE: "archive", YUNIPALS_PROJECTION_MODE: "generation", OFFCHAIN_DB_POOL_MAX: "1", API_DB_POOL_MAX: "1", PROJECTION_STORAGE_PATH: "/", PROJECTION_MIN_FREE_BYTES: "25000000000", PROJECTION_BACKUP_PEAK_BYTES: "0" });
  save(journal, "intent.json", { format: FORMAT, action: args[0], sourceSha256: hash(readFileSync(fileURLToPath(import.meta.url))), preservedGenerations: ["103", "105"], automaticRetryAllowed: false });
  const { Client } = createRequire(PROJECT + "/package.json")("pg"); const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    const modules = await installedModules();
    if (args[0] === "--prepare") assert(readFileSync(PUBLISHER + "/dist/projection-publication.mjs", "utf8").includes("PROJECTION_PRESERVE_GENERATION_IDS"), "authenticated_official_builder_must_support_generation_preservation");
    await db.connect(); await db.query("SET work_mem='64MB'");
    let result;
    if (args[0] === "--prepare") { result = await prepare(db, modules); save(journal, "plan.json", { format: FORMAT, plan: result.plan }); }
    else {
      const path = resolve(args[1]), row = lstatSync(path); assert(row.isFile() && !row.isSymbolicLink() && row.uid === 0 && row.nlink === 1 && (row.mode & 0o777) === 0o600);
      const value = JSON.parse(readFileSync(path)); assert.deepEqual(Object.keys(value).sort(), ["format", "plan"]); assert.equal(value.format, FORMAT);
      let number = 0; result = await publish(db, modules, value.plan, async (phase, packet) => { const messageSha256 = hash(JSON.stringify(packet)); save(journal, String(++number) + "-" + phase + ".json", { packet, messageSha256, authorization: { event: "root-authorized", phase, messageSha256 } }); return true; });
    }
    save(journal, "result.json", result); console.log(JSON.stringify({ format: FORMAT, completed: true, generationId: result.generationId, published: result.completed === true, resultSha256: hash(result) }));
  } catch (error) { save(journal, "failure.json", { error: error.message, automaticRetryAllowed: false, inspectActualDatabaseBeforeAnyNewAction: true }); throw error; }
  finally { await db.end().catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
