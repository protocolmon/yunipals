import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  composition,
  externalWork,
  extendLedgerSource,
  TEMPLATE_SHA
} from "./arena-ypal-business-inverse-child-v1.mjs";
import * as previous from "./arena-modern-public-rollback-v1.mjs";

const raw = readFileSync(new URL("./arena-modern-public-rollback-v1.mjs", import.meta.url));
const current = await composition(raw);
const cutover = readFileSync(new URL("./arena-ypal-ordinary-v1.mjs", import.meta.url));
const { retainedLedger } = await import("data:text/javascript;base64," + Buffer.from(extendLedgerSource(cutover)).toString("base64"));
const H = "0x" + "a".repeat(64);
const zeroWork = { provider: 0, identity: 0, transaction: 0, client: 0, media: 0 };

test("authenticated immutable SQL and private target algorithms stay exact", () => {
  for (const name of ["publicOnlyPool", "readonly", "identities", "verifyIdentities", "selected", "sameSelection", "targetCatalog", "inspect", "reconcile"]) {
    assert.equal(current[name].toString(), previous[name].toString(), name);
  }
  assert.equal(TEMPLATE_SHA, "f606f0a85b4d59c7eb1084c2546daaed257e5fc56bdccb57c43e81e6beaf40c2");
  assert.equal(current.SOURCE, "e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234");
  assert.equal(current.FORMAT, "yunipals-arena-ypal-business-inverse-child-v1");
  assert.equal(current.scanner, undefined);
  assert.match(current.loadRuntime.toString(), /publicReadPoolClient\(readPoolFd,payload.readPoolIdentity\)/);
  assert(!current.loadRuntime.toString().includes("new pg.Pool(readonly"));
  assert.match(current.main.toString(), /loadRuntime\(payload,readFileSync\(cutoverFd\),readPoolFd,action\)/);
  const runtime = current.loadRuntime.toString();
  assert(runtime.indexOf('if(action==="reconcile")') < runtime.indexOf("const support=payload.support"));
});

test("source tamper refuses before any runtime construction", async () => {
  await assert.rejects(composition(Buffer.concat([raw, Buffer.from("\n")])));
});

test("each unresolved external-work class prevents switching or unhalt", async () => {
  assert.deepEqual(await externalWork({ query: async () => ({ rows: [{ value: zeroWork }] }) }, "fixture"), zeroWork);
  for (const key of Object.keys(zeroWork)) {
    await assert.rejects(externalWork({ query: async () => ({ rows: [{ value: { ...zeroWork, [key]: 1 } }] }) }, "fixture"), /outstanding_external_work/);
  }
  await assert.rejects(externalWork({ query: async () => ({ rows: [{ value: { ...zeroWork, extra: 0 } }] }) }, "fixture"));
});

