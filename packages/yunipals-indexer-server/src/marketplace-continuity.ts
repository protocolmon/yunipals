import type { CanonicalCursor } from "../../yunipals-indexer-client/src/events.js";
import { validateCanonicalCursor } from "../../yunipals-indexer-client/src/events.js";
import {
  confirmationPolicyKey,
  type ConfirmationPolicy
} from "../../yunipals-indexer-client/src/sources.js";
import { sqlIdentifier } from "./database.js";
import { manifestDigest, transactionEvidenceHash } from "./identity.js";
import { retainedAnchor } from "./paging.js";
import { loadIndexerRelease, readBoundRuntime } from "./releases.js";
import type { IndexerReader } from "./readers.js";

export type MarketplaceQualification = {
  chain_id: number;
  release_id: string;
  source_id: string;
  event_id: string;
  block_hash: string;
  transaction_hash: string;
  source_payload_hash: string;
};

/** Read-only, database-only proof for a release handover. Missing retained
 * witnesses fail closed; an operator cannot substitute an unchecked cursor.
 * The previous release may be stopped, but its registered build must still
 * exist. All comparisons run in the candidate reader's consistent snapshot. */
export async function reviewMarketplaceContinuity(
  reader: IndexerReader,
  previousReleaseId: string,
  sourceId: string,
  policy: ConfirmationPolicy,
  cursor: CanonicalCursor,
  qualifications: readonly MarketplaceQualification[]
) {
  const replay = (reason: string) => ({ mode: "replay" as const, reason });
  try {
    validateCanonicalCursor(cursor);
  } catch {
    return replay("invalid_cursor");
  }
  if (
    cursor.releaseId !== previousReleaseId ||
    cursor.sourceId !== sourceId ||
    cursor.policy !== confirmationPolicyKey(policy)
  )
    return replay("cursor_identity_changed");
  const boundary = cursor.target ?? cursor.completed;
  if (!boundary) return replay("no_completed_history");

  return reader.snapshot(sourceId, policy, async (db, { release, status }) => {
    const previous = await loadIndexerRelease(db, previousReleaseId);
    const oldSource = previous.manifest.sources.find((s) => s.id === sourceId);
    const source = release.manifest.sources.find((s) => s.id === sourceId);
    if (
      !source ||
      !oldSource ||
      manifestDigest(source) !== manifestDigest(oldSource)
    )
      return replay("source_definition_changed");
    await readBoundRuntime(db, previous);
    if (
      !["ready", "catching_up"].includes(status.readiness.reason) ||
      !status.anchor ||
      status.readiness.availableThroughBlock === null ||
      status.readiness.availableThroughBlock < BigInt(boundary.number)
    )
      return replay("candidate_history_unavailable");
    for (const anchor of [cursor.completed, cursor.target]) {
      if (!anchor) continue;
      for (const selected of [previous, release])
        if (
          (await retainedAnchor(db, selected, source.chainId, anchor)) !==
          "valid"
        )
          return replay("canonical_boundary_unverified");
    }
    const oldSchema = sqlIdentifier(previous.schema);
    const schema = sqlIdentifier(release.schema);
    // Compare in both directions, including decoded args, raw logs, ordering,
    // and whether a full receipt was required. Receipt payloads are immutable
    // and shared by both releases in the control ledger.
    const events = (
      selected: string
    ) => `SELECT e.*, c.transaction_hash IS NOT NULL AS needs_receipt
      FROM ${selected}.canonical_event e LEFT JOIN (
        SELECT DISTINCT chain_id,block_number,block_hash,transaction_hash
        FROM ${selected}.transaction_candidate WHERE chain_id=$3 AND block_number<=$2::bigint
      ) c ON c.chain_id=e.chain_id AND c.block_number=e.block_number
        AND c.block_hash=e.block_hash AND c.transaction_hash=e.transaction_hash
      WHERE e.source_id=$1 AND e.block_number<=$2::bigint`;
    const comparison = (
      await db.query<{ matches: boolean; history_hash: string }>(
        `WITH old_events AS MATERIALIZED (${events(oldSchema)}),
       new_events AS MATERIALIZED (${events(schema)})
       SELECT NOT EXISTS (SELECT 1 FROM old_events o FULL JOIN new_events n USING(id)
         WHERE to_jsonb(o) IS DISTINCT FROM to_jsonb(n)) AS matches,
       (SELECT encode(sha256(convert_to(coalesce(string_agg(
         encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex'),'' ORDER BY n.id),''),'UTF8')),'hex')
         FROM new_events n) AS history_hash`,
        [sourceId, boundary.number, source.chainId]
      )
    ).rows[0]!;
    if (!comparison.matches) return replay("canonical_history_changed");
    if (cursor.after) {
      const after = cursor.after;
      const exists = await db.query(
        `SELECT 1 FROM ${schema}.canonical_event WHERE id=$1 AND source_id=$2
         AND block_number=$3::bigint AND block_hash=$4 AND transaction_index=$5 AND log_index=$6`,
        [
          after.id,
          sourceId,
          after.blockNumber,
          after.blockHash,
          after.transactionIndex,
          after.logIndex
        ]
      );
      if (exists.rowCount !== 1) return replay("cursor_event_missing");
    }
    // Re-qualify only proofs actually present in the candidate, within the
    // consumed prefix. Do not relabel historical proofs on manifest equality.
    for (let start = 0; start < qualifications.length; start += 500) {
      const batch = qualifications.slice(start, start + 500);
      if (
        batch.some(
          (q) =>
            q.chain_id !== source.chainId ||
            q.release_id !== previousReleaseId ||
            q.source_id !== sourceId
        )
      )
        return replay("qualification_identity_changed");
      const checked = await db.query<{
        receipt: unknown;
        block: unknown;
        payload_hash: string;
      }>(
        `SELECT r.receipt,r.block,r.payload_hash
          FROM jsonb_to_recordset($1::jsonb) q(event_id text,block_hash text,
            transaction_hash text,source_payload_hash text)
          JOIN ${schema}.canonical_event e ON e.id=q.event_id AND e.source_id=$2
          JOIN yunipals_indexer_control.transaction_evidence r ON r.chain_id=e.chain_id
            AND r.block_hash=e.block_hash AND r.transaction_hash=e.transaction_hash
          WHERE e.block_hash=q.block_hash AND e.transaction_hash=q.transaction_hash
            AND r.payload_hash=q.source_payload_hash
            AND (e.block_number<=coalesce($3::bigint,-1) OR
              ($4::bigint IS NOT NULL AND (e.block_number,e.transaction_index,e.log_index)<=($4::bigint,$5::integer,$6::integer)))
        `,
        [
          JSON.stringify(batch),
          sourceId,
          cursor.completed?.number ?? null,
          cursor.after?.blockNumber ?? null,
          cursor.after?.transactionIndex ?? null,
          cursor.after?.logIndex ?? null
        ]
      );
      if (
        checked.rowCount !== batch.length ||
        checked.rows.some(
          (r) => transactionEvidenceHash(r.receipt, r.block) !== r.payload_hash
        )
      )
        return replay("receipt_evidence_unverified");
    }
    return {
      mode: "preserve" as const,
      reason: "verified_unchanged_history",
      previousReleaseId,
      sourceDefinitionHash: manifestDigest(source),
      historyHash: comparison.history_hash,
      boundary,
      cursor: { ...cursor, releaseId: release.id }
    };
  });
}
