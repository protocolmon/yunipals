// Isolated PG16 synthetic database only. Exact frozen f81 SQL; no production.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  authenticateArtifact,
  queryCandidates,
  sha
} from "./ypal-generation-f81-phase-diagnostic-v1.mjs";

const require = createRequire(
  "/root/yunipals/apps/yunipals-indexer/package.json"
);
const { Client } = require("pg");
const endpoint = "postgresql://postgres@127.0.0.1:56981/";
const args = process.argv.slice(2);
assert.deepEqual([args.length, args[0], args[2]], [4, "--tokens", "--out"]);
const tokens = Number(args[1]);
assert(Number.isSafeInteger(tokens) && tokens >= 1000 && tokens <= 100000);
assert(path.isAbsolute(args[3]));
const disk = await statfs("/tmp");
assert(Number(disk.bavail) * Number(disk.bsize) > 12e9);
const source = authenticateArtifact(
  "/tmp/yunipals-generation-snapshot-runtime-v2-final-20261024"
);
const statements = Object.fromEntries(
  queryCandidates(source).map((row) => [row.phase, row.sql])
);
const chains = ["ethereum", "base", "polygon", "bnb"];
const scopes = Array.from({ length: 15 }, (_, index) => {
  const selected = chains.filter((_, bit) => (index + 1) & (1 << bit));
  return selected.length === chains.length ? "all" : selected.join("+");
});
const stamp = "2026-10-25T00:00:00.000Z";
const database = "ypal_f81_facet_" + randomBytes(5).toString("hex") + "_test";
assert(/^ypal_f81_facet_[a-f0-9]{10}_test$/.test(database));
const admin = new Client({
  connectionString: endpoint + "postgres",
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000
});
admin.on("error", (error) =>
  progress("synthetic-admin-connection-error", {
    code: error.code,
    errorClass: error.name
  })
);
let db;
let created = false;
let transaction = false;
const report = {
  format: "yunipals-generation-f81-facet-benchmark-v1",
  syntheticOnly: true,
  tokensPerGeneration: tokens,
  traitsPerToken: 12,
  exactFacetSqlSha256: sha(statements["candidate-facet"]),
  exactFacetStatusSqlSha256: sha(statements["candidate-facet_status"]),
  preservedScopes: scopes,
  cases: [],
  semantics: [],
  productionCalls: 0,
  providerCalls: 0
};
const progress = (phase, detail = {}) =>
  process.stdout.write(JSON.stringify({ phase, ...detail }) + "\n");

const eligibilitySql = `SELECT NOT EXISTS(
  SELECT 1 FROM pg_temp.yunipals_projection_token_input
  WHERE token_id IS NULL OR token_id !~ '^[0-9]{1,78}$'
    OR collection IS NULL OR collection<>ALL(ARRAY['ethereum','base','polygon','bnb']::text[])
) AS eligible`;
const numericIndexSql = `CREATE INDEX ypal_f81_token_numeric_idx ON
  pg_temp.yunipals_projection_token_input(collection,(token_id::numeric),lifecycle)
  WHERE NOT burned`;

function planSummary(root) {
  const rows = [];
  function walk(node, depth = 0) {
    rows.push({
      depth,
      node: node["Node Type"],
      join: node["Join Type"],
      relation: node["Relation Name"],
      index: node["Index Name"],
      estimatedRows: node["Plan Rows"],
      actualRows: node["Actual Rows"],
      loops: node["Actual Loops"],
      indexCondition: node["Index Cond"],
      filter: node.Filter,
      rowsRemovedByFilter: node["Rows Removed by Filter"],
      sharedReads: node["Shared Read Blocks"],
      sharedHits: node["Shared Hit Blocks"],
      localReads: node["Local Read Blocks"],
      localHits: node["Local Hit Blocks"],
      tempReadBlocks: node["Temp Read Blocks"],
      tempWrittenBlocks: node["Temp Written Blocks"]
    });
    for (const child of node.Plans ?? []) walk(child, depth + 1);
  }
  walk(root);
  return rows;
}

async function observation() {
  const facets = (
    await db.query(`SELECT scope,trait_type,kind,min_value,max_value,values
    FROM metadata_projection.facet WHERE generation_id=104 ORDER BY scope COLLATE "C",trait_type COLLATE "C"`)
  ).rows;
  const status = (
    await db.query(`SELECT scope,singleton,available,missing
    FROM metadata_projection.facet_status WHERE generation_id=104 ORDER BY scope COLLATE "C"`)
  ).rows;
  return { facets, status, sha256: sha(JSON.stringify({ facets, status })) };
}

