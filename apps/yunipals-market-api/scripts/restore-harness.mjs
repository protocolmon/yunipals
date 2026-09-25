import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import pg from "pg";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { verifySeaportOrderMaker } from "@protopals/yunipals-market-core/verifyOrderMaker";

const run = promisify(execFile);
const owner = "market_test_owner",
  database = "yunipals_market_test";
const schemas = [
  "yunipals_market",
  "yunipals_read_v4",
  "metadata",
  "bnb_indexer"
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const docker = async (args) =>
  (
    await run("docker", args, {
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "buffer"
    })
  ).stdout;
const poolFor = (url) =>
  new pg.Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 1000,
    statement_timeout: 5000
  });

// This is an actual backup/restore drill, restricted to disposable Docker/DB
// identities. It never accepts a production connection URL or an existing target.
export async function createRestoreHarness({ sourceUrl, sourcePool, client }) {
  const source = new URL(sourceUrl);
  assert.equal(source.hostname, "127.0.0.1");
  assert.equal(source.pathname, `/${database}`);
  assert.equal(source.username, owner);
  const sourceName =
    process.env.MARKET_TEST_RESTORE_SOURCE_CONTAINER ??
    "yunipals-market-browser-20260906";
  assert.match(sourceName, /^yunipals-market-[a-z0-9-]+$/);
  const sourceInfo = JSON.parse(
    (await docker(["inspect", sourceName])).toString()
  )[0];
  assert.equal(
    sourceInfo.Config.Labels["yunipals.task"],
    "marketplace-staging"
  );
  assert.deepEqual(sourceInfo.HostConfig.PortBindings["5432/tcp"], [
    { HostIp: "127.0.0.1", HostPort: source.port }
  ]);
  assert.equal(sourceInfo.State.Running, true);
  const sourceId = sourceInfo.Id;
  const id = randomUUID(),
    targetName = `yunipals-market-restore-${id}`;
  const port = Number(process.env.MARKET_TEST_RESTORE_PORT ?? "55438");
  assert.ok(
    Number.isSafeInteger(port) &&
      port >= 1024 &&
      port <= 65535 &&
      String(port) !== source.port
  );
  const targetUrl = `postgresql://${owner}:local-test-only@127.0.0.1:${port}/${database}`;
  const targetRuntimeUrl = `postgresql://market_test_runtime:local-runtime-test-only@127.0.0.1:${port}/${database}`;
  const directory = await mkdtemp(
    join(tmpdir(), "yunipals-admitted-order-restore-")
  );
  const backupPath = join(directory, "market-and-indexer-fixtures.dump");
  const report = {
    status: "running",
    sourceContainerId: sourceId,
    targetName,
    targetPort: port,
    backupPath,
    scope:
      "Logical backup of genuine admitted local-fork orders into a separate PostgreSQL instance, explicit privilege restoration, canonical replay and cancellation from recovered API parameters. No production, off-host backup or WAL/PITR claim.",
    tests: []
  };
  let targetId, targetPool, expected, backup, startedAt;
  const pass = (name) => {
    report.tests.push({ name, status: "passed" });
    process.stdout.write(`PASS RESTORE ${name}\n`);
  };

  async function inspectTarget() {
    const info = JSON.parse(
      (await docker(["inspect", targetName])).toString()
    )[0];
    assert.equal(info.Config.Labels["yunipals.drill.id"], id);
    assert.equal(info.Config.Labels["yunipals.task"], "marketplace-staging");
    assert.deepEqual(info.HostConfig.PortBindings["5432/tcp"], [
      { HostIp: "127.0.0.1", HostPort: String(port) }
    ]);
    if (targetId) assert.equal(info.Id, targetId);
    assert.notEqual(info.Id, sourceId);
    return info;
  }
  async function ready() {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      try {
        await targetPool.query("SELECT 1");
        return;
      } catch {}
      await delay(250);
    }
    throw new Error("Restored fixture PostgreSQL did not become ready.");
  }
  async function fingerprint(pool) {
    const tables = (
      await pool.query(
        "SELECT schemaname,tablename FROM pg_tables WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,tablename",
        [schemas]
      )
    ).rows;
    const result = {};
    let bytes = 0;
    for (const { schemaname, tablename } of tables) {
      assert.match(schemaname, /^[a-z_0-9]+$/);
      assert.match(tablename, /^[a-z_0-9]+$/);
      const rows = (
        await pool.query(
          `SELECT to_jsonb(t)::text AS row FROM ${schemaname}.${tablename} t ORDER BY to_jsonb(t)::text LIMIT 10001`
        )
      ).rows;
      assert.ok(
        rows.length <= 10000,
        "Restore fingerprint only supports the bounded fixture population"
      );
      const text = rows.map((row) => row.row).join("\n");
      bytes += Buffer.byteLength(text);
      assert.ok(
        bytes <= 16 * 1024 * 1024,
        "Restore fixture exceeds the bounded backup drill size"
      );
      result[`${schemaname}.${tablename}`] = {
        rows: rows.length,
        sha256: digest(text)
      };
    }
    return result;
  }
  async function psqlFile(path) {
    const contents = await readFile(path, "utf8");
    const file = join(directory, path.split("/").at(-1));
    await writeFile(file, contents, { mode: 0o600 });
    await docker(["cp", file, `${targetId}:/tmp/${file.split("/").at(-1)}`]);
    await docker([
      "exec",
      targetId,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "market_runtime_role=market_test_runtime",
      "-U",
      owner,
      "-d",
      database,
      "-f",
      `/tmp/${file.split("/").at(-1)}`
    ]);
  }
  async function capture() {
    assert.equal(
      backup,
      undefined,
      "Take exactly one snapshot before the chain gap"
    );
    const orders = (
      await sourcePool.query(
        "SELECT count(*) FROM yunipals_market.orders WHERE publication_state='accepted'"
      )
    ).rows[0].count;
    assert.equal(
      orders,
      "5",
      "The restore scenario must back up all five genuinely admitted browser orders"
    );
    assert.equal(
      (
        await sourcePool.query(
          "SELECT count(*) FROM yunipals_market.sale WHERE canonical"
        )
      ).rows[0].count,
      "1",
      "Capture the actual native receipt before the WBNB fill"
    );
    expected = await fingerprint(sourcePool);
    const began = performance.now();
    backup = await docker([
      "exec",
      sourceId,
      "pg_dump",
      "-U",
      owner,
      "-d",
      database,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      ...schemas.map((schema) => `--schema=${schema}`)
    ]);
    await writeFile(backupPath, backup, { mode: 0o600 });
    const file = await stat(backupPath);
    assert.equal(file.mode & 0o777, 0o600);
    assert.equal(digest(await readFile(backupPath)), digest(backup));
    assert.deepEqual(
      await fingerprint(sourcePool),
      expected,
      "Quiesced source remains identical through the backup"
    );
    report.backup = {
      bytes: backup.length,
      sha256: digest(backup),
      durationMs: Math.round(performance.now() - began),
      capturedAt: new Date().toISOString(),
      tables: expected,
      acceptedOrders: Number(orders),
      confirmedSales: 1
    };
    report.sourceSystemId = (
      await sourcePool.query(
        "SELECT system_identifier::text FROM pg_control_system()"
      )
    ).rows[0].system_identifier;
    pass(
      "Five admitted orders, preparations, jobs, sale proof and checkpoints are captured in a verified private backup"
    );
  }
  async function restore() {
    assert.ok(backup && expected, "Capture the backup before restoring");
    startedAt = performance.now();
    targetId = (
      await docker([
        "run",
        "-d",
        "--name",
        targetName,
        "--label",
        "yunipals.task=marketplace-staging",
        "--label",
        `yunipals.drill.id=${id}`,
        "--memory",
        "512m",
        "--cpus",
        "1",
        "-e",
        `POSTGRES_USER=${owner}`,
        "-e",
        "POSTGRES_PASSWORD=local-test-only",
        "-e",
        `POSTGRES_DB=${database}`,
        "-p",
        `127.0.0.1:${port}:5432`,
        "postgres:16.15"
      ])
    )
      .toString()
      .trim();
    await inspectTarget();
    targetPool = poolFor(targetUrl);
    targetPool.on("error", () => {});
    await ready();
    const targetSystemId = (
      await targetPool.query(
        "SELECT system_identifier::text FROM pg_control_system()"
      )
    ).rows[0].system_identifier;
    assert.notEqual(
      targetSystemId,
      report.sourceSystemId,
      "Restore must use independent PostgreSQL storage"
    );
    report.targetSystemId = targetSystemId;
    await psqlFile("scripts/init-test-role.sql");
    await docker(["cp", backupPath, `${targetId}:/tmp/restore.dump`]);
    await docker([
      "exec",
      targetId,
      "pg_restore",
      "-U",
      owner,
      "-d",
      database,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "/tmp/restore.dump"
    ]);
    assert.deepEqual(
      await fingerprint(targetPool),
      expected,
      "Every backed-up relation must match before replay or grant changes"
    );
    assert.equal(
      (
        await targetPool.query(
          "SELECT environment FROM yunipals_market.deployment WHERE singleton"
        )
      ).rows[0].environment,
      "staging"
    );
    const unprivileged = poolFor(targetRuntimeUrl);
    try {
      await assert.rejects(
        unprivileged.query("SELECT 1 FROM yunipals_market.orders"),
        (error) => error.code === "42501"
      );
    } finally {
      await unprivileged.end();
    }
    await psqlFile("scripts/grant-runtime.sql");
    await psqlFile("scripts/grant-indexer-read.sql");
    pass(
      "A distinct PostgreSQL instance restores every table exactly and requires explicit runtime/indexer grants"
    );
    const orders = (
      await targetPool.query(
        "SELECT order_hash,components,signature FROM yunipals_market.orders ORDER BY order_hash"
      )
    ).rows;
    const head = await client.getBlockNumber({ cacheTime: 0 });
    for (const row of orders) {
      const order = decodeSeaportOrder(row.components);
      assert.equal(seaportOrderHash(order).toLowerCase(), row.order_hash);
      assert.equal(
        await verifySeaportOrderMaker(
          client,
          "bnb",
          order,
          row.signature,
          head
        ),
        true
      );
    }
    report.restoredOrderHashes = orders.map((row) => row.order_hash);
    pass(
      "All five restored component hashes and retained maker signatures verify against the actual fork"
    );
    await targetPool.end();
    targetPool = undefined;
    await inspectTarget();
    await docker(["restart", targetId]);
    targetPool = poolFor(targetUrl);
    targetPool.on("error", () => {});
    await ready();
    assert.deepEqual(
      await fingerprint(targetPool),
      expected,
      "Restored records survive a PostgreSQL process restart"
    );
    report.storageRestorationMs = Math.round(performance.now() - startedAt);
    pass(
      "Restored orders, receipt proof and work survive a real PostgreSQL restart"
    );
    return { pool: targetPool, runtimeUrl: targetRuntimeUrl };
  }
  async function replayed({ base, hash, recoverable, actor, asset }) {
    const until = Date.now() + 25000;
    let state;
    while (Date.now() < until) {
      state = (
        await targetPool.query(
          "SELECT o.state,(SELECT count(*)::integer FROM yunipals_market.sale s WHERE s.order_hash=o.order_hash AND s.canonical) AS sales FROM yunipals_market.orders o WHERE o.order_hash=$1",
          [hash.toLowerCase()]
        )
      ).rows[0];
      if (state?.state === "filled" && state.sales === 1) break;
      await delay(250);
    }
    assert.equal(state?.state, "filled");
    assert.equal(state.sales, 1);
    assert.equal(
      (
        await targetPool.query(
          "SELECT count(*) FROM yunipals_market.sale WHERE canonical"
        )
      ).rows[0].count,
      "2"
    );
    const canonical = (
      await targetPool.query(
        "SELECT observation FROM yunipals_market.sale WHERE canonical ORDER BY block_number"
      )
    ).rows.map((row) => row.observation);
    for (const sale of canonical) {
      const receipt = await client.getTransactionReceipt({
        hash: sale.transactionHash
      });
      assert.equal(receipt.status, "success");
      assert.equal(receipt.blockHash, sale.blockHash);
    }
    const response = await fetch(
      `${base}/v1/market/assets/bnb/${asset.contractAddress}/${asset.tokenId}/activity?limit=25`,
      { signal: AbortSignal.timeout(15000) }
    );
    assert.equal(response.status, 200);
    const activity = await response.json();
    assert.equal(activity.items.length, 2);
    assert.equal(
      (await targetPool.query("SELECT count(*) FROM yunipals_market.orders"))
        .rows[0].count,
      "5"
    );
    report.replay = {
      canonicalSales: canonical.map((sale) => ({
        orderHash: sale.orderHash,
        transactionHash: sale.transactionHash,
        blockHash: sale.blockHash
      })),
      storageAndReplayMs: Math.round(performance.now() - startedAt)
    };
    pass(
      "The restored worker replays the post-backup WBNB fill and exposes two canonical sale receipts through the actual API"
    );
    const prefix = `${base}/v1/market/orders/bnb/${seaportDeployment.address}/${recoverable}`;
    const accepted = await fetch(prefix, {
      signal: AbortSignal.timeout(10000)
    });
    assert.equal(accepted.status, 200);
    const summary = (await accepted.json()).order;
    assert.equal(summary.orderHash, recoverable);
    const cancellation = await fetch(`${prefix}/cancellation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor }),
      signal: AbortSignal.timeout(10000)
    });
    assert.equal(cancellation.status, 200);
    const recovered = await cancellation.json();
    assert.equal(
      seaportOrderHash(decodeSeaportOrder(recovered.order)),
      recoverable
    );
    assert.equal(recovered.order.offerer.toLowerCase(), actor.toLowerCase());
    assert.equal(Object.hasOwn(recovered, "signature"), false);
    const record = {
      asset: summary.asset,
      lifecycle: summary.lifecycle,
      orderHash: summary.orderHash,
      order: recovered.order,
      state: "imported",
      updatedAt: Date.now()
    };
    report.recoveryExportSha256 = digest(JSON.stringify([record]));
    pass(
      "Unsigned cancellation parameters are reconstructed solely from the restored accepted-order API"
    );
    return record;
  }
  async function finish(recoverable) {
    const until = Date.now() + 20000;
    let state;
    while (Date.now() < until) {
      state = (
        await targetPool.query(
          "SELECT state FROM yunipals_market.orders WHERE order_hash=$1",
          [recoverable]
        )
      ).rows[0]?.state;
      if (state === "cancelled") break;
      await delay(250);
    }
    assert.equal(state, "cancelled");
    assert.equal(
      (await targetPool.query("SELECT count(*) FROM yunipals_market.orders"))
        .rows[0].count,
      "5"
    );
    report.status = "passed";
    report.completedAt = new Date().toISOString();
    pass(
      "Cancellation from the restored record is observed by the restored worker without losing any signed order"
    );
  }
  async function close() {
    await targetPool?.end();
    if (targetId) {
      await inspectTarget();
      await docker(["stop", "--time", "5", targetId]);
      report.targetStopped = true;
    }
    if (report.status !== "passed") report.status = "incomplete";
    await writeFile(
      join(directory, "restore-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 }
    );
  }
  return { capture, restore, replayed, finish, close, report };
}
