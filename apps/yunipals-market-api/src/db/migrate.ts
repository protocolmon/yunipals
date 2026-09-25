import { createHash } from "node:crypto";
import type pg from "pg";

import { migrations } from "@/db/migrations";
import { transaction } from "@/db/pool";

export function migrationChecksum(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

export async function migrate(
  pool: pg.Pool,
  deployment: "staging" | "production"
) {
  return transaction(pool, async (client) => {
    // A transaction-scoped lock serializes bootstrapping and every version.
    await client.query("SELECT pg_advisory_xact_lock(178858, 9012)");
    await client.query("CREATE SCHEMA IF NOT EXISTS yunipals_market");
    await client.query(`CREATE TABLE IF NOT EXISTS yunipals_market.schema_migration (
      version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const applied = await client.query<{
      version: number;
      name: string;
      checksum: string;
    }>(
      "SELECT version,name,checksum FROM yunipals_market.schema_migration ORDER BY version"
    );
    for (const row of applied.rows) {
      const known = migrations.find(
        (migration) => migration.version === row.version
      );
      if (
        !known ||
        row.checksum !== migrationChecksum(known.sql) ||
        row.name !== known.name
      )
        throw new Error(
          "Marketplace migration history does not match this release."
        );
    }
    const completed: number[] = [];
    for (const migration of migrations) {
      if (applied.rows.some((row) => row.version === migration.version))
        continue;
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO yunipals_market.schema_migration(version,name,checksum) VALUES ($1,$2,$3)",
        [migration.version, migration.name, migrationChecksum(migration.sql)]
      );
      completed.push(migration.version);
    }
    await client.query(
      "INSERT INTO yunipals_market.deployment(environment) VALUES ($1) ON CONFLICT DO NOTHING",
      [deployment]
    );
    const marker = await client.query<{ environment: string }>(
      "SELECT environment FROM yunipals_market.deployment WHERE singleton"
    );
    if (marker.rows[0]?.environment !== deployment)
      throw new Error(
        "Database deployment marker differs from this service configuration."
      );
    return completed;
  });
}
