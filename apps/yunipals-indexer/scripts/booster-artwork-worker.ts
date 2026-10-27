import { BoosterArtworkStore } from "../lib/boosters/artwork.js";
import { apiPool } from "../lib/offchain/db.js";
import { physicalPonderSchemaName } from "../lib/offchain/sql.js";
const directory = process.env.BOOSTER_ARTWORK_DIRECTORY;
const catalogs = (
  process.env.BOOSTER_ARTWORK_CATALOGS ?? "base-standard-v1"
).split(",");
if (!directory) throw new Error("Configure BOOSTER_ARTWORK_DIRECTORY");
const store = new BoosterArtworkStore(directory);
const schema = process.env.BOOSTER_DATABASE_SCHEMA ?? physicalPonderSchemaName;
let stopped = false;
process.once("SIGINT", () => {
  stopped = true;
});
process.once("SIGTERM", () => {
  stopped = true;
});
try {
  do {
    try {
      console.log(
        JSON.stringify({ queued: await store.sync(apiPool, schema, catalogs) })
      );
    } catch (error) {
      console.error(
        "Booster artwork synchronization failed",
        error instanceof Error ? error.message : "Unknown error"
      );
      if (process.argv.includes("--once")) throw error;
    }
    if (process.argv.includes("--once")) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (!stopped);
} finally {
  await apiPool.end();
}
