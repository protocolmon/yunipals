import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

// Deliberately restricted to this disposable fixture container. This script
// restarts PostgreSQL and must never accept the production API connection URL.
const container = "yunipals-market-test-20260905";
const database = "yunipals_market_test";
const owner = "market_test_owner";
const connection = {
  host: "127.0.0.1",
  port: 55436,
  user: owner,
  password: "local-test-only",
  database,
  connectionTimeoutMillis: 1000,
  statement_timeout: 5000
};
const docker = (args, options = {}) =>
  execFileSync("docker", args, {
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
const inspected = JSON.parse(docker(["inspect", container]).toString())[0];
assert.equal(inspected.Config.Labels["yunipals.task"], "marketplace-staging");
assert.deepEqual(inspected.HostConfig.PortBindings["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "55436" }
]);
const pool = new pg.Pool(connection);
pool.on("error", () => {}); // Expected while the disposable database restarts.
const id = randomUUID();
const orderHash = `0x${createHash("sha256").update(id).digest("hex")}`;
const protocol = "0x0000000000000068f116a894984e2db1123eb395";
const components = { fixture: "storage-drill-only", salt: id };
const signature = "0x01020304"; // Intentionally invalid; never an executable order.
const amount = "123456789012345678901234567890";
const read = async (db) => {
  const order = (
    await db.query(
      `SELECT signature,components,gross_amount::text,publication_state
    FROM yunipals_market.orders WHERE chain_id=56 AND protocol_address=$1 AND order_hash=$2`,
      [protocol, orderHash]
    )
  ).rows[0];
  const job = (
    await db.query(
      "SELECT state,payload FROM yunipals_market.job WHERE kind='storage_drill' AND deduplication_key=$1",
      [id]
    )
  ).rows[0];
  const checkpoint = (
    await db.query(
      "SELECT block_number::text,block_hash FROM yunipals_market.checkpoint WHERE source='chain' AND chain_id=56 AND name=$1",
      [id]
    )
  ).rows[0];
  return { order, job, checkpoint };
};

try {
  await pool.query(
    `INSERT INTO yunipals_market.orders
    (chain_id,protocol_address,order_hash,contract_address,token_id,lifecycle,source,side,maker,currency,
      gross_amount,seller_proceeds,start_time,end_time,counter,components,signature,summary,policy_version,
      publication_state,accepted_at,state)
    VALUES (56,$1,$2,'0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d',1,0,'yunipals','listing',
      '0x1111111111111111111111111111111111111111','0x0000000000000000000000000000000000000000',
      $3,$3,1,2,0,$4,$5,'{}','storage-drill-only','accepted',clock_timestamp(),'expired')`,
    [protocol, orderHash, amount, JSON.stringify(components), signature]
  );
  await pool.query(
    "INSERT INTO yunipals_market.job(kind,deduplication_key,payload) VALUES ('storage_drill',$1,$2)",
    [id, JSON.stringify({ orderHash })]
  );
  await pool.query(
    "INSERT INTO yunipals_market.checkpoint(source,chain_id,name,block_number,block_hash,coverage_start) VALUES ('chain',56,$1,123,$2,100)",
    [id, orderHash]
  );
  const expected = await read(pool);
  assert.equal(expected.order.signature, signature);
  assert.equal(expected.order.gross_amount, amount);
  docker(["restart", container]);
  let recovered = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await pool.query("SELECT 1");
      recovered = true;
      break;
    } catch {
      await delay(200);
    }
  }
  assert.ok(recovered, "PostgreSQL did not recover within the drill deadline.");
  assert.deepEqual(await read(pool), expected);
  const backup = docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    owner,
    "-d",
    database,
    "--format=custom",
    "--schema=yunipals_market"
  ]);
  const directory = await mkdtemp(
    join(tmpdir(), "yunipals-market-backup-drill-")
  );
  await writeFile(join(directory, "market.dump"), backup, { mode: 0o600 });
  const restoredDatabase = `yunipals_market_restore_${Date.now()}_test`;
  docker(["exec", container, "createdb", "-U", owner, restoredDatabase]);
  docker(
    [
      "exec",
      "-i",
      container,
      "pg_restore",
      "-U",
      owner,
      "-d",
      restoredDatabase,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error"
    ],
    { input: backup }
  );
  const restored = new pg.Pool({ ...connection, database: restoredDatabase });
  try {
    assert.deepEqual(await read(restored), expected);
    assert.equal(
      (
        await restored.query(
          "SELECT environment FROM yunipals_market.deployment"
        )
      ).rows[0].environment,
      "staging"
    );
  } finally {
    await restored.end();
  }
  console.log(
    JSON.stringify({
      status: "passed",
      restart: true,
      restore: true,
      syntheticSignatureBytesPreserved: true,
      queuedWorkPreserved: true,
      checkpointPreserved: true,
      backup: join(directory, "market.dump"),
      restoredDatabase
    })
  );
} finally {
  await pool.end();
}
