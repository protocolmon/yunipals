// One owned client retains its private leaderboard handle until publication.
// Root supplies the separately authenticated context and durable COMMIT ACK.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";

export const FORMAT = "yunipals-ypal-native-publication-protocol-v1";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const LOGIN_ROLES = Object.freeze({
  yunipals_unified_api: "73187671",
  yunipals_unified_islands_api: "73187674"
});
const id = (value) =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;

export async function backendIdentity(db) {
  const rows = await db.query(`SELECT jsonb_build_object(
    'pid',pid,'backendStart',(extract(epoch FROM backend_start)*1000000)::numeric(30,0)::text,
    'clientAddress',host(client_addr),'clientPort',client_port,'xid',backend_xid::text,
    'roleOid',usesysid::text,'databaseOid',datid::text)AS value
    FROM pg_stat_activity WHERE pid=pg_backend_pid()`);
  assert.equal(rows.rows.length, 1);
  return rows.rows[0].value;
}

export async function globalPublicationObservation(db, generationId) {
  assert(id(generationId));
  const result = await db.query(
    `SELECT jsonb_build_object(
    'pointer',(SELECT jsonb_build_object('current',current_id::text,'previous',previous_id::text)
      FROM metadata_projection.active WHERE singleton),
    'candidate',(SELECT jsonb_build_object('id',g.id::text,'state',g.state,
      'sourceMode',g.source_mode,'metadataRelease',g.metadata_release_id,
      'sourceRelease',g.ownership_release_id,'readIdentity',g.ownership_read_identity,
      'published',g.published_at IS NOT NULL,
      'validationSha256',encode(sha256(convert_to(g.validation::text,'UTF8')),'hex'))
      FROM metadata_projection.generation g WHERE g.id=$1),
    'archive',(SELECT release_id FROM metadata_source.archive_release WHERE state='active'),
    'walletStats',(SELECT jsonb_build_object('rows',count(*)::text,
      'sha256',encode(sha256(convert_to(coalesce(string_agg(
        encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex'),''
        ORDER BY w.scope COLLATE "C",w.owner COLLATE "C"),''),'UTF8')),'hex'))
      FROM leaderboard.wallet_stats w),
    'stamps',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,
      'metadataRelease',metadata_release_id,'sourceRelease',ownership_release_id,
      'readIdentity',ownership_read_identity)ORDER BY name),'[]'::jsonb)
      FROM metadata.derived_snapshot WHERE name IN('traits','leaderboard'))
    )AS value`,
    [generationId]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0].value;
}

function candidateMatches(value, plan, published) {
  assert.deepEqual(
    value.candidate,
    {
      id: plan.generationId,
      state: "ready",
      sourceMode: "archive",
      metadataRelease: plan.metadataReleaseId,
      sourceRelease: plan.sourceRelease,
      readIdentity: plan.readIdentity,
      published,
      validationSha256: plan.validationSqlSha256
    },
    "same_exact_candidate_database_identity_required"
  );
  assert.equal(value.archive, plan.metadataReleaseId);
}

function acceptedStamp(name, plan) {
  return {
    name,
    metadataRelease: plan.metadataReleaseId,
    sourceRelease: plan.sourceRelease,
    readIdentity: plan.readIdentity
  };
}

export function requireBoundaryCoverage(snapshot, points) {
  assert(Array.isArray(points) && points.length >= 4 && points.length <= 6);
  assert.deepEqual(
    [...new Set(points.map((point) => point.chainId))].sort((a, b) => a - b),
    [1, 56, 137, 8453]
  );
  assert.equal(snapshot.anchors.length, 4);
  assert.equal(
    new Set(snapshot.anchors.map((anchor) => anchor.chain_id)).size,
    4
  );
  for (const point of points) {
    assert(/^(0|[1-9][0-9]*)$/.test(point.number));
    const anchor = snapshot.anchors.find(
      (value) => value.chain_id === point.chainId
    );
    assert(
      anchor && BigInt(anchor.block_number) >= BigInt(point.number),
      "candidate_and_private_snapshots_must_cover_every_six_collection_baseline_cutoff"
    );
  }
}

