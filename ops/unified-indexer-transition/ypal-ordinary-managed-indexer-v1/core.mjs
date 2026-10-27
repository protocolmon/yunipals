// One supervisor for the confirmed YPAL Ponder source and retained Solana worker.
// The parent handles public paths only. Node loads each child's private files.
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants, writeSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceDirectory =
  "/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer";
const solanaDirectory =
  "/var/lib/yunipals-unified-shadow/20261020-008028af-a/apps/yunipals-indexer";
const decimal = /^(0|[1-9][0-9]*)$/;

function need(value, code) {
  if (!value) throw Error(code);
}

function absolutePath(value) {
  need(
    typeof value === "string" &&
      isAbsolute(value) &&
      !value.split("/").includes("..") &&
      !/[\r\n\0]/.test(value),
    "absolute_public_child_path_required"
  );
  return value;
}

export function launchConfiguration(environment) {
  need(
    ["DATABASE_URL", "DATABASE_PRIVATE_URL", "HELIUS_API_KEY"].every(
      (key) => !Object.hasOwn(environment, key)
    ),
    "private_credentials_belong_only_to_child_files"
  );
  // This successor always includes both sources. It is not an EVM-only mode.
  need(
    environment.UNIFIED_SOLANA_ENABLED === "true",
    "managed_solana_must_be_enabled"
  );
  need(
    environment.UNIFIED_PONDER_SCHEMA === "unified_ypal_20261023_v1" &&
      environment.UNIFIED_PONDER_HOSTNAME === "127.0.0.1" &&
      environment.UNIFIED_PONDER_PORT === "9028",
    "exact_existing_ypal_native_selection_required"
  );
  const evmEnvironment = [
    environment.YUNIPALS_INDEXER_PONDER_ENV_FILE,
    environment.YUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE,
    environment.YUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE
  ].map(absolutePath);
  need(
    new Set([
      ...evmEnvironment,
      absolutePath(environment.YUNIPALS_INDEXER_SOLANA_ENV_FILE)
    ]).size === 4,
    "distinct_ordered_evm_and_separate_solana_files_required"
  );
  return {
    evmDirectory: absolutePath(
      environment.YUNIPALS_INDEXER_PONDER_DIRECTORY ?? sourceDirectory
    ),
    solanaDirectory: absolutePath(
      environment.YUNIPALS_INDEXER_SOLANA_DIRECTORY ?? solanaDirectory
    ),
    evmEnvironment,
    solanaEnvironment: absolutePath(
      environment.YUNIPALS_INDEXER_SOLANA_ENV_FILE
    )
  };
}

export function childDefinitions(configuration, node = process.execPath) {
  return [
    {
      name: "evm",
      executable: node,
      cwd: configuration.evmDirectory,
      args: [
        "--max-old-space-size=4096",
        ...configuration.evmEnvironment.map((path) => `--env-file=${path}`),
        "node_modules/ponder/dist/esm/bin/ponder.js",
        "start",
        "--schema",
        "unified_ypal_20261023_v1",
        "--hostname",
        "127.0.0.1",
        "--port",
        "9028"
      ]
    },
    {
      name: "solana",
      executable: node,
      cwd: configuration.solanaDirectory,
      args: [
        "--max-old-space-size=4096",
        `--env-file=${configuration.solanaEnvironment}`,
        "--import",
        "tsx",
        "lib/solana/worker.ts"
      ]
    }
  ];
}

async function validateFiles(configuration) {
  for (const directory of [
    configuration.evmDirectory,
    configuration.solanaDirectory
  ]) {
    need((await stat(directory)).isDirectory(), "child_directory_required");
  }
  // Check readability without loading private configuration into the parent.
  for (const file of [
    ...configuration.evmEnvironment,
    configuration.solanaEnvironment,
    join(
      configuration.evmDirectory,
      "node_modules/ponder/dist/esm/bin/ponder.js"
    ),
    join(configuration.solanaDirectory, "lib/solana/worker.ts"),
    join(configuration.solanaDirectory, "node_modules/tsx/package.json")
  ]) {
    need((await stat(file)).isFile(), "child_file_required");
    await access(file, constants.R_OK);
  }
}

export async function runManagedIndexer(configuration, options = {}) {
  const graceMilliseconds = options.graceMilliseconds ?? 30000;
  need(
    Number.isSafeInteger(graceMilliseconds) &&
      graceMilliseconds >= 1 &&
      graceMilliseconds <= 30000,
    "bounded_shutdown_grace_required"
  );
  await validateFiles(configuration);
  const definitions = childDefinitions(configuration);
  const environment = {
    PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C.UTF-8",
    TZ: "UTC"
  };
  return new Promise((done) => {
    const children = [];
    let stopping = false;
    let exitCode = 1;
    let timer;
    let starting = true;
    const signalGroup = (child, signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const finish = () => {
      if (starting || !stopping || children.some((child) => !child.closed))
        return;
      clearTimeout(timer);
      // A leader can exit before its compiler descendants. Once all leaders
      // have closed, no orphan should outlive this supervisor invocation.
      for (const child of children) signalGroup(child, "SIGKILL");
      process.off("SIGTERM", terminate);
      process.off("SIGINT", interrupt);
      done(exitCode);
    };
    const stop = (code) => {
      if (stopping) return;
      stopping = true;
      exitCode = code;
      // Isolated process groups also include Ponder's own compiler descendants.
      for (const child of children) signalGroup(child, "SIGTERM");
      timer = setTimeout(() => {
        for (const child of children) signalGroup(child, "SIGKILL");
      }, graceMilliseconds);
      finish();
    };
    const terminate = () => stop(0);
    const interrupt = () => stop(130);
    process.on("SIGTERM", terminate);
    process.on("SIGINT", interrupt);
    for (const definition of definitions) {
      const child = spawn(definition.executable, definition.args, {
        cwd: definition.cwd,
        env: environment,
        detached: true,
        stdio: "inherit"
      });
      child.closed = false;
      children.push(child);
      child.once("error", () => {
        // Omit driver/path/configuration details from supervisor diagnostics.
        writeSync(2, "Managed indexer child could not start.\n");
        stop(1);
      });
      child.once("exit", (code) => {
        // A clean unexpected exit is still a failure of the managed service.
        if (!stopping) stop(Number.isInteger(code) && code > 0 ? code : 1);
      });
      child.once("close", () => {
        child.closed = true;
        finish();
      });
    }
    starting = false;
    finish();
  });
}

async function main() {
  need(process.versions.node === "24.18.1", "pinned_node24_runtime_required");
  const grace = process.env.YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS ?? "30000";
  need(decimal.test(grace), "bounded_shutdown_grace_required");
  process.exitCode = await runManagedIndexer(launchConfiguration(process.env), {
    graceMilliseconds: Number(grace)
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    writeSync(2, "Managed indexer configuration or startup failed.\n");
    process.exitCode = 1;
  });
}
