#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

// Standalone so the same, checksum-pinned program can run against the deployed
// legacy release without installing candidate application code or credentials.
export const ownershipSources = [
  [
    "ethereum",
    1,
    "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    12134519,
    "yunipals_indexer_v3",
    "ponder",
    "ownership:ethereum"
  ],
  [
    "base",
    8453,
    "0x98433df878e8c898cb907345c3a7756e5f72240f",
    22224075,
    "yunipals_indexer_v3",
    "ponder",
    "ownership:base"
  ],
  [
    "polygon",
    137,
    "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    21814218,
    "yunipals_indexer_v3",
    "ponder",
    "ownership:polygon"
  ],
  [
    "bnb",
    56,
    "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    7579197,
    "bnb_indexer",
    "manual",
    "ownership:bnb"
  ],
  [
    "ethereum-islands",
    1,
    "0xa22e2f53ca787414dc0643c399f92234949e2305",
    14570451,
    "yunipals_islands_v2",
    "ponder",
    "islands:ethereum"
  ],
  [
    "base-islands-v2",
    8453,
    "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168",
    52587956,
    "yunipals_base_islands_v2",
    "manual",
    "islands:base:v2"
  ]
].map(([collection, chainId, address, startBlock, schema, kind, sourceId]) => ({
  collection,
  chainId,
  address,
  startBlock: String(startBlock),
  schema,
  kind,
  sourceId
}));