/** The only globally mutating transaction is caller-owned here. The first
 * COMMIT retains session-private temporary rows only. No API/service work can be
 * called by this protocol; root owns that later, independently acknowledged phase.
 */
export async function publishPreparedCandidate(db, official, plan, gate) {
  assert(
    id(plan.generationId) &&
      id(plan.predecessorGenerationId) &&
      plan.generationId !== plan.predecessorGenerationId
  );
  assert.equal(typeof gate.privatePrepared, "function");
  assert.equal(typeof gate.beforeCommit, "function");
  let transaction = false;
  let globallyCommitted = false;
  const started = performance.now();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    transaction = true;
    await db.query(
      "SET LOCAL statement_timeout='15min';SET LOCAL lock_timeout='500ms';SET LOCAL idle_in_transaction_session_timeout='90s'"
    );
    const before = await globalPublicationObservation(db, plan.generationId);
    candidateMatches(before, plan, false);
    const candidateSnapshot = (
      await db.query(
        "SELECT validation->'sourceSnapshot'AS value FROM metadata_projection.generation WHERE id=$1",
        [plan.generationId]
      )
    ).rows[0].value;
    assert.deepEqual(
      candidateSnapshot,
      plan.candidateSourceSnapshot,
      "same_immutable_validated_candidate_source_snapshot_required"
    );
    requireBoundaryCoverage(candidateSnapshot, plan.boundaryPoints);
    assert.equal(before.pointer.current, plan.predecessorGenerationId);
    assert.equal(
      hash(before),
      plan.originalObservationSha256,
      "original_global_state_changed_before_private_compute"
    );
    const handle = await official.prepareNativeLeaderboardCandidate(
      db,
      plan.generationId
    );
    assert.equal(handle.generationId, plan.generationId);
    assert.equal(handle.predecessor, plan.predecessorGenerationId);
    assert.equal(handle.metadataReleaseId, plan.metadataReleaseId);
    assert.equal(handle.sourceSnapshot.releaseId, plan.sourceRelease);
    assert.equal(handle.sourceSnapshot.readIdentity, plan.readIdentity);
    requireBoundaryCoverage(handle.sourceSnapshot, plan.boundaryPoints);
    assert.match(handle.walletRows, /^[1-9][0-9]*$/);
    assert.match(handle.walletRowsSha256, /^[0-9a-f]{64}$/);
    await db.query("COMMIT"); // Only this session's private temporary rows survive.
    transaction = false;
    const afterPrivate = await globalPublicationObservation(
      db,
      plan.generationId
    );
    assert.deepEqual(
      afterPrivate,
      before,
      "private_computation_must_not_publish_any_global_data"
    );
    const privatePacket = {
      format: FORMAT,
      event: "private-prepared",
      backend: await backendIdentity(db),
      generationId: plan.generationId,
      predecessorGenerationId: plan.predecessorGenerationId,
      walletRows: handle.walletRows,
      walletRowsSha256: handle.walletRowsSha256,
      sourceSnapshot: handle.sourceSnapshot,
      originalObservation: before,
      originalObservationSha256: hash(before),
      elapsedMilliseconds: Math.round(performance.now() - started)
    };
    assert.equal(
      await gate.privatePrepared(privatePacket),
      true,
      "actual_private_preparation_root_ACK_required"
    );

    await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    transaction = true;
    await db.query(
      "SET LOCAL statement_timeout='2min';SET LOCAL lock_timeout='500ms';SET LOCAL idle_in_transaction_session_timeout='90s'"
    );
    const xid = (await db.query("SELECT pg_current_xact_id()::text AS xid"))
      .rows[0].xid;
    assert.match(xid, /^[1-9][0-9]*$/);
    await official.stagePreparedNativeLeaderboard(db, handle);
    const staged = await globalPublicationObservation(db, plan.generationId);
    candidateMatches(staged, plan, false);
    assert.deepEqual(staged.pointer, before.pointer);
    assert.deepEqual(staged.walletStats, {
      rows: handle.walletRows,
      sha256: handle.walletRowsSha256
    });
    assert.deepEqual(staged.stamps, [
      acceptedStamp("leaderboard", plan),
      before.stamps.find((row) => row.name === "traits")
    ]);
    const packet = {
      format: FORMAT,
      event: "publication-prepared",
      xid,
      backend: await backendIdentity(db),
      generationId: plan.generationId,
      predecessorGenerationId: plan.predecessorGenerationId,
      privatePacketSha256: hash(privatePacket),
      staged,
      stagedObservationSha256: hash(staged),
      expectedPointer: {
        current: plan.generationId,
        previous: plan.predecessorGenerationId
      },
      expectedStamps: [
        acceptedStamp("leaderboard", plan),
        acceptedStamp("traits", plan)
      ]
    };
    assert.equal(
      await gate.beforeCommit(packet),
      true,
      "durable_root_publication_intent_ACK_required"
    );
    // Last mutable-source check. No root round trip or other work is placed
    // between the official dual-snapshot pointer/traits CAS and COMMIT.
    await official.publishGenerationInTransaction(
      db,
      plan.generationId,
      plan.metadataReleaseId,
      plan.predecessorGenerationId,
      handle.sourceSnapshot
    );
    await db.query("COMMIT");
    transaction = false;
    globallyCommitted = true;
    const acknowledgedAt = Date.now();
    const after = await globalPublicationObservation(db, plan.generationId);
    candidateMatches(after, plan, true);
    assert.deepEqual(after.pointer, packet.expectedPointer);
    assert.deepEqual(after.stamps, packet.expectedStamps);
    assert.deepEqual(after.walletStats, staged.walletStats);
    return {
      format: FORMAT,
      published: true,
      xid,
      after,
      preparedPacketSha256: hash(packet),
      commitAcknowledgedAtUnixMs: acknowledgedAt,
      elapsedMilliseconds: Math.round(performance.now() - started),
      automaticRepublishAllowed: false,
      readerInstallationClaimed: false
    };
  } catch (error) {
    if (transaction) await db.query("ROLLBACK").catch(() => {});
    // A COMMIT error can be a lost ACK. Neither this process nor a caller may
    // retry publication; root reconciles the fsynced XID and exact global tuple.
    throw error;
  } finally {
    // The root owns the client's lifetime. Keeping it here avoids accidental
    // destruction of a session-bound handle before its sole publication attempt.
    void globallyCommitted;
  }
}

