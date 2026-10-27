import pg from "pg";
import { createIndexerReader } from "@protopals/yunipals-indexer-server/readers";

import { readSourcePoolMax, sourcePoolMax } from "@/indexer/sourcePool";

export type SharedConsumerEnvironment =
  | { mode: "legacy" }
  | { mode: "unified"; databaseUrl: string; releaseId: string; poolMax?: number };
export function readSharedConsumerEnvironment(
  input: NodeJS.ProcessEnv,
  prefix:
    | "MARKET_SALE_INDEXER"
    | "MARKET_BNB_DISCOVERY_INDEXER"
    | "MARKET_BNB_SALE_INDEXER"
): SharedConsumerEnvironment {
  const mode = input[`${prefix}_MODE`] ?? "legacy";
  const databaseUrl = input[`${prefix}_DATABASE_URL`];
  const releaseId = input[`${prefix}_RELEASE_ID`];
  const poolMax = input[`${prefix}_POOL_MAX`];
  if (
    mode === "legacy" &&
    databaseUrl === undefined &&
    releaseId === undefined &&
    poolMax === undefined
  )
    return { mode };
  try {
    if (
      mode !== "unified" ||
      !databaseUrl ||
      !releaseId ||
      !/^0x[0-9a-f]{64}$/.test(releaseId)
    )
      throw new Error();
    const url = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash
    )
      throw new Error();
    return { mode, databaseUrl, releaseId, poolMax: readSourcePoolMax(poolMax) };
  } catch {
    throw new Error(
      `Configure ${prefix}_MODE=unified with its database URL and exact release ID, or legacy without selectors.`
    );
  }
}
export async function openSharedConsumer(config: SharedConsumerEnvironment) {
  if (config.mode === "legacy") return undefined;
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: sourcePoolMax(config.poolMax),
    application_name: "yunipals_market_shared_consumer",
    connectionTimeoutMillis: 1500,
    statement_timeout: 10000,
    lock_timeout: 1500,
    idle_in_transaction_session_timeout: 12000
  });
  pool.on("error", () =>
    console.error("Shared marketplace source connection failed.")
  );
  try {
    return {
      pool,
      reader: await createIndexerReader(pool, { releaseId: config.releaseId })
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
