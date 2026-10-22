import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";
import pg from "pg";
import { createPublicClient, http, isAddress, type PublicClient } from "viem";
import { base } from "viem/chains";
import { rpcBudgetProxyUrl } from "@/rpcBudgetProxyRegistry";
import { arenaNativeConfiguration, NativeArenaSource } from "./nativeSource";
import { ArenaMediaAdoption, verifyNativeArenaFilm } from "./mediaAdoption";

// Standalone migration command: no application runtime, signer, encryption key,
// provider SDK or paid generation configuration is loaded.
async function run() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      incarnation: { type: "string" },
      apply: { type: "string" }
    }
  });
  const config = arenaNativeConfiguration(),
    contract = process.env.ARENA_CONTRACT,
    start = process.env.ARENA_DEPLOYMENT_BLOCK,
    database = process.env.ARENA_DATABASE_URL,
    storage = process.env.ARENA_MEDIA_ROOT;
  if (
    config.mode !== "unified" ||
    !contract ||
    !isAddress(contract) ||
    !start ||
    !/^[1-9][0-9]*$/.test(start) ||
    !database ||
    !storage ||
    !isAbsolute(storage) ||
    !values.id ||
    !values.incarnation
  )
    throw new Error(
      "Explicit native selectors, operational database, media root and tournament identity are required."
    );
  const pools = {
    operational: new pg.Pool({
      connectionString: database,
      max: 2,
      application_name: "arena_media_adoption",
      connectionTimeoutMillis: 2000,
      statement_timeout: 10000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 15000
    }),
    source: new pg.Pool({
      connectionString: config.databaseUrl,
      max: 2,
      application_name: "arena_media_adoption_read",
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 10000
    })
  };
  try {
    const source = new NativeArenaSource(
      pools.source,
      config.releaseId,
      contract,
      BigInt(start)
    );
    const client = createPublicClient({
      chain: base,
      transport: http(rpcBudgetProxyUrl("base", "production"), {
        retryCount: 0,
        timeout: 15000
      })
    }) as PublicClient;
    const adoption = new ArenaMediaAdoption(
      pools.operational,
      source,
      `8453:${contract.toLowerCase()}`,
      storage,
      (observed) => verifyNativeArenaFilm(client, observed)
    );
    console.log(
      JSON.stringify({
        event: "arena_media_adoption",
        ...(await adoption.run(values.id, values.incarnation, values.apply))
      })
    );
  } finally {
    await Promise.allSettled(Object.values(pools).map((pool) => pool.end()));
  }
}
try {
  await run();
} catch {
  console.error(
    "Arena media adoption unavailable; verify the fenced deployment, adopted origin, original files/tasks, current source and review hash. No replacement media was generated."
  );
  process.exitCode = 1;
}