const zero = "0x0000000000000000000000000000000000000000";
const hashPattern = /^0x[0-9a-f]{64}$/;
const decimalPattern = /^(0|[1-9][0-9]*)$/;
export function identifier(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Invalid parity schema identifier.");
  }
  return `"${value}"`;
}
function validBlock(value) {
  return (
    typeof value === "string" &&
    decimalPattern.test(value) &&
    BigInt(value) < 2n ** 63n
  );
}
export function completedCheckpoint(value, chainId) {
  if (
    typeof value !== "string" ||
    !/^[0-9]{75}$/.test(value) ||
    /^0+$/.test(value) ||
    BigInt(value.slice(10, 26)) !== BigInt(chainId)
  ) {
    throw new Error("Missing or inconsistent complete Ponder checkpoint.");
  }
  return (
    BigInt(value.slice(26, 42)) - (/^9{33}$/.test(value.slice(42)) ? 0n : 1n)
  ).toString();
}
export function validateBaseline(value) {
  if (
    !value ||
    value.format !== "yunipals-ownership-parity-v1" ||
    value.completed !== true ||
    value.source !== "legacy" ||
    !Array.isArray(value.collections) ||
    value.collections.length !== ownershipSources.length
  ) {
    throw new Error("A completed legacy parity baseline is required.");
  }
  const used = new Set();
  for (const row of value.collections) {
    const source = ownershipSources.find(
      (item) => item.collection === row.collection
    );
    if (
      !source ||
      used.has(row.collection) ||
      row.chainId !== source.chainId ||
      row.address !== source.address ||
      row.startBlock !== source.startBlock ||
      !validBlock(row.boundary?.number) ||
      BigInt(row.boundary.number) < BigInt(source.startBlock) ||
      (row.boundary.hash !== null && !hashPattern.test(row.boundary.hash)) ||
      !row.datasets ||
      Object.keys(row.datasets).sort().join(",") !==
        datasetNames(source).sort().join(",")
    ) {
      throw new Error("Invalid or incomplete parity baseline source/boundary.");
    }
    for (const dataset of Object.values(row.datasets)) {
      if (
        !Number.isSafeInteger(dataset.rows) ||
        dataset.rows < 0 ||
        !/^[0-9a-f]{64}$/.test(dataset.sha256) ||
        !Array.isArray(dataset.buckets) ||
        dataset.buckets.length !== 256 ||
        dataset.buckets.some(
          (bucket, i) =>
            bucket.id !== i ||
            !Number.isSafeInteger(bucket.rows) ||
            bucket.rows < 0 ||
            !/^[0-9a-f]{64}$/.test(bucket.sha256)
        ) ||
        dataset.buckets.reduce((total, bucket) => total + bucket.rows, 0) !==
          dataset.rows
      ) {
        throw new Error("Invalid parity dataset digest.");
      }
    }
    used.add(row.collection);
  }
  return value;
}
export function digestAccumulator() {
  const full = createHash("sha256");
  const buckets = Array.from({ length: 256 }, () => ({
    rows: 0,
    hash: createHash("sha256")
  }));
  let rows = 0;
  return {
    add(key, value) {
      if (typeof key !== "string" || !Array.isArray(value))
        throw new Error("Invalid parity row.");
      const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
      const bucket =
        buckets[createHash("sha256").update(key, "utf8").digest()[0]];
      full.update(bytes);
      bucket.hash.update(bytes);
      bucket.rows++;
      rows++;
    },
    finish() {
      return {
        rows,
        sha256: full.digest("hex"),
        buckets: buckets.map((bucket, id) => ({
          id,
          rows: bucket.rows,
          sha256: bucket.hash.digest("hex")
        }))
      };
    }
  };
}
function datasetNames(source) {
  return [
    "token",
    "token_lifecycle",
    "transfer_event",
    ...(source.collection === "base-islands-v2" ? [] : ["admin_role_event"]),
    ...(source.collection === "ethereum-islands"
      ? ["contract_owner_event"]
      : [])
  ];
}
export function datasetSql(source, schemaName, dataset) {
  const schema = identifier(schemaName);
  if (
    !ownershipSources.some(
      (row) => JSON.stringify(row) === JSON.stringify(source)
    ) ||
    !datasetNames(source).includes(dataset)
  )
    throw new Error("Unknown parity source or dataset.");
  const scope = `collection='${source.collection}' AND chain_id=${source.chainId} AND contract_address='${source.address}'`;
  if (dataset === "token") {
    // Same boundary reconstruction contract as ownershipTokenSql. Do not drop
    // tokens whose most recent transfer happened after the comparison boundary.
    return `WITH b AS MATERIALIZED (SELECT $1::bigint AS n), tokens AS (
      SELECT t.collection,t.chain_id,t.contract_address,t.token_id,t.owner,t.burned,t.lifecycle,
        t.mint_block,t.mint_timestamp,t.last_transfer_block,t.last_transfer_timestamp,t.last_transaction_hash
      FROM ${schema}.token t,b WHERE ${scope} AND t.last_transfer_block<=b.n
      UNION ALL
      SELECT t.collection,t.chain_id,t.contract_address,t.token_id,e."to",e."to"='${zero}',
        e.lifecycle,l.mint_block,l.mint_timestamp,e.block_number,e.block_timestamp,e.transaction_hash
      FROM ${schema}.token t CROSS JOIN b
      JOIN LATERAL (SELECT e.* FROM ${schema}.transfer_event e
        WHERE e.collection=t.collection AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address
          AND e.token_id=t.token_id AND e.block_number<=b.n
        ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1) e ON true
      JOIN ${schema}.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id
        AND l.lifecycle=e.lifecycle AND l.mint_block<=b.n
      WHERE t.${scope.replaceAll(" AND ", " AND t.")} AND t.last_transfer_block>b.n)
      SELECT token_id AS key,jsonb_build_array(collection,chain_id::text,contract_address,token_id,owner,burned,
        lifecycle::text,mint_block::text,mint_timestamp::text,last_transfer_block::text,
        last_transfer_timestamp::text,last_transaction_hash) AS value
      FROM tokens ORDER BY token_id COLLATE "C"`;
  }
  if (dataset === "token_lifecycle") {
    return `SELECT token_id||':'||lifecycle::text AS key,
      jsonb_build_array(collection,token_id,lifecycle::text,minted_to,mint_block::text,mint_timestamp::text,
        mint_transaction_hash,CASE WHEN burned_at_block<=$1::bigint THEN burned_at_block::text END,
        CASE WHEN burned_at_block<=$1::bigint THEN burned_at_timestamp::text END,
        CASE WHEN burned_at_block<=$1::bigint THEN burn_transaction_hash END) AS value
      FROM ${schema}.token_lifecycle WHERE collection='${source.collection}' AND mint_block<=$1::bigint
      ORDER BY token_id COLLATE "C",lifecycle`;
  }
  const prefix = "collection,chain_id::text,contract_address";
  const columns =
    dataset === "transfer_event"
      ? `${prefix},token_id,lifecycle::text,"from","to",block_number::text,block_timestamp::text,transaction_hash,transaction_index::text,log_index::text`
      : dataset === "admin_role_event"
        ? `${prefix},role,account,sender,granted,block_number::text,transaction_hash,log_index::text`
        : `${prefix},previous_owner,new_owner,block_number::text,transaction_hash,log_index::text`;
  return `SELECT transaction_hash||':'||log_index::text AS key,jsonb_build_array(${columns}) AS value
    FROM ${schema}.${dataset} WHERE ${scope} AND block_number<=$1::bigint
    ORDER BY block_number,${dataset === "transfer_event" ? "transaction_index," : ""}log_index,transaction_hash COLLATE "C"`;
}

