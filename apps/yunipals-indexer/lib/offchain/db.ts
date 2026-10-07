import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

export const pool = new pg.Pool({ connectionString: databaseUrl, max: 12 });

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// API queries must not wait indefinitely behind a database lock or a saturated
// pool. Keep these settings off the worker pool: refresh jobs are intentionally
// much longer-running than interactive requests.
// The proof joins can have high estimated costs even for a 24-token page. JIT
// compilation then takes seconds for a query that executes in milliseconds.
// Set this at connection startup so page and count reads on every API client
// avoid that cost. Preserve other URL/PGOPTIONS settings, including read-only.
const apiDatabaseUrl = new URL(databaseUrl);
const apiStartupOptions = apiDatabaseUrl.searchParams.get("options") ?? process.env.PGOPTIONS ?? "";
apiDatabaseUrl.searchParams.set("options", `${apiStartupOptions} -c jit=off`.trim());

export const apiPool = new pg.Pool({
  connectionString: apiDatabaseUrl.toString(),
  application_name: "yunipals_api",
  max: positiveNumber(process.env.API_DB_POOL_MAX, 12),
  connectionTimeoutMillis: positiveNumber(process.env.API_DB_ACQUIRE_TIMEOUT_MS, 1_000),
  statement_timeout: positiveNumber(process.env.API_DB_STATEMENT_TIMEOUT_MS, 10_000),
  lock_timeout: positiveNumber(process.env.API_DB_LOCK_TIMEOUT_MS, 2_000),
  idle_in_transaction_session_timeout: positiveNumber(process.env.API_DB_IDLE_TRANSACTION_TIMEOUT_MS, 10_000)
});

apiPool.on("error", (error) => console.error("API database pool error", error));

let previousWaiting = 0;
const poolMonitor = setInterval(() => {
  if (apiPool.waitingCount > 0 || previousWaiting > 0) {
    console.warn("API database pool pressure", {
      total: apiPool.totalCount,
      idle: apiPool.idleCount,
      waiting: apiPool.waitingCount
    });
  }
  previousWaiting = apiPool.waitingCount;
}, 1_000);
poolMonitor.unref();

export async function closePool() {
  await pool.end();
}
