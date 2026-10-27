import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  childDefinitions,
  launchConfiguration,
  runManagedIndexer
} from "./launcher.mjs";

assert.equal(process.versions.node, "24.18.1");
const launcher = fileURLToPath(new URL("./launcher.mjs", import.meta.url));
const fixture = `
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {getHeapStatistics} from 'node:v8';
const record=(event,extra={})=>fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({
 event,role:process.env.FIXTURE_ROLE,pid:process.pid,cwd:process.cwd(),...extra})+'\\n');
record('started',{args:process.argv.slice(2),marker:process.env.MARKER,db:process.env.DATABASE_URL,
 onlyEvm:process.env.EVM_PRIVATE_ONLY??null,onlySolana:process.env.SOLANA_PRIVATE_ONLY??null,
 runtimeSetting:process.env.RUNTIME_SETTING??null,profile:process.env.RPC_PROFILE??null,
 parentLeak:process.env.LEAK_FROM_PARENT??null,permit:process.env.UNIFIED_RPC_REPLAY_PERMIT_ID??null,
 heap:getHeapStatistics().heap_size_limit});
if(process.env.FIXTURE_DESCENDANT==='yes'){
 spawn(process.execPath,['-e',\`const fs=require('node:fs');fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({event:'descendant',pid:process.pid,role:'compiler'})+'\\\\n');process.on('SIGTERM',()=>{});setInterval(()=>{},500);\`],{stdio:'ignore',env:{FIXTURE_LOG:process.env.FIXTURE_LOG}});
}
process.on('SIGTERM',()=>{record('term');if(process.env.FIXTURE_IGNORE_TERM!=='yes')process.exit(0)});
setInterval(()=>{if(process.env.FIXTURE_EXIT!==undefined&&fs.existsSync(process.env.FIXTURE_TRIGGER)){record('fatal');process.exit(Number(process.env.FIXTURE_EXIT))}},10);
`;

async function until(read, predicate, message) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    assert(Date.now() < deadline, message);
    await delay(20);
  }
}

function live(pid) {
  return readFile(`/proc/${pid}/stat`, "utf8")
    .then(
      (value) =>
        !["Z", "X"].includes(
          value.slice(value.lastIndexOf(")") + 2).split(" ")[0]
        )
    )
    .catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
}

async function sandbox(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "yunipals-ypal-managed-"));
  const evm = join(directory, "evm");
  const solana = join(directory, "solana");
  const log = join(directory, "events.jsonl");
  const trigger = join(directory, "trigger");
  const files = ["retained", "runtime", "ypal", "solana"].map((name) =>
    join(directory, `${name}.env`)
  );
  for (const cwd of [evm, solana]) {
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "package.json"), '{"type":"module"}');
  }
  await mkdir(join(evm, "node_modules/ponder/dist/esm/bin"), {
    recursive: true
  });
  await writeFile(
    join(evm, "node_modules/ponder/dist/esm/bin/ponder.js"),
    fixture
  );
  await mkdir(join(solana, "lib/solana"), { recursive: true });
  await writeFile(join(solana, "lib/solana/worker.ts"), fixture);
  await mkdir(join(solana, "node_modules/tsx"), { recursive: true });
  await writeFile(
    join(solana, "node_modules/tsx/package.json"),
    '{"type":"module","exports":"./index.mjs"}'
  );
  await writeFile(
    join(solana, "node_modules/tsx/index.mjs"),
    "// Isolated fixture; no real worker loader.\n"
  );
  const extras = (role) =>
    `FIXTURE_LOG=${log}\nFIXTURE_TRIGGER=${trigger}\nFIXTURE_ROLE=${role}\n` +
    (options.failRole === role ? `FIXTURE_EXIT=${options.exitCode}\n` : "") +
    (options.ignoreTerm === role ? "FIXTURE_IGNORE_TERM=yes\n" : "") +
    (options.descendant && role === "evm" ? "FIXTURE_DESCENDANT=yes\n" : "");
  const values = [
    extras("evm") +
      "MARKER=retained\nDATABASE_URL=fake-evm-only\nEVM_PRIVATE_ONLY=fixture\n",
    "MARKER=runtime\nRUNTIME_SETTING=retained-runtime\nRPC_PROFILE=old\n",
    "MARKER=ypal\nRPC_PROFILE=combined-ypal\n",
    extras("solana") +
      "MARKER=solana\nDATABASE_URL=fake-solana-only\nSOLANA_PRIVATE_ONLY=fixture\nHELIUS_API_KEY=fake-fixture\n"
  ];
  for (let index = 0; index < files.length; index++) {
    await writeFile(files[index], values[index], { mode: 0o600 });
  }
  const env = {
    PATH: "/usr/bin:/bin",
    UNIFIED_SOLANA_ENABLED: "true",
    UNIFIED_PONDER_SCHEMA: "unified_ypal_20261023_v1",
    UNIFIED_PONDER_HOSTNAME: "127.0.0.1",
    UNIFIED_PONDER_PORT: "9028",
    YUNIPALS_INDEXER_PONDER_DIRECTORY: evm,
    YUNIPALS_INDEXER_SOLANA_DIRECTORY: solana,
    YUNIPALS_INDEXER_PONDER_ENV_FILE: files[0],
    YUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE: files[1],
    YUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE: files[2],
    YUNIPALS_INDEXER_SOLANA_ENV_FILE: files[3],
    YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS: "150",
    LEAK_FROM_PARENT: "must-not-reach-children",
    UNIFIED_RPC_REPLAY_PERMIT_ID: "fake-parent-permit"
  };
  const records = async () => {
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
  return { directory, evm, solana, files, env, records, trigger };
}

