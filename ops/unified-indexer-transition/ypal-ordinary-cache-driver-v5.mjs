// Dedicated SQL child. Root owns service drain, private journals and receipt ACKs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import * as transition from "./ypal-ordinary-cache-transition-v5.mjs";

export const FORMAT = "yunipals-ypal-cache-guard-sql-v1";
export const COLLECTOR = Object.freeze({
  name: "yunipals_unified_collector",
  oid: "73187672"
});
export const CACHE_TABLES = [
  "read_epoch",
  "read_guard",
  "read_set",
  "read_member"
]
  .map((v) => "metadata_projection." + v)
  .sort();
export const PROJECT =
  "/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const same = (a, b) => assert.deepEqual(a, b);

export function exactFourReads(plan, collector = COLLECTOR) {
  assert.equal(
    plan.addedSelects.length,
    4,
    "only_four_explicit_collector_reads_allowed"
  );
  same(plan.addedSelects.map((v) => v.name).sort(), CACHE_TABLES);
  for (const row of plan.addedSelects) {
    assert.equal(row.role, collector.name);
    assert.equal(row.grantee, collector.oid);
    assert.equal(row.privilege, "SELECT");
    assert.equal(row.grantable, false);
    assert(/^[1-9][0-9]*$/.test(row.grantor));
    assert(
      !plan.before.acl.some(
        (v) =>
          v.name === row.name &&
          v.grantee === row.grantee &&
          v.privilege === "SELECT"
      )
    );
  }
  return plan.addedSelects;
}