/** Separate security-boundary admission. The production caller cannot provide
 * arbitrary role names or SQL; its exact catalog compiler is independently pinned.
 * The optional roles parameter is for disposable-cluster tests only. */
export async function changeReaderLogins(
  db,
  plan,
  beforeCommit,
  roles = LOGIN_ROLES
) {
  assert(["roles", "roles-inverse"].includes(plan.mode));
  assert.equal(typeof beforeCommit, "function");
  const enable = plan.mode === "roles";
  const expected = structuredClone(plan.before);
  assert.equal(
    new Set(expected.roles.map((row) => row.name)).size,
    expected.roles.length
  );
  for (const [name, oid] of Object.entries(roles)) {
    assert(/^[a-z][a-z0-9_]{1,62}$/.test(name));
    const row = expected.roles.find((value) => value.name === name);
    assert(
      row && String(row.oid) === oid && row.login === !enable,
      "exact_owned_reader_prior_LOGIN_required"
    );
    row.login = enable;
  }
  assert.equal(Object.keys(roles).length, 2);
  assert.deepEqual(
    expected,
    plan.after,
    "only_two_reader_LOGIN_bits_may_change"
  );
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await db.query(
      "SET LOCAL search_path=pg_catalog;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='1s';SET LOCAL idle_in_transaction_session_timeout='90s'"
    );
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('ypal-native-reader-LOGIN-v1'))"
    );
    const xid = (await db.query("SELECT pg_current_xact_id()::text AS xid"))
      .rows[0].xid;
    const scalar = async () => {
      const rows = (await db.query(plan.catalogSql)).rows;
      assert.equal(rows.length, 1);
      assert.equal(Object.keys(rows[0]).length, 1);
      return Object.values(rows[0])[0];
    };
    const before = await scalar();
    assert.deepEqual(
      before,
      plan.before,
      "same_reader_catalog_before_LOGIN_required"
    );
    for (const name of Object.keys(roles))
      await db.query(`ALTER ROLE "${name}" ${enable ? "LOGIN" : "NOLOGIN"}`);
    const after = await scalar();
    assert.deepEqual(
      after,
      expected,
      "exact_two_reader_LOGIN_postcatalog_required"
    );
    const message = {
      format: FORMAT,
      event: "roles-prepared",
      mode: plan.mode,
      xid,
      backend: await backendIdentity(db),
      before,
      after
    };
    assert.equal(
      await beforeCommit(message),
      true,
      "separate_durable_LOGIN_intent_ACK_required"
    );
    await db.query("COMMIT");
    return {
      format: FORMAT,
      mode: plan.mode,
      committed: true,
      xid,
      before,
      after,
      automaticRetryAllowed: false
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

const OPS = "/opt/yunipals-unified/operations/free-replay-20261020";
const PROJECT =
  "/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer";
const PUBLISHER =
  "/opt/yunipals-unified/nonmarket-consumer-releases/2b104015af8aa0fd6f4710c07bcc73125819e663a3d2f15de8d31443e587cefe";
const CAPSULE = OPS + "/ypal-ordinary-generation-recovery-v5.mjs";
const byteHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");

async function loadPublicationLibraries() {
  const bytes = readFileSync(PUBLISHER + "/manifest.json");
  assert.equal(
    byteHash(bytes),
    "1a8174b05977bd6ef1adfd50a9f5679543c6be1325bbbf126a81cafec23c7b84"
  );
  const manifest = JSON.parse(bytes);
  assert.equal(
    manifest.artifactDigest,
    "2b104015af8aa0fd6f4710c07bcc73125819e663a3d2f15de8d31443e587cefe"
  );
  for (const name of [
    "native-leaderboard-preparation",
    "projection-publication"
  ]) {
    const row = manifest.files.find(
      (value) => value.path === "dist/" + name + ".mjs"
    );
    const source = readFileSync(PUBLISHER + "/" + row.path);
    assert.equal(source.length, row.bytes);
    assert.equal(byteHash(source), row.sha256);
  }
  const prepare = await import(
    pathToFileURL(PUBLISHER + "/dist/native-leaderboard-preparation.mjs").href
  );
  const publish = await import(
    pathToFileURL(PUBLISHER + "/dist/projection-publication.mjs").href
  );
  return { ...prepare, ...publish };
}

function localDatabaseOnly(databaseSocket, allowDatabase = true) {
  const counters = { providerAttempts: 0, databaseConnectAttempts: 0 };
  const deny = () => {
    counters.providerAttempts++;
    throw Error("only_exact_local_database_transport_allowed");
  };
  globalThis.fetch = async () => deny();
  const secure = tls.connect;
  tls.connect = function (options, ...rest) {
    if (
      !options ||
      typeof options !== "object" ||
      !options.socket ||
      options.socket !== databaseSocket()
    )
      return deny();
    return secure.call(this, options, ...rest); // Preserve configured TLS for the same already-owned local PG socket.
  };
  http.request = deny;
  http.get = deny;
  https.request = deny;
  https.get = deny;
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    if (!allowDatabase) return deny();
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const allowed =
      typeof first === "number"
        ? first === 5432 && ["localhost", "127.0.0.1", "::1"].includes(args[1])
        : first && typeof first === "object"
          ? first.path === "/var/run/postgresql/.s.PGSQL.5432" ||
            (Number(first.port) === 5432 &&
              ["localhost", "127.0.0.1", "::1"].includes(first.host))
          : first === "/var/run/postgresql/.s.PGSQL.5432";
    assert(allowed, "only_exact_local_database_socket_allowed");
    counters.databaseConnectAttempts++;
    return connect.apply(this, args);
  };
  syncBuiltinESMExports();
  return counters;
}

