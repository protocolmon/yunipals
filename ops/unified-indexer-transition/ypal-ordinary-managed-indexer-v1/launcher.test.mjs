import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  childDefinitions,
  launchConfiguration,
  ordinaryEnvironment,
  runManagedIndexer
} from "./launcher.mjs";

const publicEnvironment = Object.fromEntries(
  (await readFile(new URL("./service.public.env", import.meta.url), "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split(/=(.*)/s).slice(0, 2))
);

test("the lifecycle core is exactly the reviewed d3 source", async () => {
  const raw = await readFile(new URL("./core.mjs", import.meta.url));
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "d3e849e2f05a7c33c7164d649c6f1db28f6a70202b3308dada3989be634bc321"
  );
});

test("actual public settings append only the fourth EVM file", () => {
  const configuration = launchConfiguration(publicEnvironment);
  const [evm, solana] = childDefinitions(configuration, "/node");
  assert.deepEqual(configuration.evmEnvironment, [
    publicEnvironment.YUNIPALS_INDEXER_PONDER_ENV_FILE,
    publicEnvironment.YUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE,
    publicEnvironment.YUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE,
    ordinaryEnvironment
  ]);
  assert.deepEqual(
    evm.args.filter((arg) => arg.startsWith("--env-file=")),
    configuration.evmEnvironment.map((path) => `--env-file=${path}`)
  );
  assert.equal(
    solana.args.filter((arg) => arg.startsWith("--env-file=")).length,
    1
  );
  assert(!solana.args.includes(`--env-file=${ordinaryEnvironment}`));
  assert.equal(solana.cwd, publicEnvironment.YUNIPALS_INDEXER_SOLANA_DIRECTORY);
});

test("missing, foreign and duplicate permit paths refuse", () => {
  for (const value of [
    undefined,
    "/foreign.env",
    `${ordinaryEnvironment}/..`
  ]) {
    assert.throws(() =>
      launchConfiguration({
        ...publicEnvironment,
        YUNIPALS_INDEXER_PONDER_REPLAY_ENV_FILE: value
      })
    );
  }
  assert.throws(() =>
    launchConfiguration({
      ...publicEnvironment,
      YUNIPALS_INDEXER_SOLANA_ENV_FILE: ordinaryEnvironment
    })
  );
});

test("private parent credentials and EVM-only mode remain refused", () => {
  for (const key of [
    "DATABASE_URL",
    "DATABASE_PRIVATE_URL",
    "HELIUS_API_KEY"
  ]) {
    assert.throws(() =>
      launchConfiguration({ ...publicEnvironment, [key]: "fixture-only" })
    );
  }
  assert.throws(() =>
    launchConfiguration({
      ...publicEnvironment,
      UNIFIED_SOLANA_ENABLED: "false"
    })
  );
});

test("template appends three RW after RO reset and retains literal egress", async () => {
  const unit = await readFile(
    new URL("./yunipals-indexer.service.example", import.meta.url),
    "utf8"
  );
  assert(unit.indexOf("BindPaths=") > unit.indexOf("BindReadOnlyPaths=\n"));
  assert.equal(unit.match(/cache\/\.ponder:/g)?.length, 1);
  assert.equal(unit.match(/cache\/\.vite-temp:/g)?.length, 1);
  assert.equal(unit.match(/cache\/ponder-env\.d\.ts:/g)?.length, 1);
  assert(unit.includes("ypal-rpc-deadline-host-build-v1/rpc-preflight.ts:"));
  assert(unit.includes("IPAddressDeny=any\n"));
  assert(unit.includes("104.18.36.169/32 172.64.151.87/32"));
  assert(unit.includes("CapabilityBoundingSet=\nAmbientCapabilities=\n"));
});

test("real children receive fourth-file precedence and separate private files", async () => {
  assert.equal(process.versions.node, "24.18.1");
  const root = await mkdtemp(join(tmpdir(), "ypal-ordinary-managed-"));
  try {
    const evm = join(root, "evm");
    const solana = join(root, "solana");
    const events = join(root, "events.jsonl");
    for (const path of [
      join(evm, "node_modules/ponder/dist/esm/bin"),
      join(solana, "lib/solana"),
      join(solana, "node_modules/tsx")
    ]) {
      await mkdir(path, { recursive: true });
    }
    const code = `import fs from 'node:fs';
fs.appendFileSync(process.env.EVENTS,JSON.stringify({role:process.env.ROLE,db:process.env.DATABASE_URL,permit:process.env.UNIFIED_RPC_REPLAY_PERMIT_ID_56??null,helius:process.env.HELIUS_API_KEY??null,other:process.env.EVM_ONLY??null,leak:process.env.LEAK_FROM_PARENT??null})+'\\n');
if(process.env.ROLE==='evm')setTimeout(()=>process.exit(75),300);
else{process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);}`;
    await writeFile(
      join(evm, "node_modules/ponder/dist/esm/bin/ponder.js"),
      code
    );
    await writeFile(join(solana, "lib/solana/worker.ts"), code);
    for (const directory of [evm, solana]) {
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
    }
    await writeFile(
      join(solana, "node_modules/tsx/package.json"),
      '{"type":"module","exports":"./index.mjs"}'
    );
    await writeFile(join(solana, "node_modules/tsx/index.mjs"), "");
    const files = Array.from({ length: 5 }, (_, index) =>
      join(root, `${index}.env`)
    );
    const values = [
      `EVENTS=${events}\nROLE=evm\nDATABASE_URL=fake-evm\nEVM_ONLY=yes\n`,
      "UNIFIED_RPC_REPLAY_PERMIT_ID_56=old-fixture\n",
      "UNIFIED_RPC_REPLAY_PERMIT_ID_56=combined-fixture\n",
      "UNIFIED_RPC_REPLAY_PERMIT_ID_56=ordinary-fixture\n",
      `EVENTS=${events}\nROLE=solana\nDATABASE_URL=fake-solana\nHELIUS_API_KEY=fake-key\n`
    ];
    for (let index = 0; index < files.length; index++) {
      await writeFile(files[index], values[index], { mode: 0o600 });
    }
    // Only fixture paths are substituted; the unchanged core's real process
    // execution checks fourth-file precedence and cleanup without app imports.
    process.env.LEAK_FROM_PARENT = "fake-parent";
    let result;
    try {
      result = await runManagedIndexer(
        {
          evmDirectory: evm,
          solanaDirectory: solana,
          evmEnvironment: files.slice(0, 4),
          solanaEnvironment: files[4]
        },
        { graceMilliseconds: 500 }
      );
    } finally {
      delete process.env.LEAK_FROM_PARENT;
    }
    assert.equal(result, 75);
    const rows = (await readFile(events, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.find((row) => row.role === "evm"),
      {
        role: "evm",
        db: "fake-evm",
        permit: "ordinary-fixture",
        helius: null,
        other: "yes",
        leak: null
      }
    );
    assert.deepEqual(
      rows.find((row) => row.role === "solana"),
      {
        role: "solana",
        db: "fake-solana",
        permit: null,
        helius: "fake-key",
        other: null,
        leak: null
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
