import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { migrateIndexerControl } from "../../lib/unified/control-schema.ts";
import { observeIndexerChain } from "../../lib/unified/observer.ts";
import { readPonderRuntime } from "../../lib/unified/ponder-reader.ts";
import { registerIndexerRelease } from "../../lib/unified/releases.ts";
import { createUnifiedRpcProject } from "./unified-rpc-project.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const safeEnvironment = () =>
  Object.fromEntries(
    [
      "PATH", "LANG", "LC_ALL", "TZ", "HTTP_PROXY", "HTTPS_PROXY",
      "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy",
      "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "TMPDIR"
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]])
  );

/** Real local RPC synchronization. This fixture never invokes handlers,
 * authors framework checkpoints, rewinds SQL, or resets/stops an Anvil.
 * Its caller must own the isolated Anvil and PostgreSQL destinations. */
export async function createArenaRpcFixture({
  connectionString,
  client,
  contract,
  startBlock,
  rpcUrl = client.transport.url,
  port = 55447
}) {
  const databaseUrl = new URL(connectionString);
  const endpoint = new URL(rpcUrl);
  assert.ok(loopback.has(databaseUrl.hostname));
  assert.equal(databaseUrl.pathname, "/yunipals_ponder_dependency_test");
  assert.equal(databaseUrl.search, "");
  assert.equal(endpoint.protocol, "http:");
  assert.ok(loopback.has(endpoint.hostname));
  assert.equal(endpoint.pathname, "/");
  assert.equal(endpoint.search, "");
  assert.equal(endpoint.username + endpoint.password + endpoint.hash, "");
  assert.equal(client.transport.url, rpcUrl);
  assert.equal(await client.getChainId(), 8453);
  assert.match(await client.request({ method: "web3_clientVersion" }), /anvil/i);
  assert.match(contract, /^0x[0-9a-f]{40}$/i);
  assert.ok(BigInt(startBlock) > 0n && BigInt(startBlock) <= BigInt(Number.MAX_SAFE_INTEGER));
  assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  assert.notEqual(port, Number(endpoint.port || 80));

  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "yunipals-arena-rpc-"));
  const schemaName = `arena_rpc_${randomBytes(8).toString("hex")}`;
  const options = {
    connectionString,
    max: 4,
    statement_timeout: 10000,
    lock_timeout: 1000,
    application_name: "yunipals_arena_genuine_rpc_fixture"
  };
  const pool = new pg.Pool(options);
  const readPool = new pg.Pool({
    ...options,
    options: "-c default_transaction_read_only=on"
  });
  const processStops = [];
  let ponder;
  let project;
  let release;
  let closed = false;
  let generation = 0;
  let initiallyAbsent = false;
  let ownedNamespace;

  async function namespaceIdentity() {
    return (await pool.query(
      "SELECT n.oid::text AS oid,n.nspowner::text AS owner,r.rolname AS owner_name,current_user AS current_role FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname=$1",
      [schemaName]
    )).rows[0] ?? null;
  }

  async function eventually(label, check, seconds = 60) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      if (ponder && (ponder.exitCode !== null || ponder.signalCode !== null))
        throw new Error(`${label}: owned Ponder process exited`);
      try {
        const result = await check();
        if (result) return result;
      } catch {
        // Native tables and branch witnesses can be unavailable during startup
        // or rollback. The bounded waiter never manufactures their contents.
      }
      await wait(100);
    }
    throw new Error(`${label}: native observation deadline`);
  }

  const rpc = {
    providerId: "isolated-anvil-arena-rpc",
    chainId: () => client.getChainId(),
    block: (tag) => {
      if (tag === "finalized")
        throw new Error("Local Anvil does not establish Ethereum finality");
      return client.getBlock(
        typeof tag === "bigint" ? { blockNumber: tag } : { blockTag: tag }
      );
    }
  };

  async function nativeCoverage() {
    const head = await client.getBlock({ blockTag: "latest" });
    const runtime = await readPonderRuntime(readPool, schemaName);
    const chain = runtime.chains.find((row) => row.chainId === 8453);
    const witness = runtime.witnesses.find((row) => row.chainId === 8453);
    if (
      !runtime.running || !runtime.frameworkReady ||
      chain?.completeThroughBlock === null ||
      chain?.completeThroughBlock === undefined ||
      chain.completeThroughBlock < head.number || !witness ||
      witness.blockNumber < head.number
    ) return null;
    const actual = await client.getBlock({ blockNumber: witness.blockNumber });
    if (actual.hash.toLowerCase() !== witness.blockHash.toLowerCase()) return null;
    if (release) assert.equal(runtime.buildId, release.buildId);
    return { runtime, head };
  }

  async function sync() {
    assert.equal(closed, false);
    if (!ponder) start();
    const { head } = await eventually("complete canonical Arena block", nativeCoverage);
    if (release) {
      await eventually("official Arena source observation", async () =>
        (await observeIndexerChain(pool, release, 8453, rpc)) === "observed"
      );
    }
    return head.number;
  }

  function start() {
    assert.ok(!ponder || ponder.exitCode !== null || ponder.signalCode !== null);
    const log = createWriteStream(join(directory, `ponder-${generation++}.log`), {
      flags: "wx",
      mode: 0o600
    });
    const binary = fileURLToPath(new URL("./bin/ponder.js", import.meta.resolve("ponder")));
    const environment = {
      ...safeEnvironment(),
      DATABASE_URL: connectionString,
      ARENA_CONTRACT: contract,
      ARENA_DEPLOYMENT_BLOCK: String(startBlock),
      PONDER_RPC_URL_8453: rpcUrl,
      UNIFIED_BASE_ISLANDS_V2_ENABLED: "false"
    };
    ponder = spawn(process.execPath, [
      binary, "start", "--root", project.root, "--schema", schemaName,
      "--port", String(port), "--hostname", "127.0.0.1",
      "--log-level", "error", "--log-format", "json"
    ], { cwd: project.root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    ponder.stdout.pipe(log, { end: false });
    ponder.stderr.pipe(log, { end: false });
    ponder.once("close", () => log.end());
    ponder.logFlushed = new Promise((resolve) => log.once("finish", resolve));
    // Retain launch errors as an owned child result without raw diagnostics.
    ponder.once("error", () => {});
  }

  async function stop() {
    if (!ponder) return;
    const child = ponder;
    let forced = false;
    if (child.exitCode === null && child.signalCode === null) {
      const terminal = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([terminal, wait(10000)]);
      if (child.exitCode === null && child.signalCode === null) {
        forced = true;
        child.kill("SIGKILL");
        await Promise.race([
          terminal,
          wait(5000).then(() => { throw new Error("Owned Ponder cleanup deadline"); })
        ]);
      }
    }
    await child.logFlushed;
    processStops.push({ forced, exitCode: child.exitCode, signal: child.signalCode });
    ponder = undefined;
  }

  async function restart() {
    assert.equal(closed, false);
    await stop();
    assert.equal(processStops.at(-1).forced, false);
    start();
    return sync();
  }

  async function pauseForReorg() {
    assert.equal(closed, false);
    await stop();
    assert.equal(processStops.at(-1).forced, false);
  }

  async function rewind(number, { expectedObservation = "waiting" } = {}) {
    assert.equal(closed, false);
    assert.equal(ponder, undefined, "Pause the owned indexer before reverting Anvil");
    const head = await client.getBlockNumber({ cacheTime: 0 });
    assert.equal(head, BigInt(number), "Caller must first revert its own Anvil");
    await eventually("official short-branch refusal", async () =>
      (await observeIndexerChain(pool, release, 8453, rpc)) === expectedObservation
    );
    // The controlled outage makes the readiness refusal deterministic. The
    // next sync restarts Ponder, which must itself detect/revert the branch.
    // No checkpoint or source row is written by the fixture.
    return head;
  }

  async function close() {
    if (closed) return;
    closed = true;
    try {
      await stop();
      // A rejected pre-existing namespace or an unacknowledged partial startup
      // is never cleanup authority. Retain uncertain state for inspection.
      if (!initiallyAbsent || !ownedNamespace) return;
      assert.deepEqual(await namespaceIdentity(), ownedNamespace);
      if (release) {
        for (const table of ["chain_anchor", "chain_status", "receipt_discovery"])
          await pool.query(`DELETE FROM yunipals_indexer_control.${table} WHERE release_id=$1`, [release.id]);
        await pool.query("DELETE FROM yunipals_indexer_control.release WHERE id=$1", [release.id]);
      }
      await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    } finally {
      await readPool.end();
      await pool.end();
    }
  }

  try {
    assert.equal((await pool.query("SELECT to_regnamespace($1) AS n", [schemaName])).rows[0].n, null);
    initiallyAbsent = true;
    project = await createUnifiedRpcProject({
      repository, directory, startBlock: Number(startBlock)
    });
    start();
    const { runtime } = await eventually("initial genuine Arena RPC coverage", nativeCoverage);
    const created = await namespaceIdentity();
    assert.ok(created && created.owner_name === created.current_role);
    assert.match(created.oid, /^[1-9][0-9]*$/);
    assert.match(created.owner, /^[1-9][0-9]*$/);
    ownedNamespace = created;
    const definitions = (await pool.query(
      `SELECT definition FROM ${schemaName}.indexer_source ORDER BY id`
    )).rows.map((row) => JSON.parse(row.definition));
    assert.equal(definitions.filter((row) => row.feature === "arena" && row.enabled).length, 1);
    const arena = definitions.find((row) => row.feature === "arena" && row.enabled);
    assert.equal(arena.address, contract.toLowerCase());
    assert.equal(arena.startBlock, String(startBlock));
    await migrateIndexerControl(pool);
    release = await registerIndexerRelease(pool, {
      schema: schemaName,
      buildId: runtime.buildId,
      manifest: {
        version: 1, ponderVersion: "0.17.5", ordering: "multichain",
        coverage: "ponder-live-blocks-v1", sources: definitions
      }
    });
    await sync();
    return { pool, readPool, release, schemaName, directory, project,
      processStops, sync, rewind, restart, pauseForReorg, close };
  } catch (error) {
    await close();
    throw error;
  }
}
