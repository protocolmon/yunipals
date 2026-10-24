// Executes the actual inverse transaction in a fresh disposable LOCAL database.
// Only its fixed production role/database context literals become fixture names.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createHash } from "node:crypto";

const testUrl = process.env.METADATA_OWNER_LOCAL_POSTGRES_URL;
assert(testUrl, "Explicit local synthetic PostgreSQL URL is required.");
const endpoint = new URL(testUrl);
assert.equal(endpoint.hostname, "127.0.0.1");
assert.equal(endpoint.port, "56967");
assert.equal(endpoint.pathname, "/yunipals_ponder_dependency_test");
const require = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
);
const { Client } = require("pg");
const ownerSource = readFileSync(
  new URL("./ypal-native-metadata-handover-v1.py", import.meta.url),
  "utf8"
);
const original = ownerSource.match(/INVERSE_JS = r"""([\s\S]*?)"""/)[1];
const name = `metadata_inverse_${Date.now()}_${process.pid}`;
assert.match(name, /^metadata_inverse_[0-9]+_[0-9]+$/);
const admin = new Client({ connectionString: testUrl });
let db,
  created = false,
  held;
const expectedScan = {
  name: "base_metadata_v1",
  chain_id: 8453,
  next_block: 30000001,
  ingestion_mode: "rpc"
};
try {
  await admin.connect();
  const actor = (await admin.query("SELECT current_user AS name")).rows[0].name;
  assert.match(actor, /^[a-z_][a-z0-9_]*$/);
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const databaseUrl = new URL(testUrl);
  databaseUrl.pathname = "/" + name;
  db = new Client({ connectionString: databaseUrl.href });
  await db.connect();
  await db.query(`CREATE SCHEMA metadata_source; CREATE SCHEMA metadata;
    CREATE TABLE metadata_source.chain_metadata_scan(name text PRIMARY KEY,chain_id integer,next_block bigint,ingestion_mode text,updated_at timestamptz);
    CREATE TABLE metadata_source.native_base_metadata_state(release_id text PRIMARY KEY,read_identity text,state text,error_code text);
    CREATE TABLE metadata_source.chain_metadata_event(marker text);
    CREATE TABLE metadata.token_publication(proof text);
    INSERT INTO metadata_source.chain_metadata_event VALUES('preserved-journal');
    INSERT INTO metadata.token_publication VALUES('preserved-provenance');`);
  const reset = async (identity = "read-fixture") => {
    await db.query(
      "DELETE FROM metadata_source.chain_metadata_scan;DELETE FROM metadata_source.native_base_metadata_state"
    );
    await db.query(
      "INSERT INTO metadata_source.chain_metadata_scan VALUES('base_metadata_v1',8453,30000001,'native',clock_timestamp())"
    );
    await db.query(
      "INSERT INTO metadata_source.native_base_metadata_state VALUES('release-fixture',$1,'ready',NULL)",
      [identity]
    );
  };
  const unchanged = async () => {
    assert.equal(
      (
        await db.query(
          "SELECT marker FROM metadata_source.chain_metadata_event"
        )
      ).rows[0].marker,
      "preserved-journal"
    );
    assert.equal(
      (await db.query("SELECT proof FROM metadata.token_publication")).rows[0]
        .proof,
      "preserved-provenance"
    );
  };
  assert.equal(original.split("who.role!=='yunipals'").length, 2);
  assert.equal(original.split("who.database!=='yunipals_backfill'").length, 2);
  const source = original
    .replace("who.role!=='yunipals'", `who.role!==${JSON.stringify(actor)}`)
    .replace(
      "who.database!=='yunipals_backfill'",
      `who.database!==${JSON.stringify(name)}`
    );
  const run = async (scan = expectedScan) => {
    const output = [],
      processFixture = {
        env: { DATABASE_URL: databaseUrl.href },
        cwd: () => "/fixture",
        exitCode: 0,
        stdin: {
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify({
              scan,
              release: "release-fixture",
              identity: "read-fixture"
            });
          }
        }
      };
    const context = vm.createContext({
      process: processFixture,
      console: { log: (raw) => output.push(JSON.parse(raw)) }
    });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(async (specifier) => {
      assert.equal(specifier, "node:module");
      return new vm.SyntheticModule(
        ["createRequire"],
        function () {
          this.setExport("createRequire", () => () => ({ Client }));
        },
        { context }
      );
    });
    await module.evaluate();
    assert.equal(output.length, 1);
    return { result: output[0], exitCode: processFixture.exitCode };
  };
  await reset();
  const success = await run();
  assert.equal(success.exitCode, 0);
  assert.deepEqual(success.result, {
    modeRestored: "rpc",
    approvalBlocked: true,
    journalOrProvenanceRowsDeleted: 0
  });
  assert.equal(
    (
      await db.query(
        "SELECT ingestion_mode FROM metadata_source.chain_metadata_scan"
      )
    ).rows[0].ingestion_mode,
    "rpc"
  );
  assert.equal(
    (
      await db.query(
        "SELECT error_code FROM metadata_source.native_base_metadata_state"
      )
    ).rows[0].error_code,
    "owned_metadata_inverse"
  );
  await unchanged();
  await reset();
  const wrongCursor = await run({ ...expectedScan, next_block: 1 });
  assert.equal(wrongCursor.exitCode, 1);
  assert.equal(
    (
      await db.query(
        "SELECT ingestion_mode FROM metadata_source.chain_metadata_scan"
      )
    ).rows[0].ingestion_mode,
    "native"
  );
  await unchanged();
  await reset("foreign-read");
  const wrongIdentity = await run();
  assert.equal(wrongIdentity.exitCode, 1);
  assert.equal(
    (
      await db.query(
        "SELECT state FROM metadata_source.native_base_metadata_state"
      )
    ).rows[0].state,
    "ready"
  );
  await unchanged();
  await reset();
  held = new Client({ connectionString: databaseUrl.href });
  await held.connect();
  await held.query("SELECT pg_advisory_lock(hashtext('metadata:base-replay'))");
  const busy = await run();
  assert.equal(busy.exitCode, 1);
  assert.equal(
    (
      await db.query(
        "SELECT ingestion_mode FROM metadata_source.chain_metadata_scan"
      )
    ).rows[0].ingestion_mode,
    "native"
  );
  await unchanged();
  await held.end();
  held = undefined;
  console.log(
    JSON.stringify({
      format: "yunipals-native-metadata-inverse-local-postgres-v1",
      passed: true,
      cases: 4,
      actualInverseSourceSha256: createHash("sha256")
        .update(original)
        .digest("hex"),
      contextOnlyFixtureSubstitutions: 2,
      productionRoleAuthenticationClaimed: false,
      productionDatabaseWrites: 0,
      providerCalls: 0,
      serviceActions: 0
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      passed: false,
      errorClass: error.constructor.name,
      fixedCode: /^[A-Z0-9]{5}$/.test(error.code ?? "")
        ? error.code
        : "local_fixture_failed"
    })
  );
  process.exitCode = 1;
} finally {
  await held?.end().catch(() => {});
  await db?.end().catch(() => {});
  if (created)
    await admin.query(`DROP DATABASE "${name}"`).catch(() => {
      process.exitCode = 1;
    });
  await admin.end().catch(() => {});
}
