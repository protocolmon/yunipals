// DB-local recovery component. The caller owns writer drain, source/READ and
// metadata receipts, private-input CAS, capacity monitoring and durable intents.
// No rows, credentials, services, source state or generation payloads leave DB.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  binding,
  capture,
  catalog
} from "./ypal-cache-guard-transition-v1.mjs";

export const schema = "ypal_generation_recovery_v1";
const names = ["context", "wallet_stats", "derived_snapshot"];
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const lock = async (db) => {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('yunipals:trait-refresh'))"
  );
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('yunipals:leaderboard-refresh'))"
  );
  await db.query(
    "SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))"
  );
};
async function root(db) {
  const row = (
    await db.query(`SELECT session_user=current_user AS direct,r.rolsuper AS root,
    r.oid::text AS owner,(SELECT oid::text FROM pg_database WHERE datname=current_database())AS database
    FROM pg_roles r WHERE rolname=current_user`)
  ).rows[0];
  assert(row?.direct && row.root, "direct_database_superuser_required");
  return row;
}
async function aggregate(db, table, order, live = false) {
  assert(names.includes(table));
  const relation = live
    ? {
        wallet_stats: "leaderboard.wallet_stats",
        derived_snapshot: "metadata.derived_snapshot"
      }[table]
    : `${schema}.${table}`;
  assert(relation, "fixed_recovery_relation_required");
  return (
    await db.query(`SELECT count(*)::text AS count,
    encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY ${order}),''),'UTF8')),'hex')AS sha256,
    coalesce(sum(pg_column_size(t)),0)::text AS tuple_bytes,
    pg_total_relation_size('${relation}')::text AS allocated_bytes FROM ${relation} t
    ${live && table === "derived_snapshot" ? "WHERE name IN('traits','leaderboard')" : ""}`)
  ).rows[0];
}
const rowsOnly = (value) => ({ count: value.count, sha256: value.sha256 });
/** The protected owner binds this to its actual post-run/ACK reconciliation.
 * Only aggregate hashes and IDs are returned; no leaderboard or stamp rows. */
