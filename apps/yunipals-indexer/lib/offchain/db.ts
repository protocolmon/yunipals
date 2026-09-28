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
export const apiPool = new pg.Pool({
  connectionString: databaseUrl,
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