async function runCase(name, timeoutMs = 12000, analyze = true) {
  await db.query("SAVEPOINT benchmark_case");
  const result = { name, statementTimeoutMs: timeoutMs };
  const started = performance.now();
  try {
    await db.query("SET LOCAL statement_timeout='" + timeoutMs + "ms'");
    const explain = `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, WAL," : ""} SETTINGS, FORMAT JSON) `;
    const raw = (
      await db.query(explain + statements["candidate-facet"], [
        104,
        scopes,
        stamp
      ])
    ).rows[0]["QUERY PLAN"][0];
    result.facet = {
      executionMs: raw["Execution Time"],
      plan: planSummary(raw.Plan),
      full: raw
    };
    if (analyze) {
      const status = (
        await db.query(explain + statements["candidate-facet_status"], [
          104,
          scopes,
          stamp
        ])
      ).rows[0]["QUERY PLAN"][0];
      result.status = {
        executionMs: status["Execution Time"],
        plan: planSummary(status.Plan),
        full: status
      };
      const current = await observation();
      result.resultSha256 = current.sha256;
      result.facetRows = current.facets.length;
      result.statusRows = current.status.length;
      assert.equal(current.status.length, 15);
    }
    result.completed = true;
  } catch (error) {
    result.completed = false;
    result.postgresCode = error.code;
    result.errorClass = error.name;
    assert.equal(
      error.code,
      "57014",
      "only explicit statement timeout may truncate a benchmark"
    );
  } finally {
    result.elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
    await db.query("ROLLBACK TO SAVEPOINT benchmark_case");
    await db.query("RELEASE SAVEPOINT benchmark_case");
    report.cases.push(result);
    progress(name, {
      completed: result.completed,
      elapsedMs: result.elapsedMs,
      resultSha256: result.resultSha256
    });
  }
  return result;
}

async function numericIndex() {
  const eligible = (await db.query(eligibilitySql)).rows[0].eligible;
  if (!eligible) return { created: false, rejectedByGuard: true };
  const started = performance.now();
  await db.query(numericIndexSql);
  await db.query("ANALYZE pg_temp.yunipals_projection_token_input");
  return { created: true, elapsedMs: performance.now() - started };
}

