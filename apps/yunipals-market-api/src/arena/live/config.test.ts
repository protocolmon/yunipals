import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { arenaConfig, readPrivateFile } from "./config";

test("anime entry follows NFT approval without a wallet pilot list", () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-entry-policy-"));
  const keyFile = join(directory, "fixture.key");
  try {
    writeFileSync(keyFile, "a".repeat(64), { mode: 0o600 });
    const env = {
      ARENA_CONTRACT: `0x${"1".repeat(40)}`,
      ARENA_DEPLOYMENT_BLOCK: "1",
      ARENA_ENCRYPTION_KEY_FILE: keyFile,
      ARENA_RULES_HASH: `0x${"2".repeat(64)}`,
      ARENA_DATABASE_URL: "postgres://localhost/arena_test",
      ARENA_MEDIA_KIND: "anime",
      ARENA_INDEXER_MODE: "unified",
      ARENA_ELIGIBILITY_REGISTRY: `0x${"3".repeat(40)}`,
      ARENA_ENTRIES_ENABLED: "true"
    };
    for (const mode of [undefined, "pilot", "public"]) {
      const config = arenaConfig({ ...env, ARENA_LAUNCH_MODE: mode });
      assert.equal(config.launchMode, "public");
      assert.deepEqual(config.pilotWallets, []);
      assert.equal(config.entriesEnabled, true);
      assert.equal(config.eligibilityRegistry, env.ARENA_ELIGIBILITY_REGISTRY);
    }
    const previousPilot = arenaConfig({
      ...env,
      ARENA_LAUNCH_MODE: "pilot",
      ARENA_PILOT_WALLETS: `0x${"4".repeat(40)}`
    });
    assert.equal(previousPilot.launchMode, "public");
    assert.deepEqual(previousPilot.pilotWallets, []);
    assert.equal(
      arenaConfig({ ...env, ARENA_ENTRIES_ENABLED: "false" }).entriesEnabled,
      false
    );
    assert.throws(
      () => arenaConfig({ ...env, ARENA_ELIGIBILITY_REGISTRY: undefined }),
      /requires an eligibility registry/
    );

    const video = {
      ...env,
      ARENA_MEDIA_KIND: "video",
      ARENA_ELIGIBILITY_REGISTRY: undefined
    };
    assert.throws(() => arenaConfig(video), /requires explicit pilot wallets/);
    const pilot = arenaConfig({
      ...video,
      ARENA_PILOT_WALLETS: `0x${"4".repeat(40)}`
    });
    assert.equal(pilot.launchMode, "pilot");
    assert.deepEqual(pilot.pilotWallets, [`0x${"4".repeat(40)}`]);
    assert.equal(
      arenaConfig({ ...video, ARENA_LAUNCH_MODE: "public" }).launchMode,
      "public"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ordinary secret files cannot gain systemd's group-read exception", () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-credential-policy-"));
  const path = join(directory, "fixture.key");
  const previous = process.env.CREDENTIALS_DIRECTORY;
  try {
    writeFileSync(path, "test-only-value\n", { mode: 0o600 });
    assert.equal(readPrivateFile(path), "test-only-value");
    chmodSync(path, 0o400);
    assert.equal(readPrivateFile(path), "test-only-value");
    chmodSync(path, 0o440);
    delete process.env.CREDENTIALS_DIRECTORY;
    assert.throws(() => readPrivateFile(path), /owner-only/);
    process.env.CREDENTIALS_DIRECTORY = directory;
    assert.throws(() => readPrivateFile(path), /owner-only/);
    chmodSync(path, 0o644);
    assert.throws(() => readPrivateFile(path), /owner-only/);
  } finally {
    if (previous === undefined) delete process.env.CREDENTIALS_DIRECTORY;
    else process.env.CREDENTIALS_DIRECTORY = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
