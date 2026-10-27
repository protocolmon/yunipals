// V6 bounded protocol: V5 cache transaction, schema and authenticated SQL retained.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  COLLECTOR,
  FORMAT,
  PROJECT,
  execute,
  freshness,
  loadInstaller,
  observe
} from "./ypal-ordinary-cache-two-phase-driver-v1.mjs";

const sha = (raw) => createHash("sha256").update(raw).digest("hex");
export const CATALOG_SHA =
  "8362df110cd3b0d70f9e5969b0619d373885c17ec2f5b8f5921517b71678c7dd";
export const READER_SHA =
  "95efde36a354536f02a9bfa324ffbc987a7d4d0532c9a1669fdd3818e2659630";
export const COLUMNS_SHA =
  "8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf";

export function validateRequest(request) {
  assert.deepEqual(Object.keys(request).sort(), [
    "catalogSql",
    "columnsSql",
    "generationId",
    "mode",
    "planJson",
    "readerSql"
  ]);
  assert(
    ["inspect", "freshness", "rehearse", "apply", "inverse"].includes(
      request.mode
    )
  );
  assert.equal(sha(request.catalogSql), CATALOG_SHA);
  assert.equal(sha(request.readerSql), READER_SHA);
  assert.equal(sha(request.columnsSql), COLUMNS_SHA);
  return request;
}

export function proofCapture(db, request) {
  return async () => ({
    catalog: (await db.query(request.catalogSql)).rows[0].jsonb_build_object,
    reader: (await db.query(request.readerSql)).rows[0].jsonb_build_object,
    allColumnAcl: (await db.query(request.columnsSql)).rows[0].coalesce
  });
}

async function main() {
  assert.equal(process.getuid(), 111);
  assert.equal(process.getgid(), 113);
  assert(process.getgroups().every((v) => v === 113));
  const status = readFileSync("/proc/self/status", "utf8");
  for (const key of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    assert.equal(
      status.match(new RegExp("^" + key + ":\\s*([a-f0-9]+)$", "m"))?.[1],
      "0000000000000000"
    );
  assert.equal(status.match(/^NoNewPrivs:\s*(\d+)$/m)?.[1], "1");
  assert.equal(process.ppid, Number(process.env.YUNIPALS_CACHE_OWNER_PID));
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const request = validateRequest(JSON.parse((await lines.next()).value));
  const install = await loadInstaller();
  const { Client } = createRequire(PROJECT + "/package.json")("pg");
  const db = new Client({
    host: "/var/run/postgresql",
    port: 5432,
    user: "postgres",
    database: "yunipals_backfill",
    connectionTimeoutMillis: 5000,
    application_name: "ypal_cache_guard_owner_v1",
    options:
      "-c statement_timeout=65000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=240000 -c search_path=pg_catalog -c timezone=UTC" +
      (["inspect", "freshness"].includes(request.mode)
        ? " -c default_transaction_read_only=on"
        : "")
  });
  await db.connect();
  try {
    assert.equal(
      (
        await db.query(
          "SELECT current_user=session_user AND current_user='postgres' AND current_database()='yunipals_backfill' AND inet_client_addr()IS NULL AND current_setting('port')='5432' AND current_setting('data_directory')='/var/lib/postgresql/16/main' AND (SELECT oid FROM pg_database WHERE datname=current_database())=17584 AND (SELECT oid FROM pg_roles WHERE rolname=current_user)=10 AS valid"
        )
      ).rows[0].valid,
      true
    );
    const proof = proofCapture(db, request);
    const exchange = async (message, event, hashKey) => {
      process.stdout.write(JSON.stringify(message) + "\n");
      const reply = JSON.parse((await lines.next()).value);
      assert.equal(reply.event, event);
      assert.equal(reply.xid, message.xid);
      assert.equal(reply[hashKey], sha(JSON.stringify(message)));
      return true;
    };
    const result =
      request.mode === "inspect"
        ? { ...(await observe(db)), postProof: await proof() }
        : request.mode === "freshness"
          ? await freshness(
              db,
              request.generationId,
              (
                await import(
                  pathToFileURL(PROJECT + "/lib/metadata/read-cache.ts").href
                )
              ).readCacheFreshSql
            )
          : await execute(
              db,
              request.mode,
              JSON.parse(request.planJson),
              install,
              (message) =>
                exchange(message, "commit-authorized", "preparedSha256"),
              COLLECTOR,
              proof,
              (message) =>
                exchange(message, "transaction-opened-recorded", "openedSha256")
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
