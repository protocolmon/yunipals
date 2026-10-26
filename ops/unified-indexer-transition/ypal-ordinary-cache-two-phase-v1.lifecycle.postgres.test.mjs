// Real disposable PG16; synthetic state only. No production or provider calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  binding,
  relations,
  capture,
  catalog,
  digest,
  guardSql,
  rehearse,
  apply,
  inverse
} from "./ypal-ordinary-cache-transition-v5.mjs";
import { execute, exactFourReads } from "./ypal-ordinary-cache-driver-v5.mjs";
import { migrateIndexerControl } from "../../apps/yunipals-indexer/lib/unified/control-schema.ts";

const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(root + "/apps/yunipals-indexer/package.json"),
  { Pool } = require("pg");
const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
const container = "yunipals-unified-indexer-test-20261020";
const docker = (args) =>
  execFileSync(
    "/usr/bin/docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    {
      env,
      timeout: 15000,
      encoding: "utf8",
      maxBuffer: 4000000
    }
  );
const info = JSON.parse(docker(["inspect", container]))[0];
assert.equal(info.Config.Image, "postgres:16.15");
assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const suffix = randomBytes(5).toString("hex"),
  database = "ypal_cache_guards_" + suffix;
const connection = (name) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const admin = new Pool({ connectionString: connection("postgres"), max: 1 });
const reader = "ypal_guard_reader_" + suffix;
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
let pool,
  created = false,
  readerCreated = false;
const plan = JSON.parse(
  readFileSync(
    root +
      "/ops/unified-indexer-transition/ypal-combined-readview-v5.preparation.json"
  )
);
const profile = JSON.parse(
  readFileSync(
    root + "/ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json"
  )
);
assert.deepEqual(binding, {
  physicalSchema: plan.physicalSchema,
  readSchema: plan.readSchema,
  sourceRelease: plan.sourceRelease,
  readIdentity: plan.readIdentity
});
const modulePath =
  root + "/ops/unified-indexer-transition/ypal-ordinary-cache-transition-v5.mjs";
const originalSha = createHash("sha256")
  .update(readFileSync(modulePath))
  .digest("hex");
const officialPins = {
  "lib/metadata/read-cache-schema.ts":
    "1de7856e5fc9253dbc08d6db0b0408516252030d353bcc4409ecdb20a0922757",
  "lib/metadata/read-cache.ts":
    "9668ace2d6e33a0c5813326d2ddf17cff23bebfaea309765e5f08add988e5b39",
  "lib/metadata/read-source.ts":
    "1c80f8ca18c609c8a47e164730aa5409ea2a9a65c2697bac4498c2ab1ba63208",
  "lib/ownership/readiness.ts":
    "bc99f986bb4db425d862901ffadc0cc5b6f09cefedc4724cd199a7560401fe5a",
  "lib/constants.ts":
    "31d4c01cb192d54085e26d18f7d7323c82ef54168f98b9c4c916610fe13e8e7a"
};
for (const [path, pin] of Object.entries(officialPins))
  assert.equal(
    createHash("sha256")
      .update(readFileSync(root + "/apps/yunipals-indexer/" + path))
      .digest("hex"),
    pin
  );
