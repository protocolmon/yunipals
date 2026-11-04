import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  runSharedIndexerObserver,
  sharedObserverEnvironment
} from "../lib/unified/shared-observer.js";
import { validateSharedIndexerDeployment } from "../lib/unified/shared-deployment.js";
import { manifestDigest } from "../lib/unified/sources.js";
export {
  runSharedIndexerObserver,
  sharedObserverEnvironment
} from "../lib/unified/shared-observer.js";

async function main() {
  const [command] = process.argv.slice(2);
  if (
    !command ||
    !["inspect", "health", "observe-once", "worker"].includes(command) ||
    process.argv.length !== 3
  )
    throw new Error(
      "Use shared-indexer-observer inspect|health|observe-once|worker."
    );
  const file = process.env.UNIFIED_INDEXER_DEPLOYMENT_FILE;
  if (!file?.startsWith("/"))
    throw new Error("An absolute deployment file is required.");
  const deployment = validateSharedIndexerDeployment(
    JSON.parse(await readFile(file, "utf8"))
  );
  const env = sharedObserverEnvironment(deployment, process.env);
  const profile = JSON.parse(
    await readFile(env.UNIFIED_RPC_PROFILE_FILE, "utf8")
  );
  if (manifestDigest(profile) !== manifestDigest(deployment.rpcProfile))
    throw new Error("shared_observer_profile_file_mismatch");
  const pool = new pg.Pool({
    connectionString: process.env.UNIFIED_INDEXER_DATABASE_URL,
    ...(process.env.UNIFIED_INDEXER_DATABASE_URL
      ? {}
      : {
          host: "/var/run/postgresql",
          port: 5432,
          database: "yunipals_backfill",
          user: "yunipals_unified_support"
        }),
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    application_name: "yunipals_shared_observer"
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runSharedIndexerObserver(
      pool,
      deployment,
      command as "inspect" | "health" | "observe-once" | "worker",
      env,
      {
        stopping: () => stopping,
        log: (event) => console.log(JSON.stringify(event))
      }
    );
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await pool.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch(() => {
    console.error(JSON.stringify({ event: "shared_observer_startup_failed" }));
    process.exitCode = 1;
  });
