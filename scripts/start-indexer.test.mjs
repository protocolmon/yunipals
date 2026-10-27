import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadLaunchConfiguration } from "./start-indexer.mjs";

const launcher = fileURLToPath(new URL("./start-indexer.mjs", import.meta.url));
const tsx = await realpath(
  fileURLToPath(
    new URL("../apps/yunipals-indexer/node_modules/tsx", import.meta.url)
  )
);
const stub = `const fs = require("node:fs");
const record = event => fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({event,pid:process.pid,role:process.env.FIXTURE_ROLE,database:process.env.DATABASE_URL,provider:process.env.HELIUS_API_KEY,overlay:process.env.FIXTURE_OVERLAY,policy:process.env.UNIFIED_RPC_POLICY_REQUIRED,argv:process.argv.slice(2)})+"\\n");
record("started");
process.on("SIGTERM",()=>{if(process.env.FIXTURE_IGNORE_STOP==="true")return;record("stopped");process.exit(0)});
process.on("SIGINT",()=>{record("stopped");process.exit(0)});
setInterval(()=>{if(process.env.FIXTURE_FAIL==="true"&&fs.readFileSync(process.env.FIXTURE_LOG,"utf8").split("\\n").filter(Boolean).length>=2)process.exit(7)},20);`;

async function fixture(fail = false) {
  const root = await mkdtemp(join(tmpdir(), "yunipals-start-"));
  const ponder = join(root, "ponder"),
    solana = join(root, "solana");
  await mkdir(join(ponder, "node_modules/ponder/dist/esm/bin"), {
    recursive: true
  });
  await mkdir(join(solana, "lib/solana"), { recursive: true });
  await mkdir(join(solana, "node_modules"));
  await symlink(tsx, join(solana, "node_modules/tsx"));
  await writeFile(
    join(ponder, "node_modules/ponder/dist/esm/bin/ponder.js"),
    stub
  );
  await writeFile(join(solana, "lib/solana/worker.ts"), stub);
  const log = join(root, "events.jsonl");
  await writeFile(
    join(root, "ponder.env"),
    `FIXTURE_ROLE=ponder\nFIXTURE_FAIL=${fail}\nFIXTURE_LOG=${log}\nDATABASE_URL=fixture-evm-only\nFIXTURE_OVERLAY=base\n`
  );
  await writeFile(join(root, "runtime.env"), "FIXTURE_OVERLAY=runtime\n");
  await writeFile(join(root, "override.env"), "FIXTURE_OVERLAY=override\n");
  await writeFile(join(root, "replay.env"), "FIXTURE_OVERLAY=replay\n");
  await writeFile(
    join(root, "solana.env"),
    `FIXTURE_ROLE=solana\nFIXTURE_LOG=${log}\nDATABASE_URL=fixture-solana-only\nHELIUS_API_KEY=fixture-provider-only\n`
  );
  const file = join(root, "service.env");
  const publicSettings = `YUNIPALS_INDEXER_PONDER_DIRECTORY=./ponder\nYUNIPALS_INDEXER_SOLANA_DIRECTORY=./solana\nYUNIPALS_INDEXER_PONDER_ENV_FILE=./ponder.env\nYUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE=./runtime.env\nYUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE=./override.env\nYUNIPALS_INDEXER_PONDER_REPLAY_ENV_FILE=./replay.env\nYUNIPALS_INDEXER_SOLANA_ENV_FILE=./solana.env\nUNIFIED_SOLANA_ENABLED=true\nUNIFIED_PONDER_PORT=9028\nUNIFIED_PONDER_SCHEMA=fixture_schema\nUNIFIED_PONDER_HOSTNAME=127.0.0.1\n`;
  await writeFile(file, publicSettings);
  return { root, log, file, publicSettings };
}

