#!/usr/bin/env node
/** Owner-only adapter for the existing adoption function; no selector/mode change. */
import { createHash } from "node:crypto";
import {
  constants,
  fstatSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  readSync,
  writeSync,
  fsyncSync
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hostname, userInfo } from "node:os";
import { spawnSync } from "node:child_process";

export const FORMAT = "yunipals-arena-legacy-origin-adopt-v2";
export const PRODUCTIVE_UNITS = Object.freeze([
  "yunipals-paid-productive-controller-v5-20261021-prod2.service",
  "yunipals-unified-paid-productive-v7-20261021-prod2.service",
  "yunipals-paid-productive-controller-v6-20261021-prod3.service",
  "yunipals-unified-paid-productive-v8-20261021-prod3.service"
]);
const PRODUCTIVE_CURRENT = Object.freeze({
  "yunipals-paid-productive-controller-v6-20261021-prod3.service":
    "9bf04a796cf54eb0ae61bbd7f66ec243",
  "yunipals-unified-paid-productive-v8-20261021-prod3.service":
    "2dce868db86948e9ad7d8935ae85243d"
});
const ROOT =
  "/opt/yunipals-unified/releases/3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d";
const MANIFEST_SHA =
  "1cdf261d411007868ad1f026a58cae381b02c5f92c6a9a45da30e9867e9f7df8";
const RELEASE =
  "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c";
const DEPLOYMENT = "8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca";
const PRIVATE = [
  "submission",
  "fighter_snapshot",
  "frozen_input",
  "admission",
  "provider_task",
  "transaction_intent",
  "adjudication",
  "media_job",
  "provider_action_evidence",
  "media_publication",
  "client_transaction",
  "client_receipt_history",
  "transaction_receipt_history",
  "opening_action_observation",
  "identity_job"
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
  JSON.stringify(value, function (_, v) {
    return v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        )
      : v;
  });
const digest = (value) => hash(canonical(value));
class AdoptionFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const demand = (value, code) => {
  if (!value) throw new AdoptionFailure(code);
};
const equal = (a, b) => canonical(a) === canonical(b);

export function verifyProductiveTerminal(
  unit,
  state,
  group,
  completedController = false
) {
  demand(
    PRODUCTIVE_UNITS.includes(unit) &&
      state.Id === unit &&
      Object.keys(state).sort().join() ===
        [
          "Id",
          "InvocationID",
          "LoadState",
          "ActiveState",
          "SubState",
          "MainPID",
          "Result",
          "ExecMainStatus",
          "Slice",
          "ControlGroup"
        ]
          .sort()
          .join() &&
      state.MainPID === "0" &&
      ["inactive", "failed"].includes(state.ActiveState) &&
      ["dead", "failed"].includes(state.SubState),
    "productive_controller_and_native_must_both_be_stopped"
  );
  demand(
    (state.Slice === "system.slice" ||
      (state.LoadState === "not-found" && state.Slice === "")) &&
      ["", `/system.slice/${unit}`].includes(state.ControlGroup) &&
      (state.ControlGroup !== "" || group === "absent"),
    "exact_productive_slice_and_control_group_required"
  );
  if (state.LoadState === "loaded") {
    demand(
      !PRODUCTIVE_CURRENT[unit] ||
        state.InvocationID === PRODUCTIVE_CURRENT[unit] ||
        (unit === PRODUCTIVE_UNITS[2] &&
          state.InvocationID === "" &&
          state.ActiveState === "inactive" &&
          state.SubState === "dead" &&
          state.Result === "success" &&
          state.ExecMainStatus === "0" &&
          completedController === true),
      "exact_current_productive_invocation_required"
    );
    demand(
      ["absent", "present_empty"].includes(group),
      "productive_cgroup_must_be_recursively_empty"
    );
  } else {
    demand(
      state.LoadState === "not-found" &&
        state.InvocationID === "" &&
        state.ActiveState === "inactive" &&
        state.SubState === "dead" &&
        group === "absent",
      "GC_productive_unit_requires_absent_cgroup"
    );
  }
  return true;
}

