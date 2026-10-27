// Actual installed app, no listener: only the fixed non-mutating action route.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";

const OPS = "/opt/yunipals-unified/operations/free-replay-20261020";
const MAIN =
  "/opt/yunipals-unified/nonmarket-consumer-releases/f2fa474602b2df9012b9ce05561445a2247b16bb76808d8c3d6ca1d14b378d9f";
const PROJECT =
  "/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer";
const IDENTITY = {
  releaseId:
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
  readIdentity:
    "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab",
  manifestHash:
    "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
  buildId: "71e2a7f3b7"
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");

export function positiveAction(value, request) {
  assert(["bnb-validate", "bnb-cancel"].includes(request.action.kind));
  assert.equal(value.version, 1);
  assert.equal(value.state, "indexed");
  assert.equal(value.reason, "action_indexed");
  assert.equal(
    value.expectationHash,
    "0x" + digest(JSON.stringify(canonical(request)))
  );
  assert.deepEqual(value.identity, IDENTITY);
  assert.deepEqual(value.transaction, {
    chainId: 56,
    hash: request.transactionHash,
    blockNumber: request.blockNumber,
    blockHash: request.blockHash
  });
  assert.equal(value.coverage.sourceId, "marketplace:bnb:seaport");
  assert.equal(value.coverage.policy, "latest");
  assert.equal(value.proof.kind, "canonical_event_and_full_receipt");
  assert.equal(value.proof.receiptRequirement, "full");
  assert(/^0x[0-9a-f]{64}$/.test(value.proof.receiptPayloadHash));
  assert(
    Array.isArray(value.proof.events) &&
      value.proof.events.length >= 1 &&
      value.proof.events.length <= 256
  );
  assert(
    value.proof.events.every(
      (event) =>
        event.name ===
          (request.action.kind === "bnb-validate"
            ? "OrderValidated"
            : "OrderCancelled") &&
        Number.isInteger(event.logIndex) &&
        event.logIndex >= 0
    )
  );
  assert.deepEqual(value.application, {
    state: "not_evaluated",
    component: "marketplace"
  });
  return true;
}

async function main() {
  assert(process.getuid() > 0 && process.getgid() > 0);
  assert(process.getgroups().every((group) => group === process.getgid()));
  const status = readFileSync("/proc/self/status", "utf8");
  for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    assert.equal(
      status.match(new RegExp("^" + name + ":\\s*([a-f0-9]+)$", "m"))?.[1],
      "0000000000000000"
    );
  assert.equal(status.match(/^NoNewPrivs:\s*(\d+)$/m)?.[1], "1");
  assert.equal(
    (status.match(/^Groups:[ \t]*(.*)$/m)?.[1] ?? "missing").trim(),
    ""
  );
  assert.equal(process.ppid, Number(process.env.YUNIPALS_CUTOVER_PARENT));
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const input = JSON.parse((await lines.next()).value);
  const sourceManifestBytes = readFileSync(
    OPS + "/ypal-ordinary-reader-wire-v5.manifest.json"
  );
  assert.equal(digest(sourceManifestBytes), input.sourceManifestSha256);
  const sourceManifest = JSON.parse(sourceManifestBytes);
  assert.equal(
    digest(readFileSync(new URL(import.meta.url))),
    sourceManifest.files["ypal-ordinary-reader-probe-v5.mjs"]
  );
  assert.equal(input.fixture.format, "yunipals-ypal-known-bnb-action-v1");
  assert.equal(input.fixture.nativeSchema, "unified_ypal_20261023_v1");
  const request = input.fixture.request;
  assert.equal(request.releaseId, IDENTITY.releaseId);
  assert.equal(request.readIdentity, IDENTITY.readIdentity);
  assert.equal(request.chainId, 56);
  assert(["bnb-validate", "bnb-cancel"].includes(request.action.kind));
  assert(JSON.stringify(request).length <= 8192);
  let providerAttempts = 0,
    listenAttempts = 0;
  const deny = () => {
    providerAttempts++;
    throw Error("all_provider_transport_blocked");
  };
  globalThis.fetch = async () => deny();
  http.get = deny;
  http.request = deny;
  https.get = deny;
  https.request = deny;
  tls.connect = deny;
  dgram.createSocket = deny;
  net.Server.prototype.listen = function () {
    listenAttempts++;
    throw Error("app_listener_forbidden");
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    assert(
      first === "/var/run/postgresql/.s.PGSQL.5432" ||
        first?.path === "/var/run/postgresql/.s.PGSQL.5432",
      "only_local_peer_database_allowed"
    );
    return connect.apply(this, args);
  };
  syncBuiltinESMExports();
  const options =
    "-c default_transaction_read_only=on -c statement_timeout=3000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000";
  assert(!existsSync("/run/yunipals-native-cutover-no-password-file"));
  process.env.DATABASE_URL =
    "postgresql:///yunipals_backfill?" +
    new URLSearchParams({
      host: "/var/run/postgresql",
      port: "5432",
      user: "yunipals_unified_api",
      options
    });
  Object.assign(process.env, {
    DATABASE_SCHEMA: "unified_ypal_20261023_v1",
    READ_DATABASE_SCHEMA: "yunipals_ownership_4e77f52b_v4",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: "yunipals_ownership_4e77f52b_v4",
    OWNERSHIP_RELEASE_ID: IDENTITY.releaseId,
    UNIFIED_INDEXER_RELEASE_ID: IDENTITY.releaseId,
    METADATA_SOURCE_MODE: "archive",
    YUNIPALS_PROJECTION_MODE: "generation",
    BASE_METADATA_INGESTION: "native",
    OFFCHAIN_DB_POOL_MAX: "1",
    API_DB_POOL_MAX: "1",
    PGPASSFILE: "/run/yunipals-native-cutover-no-password-file"
  });
  const pg = createRequire(PROJECT + "/package.json")("pg");
  const who = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000
  });
  await who.connect();
  try {
    const value = (
      await who.query(
        "SELECT current_user,session_user,(SELECT oid::text FROM pg_roles WHERE rolname=current_user)AS role,current_setting('transaction_read_only')AS readonly"
      )
    ).rows[0];
    assert.deepEqual(value, {
      current_user: "yunipals_unified_api",
      session_user: "yunipals_unified_api",
      role: "73187671",
      readonly: "on"
    });
  } finally {
    await who.end();
  }
  const bytes = readFileSync(MAIN + "/manifest.json");
  assert.equal(
    digest(bytes),
    "986a288dcebe5e7ce910b36d83f97178ce7c47336a0e9910e0d013e3ff3e347a"
  );
  const manifest = JSON.parse(bytes),
    row = manifest.files.find((value) => value.path === "dist/main-api.mjs");
  const code = readFileSync(MAIN + "/dist/main-api.mjs");
  assert.equal(code.length, row.bytes);
  assert.equal(digest(code), row.sha256);
  const { app } = await import(pathToFileURL(MAIN + "/dist/main-api.mjs").href);
  const path = "http://127.0.0.1/v1/indexer/action-evidence";
  const selected = await app.request(path, { method: "GET" });
  assert.equal(selected.status, 200);
  const selection = await selected.json();
  assert.deepEqual(selection.identity, IDENTITY);
  assert.deepEqual([...selection.supportedActions].sort(), [
    "bnb-cancel",
    "bnb-validate",
    "booster-request-created"
  ]);
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert(Buffer.byteLength(body) <= 1000000);
  positiveAction(JSON.parse(body), request);
  assert.equal(providerAttempts, 0);
  assert.equal(listenAttempts, 0);
  send({
    format: "yunipals-ypal-native-action-preflight-v1",
    passed: true,
    actualInstalledApp: true,
    listenerStarted: false,
    databaseReadOnly: true,
    providerAttempts,
    listenAttempts,
    requestSha256: digest(JSON.stringify(canonical(request))),
    responseSha256: digest(body),
    actualCanonicalFullReceiptProof: true,
    sourceRelease: IDENTITY.releaseId,
    readIdentity: IDENTITY.readIdentity,
    databaseWrites: 0
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      send({
        format: "yunipals-ypal-native-action-preflight-v1",
        passed: false,
        errorClass: error.name,
        privateDiagnosticsWithheld: true,
        automaticRetryAllowed: false
      });
      process.exit(1);
    });
