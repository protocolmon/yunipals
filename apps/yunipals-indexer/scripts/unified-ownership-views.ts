import pg from "pg";
import { createOwnershipReadViews } from "../lib/unified/ownership-views.js";
import { ownershipReadDefinitions } from "../lib/unified/ownership-config.js";
import { loadIndexerRelease } from "../lib/unified/releases.js";

const env = process.env;
if (
  !env.UNIFIED_INDEXER_DATABASE_URL ||
  !env.UNIFIED_INDEXER_RELEASE_ID ||
  !env.UNIFIED_INDEXER_READ_SCHEMA
)
  throw new Error(
    "Set the candidate database, registered release ID and fresh ownership read schema."
  );
const pool = new pg.Pool({
  connectionString: env.UNIFIED_INDEXER_DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  application_name: "unified_ownership_views"
});
try {
  const release = await loadIndexerRelease(
    pool,
    env.UNIFIED_INDEXER_RELEASE_ID
  );
  const result = await createOwnershipReadViews(
    pool,
    release,
    env.UNIFIED_INDEXER_READ_SCHEMA,
    ownershipReadDefinitions(release)
  );
  console.log(
    JSON.stringify({ event: "unified_ownership_candidate_created", ...result })
  );
} catch {
  console.error(
    "Unified ownership candidate creation failed; existing read schemas were not reassigned."
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
