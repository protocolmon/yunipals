// Catalog-only transition for the fresh combined source. A separate owner must
// drain the cache writer and bind current source, generation and READ receipts.
// This module never selects a service, scans a chain or writes source/cache rows.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const binding = Object.freeze({
  physicalSchema: "unified_ypal_20261023_v1",
  readSchema: "yunipals_ownership_4e77f52b_v4",
  sourceRelease:
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
  readIdentity:
    "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67"
});
const physical = binding.physicalSchema;
const priorPhysical = "unified_shadow_20261020_7e7375b0";
const common = [
  "metadata.token_metadata",
  "metadata.token_publication",
  "metadata_projection.search",
  "metadata_projection.revision",
  "metadata_source.archive_release",
  "metadata.publication_runtime"
];
const ownership = [
  "yunipals_indexer_v3",
  "bnb_indexer",
  priorPhysical,
  physical
].flatMap((schema) =>
  ["token", "token_lifecycle", "transfer_event"].map(
    (name) => `${schema}.${name}`
  )
);
const base = [
  "metadata_source.chain_metadata_event",
  "metadata_source.chain_metadata_scan",
  "metadata_source.native_base_metadata_state",
  `${priorPhysical}.canonical_event`,
  `${physical}.canonical_event`
];
const cache = ["read_epoch", "read_guard", "read_set", "read_member"].map(
  (name) => `metadata_projection.${name}`
);
export const relations = [
  ...new Set([...common, ...ownership, ...base, ...cache])
].sort();
const functions = [
  "metadata_projection.read_cache_dirty()",
  "metadata_projection.read_cache_projection_dirty()"
];
const triggerNames = [
  "read_cache_dirty",
  "read_cache_dirty_update",
  "read_cache_dirty_delete",
  "read_cache_truncate"
];
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const relation = (value) => {
  assert(relations.includes(value), "fixed_guard_relation_required");
  return value.split(".").map(quote).join(".");
};
const json = (value) => JSON.stringify(value);
export const digest = (value) =>
  createHash("sha256").update(json(value)).digest("hex");

export function guardSql() {
  const shared = common.filter(
    (name) => name !== "metadata.publication_runtime"
  );
  const values = ["ethereum", "base", "polygon", "bnb"].flatMap(
    (collection) => {
      const names = [
        ...shared,
        ...["token", "token_lifecycle", "transfer_event"].map(
          (name) => `${physical}.${name}`
        )
      ];
      if (collection === "base")
        names.push(
          `${physical}.canonical_event`,
          "metadata_source.native_base_metadata_state",
          "metadata.publication_runtime"
        );
      return names.map((name) => `('${collection}','${name}'::regclass)`);
    }
  );
  return `WITH wanted(collection,relation_oid)AS(VALUES ${values.join(",")}),
    expected AS(SELECT w.*,g.relation FROM wanted w LEFT JOIN metadata_projection.read_guard g USING(collection,relation_oid))
    SELECT jsonb_build_object('valid',
      NOT EXISTS(SELECT 1 FROM expected e WHERE e.relation IS NULL OR to_regclass(e.relation) IS DISTINCT FROM e.relation_oid
        OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=e.relation_oid AND t.tgname='read_cache_dirty' AND t.tgenabled='A'
          AND t.tgfoid=CASE WHEN e.relation_oid IN('metadata_projection.search'::regclass,'metadata_projection.revision'::regclass)
            THEN 'metadata_projection.read_cache_projection_dirty()'::regprocedure ELSE 'metadata_projection.read_cache_dirty()'::regprocedure END)
        OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=e.relation_oid AND t.tgname='read_cache_truncate' AND t.tgenabled='A'
          AND t.tgfoid='metadata_projection.read_cache_dirty()'::regprocedure)
        OR(e.relation_oid IN('metadata_projection.search'::regclass,'metadata_projection.revision'::regclass)
          AND(SELECT count(*)FROM pg_trigger t WHERE t.tgrelid=e.relation_oid AND t.tgname IN('read_cache_dirty_update','read_cache_dirty_delete')
            AND t.tgenabled='A' AND t.tgfoid='metadata_projection.read_cache_projection_dirty()'::regprocedure)<>2))
      AND NOT EXISTS(SELECT 1 FROM metadata_projection.read_guard g WHERE g.collection IN('ethereum','base','polygon','bnb')
        AND NOT EXISTS(SELECT 1 FROM wanted w WHERE w.collection=g.collection AND w.relation_oid=g.relation_oid))
      AND(SELECT count(*)FROM metadata_projection.read_guard)=35
      AND(SELECT count(*)FROM metadata_projection.read_epoch WHERE collection IN('ethereum','base','polygon','bnb'))=4
      AND(SELECT count(*)FROM metadata_projection.read_epoch)=4)`;
}