async function records(log) {
  try {
    return (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

for (const action of ["SIGTERM", "SIGINT", "fatal-child", "shutdown-timeout"]) {
  test(`managed startup ${action} drains both sources and isolates child credentials`, async () => {
    const files = await fixture(action === "fatal-child");
    let child;
    let watchdog;
    try {
      if (action === "shutdown-timeout") {
        for (const name of ["ponder.env", "solana.env"]) {
          const path = join(files.root, name);
          await writeFile(
            path,
            `${await readFile(path, "utf8")}FIXTURE_IGNORE_STOP=true\n`
          );
        }
        await writeFile(
          files.file,
          `${files.publicSettings}YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS=100\n`
        );
      }
      child = spawn(process.execPath, [launcher, `--env-file=${files.file}`], {
        cwd: tmpdir(),
        env: {
          ...process.env,
          DATABASE_URL: "ambient-must-not-win",
          HELIUS_API_KEY: "ambient-must-not-leak",
          FIXTURE_OVERLAY: "ambient-must-not-win"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let errors = "";
      child.stderr.on("data", (data) => {
        errors += data;
      });
      const exited = once(child, "exit");
      watchdog = setTimeout(() => child.kill("SIGKILL"), 12000);
      if (action !== "fatal-child") {
        for (let i = 0; i < 300 && (await records(files.log)).length < 2; i++)
          await delay(20);
        assert.equal((await records(files.log)).length, 2, errors);
        child.kill(action === "shutdown-timeout" ? "SIGTERM" : action);
      }
      const [code, signal] = await exited;
      assert.equal(signal, null, errors);
      assert.equal(
        code,
        action === "fatal-child"
          ? 7
          : action === "SIGINT"
            ? 130
            : action === "shutdown-timeout"
              ? 1
              : 0,
        errors
      );
      const rows = await records(files.log);
      const starts = rows.filter((row) => row.event === "started");
      assert.equal(starts.length, 2);
      const evm = starts.find((row) => row.role === "ponder");
      const solana = starts.find((row) => row.role === "solana");
      assert.equal(evm.database, "fixture-evm-only");
      assert.equal(evm.provider, undefined);
      assert.equal(evm.overlay, "replay");
      assert.equal(evm.policy, "true");
      assert.equal(solana.database, "fixture-solana-only");
      assert.equal(solana.provider, "fixture-provider-only");
      assert.equal(solana.overlay, undefined);
      assert.deepEqual(evm.argv, [
        "start",
        "--port",
        "9028",
        "--schema",
        "fixture_schema",
        "--hostname",
        "127.0.0.1"
      ]);
      assert.equal(
        rows.filter((row) => row.event === "stopped").length,
        action === "fatal-child" ? 1 : action === "shutdown-timeout" ? 0 : 2
      );
      for (const row of starts) assert.throws(() => process.kill(row.pid, 0));
    } finally {
      clearTimeout(watchdog);
      if (child?.exitCode === null && child?.signalCode === null)
        child.kill("SIGKILL");
      await rm(files.root, { recursive: true, force: true });
    }
  });
}

test("service settings reject credentials, disabled Solana, aliases and missing child files before startup", async () => {
  const files = await fixture();
  try {
    for (const addition of [
      "DATABASE_URL=private",
      "HELIUS_API_KEY=private",
      "NODE_OPTIONS=--inspect",
      "UNIFIED_SOLANA_ENABLED=false",
      "UNIFIED_PONDER_PORT=0",
      "UNIFIED_PONDER_PORT=65536",
      "YUNIPALS_INDEXER_SOLANA_ENV_FILE=./ponder.env",
      "YUNIPALS_INDEXER_PONDER_ENV_FILE=./missing.env"
    ]) {
      await writeFile(files.file, `${files.publicSettings}${addition}\n`);
      await assert.rejects(loadLaunchConfiguration(files.file));
    }
    await writeFile(files.file, files.publicSettings);
    const config = await loadLaunchConfiguration(files.file);
    assert.equal(config.env.NODE_OPTIONS, undefined);
    assert.equal(config.env.DATABASE_URL, undefined);
    assert.equal(config.env.HELIUS_API_KEY, undefined);
    assert.equal(config.env.YUNIPALS_INDEXER_NODE, process.execPath);
    assert.equal(
      config.env.YUNIPALS_INDEXER_PONDER_DIRECTORY,
      join(files.root, "ponder")
    );
    assert.deepEqual(await records(files.log), []);
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});