async function boundary(db, source, schema, mode, baseline) {
  let available;
  let hash = null;
  let runtime = null;
  if (mode === "unified" || source.kind === "ponder") {
    const result = await db.query(
      `SELECT c.latest_checkpoint,m.value AS runtime
      FROM ${identifier(schema)}._ponder_checkpoint c CROSS JOIN ${identifier(schema)}._ponder_meta m
      WHERE c.chain_id=$1 AND m.key='app'`,
      [source.chainId]
    );
    if (result.rows.length !== 1)
      throw new Error("Missing source checkpoint/runtime identity.");
    available = completedCheckpoint(
      result.rows[0].latest_checkpoint,
      source.chainId
    );
    runtime = result.rows[0].runtime;
    if (
      runtime?.version !== "6" ||
      !runtime?.build_id ||
      runtime.is_dev !== 0
    ) {
      throw new Error("Unsupported legacy/candidate Ponder runtime.");
    }
  } else {
    const result =
      await db.query(`SELECT next_block::text,last_scanned_block::text,last_scanned_hash,last_error
      ${source.collection === "base-islands-v2" ? ",ready" : ""}
      FROM ${identifier(schema)}.sync_state WHERE singleton`);
    const state = result.rows[0];
    if (
      result.rows.length !== 1 ||
      !validBlock(state?.last_scanned_block) ||
      BigInt(state.next_block) !== BigInt(state.last_scanned_block) + 1n ||
      state.last_error ||
      !hashPattern.test(state.last_scanned_hash) ||
      (source.collection === "base-islands-v2" && !state.ready)
    ) {
      throw new Error("Manual source has no complete healthy scan boundary.");
    }
    available = state.last_scanned_block;
    hash = state.last_scanned_hash;
  }
  const number = baseline?.boundary.number ?? available;
  if (
    !validBlock(number) ||
    BigInt(number) > BigInt(available) ||
    BigInt(number) < BigInt(source.startBlock)
  ) {
    throw new Error(
      "Source has not completely indexed the requested boundary."
    );
  }
  if (number !== available) hash = null;
  if (mode === "unified") {
    const row = (
      await db.query(
        `SELECT block_hash FROM ${identifier(schema)}.chain_block
      WHERE chain_id=$1 AND block_number=$2::bigint`,
        [source.chainId, number]
      )
    ).rows;
    if (row.length === 1 && hashPattern.test(row[0].block_hash))
      hash = row[0].block_hash;
    if (baseline.boundary.hash && hash && hash !== baseline.boundary.hash) {
      throw new Error(
        "Candidate lacks the baseline's matching canonical block witness."
      );
    }
  }
  return {
    number,
    hash,
    availableThrough: available,
    runtime: runtime
      ? {
          buildId: runtime.build_id,
          isReady: runtime.is_ready,
          isLocked: runtime.is_locked,
          heartbeatAt: String(runtime.heartbeat_at)
        }
      : null
  };
}

async function checkRelations(db, schema, source) {
  const wanted = datasetNames(source);
  const rows = (
    await db.query(
      `SELECT c.relname,c.relkind FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`,
      [schema, wanted]
    )
  ).rows;
  if (
    rows.length !== wanted.length ||
    rows.some((row) => !["r", "p"].includes(row.relkind))
  ) {
    throw new Error(
      "Parity requires original physical tables, not unreviewed views or FDWs."
    );
  }
}

