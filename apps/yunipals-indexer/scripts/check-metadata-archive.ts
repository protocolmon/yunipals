import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { archiveMigrations } from "../lib/metadata/source/schema.js";
import { beginSource, commitSourceBatch, ensureCandidate, type ArchiveRecord } from "../lib/metadata/source/archive.js";
import { exportSources, restoreSources } from "./metadata/source-backup.js";
import { ArchiveReader, ArchiveLookupError } from "../lib/metadata/source/read.js";
import { sourceIdentity } from "../lib/metadata/source/identity.js";
import {contentHash} from "../lib/metadata/source/canonical.js";
import {projectLegacyLookups} from "../lib/metadata/source/lookups.js";
import { comparisonDocument } from "../lib/metadata/render/compare.js";
import { aliasNamespace, exomonAliasRecords, importSupplemental, projectExomonAliases } from "../lib/metadata/source/supplemental.js";
import { argumentsOf, postgresFrom, safeFailure } from "./metadata/support.js";

const args = argumentsOf();
async function main() {
  const { pool } = await postgresFrom(String(args["env-file"]));
  const temporary = await mkdtemp(join(tmpdir(), "metadata-archive-check-"));
  try {
    const database = (await pool.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database, /^metadata_archive_test_[a-z0-9_]+$/, "This check only runs in a dedicated disposable database");
    for (const sql of archiveMigrations) await pool.query(sql);
    const release = `check-${randomUUID()}`, namespace = "test.source", manifest = { purpose: "transaction-and-recovery-check" };
    await ensureCandidate(pool, release, manifest);
    await beginSource(pool, release, namespace, { encoding: "canonical-ejson-v1" }, "003");
    const record = (key: string): ArchiveRecord => ({ key,
      payload: { id: key, large: { $numberLong: "9007199254740993" }, parents: ["ancestor"] },
      assetKey: null, legacyId: key, family: "GEN1", chainId: "1", originType: "GEN1_BOOSTER", burned: false, issue: null });
    await commitSourceBatch(pool, release, namespace, null, "002", [record("001"),record("002")]);
    // A retry with the old checkpoint cannot duplicate records or advance state.
    await assert.rejects(commitSourceBatch(pool, release, namespace, null, "002", [record("001")]));
    // Conflict occurs after tentative blob insertion; the entire transaction rolls back.
    await assert.rejects(commitSourceBatch(pool, release, namespace, "002", "003", [record("001"),record("003")]));
    const checkpoint = (await pool.query("SELECT cursor,rows_imported::text AS count FROM metadata_source.import_run WHERE release_id=$1", [release])).rows[0];
    assert.deepEqual(checkpoint, { cursor: "002", count: "2" });
    await commitSourceBatch(pool, release, namespace, "002", "003", [record("003")], true);
    const file = join(temporary,"source.jsonl.gz");
    const exported = await exportSources(pool, release, file);
    assert.equal(exported.records, 3);
    await assert.rejects(exportSources(pool, release, file)); // never overwrite recovery artifacts
    const restored = `${release}-restored`;
    assert.equal((await restoreSources(pool, restored, file)).records, 3);
    const comparison = await pool.query(`SELECT namespace,source_key,content_hash FROM metadata_source.source_record WHERE release_id=$1
      EXCEPT SELECT namespace,source_key,content_hash FROM metadata_source.source_record WHERE release_id=$2`, [release,restored]);
    assert.equal(comparison.rowCount, 0);
    const badFile = join(temporary,"bad.jsonl.gz");
    const decoded = gunzipSync(await readFile(file)).toString("utf8");
    await writeFile(badFile, gzipSync(decoded.replace('"ancestor"', '"changed"')));
    const invalid = `${release}-bad`;
    await assert.rejects(restoreSources(pool, invalid, badFile));
    assert.equal((await pool.query("SELECT state FROM metadata_source.archive_release WHERE release_id=$1", [invalid])).rows[0].state,"invalid");
    const truncated = join(temporary,"truncated.jsonl.gz");
    await writeFile(truncated, gzipSync(decoded.split("\n").slice(0,-2).join("\n") + "\n"));
    await assert.rejects(restoreSources(pool, `${release}-truncated`, truncated));
    await pool.query("UPDATE metadata_source.archive_release SET state='validated' WHERE release_id=$1", [restored]);
    await assert.rejects(beginSource(pool, restored, "unexpected", {}, null));
    for (const sql of archiveMigrations) await pool.query(sql); // additive and repeatable
    assert.equal((await pool.query("SELECT count(*)::text AS count FROM metadata_source.source_record WHERE release_id=$1", [release])).rows[0].count,"3");
    const fixture = JSON.parse(await readFile(new URL("../test/fixtures/metadata/gen1_booster.json",import.meta.url),"utf8"));
    const readRelease = `${release}-reader`;
    await ensureCandidate(pool,readRelease,{});
    await beginSource(pool,readRelease,namespace,{},"b");
    const first: ArchiveRecord = { key:"a",payload:fixture.envelope,...sourceIdentity(fixture.envelope),burned:false };
    const otherEnvelope = { ...fixture.envelope,genId:{ ...fixture.envelope.genId,type:"OTHER_FAMILY" } };
    const second: ArchiveRecord = { key:"b",payload:otherEnvelope,...sourceIdentity(otherEnvelope),burned:false };
    await commitSourceBatch(pool,readRelease,namespace,null,"b",[first,second],true);
    await assert.rejects(new ArchiveReader(pool,readRelease).snapshot(first.legacyId!),
      error => error instanceof ArchiveLookupError && error.code === "archive_unavailable");
    const reader = new ArchiveReader(pool,readRelease,true);
    await assert.rejects(reader.snapshot(first.legacyId!),
      error => error instanceof ArchiveLookupError && error.code === "alias_ambiguous");
    const rendered = await reader.snapshot(first.legacyId!,first.family!);
    assert.deepEqual(comparisonDocument(rendered.document),comparisonDocument(fixture.expected));
    await pool.query(`INSERT INTO metadata_source.lookup_alias(release_id,namespace,alias,family,asset_key)
      VALUES ($1,'legacy-meta',$2,$3,$4)`,[readRelease,first.legacyId,first.family,first.assetKey]);
    assert.equal((await reader.snapshot(first.legacyId!)).assetKey,first.assetKey);
    const rainbowFixture = JSON.parse(await readFile(new URL("../test/fixtures/metadata/gen1_rainbow_fusion.json",import.meta.url),"utf8"));
    const rainbowRecord: ArchiveRecord = { key:"rainbow",payload:rainbowFixture.envelope,
      ...sourceIdentity(rainbowFixture.envelope),burned:false };
    await beginSource(pool,readRelease,"test.rainbow",{},"rainbow");
    await commitSourceBatch(pool,readRelease,"test.rainbow",null,"rainbow",[rainbowRecord],true);
    await assert.rejects(reader.snapshot(rainbowRecord.legacyId!),
      error => error instanceof ArchiveLookupError && error.code === "parent_missing");
    const parentRecords: ArchiveRecord[] = rainbowFixture.parents.map((parent: unknown,index: number) => ({
      key:String(index),payload:parent,...sourceIdentity(parent),burned:true
    }));
    const parentCursor = parentRecords.at(-1)!.key;
    await beginSource(pool,readRelease,"test.parents",{},parentCursor);
    await commitSourceBatch(pool,readRelease,"test.parents",null,parentCursor,parentRecords,true);
    assert.deepEqual(comparisonDocument((await reader.snapshot(rainbowRecord.legacyId!)).document),comparisonDocument(rainbowFixture.expected));
    const exomonFixture = JSON.parse(await readFile(new URL("../test/fixtures/metadata/gen1_exomon_drop.json",import.meta.url),"utf8"));
    const exomonRecord: ArchiveRecord = { key:"exomon",payload:exomonFixture.envelope,...sourceIdentity(exomonFixture.envelope),burned:false };
    const aliases = exomonAliasRecords({ "1000002005569": exomonRecord.legacyId! });
    await importSupplemental(pool,readRelease,aliasNamespace,aliases,{fixture:true});
    assert.equal((await projectExomonAliases(pool,readRelease)).unresolved,1);
    await beginSource(pool,readRelease,"nfts.pmonCollection",{},"exomon");
    await commitSourceBatch(pool,readRelease,"nfts.pmonCollection",null,"exomon",[exomonRecord],true);
    assert.deepEqual(await projectExomonAliases(pool,readRelease),{ aliases:1,verified:1,inserted:1,unresolved:0 });
    assert.equal((await projectExomonAliases(pool,readRelease)).inserted,0);
    assert.deepEqual(comparisonDocument((await reader.snapshot("1000002005569")).document),comparisonDocument(exomonFixture.expected));
    await importSupplemental(pool,readRelease,aliasNamespace,aliases,{fixture:true}); // unchanged source is resumable
    await assert.rejects(importSupplemental(pool,readRelease,aliasNamespace,aliases,{fixture:false}));
    for(const qualified of [false,true]){
      const decisions=qualified?"legacy.family-lookup-decisions":"legacy.lookup-decisions";
      await importSupplemental(pool,readRelease,decisions,[{key:"decision",payload:{alias:"decision-id",family:first.family,assetKey:first.assetKey,
        sourceNamespace:namespace,sourceKey:first.key,sourceHash:contentHash(first.payload)},assetKey:null,legacyId:null,family:null,chainId:null,originType:null,burned:null,issue:null}],{});
      assert.equal(await projectLegacyLookups(pool,readRelease,qualified),1);
      assert.equal(await projectLegacyLookups(pool,readRelease,qualified),0);
      assert.equal((await reader.lookup("decision-id",qualified?first.family!:undefined)).assetKey,first.assetKey);
    }
    const withAliases = join(temporary,"aliases.jsonl.gz"), aliasRestored = `${readRelease}-restored`;
    await exportSources(pool,readRelease,withAliases);
    await restoreSources(pool,aliasRestored,withAliases);
    assert.equal((await projectExomonAliases(pool,aliasRestored)).verified,1);
    assert.equal(await projectLegacyLookups(pool,aliasRestored),1);
    assert.equal(await projectLegacyLookups(pool,aliasRestored,true),1);
    assert.equal((await new ArchiveReader(pool,aliasRestored,true).lookup("decision-id",first.family!)).assetKey,first.assetKey);
    assert.deepEqual(comparisonDocument((await new ArchiveReader(pool,aliasRestored,true).snapshot("1000002005569")).document),comparisonDocument(exomonFixture.expected));
    await pool.query(`INSERT INTO metadata_source.lookup_alias(release_id,namespace,alias,family,asset_key)
      VALUES ($1,'legacy-meta','1000002005569','OTHER_FAMILY','incorrect')`,[aliasRestored]);
    await assert.rejects(projectExomonAliases(pool,aliasRestored));
    await pool.query(`INSERT INTO metadata_source.lookup_alias(release_id,namespace,alias,family,asset_key)
      VALUES($1,'legacy-family','decision-id',$2,'incorrect')`,[aliasRestored,first.family]);
    await assert.rejects(projectLegacyLookups(pool,aliasRestored,true));
    console.log("PASS: atomic checkpoints, conflict rollback, immutable releases, repeatable schema, export/restore equality, corrupt/truncated archive rejection, offline rendering, candidate isolation, ambiguous-alias rejection and verified alias rebuild after restore");
  } finally { await pool.end(); await rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