function completedProductiveController() {
  const source =
    "/opt/yunipals-unified/operations/free-replay-20261020/arena-owner-migration-v2.py";
  const pin =
    "70ca16836b8df7f71683ae7999be83bb97186c063133a15b2f6b8d58f074ef65";
  demand(
    hash(readPublic(source, 200000)) === pin,
    "pinned_completed_controller_reader_required"
  );
  const code =
    "import hashlib,json,sys,types;from pathlib import Path;p=Path(sys.argv[1]);raw=p.read_bytes();assert len(raw)<=200000 and hashlib.sha256(raw).hexdigest()==sys.argv[2];m=types.ModuleType('arena_terminal_reader');m.__file__=str(p);exec(compile(raw,str(p),'exec'),m.__dict__);print(json.dumps(m.productive_completed_controller(),sort_keys=True))";
  const result = spawnSync(
    "/usr/bin/python3",
    ["-I", "-S", "-B", "-c", code, source, pin],
    {
      env: {
        PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
        LANG: "C.UTF-8",
        TZ: "UTC"
      },
      encoding: "utf8",
      timeout: 45000,
      maxBuffer: 16384
    }
  );
  demand(
    result.status === 0 && !result.error && !result.stderr,
    "actual_completed_controller_lineage_required"
  );
  const receipt = JSON.parse(result.stdout);
  demand(
    Object.keys(receipt).sort().join() ===
      "completionSha256,controllerResultSha256,verified" &&
      receipt.verified === true &&
      /^[0-9a-f]{64}$/.test(receipt.completionSha256) &&
      /^[0-9a-f]{64}$/.test(receipt.controllerResultSha256),
    "actual_completed_controller_receipt_required"
  );
  return true;
}

function productiveCgroupEmpty(unit) {
  demand(
    PRODUCTIVE_UNITS.includes(unit),
    "fixed_productive_cgroup_selector_required"
  );
  const parent = "/sys/fs/cgroup/system.slice",
    path = `${parent}/${unit}`,
    root = lstatSync(parent);
  demand(
    root.isDirectory() && root.uid === 0 && !(root.mode & 0o022),
    "trusted_system_slice_required"
  );
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const after = lstatSync(parent);
    demand(
      root.dev === after.dev && root.ino === after.ino,
      "system_slice_identity_changed"
    );
    return "absent";
  }
  demand(
    before.isDirectory() &&
      before.uid === 0 &&
      !(before.mode & 0o022) &&
      before.dev === root.dev,
    "exact_owned_productive_cgroup_required"
  );
  const values = {};
  for (const name of ["cgroup.procs", "cgroup.events"]) {
    const fd = openSync(
      `${path}/${name}`,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      demand(fstatSync(fd).isFile(), "fixed_cgroup_file_required");
      const raw = Buffer.alloc(4097),
        length = readSync(fd, raw, 0, raw.length, null);
      demand(length <= 4096, "bounded_productive_cgroup_metadata_required");
      values[name] = raw.subarray(0, length).toString("ascii");
    } finally {
      closeSync(fd);
    }
  }
  const events = Object.fromEntries(
    values["cgroup.events"]
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
  );
  demand(
    !values["cgroup.procs"].trim() && events.populated === "0",
    "productive_cgroup_must_be_recursively_empty"
  );
  const after = lstatSync(path);
  demand(
    before.dev === after.dev && before.ino === after.ino,
    "productive_cgroup_identity_changed"
  );
  return "present_empty";
}

function readPublic(path, maximum = 2_000_000) {
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const s = lstatSync(parent);
    demand(
      s.isDirectory() && s.uid === 0 && !(s.mode & 0o022),
      "protected_public_source_parent_required"
    );
    if (parent === "/") break;
  }
  const before = lstatSync(path);
  demand(
    before.isFile() &&
      before.uid === 0 &&
      before.nlink === 1 &&
      !(before.mode & 0o022) &&
      before.size <= maximum,
    "bounded_pinned_public_source_required"
  );
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const meta = (s) => [
    s.dev,
    s.ino,
    s.uid,
    s.gid,
    s.mode,
    s.nlink,
    s.size,
    s.mtimeMs,
    s.ctimeMs
  ];
  try {
    demand(equal(meta(before), meta(fstatSync(fd))), "source_inode_changed");
    const raw = readFileSync(fd);
    demand(
      raw.length === before.size &&
        equal(meta(before), meta(fstatSync(fd))) &&
        equal(meta(before), meta(lstatSync(path))),
      "source_changed_during_read"
    );
    return raw;
  } finally {
    closeSync(fd);
  }
}

