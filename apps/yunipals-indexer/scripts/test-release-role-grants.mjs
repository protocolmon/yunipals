// Isolated local grant proof. No source/control reset, production or provider calls.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { encodeAbiParameters, encodeEventTopics, toHex } from "viem";
import { arenaAbi } from "../../../packages/yunipals-market-core/src/arenaAbi.ts";
import { createIndexerReader } from "../../../packages/yunipals-indexer-server/src/readers.ts";
import {
  readArenaCredit,
  readArenaTournament,
  readArenaTournamentIds
} from "../../../packages/yunipals-indexer-server/src/arena.ts";
import { applyArenaEvent } from "../lib/arena/state.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import {
  queueReceiptCandidates,
  claimReceiptJobs,
  enrichReceiptJob
} from "../lib/unified/receipt-worker.ts";
import { receiptLogsBloom } from "../lib/unified/receipt-validation.ts";

const { values } = parseArgs({ options: { output: { type: "string" } } });
assert.ok(values.output, "Explicit output file required.");
const adminUrl = new URL(process.env.PONDER_UNIFIED_TEST_DATABASE_URL ?? "");
assert.equal(adminUrl.hostname, "127.0.0.1");
assert.equal(adminUrl.port, "56967");
assert.equal(adminUrl.pathname, "/yunipals_ponder_dependency_test");
assert.equal(adminUrl.search, "");
assert.equal(adminUrl.username, "unified_test");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const suffix = randomBytes(6).toString("hex");
const database = `yunipals_release_grants_${suffix}`;
const roles = [`yuni_grants_${suffix}_arena`, `yuni_grants_${suffix}_support`];
const schema = "release_role_source";
const tables = [
  "_ponder_meta",
  "_ponder_checkpoint",
  "indexer_source",
  "canonical_event",
  "transaction_candidate",
  "chain_checkpoint",
  "chain_block",
  "arena_tournament",
  "arena_credit"
];
const ident = (value) => {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
};
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const stringify = (value) =>
  JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? String(item) : item
  );
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const admin = new pg.Pool({ connectionString: adminUrl.href, max: 2 });
let owner;
const clients = [];
let databaseCreated = false;
const createdRoles = [];
const now = Date.now();
const stamp = BigInt(Math.floor(now / 1000));
const head = 50_000_000n;
const hash = (number) => toHex(BigInt(number), { size: 32 });
const contract = `0x${randomBytes(20).toString("hex")}`;
const wallet = `0x${"34".repeat(20)}`;
const receipts = new Map();
let receiptCalls = 0;
let codeCalls = 0;
const rpc = {
  providerId: "release-grants-local-fixture",
  chainId: async () => 8453,
  block: async (tag) => {
    const number =
      tag === "latest" ? head : tag === "finalized" ? head - 20n : tag;
    return {
      number,
      hash: hash(number),
      parentHash: hash(number - 1n),
      timestamp: stamp
    };
  },
  receipt: async (transaction) => {
    receiptCalls++;
    return structuredClone(receipts.get(transaction));
  },
  code: async () => {
    codeCalls++;
    throw new Error("Arena fixture must not request protocol code.");
  }
};
const checkpoint = (chain, number) =>
  `${String(stamp).padStart(10, "0")}${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
const preserved = async () => ({
  pointer: (
    await admin.query(
      "SELECT to_jsonb(a) AS value FROM yunipals_indexer_control.active_release a ORDER BY name"
    )
  ).rows,
  releases: (
    await admin.query(
      "SELECT id,to_jsonb(r) AS value FROM yunipals_indexer_control.release r ORDER BY id"
    )
  ).rows
});
let baseline;
let proof;
try {
  baseline = await preserved();
  // Read column/constraint metadata only; no fixture rows are copied or changed.
  const columns = (
    await admin.query(
      `SELECT c.relname AS table_name,a.attname AS column_name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) AS sql_type,a.attnotnull AS required,
    pg_get_expr(d.adbin,d.adrelid) AS default_sql FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='dependency_check' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`,
      [tables]
    )
  ).rows;
  const constraints = (
    await admin.query(
      `SELECT c.relname AS table_name,pg_get_constraintdef(x.oid) AS definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dependency_check' AND c.relname=ANY($1::text[]) AND x.contype IN ('p','u')`,
      [tables]
    )
  ).rows;
  assert.equal(
    new Set(columns.map((row) => row.table_name)).size,
    tables.length
  );
  await admin.query(`CREATE DATABASE ${ident(database)}`);
  databaseCreated = true;
  const ownerUrl = new URL(adminUrl);
  ownerUrl.pathname = `/${database}`;
  owner = new pg.Pool({ connectionString: ownerUrl.href, max: 4 });
  await owner.query(`CREATE SCHEMA ${ident(schema)}`);
  for (const table of tables) {
    const definitions = columns
      .filter((row) => row.table_name === table)
      .map(
        (row) =>
          `${ident(row.column_name)} ${row.sql_type}${row.default_sql ? ` DEFAULT ${row.default_sql}` : ""}${row.required ? " NOT NULL" : ""}`
      );
    definitions.push(
      ...constraints
        .filter((row) => row.table_name === table)
        .map((row) => row.definition)
    );
    await owner.query(
      `CREATE TABLE ${ident(schema)}.${ident(table)} (${definitions.join(",")})`
    );
  }
  await migrateIndexerControl(owner);
  const manifest = buildSourceManifest({
    ARENA_CONTRACT: contract,
    ARENA_DEPLOYMENT_BLOCK: "100"
  });
  const source = manifest.sources.find(
    (item) => item.feature === "arena" && item.enabled
  );
  assert.ok(source);
  const buildId = `release-role-grants-${suffix}`;
  await owner.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
    JSON.stringify({
      version: "6",
      build_id: buildId,
      heartbeat_at: now,
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    })
  ]);
  for (const [chain, name] of [
    [1, "mainnet"],
    [56, "bnb"],
    [137, "polygon"],
    [8453, "base"]
  ]) {
    await owner.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES($1,$2,$3,$3,$4)`,
      [name, chain, checkpoint(chain, head), checkpoint(chain, head - 30n)]
    );
    await owner.query(
      `INSERT INTO ${schema}.chain_checkpoint VALUES($1,$2,$3,$4,$5,$6)`,
      [
        String(chain),
        chain,
        String(head),
        hash(head),
        hash(head - 1n),
        String(stamp)
      ]
    );
    for (let block = head - 30n; block <= head; block++)
      await owner.query(
        `INSERT INTO ${schema}.chain_block VALUES($1,$2,$3,$4,$5,$6)`,
        [
          `${chain}:${block}`,
          chain,
          String(block),
          hash(block),
          hash(block - 1n),
          String(stamp)
        ]
      );
  }
  for (const item of manifest.sources)
    await owner.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`,
      [
        item.id,
        item.chainId,
        sourceManifestHash(manifest),
        JSON.stringify(item)
      ]
    );
  const release = await registerIndexerRelease(owner, {
    schema,
    buildId,
    manifest
  });
  const events = [];
  let state = null;
  for (const [index, name, args] of [
    [
      0,
      "TournamentOpened",
      { id: 1n, deadline: 0n, rulesHash: hash(1), poolHash: hash(2) }
    ],
    [1, "TournamentExpired", { id: 1n }]
  ]) {
    state = applyArenaEvent(state, name, args).state;
    const number = head - 10n + BigInt(index),
      transactionHash = hash(1000 + index);
    const item = arenaAbi.find(
      (value) => value.type === "event" && value.name === name
    );
    const topics = encodeEventTopics({ abi: arenaAbi, eventName: name, args });
    const data = encodeAbiParameters(
      item.inputs.filter((value) => !value.indexed),
      item.inputs
        .filter((value) => !value.indexed)
        .map((value) => args[value.name])
    );
    const id = `8453:${contract}:${transactionHash}:0`;
    await owner.query(
      `INSERT INTO ${schema}.canonical_event (id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,transaction_hash,transaction_index,log_index,topics,data)
      VALUES($1,$2,8453,$3,$4,$5,$6,$7,$8,$9,$10,0,0,$11,$12)`,
      [
        id,
        source.id,
        contract,
        name,
        stringify(args),
        source.abiHash,
        String(number),
        hash(number),
        String(stamp),
        transactionHash,
        JSON.stringify(topics),
        data
      ]
    );
    await owner.query(
      `INSERT INTO ${schema}.transaction_candidate VALUES($1,8453,$2,$3,$4)`,
      [
        `8453:${hash(number)}:${transactionHash}`,
        String(number),
        hash(number),
        transactionHash
      ]
    );
    const log = {
      address: contract,
      blockHash: hash(number),
      blockNumber: toHex(number),
      transactionHash,
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false,
      topics,
      data
    };
    receipts.set(transactionHash, {
      blockHash: hash(number),
      blockNumber: toHex(number),
      transactionHash,
      transactionIndex: "0x0",
      status: "0x1",
      from: wallet,
      to: contract,
      contractAddress: null,
      gasUsed: "0x5208",
      cumulativeGasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      type: "0x2",
      logsBloom: receiptLogsBloom([log]),
      logs: [log]
    });
    events.push({ id, number, transactionHash });
  }
  const deployment = `8453:${contract}`;
  await owner.query(
    `INSERT INTO ${schema}.arena_tournament (id,deployment,tournament_id,state,opened_event_id,opened_block_hash,last_event_id,block_number,block_hash)
    VALUES($1,$2,'1',$3,$4,$5,$6,$7,$8)`,
    [
      `${deployment}:1`,
      deployment,
      JSON.stringify(state),
      events[0].id,
      hash(events[0].number),
      events[1].id,
      String(events[1].number),
      hash(events[1].number)
    ]
  );
  await owner.query(
    `INSERT INTO ${schema}.arena_credit (id,deployment,wallet,amount,last_event_id,block_number,block_hash)
    VALUES($1,$2,$3,8000000,$4,$5,$6)`,
    [
      `${deployment}:${wallet}`,
      deployment,
      wallet,
      events[1].id,
      String(events[1].number),
      hash(events[1].number)
    ]
  );
  await owner.query(
    "CREATE SCHEMA yunipals_arena; CREATE TABLE yunipals_arena.private_strategy(ciphertext text); CREATE TABLE yunipals_arena.admin_config(setting text)"
  );
  const templates = [];
  for (const [index, role] of roles.entries()) {
    const password = randomBytes(24).toString("hex");
    await admin.query(
      `CREATE ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
    );
    createdRoles.push(role);
    await owner.query(
      `GRANT CONNECT ON DATABASE ${ident(database)} TO ${ident(role)}`
    );
    const file =
      index === 0
        ? "grant-arena-native-source.sql.example"
        : "grant-unified-support.sql.example";
    const sql = await readFile(`${root}/ops/unified-indexer/${file}`, "utf8");
    const variables = {
      physical_schema: schema,
      arena_source_role: role,
      support_role: role
    };
    await owner.query(
      sql.replace(/:"([a-z_]+)"/g, (_, key) => ident(variables[key]))
    );
    templates.push({
      path: `ops/unified-indexer/${file}`,
      sha256: digest(sql)
    });
    const url = new URL(ownerUrl);
    url.username = role;
    url.password = password;
    clients.push(new pg.Pool({ connectionString: url.href, max: 3 }));
  }
  const [arena, support] = clients;
  for (const client of clients)
    assert.deepEqual(
      (
        await client.query(
          "SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls FROM pg_roles WHERE rolname=current_user"
        )
      ).rows[0],
      {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolbypassrls: false
      }
    );
  for (const client of clients) {
    const privileges = await client.query(
      `SELECT c.relname,has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname`,
      [schema]
    );
    assert.equal(privileges.rows.length, tables.length);
    assert.ok(privileges.rows.every((row) => row.can_write === false));
  }
  assert.equal(
    await observeIndexerChain(support, release, 8453, rpc, { now: () => now }),
    "observed"
  );
  assert.equal(await queueReceiptCandidates(support, release, 8453), 2);
  const jobs = await claimReceiptJobs(support, release, 8453, 4);
  assert.equal(jobs.length, 2);
  for (const job of jobs)
    assert.equal(await enrichReceiptJob(support, release, job, rpc), "stored");
  const reader = await createIndexerReader(arena, {
    releaseId: release.id,
    now: () => now
  });
  const definition = {
    contract,
    startBlock: source.startBlock,
    abiHash: source.abiHash
  };
  assert.equal(
    (await readArenaTournament(reader, definition, "1")).tournament.state.phase,
    "expired"
  );
  assert.equal(
    (await readArenaCredit(reader, definition, wallet)).amount,
    "8000000"
  );
  assert.deepEqual((await readArenaTournamentIds(reader, definition)).ids, [
    "1"
  ]);
  const page = await reader.page(
    source.id,
    { kind: "latest" },
    { includeReceipts: true }
  );
  assert.equal(page.events.length, 2);
  assert.equal(page.complete, true);
  assert.equal(page.waitingReceipt, false);
  let denied = 0;
  const reject = async (client, sql) => {
    await assert.rejects(client.query(sql), (error) => error.code === "42501");
    denied++;
  };
  for (const client of clients) {
    await reject(
      client,
      `UPDATE ${schema}._ponder_meta SET value=value WHERE false`
    );
    await reject(client, `DELETE FROM ${schema}.canonical_event WHERE false`);
    await reject(
      client,
      "UPDATE yunipals_indexer_control.release SET build_id=build_id WHERE false"
    );
    await reject(
      client,
      "DELETE FROM yunipals_indexer_control.active_release WHERE false"
    );
    await reject(
      client,
      "UPDATE yunipals_indexer_control.transaction_evidence SET provider_id=provider_id WHERE false"
    );
    await reject(
      client,
      "SELECT * FROM yunipals_arena.private_strategy LIMIT 0"
    );
    await reject(
      client,
      "UPDATE yunipals_arena.admin_config SET setting=setting WHERE false"
    );
    await reject(client, "CREATE SCHEMA forbidden_runtime_admin");
  }
  await reject(
    arena,
    "UPDATE yunipals_indexer_control.chain_status SET revision=revision WHERE false"
  );
  await reject(
    arena,
    "DELETE FROM yunipals_indexer_control.receipt_job WHERE false"
  );
  assert.equal(receiptCalls, 2);
  assert.equal(codeCalls, 0);
  proof = {
    format: "yunipals-release-role-grants-v1",
    status: "passed_local_disposable_fixture_not_production",
    templates,
    fixture: {
      database,
      sourceSchema: schema,
      metadataOnlyClonedFrom: "dependency_check",
      schemaDefinitionSha256: digest(JSON.stringify({ columns, constraints })),
      noRetainedSourceControlReset: true
    },
    roles: {
      count: 2,
      freshLogin: true,
      superuser: false,
      createRole: false,
      createDb: false,
      inherit: false,
      bypassRls: false
    },
    success: {
      observer: "observed",
      receiptJobsQueued: 2,
      receiptJobsStored: 2,
      arenaTournament: "expired",
      arenaCredit: "8000000",
      arenaList: ["1"],
      fullReceiptCanonicalPageEvents: 2
    },
    permissionDenials: denied,
    allPhysicalTablesHaveNoRuntimeWritePrivilege: {
      roles: 2,
      physicalTables: tables.length
    },
    rpc: {
      kind: "in_memory_fixture_only",
      receiptCalls,
      protocolCodeCalls: codeCalls,
      networkProviderCalls: 0
    },
    productionMutations: false
  };
} finally {
  for (const client of clients) await client.end();
  if (owner) await owner.end();
  if (databaseCreated) await admin.query(`DROP DATABASE ${ident(database)}`);
  for (const role of createdRoles)
    await admin.query(`DROP ROLE ${ident(role)}`);
  if (baseline) {
    const after = await preserved();
    assert.deepEqual(after.pointer, baseline.pointer);
    for (const old of baseline.releases)
      assert.deepEqual(
        after.releases.find((row) => row.id === old.id),
        old
      );
  }
  await admin.end();
}
assert.ok(proof);
proof.cleanup = {
  isolatedDatabaseDropped: true,
  freshRolesDropped: true,
  retainedReleaseRowsAndActivePointerUnchanged: true
};
await writeFile(values.output, JSON.stringify(proof, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx"
});
console.log(JSON.stringify(proof));
