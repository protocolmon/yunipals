import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  realpath,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const launcher = fileURLToPath(
  new URL("../../../ops/unified-indexer/run-indexer.sh", import.meta.url)
);
const loader = await realpath(
  fileURLToPath(new URL("../node_modules/tsx", import.meta.url))
);
const stub = `const fs = require('node:fs');
const log = event => fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({event,role:process.env.FIXTURE_ROLE,pid:process.pid,argv:process.argv.slice(2)})+'\\n');
log('started');
process.on('SIGTERM',()=>{log('stopped');process.exit(0);});
setInterval(()=>{
  if(process.env.FIXTURE_FAIL==='true'&&fs.readFileSync(process.env.FIXTURE_LOG,'utf8').split('\\n').filter(Boolean).map(JSON.parse).filter(row=>row.event==='started').length===2)process.exit(7);
},20);`;

async function exercise(fail, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "yunipals-unified-service-"));
  const log = join(root, "events.jsonl");
  let child;
  let timer;
  try {
    await mkdir(join(root, "node_modules/ponder/dist/esm/bin"), {
      recursive: true
    });
    await mkdir(join(root, "lib/solana"), { recursive: true });
    await writeFile(
      join(root, "node_modules/ponder/dist/esm/bin/ponder.js"),
      stub
    );
    await writeFile(join(root, "lib/solana/worker.ts"), stub);
    await symlink(loader, join(root, "node_modules/tsx"));
    const ponderEnv = join(root, "ponder.env"),
      solanaEnv = join(root, "solana.env");
    await writeFile(
      ponderEnv,
      `FIXTURE_ROLE=ponder\nFIXTURE_FAIL=${fail}\nFIXTURE_LOG=${log}\n`,
      { mode: 0o600 }
    );
    await writeFile(solanaEnv, `FIXTURE_ROLE=solana\nFIXTURE_LOG=${log}\n`, {
      mode: 0o600
    });
    const env = {
      ...process.env,
      YUNIPALS_INDEXER_NODE: process.execPath,
      YUNIPALS_INDEXER_PONDER_ENV_FILE: ponderEnv,
      YUNIPALS_INDEXER_SOLANA_ENV_FILE: solanaEnv,
      UNIFIED_SOLANA_ENABLED: "true"
    };
    for (const name of [
      "DATABASE_URL",
      "DATABASE_PRIVATE_URL",
      "HELIUS_API_KEY",
      "UNIFIED_PONDER_PORT",
      "UNIFIED_PONDER_SCHEMA",
      "UNIFIED_PONDER_HOSTNAME"
    ])
      delete env[name];
    Object.assign(env, options);
    child = spawn("bash", [launcher], {
      cwd: root,
      env,
      stdio: ["ignore", "ignore", "pipe"],
      detached: true
    });
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const exited = once(child, "exit");
    timer = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 8000);
    const events = async () => {
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
    };
    if (!fail) {
      for (
        let tries = 0;
        tries < 200 &&
        (await events()).filter((row) => row.event === "started").length < 2;
        tries++
      )
        await delay(20);
      assert.equal(
        (await events()).filter((row) => row.event === "started").length,
        2,
        errors
      );
      child.kill("SIGTERM");
    }
    const [code, signal] = await exited;
    assert.equal(signal, null, errors);
    const recorded = await events();
    if (fail === "invalid") {
      assert.equal(code, 1, errors);
      assert.deepEqual(recorded, [], errors);
      assert.match(
        errors,
        /Invalid UNIFIED_PONDER_SCHEMA|UNIFIED_PONDER_HOSTNAME must be loopback/
      );
      return;
    }
    assert.equal(code, fail ? 7 : 0, errors);
    assert.deepEqual(
      recorded
        .filter((row) => row.event === "started")
        .map((row) => row.role)
        .sort(),
      ["ponder", "solana"]
    );
    const ponder = recorded.find(
      (row) => row.event === "started" && row.role === "ponder"
    );
    const expected = ["start", "--port", options.UNIFIED_PONDER_PORT ?? "9010"];
    if (options.UNIFIED_PONDER_SCHEMA)
      expected.push("--schema", options.UNIFIED_PONDER_SCHEMA);
    if (options.UNIFIED_PONDER_HOSTNAME)
      expected.push("--hostname", options.UNIFIED_PONDER_HOSTNAME);
    assert.deepEqual(ponder.argv, expected);
    assert.deepEqual(
      recorded.find((row) => row.event === "started" && row.role === "solana")
        .argv,
      []
    );
    assert.deepEqual(
      recorded
        .filter((row) => row.event === "stopped")
        .map((row) => row.role)
        .sort(),
      fail ? ["solana"] : ["ponder", "solana"]
    );
    for (const event of recorded.filter((row) => row.event === "started"))
      assert.throws(() => process.kill(event.pid, 0));
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null)
      process.kill(-child.pid, "SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
}
await exercise(true);
await exercise(false);
await exercise(false, {
  UNIFIED_PONDER_PORT: "9024",
  UNIFIED_PONDER_SCHEMA: "unified_shadow_20261020_7e7375b0",
  UNIFIED_PONDER_HOSTNAME: "127.0.0.1"
});
await exercise("invalid", { UNIFIED_PONDER_SCHEMA: "" });
await exercise("invalid", { UNIFIED_PONDER_SCHEMA: "invalid schema" });
await exercise("invalid", { UNIFIED_PONDER_SCHEMA: "ponder_sync" });
await exercise("invalid", { UNIFIED_PONDER_SCHEMA: "x".repeat(46) });
await exercise("invalid", { UNIFIED_PONDER_HOSTNAME: "0.0.0.0" });
console.log(
  JSON.stringify({
    event: "unified_service_supervision_verified",
    checks: [
      "fatal child exit stops its sibling",
      "SIGTERM drains both adapters",
      "no child process left running",
      "default Ponder CLI unchanged",
      "selected schema and loopback passed only to Ponder",
      "invalid explicit settings start neither child"
    ]
  })
);