export function originBinding(observed) {
  const t = observed.tournament;
  demand(
    t && t.deployment === DEPLOYMENT && observed.releaseId === RELEASE,
    "actual_selected_native_origin_required"
  );
  // Moving framework checkpoints/head timestamps are checked by the actual
  // reader/verifier, but are not substituted for stable reviewed business state.
  return {
    releaseId: observed.releaseId,
    id: t.id,
    incarnation: t.incarnation,
    opened: t.opened,
    last: t.last,
    inputFrozen: t.inputFrozen,
    stateSha256: digest(t.state)
  };
}

export async function reviewOrigins(db, source, verify, markers) {
  const actualMarkers = (
    await db.query(
      "SELECT version,checksum FROM yunipals_arena.operational_migration ORDER BY version"
    )
  ).rows;
  demand(
    equal(actualMarkers, markers),
    "exact_twelve_official_migrations_required"
  );
  const target = (
    await db.query(
      `SELECT current_database() AS database,current_setting('port') AS port,current_user AS owner,
    d.id,d.contract,d.start_block::text,d.halted,d.indexer_mode,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS other_sessions
    FROM yunipals_arena.deployment d WHERE d.id=$1`,
      [DEPLOYMENT]
    )
  ).rows;
  demand(
    target.length === 1 &&
      target[0].database === "yunipals_arena" &&
      target[0].port === "15438" &&
      target[0].owner === "yunipals_arena_owner" &&
      target[0].id === DEPLOYMENT &&
      target[0].contract.toLowerCase() === DEPLOYMENT.slice(5) &&
      target[0].halted === true &&
      target[0].indexer_mode === "unified" &&
      target[0].other_sessions === 0,
    "halted_unified_drained_owner_target_required"
  );
  const identities = (
    await db.query(
      `SELECT deployment,tournament_id::text AS id,incarnation,cipher_context,created_at::text FROM yunipals_arena.tournament_identity ORDER BY deployment,tournament_id,incarnation LIMIT 3`
    )
  ).rows;
  demand(
    identities.length === 2 &&
      identities.every(
        (r) =>
          r.deployment === DEPLOYMENT &&
          r.incarnation === "legacy" &&
          r.cipher_context === `${r.deployment}/${r.id}`
      ),
    "exact_two_actual_legacy_origins_required"
  );
  const observations = [];
  for (const identity of identities) {
    const observed = await source.read(identity.id);
    originBinding(observed);
    await verify(observed);
    observations.push(observed);
  }
  return {
    target: { ...target[0], other_sessions: 0 },
    identities,
    origins: observations.map(originBinding),
    observations
  };
}

export async function privateSeal(db) {
  const bodies = {};
  for (const table of PRIVATE) {
    // Every selected row remains inside the host process/audit. Exclude only
    // the reviewed cascading identity field, retaining UUIDs/ciphertexts/spend.
    const rows = (
      await db.query(
        `SELECT to_jsonb(t)-'incarnation' AS body FROM yunipals_arena.${table} t ORDER BY (to_jsonb(t)-'incarnation')::text LIMIT 2001`
      )
    ).rows;
    demand(rows.length <= 2000, "bounded_actual_private_state_required");
    bodies[table] = {
      count: rows.length,
      sha256: digest(rows.map((r) => r.body))
    };
  }
  const aad = (
    await db.query(
      `SELECT deployment,tournament_id::text,cipher_context,created_at::text FROM yunipals_arena.tournament_identity ORDER BY deployment,tournament_id,created_at`
    )
  ).rows;
  const selectors = (
    await db.query(
      `SELECT jsonb_build_object('selection',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text),'[]') FROM yunipals_arena.source_selection s),'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY to_jsonb(h)::text),'[]') FROM yunipals_arena.source_switch_history h)) AS body`
    )
  ).rows[0].body;
  return {
    tables: bodies,
    aadSha256: digest(aad),
    selectorsSha256: digest(selectors)
  };
}

