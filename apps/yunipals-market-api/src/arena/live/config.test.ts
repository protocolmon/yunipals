import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readPrivateFile } from "./config";

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
