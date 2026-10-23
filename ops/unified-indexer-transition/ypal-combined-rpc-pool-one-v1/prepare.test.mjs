import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { registerHooks, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import test from "node:test";
import {
  anchor,
  artifactSha256,
  derive,
  preimageSha256,
  proof,
  publishNew,
  sha256
} from "./prepare.mjs";

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, "../../..");
const candidate = readFileSync(resolve(here, "rpc-budget-proxy.mjs"));
const changedAnchor = anchor.replace("max: 2,", "max: 1,");
const original = Buffer.from(
  candidate.toString().replace(changedAnchor, anchor)
);

test("exact existing v6 preimage and one-byte reversible derivation", () => {
  assert.equal(sha256(original), preimageSha256);
  assert.equal(sha256(candidate), artifactSha256);
  assert.deepEqual(derive(original), candidate);
  assert.equal(original.length, candidate.length);
  assert.equal(
    [...original].filter((byte, i) => byte !== candidate[i]).length,
    1
  );
  assert.deepEqual(
    Buffer.from(candidate.toString().replace(changedAnchor, anchor)),
    original
  );
});

test("changed, truncated, already-derived and foreign input refuse", () => {
  for (const raw of [
    Buffer.from("other"),
    original.subarray(1),
    candidate,
    Buffer.concat([original, Buffer.from("\n")])
  ])
    assert.throws(() => derive(raw), /exact_public_v6_preimage_required/);
  const altered = Buffer.from(original);
  altered[0] ^= 1;
  assert.throws(() => derive(altered), /exact_public_v6_preimage_required/);
});

test("proof names only four fresh routes and no activation or policy changes", () => {
  const p = proof(original);
  assert.equal(p.change.poolMaxAfter, 1);
  assert.equal(p.change.changedBytes, 1);
  assert.equal(p.allOtherCompiledBytesIdentical, true);
  assert.equal(p.selectedForProduction, false);
  assert.equal(p.oldProxyArtifactsModified, false);
  assert.equal(p.roleOrBudgetChanges, 0);
  assert.deepEqual(
    p.intendedUnits,
    ["ethereum", "base", "polygon", "bnb"].map(
      (c) => `yunipals-combined-rpc@${c}.service`
    )
  );
});

test("exclusive public output survives umask077 and never overwrites", () => {
  const temp = mkdtempSync(tmpdir() + "/ypal-pool-one-write-");
  const mask = process.umask(0o077);
  try {
    const out = resolve(temp, "new");
    publishNew(out, original);
    assert.equal(statSync(out).mode & 0o777, 0o755);
    assert.equal(
      statSync(resolve(out, "rpc-budget-proxy.mjs")).mode & 0o777,
      0o644
    );
    assert.deepEqual(
      readFileSync(resolve(out, "rpc-budget-proxy.mjs")),
      candidate
    );
    assert.throws(() => publishNew(out, original), /EEXIST/);
    assert.deepEqual(
      readFileSync(resolve(out, "rpc-budget-proxy.mjs")),
      candidate
    );
  } finally {
    process.umask(mask);
    rmSync(temp, { recursive: true, force: true });
  }
});

test("actual compiled factory uses real pg.Pool with one offline client and queues another checkout", async () => {
  const require = createRequire(
    resolve(root, "apps/yunipals-market-api/package.json")
  );
  const pg = require("pg");
  const viem = pathToFileURL(
    realpathSync(require.resolve("viem")).replace("/_cjs/", "/_esm/")
  ).href;
  const temp = mkdtempSync(tmpdir() + "/ypal-pool-one-semantic-");
  const originalConnect = net.Socket.prototype.connect,
    originalFetch = globalThis.fetch;
  let networkAttempts = 0,
    databaseQueries = 0;
  net.Socket.prototype.connect = function () {
    networkAttempts++;
    throw Error("test_network_forbidden");
  };
  globalThis.fetch = async () => {
    networkAttempts++;
    throw Error("test_fetch_forbidden");
  };
  const key = Symbol.for("yunipals.pool-one-test.modules");
  globalThis[key] = new Map();
  try {
    const results = [];
    for (const [label, raw, maximum] of [
      ["old", original, 2],
      ["new", candidate, 1]
    ]) {
      const pools = [],
        clients = [];
      class Client extends EventEmitter {
        constructor() {
          super();
          this._queryable = true;
          this._ending = false;
          clients.push(this);
        }
        connect(done) {
          queueMicrotask(() => done());
        }
        end(done) {
          this._ending = true;
          if (done) queueMicrotask(done);
        }
        query() {
          databaseQueries++;
          throw Error("test_database_query_forbidden");
        }
      }
      class Pool extends pg.Pool {
        constructor(options) {
          super({ ...options, Client });
          pools.push({ pool: this, options });
        }
      }
      globalThis[key].set(label, { ...pg, Pool });
      const file = resolve(temp, label + ".mjs");
      writeFileSync(
        file,
        Buffer.concat([
          raw,
          Buffer.from("\nexport { createOpenSeaRequestBudget };\n")
        ])
      );
      const href = pathToFileURL(file).href;
      const hook = registerHooks({
        resolve(specifier, context, next) {
          if (context.parentURL === href && specifier === "pg")
            return {
              url:
                "data:text/javascript," +
                encodeURIComponent(
                  `export default globalThis[Symbol.for("yunipals.pool-one-test.modules")].get(${JSON.stringify(label)});`
                ),
              shortCircuit: true
            };
          if (context.parentURL === href && specifier === "viem")
            return next(viem, context);
          return next(specifier, context);
        }
      });
      let coordinator;
      try {
        const actual = await import(href);
        coordinator = actual.createOpenSeaRequestBudget({
          MARKET_OPENSEA_BUDGET_DATABASE_URL:
            "postgresql://offline@127.0.0.1:1/offline",
          MARKET_OPENSEA_BUDGET_SCOPE: "yunipals-opensea",
          MARKET_OPENSEA_BUDGET_COORDINATOR_ID:
            "faf1bb8c-4306-4c43-b55e-6ac5fa038567",
          MARKET_DEPLOYMENT: "production"
        });
        coordinator.budgetFor({
          caller: "test",
          workload: "legacy",
          priority: "foreground"
        });
        coordinator.backgroundBudget({
          allPerHour: 0,
          fulfillmentPerMinute: 0
        });
        coordinator.rpcBudget("unified_source", "background");
        assert.equal(pools.length, 1);
        assert.equal(pools[0].options.max, maximum);
        const first = await coordinator.pool.connect();
        let secondReady = false;
        const secondPromise = coordinator.pool.connect().then((client) => {
          secondReady = true;
          return client;
        });
        await new Promise(setImmediate);
        assert.equal(secondReady, maximum === 2);
        assert.equal(clients.length, maximum);
        assert.equal(coordinator.pool.waitingCount, maximum === 1 ? 1 : 0);
        first.release();
        const second = await secondPromise;
        second.release();
        assert.equal(clients.length, maximum);
        results.push(pools[0].options);
      } finally {
        hook.deregister();
        if (coordinator) await coordinator.close();
      }
    }
    assert.deepEqual({ ...results[0], max: 1 }, results[1]);
    assert.equal(databaseQueries, 0);
    assert.equal(networkAttempts, 0);
  } finally {
    net.Socket.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
    delete globalThis[key];
    rmSync(temp, { recursive: true, force: true });
  }
});
