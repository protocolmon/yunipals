import type { Pool, PoolClient } from "pg";
import {
  confirmationPolicyKey,
  type ConfirmationPolicy
} from "../../yunipals-indexer-client/src/sources.js";
import {
  validateCanonicalCursor,
  type BlockAnchor,
  type CanonicalCursor,
  type CanonicalEventRecord
} from "../../yunipals-indexer-client/src/events.js";
import { sqlIdentifier } from "./database.js";
import { indexerTransaction } from "./database.js";
import { readIndexerSourceStatus } from "./status.js";
import type { RegisteredRelease } from "./releases.js";
import { transactionEvidenceHash } from "./identity.js";
import { parseIndexedEventTopics } from "./event-topics.js";

export class CanonicalCursorInvalidated extends Error {}
export class CanonicalSourceUnavailable extends Error {}
type EventRow = {
  id: string;
  source_id: string;
  chain_id: number;
  address: string;
  name: string;
  args: string;
  abi_hash: string;
  block_number: string;
  block_hash: string;
  timestamp: string;
  transaction_hash: string;
  transaction_index: number;
  log_index: number;
  topics: string;
  data: string;
  needs_receipt: boolean;
};
type ReceiptRow = {
  chain_id: number;
  block_hash: string;
  transaction_hash: string;
  receipt: unknown;
  block: unknown;
  payload_hash: string;
};
const receiptKey = (hash: string, transaction: string) =>
  `${hash}:${transaction}`;

async function retainedAnchor(
  db: Pick<PoolClient, "query">,
  release: RegisteredRelease,
  chainId: number,
  anchor: BlockAnchor
) {
  const direct = await db.query<{ block_hash: string }>(
    `SELECT block_hash FROM ${sqlIdentifier(release.schema)}.chain_block
    WHERE chain_id=$1 AND block_number=$2::bigint`,
    [chainId, anchor.number]
  );
  if (direct.rows[0])
    return direct.rows[0].block_hash === anchor.hash ? "valid" : "changed";
  const retained = await db.query<{
    block_hash: string;
    witness_hash: string;
    canonical_witness: string | null;
  }>(
    `
    SELECT a.block_hash,a.witness_hash,b.block_hash AS canonical_witness
    FROM yunipals_indexer_control.chain_anchor a LEFT JOIN ${sqlIdentifier(release.schema)}.chain_block b
      ON b.chain_id=a.chain_id AND b.block_number=a.witness_number
    WHERE a.release_id=$1 AND a.chain_id=$2 AND a.block_number=$3::bigint`,
    [release.id, chainId, anchor.number]
  );
  const row = retained.rows[0];
  if (!row || row.canonical_witness !== row.witness_hash) return "expired";
  return row.block_hash === anchor.hash ? "valid" : "changed";
}