const checks = [];
const phase = await import("./ypal-ordinary-cache-two-phase-v1.mjs");
const stageDriver = await import("./ypal-ordinary-cache-two-phase-driver-v1.mjs");
const { Client } = require("pg");
try {
  await admin.query(
    `CREATE DATABASE ${quote(database)} OWNER unified_test TEMPLATE template0`
  );
  created = true;
  pool = new Pool({
    connectionString: connection(database),
    max: 1,
    statement_timeout: 15000
  });
  const dump = docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    "unified_test",
    "-d",
    "yunipals_ponder_dependency_test",
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    "--schema",
    "dependency_check"
  ]);
  await pool.query(
    dump
      .replace(/^\\(?:un)?restrict.*$/gm, "")
      .replaceAll("dependency_check", binding.physicalSchema)
  );
  await pool.query(`SET search_path=${quote(binding.physicalSchema)},public`);
  await pool.query(
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
  );
  await migrateIndexerControl(pool);
  await pool.query(
    `INSERT INTO ${binding.physicalSchema}._ponder_meta(key,value)VALUES('app',$1)`,
    [
      JSON.stringify({
        version: "6",
        build_id: plan.buildId,
        is_dev: 0,
        heartbeat_at: Date.now(),
        is_locked: 0,
        is_ready: 0
      })
    ]
  );
  for (const source of profile.manifest.sources)
    await pool.query(
      `INSERT INTO ${binding.physicalSchema}.indexer_source VALUES($1,$2,$3,$4)`,
      [source.id, source.chainId, plan.manifestHash, JSON.stringify(source)]
    );
  await pool.query(
    "INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest)VALUES($1,$2,$3,$4,$5)",
    [
      binding.sourceRelease,
      binding.physicalSchema,
      plan.buildId,
      plan.manifestHash,
      profile.manifest
    ]
  );
  Object.assign(process.env, {
    DATABASE_URL: connection(database),
    DATABASE_SCHEMA: binding.physicalSchema,
    READ_DATABASE_SCHEMA: binding.readSchema,
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: binding.readSchema,
    OWNERSHIP_RELEASE_ID: binding.sourceRelease,
    YUNIPALS_PROJECTION_MODE: "generation",
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "native"
  });
  globalThis.fetch = async () => {
    throw Error("No providers permitted");
  };
  const { migrations } = await import(
    "../../apps/yunipals-indexer/lib/offchain/migrations.ts"
  );
  const { projectionSchemaStatements } = await import(
    "../../apps/yunipals-indexer/lib/metadata/projection-schema.ts"
  );
  const { installReadCache } = await import(
    "../../apps/yunipals-indexer/lib/metadata/read-cache-schema.ts"
  );
  const { cachedSearchReadRelationFor, cachedTraitReadRelationFor } =
    await import("../../apps/yunipals-indexer/lib/metadata/read-cache.ts");
  for (const sql of migrations) await pool.query(sql);
  for (const sql of projectionSchemaStatements) await pool.query(sql);
  for (const schema of [
    "yunipals_indexer_v3",
    "bnb_indexer",
    "unified_shadow_20261020_7e7375b0"
  ]) {
    await pool.query(`CREATE SCHEMA ${quote(schema)}`);
    const names = [
      "token",
      "token_lifecycle",
      "transfer_event",
      ...(schema.startsWith("unified_shadow_") ? ["canonical_event"] : [])
    ];
    for (const name of names)
      await pool.query(
        `CREATE TABLE ${quote(schema)}.${quote(name)}(LIKE ${quote(binding.physicalSchema)}.${quote(name)} INCLUDING ALL)`
      );
  }
  await admin.query(`CREATE ROLE ${quote(reader)} NOLOGIN`);
  readerCreated = true;
  const guard = async () =>
    (await pool.query(guardSql())).rows[0].jsonb_build_object;
  const legacyCode = `import pg from 'pg';import{installReadCache}from${JSON.stringify(root + "/apps/yunipals-indexer/lib/metadata/read-cache-schema.ts")};
    const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try{await db.query('BEGIN');await installReadCache(db);await db.query('COMMIT')}finally{await db.end()}`;
  execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", legacyCode],
    {
      cwd: root + "/apps/yunipals-indexer",
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...env,
        DATABASE_URL: connection(database),
        DATABASE_SCHEMA: "yunipals_indexer_v3",
        BNB_DATABASE_SCHEMA: "bnb_indexer",
        OWNERSHIP_READ_MODE: "legacy",
        METADATA_SOURCE_MODE: "archive",
        BASE_METADATA_INGESTION: "rpc"
      }
    }
  );
  assert.deepEqual(await guard(), { valid: false });
  await pool.query(
    `GRANT SELECT ON metadata_projection.search TO ${quote(reader)}`
  );
  await pool.query(
    `GRANT UPDATE ON metadata_projection.read_epoch TO ${quote(reader)}`
  );
  await pool.query(
    "INSERT INTO metadata_projection.generation(source_mode,state)VALUES('archive','ready')"
  );
  await pool.query(
    "INSERT INTO metadata_projection.read_set(generation_id,collection,revision,guard_count,source_mode)SELECT 1,'bnb',revision,8,'archive'FROM metadata_projection.read_epoch WHERE collection='bnb'"
  );
  await pool.query(
    "INSERT INTO metadata_projection.read_member(generation_id,collection,token_id,lifecycle,has_search,metadata_available)VALUES(1,'bnb',1,1,false,false)"
  );
  const data = async () =>
    (
      await pool.query(`SELECT jsonb_build_object(
    'cacheSets',(SELECT jsonb_agg(x ORDER BY generation_id,collection)FROM metadata_projection.read_set x),
    'cacheMembers',(SELECT jsonb_agg(x ORDER BY generation_id,collection,token_id)FROM metadata_projection.read_member x),
    'sourceCount',(SELECT count(*)FROM ${binding.physicalSchema}.canonical_event))AS value`)
    ).rows[0].value;
  const original = await capture(pool),
    originalData = await data();

  const collector = {
    name: reader,
    oid: (
      await pool.query("SELECT oid::text FROM pg_roles WHERE rolname=$1", [
        reader
      ])
    ).rows[0].oid
  };
  await pool.query(`INSERT INTO metadata_source.native_base_metadata_state(release_id,read_identity,state,frontier,implementation,checked_block,checked_hash,checked_at,error_code)
    VALUES($1,$2,'ready','same-frontier',$3,1,$4,clock_timestamp(),NULL)`, [phase.RELEASE,phase.IDENTITY,phase.IMPLEMENTATION,'0x'+'a'.repeat(64)]);
  const originalPlan = await rehearse(pool, installReadCache);
  assert.equal((await data()).sourceCount,originalData.sourceCount);
  const phasePlan={...originalPlan,phase:'prepare-guards',originalPlanJson:JSON.stringify(originalPlan),preparationReceiptJson:null,verificationFence:null};
  const explicitProof=async()=>({catalog:{explicitREADCatalogIOFixture:true},reader:{explicitReaderIOFixture:true},allColumnAcl:[]});
  let prepPacket;
  const prepared=await stageDriver.execute(pool,'apply',phasePlan,installReadCache,async packet=>{prepPacket=packet;return true},collector,explicitProof);
  assert.equal(prepared.result.readGrantsExternallyActivated,false);
  assert.equal(prepPacket.postProof.phaseContract.phase,'prepare-guards');
  const installed=await capture(pool);
  assert.equal(installed.guards.length,35);assert.equal(installed.triggers.length,42);
  assert.deepEqual(installed.functions,originalPlan.after.functions);
  assert.deepEqual(installed.acl,originalPlan.before.acl);
  assert.deepEqual(installed.columnAcl,originalPlan.before.columnAcl);
  assert.deepEqual(await data(),originalData);
  checks.push('genuine_official_installer_commits_new_guards_without_any_added_READ');
  const snapshot=(await pool.query(`SELECT jsonb_build_object(
    'atUs',(extract(epoch FROM clock_timestamp())*1000000)::numeric(30,0)::text,
    'checkedUs',(extract(epoch FROM checked_at)*1000000)::numeric(30,0)::text,
    'release',release_id,'identity',read_identity,'state',state,'implementation',implementation,'errorCode',error_code,
    'frontier',frontier,'frameFrontier',frontier,'checkedBlock',checked_block::text,'checkedHash',checked_hash,
    'frameBlock',checked_block::text,'frameHash',checked_hash,'probe',true,'nativeMode',true,'canonical',true)AS value
    FROM metadata_source.native_base_metadata_state WHERE release_id=$1`,[phase.RELEASE])).rows[0].value;
  // The frame/probe/canonical booleans here are declared I/O fixtures; no current
  // or real-source qualification is claimed by this SQL lifecycle control.
  const fenced={...phasePlan,phase:'activate-reads',preparationReceiptJson:prepared.resultJson,verificationFence:{
    format:phase.FORMAT+'-verification-fence',preparationReceiptSha256:phase.digest(prepared.result),catalogSha256:phase.digest(phase.catalog(installed)),
    epochs:installed.epochs,approvalSemantic:phase.semantic(snapshot),fullVerificationSha256:'f'.repeat(64)}};
  const proxy={query:async(sql,args)=>sql===phase.APPROVAL_SQL?{rows:[{jsonb_build_object:snapshot}]}:pool.query(sql,args)};
  let activatedPacket;
  const activated=await stageDriver.execute(proxy,'apply',fenced,()=>{throw Error('activation_must_not_reinstall')},async packet=>{activatedPacket=packet;return true},collector,explicitProof);
  assert.equal(activated.result.readGrantsExternallyActivated,true);
  assert.equal(activatedPacket.postProof.phaseContract.approval.policyTTLSeconds,120);
  const final=await capture(pool);
  assert.deepEqual(final.epochs,installed.epochs);
  assert.deepEqual(catalog(final),catalog(originalPlan.after));
  assert.deepEqual(await data(),originalData);
  checks.push('four_actual_SELECTs_activate_without_DDL_epoch_or_cache_data_change');
  console.log(JSON.stringify({format:'local-two-phase-real-official-installer-controls-v1',checks,groupsPassed:checks.length,actualREADSourceQualified:false,readinessBooleansAreExplicitIOFixtures:true,productionCalls:0,providerCalls:0}));
} finally {
  await pool?.end();
  if(created)await admin.query(`DROP DATABASE ${quote(database)} WITH(FORCE)`);
  if(readerCreated)await admin.query(`DROP ROLE ${quote(reader)}`);
  await admin.end();
}