try {
  await admin.connect();
  const identity = (
    await admin.query(
      "SELECT current_setting('server_version_num')AS version,current_user AS role,current_database()AS database"
    )
  ).rows[0];
  assert(
    identity.version.startsWith("16") &&
      identity.role === "postgres" &&
      identity.database === "postgres"
  );
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  db = new Client({
    connectionString: endpoint + database,
    statement_timeout: 180000,
    connectionTimeoutMillis: 3000
  });
  db.on("error", (error) =>
    progress("synthetic-benchmark-connection-error", {
      code: error.code,
      errorClass: error.name
    })
  );
  await db.connect();
  report.settings = (
    await db.query(
      "SELECT current_setting('server_version')AS version,current_setting('shared_buffers')AS shared_buffers,current_setting('random_page_cost')AS random_page_cost,current_setting('effective_cache_size')AS effective_cache_size,current_setting('max_parallel_workers_per_gather')AS parallel_workers"
    )
  ).rows[0];
  await db.query(`CREATE SCHEMA metadata_projection;
    CREATE TABLE metadata_projection.trait(
      generation_id bigint NOT NULL,collection text NOT NULL,token_id numeric(78,0) NOT NULL,
      lifecycle integer NOT NULL,trait_type text NOT NULL,value text NOT NULL,value_numeric numeric,
      PRIMARY KEY(generation_id,collection,token_id,lifecycle,trait_type,value)
    ) WITH(autovacuum_enabled=false);
    CREATE INDEX projection_trait_filter_idx ON metadata_projection.trait(generation_id,collection,trait_type,value,token_id,lifecycle);
    CREATE INDEX projection_trait_numeric_idx ON metadata_projection.trait(generation_id,collection,trait_type,value_numeric,token_id,lifecycle) WHERE value_numeric IS NOT NULL;
    CREATE TABLE metadata_projection.search(generation_id bigint NOT NULL,collection text NOT NULL,token_id numeric(78,0) NOT NULL,lifecycle integer NOT NULL,metadata_available boolean NOT NULL,PRIMARY KEY(generation_id,collection,token_id,lifecycle));
    CREATE TABLE metadata_projection.facet(generation_id bigint NOT NULL,scope text NOT NULL,trait_type text NOT NULL,kind text NOT NULL,min_value numeric,max_value numeric,values jsonb,updated_at timestamptz NOT NULL,PRIMARY KEY(generation_id,scope,trait_type));
    CREATE TABLE metadata_projection.facet_status(generation_id bigint NOT NULL,scope text NOT NULL,singleton boolean NOT NULL,available integer NOT NULL,missing integer NOT NULL,updated_at timestamptz NOT NULL,PRIMARY KEY(generation_id,scope));`);
  progress("loading-old-generation-baseline");
  const rowsSql = `SELECT generation_id,ARRAY['ethereum','base','polygon','bnb'][1+(token%4)::int],token,1,
    'trait-'||attribute::text,(token%32)::text,CASE WHEN attribute<=6 THEN token%32 END
    FROM generate_series(1,$1::int)token CROSS JOIN generate_series(1,12)attribute`;
  // Parentheses around the array expression are required for subscripting.
  const rowSource = rowsSql.replace(
    "ARRAY['ethereum','base','polygon','bnb'][",
    "(ARRAY['ethereum','base','polygon','bnb'])["
  );
  await db.query(
    "INSERT INTO metadata_projection.trait " +
      rowSource.replace("SELECT generation_id,", "SELECT generation_id,") +
      " CROSS JOIN unnest(ARRAY[102,103]::bigint[])generation_id",
    [tokens]
  );
  await db.query("ANALYZE metadata_projection.trait");
  report.oldGenerationStatistics = (
    await db.query(
      "SELECT n_distinct,most_common_vals::text,most_common_freqs,correlation FROM pg_stats WHERE schemaname='metadata_projection' AND tablename='trait' AND attname='generation_id'"
    )
  ).rows[0];
  progress("loading-unseen-candidate");
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  transaction = true;
  await db.query("SET LOCAL work_mem='256MB';SET LOCAL lock_timeout='1s'");
  await db.query(
    "INSERT INTO metadata_projection.trait " +
      rowSource.replace("SELECT generation_id,", "SELECT 104,"),
    [tokens]
  );
  await db.query(
    `CREATE TEMP TABLE yunipals_projection_token_input ON COMMIT DROP AS
    SELECT (ARRAY['ethereum','base','polygon','bnb'])[1+(token%4)::int]AS collection,
      CASE WHEN token%17=0 THEN lpad(token::text,12,'0')ELSE token::text END AS token_id,
      1 AS lifecycle,(token%23=0)AS burned,'synthetic-owner'::text AS owner
    FROM generate_series(1,$1::int)token`,
    [tokens]
  );
  await db.query(
    "CREATE INDEX ON pg_temp.yunipals_projection_token_input(collection,token_id,lifecycle);ANALYZE pg_temp.yunipals_projection_token_input"
  );
  await db.query(`INSERT INTO metadata_projection.search SELECT 104,collection,token_id::numeric,lifecycle,(token_id::numeric%13<>0)
    FROM pg_temp.yunipals_projection_token_input`);
  report.unseenCandidateStatistics = (
    await db.query(
      "SELECT n_distinct,most_common_vals::text,most_common_freqs FROM pg_stats WHERE schemaname='metadata_projection' AND tablename='trait' AND attname='generation_id'"
    )
  ).rows[0];
  await runCase("text-index-old-statistics-plan", 12000, false);
  await runCase("text-index-old-statistics", 12000);
  assert(!source.includes("enable_nestloop"));
  await db.query("SET LOCAL enable_nestloop=off");
  await runCase("text-index-old-statistics-no-nested-loop", 30000);
  await db.query("SET LOCAL enable_nestloop=on");
  report.numericIndex = await numericIndex();
  assert(report.numericIndex.created);
  await runCase("numeric-expression-index-old-statistics", 30000);
  await db.query("DROP INDEX pg_temp.ypal_f81_token_numeric_idx");
  const analyzeStarted = performance.now();
  await db.query("ANALYZE metadata_projection.trait");
  report.traitAnalyzeMs = performance.now() - analyzeStarted;
  report.freshCandidateStatistics = (
    await db.query(
      "SELECT n_distinct,most_common_vals::text,most_common_freqs FROM pg_stats WHERE schemaname='metadata_projection' AND tablename='trait' AND attname='generation_id'"
    )
  ).rows[0];
  await runCase("text-index-fresh-trait-statistics", 30000);
  report.secondNumericIndex = await numericIndex();
  await runCase("numeric-expression-index-fresh-trait-statistics", 30000);
  const completed = report.cases.filter(
    (row) => row.completed && row.resultSha256
  );
  assert(completed.length >= 2);
  assert.equal(new Set(completed.map((row) => row.resultSha256)).size, 1);
  report.completedVariantsMatch = true;
  await db.query("ROLLBACK");
  transaction = false;
  await db.query(
    "TRUNCATE metadata_projection.trait,metadata_projection.search"
  );
  progress("small-semantic-controls");
  await db.query(`INSERT INTO metadata_projection.trait VALUES
    (104,'ethereum',1,1,'Kind','A',NULL),(104,'ethereum',1,2,'Kind','A',NULL),
    (104,'ethereum',2,1,'Kind','B',NULL),(104,'base',3,1,'Kind','B',NULL),
    (104,'polygon',4,1,'Kind','C',NULL),(104,'bnb',5,1,'Kind','D',NULL);
    INSERT INTO metadata_projection.search SELECT generation_id,collection,token_id,lifecycle,token_id<>3 FROM metadata_projection.trait;
    ANALYZE metadata_projection.trait;ANALYZE metadata_projection.search`);
  const profiles = [
    {
      name: "leading-zero-duplicates-and-lifecycles",
      extra: "",
      eligible: true
    },
    {
      name: "valid-noncanonical-numeric-casts",
      extra: ",('polygon','+4',1,false,'owner'),('bnb','5e0',1,false,'owner')",
      eligible: false
    },
    {
      name: "burned-nonnumeric-token",
      extra: ",('base','not-numeric',1,true,'owner')",
      eligible: false
    },
    {
      name: "foreign-nonnumeric-token",
      extra: ",('foreign','not-numeric',1,false,'owner')",
      eligible: false
    },
    {
      name: "matching-nonnumeric-token",
      extra: ",('base','not-numeric',1,false,'owner')",
      eligible: false
    }
  ];
  for (const profile of profiles) {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    transaction = true;
    await db.query(`CREATE TEMP TABLE yunipals_projection_token_input(collection text,token_id text,lifecycle integer,burned boolean,owner text)ON COMMIT DROP;
      INSERT INTO pg_temp.yunipals_projection_token_input VALUES
      ('ethereum','001',1,false,'owner'),('ethereum','1',1,false,'owner'),('ethereum','1',1,false,'owner'),
      ('ethereum','0001',2,false,'owner'),('ethereum','0002',1,true,'owner'),('base','3',1,false,'owner'),
      ('polygon','4',1,false,'owner'),('bnb','5',1,false,'owner')${profile.extra};
      CREATE INDEX ON pg_temp.yunipals_projection_token_input(collection,token_id,lifecycle);ANALYZE pg_temp.yunipals_projection_token_input`);
    const evaluate = async () => {
      await db.query("SAVEPOINT semantic_case");
      try {
        await db.query(statements["candidate-facet"], [104, scopes, stamp]);
        await db.query(statements["candidate-facet_status"], [
          104,
          scopes,
          stamp
        ]);
        const rows = await observation();
        return {
          completed: true,
          sha256: rows.sha256,
          facetRows: rows.facets.length,
          statusRows: rows.status.length,
          allKindValues: rows.facets.find(
            (row) => row.scope === "all" && row.trait_type === "Kind"
          )?.values,
          allStatus: rows.status.find((row) => row.scope === "all")
        };
      } catch (error) {
        return { completed: false, postgresCode: error.code };
      } finally {
        await db.query(
          "ROLLBACK TO SAVEPOINT semantic_case;RELEASE SAVEPOINT semantic_case"
        );
      }
    };
    const original = await evaluate();
    if (profile.name === "leading-zero-duplicates-and-lifecycles") {
      assert.equal(original.completed, true);
      assert.deepEqual(original.allKindValues, [
        { value: "A", count: 2 },
        { value: "B", count: 1 },
        { value: "C", count: 1 },
        { value: "D", count: 1 }
      ]);
      assert.deepEqual(original.allStatus, {
        scope: "all",
        singleton: true,
        available: 6,
        missing: 1
      });
    }
    await db.query("SET LOCAL enable_nestloop=off");
    const noNestedLoop = await evaluate();
    assert.deepEqual(noNestedLoop, original);
    await db.query("SET LOCAL enable_nestloop=on");
    const optimized = await numericIndex();
    assert.equal(optimized.created, profile.eligible);
    const after = await evaluate();
    assert.deepEqual(after, original);
    report.semantics.push({
      name: profile.name,
      guardedIndex: optimized,
      original,
      noNestedLoop,
      after
    });
    await db.query("ROLLBACK");
    transaction = false;
  }
  report.fixtureBytes = (
    await db.query("SELECT pg_database_size(current_database())::text AS bytes")
  ).rows[0].bytes;
  report.passed = true;
} finally {
  if (db) {
    if (transaction) await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
  if (created) await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);
  await admin.end();
  report.syntheticDatabaseDropped = created;
  writeFileSync(args[3], JSON.stringify(report, null, 2) + "\n", {
    flag: "wx"
  });
}
progress("complete", { passed: report.passed, output: args[3] });