export async function capture(db) {
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const guards = await q(
    "SELECT collection,relation,relation_oid::text AS oid FROM metadata_projection.read_guard ORDER BY collection,relation"
  );
  const epochs = await q(
    "SELECT collection,revision::text FROM metadata_projection.read_epoch ORDER BY collection"
  );
  const tables = await q(
    `SELECT w.name,c.oid::text,c.relowner::text AS owner,c.relkind,
      (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
      (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY pg_get_indexdef(i.indexrelid))
        FROM pg_index i WHERE i.indrelid=c.oid) AS indexes
    FROM unnest($1::text[])w(name) LEFT JOIN pg_class c ON c.oid=to_regclass(w.name) ORDER BY w.name`,
    [relations]
  );
  assert(
    tables.length === relations.length &&
      tables.every((t) => t.oid && t.relkind === "r"),
    "existing_fixed_guard_tables_required"
  );
  const acl = await q(
    `SELECT w.name,x.grantor::text,x.grantee::text,pg_get_userbyid(x.grantee) AS role,
      x.privilege_type AS privilege,x.is_grantable AS grantable
    FROM unnest($1::text[])w(name) JOIN pg_class c ON c.oid=to_regclass(w.name)
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x
    ORDER BY w.name,x.grantor,x.grantee,x.privilege_type`,
    [relations]
  );
  const columnAcl = await q(
    `SELECT w.name,a.attnum AS column_number,a.attname AS column_name,
      x.grantor::text,x.grantee::text,x.privilege_type AS privilege,x.is_grantable AS grantable
    FROM unnest($1::text[])w(name) JOIN pg_attribute a ON a.attrelid=to_regclass(w.name)
    CROSS JOIN LATERAL aclexplode(a.attacl)x
    WHERE a.attnum>0 AND NOT a.attisdropped
    ORDER BY w.name,a.attnum,x.grantor,x.grantee,x.privilege_type`,
    [relations]
  );
  const funcs = await q(
    `SELECT p.oid::text,p.oid::regprocedure::text AS name,p.proowner::text AS owner,
      p.proacl::text AS acl,pg_get_functiondef(p.oid) AS definition
    FROM unnest($1::text[])w(name) JOIN pg_proc p ON p.oid=to_regprocedure(w.name) ORDER BY p.proname`,
    [functions]
  );
  assert.equal(funcs.length, 2, "existing_two_cache_functions_required");
  const triggers = await q(
    `SELECT w.name AS relation,t.tgname AS name,t.tgenabled AS enabled,
      pg_get_triggerdef(t.oid,false) AS definition
    FROM unnest($1::text[])w(name) JOIN pg_trigger t ON t.tgrelid=to_regclass(w.name)
    WHERE NOT t.tgisinternal AND t.tgname=ANY($2::text[]) ORDER BY w.name,t.tgname`,
    [relations, triggerNames]
  );
  return { guards, epochs, tables, acl, columnAcl, functions: funcs, triggers };
}

export const catalog = (value) => ({
  ...value,
  epochs: value.epochs.map((e) => ({ collection: e.collection }))
});
const key = (value) => json(value);

function effect(before, after) {
  assert.deepEqual(
    after.tables,
    before.tables,
    "additive_schema_already_present_required"
  );
  assert(
    Array.isArray(before.columnAcl) && Array.isArray(after.columnAcl),
    "complete_column_ACL_capture_required"
  );
  assert.deepEqual(
    after.columnAcl,
    before.columnAcl,
    "original_column_permissions_must_be_preserved"
  );
  assert.deepEqual(
    after.functions.map(({ definition, ...row }) => row),
    before.functions.map(({ definition, ...row }) => row),
    "function_identity_owner_and_ACL_must_be_preserved"
  );
  assert.deepEqual(
    after.epochs.map((e) => ({
      ...e,
      revision: String(BigInt(e.revision) - 1n)
    })),
    before.epochs,
    "official_migration_must_increment_each_existing_epoch_once"
  );
  const old = new Set(before.acl.map(key)),
    next = new Set(after.acl.map(key));
  assert(
    before.acl.every((row) => next.has(key(row))),
    "official_migration_removed_or_changed_existing_ACL"
  );
  const added = after.acl.filter((row) => !old.has(key(row)));
  assert(
    added.every(
      (row) =>
        cache.includes(row.name) &&
        row.privilege === "SELECT" &&
        !row.grantable &&
        row.grantee !== "0"
    ),
    "only_official_finite_cache_SELECT_additions_allowed"
  );
  // PostgreSQL's table-level REVOKE SELECT also revokes column SELECT rights.
  // Refuse this specific pre-existing overlap so an owned inverse preserves it.
  assert(
    added.every(
      (grant) =>
        !before.columnAcl.some(
          (column) =>
            column.name === grant.name &&
            column.grantee === grant.grantee &&
            column.privilege === "SELECT"
        )
    ),
    "preexisting_column_SELECT_requires_separate_inverse"
  );
  return added;
}

async function begin(db) {
  await db.query("BEGIN");
  await db.query(
    "SET LOCAL lock_timeout='1s';SET LOCAL statement_timeout='60s'"
  );
  await db.query(
    `LOCK TABLE ${relations.map(relation).join(",")} IN SHARE ROW EXCLUSIVE MODE`
  );
}

