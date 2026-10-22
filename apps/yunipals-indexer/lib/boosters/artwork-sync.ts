import { pathToFileURL } from "node:url";
import pg from "pg";
import type { Pool } from "pg";
import { BoosterArtworkStore } from "./artwork.js";
import { boosterDeployment } from "./config.js";
import { boosterReadiness } from "./readiness.js";

export async function syncBoosterArtworkQueue(dependencies: {
  pool: Pick<Pool, "query">;
  schemaName: string;
  engine: string;
  store: BoosterArtworkStore;
  catalogs: string[];
}) {
  const status = await boosterReadiness(
    dependencies.pool,
    dependencies.schemaName,
    dependencies.engine
  );
  if (!status.ready)
    return { queued: 0, skipped: true, reason: status.reason };
  const queued = await dependencies.store.sync(
    dependencies.pool,
    dependencies.schemaName,
    dependencies.catalogs
  );
  return { queued, skipped: false, indexedBlock: status.indexedBlock };
}

/** One bounded observation; a systemd timer owns the five-second schedule. */
export async function runBoosterArtworkSync() {
  if (process.argv.slice(2).join(" ") !== "--once")
    throw new Error("Run the artwork queue synchronizer with --once");
  const connectionString = process.env.DATABASE_URL;
  const schemaName = process.env.BOOSTER_DATABASE_SCHEMA?.trim();
  const directory = process.env.BOOSTER_ARTWORK_DIRECTORY?.trim();
  const catalogs = (process.env.BOOSTER_ARTWORK_CATALOGS ?? "")
    .split(",")
    .map((value) => value.trim());
  const deployment = boosterDeployment();
  if (!connectionString || !schemaName || !directory || !deployment ||
      !catalogs.length || catalogs.some((name) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) ||
      new Set(catalogs).size !== catalogs.length)
    throw new Error("Complete booster artwork queue configuration is required");
  const pool = new pg.Pool({
    connectionString,
    application_name: "yunipals_booster_artwork_queue",
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 1000,
    options: "-c default_transaction_read_only=on"
  });
  pool.on("error", () => console.error("Artwork queue database connection unavailable"));
  try {
    const result = await syncBoosterArtworkQueue({
      pool,
      schemaName,
      engine: deployment.engine,
      store: new BoosterArtworkStore(directory),
      catalogs
    });
    console.log(JSON.stringify({ event: "booster_artwork_queue_sync", ...result }));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  runBoosterArtworkSync().catch(() => {
    console.error("Booster artwork queue synchronization unavailable");
    process.exitCode = 1;
  });
