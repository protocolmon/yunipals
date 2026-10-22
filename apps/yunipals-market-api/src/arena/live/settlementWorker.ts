import { ArenaSettlement } from "./settlement";
import { arenaSigner } from "./config";
import { arenaRuntime } from "./runtime";

if (
  !process.env.ARENA_REFEREE_KEY_FILE ||
  !process.env.ARENA_MAX_SETTLEMENT_EXECUTION_FEE_WEI
)
  throw new Error(
    "Dedicated referee signer and execution fee cap are required."
  );
const runtime = await arenaRuntime();
const settlement = new ArenaSettlement(
  runtime.pool,
  runtime.clients.get(8453)!,
  arenaSigner(process.env.ARENA_REFEREE_KEY_FILE),
  runtime.config.deployment.id,
  runtime.config.deployment.contract,
  BigInt(process.env.ARENA_MAX_SETTLEMENT_EXECUTION_FEE_WEI)
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
      const pending = (
        await runtime.pool.query<{ id: string }>(
          `SELECT tournament_id::text AS id FROM yunipals_arena.transaction_intent
         WHERE deployment=$1 AND purpose='settle' AND state IN ('prepared','submitted','mined')
         ORDER BY nonce LIMIT 1`,
          [runtime.config.deployment.id]
        )
      ).rows[0];
      let id = pending?.id;
      if (!id) {
        id = (
          await runtime.pool.query<{ id: string }>(
            `SELECT t.id::text FROM yunipals_arena.tournament t
           JOIN yunipals_arena.adjudication a ON a.deployment=t.deployment AND a.tournament_id=t.id
           WHERE t.deployment=$1 AND t.state->>'phase'='resolving' AND a.state='valid'
           AND (t.state->>'deadline')::bigint>extract(epoch FROM now())+90
           AND NOT EXISTS (SELECT 1 FROM yunipals_arena.transaction_intent i
             WHERE i.deployment=t.deployment AND i.tournament_id=t.id AND i.purpose='settle')
           ORDER BY t.id LIMIT 1`,
            [runtime.config.deployment.id]
          )
        ).rows[0]?.id;
        if (id) await settlement.prepare(id);
      }
      if (id) {
        const result = await settlement.advance(id);
        console.log(
          JSON.stringify({
            tournamentId: id,
            settlementState: result.state,
            transactionHash: result.tx_hash
          })
        );
      }
    } catch {
      console.error(
        "Arena settlement needs reconciliation; no replacement transaction signed."
      );
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
} finally {
  await runtime.pool.end();
}
