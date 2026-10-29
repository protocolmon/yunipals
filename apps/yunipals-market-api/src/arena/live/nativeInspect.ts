import { arenaVersion } from "@protopals/yunipals-market-core/arenaProtocol";
import pg from "pg";
import { arenaNativeConfiguration, NativeArenaSource } from "./nativeSource";

// Public candidate inspection only. No signer, strategy key, provider or
// operational projection is loaded by this command.
let pool: pg.Pool | undefined;
try {
  const config = arenaNativeConfiguration();
  const contract = process.env.ARENA_CONTRACT,
    start = process.env.ARENA_DEPLOYMENT_BLOCK,
    id = process.argv[2] ?? "1";
  if (
    config.mode !== "unified" ||
    config.sourceKind !== "unified" ||
    !contract ||
    !start ||
    !/^(0|[1-9][0-9]*)$/.test(start) ||
    !/^(0|[1-9][0-9]*)$/.test(id) ||
    BigInt(id) >= 2n ** 256n
  )
    throw new Error(
      "Explicit native Arena deployment and tournament ID are required."
    );
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 2,
    application_name: "arena_native_inspect",
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 1000,
    idle_in_transaction_session_timeout: 10000
  });
  const source = new NativeArenaSource(
    pool,
    config.releaseId,
    contract,
    BigInt(start),
    process.env.ARENA_MEDIA_KIND === "anime" ? "anime" : "video",
    arenaVersion(process.env.ARENA_CONTRACT_VERSION)
  );
  const result = await source.read(id);
  console.log(
    JSON.stringify({ event: "native_arena_public_observation", ...result })
  );
} catch {
  console.error(
    "Native Arena inspection unavailable; check deployment, release, coverage and read grants."
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
