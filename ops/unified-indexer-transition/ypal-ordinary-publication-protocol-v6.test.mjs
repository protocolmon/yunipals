// Deterministic SQL-client fakes: no database or installed app is contacted.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  changeReaderLogins,
  LOGIN_ROLES,
  publishPreparedCandidate
} from "./ypal-ordinary-reader-sql-v6.mjs";

const backend = {
  pid: 77,
  backendStart: "1000000",
  clientAddress: null,
  clientPort: -1,
  xid: "42",
  roleOid: "10",
  databaseOid: "17584"
};
const fixed = (value) => ({ rows: [{ value: structuredClone(value) }] });
const checks = [];

for (const authorized of [true, false, undefined, { acknowledged: true }]) {
  const before = {
    roles: Object.entries(LOGIN_ROLES).map(([name, oid]) => ({
      name,
      oid,
      login: false
    }))
  };
  const after = {
    roles: before.roles.map((role) => ({ ...role, login: true }))
  };
  const plan = { mode: "roles", before, after, catalogSql: "SYNTHETIC_CATALOG" };
  const commands = [];
  let catalog = structuredClone(before);
  const db = {
    async query(sql) {
      commands.push(sql);
      if (sql === plan.catalogSql) return fixed(catalog);
      if (sql.includes("FROM pg_stat_activity")) return fixed(backend);
      if (sql.includes("pg_current_xact_id()"))
        return { rows: [{ xid: "42" }] };
      const altered = sql.match(/^ALTER ROLE "([a-z_]+)" LOGIN$/);
      if (altered)
        catalog.roles.find((role) => role.name === altered[1]).login = true;
      return { rows: [] };
    }
  };
  let calls = 0;
  const operation = changeReaderLogins(db, plan, async (packet) => {
    calls++;
    assert.equal(packet.event, "roles-prepared");
    assert.equal(packet.xid, "42");
    assert.deepEqual(packet.backend, backend);
    assert.deepEqual(packet.before, before);
    assert.deepEqual(packet.after, after);
    return authorized;
  });
  if (authorized === true) {
    assert.equal((await operation).committed, true);
    assert.equal(commands.filter((sql) => sql === "COMMIT").length, 1);
  } else {
    await assert.rejects(operation, /separate_durable_LOGIN_intent_ACK_required/);
    assert.equal(commands.filter((sql) => sql === "COMMIT").length, 0);
    assert.equal(commands.at(-1), "ROLLBACK");
  }
  assert.equal(calls, 1);
  assert(commands.some((sql) =>
    sql.includes("idle_in_transaction_session_timeout='240s'")
  ));
}
checks.push("two_LOGIN_changes_retain_exact_catalog_XID_and_literal_ACK");

const anchors = [1, 56, 137, 8453].map((chain_id) => ({
  chain_id,
  block_number: "100"
}));
const snapshot = {
  releaseId: "source-release",
  readIdentity: "read-identity",
  anchors
};
const plan = {
  generationId: "101",
  predecessorGenerationId: "100",
  metadataReleaseId: "metadata-release",
  sourceRelease: snapshot.releaseId,
  readIdentity: snapshot.readIdentity,
  validationSqlSha256: "c".repeat(64),
  candidateSourceSnapshot: snapshot,
  boundaryPoints: anchors.map((anchor) => ({
    chainId: anchor.chain_id,
    number: anchor.block_number
  }))
};
const stamp = (name) => ({
  name,
  metadataRelease: plan.metadataReleaseId,
  sourceRelease: plan.sourceRelease,
  readIdentity: plan.readIdentity
});

for (const refused of [null, "private-prepared", "publication-prepared"]) {
  const calls = [];
  const state = {
    pointer: { current: "100", previous: "99" },
    candidate: {
      id: "101",
      state: "ready",
      sourceMode: "archive",
      metadataRelease: plan.metadataReleaseId,
      sourceRelease: plan.sourceRelease,
      readIdentity: plan.readIdentity,
      published: false,
      validationSha256: plan.validationSqlSha256
    },
    archive: plan.metadataReleaseId,
    walletStats: { rows: "1", sha256: "a".repeat(64) },
    stamps: [stamp("leaderboard"), stamp("traits")].map((row) => ({
      ...row,
      metadataRelease: "previous-metadata"
    }))
  };
  const handle = {
    generationId: plan.generationId,
    predecessor: plan.predecessorGenerationId,
    metadataReleaseId: plan.metadataReleaseId,
    sourceSnapshot: snapshot,
    walletRows: "2",
    walletRowsSha256: "b".repeat(64)
  };
  plan.originalObservationSha256 = createHash("sha256")
    .update(JSON.stringify(state))
    .digest("hex");
  const db = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes("'pointer',")) return fixed(state);
      if (sql.includes("validation->'sourceSnapshot'")) return fixed(snapshot);
      if (sql.includes("FROM pg_stat_activity")) return fixed(backend);
      if (sql.includes("pg_current_xact_id()"))
        return { rows: [{ xid: "42" }] };
      return { rows: [] };
    }
  };
  const official = {
    async prepareNativeLeaderboardCandidate(client, generationId) {
      assert.equal(client, db);
      assert.equal(generationId, plan.generationId);
      calls.push("private-computation");
      return handle;
    },
    async stagePreparedNativeLeaderboard(client, retained) {
      assert.equal(client, db);
      assert.equal(retained, handle);
      calls.push("stage-private-handle");
      state.walletStats = {
        rows: handle.walletRows,
        sha256: handle.walletRowsSha256
      };
      state.stamps[0] = stamp("leaderboard");
    },
    async publishGenerationInTransaction(
      client,
      generationId,
      metadataRelease,
      predecessor,
      retainedSnapshot
    ) {
      assert.equal(client, db);
      assert.deepEqual(
        [generationId, metadataRelease, predecessor, retainedSnapshot],
        ["101", plan.metadataReleaseId, "100", snapshot]
      );
      calls.push("last-source-check-and-pointer-CAS");
      state.pointer = { current: "101", previous: "100" };
      state.candidate.published = true;
      state.stamps = [stamp("leaderboard"), stamp("traits")];
    }
  };
  const gate = async (packet) => {
    calls.push("root-ACK:" + packet.event);
    if (packet.event === "publication-prepared") {
      assert.equal(packet.xid, "42");
      assert.equal(packet.backend.xid, "42");
    }
    return packet.event !== refused;
  };
  const operation = publishPreparedCandidate(db, official, plan, {
    privatePrepared: gate,
    beforeCommit: gate
  });
  if (refused === null) {
    const result = await operation;
    assert.equal(result.published, true);
    assert.equal(result.automaticRepublishAllowed, false);
    assert.equal(result.readerInstallationClaimed, false);
    assert.equal(
      calls[calls.indexOf("last-source-check-and-pointer-CAS") + 1],
      "COMMIT"
    );
    assert.equal(calls.filter((sql) => sql === "COMMIT").length, 2);
  } else {
    await assert.rejects(operation, /ACK_required/);
    assert(!calls.includes("last-source-check-and-pointer-CAS"));
    assert.equal(calls.filter((sql) => sql === "COMMIT").length, 1);
    if (refused === "publication-prepared")
      assert.equal(calls.at(-1), "ROLLBACK");
    else assert(!calls.includes("stage-private-handle"));
  }
  assert(calls.some((sql) =>
    sql.includes("idle_in_transaction_session_timeout='240s'")
  ));
}
checks.push("publication_preserves_private_handle_held_XID_dual_ACK_and_final_CAS");
process.stdout.write(JSON.stringify({ checks, databaseConnections: 0 }) + "\n");
