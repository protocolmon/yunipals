// No database, network or process actions. Exercise the real readiness script's
// boundary and compare the candidate against the retained env-file inventory.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SyntheticModule, SourceTextModule, createContext } from "node:vm";
const base = new URL("./", import.meta.url);
const source = readFileSync(new URL("consumer-generation-v4-readiness.mjs", base), "utf8");
const unit = readFileSync(new URL("consumer-generation-v4-refresh.service.example", base), "utf8");
const root = "/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer";
const readIdentity = "0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d";
const selectors = { OWNERSHIP_READ_MODE: "unified", OWNERSHIP_READ_SCHEMA: "yunipals_ownership_35cdcb32_v4",
  READ_DATABASE_SCHEMA: "yunipals_ownership_35cdcb32_v4", OWNERSHIP_RELEASE_ID: "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c",
  YUNIPALS_PROJECTION_MODE: "generation", BASE_METADATA_INGESTION: "native", METADATA_SOURCE_MODE: "archive" };
async function run({ wrongSelector = false, blocked = false, capacityBlocked = false } = {}) {
  const calls = [], results = [], process = { env: { ...selectors }, exitCode: undefined };
  if (wrongSelector) process.env.OWNERSHIP_READ_SCHEMA = "legacy";
  const client = { query: async q => { calls.push(q); }, release: () => calls.push("release") };
  const pool = { connect: async () => client, end: async () => calls.push("close") };
  const exports = {
    [root + "/lib/offchain/db.ts"]: { pool },
    [root + "/lib/constants.ts"]: { collectionSlugs: ["ethereum", "base", "polygon", "bnb"] },
    [root + "/lib/ownership/readiness.ts"]: {
      assertOwnershipAvailable: async () => { calls.push("ownership"); if (blocked) throw Error("private upstream detail"); },
      ownershipReadIdentity: async () => ({ identity: readIdentity })
    },
    [root + "/lib/metadata/chain-readiness.ts"]: { assertChainReady: async () => calls.push("metadata") },
    [root + "/lib/metadata/projection-refresh.ts"]: { assertProjectionBuildCapacity: async () => { calls.push("capacity"); if (capacityBlocked) throw Error("private capacity detail"); } }
  };
  const context = createContext({ process, console: { log: value => results.push(JSON.parse(value)) } });
  const script = new SourceTextModule(source, { context, importModuleDynamically: async specifier => {
    assert.ok(exports[specifier], "only fixed official readiness modules can load");
    const values = exports[specifier];
    const mod = new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
    await mod.link(() => {}); await mod.evaluate(); return mod;
  } });
  await script.link(() => {}); await script.evaluate(); return { calls, results, process };
}
const ready = await run();
assert.deepEqual(ready.calls, ["BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1500ms'", "ownership", "metadata", "capacity", "ROLLBACK", "release", "close"]);
assert.equal(ready.results[0].ready, true);
const blocked = await run({ blocked: true }); assert.equal(blocked.results[0].ready, false); assert.equal(blocked.process.exitCode, 1);
assert.deepEqual(blocked.calls.slice(-3), ["ROLLBACK", "release", "close"]); assert.ok(!JSON.stringify(blocked.results).includes("private upstream"));
const capacityBlocked = await run({ capacityBlocked: true }); assert.equal(capacityBlocked.results[0].ready, false); assert.equal(capacityBlocked.process.exitCode, 1);
assert.deepEqual(capacityBlocked.calls.slice(-3), ["ROLLBACK", "release", "close"]); assert.ok(!JSON.stringify(capacityBlocked.results).includes("private capacity"));
const wrong = await run({ wrongSelector: true }); assert.deepEqual(wrong.calls, []); assert.equal(wrong.process.exitCode, 1);
const files = ["/opt/yunipals-unified/operations/free-replay-20261020/consumer-generation-v4-inline.env", "/etc/yunipals-indexer/indexer.env", "/etc/yunipals-marketplace/production/indexer-rpc.env", "/etc/yunipals-metadata-cutover.env", "/opt/yunipals-ops/query-capacity.env", "/var/backups/yunipals-metadata-readview-v4-candidates-v1-20261022/yunipals-leaderboard.selectors.env", "/opt/yunipals-unified/operations/free-replay-20261020/consumer-generation-v4-capacity.env"];
for (const line of unit.split("\n").filter(l => /^ExecStartPre/.test(l))) assert.deepEqual([...line.matchAll(/--env-file=(\S+)/g)].map(m => m[1]), files);
assert.match(unit, /ExecStart=.*\/consumer-generation-v4-capacity-watch\.py\n/);assert.match(unit, /RuntimeMaxSec=1500\n/);assert.match(unit, /Restart=no\n/);assert.ok(!unit.includes("[Install]"));
console.log(JSON.stringify({ passed: true, checks: 6, productionCalls: 0, databaseCalls: 0, providerCalls: 0 }));
