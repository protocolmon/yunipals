import pg from "pg";
import { bnbSchema, physicalPonderSchema } from "../lib/offchain/sql.js";

// Frequently updated proof tables need vacuum before the default 20% threshold.
// ShareUpdateExclusiveLock is compatible with API reads. Never truncate pages:
// vacuum truncation can otherwise briefly acquire an AccessExclusiveLock.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("SET lock_timeout='1s'");
  await db.query("SET statement_timeout='5s'");
  const relations = [
    ...new Set(
      [physicalPonderSchema, bnbSchema].map(
        (schema) => `${schema}.token_lifecycle`
      )
    ),
    "metadata.token_metadata"
  ];
  for (const relation of relations) {
    await db.query(`ALTER TABLE ${relation} SET (
      autovacuum_vacuum_scale_factor=0.02,
      autovacuum_vacuum_insert_scale_factor=0.02,
      autovacuum_analyze_scale_factor=0.02,
      vacuum_truncate=false,
      toast.vacuum_truncate=false
    )`);
    console.log(
      JSON.stringify({ event: "api_proof_maintenance_configured", relation })
    );
  }
} finally {
  await db.end();
}