export async function readCanonicalPage(
  pool: Pool,
  release: RegisteredRelease,
  sourceId: string,
  policy: ConfirmationPolicy,
  options: {
    cursor?: CanonicalCursor | null;
    limit?: number;
    includeReceipts?: boolean;
    nowMs?: number;
    // Optional bounded RPC validation for durable worker cursors older than
    // the Ponder block witness window. Never accept this as a public input.
    verifyOldAnchor?: (
      anchor: BlockAnchor,
      chainId: number
    ) => Promise<boolean>;
  } = {}
) {
  const pageLimit = options.limit ?? 250;
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000)
    throw new Error("Invalid canonical page size.");
  const policyKey = confirmationPolicyKey(policy);
  const source = release.manifest.sources.find(
    (source) => source.id === sourceId
  );
  if (!source?.enabled || source.startBlock === null)
    throw new CanonicalSourceUnavailable("Source is disabled or unknown.");
  const cursor: CanonicalCursor = options.cursor ?? {
    version: 1,
    releaseId: release.id,
    sourceId,
    policy: policyKey,
    completed: null,
    target: null,
    after: null
  };
  validateCanonicalCursor(cursor);
  if (
    cursor.releaseId !== release.id ||
    cursor.sourceId !== sourceId ||
    cursor.policy !== policyKey
  )
    throw new CanonicalCursorInvalidated(
      "Cursor belongs to another release, source or policy."
    );
  const from = cursor.completed
    ? BigInt(cursor.completed.number) + 1n
    : BigInt(source.startBlock);
  if (
    options.includeReceipts &&
    source.receiptStartBlock !== undefined &&
    from < BigInt(source.receiptStartBlock)
  )
    throw new CanonicalSourceUnavailable(
      "Requested receipt history predates the registered receipt history floor."
    );
  const verified = new Set<string>();
  for (const anchor of [cursor.completed, cursor.target]) {
    if (!anchor) continue;
    const retained = await retainedAnchor(
      pool,
      release,
      source.chainId,
      anchor
    );
    if (retained === "changed")
      throw new CanonicalCursorInvalidated("Cursor anchor was reorged.");
    if (retained === "expired") {
      if (!options.verifyOldAnchor)
        throw new CanonicalCursorInvalidated(
          "Cursor anchor expired; refresh or verify it against canonical history."
        );
      if (!(await options.verifyOldAnchor(anchor, source.chainId)))
        throw new CanonicalCursorInvalidated(
          "Cursor anchor is no longer canonical."
        );
      verified.add(`${anchor.number}:${anchor.hash}`);
    }
  }
  return indexerTransaction(
    pool,
    async (db) => {
      const status = await readIndexerSourceStatus(
        db,
        release,
        sourceId,
        policy,
        { nowMs: options.nowMs }
      );
      if (
        !["ready", "catching_up"].includes(status.readiness.reason) ||
        !status.anchor ||
        status.readiness.availableThroughBlock === null
      ) {
        throw new CanonicalSourceUnavailable(
          status.errorCode ?? status.readiness.reason
        );
      }
      for (const anchor of [cursor.completed, cursor.target]) {
        if (!anchor) continue;
        const retained = await retainedAnchor(
          db,
          release,
          source.chainId,
          anchor
        );
        if (
          retained !== "valid" &&
          !(
            retained === "expired" &&
            verified.has(`${anchor.number}:${anchor.hash}`)
          )
        ) {
          throw new CanonicalCursorInvalidated(
            "Canonical cursor evidence changed during paging."
          );
        }
      }
      if (cursor.after) {
        const previous = await db.query(
          `SELECT 1 FROM ${sqlIdentifier(release.schema)}.canonical_event
        WHERE id=$1 AND source_id=$2 AND block_number=$3::bigint AND block_hash=$4 AND transaction_index=$5 AND log_index=$6`,
          [
            cursor.after.id,
            sourceId,
            cursor.after.blockNumber,
            cursor.after.blockHash,
            cursor.after.transactionIndex,
            cursor.after.logIndex
          ]
        );
        if (previous.rowCount !== 1)
          throw new CanonicalCursorInvalidated(
            "Previously applied event was reorged."
          );
      }
      const target = cursor.target ?? {
        number: status.anchor.number,
        hash: status.anchor.hash
      };
      if (BigInt(target.number) > status.readiness.availableThroughBlock)
        throw new CanonicalSourceUnavailable(
          "Indexer is recovering the cursor boundary."
        );
      if (
        cursor.completed &&
        BigInt(cursor.completed.number) > status.readiness.availableThroughBlock
      )
        throw new CanonicalSourceUnavailable(
          "Indexer has not recovered the previously completed cursor boundary."
        );
      if (
        cursor.completed &&
        BigInt(target.number) <= BigInt(cursor.completed.number)
      ) {
        return {
          events: [] as CanonicalEventRecord[],
          receipts: [] as ReceiptRow[],
          cursor,
          complete: true,
          waitingReceipt: false
        };
      }
      const rows = (
        await db.query<EventRow>(
          `SELECT e.*,e.block_number::text,e.timestamp::text,
      EXISTS(SELECT 1 FROM ${sqlIdentifier(release.schema)}.transaction_candidate c
        WHERE c.chain_id=e.chain_id AND c.block_hash=e.block_hash AND c.transaction_hash=e.transaction_hash) AS needs_receipt
      FROM ${sqlIdentifier(release.schema)}.canonical_event e
      WHERE e.source_id=$1 AND e.block_number>=$2::bigint AND e.block_number<=$3::bigint
      AND ($4::bigint IS NULL OR (e.block_number,e.transaction_index,e.log_index)>($4::bigint,$5::integer,$6::integer))
      ORDER BY e.block_number,e.transaction_index,e.log_index LIMIT $7`,
          [
            sourceId,
            String(from),
            target.number,
            cursor.after?.blockNumber ?? null,
            cursor.after?.transactionIndex ?? null,
            cursor.after?.logIndex ?? null,
            pageLimit + 1
          ]
        )
      ).rows;
      const requested: Array<{ blockHash: string; transactionHash: string }> =
        [];
      const identities = new Set<string>();
      let candidates = rows.slice(0, pageLimit);
      if (options.includeReceipts) {
        for (let index = 0; index < candidates.length; index++) {
          const event = candidates[index]!;
          if (!event.needs_receipt) continue;
          const key = receiptKey(event.block_hash, event.transaction_hash);
          if (!identities.has(key)) {
            if (requested.length === 16) {
              candidates = candidates.slice(0, index);
              break;
            }
            identities.add(key);
            requested.push({
              blockHash: event.block_hash,
              transactionHash: event.transaction_hash
            });
          }
        }
      }
      const evidence = requested.length
        ? (
            await db.query<ReceiptRow>(
              `SELECT r.* FROM yunipals_indexer_control.transaction_evidence r
      JOIN jsonb_to_recordset($2::jsonb) AS x("blockHash" text,"transactionHash" text)
        ON r.block_hash=x."blockHash" AND r.transaction_hash=x."transactionHash" WHERE r.chain_id=$1`,
              [source.chainId, JSON.stringify(requested)]
            )
          ).rows
        : [];
      const byReceipt = new Map(
        evidence.map((row) => [
          receiptKey(row.block_hash, row.transaction_hash),
          row
        ])
      );
      const events: CanonicalEventRecord[] = [];
      const receipts = new Map<string, ReceiptRow>();
      let bytes = 0;
      let waitingReceipt = false;
      for (const row of candidates) {
        if (
          row.chain_id !== source.chainId ||
          row.address !== source.address ||
          row.abi_hash !== source.abiHash ||
          !source.events.includes(row.name)
        ) {
          throw new CanonicalSourceUnavailable(
            "Indexed event does not match its source decoder."
          );
        }
        const key = receiptKey(row.block_hash, row.transaction_hash);
        const receipt =
          options.includeReceipts && row.needs_receipt
            ? byReceipt.get(key)
            : undefined;
        if (options.includeReceipts && row.needs_receipt && !receipt) {
          waitingReceipt = true;
          break;
        }
        if (
          receipt &&
          transactionEvidenceHash(receipt.receipt, receipt.block) !==
            receipt.payload_hash
        )
          throw new Error("Receipt evidence checksum mismatch.");
        const event: CanonicalEventRecord = {
          id: row.id,
          sourceId: row.source_id,
          chainId: row.chain_id,
          address: row.address,
          name: row.name,
          args: JSON.parse(row.args),
          abiHash: row.abi_hash,
          blockNumber: row.block_number,
          blockHash: row.block_hash,
          timestamp: row.timestamp,
          transactionHash: row.transaction_hash,
          transactionIndex: row.transaction_index,
          logIndex: row.log_index,
          topics: parseIndexedEventTopics(row.topics),
          data: row.data
        };
        const size =
          Buffer.byteLength(JSON.stringify(event)) +
          (receipt && !receipts.has(key)
            ? Buffer.byteLength(JSON.stringify(receipt))
            : 0);
        if (bytes + size > 8_000_000) {
          if (!events.length)
            throw new Error("Canonical evidence exceeds page budget.");
          break;
        }
        bytes += size;
        events.push(event);
        if (receipt) receipts.set(key, receipt);
      }
      const complete = !waitingReceipt && events.length === rows.length;
      const last = events.at(-1);
      const next: CanonicalCursor = complete
        ? { ...cursor, completed: target, target: null, after: null }
        : {
            ...cursor,
            target,
            after: last
              ? {
                  id: last.id,
                  blockNumber: last.blockNumber,
                  blockHash: last.blockHash,
                  transactionIndex: last.transactionIndex,
                  logIndex: last.logIndex
                }
              : cursor.after
          };
      return {
        events,
        receipts: [...receipts.values()],
        cursor: next,
        complete,
        waitingReceipt
      };
    },
    true
  );
}