export async function adoptOrigins(
  db,
  reviewed,
  source,
  verify,
  adopt,
  markers
) {
  // This is the existing source lease key used by ordinary compatible consumers;
  // the official adoption function also takes the original projector key.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `arena/source-selection/${DEPLOYMENT}`
  ]);
  const current = await reviewOrigins(db, source, verify, markers);
  demand(
    equal(current.identities, reviewed.identities) &&
      equal(current.origins, reviewed.origins),
    "fresh_exact_origin_review_required"
  );
  const before = await privateSeal(db);
  demand(
    equal(before, reviewed.privateSeal),
    "reviewed_private_baseline_changed"
  );
  for (const observed of current.observations) await adopt(db, observed);
  for (const observed of current.observations) {
    const again = await source.read(observed.tournament.id);
    demand(
      equal(originBinding(again), originBinding(observed)),
      "origin_changed_during_owner_adoption"
    );
    await verify(again);
  }
  demand(
    equal(await privateSeal(db), before),
    "retained_private_history_or_selector_changed"
  );
  const after = (
    await db.query(
      `SELECT tournament_id::text AS id,incarnation,opened_event_id,opened_block_hash,bound_release_id,cipher_context FROM yunipals_arena.tournament_identity ORDER BY tournament_id`
    )
  ).rows;
  demand(
    after.length === 2 &&
      current.observations.every((o) =>
        after.some(
          (r) =>
            r.id === o.tournament.id &&
            r.incarnation === o.tournament.incarnation &&
            r.opened_event_id === o.tournament.opened.id &&
            r.opened_block_hash === o.tournament.opened.blockHash &&
            r.bound_release_id === RELEASE &&
            r.cipher_context === `${DEPLOYMENT}/${r.id}`
        )
      ),
    "official_adoption_result_not_observed"
  );
  return { privateSeal: before, adopted: 2, sourceSelectorChanged: false };
}

async function runtime() {
  const raw = readPublic(`${ROOT}/RELEASE-MANIFEST.json`);
  demand(
    hash(raw) === MANIFEST_SHA,
    "exact_installed_consumer_source_required"
  );
  const manifest = JSON.parse(raw);
  for (const row of manifest.files) {
    demand(
      typeof row.path === "string" &&
        !row.path.startsWith("/") &&
        resolve(ROOT, row.path).startsWith(`${ROOT}/`),
      "contained_manifest_source_required"
    );
    const body = readPublic(`${ROOT}/${row.path}`, 25_000_000);
    demand(
      body.length === row.bytes && hash(body) === row.sha256,
      "installed_source_manifest_mismatch"
    );
  }
  const migrationRaw = readPublic(
    "/opt/yunipals-unified/operations/arena-role-inventory-20261021/operational-migrations.v1.json",
    100_000
  );
  demand(
    hash(migrationRaw) ===
      "f6f8c50c7242671f8736acdedb724df7dfd6bf0fb510343af5482e2794cf8f5b",
    "official_migration_marker_input_changed"
  );
  const markers = JSON.parse(migrationRaw).markers;
  const app = `${ROOT}/apps/yunipals-market-api`,
    req = createRequire(`${app}/package.json`);
  const { tsImport } = req("tsx/esm/api");
  const load = (name) =>
    tsImport(`${app}/src/arena/live/${name}.ts`, {
      parentURL: pathToFileURL(`${app}/package.json`).href,
      tsconfig: `${app}/tsconfig.json`
    });
  const [
    { NativeArenaSource },
    { verifyNativeArenaAction },
    { adoptLegacyTournamentIdentity },
    { sourceLeaseKey }
  ] = await Promise.all([
    load("nativeSource"),
    load("nativeAction"),
    load("tournamentIdentity"),
    load("sourceSelection")
  ]);
  demand(
    sourceLeaseKey(DEPLOYMENT) === `arena/source-selection/${DEPLOYMENT}`,
    "official_source_lease_key_changed"
  );
  const pg = req("pg"),
    { createPublicClient, http } = req("viem");
  const options =
    "-c statement_timeout=10000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=180000";
  const operational = new pg.Pool({
    host: "/var/run/postgresql",
    port: 15438,
    database: "yunipals_arena",
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: 5000,
    options: `${options} -c role=yunipals_arena_owner`
  });
  const physical = new pg.Pool({
    host: "/var/run/postgresql",
    port: 5432,
    database: "yunipals_backfill",
    user: "postgres",
    max: 1,
    connectionTimeoutMillis: 5000,
    options: `${options} -c default_transaction_read_only=on`
  });
  const point = createPublicClient({
    transport: http("http://127.0.0.1:19202", { retryCount: 0, timeout: 5000 })
  });
  return {
    operational,
    physical,
    NativeArenaSource,
    markers,
    verify: (observed) => verifyNativeArenaAction(point, observed),
    adopt: adoptLegacyTournamentIdentity
  };
}

