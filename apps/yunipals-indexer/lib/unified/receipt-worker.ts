import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { formatTransactionReceipt, type RpcTransactionReceipt } from "viem";
import { seaportDeployment } from "../../../../packages/yunipals-market-core/src/registry.js";
import { sqlIdentifier } from "../../../../packages/yunipals-indexer-server/src/database.js";
import { parseIndexedEventTopics } from "../../../../packages/yunipals-indexer-server/src/event-topics.js";
import { indexerTransaction } from "./control-schema.js";
import { readBoundRuntime, type RegisteredRelease } from "./releases.js";
import type { EvidenceRpc } from "./rpc.js";
import {
  transactionEvidenceHash,
  validateTransactionReceipt,
  verifyReceiptRuntime,
  type ExpectedReceiptLog,
  type ReceiptCandidate
} from "./receipt-validation.js";

type JobRow = {
  chain_id: number;
  block_number: string;
  block_hash: string;
  transaction_hash: string;
  lease_id: string;
  attempts: number;
};
const candidateOf = (job: JobRow): ReceiptCandidate => ({
  chainId: job.chain_id,
  blockNumber: BigInt(job.block_number),
  blockHash: job.block_hash,
  transactionHash: job.transaction_hash
});
function limit(value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error("Invalid receipt worker batch size.");
  return value;
}

