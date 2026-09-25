import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Explicit opt-in for a configured disposable preview, never production.
export async function createStagingControl({ pool, fork, appUrl, rpcUrl }) {
  assert.equal(process.env.MARKET_TEST_STAGING_REMOTE, "1");
  assert.notEqual(process.env.MARKET_TEST_RESTORE, "1");
  const knownHosts = process.env.MARKET_TEST_STAGING_KNOWN_HOSTS;
  assert.ok(knownHosts && isAbsolute(knownHosts));
  const sshTarget = process.env.MARKET_TEST_STAGING_SSH_TARGET;
  const controllerPath = process.env.MARKET_TEST_STAGING_CONTROLLER_PATH;
  assert.ok(
    sshTarget && /^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/.test(sshTarget),
    "Set MARKET_TEST_STAGING_SSH_TARGET to user@host for an isolated preview."
  );
  assert.ok(
    controllerPath && /^\/[A-Za-z0-9_./-]+$/.test(controllerPath),
    "Set MARKET_TEST_STAGING_CONTROLLER_PATH to the preview controller's absolute path."
  );
  const command = async (action, name = "server", mode = "disabled") => {
    assert.ok(["inspect", "start", "stop"].includes(action));
    assert.ok(["server", "worker"].includes(name));
    assert.ok(["enabled", "disabled"].includes(mode));
    try {
      const result = await exec(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          `UserKnownHostsFile=${knownHosts}`,
          sshTarget,
          "python3",
          controllerPath,
          action,
          name,
          mode
        ],
        { timeout: 45000, maxBuffer: 65536 }
      );
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(
        `Remote isolated preview ${action} failed; inspect its private service logs.`
      );
    }
  };
  const identity = await command("inspect");
  assert.equal(identity.status, "isolated_preview");
  assert.equal(identity.forkInstanceId, fork.instanceId);
  assert.equal(identity.rpcUrl, rpcUrl);
  assert.equal(identity.appUrl, appUrl);
  assert.equal(identity.revision, process.env.MARKET_TEST_STAGING_REVISION);
  assert.equal(
    (
      await pool.query(
        "SELECT current_setting('yunipals.preview_id',true) AS id"
      )
    ).rows[0].id,
    identity.previewId,
    "SSH database tunnel must reach the installed disposable preview"
  );
  const page = await fetch(appUrl);
  assert.equal(page.status, 200);
  assert.equal(
    page.headers.get("x-yunipals-preview-revision"),
    identity.revision
  );
  return {
    identity,
    async start(name, trading) {
      await command("start", name, trading ? "enabled" : "disabled");
    },
    async stop(name) {
      await command("stop", name);
    }
  };
}