async function exercise(options, verify) {
  const state = await sandbox(options);
  let child;
  let timer;
  try {
    child = spawn(process.execPath, [launcher], {
      env: { ...state.env, ...options.environment },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const exit = new Promise((done) =>
      child.once("close", (code, signal) => done({ code, signal }))
    );
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("managed lifecycle deadline")),
        10000
      );
    });
    if (!options.invalid) {
      await until(
        state.records,
        (rows) =>
          rows.filter((row) => row.event === "started").length === 2 &&
          (!options.descendant ||
            rows.some((row) => row.event === "descendant")),
        "both source children must start"
      );
      if (options.failRole) await writeFile(state.trigger, "owned trigger");
      else child.kill(options.signal ?? "SIGTERM");
    }
    const result = await Promise.race([exit, timeout]);
    const rows = await state.records();
    await verify({ ...state, result, rows, stderr });
    for (const row of rows.filter((row) =>
      ["started", "descendant"].includes(row.event)
    )) {
      await until(
        () => live(row.pid),
        (value) => !value,
        "owned source descendant still alive"
      );
    }
  } finally {
    clearTimeout(timer);
    if (child?.exitCode === null && !child.signalCode) {
      child.kill("SIGTERM");
      await delay(250);
      child.kill("SIGKILL");
    }
    for (const row of await state.records()) {
      if (row.pid && (await live(row.pid))) {
        try {
          process.kill(row.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    await rm(state.directory, { recursive: true, force: true });
  }
}

test("actual children preserve three-file precedence, separate credentials, cwd, native args and heap", async () => {
  await exercise({}, ({ result, rows, stderr, evm, solana }) => {
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(stderr, "");
    const sources = rows.filter((row) => row.event === "started");
    const e = sources.find((row) => row.role === "evm");
    const s = sources.find((row) => row.role === "solana");
    assert.equal(e.cwd, evm);
    assert.equal(s.cwd, solana);
    assert.equal(e.marker, "ypal");
    assert.equal(e.profile, "combined-ypal");
    assert.equal(e.runtimeSetting, "retained-runtime");
    assert.equal(e.db, "fake-evm-only");
    assert.equal(e.onlySolana, null);
    assert.equal(s.db, "fake-solana-only");
    assert.equal(s.onlyEvm, null);
    assert.equal(s.profile, null);
    assert.deepEqual(e.args, [
      "start",
      "--schema",
      "unified_ypal_20261023_v1",
      "--hostname",
      "127.0.0.1",
      "--port",
      "9028"
    ]);
    for (const source of sources) {
      assert.equal(source.parentLeak, null);
      assert.equal(source.permit, null);
      assert(source.heap >= 4 * 1024 ** 3 && source.heap < 5 * 1024 ** 3);
      assert(
        rows.some((row) => row.event === "term" && row.pid === source.pid)
      );
    }
  });
});

for (const [role, code] of [
  ["evm", 12],
  ["solana", 75],
  ["evm", 0]
]) {
  test(`unexpected ${role} exit ${code} stops its sibling and preserves failure status`, async () => {
    await exercise({ failRole: role, exitCode: code }, ({ result, rows }) => {
      assert.deepEqual(result, { code: code || 1, signal: null });
      assert(rows.some((row) => row.event === "fatal" && row.role === role));
      assert(rows.some((row) => row.event === "term" && row.role !== role));
    });
  });
}

test("SIGINT is explicit cancellation and reaps both sources", async () => {
  await exercise({ signal: "SIGINT" }, ({ result }) =>
    assert.deepEqual(result, { code: 130, signal: null })
  );
});

test("bounded shutdown kills an unresponsive source and its compiler descendant", async () => {
  await exercise(
    { ignoreTerm: "evm", descendant: true },
    ({ result, rows }) => {
      assert.deepEqual(result, { code: 0, signal: null });
      assert(rows.some((row) => row.event === "descendant"));
    }
  );
});

test("an exiting leader cannot leave an unresponsive compiler behind", async () => {
  await exercise({ descendant: true }, ({ result }) =>
    assert.deepEqual(result, { code: 0, signal: null })
  );
});

for (const [name, environment] of [
  [
    "parent credentials",
    { DATABASE_URL: "fake-parent-secret-must-not-be-printed" }
  ],
  ["Solana disabled", { UNIFIED_SOLANA_ENABLED: "false" }],
  [
    "old native schema",
    { UNIFIED_PONDER_SCHEMA: "unified_shadow_20261020_7e7375b0" }
  ],
  [
    "missing private file",
    { YUNIPALS_INDEXER_SOLANA_ENV_FILE: "/does-not-exist/solana.env" }
  ]
]) {
  test(`${name} fails before either source starts without disclosing inputs`, async () => {
    await exercise(
      { invalid: true, environment },
      ({ result, rows, stderr }) => {
        assert.deepEqual(result, { code: 1, signal: null });
        assert.equal(rows.length, 0);
        assert.equal(
          stderr,
          "Managed indexer configuration or startup failed.\n"
        );
      }
    );
  });
}

test("configuration rejects shared private files and unbounded shutdown", async () => {
  const state = await sandbox();
  try {
    assert.throws(
      () =>
        launchConfiguration({
          ...state.env,
          YUNIPALS_INDEXER_SOLANA_ENV_FILE: state.files[0]
        }),
      /separate_solana/
    );
    const planned = childDefinitions(launchConfiguration(state.env));
    assert.equal(planned.length, 2);
    assert.equal(planned[0].executable, process.execPath);
    for (const graceMilliseconds of [0, 30001]) {
      await assert.rejects(
        runManagedIndexer(launchConfiguration(state.env), {
          graceMilliseconds
        }),
        /bounded_shutdown_grace_required/
      );
    }
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});
