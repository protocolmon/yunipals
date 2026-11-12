import type { Pool, PoolConfig } from "pg";

export function portalSqlIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error(
      "Portal database identifiers must use lowercase letters, digits and underscores."
    );
  return `"${value}"`;
}
export function portalDatabaseSchema(env: NodeJS.ProcessEnv) {
  const schema = env.PORTALS_DATABASE_SCHEMA ?? "portal";
  portalSqlIdentifier(schema);
  if (
    ["public", "information_schema"].includes(schema) ||
    schema.startsWith("pg_")
  )
    throw new Error("Use a dedicated portal database schema.");
  return schema;
}
export function portalDatabaseOptions(env: NodeJS.ProcessEnv): PoolConfig {
  if (!env.PORTALS_DATABASE_URL)
    throw new Error("A dedicated PORTALS_DATABASE_URL is required.");
  const schema = portalDatabaseSchema(env);
  return {
    connectionString: env.PORTALS_DATABASE_URL,
    options: `-c search_path=${schema},pg_catalog -c synchronous_commit=on`,
    max: 4,
    connectionTimeoutMillis: 5000,
    statement_timeout: 20000
  };
}

export const portalDatabaseTables = {
  intake: ["portal_v1_spell", "portal_v1_author_link"],
  jobs: [
    "portal_v1_job",
    "portal_v1_publication",
    "portal_v1_cursor",
    "portal_v4_theme_job"
  ],
  signing: ["portal_v5_transaction"],
  ledger: [
    "portal_v5_request",
    "portal_v5_mint",
    "portal_v5_state",
    "portal_v2_ledger_cursor",
    "portal_v2_ledger_event",
    "portal_v2_token",
    "portal_v3_competition_entry",
    "portal_v3_competition_batch",
    "portal_v3_competition_prize"
  ]
} as const;

/** Explicit migration operation, never called during ordinary API/worker startup. */
export async function createPortalSchema(
  db: Pick<Pool, "query">,
  schema: string
) {
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${portalSqlIdentifier(schema)}`);
  await db.query(
    `REVOKE ALL ON SCHEMA ${portalSqlIdentifier(schema)} FROM PUBLIC`
  );
}

/** Roles already exist; credentials and role creation stay with the operator. */
export async function grantPortalRoles(
  db: Pick<Pool, "query">,
  schema: string,
  roles: { api: string; worker: string; ledger: string }
) {
  if (new Set(Object.values(roles)).size !== 3)
    throw new Error("Portal runtime roles must be distinct.");
  const quotedSchema = portalSqlIdentifier(schema);
  const qualified = (tables: readonly string[]) =>
    tables
      .map((table) => `${quotedSchema}.${portalSqlIdentifier(table)}`)
      .join(",");
  const all = Object.values(portalDatabaseTables).flat();
  for (const role of Object.values(roles)) {
    const identifier = portalSqlIdentifier(role);
    await db.query(`REVOKE ALL ON SCHEMA ${quotedSchema} FROM ${identifier}`);
    await db.query(`GRANT USAGE ON SCHEMA ${quotedSchema} TO ${identifier}`);
    await db.query(`REVOKE ALL ON ${qualified(all)} FROM ${identifier}`);
  }
  await db.query(`REVOKE ALL ON ${qualified(all)} FROM PUBLIC`);
  const { intake, jobs, ledger, signing } = portalDatabaseTables;
  await db.query(
    `GRANT SELECT ON ${qualified([...intake, ...jobs, ...ledger])} TO ${portalSqlIdentifier(roles.api)}`
  );
  await db.query(
    `GRANT INSERT ON ${qualified(intake)} TO ${portalSqlIdentifier(roles.api)}`
  );
  await db.query(
    `GRANT SELECT ON ${qualified([...intake, ...ledger])} TO ${portalSqlIdentifier(roles.worker)}`
  );
  await db.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ${qualified(jobs)} TO ${portalSqlIdentifier(roles.worker)}`
  );
  await db.query(
    `GRANT SELECT,INSERT,UPDATE ON ${qualified(signing)} TO ${portalSqlIdentifier(roles.worker)}`
  );
  await db.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ${qualified(ledger)} TO ${portalSqlIdentifier(roles.ledger)}`
  );
}