async function native(db) {
  const rows = (await db.query(guardSql())).rows;
  assert(
    rows.length === 1 && Object.values(rows[0])[0]?.valid === true,
    "exact_fresh_native35_guard_graph_required"
  );
}

export async function rehearse(db, installReadCache) {
  let before, after, grants;
  try {
    await begin(db);
    before = await capture(db);
    await installReadCache(db);
    await native(db);
    after = await capture(db);
    grants = effect(before, after);
  } finally {
    await db.query("ROLLBACK");
  }
  assert.deepEqual(
    catalog(await capture(db)),
    catalog(before),
    "official_rehearsal_changed_catalog"
  );
  return {
    format: "yunipals-ypal-cache-guard-transition-v1",
    binding,
    before,
    after,
    addedSelects: grants,
    beforeCatalogSha256: digest(catalog(before)),
    afterCatalogSha256: digest(catalog(after)),
    committed: false,
    officialRollbackRehearsed: true
  };
}

function validate(plan, committed) {
  assert.equal(plan.format, "yunipals-ypal-cache-guard-transition-v1");
  assert.deepEqual(plan.binding, binding, "fresh_source_binding_required");
  assert.equal(plan.committed, committed);
  assert.equal(plan.officialRollbackRehearsed, true);
  assert.equal(digest(catalog(plan.before)), plan.beforeCatalogSha256);
  assert.equal(digest(catalog(plan.after)), plan.afterCatalogSha256);
  assert.deepEqual(effect(plan.before, plan.after), plan.addedSelects);
}

export async function apply(db, plan, installReadCache) {
  validate(plan, false);
  let before, after;
  try {
    await begin(db);
    before = await capture(db);
    assert.deepEqual(
      catalog(before),
      catalog(plan.before),
      "reviewed_legacy_catalog_changed"
    );
    await installReadCache(db);
    await native(db);
    after = await capture(db);
    assert.deepEqual(
      effect(before, after),
      plan.addedSelects,
      "finite_official_SELECT_effect_changed"
    );
    assert.deepEqual(
      catalog(after),
      catalog(plan.after),
      "reviewed_native_catalog_changed"
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
  return {
    ...plan,
    before,
    after,
    committed: true,
    epochPolicy: "increment_current_once",
    cacheRowsWritten: 0
  };
}

export async function inverse(db, receipt) {
  validate(receipt, true);
  let before, after;
  try {
    await begin(db);
    before = await capture(db);
    assert.deepEqual(
      catalog(before),
      catalog(receipt.after),
      "owned_native_catalog_changed"
    );
    for (const fn of receipt.before.functions) await db.query(fn.definition);
    const old = new Map(
      receipt.before.triggers.map((t) => [`${t.relation}:${t.name}`, t])
    );
    const now = new Map(
      before.triggers.map((t) => [`${t.relation}:${t.name}`, t])
    );
    for (const [name, trigger] of now)
      if (!old.has(name))
        await db.query(
          `DROP TRIGGER ${quote(trigger.name)} ON ${relation(trigger.relation)}`
        );
    for (const [name, trigger] of old) {
      if (json(now.get(name)) === json(trigger)) continue;
      if (now.has(name))
        await db.query(
          `DROP TRIGGER ${quote(trigger.name)} ON ${relation(trigger.relation)}`
        );
      await db.query(trigger.definition);
      const enable = {
        A: "ENABLE ALWAYS",
        O: "ENABLE",
        D: "DISABLE",
        R: "ENABLE REPLICA"
      }[trigger.enabled];
      assert(enable, "saved_trigger_state_required");
      await db.query(
        `ALTER TABLE ${relation(trigger.relation)} ${enable} TRIGGER ${quote(trigger.name)}`
      );
    }
    await db.query("DELETE FROM metadata_projection.read_guard");
    for (const row of receipt.before.guards)
      await db.query(
        "INSERT INTO metadata_projection.read_guard(collection,relation,relation_oid)VALUES($1,$2,$3::oid)",
        [row.collection, row.relation, row.oid]
      );
    for (const grant of receipt.addedSelects)
      await db.query(
        `REVOKE SELECT ON TABLE ${relation(grant.name)} FROM ${quote(grant.role)}`
      );
    await db.query(
      "UPDATE metadata_projection.read_epoch SET revision=revision+1"
    );
    after = await capture(db);
    assert.deepEqual(
      catalog(after),
      catalog(receipt.before),
      "inverse_must_restore_exact_prior_catalog"
    );
    assert.deepEqual(
      after.epochs.map((e) => ({
        ...e,
        revision: String(BigInt(e.revision) - 1n)
      })),
      before.epochs
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
  return {
    format: "yunipals-ypal-cache-guard-inverse-v1",
    binding,
    restored: true,
    priorCatalogSha256: receipt.beforeCatalogSha256,
    epochPolicy: "increment_current_once",
    beforeEpochs: before.epochs,
    afterEpochs: after.epochs,
    cacheRowsWritten: 0,
    sourceRowsWritten: 0
  };
}
