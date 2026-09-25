import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const env = {
  ...process.env,
  MARKET_DEPLOYMENT: "staging",
  MARKET_HOST: "127.0.0.1",
  MARKET_PORT: "19012",
  MARKET_ALLOWED_ORIGINS: "http://127.0.0.1:5177",
  MARKET_DATABASE_URL:
    "postgresql://market_test_runtime:local-runtime-test-only@127.0.0.1:55436/yunipals_market_test"
};
delete env.NODE_TEST_CONTEXT;
delete env.MARKET_BNB_VALIDATION_RPC;
const child = spawn(process.execPath, ["dist/server.mjs"], {
  env,
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const closed = once(child, "close");
const deadline = setTimeout(() => child.kill("SIGKILL"), 20000);
try {
  let response;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`API exited during startup: ${output}`);
    try {
      response = await fetch("http://127.0.0.1:19012/health/ready", {
        signal: AbortSignal.timeout(500)
      });
      break;
    } catch {
      await delay(100);
    }
  }
  assert.equal(response?.status, 200, output);
  assert.deepEqual(await response.json(), { status: "ready" });
  const capabilities = await (
    await fetch("http://127.0.0.1:19012/v1/market/capabilities")
  ).json();
  assert.equal(
    Object.values(capabilities.chains).flatMap(Object.values).some(Boolean),
    false
  );
  assert.equal(
    (
      await fetch("http://127.0.0.1:19012/v1/market/orders", {
        method: "POST",
        body: "{}"
      })
    ).status,
    503
  );
  child.kill("SIGTERM");
  const [code, signal] = await closed;
  assert.equal(signal, null);
  assert.equal(code, 0, output);
  console.log(
    JSON.stringify({
      status: "passed",
      builtApi: true,
      restrictedRole: true,
      allActionsDisabled: true,
      gracefulShutdown: true
    })
  );
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null) child.kill("SIGKILL");
}
