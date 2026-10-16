import { ArenaControl, type ControlPurpose } from "./control";
import { arenaSigner } from "./config";
import { arenaRuntime } from "./runtime";

const key = process.env.ARENA_REFEREE_KEY_FILE;
const cap = process.env.ARENA_MAX_CONTROL_EXECUTION_FEE_WEI;
if (!key || !cap)
  throw new Error(
    "Dedicated referee key and control execution fee cap are required."
  );
const runtime = await arenaRuntime();
const control = new ArenaControl(
  runtime.service,
  runtime.compiler,
  runtime.clients.get(8453)!,
  arenaSigner(key),
  BigInt(cap),
  undefined,
  process.env.ARENA_MEDIA_ROOT
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
      const deployment = runtime.config.deployment.id;
      const pending = (
        await runtime.pool.query<{ id: string; purpose: ControlPurpose }>(
          `SELECT tournament_id::text AS id,purpose FROM yunipals_arena.transaction_intent
         WHERE deployment=$1 AND purpose IN ('finalize-island','freeze-input','expire','release-payouts') AND state IN ('prepared','submitted','mined') ORDER BY nonce LIMIT 1`,
          [deployment]
        )
      ).rows[0];
      let action = pending;
      if (!action) {
        action = (
          await runtime.pool.query<{ id: string; purpose: ControlPurpose }>(
            `WITH work AS (SELECT t.id::text AS id, CASE
            WHEN state->>'phase'='settled' AND state->>'videoHash' IS NULL
              AND EXISTS (SELECT 1 FROM yunipals_arena.media_job m WHERE m.deployment=t.deployment AND m.tournament_id=t.id AND m.state='ready') THEN 'release-payouts'
            WHEN state->>'phase'<>'settled' AND (state->>'deadline')::bigint>0
              AND (state->>'deadline')::bigint + CASE WHEN state->>'phase'='strategies' THEN 86400 ELSE 0 END <=extract(epoch FROM now()) THEN 'expire'
            WHEN state->>'phase'='open' AND state->>'randomWord' IS NOT NULL AND state->>'islandId' IS NULL THEN 'finalize-island'
            WHEN state->>'phase'='strategies' AND (state->>'deadline')::bigint+86400>extract(epoch FROM now())+30
              AND ((state->>'deadline')::bigint<=extract(epoch FROM now())
                OR (SELECT count(*) FROM yunipals_arena.submission s WHERE s.deployment=t.deployment AND s.tournament_id=t.id)=4) THEN 'freeze-input'
            END AS purpose FROM yunipals_arena.tournament t
            JOIN yunipals_arena.deployment d ON d.id=t.deployment
            WHERE t.deployment=$1 AND state->>'phase' IN ('open','strategies','resolving','settled')
              AND NOT d.halted AND d.finalized_at>now()-interval '3 minutes')
           SELECT * FROM work w WHERE purpose IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM yunipals_arena.transaction_intent i WHERE i.deployment=$1 AND i.tournament_id=w.id::numeric AND i.purpose=w.purpose)
           ORDER BY CASE WHEN purpose='expire' THEN 0 ELSE 1 END,id::numeric LIMIT 1`,
            [deployment]
          )
        ).rows[0];
        if (action) await control.prepare(action.purpose, action.id);
      }
      if (action) {
        const result = await control.advance(action.purpose, action.id);
        console.log(
          JSON.stringify({
            tournamentId: action.id,
            purpose: action.purpose,
            state: result.state,
            transactionHash: result.tx_hash
          })
        );
      }
    } catch {
      console.error(
        "Arena progression needs attention; saved input and transactions retained."
      );
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
} finally {
  await runtime.pool.end();
}
