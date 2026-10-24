/** Pure committed-schema opening adoption. No CLI, migrations or host actions. */
import { createHash } from "node:crypto";
const RELEASE="0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3";
const DEPLOYMENT="8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca";
const PRIVATE = [
  "submission",
  "fighter_snapshot",
  "frozen_input",
  "admission",
  "provider_task",
  "transaction_intent",
  "adjudication",
  "media_job",
  "provider_action_evidence",
  "media_publication",
  "client_transaction",
  "client_receipt_history",
  "transaction_receipt_history",
  "opening_action_observation",
  "identity_job"
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
  JSON.stringify(value, function (_, v) {
    return v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        )
      : v;
  });
const digest = (value) => hash(canonical(value));
class AdoptionFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const demand = (value, code) => {
  if (!value) throw new AdoptionFailure(code);
};
const equal = (a, b) => canonical(a) === canonical(b);

export function originBinding(observed) {
  const t = observed.tournament;
  demand(
    t && t.deployment === DEPLOYMENT && observed.releaseId === RELEASE,
    "actual_selected_native_origin_required"
  );
  // Moving framework checkpoints/head timestamps are checked by the actual
  // reader/verifier, but are not substituted for stable reviewed business state.
  return {
    releaseId: observed.releaseId,
    id: t.id,
    incarnation: t.incarnation,
    opened: t.opened,
    last: t.last,
    inputFrozen: t.inputFrozen,
    stateSha256: digest(t.state)
  };
}

export async function reviewOrigins(db, source, verify, markers) {
  const actualMarkers = (
    await db.query(
      "SELECT version,checksum FROM yunipals_arena.operational_migration ORDER BY version"
    )
  ).rows;
  demand(
    equal(actualMarkers, markers),
    "exact_twelve_official_migrations_required"
  );
  const target = (
    await db.query(
      `SELECT current_database() AS database,current_setting('port') AS port,current_user AS owner,
    d.id,d.contract,d.start_block::text,d.halted,d.indexer_mode,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS other_sessions
    FROM yunipals_arena.deployment d WHERE d.id=$1`,
      [DEPLOYMENT]
    )
  ).rows;
  demand(
    target.length === 1 &&
      target[0].database === "yunipals_arena" &&
      target[0].port === "15438" &&
      target[0].owner === "yunipals_arena_owner" &&
      target[0].id === DEPLOYMENT &&
      target[0].contract.toLowerCase() === DEPLOYMENT.slice(5) &&
      target[0].halted === true &&
      target[0].indexer_mode === "unified" &&
      target[0].other_sessions === 0,
    "halted_unified_drained_owner_target_required"
  );
  const identities = (
    await db.query(
      `SELECT deployment,tournament_id::text AS id,incarnation,cipher_context,created_at::text FROM yunipals_arena.tournament_identity ORDER BY deployment,tournament_id,incarnation LIMIT 3`
    )
  ).rows;
  demand(
    identities.length === 2 &&
      identities.every(
        (r) =>
          r.deployment === DEPLOYMENT &&
          r.incarnation === "legacy" &&
          r.cipher_context === `${r.deployment}/${r.id}`
      ),
    "exact_two_actual_legacy_origins_required"
  );
  const observations = [];
  for (const identity of identities) {
    const observed = await source.read(identity.id);
    originBinding(observed);
    await verify(observed);
    observations.push(observed);
  }
  return {
    target: { ...target[0], other_sessions: 0 },
    identities,
    origins: observations.map(originBinding),
    observations
  };
}

export async function privateSeal(db) {
  const bodies = {};
  for (const table of PRIVATE) {
    // Every selected row remains inside the host process/audit. Exclude only
    // the reviewed cascading identity field, retaining UUIDs/ciphertexts/spend.
    const rows = (
      await db.query(
        `SELECT to_jsonb(t)-'incarnation' AS body FROM yunipals_arena.${table} t ORDER BY (to_jsonb(t)-'incarnation')::text LIMIT 2001`
      )
    ).rows;
    demand(rows.length <= 2000, "bounded_actual_private_state_required");
    bodies[table] = {
      count: rows.length,
      sha256: digest(rows.map((r) => r.body))
    };
  }
  const aad = (
    await db.query(
      `SELECT deployment,tournament_id::text,cipher_context,created_at::text FROM yunipals_arena.tournament_identity ORDER BY deployment,tournament_id,created_at`
    )
  ).rows;
  const selectors = (
    await db.query(
      `SELECT jsonb_build_object('selection',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text),'[]') FROM yunipals_arena.source_selection s),'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY to_jsonb(h)::text),'[]') FROM yunipals_arena.source_switch_history h)) AS body`
    )
  ).rows[0].body;
  return {
    tables: bodies,
    aadSha256: digest(aad),
    selectorsSha256: digest(selectors)
  };
}

export async function adoptOrigins(
  db,
  reviewed,
  source,
  verify,
  adopt,
  markers
) {
  // This is the existing source lease key used by ordinary compatible consumers;
  // the official adoption function also takes the original projector key.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `arena/source-selection/${DEPLOYMENT}`
  ]);
  const current = await reviewOrigins(db, source, verify, markers);
  demand(
    equal(current.identities, reviewed.identities) &&
      equal(current.origins, reviewed.origins),
    "fresh_exact_origin_review_required"
  );
  const before = await privateSeal(db);
  demand(
    equal(before, reviewed.privateSeal),
    "reviewed_private_baseline_changed"
  );
  for (const observed of current.observations) await adopt(db, observed);
  for (const observed of current.observations) {
    const again = await source.read(observed.tournament.id);
    demand(
      equal(originBinding(again), originBinding(observed)),
      "origin_changed_during_owner_adoption"
    );
    await verify(again);
  }
  demand(
    equal(await privateSeal(db), before),
    "retained_private_history_or_selector_changed"
  );
  const after = (
    await db.query(
      `SELECT tournament_id::text AS id,incarnation,opened_event_id,opened_block_hash,bound_release_id,cipher_context FROM yunipals_arena.tournament_identity ORDER BY tournament_id`
    )
  ).rows;
  demand(
    after.length === 2 &&
      current.observations.every((o) =>
        after.some(
          (r) =>
            r.id === o.tournament.id &&
            r.incarnation === o.tournament.incarnation &&
            r.opened_event_id === o.tournament.opened.id &&
            r.opened_block_hash === o.tournament.opened.blockHash &&
            r.bound_release_id === RELEASE &&
            r.cipher_context === `${DEPLOYMENT}/${r.id}`
        )
      ),
    "official_adoption_result_not_observed"
  );
  return { privateSeal: before, adopted: 2, sourceSelectorChanged: false };
}

