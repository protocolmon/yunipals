import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  indexerTransaction,
  sqlIdentifier
} from "../../../packages/yunipals-indexer-server/src/database.js";
import {
  loadIndexerRelease,
  readBoundRuntime
} from "../../../packages/yunipals-indexer-server/src/releases.js";
import { createPortalReadViews } from "../lib/unified/portal-views.js";
import { portalConsumerSchema } from "../lib/portals/consumer-schema.js";
import {
  portalDatabaseOptions,
  portalDatabaseSchema
} from "../lib/portals/database.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);
const { values } = parseArgs({
  options: { operation: { type: "string" }, "reader-roles": { type: "string" } }
});
async function main() {
  if (values.operation === "private-consumer") {
    const role = process.env.PORTALS_WORKER_DATABASE_ROLE;
    if (!role) throw new Error("Explicit worker role required.");
    const db = new pg.Pool(portalDatabaseOptions(process.env));
    try {
      await indexerTransaction(db, async (tx) => {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtext('portal-shared-consumer-migration'))"
        );
        await tx.query(portalConsumerSchema);
        const schema = sqlIdentifier(portalDatabaseSchema(process.env));
        for (const table of ["portal_v6_consumer", "portal_v6_job_revision"]) {
          await tx.query(`REVOKE ALL ON ${schema}.${table} FROM PUBLIC`);
          await tx.query(
            `GRANT SELECT,INSERT,UPDATE,DELETE ON ${schema}.${table} TO ${sqlIdentifier(role)}`
          );
        }
      });
      console.log(
        JSON.stringify({
          operation: values.operation,
          prepared: true,
          servicesChanged: false
        })
      );
    } finally {
      await db.end();
    }
    return;
  }
  if (
    values.operation !== "read-views" ||
    !process.env.DATABASE_URL ||
    !process.env.PORTALS_INDEXER_RELEASE_ID ||
    !process.env.PORTALS_INDEXER_READ_SCHEMA ||
    !values["reader-roles"]
  )
    throw new Error(
      "Select read-views or private-consumer with explicit database/release/role configuration."
    );
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1
  });
  try {
    const prepared = await indexerTransaction(pool, async (db) => {
      const release = await loadIndexerRelease(
        db,
        process.env.PORTALS_INDEXER_RELEASE_ID
      );
      await readBoundRuntime(db, release);
      return createPortalReadViews(
        db,
        release,
        process.env.PORTALS_INDEXER_READ_SCHEMA!,
        values["reader-roles"]!.split(",")
      );
    });
    console.log(JSON.stringify({ ...prepared, servicesChanged: false }));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Portal shared preparation failed; review the selected release, schema and migration privileges."
  );
  process.exitCode = 1;
});
