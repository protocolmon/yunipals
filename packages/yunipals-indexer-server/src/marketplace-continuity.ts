import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { CanonicalCursor } from "../../yunipals-indexer-client/src/events.js";
import { validateCanonicalCursor } from "../../yunipals-indexer-client/src/events.js";
import {
  confirmationPolicyKey,
  type ConfirmationPolicy
} from "../../yunipals-indexer-client/src/sources.js";
import { sqlIdentifier } from "./database.js";
import { parseIndexedEventTopics } from "./event-topics.js";
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
  qualifications: readonly MarketplaceQualification[],
  onProgress?: () => Promise<void>
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
    // Compare the complete consumed prefix in bounded pages. Large collections
    // must not require one full-history query beyond the reader's time limit.
    const oldHistory = await canonicalHistory(
      db,
      oldSchema,
      sourceId,
      boundary.number,
      onProgress
    );
    const newHistory = await canonicalHistory(
      db,
      schema,
      sourceId,
      boundary.number,
      onProgress
    );
    if (
      !oldHistory ||
      !newHistory ||
      oldHistory.count !== newHistory.count ||
      oldHistory.hash !== newHistory.hash
    )
      return replay("canonical_history_changed");
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
      historyHash: newHistory.hash,
      boundary,
      cursor: { ...cursor, releaseId: release.id }
    };
  });
}

type HistoryRow = Record<string, unknown> & {
  id: string;
  block_number: string;
  transaction_index: number;
  log_index: number;
  topics: string;
};

async function canonicalHistory(
  db: Pick<PoolClient, "query">,
  schema: string,
  sourceId: string,
  throughBlock: string,
  onProgress?: () => Promise<void>
) {
  const digest = createHash("sha256");
  let after: HistoryRow | undefined;
  let count = 0;
  for (;;) {
    const { rows } = await db.query<HistoryRow>(
      `SELECT e.*, EXISTS (
         SELECT 1 FROM ${schema}.transaction_candidate c
         WHERE c.chain_id=e.chain_id AND c.block_number=e.block_number
           AND c.block_hash=e.block_hash AND c.transaction_hash=e.transaction_hash
       ) AS needs_receipt
       FROM ${schema}.canonical_event e
       WHERE e.source_id=$1 AND e.block_number<=$2::bigint
         AND (e.block_number,e.transaction_index,e.log_index,e.id)>
           ($3::bigint,$4::integer,$5::integer,$6::text)
       ORDER BY e.block_number,e.transaction_index,e.log_index,e.id LIMIT 1000`,
      [
        sourceId,
        throughBlock,
        after?.block_number ?? "-1",
        after?.transaction_index ?? -1,
        after?.log_index ?? -1,
        after?.id ?? ""
      ]
    );
    for (const row of rows) {
      // Historical logs pad topics with trailing nulls; live logs do not.
      // The shared parser validates every row, including equal malformed input.
      let topics: string[];
      try {
        topics = parseIndexedEventTopics(row.topics);
      } catch {
        return null;
      }
      digest.update(manifestDigest({ ...row, topics })).update("\n");
      after = row;
      count++;
    }
    await onProgress?.();
    if (rows.length < 1000) return { count, hash: digest.digest("hex") };
  }
}
