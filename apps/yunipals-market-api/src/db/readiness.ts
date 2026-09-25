import type { Pool } from "pg";

import { migrationChecksum } from "@/db/migrate";
import { migrations } from "@/db/migrations";

export async function assertReady(
  pool: Pool,
  deployment: "staging" | "production"
) {
  const result = await pool.query<{
    environment: string;
    history: { version: number; name: string; checksum: string }[];
    unsafe_role: boolean;
  }>(`SELECT d.environment,
    (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'checksum',checksum) ORDER BY version)
      FROM yunipals_market.schema_migration) AS history,
    (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
      OR has_schema_privilege(current_user,'yunipals_market','CREATE')
      OR has_table_privilege(current_user,'yunipals_market.collection','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege(current_user,'yunipals_market.schema_migration','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege(current_user,'yunipals_market.deployment','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege(current_user,'yunipals_market.sale_replay_config','INSERT,UPDATE,DELETE,TRUNCATE')
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','yunipals_market')
          AND c.relkind IN ('r','p','v','m','f')
          AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))) AS unsafe_role
    FROM yunipals_market.deployment d JOIN pg_roles r ON r.rolname=current_user WHERE d.singleton`);
  const row = result.rows[0];
  if (
    !row ||
    row.environment !== deployment ||
    row.unsafe_role ||
    !Array.isArray(row.history) ||
    row.history.length !== migrations.length ||
    row.history.some((item, index) => {
      const migration = migrations[index]!;
      return (
        item.version !== migration.version ||
        item.name !== migration.name ||
        item.checksum !== migrationChecksum(migration.sql)
      );
    })
  )
    throw new Error(
      "Marketplace database is not ready for this release and runtime role."
    );
}