export async function observeGenerationRecovery(db) {
  const pointer = (
    await db.query(
      "SELECT current_id::text,previous_id::text FROM metadata_projection.active WHERE singleton"
    )
  ).rows[0];
  const observed = await current(db);
  return {
    pointer,
    generationBindingSha256: hash({
      generation: observed.generation,
      previous: observed.previous,
      archive: observed.archive
    }),
    walletStats: rowsOnly(
      await aggregate(db, "wallet_stats", "scope,owner", true)
    ),
    derivedStamps: rowsOnly(
      await aggregate(db, "derived_snapshot", "name", true)
    )
  };
}
/** Read-only reconciliation after a lost capsule COMMIT acknowledgement. */
export async function verifyGenerationRecovery(db, receipt) {
  const who = await root(db);
  assert.equal(who.database, receipt.databaseOid);
  assert.equal(who.owner, receipt.ownerOid);
  const privacy = await privateCatalog(db);
  privateOnly(privacy, who.owner);
  assert.deepEqual(privacy, receipt.catalog);
  const saved = (
    await db.query(`SELECT value FROM ${schema}.context WHERE singleton`)
  ).rows[0]?.value;
  assert(
    saved && hash(saved) === receipt.contextSha256,
    "capsule_context_changed"
  );
  assert.deepEqual(
    await aggregate(db, "wallet_stats", "scope,owner"),
    receipt.walletStats
  );
  assert.deepEqual(
    await aggregate(db, "derived_snapshot", "name"),
    receipt.derivedStamps
  );
  return {
    validated: true,
    contextSha256: receipt.contextSha256,
    databaseWrites: 0,
    rawRowsExported: false
  };
}
async function privateCatalog(db) {
  return (
    await db.query(
      `SELECT jsonb_build_object('schema',(SELECT jsonb_build_object('oid',n.oid::text,'owner',n.nspowner::text,
    'foreignAcl',EXISTS(SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))a WHERE a.grantee<>n.nspowner))FROM pg_namespace n WHERE n.nspname=$1),
    'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind,
      'foreignAcl',EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a WHERE a.grantee<>c.relowner),
      'columnAcl',EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL),
      'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid)ORDER BY i.indexrelid)FROM pg_index i WHERE i.indrelid=c.oid))ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'),
    'objects',(SELECT count(*)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1),
    'functions',(SELECT count(*)FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1))AS value`,
      [schema]
    )
  ).rows[0].value;
}
function privateOnly(value, owner) {
  assert(
    value.schema?.owner === owner && !value.schema.foreignAcl,
    "private_capsule_schema_required"
  );
  assert.deepEqual(
    value.tables.map((t) => t.name),
    [...names].sort(),
    "exact_three_capsule_tables_required"
  );
  assert(
    value.tables.every(
      (t) =>
        t.owner === owner && t.kind === "r" && !t.foreignAcl && !t.columnAcl
    ) &&
      value.functions === 0 &&
      value.objects === 4,
    "owner_only_capsule_objects_required"
  );
}
async function current(db) {
  return (
    await db.query(`SELECT jsonb_build_object(
    'active',(SELECT to_jsonb(a)||jsonb_build_object('current_id',a.current_id::text,'previous_id',a.previous_id::text)FROM metadata_projection.active a WHERE singleton),
    'generation',(SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.active a JOIN metadata_projection.generation g ON g.id=a.current_id WHERE a.singleton),
    'previous',(SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.active a JOIN metadata_projection.generation g ON g.id=a.previous_id WHERE a.singleton),
    'archive',(SELECT release_id FROM metadata_source.archive_release WHERE state='active'),
    'stamps',(SELECT jsonb_agg(to_jsonb(s)ORDER BY name)FROM metadata.derived_snapshot s WHERE name IN('traits','leaderboard'))
    )AS value`)
  ).rows[0].value;
}
function sameOldGenerations(before, now) {
  for (const key of ["generation", "previous"]) {
    const old = before[key];
    if (!old) continue;
    const observed = key === "generation" ? now.generation : now.previous;
    assert.deepEqual(observed, old, "original_ready_generation_changed");
    assert(old.state === "ready", "original_ready_generation_required");
  }
}
/** Capture once after the original writer is terminal. The protected external
 * receipt binds returned aggregates/catalog/OIDs and the exact retained context. */
