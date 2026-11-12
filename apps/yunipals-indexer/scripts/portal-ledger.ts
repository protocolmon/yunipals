import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { connectPortalChain } from "../lib/portals/chain.js";
import { PortalLedgerStore } from "../lib/portals/ledger-store.js";
import { PortalLedger } from "../lib/portals/ledger.js";
import { portalDatabaseOptions } from "../lib/portals/database.js";
import { portalLogBlockRange } from "../lib/portals/rpc.js";

if (process.env.PORTALS_ENV_FILE) loadEnvFile(process.env.PORTALS_ENV_FILE);

async function main() {
  if (
    !process.argv.includes("--migrate") &&
    process.env.PORTALS_LEDGER_ENABLED !== "true"
  )
    throw new Error(
      "The portal ledger is disabled. Configure PORTALS_LEDGER_ENABLED to index events."
    );
  const chain = await connectPortalChain(process.env);
  const db = new pg.Pool({ ...portalDatabaseOptions(process.env), max: 2 });
  try {
    const store = new PortalLedgerStore(
      db,
      `${chain.deployment.chainId}:${chain.deployment.collection.toLowerCase()}:${chain.deployment.grading.toLowerCase()}`
    );
    if (process.argv.includes("--migrate")) {
      await store.migrate();
      return;
    }
    const start = BigInt(process.env.PORTALS_LEDGER_START_BLOCK ?? "0");
    const confirmations = BigInt(process.env.PORTALS_CONFIRMATIONS ?? "12");
    if (start <= 0n || confirmations < 0n)
      throw new Error(
        "Configure the earliest verified portal-stack block and confirmations."
      );
    const ledger = new PortalLedger(
      chain,
      store,
      start,
      confirmations,
      portalLogBlockRange(process.env)
    );
    if (process.argv.includes("--once")) {
      await ledger.tick();
      return;
    }
    const abort = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => abort.abort());
    while (!abort.signal.aborted) {
      try {
        await ledger.tick();
      } catch {
        console.error(
          "Portal accounting index retrying; check RPC, schema and start block."
        );
      }
      await delay(3000, undefined, { signal: abort.signal }).catch(() => {});
    }
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error(
    "Portal accounting index could not start. Check private configuration."
  );
  process.exitCode = 1;
});