function fixture() {
  const selection = { epoch: "old", kind: "unified", source_id: H };
  const calls = [];
  const db = {
    async query(text, args) {
      calls.push(text);
      if (text.startsWith("SELECT epoch")) return { rows: [selection] };
      if (text.startsWith("SELECT indexer_mode")) return { rows: [{ indexer_mode: "unified", halted: true }] };
      if (text.includes("tournament_identity")) return { rows: [{ id: "1", incarnation: H }] };
      if (text.includes("pg_current_xact_id")) return { rows: [{ xid: "123" }] };
      if (text.startsWith("UPDATE")) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
    release() {}
  };
  const runtime = {
    operational: { connect: async () => db },
    retainedLedger: async () => ({ verified: true }),
    externalWork: async () => zeroWork,
    source: { read: async () => ({ releaseId: H, indexedThroughBlock: "52648146" }) }
  };
  const payload = { expectedSelection: selection, floor: { block: "52648146", hash: H } };
  return { selection, calls, db, runtime, payload };
}

test("unhalt retains actual selector CAS, XID intent-before-COMMIT and new work fence", async () => {
  const value = fixture(); const emitted = [];
  await current.mutateMode(value.runtime, value.payload, false, (row) => { emitted.push(row); value.calls.push(row.phase); });
  assert(value.calls.indexOf("unhalt_commit_intent") < value.calls.indexOf("COMMIT"));
  assert.equal(emitted.at(-1).xid, "123");
  const blocked = fixture(); blocked.runtime.externalWork = async () => { throw Error("unresolved"); };
  await assert.rejects(current.mutateMode(blocked.runtime, blocked.payload, false, () => {}), /unresolved/);
  assert(!blocked.calls.includes("COMMIT")); assert(blocked.calls.includes("ROLLBACK"));
  const foreign = fixture();
  await assert.rejects(current.mutateMode(foreign.runtime, { ...foreign.payload, expectedSelection: { ...foreign.selection, epoch: "foreign" } }, false, () => {}));
  assert(!foreign.calls.includes("COMMIT"));
});

test("official switch is unchanged except complete external-work fence", async () => {
  const f = fixture(); const emitted = [];
  class Switch {
    constructor(service) { this.service = service; }
    async run(review) {
      const db = await this.service.pool.connect();
      try {
        await db.query("BEGIN"); await this.service.assertSourceSelection(db);
        if (!review) { await db.query("ROLLBACK"); return { applied: false, reviewHash: H }; }
        await db.query("UPDATE yunipals_arena.source_selection SET epoch=$2", [current.DEPLOYMENT, "next", "legacy_rollback", H, "52648146", H, H]);
        await db.query("COMMIT"); return { applied: true, epoch: "next" };
      } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
    }
  }
  f.runtime.ArenaSourceSwitch = Switch;
  await current.switchSource(f.runtime, { ...f.payload, targetKind: "legacy_rollback", applyHash: H }, (row) => { emitted.push(row); f.calls.push(row.phase); });
  assert(f.calls.indexOf("selection_commit_intent") < f.calls.lastIndexOf("COMMIT"));
  assert.equal(emitted.at(-1).phase, "selection_committed");
  const blocked = fixture(); blocked.runtime.ArenaSourceSwitch = Switch; blocked.runtime.externalWork = async () => { throw Error("unknown-paid-work"); };
  await assert.rejects(current.switchSource(blocked.runtime, { ...blocked.payload, targetKind: "legacy_rollback", applyHash: H }, () => {}), /unknown-paid-work/);
  assert(!blocked.calls.includes("COMMIT"));
});

const tables = ["submission", "fighter_snapshot", "frozen_input", "admission", "provider_task", "transaction_intent", "adjudication", "media_job", "identity_job", "provider_action_evidence", "media_publication"];
const body = {
  deployment: current.DEPLOYMENT, tournament_id: "1", seat: 0, incarnation: H, wallet: "private-wallet", commitment: H,
  signature: "private-signature", ciphertext: "private-ciphertext", nft_chain_id: 8453, collection: "collection", token_id: "1",
  snapshot: {}, snapshot_hash: H, input_hash: H, expiry: "1", ownership_block: "1", ownership_hash: H, request_id: "real-request-uuid",
  kind: "media", asset: "image", request: {}, reserved_microusd: "100", provider_id: "real-provider-id", action_id: "real-action-uuid",
  purpose: "settle", signer: "real-signer", nonce: "1", raw_transaction: "private-raw-transaction", tx_hash: H,
  outcome_hash: H, key: "real-identity-key", metadata: {}, profile_hash: H, evidence: {}, publication_hash: H, manifest: {}, source_evidence: {}
};

test("genuine eleven-table retained ledger preserves provider UUID/reservation and nonce/raw signed bytes", async () => {
  const rows = Object.fromEntries(tables.map((name) => [name, [{ ...body }]]));
  const db = { query: async (text) => ({ rows: rows[text.match(/FROM yunipals_arena\.([a-z_]+)/)[1]].map((body) => ({ body })) }) };
  const expected = await retainedLedger(db); assert.equal(Object.keys(expected).length, 11);
  assert.equal((await retainedLedger(db, expected)).verified, true);
  for (const [table, field] of [["provider_task", "provider_id"], ["provider_task", "request_id"], ["provider_task", "reserved_microusd"], ["identity_job", "reserved_microusd"], ["transaction_intent", "nonce"], ["transaction_intent", "raw_transaction"], ["transaction_intent", "tx_hash"], ["submission", "ciphertext"]]) {
    const prior = rows[table][0][field]; rows[table][0][field] = "tampered";
    await assert.rejects(retainedLedger(db, expected), /retained_uuid_ciphertext_signed_bytes_or_identity_changed/);
    rows[table][0][field] = prior;
  }
});