export async function captureGenerationRecovery(
  db,
  externalBinding,
  beforeCommit = async () => {}
) {
  assert.match(externalBinding, /^[0-9a-f]{64}$/);
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    const who = await root(db);
    await lock(db);
    assert.equal(
      (await db.query("SELECT to_regnamespace($1)AS value", [schema])).rows[0]
        .value,
      null,
      "fresh_capsule_schema_required"
    );
    await db.query(
      "SELECT current_id FROM metadata_projection.active WHERE singleton FOR UPDATE"
    );
    await db.query(
      "SELECT release_id FROM metadata_source.archive_release WHERE state='active' FOR SHARE"
    );
    const before = await current(db);
    sameOldGenerations(before, before);
    assert(
      before.generation &&
        before.archive &&
        before.active &&
        before.stamps?.length === 2,
      "complete_original_derived_context_required"
    );
    assert(
      before.stamps.every((s) => s.metadata_release_id === before.archive),
      "original_derived_archive_mismatch"
    );
    const guard = await capture(db);
    assert.equal(guard.epochs.length, 4);
    assert.equal(guard.guards.length, 35);
    assert.deepEqual(
      guard.epochs.map((e) => e.collection),
      ["base", "bnb", "ethereum", "polygon"]
    );
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
    await db.query(
      `CREATE TABLE ${schema}.context(singleton boolean PRIMARY KEY CHECK(singleton),value jsonb NOT NULL)`
    );
    await db.query(
      `CREATE TABLE ${schema}.wallet_stats AS TABLE leaderboard.wallet_stats`
    );
    await db.query(
      `CREATE TABLE ${schema}.derived_snapshot AS SELECT * FROM metadata.derived_snapshot WHERE name IN('traits','leaderboard')`
    );
    const value = {
      format: "yunipals-generation-recovery-capsule-v1",
      owner: who.owner,
      database: who.database,
      externalBinding,
      before,
      guardCatalog: catalog(guard)
    };
    await db.query(`INSERT INTO ${schema}.context VALUES(true,$1)`, [value]);
    // Clean only privileges copied from the root's defaults onto these new
    // objects; no existing default ACL, role or consumer relation is altered.
    for (const name of names)
      await db.query(`DO $private$ DECLARE a record;BEGIN FOR a IN
      SELECT x.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x
      WHERE c.oid='${schema}.${name}'::regclass AND x.grantee<>c.relowner LOOP
      EXECUTE format('REVOKE ALL ON ${schema}.${name} FROM %s',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee))END);
      END LOOP;END $private$`);
    const privacy = await privateCatalog(db);
    privateOnly(privacy, who.owner);
    const summary = {
      format: value.format,
      databaseOid: who.database,
      ownerOid: who.owner,
      externalBinding,
      contextSha256: hash(value),
      catalog: privacy,
      walletStats: await aggregate(db, "wallet_stats", "scope,owner"),
      derivedStamps: await aggregate(db, "derived_snapshot", "name"),
      currentGeneration: before.generation.id,
      previousGeneration: before.previous?.id ?? null,
      archiveRelease: before.archive,
      generationBindingSha256: hash({
        generation: before.generation,
        previous: before.previous,
        archive: before.archive
      }),
      preservedGenerations: [before.generation.id, before.previous?.id].filter(
        Boolean
      ),
      rawRowsExported: false
    };
    await beforeCommit(summary);
    await db.query("COMMIT");
    return summary;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/** Inverse is before consumer/cache handover, or after their separately owned
 * inverses. Caller must supply a fresh exact external-binding observation and
 * prove its fresh worker terminal before entering this transaction. */
export async function restoreGenerationRecovery(
  db,
  receipt,
  ownedGenerationId,
  externalBinding,
  ownedDerivedObservation,
  beforeCommit = async () => {}
) {
  assert.match(ownedGenerationId, /^[1-9][0-9]{0,18}$/);
  assert.equal(
    externalBinding,
    receipt.externalBinding,
    "coordinated_consumer_inverse_required"
  );
  await db.query("BEGIN");
  try {
    const who = await root(db);
    await lock(db);
    assert.equal(who.database, receipt.databaseOid);
    assert.equal(who.owner, receipt.ownerOid);
    const privacy = await privateCatalog(db);
    privateOnly(privacy, who.owner);
    assert.deepEqual(privacy, receipt.catalog, "capsule_catalog_changed");
    const saved = (
      await db.query(
        `SELECT value FROM ${schema}.context WHERE singleton FOR UPDATE`
      )
    ).rows[0]?.value;
    assert(
      saved && hash(saved) === receipt.contextSha256,
      "capsule_context_changed"
    );
    assert.equal(saved.externalBinding, externalBinding);
    assert.deepEqual(
      await aggregate(db, "wallet_stats", "scope,owner"),
      receipt.walletStats,
      "capsule_wallet_rows_changed"
    );
    assert.deepEqual(
      await aggregate(db, "derived_snapshot", "name"),
      receipt.derivedStamps,
      "capsule_stamp_rows_changed"
    );
    assert.deepEqual(
      catalog(await capture(db)),
      saved.guardCatalog,
      "cache_guard_inverse_required"
    );
    await db.query(
      "SELECT current_id FROM metadata_projection.active WHERE singleton FOR UPDATE"
    );
    await db.query(
      "SELECT release_id FROM metadata_source.archive_release WHERE state='active' FOR SHARE"
    );
    const observed = await current(db),
      before = saved.before;
    assert.deepEqual(
      await observeGenerationRecovery(db),
      ownedDerivedObservation,
      "owned_post_run_derived_observation_required"
    );
    assert.equal(observed.archive, before.archive, "archive_release_changed");
    assert.equal(
      observed.active.current_id,
      ownedGenerationId,
      "owned_published_pointer_required"
    );
    assert.equal(
      observed.active.previous_id,
      before.active.current_id,
      "owned_predecessor_required"
    );
    assert.equal(observed.generation.state, "ready");
    assert.equal(
      observed.generation.ownership_release_id,
      binding.sourceRelease
    );
    assert.equal(
      observed.generation.ownership_read_identity,
      binding.readIdentity
    );
    assert.equal(observed.generation.metadata_release_id, before.archive);
    assert.equal(
      observed.generation.validation?.sourceSnapshot?.predecessor,
      before.active.current_id,
      "owned_source_snapshot_required"
    );
    assert.equal(
      observed.generation.ownership_release_id,
      observed.generation.validation.sourceSnapshot.releaseId
    );
    assert.equal(
      observed.generation.ownership_read_identity,
      observed.generation.validation.sourceSnapshot.readIdentity
    );
    for (const old of [before.generation, before.previous].filter(Boolean)) {
      const row = (
        await db.query(
          "SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)AS value FROM metadata_projection.generation g WHERE id=$1 FOR SHARE",
          [old.id]
        )
      ).rows[0]?.value;
      assert.deepEqual(row, old, "preserved_original_generation_changed");
    }
    assert(
      observed.stamps.every(
        (s) =>
          s.metadata_release_id === before.archive &&
          ((s.name === "leaderboard" &&
            JSON.stringify(s) ===
              JSON.stringify(
                before.stamps.find((old) => old.name === "leaderboard")
              )) ||
            (s.ownership_release_id ===
              observed.generation.ownership_release_id &&
              s.ownership_read_identity ===
                observed.generation.ownership_read_identity))
      ),
      "owned_or_unmodified_derived_stamps_required"
    );
    await db.query("DELETE FROM leaderboard.wallet_stats");
    await db.query(
      `INSERT INTO leaderboard.wallet_stats SELECT * FROM ${schema}.wallet_stats`
    );
    // DELETE+INSERT restores every stamp column, including null legacy IDs.
    await db.query(
      "DELETE FROM metadata.derived_snapshot WHERE name IN('traits','leaderboard')"
    );
    await db.query(
      `INSERT INTO metadata.derived_snapshot SELECT * FROM ${schema}.derived_snapshot`
    );
    await db.query(
      "UPDATE metadata_projection.active SET current_id=$1,previous_id=$2,updated_at=clock_timestamp()WHERE singleton AND current_id=$3",
      [before.active.current_id, before.active.previous_id, ownedGenerationId]
    );
    const epochs = (
      await db.query(
        "UPDATE metadata_projection.read_epoch SET revision=revision+1 RETURNING collection,revision::text"
      )
    ).rows;
    assert.equal(epochs.length, 4);
    assert.deepEqual(epochs.map((e) => e.collection).sort(), [
      "base",
      "bnb",
      "ethereum",
      "polygon"
    ]);
    const result = {
      format: "yunipals-generation-recovery-inverse-v1",
      restored: true,
      currentGeneration: before.active.current_id,
      previousGeneration: before.active.previous_id,
      ownedGenerationRetained: ownedGenerationId,
      allDerivedIdentityColumnsRestored: true,
      epochs: epochs.sort((a, b) => a.collection.localeCompare(b.collection)),
      rawRowsExported: false
    };
    await beforeCommit(result);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