export async function captureOwnershipParity(db, options) {
  const mode = options.source;
  if (!["legacy", "unified"].includes(mode))
    throw new Error("Choose legacy or unified parity source.");
  const baseline =
    mode === "unified" ? validateBaseline(options.baseline) : null;
  if (
    mode === "unified" &&
    (!options.releaseId || !hashPattern.test(options.releaseId))
  ) {
    throw new Error("Unified parity requires the exact registered release ID.");
  }
  if (mode === "unified") identifier(options.schema);
  const started = new Date().toISOString();
  let stage = "snapshot";
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await db.query(
      "SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL work_mem='8MB'; SET LOCAL temp_file_limit='512MB'"
    );
    const observation = (
      await db.query(`SELECT current_database() AS database,pg_current_snapshot()::text AS snapshot,
      transaction_timestamp()::text AS at,current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation`)
    ).rows[0];
    if (
      observation.read_only !== "on" ||
      observation.isolation !== "repeatable read"
    )
      throw new Error("Read-only snapshot unavailable.");
    let release = null;
    if (mode === "unified") {
      const rows = (
        await db.query(
          `SELECT id,physical_schema,build_id,manifest_hash FROM yunipals_indexer_control.release
        WHERE id=$1 AND physical_schema=$2`,
          [options.releaseId, options.schema]
        )
      ).rows;
      if (rows.length !== 1)
        throw new Error("Candidate registered release/schema mismatch.");
      release = rows[0];
    }
    const collections = [];
    for (const source of ownershipSources) {
      stage = `relations:${source.collection}`;
      const schema = mode === "unified" ? options.schema : source.schema;
      await checkRelations(db, schema, source);
      const before = baseline?.collections.find(
        (row) => row.collection === source.collection
      );
      stage = `boundary:${source.collection}`;
      const frame = await boundary(db, source, schema, mode, before);
      if (release && frame.runtime.buildId !== release.build_id)
        throw new Error("Candidate Ponder build mismatch.");
      if (mode === "unified") {
        const row = (
          await db.query(
            `SELECT manifest_hash,definition::jsonb AS definition FROM ${identifier(schema)}.indexer_source WHERE id=$1`,
            [source.sourceId]
          )
        ).rows;
        if (
          row.length !== 1 ||
          row[0].manifest_hash !== release.manifest_hash ||
          row[0].definition.enabled !== true ||
          row[0].definition.chainId !== source.chainId ||
          row[0].definition.address !== source.address ||
          row[0].definition.startBlock !== source.startBlock ||
          !row[0].definition.events?.includes("Transfer")
        )
          throw new Error("Candidate ownership source manifest mismatch.");
      }
      const datasets = {};
      for (const name of datasetNames(source)) {
        stage = `dataset:${source.collection}:${name}`;
        const digest = digestAccumulator();
        await db.query(
          `DECLARE ownership_parity NO SCROLL CURSOR FOR ${datasetSql(source, schema, name)}`,
          [frame.number]
        );
        for (;;) {
          const page = await db.query(
            "FETCH FORWARD 2048 FROM ownership_parity"
          );
          for (const row of page.rows) digest.add(row.key, row.value);
          if (page.rows.length < 2048) break;
        }
        await db.query("CLOSE ownership_parity");
        datasets[name] = digest.finish();
      }
      const comparisons = before
        ? Object.fromEntries(
            Object.entries(datasets).map(([name, value]) => [
              name,
              {
                equal:
                  value.rows === before.datasets[name].rows &&
                  value.sha256 === before.datasets[name].sha256,
                differingBuckets: value.buckets
                  .filter(
                    (bucket, i) =>
                      bucket.rows !== before.datasets[name].buckets[i].rows ||
                      bucket.sha256 !== before.datasets[name].buckets[i].sha256
                  )
                  .map((bucket) => bucket.id)
              }
            ])
          )
        : null;
      collections.push({
        collection: source.collection,
        chainId: source.chainId,
        address: source.address,
        startBlock: source.startBlock,
        physicalSchema: schema,
        boundary: frame,
        datasets,
        comparisons
      });
    }
    await db.query("COMMIT");
    return {
      format: "yunipals-ownership-parity-v1",
      source: mode,
      completed: true,
      startedAt: started,
      finishedAt: new Date().toISOString(),
      observation,
      release,
      collections,
      exactDataParity:
        mode === "unified"
          ? collections.every((row) =>
              Object.values(row.comparisons).every((item) => item.equal)
            )
          : null,
      allBoundaryHashesMatch:
        mode === "unified"
          ? collections.every((row) => {
              const previous = baseline.collections.find(
                (item) => item.collection === row.collection
              );
              return (
                !!previous.boundary.hash &&
                previous.boundary.hash === row.boundary.hash
              );
            })
          : null,
      productionChanged: false,
      limitations: [
        "Ownership/lifecycle/transfer/admin/owner data only; no metadata, marketplace, Arena or Solana acceptance.",
        "Legacy Ponder has no independently verified checkpoint block hash in this capture; matching canonical RPC anchors remain a separate gate.",
        "A read-only database snapshot and matching hashes do not prove provider correctness or a successful backup/restore."
      ]
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    error.parityStage = stage;
    throw error;
  }
}

