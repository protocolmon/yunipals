import { migrate } from "@/db/migrate";
import { createPool } from "@/db/pool";
import { readEnvironment } from "@/environment";

const environment = readEnvironment({
  ...process.env,
  MARKET_DATABASE_URL:
    process.env.MARKET_MIGRATION_DATABASE_URL ?? process.env.MARKET_DATABASE_URL
});
const pool = createPool(environment);
try {
  console.log(
    JSON.stringify({ applied: await migrate(pool, environment.deployment) })
  );
} catch {
  console.error(
    "Marketplace migration failed; inspect database configuration and release history."
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
