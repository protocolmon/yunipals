import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadLiveArenaCatalog } from "../../apps/yunipals-market-api/src/arena/live/catalog";
import { canonicalJson } from "../../apps/yunipals-market-api/src/arena/draw";
import { arenaConfig } from "../../apps/yunipals-market-api/src/arena/live/config";
import { arenaOpenaiFundingMode } from "../../apps/yunipals-market-api/src/arena/live/funding";
import {
  assertNoRemoteIo,
  contract,
  productionRulesHash,
  wallet
} from "./fixtures";

assertNoRemoteIo();
const root = fileURLToPath(new URL("../../", import.meta.url));
const digest = (value: unknown) =>
  `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

test("live rules are recomputed from the actual public catalog and equal the deployed production policy", () => {
  const published = JSON.parse(
    readFileSync(
      join(root, "docs/arena/mainnet-rules-manifest-v1.json"),
      "utf8"
    )
  );
  const actual = loadLiveArenaCatalog(root);
  assert.equal(actual.rulesHash, productionRulesHash);
  assert.equal(digest(actual.manifest), productionRulesHash);
  assert.equal(published.rulesHash, productionRulesHash);
  assert.deepEqual(actual.manifest, published.manifest);
  assert.equal(actual.islands.length, 898);
  assert.equal(
    actual.pool.sha256,
    "9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c"
  );
});

test("the rules hash follows a real dynamic validator input rather than a hardcoded production constant", (t) => {
  const overlay = mkdtempSync(join(tmpdir(), "arena-live-policy-overlay-"));
  t.after(() => rmSync(overlay, { recursive: true, force: true }));
  symlinkSync(join(root, "docs"), join(overlay, "docs"), "dir");
  mkdirSync(join(overlay, "scripts/arena"), { recursive: true });
  writeFileSync(
    join(overlay, "scripts/arena/referee.py"),
    readFileSync(join(root, "scripts/arena/referee.py"), "utf8") +
      "\n# acceptance-only changed public validator\n"
  );
  const actual = loadLiveArenaCatalog(overlay);
  assert.notEqual(actual.rulesHash, productionRulesHash);
  assert.equal(actual.rulesHash, digest(actual.manifest));
  assert.notEqual(
    actual.manifest.validatorSha256,
    loadLiveArenaCatalog(root).manifest.validatorSha256
  );
});

test("production configuration retains public and pilot modes with explicit funding selection", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "arena-config-acceptance-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = join(directory, "synthetic-encryption.key");
  writeFileSync(key, "12".repeat(32), { mode: 0o600 });
  chmodSync(key, 0o600);
  const base: NodeJS.ProcessEnv = {
    ARENA_CONTRACT: contract,
    ARENA_DEPLOYMENT_BLOCK: "52648146",
    ARENA_ENCRYPTION_KEY_FILE: key,
    ARENA_DATABASE_URL: "postgres://synthetic.invalid/offline",
    ARENA_RULES_HASH: productionRulesHash,
    ARENA_ENTRIES_ENABLED: "true",
    ARENA_LAUNCH_MODE: "public",
    ARENA_OPENAI_FUNDING_MODE: "ongoing",
    ARENA_INDEXER_INTERNAL_URL: "http://127.0.0.1:9011"
  };
  const publicMode = arenaConfig(base);
  assert.equal(publicMode.launchMode, "public");
  assert.equal(publicMode.entriesEnabled, true);
  assert.equal(publicMode.openaiFundingMode, "ongoing");
  assert.equal(publicMode.indexerUrl, "http://127.0.0.1:9011");
  assert.deepEqual(publicMode.pilotWallets, []);
  assert.throws(
    () => arenaConfig({ ...base, ARENA_LAUNCH_MODE: "pilot" }),
    /pilot wallets/
  );
  const pilot = arenaConfig({
    ...base,
    ARENA_LAUNCH_MODE: "pilot",
    ARENA_PILOT_WALLETS: wallet,
    ARENA_OPENAI_FUNDING_MODE: "capped"
  });
  assert.equal(pilot.launchMode, "pilot");
  assert.deepEqual(pilot.pilotWallets, [wallet]);
  assert.equal(pilot.openaiFundingMode, "capped");
  assert.throws(
    () => arenaConfig({ ...base, ARENA_LAUNCH_MODE: "unexpected" }),
    /launch mode/
  );
  assert.throws(
    () => arenaConfig({ ...base, ARENA_PILOT_WALLETS: "not-a-wallet" }),
    /pilot wallets/
  );
  assert.equal(arenaOpenaiFundingMode({}), "capped");
  assert.throws(
    () => arenaOpenaiFundingMode({ ARENA_OPENAI_FUNDING_MODE: "unbounded" }),
    /funding mode/
  );
});