export async function queueReceiptCandidates(
  pool: Pool,
  release: RegisteredRelease,
  chainId: number,
  batch = 128
): Promise<number> {
  limit(batch, 1000);
  return indexerTransaction(pool, async (db) => {
    const runtime = await readBoundRuntime(db, release);
    const through = runtime.chains.find(
      (chain) => chain.chainId === chainId
    )?.completeThroughBlock;
    if (!runtime.running || through === undefined || through === null) return 0;
    type Position = {
      block_number: string;
      block_hash: string;
      transaction_hash: string;
    };
    await db.query(
      `INSERT INTO yunipals_indexer_control.receipt_discovery(release_id,chain_id)
      VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [release.id, chainId]
    );
    const cursor = (
      await db.query<{
        block_number: string | null;
        block_hash: string | null;
        transaction_hash: string | null;
        previous_position: Position | null;
      }>(
        `
      SELECT block_number::text,block_hash,transaction_hash,previous_position
      FROM yunipals_indexer_control.receipt_discovery WHERE release_id=$1 AND chain_id=$2 FOR UPDATE`,
        [release.id, chainId]
      )
    ).rows[0]!;
    const current = async (position: Position | null) =>
      position !== null &&
      (
        await db.query(
          `
      SELECT 1 FROM ${sqlIdentifier(release.schema)}.transaction_candidate
      WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3 AND transaction_hash=$4`,
          [
            chainId,
            position.block_number,
            position.block_hash,
            position.transaction_hash
          ]
        )
      ).rowCount === 1;
    let after: Position | null =
      cursor.block_number === null ||
      cursor.block_hash === null ||
      cursor.transaction_hash === null
        ? null
        : {
            block_number: cursor.block_number,
            block_hash: cursor.block_hash,
            transaction_hash: cursor.transaction_hash
          };
    if (after && !(await current(after))) {
      after = (await current(cursor.previous_position))
        ? cursor.previous_position
        : null;
    }
    const next = (
      await db.query<Position>(
        `SELECT block_number::text,block_hash,transaction_hash
      FROM ${sqlIdentifier(release.schema)}.transaction_candidate
      WHERE chain_id=$1 AND block_number<=$2::bigint
        AND ($3::bigint IS NULL OR (block_number,transaction_hash)>($3::bigint,$4::text))
      ORDER BY block_number,transaction_hash LIMIT $5`,
        [
          chainId,
          String(through),
          after?.block_number ?? null,
          after?.transaction_hash ?? null,
          batch
        ]
      )
    ).rows;
    if (!next.length) {
      // Persist a rewind even when its replacement branch has no candidates.
      if (
        (after?.block_hash ?? null) !== cursor.block_hash ||
        (after?.transaction_hash ?? null) !== cursor.transaction_hash ||
        (after?.block_number ?? null) !== cursor.block_number
      )
        await db.query(
          `UPDATE yunipals_indexer_control.receipt_discovery
        SET block_number=$3,block_hash=$4,transaction_hash=$5,previous_position=NULL WHERE release_id=$1 AND chain_id=$2`,
          [
            release.id,
            chainId,
            after?.block_number ?? null,
            after?.block_hash ?? null,
            after?.transaction_hash ?? null
          ]
        );
      return 0;
    }
    const result = await db.query(
      `INSERT INTO yunipals_indexer_control.receipt_job(chain_id,block_hash,transaction_hash,block_number)
      SELECT $1,x.block_hash,x.transaction_hash,x.block_number::bigint
      FROM jsonb_to_recordset($2::jsonb) AS x(block_number text,block_hash text,transaction_hash text)
      WHERE NOT EXISTS(SELECT 1 FROM yunipals_indexer_control.transaction_evidence e
        WHERE e.chain_id=$1 AND e.block_hash=x.block_hash AND e.transaction_hash=x.transaction_hash)
      ON CONFLICT DO NOTHING`,
      [chainId, JSON.stringify(next)]
    );
    const last = next.at(-1)!;
    await db.query(
      `UPDATE yunipals_indexer_control.receipt_discovery SET block_number=$3,block_hash=$4,
      transaction_hash=$5,previous_position=$6 WHERE release_id=$1 AND chain_id=$2`,
      [
        release.id,
        chainId,
        last.block_number,
        last.block_hash,
        last.transaction_hash,
        after
          ? JSON.stringify({
              block_number: after.block_number,
              block_hash: after.block_hash,
              transaction_hash: after.transaction_hash
            })
          : null
      ]
    );
    return result.rowCount ?? 0;
  });
}

export async function claimReceiptJobs(
  pool: Pool,
  release: RegisteredRelease,
  chainId: number,
  batch = 8
): Promise<JobRow[]> {
  limit(batch, 32);
  const lease = randomUUID();
  return indexerTransaction(pool, async (db) => {
    const runtime = await readBoundRuntime(db, release);
    const through = runtime.chains.find(
      (chain) => chain.chainId === chainId
    )?.completeThroughBlock;
    if (!runtime.running || through === undefined || through === null)
      return [];
    return (
      await db.query<JobRow>(
        `WITH due AS (
      SELECT j.chain_id,j.block_hash,j.transaction_hash FROM yunipals_indexer_control.receipt_job j
      JOIN ${sqlIdentifier(release.schema)}.transaction_candidate c
        ON c.chain_id=j.chain_id AND c.block_hash=j.block_hash AND c.transaction_hash=j.transaction_hash
      WHERE j.chain_id=$1 AND c.block_number<=$2::bigint AND j.next_attempt_at<=clock_timestamp()
        AND (j.lease_until IS NULL OR j.lease_until<clock_timestamp())
      ORDER BY j.block_number,j.transaction_hash LIMIT $3 FOR UPDATE OF j SKIP LOCKED
    ) UPDATE yunipals_indexer_control.receipt_job j SET lease_id=$4,lease_until=clock_timestamp()+interval '90 seconds',attempts=j.attempts+1
      FROM due WHERE j.chain_id=due.chain_id AND j.block_hash=due.block_hash AND j.transaction_hash=due.transaction_hash
      RETURNING j.chain_id,j.block_number::text,j.block_hash,j.transaction_hash,j.lease_id,j.attempts`,
        [chainId, String(through), batch, lease]
      )
    ).rows;
  });
}

export async function enrichReceiptJob(
  pool: Pool,
  release: RegisteredRelease,
  job: JobRow,
  rpc: EvidenceRpc
): Promise<"stored" | "retry" | "orphaned" | "superseded"> {
  const candidate = candidateOf(job);
  let code = "receipt_rpc_unavailable";
  try {
    if ((await rpc.chainId()) !== candidate.chainId)
      throw new Error("Receipt RPC chain mismatch.");
    const known = await pool.query<{
      address: string;
      log_index: number;
      transaction_index: number;
      data: string;
      topics: string;
    }>(
      `SELECT address,log_index,transaction_index,data,topics FROM ${sqlIdentifier(release.schema)}.canonical_event
       WHERE chain_id=$1 AND block_hash=$2 AND transaction_hash=$3 ORDER BY log_index LIMIT 10001`,
      [candidate.chainId, candidate.blockHash, candidate.transactionHash]
    );
    code = "receipt_indexed_logs_invalid";
    if (!known.rows.length || known.rows.length > 10000)
      throw new Error("Missing indexed receipt logs.");
    const logs: ExpectedReceiptLog[] = known.rows.map((row) => ({
      address: row.address.toLowerCase(),
      logIndex: row.log_index,
      transactionIndex: row.transaction_index,
      data: row.data.toLowerCase(),
      topics: parseIndexedEventTopics(row.topics)
    }));
    code = "receipt_rpc_unavailable";
    const receipt = await rpc.receipt(candidate.transactionHash);
    const block = await rpc.block(candidate.blockNumber);
    code = "receipt_validation_failed";
    const validated = validateTransactionReceipt(
      candidate,
      receipt,
      block,
      logs
    );
    let runtimeHash: string | null = null;
    if (validated.hasSeaport) {
      code = "receipt_runtime_rpc_unavailable";
      const runtime = await rpc.code(
        seaportDeployment.address,
        candidate.blockNumber
      );
      code = "receipt_runtime_validation_failed";
      runtimeHash = verifyReceiptRuntime(candidate.chainId, runtime);
    }
    const storedBlock = {
      number: String(block.number),
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: String(block.timestamp),
      seaportRuntimeHash: runtimeHash
    };
    const payloadHash = transactionEvidenceHash(validated.raw, storedBlock);
    code = "receipt_commit_failed";
    return await indexerTransaction(pool, async (db) => {
      await readBoundRuntime(db, release);
      const lease = await db.query(
        `SELECT 1 FROM yunipals_indexer_control.receipt_job
        WHERE chain_id=$1 AND block_hash=$2 AND transaction_hash=$3 AND lease_id=$4 AND lease_until>clock_timestamp() FOR UPDATE`,
        [job.chain_id, job.block_hash, job.transaction_hash, job.lease_id]
      );
      if (lease.rowCount !== 1) return "superseded";
      const canonical = await db.query(
        `SELECT 1 FROM ${sqlIdentifier(release.schema)}.transaction_candidate
        WHERE chain_id=$1 AND block_hash=$2 AND transaction_hash=$3 AND block_number=$4::bigint`,
        [job.chain_id, job.block_hash, job.transaction_hash, job.block_number]
      );
      if (canonical.rowCount === 1) {
        await db.query(
          `INSERT INTO yunipals_indexer_control.transaction_evidence
          (chain_id,block_hash,transaction_hash,block_number,receipt,block,payload_hash,provider_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [
            job.chain_id,
            job.block_hash,
            job.transaction_hash,
            job.block_number,
            JSON.stringify(validated.raw),
            JSON.stringify(storedBlock),
            payloadHash,
            rpc.providerId
          ]
        );
        const stored = await db.query<{ payload_hash: string }>(
          `SELECT payload_hash FROM yunipals_indexer_control.transaction_evidence
          WHERE chain_id=$1 AND block_hash=$2 AND transaction_hash=$3`,
          [job.chain_id, job.block_hash, job.transaction_hash]
        );
        if (stored.rows[0]?.payload_hash !== payloadHash)
          throw new Error("Conflicting receipt evidence.");
      }
      await db.query(
        `DELETE FROM yunipals_indexer_control.receipt_job WHERE chain_id=$1 AND block_hash=$2 AND transaction_hash=$3 AND lease_id=$4`,
        [job.chain_id, job.block_hash, job.transaction_hash, job.lease_id]
      );
      return canonical.rowCount === 1 ? "stored" : "orphaned";
    });
  } catch {
    const delay = Math.min(3600, 2 ** Math.min(job.attempts, 12));
    await pool.query(
      `UPDATE yunipals_indexer_control.receipt_job
      SET lease_id=NULL,lease_until=NULL,error_code=$5,next_attempt_at=clock_timestamp()+$6::integer*interval '1 second'
      WHERE chain_id=$1 AND block_hash=$2 AND transaction_hash=$3 AND lease_id=$4`,
      [
        job.chain_id,
        job.block_hash,
        job.transaction_hash,
        job.lease_id,
        code,
        delay
      ]
    );
    return "retry";
  }
}

export function decodeTransactionEvidence(row: {
  receipt: unknown;
  block: unknown;
  payload_hash: string;
}) {
  if (transactionEvidenceHash(row.receipt, row.block) !== row.payload_hash)
    throw new Error("Stored receipt evidence changed.");
  return {
    receipt: formatTransactionReceipt(row.receipt as RpcTransactionReceipt),
    block: row.block
  };
}
