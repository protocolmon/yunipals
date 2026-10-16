import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { arenaRuntime } from "./runtime";
import { arenaSigner } from "./config";
import { ArenaControl } from "./control";

const key = process.env.ARENA_LOBBY_KEY_FILE,
  cap = process.env.ARENA_MAX_CONTROL_EXECUTION_FEE_WEI;
if (!key || !cap || process.env.ARENA_NEW_LOBBIES_ENABLED !== "true")
  throw new Error("Automatic lobby creation is not configured/enabled.");
const runtime = await arenaRuntime(),
  base = runtime.clients.get(8453)!;
const worker = new ArenaControl(
  runtime.service,
  runtime.compiler,
  base,
  arenaSigner(key),
  BigInt(cap),
  runtime.capacity
);
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
      await runtime.service.ready();
      const pending = (
        await runtime.pool.query<{ id: string }>(
          "SELECT tournament_id::text AS id FROM yunipals_arena.transaction_intent WHERE deployment=$1 AND purpose='open-lobby' AND state IN ('prepared','submitted','mined') ORDER BY nonce LIMIT 1",
          [runtime.config.deployment.id]
        )
      ).rows[0];
      let id = pending?.id;
      if (!id) {
        await runtime.capacity.check(true);
        id = (
          await base.readContract({
            address: runtime.config.deployment.contract,
            abi: arenaAbi,
            functionName: "nextTournamentId"
          })
        ).toString();
        await worker.prepare("open-lobby", id);
      }
      const result = await worker.advance("open-lobby", id);
      console.log(
        JSON.stringify({
          tournamentId: id,
          purpose: "open-lobby",
          state: result.state,
          transactionHash: result.tx_hash
        })
      );
    } catch {
      console.log(
        "No new arena lobby opened; capacity or transaction reconciliation is pending."
      );
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, 30000));
  }
} finally {
  await runtime.pool.end();
}