export async function observe(db) {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await transition.capture(db);
    const transaction = (
      await db.query(
        "SELECT current_database()AS database,current_user AS role,session_user AS session_user,inet_client_addr()IS NULL AS unix,(SELECT oid::text FROM pg_database WHERE datname=current_database())AS database_oid"
      )
    ).rows[0];
    await db.query("COMMIT");
    return {
      format: FORMAT,
      inspected: true,
      state,
      catalogSha256: transition.digest(transition.catalog(state)),
      transaction,
      databaseWrites: 0
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

// The original component keeps ownership of every transaction and catalog check.
// The wrapper only obtains the actual transaction ID and requires a root-fsynced
// intent acknowledgement immediately before that same client's COMMIT.
export async function execute(
  db,
  mode,
  plan,
  installReadCache,
  prepared,
  collector = COLLECTOR,
  captureProof = async () => null,
  opened = async () => {}
) {
  assert(["rehearse", "apply", "inverse"].includes(mode));
  if (mode !== "rehearse") exactFourReads(plan, collector);
  let xid = null,
    commits = 0,
    postProof = null,
    transactionBefore = null;
  const client = {
    query: async (sql, args) => {
      const text = typeof sql === "string" ? sql.trim() : "";
      if (text === "BEGIN") {
        const result = await db.query(sql, args);
        xid = (await db.query("SELECT pg_current_xact_id()::text AS xid"))
          .rows[0].xid;
        assert(/^[1-9][0-9]*$/.test(xid));
        const backend = (
          await db.query(
            "SELECT jsonb_build_object('pid',pid,'backendStart',(extract(epoch from backend_start)*1000000)::numeric(30,0)::text,'clientAddress',client_addr::text,'clientPort',client_port,'xid',backend_xid::text,'roleOid',usesysid::text,'databaseOid',datid::text)AS value FROM pg_stat_activity WHERE pid=pg_backend_pid()"
          )
        ).rows[0].value;
        await opened({
          format: FORMAT,
          event: "transaction-opened",
          mode,
          xid,
          backend
        });
        return result;
      }
      if (text.startsWith("LOCK TABLE ")) {
        const result = await db.query(sql, args);
        transactionBefore = await transition.capture(db);
        return result;
      }
      if (text === "COMMIT") {
        assert(
          mode !== "rehearse" && xid && commits++ === 0,
          "single_owned_cache_commit_required"
        );
        const after = await transition.capture(db);
        postProof = await captureProof(db);
        const message = {
          format: FORMAT,
          event: "commit-prepared",
          mode,
          xid,
          postProof,
          before: transactionBefore,
          beforeJson: JSON.stringify(transactionBefore),
          after,
          afterJson: JSON.stringify(after),
          afterCatalogSha256: transition.digest(transition.catalog(after)),
          planSha256: transition.digest(plan)
        };
        assert.equal(
          await prepared(message),
          true,
          "durable_root_intent_ACK_required"
        );
      }
      if (text === "ROLLBACK" && mode === "rehearse") {
        try {
          postProof = await captureProof(db);
        } catch {
          postProof = null;
        } // Never prevent ROLLBACK of an aborted transaction.
      }
      return db.query(sql, args);
    }
  };
  if (mode !== "rehearse") {
    const lock = (
      await db.query(
        "SELECT pg_try_advisory_lock(hashtext('yunipals:read-cache'))AS locked"
      )
    ).rows[0];
    assert.equal(
      lock.locked,
      true,
      "cache_worker_must_be_drained_before_sql_mutation"
    );
  }
  try {
    const result =
      mode === "rehearse"
        ? await transition.rehearse(client, installReadCache)
        : mode === "apply"
          ? await transition.apply(client, plan, installReadCache)
          : await transition.inverse(client, plan);
    if (mode === "rehearse") exactFourReads(result, collector);
    assert.equal(commits, mode === "rehearse" ? 0 : 1);
    return {
      format: FORMAT,
      mode,
      acknowledged: true,
      xid,
      result,
      resultJson: JSON.stringify(result),
      postProof
    };
  } finally {
    if (mode !== "rehearse")
      await db
        .query("SELECT pg_advisory_unlock(hashtext('yunipals:read-cache'))")
        .catch(() => {});
  }
}

export async function loadInstaller() {
  const manifest = JSON.parse(
    readFileSync(PROJECT + "/../../RELEASE-MANIFEST.json")
  );
  assert.equal(
    sha(readFileSync(PROJECT + "/../../RELEASE-MANIFEST.json")),
    "6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801"
  );
  const closure = [
    "lib/metadata/read-cache-schema.ts",
    "lib/offchain/sql.ts",
    "lib/ownership/read-mode.ts",
    "lib/constants.ts",
    "lib/metadata/base-mode.ts",
    "lib/metadata/read-cache.ts"
  ];
  const checked = new Set();
  while (closure.length) {
    const name = closure.shift();
    if (checked.has(name)) continue;
    assert(
      checked.size < 64 && !name.startsWith("../") && name.endsWith(".ts"),
      "finite_accepted_cache_source_closure_required"
    );
    checked.add(name);
    const row = manifest.files.find(
      (v) => v.path === "apps/yunipals-indexer/" + name
    );
    const source = readFileSync(PROJECT + "/" + name);
    assert(
      row && sha(source) === row.sha256,
      "accepted_official_installer_closure_required"
    );
    for (const imported of source
      .toString()
      .matchAll(/from\s+["'](\.[^"']+)["']/g))
      closure.push(
        path.posix
          .normalize(path.posix.join(path.posix.dirname(name), imported[1]))
          .replace(/\.js$/, ".ts")
      );
  }
  assert.equal(
    sha(readFileSync(PROJECT + "/lib/metadata/read-cache-schema.ts")),
    "1de7856e5fc9253dbc08d6db0b0408516252030d353bcc4409ecdb20a0922757"
  );
  return (
    await import(
      pathToFileURL(PROJECT + "/lib/metadata/read-cache-schema.ts").href
    )
  ).installReadCache;
}

export async function freshness(db, generationId, readCacheFreshSql) {
  assert(/^[1-9][0-9]*$/.test(generationId));
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const pointer = (
      await db.query(
        "SELECT a.current_id::text AS id,g.state,g.ownership_release_id AS release,g.ownership_read_identity AS identity FROM metadata_projection.active a JOIN metadata_projection.generation g ON g.id=a.current_id WHERE a.singleton"
      )
    ).rows[0];
    assert.equal(pointer.id, generationId);
    assert.equal(pointer.state, "ready");
    assert.equal(pointer.release, transition.binding.sourceRelease);
    assert.equal(pointer.identity, transition.binding.readIdentity);
    const collections = [];
    for (const collection of ["ethereum", "base", "polygon", "bnb"])
      collections.push({
        collection,
        fresh: (
          await db.query(
            "SELECT " +
              readCacheFreshSql(generationId, [collection]) +
              " AS fresh"
          )
        ).rows[0].fresh
      });
    await db.query("COMMIT");
    return {
      format: FORMAT,
      inspected: true,
      generationId,
      collections,
      databaseWrites: 0
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  assert.equal(process.getuid(), 111);
  assert.equal(process.getgid(), 113);
  assert(
    process.getgroups().length === 0 ||
      process.getgroups().every((v) => v === 113)
  );
  const status = readFileSync("/proc/self/status", "utf8");
  for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    assert.equal(
      status.match(new RegExp("^" + field + ":\\s*([a-f0-9]+)$", "m"))?.[1],
      "0000000000000000"
    );
  assert.equal(status.match(/^NoNewPrivs:\s*(\d+)$/m)?.[1], "1");
  assert.equal(process.ppid, Number(process.env.YUNIPALS_CACHE_OWNER_PID));
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const request = JSON.parse((await lines.next()).value);
  assert(
    ["inspect", "freshness", "rehearse", "apply", "inverse"].includes(
      request.mode
    )
  );
  assert.equal(
    sha(request.catalogSql),
    "cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991"
  );
  assert.equal(
    sha(request.readerSql),
    "95efde36a354536f02a9bfa324ffbc987a7d4d0532c9a1669fdd3818e2659630"
  );
  const install = await loadInstaller();
  const pg = createRequire(PROJECT + "/package.json")("pg");
  const db = new pg.Client({
    host: "/var/run/postgresql",
    port: 5432,
    user: "postgres",
    database: "yunipals_backfill",
    connectionTimeoutMillis: 5000,
    application_name: "ypal_cache_guard_owner_v1",
    options:
      "-c statement_timeout=65000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000 -c search_path=pg_catalog -c timezone=UTC" +
      (["inspect", "freshness"].includes(request.mode)
        ? " -c default_transaction_read_only=on"
        : "")
  });
  await db.connect();
  try {
    const identity = (
      await db.query(
        "SELECT current_user=session_user AND current_user='postgres' AND current_database()='yunipals_backfill' AND inet_client_addr()IS NULL AND current_setting('port')='5432' AND current_setting('data_directory')='/var/lib/postgresql/16/main' AND (SELECT oid FROM pg_database WHERE datname=current_database())=17584 AND (SELECT oid FROM pg_roles WHERE rolname=current_user)=10 AS valid"
      )
    ).rows[0];
    assert.equal(identity.valid, true);
    const proof = async () => ({
      catalog: (await db.query(request.catalogSql)).rows[0].jsonb_build_object,
      reader: (await db.query(request.readerSql)).rows[0].jsonb_build_object
    });
    const result =
      request.mode === "freshness"
        ? await freshness(
            db,
            request.generationId,
            (
              await import(
                pathToFileURL(PROJECT + "/lib/metadata/read-cache.ts").href
              )
            ).readCacheFreshSql
          )
        : request.mode === "inspect"
          ? { ...(await observe(db)), postProof: await proof() }
          : await execute(
              db,
              request.mode,
              JSON.parse(request.planJson),
              install,
              async (message) => {
                process.stdout.write(JSON.stringify(message) + "\n");
                const reply = JSON.parse((await lines.next()).value);
                assert.equal(reply.event, "commit-authorized");
                assert.equal(reply.xid, message.xid);
                assert.equal(reply.preparedSha256, transition.digest(message));
                return true;
              },
              COLLECTOR,
              proof,
              async (message) => {
                process.stdout.write(JSON.stringify(message) + "\n");
                const reply = JSON.parse((await lines.next()).value);
                assert.equal(reply.event, "transaction-opened-recorded");
                assert.equal(reply.xid, message.xid);
                assert.equal(reply.openedSha256, transition.digest(message));
              }
            );
    process.stdout.write(
      JSON.stringify({ event: "result", value: result }) + "\n"
    );
  } finally {
    lines.return?.();
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stdout.write(
      JSON.stringify({
        event: "refused",
        format: FORMAT,
        automaticRetryAllowed: false
      }) + "\n"
    );
    process.exitCode = 1;
  });