async function main() {
  const status = readFileSync("/proc/self/status", "utf8");
  for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    assert.equal(
      status.match(new RegExp("^" + field + ":\\s*([a-f0-9]+)$", "m"))?.[1],
      "0000000000000000"
    );
  assert.equal(status.match(/^NoNewPrivs:\s*(\d+)$/m)?.[1], "1");
  assert.equal(process.ppid, Number(process.env.YUNIPALS_CUTOVER_PARENT));
  assert(process.getgroups().every((group) => group === process.getgid()));
  assert.equal(status.match(/^Groups:[ \t]*(.*)$/m)?.[1].trim(), "");
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const request = JSON.parse((await lines.next()).value);
  assert(
    [
      "inspect",
      "roles",
      "roles-inverse",
      "publish",
      "capsule-inspect",
      "capsule-inverse",
      "witness"
    ].includes(request.mode)
  );
  const manifestBytes = readFileSync(
    OPS + "/ypal-ordinary-reader-wire-v5.manifest.json"
  );
  assert.equal(byteHash(manifestBytes), request.sourceManifestSha256);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.format, "yunipals-ypal-ordinary-reader-wire-v5");
  assert.equal(
    byteHash(readFileSync(new URL(import.meta.url))),
    manifest.files["ypal-ordinary-reader-sql-v5.mjs"]
  );
  if (request.mode === "witness") {
    assert.equal(process.getuid(), 0);
    assert.equal(process.getgid(), 0);
    const counters = localDatabaseOnly(() => undefined, false);
    for (const name of [
      "ownership-parity-peer-v2.mjs",
      "ownership-parity-peer-v4.mjs",
      "fixed-boundary-witness-v5.mjs"
    ])
      assert.equal(
        byteHash(readFileSync(OPS + "/" + name)),
        manifest.dependencies[name]
      );
    const witness = await import(
      pathToFileURL(OPS + "/fixed-boundary-witness-v5.mjs").href
    );
    const result = await witness.validateWitnessReceipt(
      request.plan.witness,
      request.plan.parityBytes,
      request.plan.baselineBytes
    );
    assert.equal(counters.providerAttempts, 0);
    assert.equal(counters.databaseConnectAttempts, 0);
    send({
      event: "result",
      value: { ...result, counters, databaseWrites: 0, providerRequests: 0 }
    });
    return;
  }
  const business = ["inspect", "publish"].includes(request.mode);
  assert.equal(process.getuid(), business ? 0 : 111);
  assert.equal(process.getgid(), business ? 0 : 113);
  let db;
  const counters = localDatabaseOnly(() => db?.connection?.stream);
  const pg = createRequire(PROJECT + "/package.json")("pg");
  db = business
    ? new pg.Client({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000
      })
    : new pg.Client({
        host: "/var/run/postgresql",
        port: 5432,
        user: "postgres",
        database: "yunipals_backfill",
        connectionTimeoutMillis: 5000,
        options:
          "-c statement_timeout=30000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=90000 -c timezone=UTC"
      });
  const parameters = db.connectionParameters;
  assert.equal(parameters.user, business ? "yunipals" : "postgres");
  assert.equal(parameters.database, "yunipals_backfill");
  assert(
    ["localhost", "127.0.0.1", "::1", "/var/run/postgresql"].includes(
      parameters.host
    )
  );
  assert.equal(Number(parameters.port), 5432);
  // A bundle's inert exported Pool objects must not create extra SQL sessions.
  const originalConnect = pg.Client.prototype.connect;
  pg.Client.prototype.connect = function (...args) {
    assert.equal(this, db, "one_exact_business_or_root_SQL_client_required");
    return originalConnect.apply(this, args);
  };
  await db.connect();
  try {
    await db.query(
      "SET TIME ZONE 'UTC';SET application_name='ypal_native_cutover_v1'"
    );
    const who = (
      await db.query(
        "SELECT current_user,session_user,(SELECT oid::text FROM pg_roles WHERE rolname=current_user)AS role_oid,(SELECT oid::text FROM pg_database WHERE datname=current_database())AS database_oid,inet_client_addr()::text AS client_address,current_setting('port')AS port"
      )
    ).rows[0];
    assert.equal(who.current_user, business ? "yunipals" : "postgres");
    assert.equal(who.session_user, who.current_user);
    assert.equal(who.role_oid, business ? "16388" : "10");
    assert.equal(who.database_oid, "17584");
    assert.equal(who.port, "5432");
    assert([null, "127.0.0.1", "::1"].includes(who.client_address));
    const authorize = async (message) => {
      send(message);
      const response = JSON.parse((await lines.next()).value);
      assert.equal(response.event, "root-authorized");
      assert.equal(response.phase, message.event);
      assert.equal(response.messageSha256, hash(message));
      return true;
    };
    if (
      ["roles", "roles-inverse", "publish", "capsule-inverse"].includes(
        request.mode
      )
    )
      await authorize({
        format: FORMAT,
        event: "session-opened",
        mode: request.mode,
        backend: await backendIdentity(db),
        currentUser: who.current_user,
        sessionUser: who.session_user
      });
    let result;
    if (request.mode === "inspect") {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const observation = await globalPublicationObservation(
        db,
        request.plan.generationId
      );
      await db.query("ROLLBACK");
      result = {
        format: FORMAT,
        inspected: true,
        databaseWrites: 0,
        observation,
        observationSha256: hash(observation)
      };
    } else if (["roles", "roles-inverse"].includes(request.mode)) {
      assert.equal(
        byteHash(request.plan.catalogSql),
        "cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991"
      );
      assert.equal(request.plan.mode, request.mode);
      result = await changeReaderLogins(db, request.plan, authorize);
    } else if (request.mode === "publish") {
      assert.deepEqual(request.plan.boundaryPoints, [
        { chainId: 1, number: "26236452" },
        { chainId: 56, number: "128816538" },
        { chainId: 137, number: "95883932" },
        { chainId: 8453, number: "52870956" },
        { chainId: 8453, number: "52870977" }
      ]);
      const official = await loadPublicationLibraries();
      result = await publishPreparedCandidate(db, official, request.plan, {
        privatePrepared: authorize,
        beforeCommit: authorize
      });
      assert.equal(
        byteHash(readFileSync(CAPSULE)),
        "b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21"
      );
      const capsule = await import(pathToFileURL(CAPSULE).href);
      result.ownedDerivedObservation =
        await capsule.observeGenerationRecovery(db);
    } else {
      assert.equal(
        byteHash(readFileSync(CAPSULE)),
        "b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21"
      );
      const capsule = await import(pathToFileURL(CAPSULE).href);
      if (request.mode === "capsule-inspect") {
        await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        result = {
          format: FORMAT,
          inspected: true,
          databaseWrites: 0,
          observation: await capsule.observeGenerationRecovery(db)
        };
        await db.query("ROLLBACK");
      } else {
        result = await capsule.restoreGenerationRecovery(
          db,
          request.plan.capsule,
          request.plan.ownedGenerationId,
          request.plan.externalBinding,
          request.plan.ownedDerivedObservation,
          async () => {
            const xid = (
              await db.query("SELECT pg_current_xact_id()::text AS xid")
            ).rows[0].xid;
            await authorize({
              format: FORMAT,
              event: "capsule-prepared",
              xid,
              backend: await backendIdentity(db),
              result: await capsule.observeGenerationRecovery(db)
            });
          }
        );
      }
    }
    assert.equal(counters.providerAttempts, 0);
    send({ event: "result", value: { ...result, counters } });
  } finally {
    await db.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    send({
      event: "refused",
      format: FORMAT,
      errorClass: error.name,
      postgresCode: /^[0-9A-Z]{5}$/.test(error.code ?? "") ? error.code : null,
      privateDiagnosticsWithheld: true,
      automaticRetryAllowed: false
    });
    process.exitCode = 1;
  });
}
