import { setTimeout } from "node:timers/promises";
import { arenaRuntime } from "./runtime";
import { arenaNativeConfiguration } from "./nativeSource";
import { arenaClientTransactionMigration } from "./clientTransactionSchema";
import { ArenaClientTransactions } from "./clientTransactions";
import { adoptLegacyClientTransactions } from "./nativeClientAdoption";

async function run() {
  if (arenaNativeConfiguration().mode !== "unified")
    throw new Error("Explicit unified mode is required.");
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--adopt-legacy"))
    throw new Error("Unknown tracking option.");
  const runtime = await arenaRuntime({ native: true });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const migration = (
      await runtime.pool.query<{ checksum: string }>(
        "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
        [arenaClientTransactionMigration.version]
      )
    ).rows[0];
    if (migration?.checksum !== arenaClientTransactionMigration.checksum)
      throw new Error("Native client migration is required.");
    if (args[0] === "--adopt-legacy") {
      console.log(
        JSON.stringify({
          event: "arena_client_adoption",
          ...(await adoptLegacyClientTransactions(
            runtime.pool,
            runtime.service.deployment
          ))
        })
      );
      return;
    }
    const tracker = new ArenaClientTransactions(runtime.service);
    while (!stopped) {
      try {
        await tracker.reconcileBatch(runtime.clients.get(8453)!);
      } catch {
        console.error(
          "Native Arena client tracking unavailable; saved hashes and receipt history retained."
        );
      }
      if (!stopped) await setTimeout(2000);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await runtime.close();
  }
}
try {
  await run();
} catch {
  console.error(
    "Native Arena client tracking could not start; check source selection, migrations and operational grants."
  );
  process.exitCode = 1;
}
