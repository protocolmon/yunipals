import { arenaRuntime } from "./runtime";
import { StrategyCipher } from "./crypto";
import { ArenaRefereeApi } from "./refereeApi";
import {
  ArenaAdjudicator,
  productionValidator,
  refereeSchema
} from "./adjudication";

const root = process.env.ARENA_REPOSITORY_ROOT;
const key = process.env.OPENAI_API_KEY;
if (!root || !key)
  throw new Error("Referee repository root and private API key are required.");
const runtime = await arenaRuntime();
const adjudicator = new ArenaAdjudicator(
  runtime.pool,
  new StrategyCipher(runtime.config.encryptionKey),
  new ArenaRefereeApi(runtime.pool, key),
  refereeSchema(root),
  productionValidator(root)
);
let stopped = false;
process.once("SIGTERM", () => {
  stopped = true;
});
process.once("SIGINT", () => {
  stopped = true;
});
while (!stopped) {
  try {
    // Only this provider worker has the OpenAI credential. Admission polls the DB.
    await runtime.identityAnalysis.step(
      key,
      Number(process.env.ARENA_IDENTITY_ALLOWANCE_MICROUSD ?? "0"),
      Date.parse(process.env.ARENA_IDENTITY_ALLOWANCE_UNTIL ?? "")
    );
    // One unfinished tournament per worker tick. Claims and media run separately.
    // Deadlines and finalized projection readiness are rechecked at submission.
    const row = (
      await runtime.pool.query<{ id: string }>(
        `SELECT t.id::text FROM yunipals_arena.tournament t
       JOIN yunipals_arena.deployment d ON d.id=t.deployment
       JOIN yunipals_arena.frozen_input f ON f.deployment=t.deployment AND f.tournament_id=t.id
       LEFT JOIN yunipals_arena.adjudication a ON a.deployment=t.deployment AND a.tournament_id=t.id
       WHERE t.deployment=$1 AND t.state->>'phase'='resolving' AND a.tournament_id IS NULL
       AND f.revealed_at IS NOT NULL AND f.input_hash=t.state->>'inputHash'
       AND NOT d.halted AND d.finalized_at>now()-interval '3 minutes'
       AND (t.state->>'deadline')::bigint>extract(epoch FROM now())+60
       AND NOT EXISTS (SELECT 1 FROM yunipals_arena.provider_task p
           WHERE p.deployment=t.deployment AND p.tournament_id=t.id AND p.kind='referee'
           AND p.state IN ('failed','incomplete','cancelled','uncertain'))
       ORDER BY t.id LIMIT 1`,
        [runtime.config.deployment.id]
      )
    ).rows[0];
    if (row) {
      const result = await adjudicator.step(
        runtime.config.deployment.id,
        row.id
      );
      console.log(
        JSON.stringify({ tournamentId: row.id, refereeState: result.state })
      );
    }
  } catch {
    // Provider errors and private input never enter service logs.
    console.error(
      "Arena referee step needs attention; existing tasks and candidates retained."
    );
  }
  if (!stopped) await new Promise((resolve) => setTimeout(resolve, 15_000));
}
await runtime.pool.end();