async function main() {
  demand(
    hostname() === "yunipals-main" &&
      userInfo().username === "postgres" &&
      Number(process.versions.node.split(".")[0]) === 24,
    "fixed_nonroot_postgres_peer_required"
  );
  demand(
    process.execPath === "/opt/node-v24.18.1/bin/node" &&
      hash(readPublic(process.execPath, 150_000_000)) ===
        "f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a" &&
      process.env.TSX_DISABLE_CACHE === "1",
    "exact_node_and_disabled_transpile_cache_required"
  );
  demand(
    process.argv.length === 2 ||
      (process.argv.length === 4 &&
        process.argv[2] === "--apply" &&
        /^[0-9a-f]{64}$/.test(process.argv[3])),
    "default_review_or_exact_hash_apply_only"
  );
  demand(
    !process.env.DATABASE_URL &&
      !process.env.PGPASSWORD &&
      !process.env.PGOPTIONS &&
      process.env.PGPASSFILE === "/run/yunipals-arena-adoption-no-password",
    "clean_peer_environment_required"
  );
  try {
    lstatSync(process.env.PGPASSFILE);
    demand(false, "controlled_passfile_must_be_absent");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const audit = fstatSync(3);
  demand(
    audit.isFile() &&
      audit.uid === 0 &&
      !(audit.mode & 0o077) &&
      audit.nlink === 1 &&
      audit.size === 0,
    "fresh_root_private_audit_descriptor_required"
  );
  // Root passes an existing read-only lease descriptor, never a created lock.
  // flock in a child shares that open-file description, retaining the lease
  // on fd4 here until this process exits. It also fences orphan native units.
  const lease = fstatSync(4),
    named = lstatSync("/run/lock/yunipals-unified-shadow.lock");
  demand(
    lease.isFile() &&
      named.isFile() &&
      lease.uid === 0 &&
      lease.nlink === 1 &&
      !(lease.mode & 0o077) &&
      lease.dev === named.dev &&
      lease.ino === named.ino,
    "existing_exact_source_lease_descriptor_required"
  );
  const hold = spawnSync("/usr/bin/flock", ["--exclusive", "--nonblock", "4"], {
    stdio: ["ignore", "pipe", "pipe", "ignore", 4],
    env: { PATH: "/usr/bin:/bin" },
    timeout: 3000,
    maxBuffer: 4096
  });
  demand(
    hold.status === 0 &&
      !hold.error &&
      hold.stdout.length === 0 &&
      hold.stderr.length === 0,
    "productive_replay_must_close_before_adoption"
  );
  for (const unit of PRODUCTIVE_UNITS) {
    const capture = () => {
      const child = spawnSync(
        "/usr/bin/systemctl",
        [
          "show",
          "--all",
          unit,
          "--property=Id",
          "--property=InvocationID",
          "--property=LoadState",
          "--property=MainPID",
          "--property=ActiveState",
          "--property=SubState",
          "--property=Result",
          "--property=ExecMainStatus",
          "--property=Slice",
          "--property=ControlGroup"
        ],
        {
          env: { PATH: "/usr/bin:/bin" },
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 4096
        }
      );
      demand(
        child.status === 0 && !child.error && !child.stderr,
        "bounded_productive_terminal_metadata_required"
      );
      const rows = child.stdout
        .trim()
        .split("\n")
        .map((r) => r.split("="));
      demand(
        rows.length === 10 &&
          Object.keys(Object.fromEntries(rows)).length === 10,
        "complete_productive_terminal_metadata_required"
      );
      return Object.fromEntries(rows);
    };
    const state = capture();
    const completed =
      unit === PRODUCTIVE_UNITS[2] &&
      state.LoadState === "loaded" &&
      state.InvocationID === "" &&
      state.MainPID === "0" &&
      state.ActiveState === "inactive" &&
      state.SubState === "dead" &&
      state.Result === "success" &&
      state.ExecMainStatus === "0"
        ? completedProductiveController()
        : false;
    verifyProductiveTerminal(
      unit,
      state,
      productiveCgroupEmpty(unit),
      completed
    );
    demand(equal(capture(), state), "productive_terminal_state_changed");
  }
  const actual = await runtime();
  let db,
    outcome = "not_attempted";
  const log = (value) => {
    writeSync(3, JSON.stringify(value) + "\n");
    fsyncSync(3);
  };
  try {
    db = await actual.operational.connect();
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const deployment = (
      await db.query(
        "SELECT contract,start_block::text FROM yunipals_arena.deployment WHERE id=$1",
        [DEPLOYMENT]
      )
    ).rows[0];
    demand(deployment, "retained_deployment_required");
    const source = new actual.NativeArenaSource(
      actual.physical,
      RELEASE,
      deployment.contract,
      BigInt(deployment.start_block)
    );
    const reviewed = await reviewOrigins(
        db,
        source,
        actual.verify,
        actual.markers
      ),
      seal = await privateSeal(db);
    reviewed.privateSeal = seal;
    const binding = {
      format: FORMAT,
      operatorSha256: hash(readPublic(resolve(process.argv[1]), 100_000)),
      markers: actual.markers,
      manifestSha256: MANIFEST_SHA,
      owner: reviewed.target,
      identities: reviewed.identities,
      origins: reviewed.origins,
      privateSeal: seal
    };
    const reviewHash = digest(binding);
    await db.query("ROLLBACK");
    log({ phase: "review", reviewHash, binding });
    if (process.argv[2] === "--apply") {
      demand(
        reviewHash === process.argv[3],
        "fresh_exact_adoption_review_required"
      );
      await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      log({ phase: "adoption_intent", reviewHash, automaticRetry: false });
      const result = await adoptOrigins(
        db,
        reviewed,
        source,
        actual.verify,
        actual.adopt,
        actual.markers
      );
      outcome = "unconfirmed_requires_catalog_reconcile";
      log({ phase: "commit_intent", reviewHash, outcome });
      await db.query("COMMIT");
      outcome = "commit_confirmed";
      log({ phase: "committed", reviewHash, outcome, result });
    }
    console.log(
      JSON.stringify({
        format: FORMAT,
        reviewHash,
        legacyOriginsReviewed: 2,
        adopted: outcome === "commit_confirmed" ? 2 : 0,
        commitOutcome: outcome,
        sourceSelectorChanged: false,
        providerJobs: 0,
        signingOrBroadcasts: 0
      })
    );
  } catch (error) {
    log({
      phase: "failed",
      outcome,
      errorClass: error.constructor?.name ?? "Error",
      fixedCode:
        error instanceof AdoptionFailure ? error.code : "owner_adoption_failed",
      automaticRetry: false
    });
    try {
      if (outcome === "not_attempted") await db?.query("ROLLBACK");
    } catch {
      /* no rollback claim */
    }
    error.commitOutcome = outcome;
    throw error;
  } finally {
    db?.release(true);
    await Promise.all([actual.operational.end(), actual.physical.end()]);
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.log(
      JSON.stringify({
        format: FORMAT,
        completed: false,
        errorClass: error.constructor?.name ?? "Error",
        fixedCode:
          error instanceof AdoptionFailure
            ? error.code
            : "owner_adoption_failed",
        commitOutcome: error.commitOutcome ?? "not_attempted",
        automaticRetry: false,
        rawMessagesExported: false
      })
    );
    process.exitCode = 1;
  });
}
