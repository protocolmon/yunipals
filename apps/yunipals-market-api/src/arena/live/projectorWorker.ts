import { setTimeout } from "node:timers/promises";
import { arenaRuntime } from "./runtime";
import { projectConfirmedArena } from "./projector";
import { ArenaClientTransactions } from "./clientTransactions";

const runtime = await arenaRuntime();
const transactions = new ArenaClientTransactions(runtime.service);
let stopped = false;
process.once("SIGTERM", () => {
  stopped = true;
});
process.once("SIGINT", () => {
  stopped = true;
});
try {
  while (!stopped) {
    try {
      const result = await projectConfirmedArena(
        runtime.pool,
        runtime.clients.get(8453)!,
        runtime.config.deployment
      );
      if (result.status === "halted") {
        console.error(
          "Arena projection halted: confirmed history requires review."
        );
        break;
      }
      await transactions.reconcileBatch(runtime.clients.get(8453)!);
      await setTimeout(result.status === "advanced" ? 1000 : 10_000);
    } catch {
      console.error("Arena projection unavailable; retrying existing cursor.");
      await setTimeout(30_000);
    }
  }
} finally {
  await runtime.pool.end();
}
