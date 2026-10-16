import { arenaRuntime } from "./runtime";
import { StrategyCipher } from "./crypto";
import { ArenaMediaApi } from "./mediaApi";
import { ArenaMedia } from "./media";

const root = process.env.ARENA_REPOSITORY_ROOT,
  storage = process.env.ARENA_MEDIA_ROOT,
  key = process.env.RUNWARE_API_KEY;
if (!root || !storage || !key)
  throw new Error(
    "Media repository, private storage and Runware key are required."
  );
const runtime = await arenaRuntime();
const worker = new ArenaMedia(
  runtime.pool,
  new StrategyCipher(runtime.config.encryptionKey),
  new ArenaMediaApi(runtime.pool, key),
  root,
  storage
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
    let id: string | undefined;
    try {
      id = (
        await runtime.pool.query<{ id: string }>(
          `SELECT t.id::text FROM yunipals_arena.tournament t
         JOIN yunipals_arena.adjudication a ON a.deployment=t.deployment AND a.tournament_id=t.id
         JOIN yunipals_arena.deployment d ON d.id=t.deployment
         LEFT JOIN yunipals_arena.media_job m ON m.deployment=t.deployment AND m.tournament_id=t.id
         WHERE t.deployment=$1 AND t.state->>'phase'='settled' AND t.state->>'resultHash'=a.outcome_hash
           AND a.state='valid' AND (m.state IS NULL OR m.state NOT IN ('ready','needs-attention'))
           AND NOT d.halted AND d.finalized_at>now()-interval '3 minutes'
         ORDER BY coalesce(m.updated_at,'epoch'::timestamptz),t.id LIMIT 1`,
          [runtime.config.deployment.id]
        )
      ).rows[0]?.id;
      if (id) {
        const result = await worker.step(runtime.config.deployment.id, id);
        console.log(
          JSON.stringify({ tournamentId: id, mediaState: result.state })
        );
      }
    } catch {
      // Saved provider UUIDs and successful assets are retained for retrieval.
      // Pause after repeated technical failures without buying replacements.
      if (id)
        await runtime.pool.query(
          `UPDATE yunipals_arena.media_job SET state=CASE WHEN detail='retry-pending' THEN 'needs-attention' ELSE 'retrying' END,
         detail='retry-pending',updated_at=now() WHERE deployment=$1 AND tournament_id=$2 AND state<>'ready'`,
          [runtime.config.deployment.id, id]
        );
      console.error(
        "Arena media step needs recovery; no replacement assets submitted."
      );
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
} finally {
  await runtime.pool.end();
}
