import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const repository = fileURLToPath(new URL("../", import.meta.url));
const application = resolve(repository, "apps/yunipals-indexer");
const supervisor = resolve(repository, "ops/unified-indexer/run-indexer.sh");
const pathSettings = new Set([
  "YUNIPALS_INDEXER_NODE",
  "YUNIPALS_INDEXER_PONDER_DIRECTORY",
  "YUNIPALS_INDEXER_PONDER_ENV_FILE",
  "YUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE",
  "YUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE",
  "YUNIPALS_INDEXER_PONDER_REPLAY_ENV_FILE",
  "YUNIPALS_INDEXER_SOLANA_DIRECTORY",
  "YUNIPALS_INDEXER_SOLANA_ENV_FILE"
]);
const settings = new Set([
  ...pathSettings,
  "UNIFIED_SOLANA_ENABLED",
  "UNIFIED_PONDER_PORT",
  "UNIFIED_PONDER_SCHEMA",
  "UNIFIED_PONDER_HOSTNAME",
  "YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS"
]);

export async function loadLaunchConfiguration(file) {
  const configFile = resolve(file);
  const values = parseEnv(await readFile(configFile, "utf8"));
  for (const [name, value] of Object.entries(values)) {
    if (!settings.has(name)) {
      throw new Error(
        `Unsupported service setting: ${name}. Keep credentials in child env files.`
      );
    }
    if (!value || /[\r\n\0]/.test(value)) {
      throw new Error(`Invalid service setting: ${name}.`);
    }
    if (pathSettings.has(name))
      values[name] = resolve(dirname(configFile), value);
  }
  if (values.UNIFIED_SOLANA_ENABLED !== "true") {
    throw new Error(
      "UNIFIED_SOLANA_ENABLED=true is required for the managed indexer."
    );
  }
  if (
    values.UNIFIED_PONDER_PORT !== undefined &&
    (!/^[1-9][0-9]*$/.test(values.UNIFIED_PONDER_PORT) ||
      Number(values.UNIFIED_PONDER_PORT) > 65535)
  ) {
    throw new Error("UNIFIED_PONDER_PORT must be between 1 and 65535.");
  }
  for (const name of [
    "YUNIPALS_INDEXER_PONDER_ENV_FILE",
    "YUNIPALS_INDEXER_SOLANA_ENV_FILE"
  ]) {
    if (!values[name]) throw new Error(`Missing service setting: ${name}.`);
  }
  values.YUNIPALS_INDEXER_NODE ??= process.execPath;
  values.YUNIPALS_INDEXER_PONDER_DIRECTORY ??= application;
  values.YUNIPALS_INDEXER_SOLANA_DIRECTORY ??= application;
  const files = [...pathSettings].filter(
    (name) => values[name] && !name.endsWith("_DIRECTORY")
  );
  const childFiles = files.filter((name) => name.endsWith("_ENV_FILE"));
  if (
    new Set(childFiles.map((name) => values[name])).size !== childFiles.length
  ) {
    throw new Error("Each child env file must have a distinct path.");
  }
  for (const name of files) {
    if (!(await stat(values[name])).isFile())
      throw new Error(`${name} must name a file.`);
    await access(
      values[name],
      name === "YUNIPALS_INDEXER_NODE" ? constants.X_OK : constants.R_OK
    );
  }
  for (const name of [
    "YUNIPALS_INDEXER_PONDER_DIRECTORY",
    "YUNIPALS_INDEXER_SOLANA_DIRECTORY"
  ]) {
    if (!(await stat(values[name])).isDirectory())
      throw new Error(`${name} must name a directory.`);
  }
  const grace = values.YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS ?? "30000";
  if (!/^[1-9][0-9]*$/.test(grace) || Number(grace) > 120000) {
    throw new Error(
      "Shutdown grace must be between 1 and 120000 milliseconds."
    );
  }
  // Node env files cannot override inherited environment variables. Pass only
  // public supervisor settings so each child loads its own complete credentials.
  const env = Object.fromEntries(
    ["PATH", "LANG", "LC_ALL", "TZ", "TERM", "TMPDIR"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]])
  );
  return { env: { ...env, ...values }, graceMilliseconds: Number(grace) };
}

export function runIndexer(configuration) {
  return new Promise((resolveExit, reject) => {
    const child = spawn("bash", [supervisor], {
      cwd: repository,
      env: configuration.env,
      stdio: "inherit",
      detached: true
    });
    let timer;
    const signalGroup = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const stop = (signal) => {
      signalGroup(signal);
      timer ??= setTimeout(
        () => signalGroup("SIGKILL"),
        configuration.graceMilliseconds
      );
    };
    const terminate = () => stop("SIGTERM");
    const interrupt = () => stop("SIGINT");
    process.on("SIGTERM", terminate);
    process.on("SIGINT", interrupt);
    const cleanup = () => {
      clearTimeout(timer);
      process.off("SIGTERM", terminate);
      process.off("SIGINT", interrupt);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      signalGroup("SIGKILL");
      resolveExit(code ?? (signal === "SIGINT" ? 130 : 1));
    });
  });
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24) {
    throw new Error("Node 24 or newer is required.");
  }
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(
      "Usage: pnpm indexer:start [--env-file PATH]\nDefault: ops/unified-indexer/.env.service\nPaths in the settings file are relative to that file."
    );
    return;
  }
  let file = resolve(repository, "ops/unified-indexer/.env.service");
  if (args.length === 2 && args[0] === "--env-file") file = args[1];
  else if (args.length === 1 && args[0].startsWith("--env-file="))
    file = args[0].slice(11);
  else if (args.length)
    throw new Error("Usage: pnpm indexer:start [--env-file PATH]");
  process.exitCode = await runIndexer(await loadLaunchConfiguration(file));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`Indexer startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