export function dropToPostgresPeer(api = process) {
  api.setgroups([]);
  api.setgid("postgres");
  api.setuid("postgres");
  const uid = api.getuid();
  const gid = api.getgid();
  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    !Number.isSafeInteger(gid) ||
    gid <= 0 ||
    api.geteuid() !== uid ||
    api.getegid() !== gid ||
    api.getgroups().some((group) => group !== gid)
  ) {
    throw new Error("Unexpected retained peer-process user/group privilege.");
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      schema: { type: "string" },
      "release-id": { type: "string" },
      baseline: { type: "string" },
      output: { type: "string" },
      "module-root": { type: "string" },
      "database-env": { type: "string" },
      "postgres-peer": { type: "boolean", default: false }
    }
  });
  if (
    !values.source ||
    (values.source === "legacy" &&
      (values.schema || values.baseline || values["release-id"]))
  ) {
    throw new Error(
      "Use --source legacy, or --source unified --schema SCHEMA --release-id ID --baseline FILE."
    );
  }
  const variable = values["database-env"];
  if (variable && !/^[A-Z][A-Z0-9_]*$/.test(variable))
    throw new Error("Invalid database environment variable name.");
  if (variable && !process.env[variable])
    throw new Error("Configured database environment variable is absent.");
  const require = createRequire(
    values["module-root"]
      ? pathToFileURL(values["module-root"])
      : import.meta.url
  );
  const { Client } = require("pg");
  if (values["postgres-peer"]) {
    if (
      variable ||
      process.getuid?.() !== 0 ||
      !process.env.PGHOST?.startsWith("/")
    ) {
      throw new Error(
        "Postgres peer mode requires root dropping to postgres over a local Unix socket."
      );
    }
    // Existing release dependencies may be root-readable only. Load their code,
    // then relinquish root before opening the peer-authenticated read-only DB.
    dropToPostgresPeer();
  }
  const db = new Client({
    ...(variable ? { connectionString: process.env[variable] } : {}),
    ...(values["postgres-peer"] ? { user: "postgres" } : {}),
    application_name: "yunipals_ownership_parity_readonly",
    connectionTimeoutMillis: 5000
  });
  try {
    await db.connect();
    const result = await captureOwnershipParity(db, {
      source: values.source,
      schema: values.schema,
      releaseId: values["release-id"],
      baseline: values.baseline
        ? JSON.parse(readFileSync(values.baseline, "utf8"))
        : null
    });
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (values.output) {
      writeFileSync(values.output, json, { flag: "wx", mode: 0o600 });
      console.log(
        JSON.stringify({
          completed: true,
          output: values.output,
          exactDataParity: result.exactDataParity
        })
      );
    } else process.stdout.write(json);
    if (result.exactDataParity === false) process.exitCode = 2;
    else if (result.source === "unified" && !result.allBoundaryHashesMatch)
      process.exitCode = 3;
  } finally {
    await db.end();
  }
}

// stdin entry permits read-only remote execution without writing a production
// release. Failures omit driver messages, which may contain connection strings.
if (
  process.argv[1] === "-" ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        completed: false,
        stage: error.parityStage ?? "configuration_or_connection",
        code:
          typeof error.code === "string"
            ? error.code
            : "parity_validation_failed",
        // Our validation errors contain only static text. Driver messages/details
        // are withheld because they can disclose SQL rows or connection secrets.
        reason: error.code ? "Database/module operation failed." : error.message
      })
    );
    process.exitCode = 1;
  });
}
