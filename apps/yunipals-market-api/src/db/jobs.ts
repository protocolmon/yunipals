import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { transaction } from "@/db/pool";

type Queryable = Pick<PoolClient, "query">;
export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
};

function boundedInteger(value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error("Invalid job limit.");
}

// Accepts the caller's transaction so order admission and its work commit together.
// A repeated key preserves the original payload, including completed work.
export async function enqueueJob(
  db: Queryable,
  input: {
    kind: string;
    key: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }
) {
  const maxAttempts = input.maxAttempts ?? 8;
  boundedInteger(maxAttempts, 32);
  const result = await db.query<{ id: string }>(
    `
    INSERT INTO yunipals_market.job(kind,deduplication_key,payload,max_attempts)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (kind,deduplication_key) DO UPDATE
      SET deduplication_key=EXCLUDED.deduplication_key
    RETURNING id`,
    [input.kind, input.key, JSON.stringify(input.payload), maxAttempts]
  );
  return result.rows[0]!.id;
}

export async function claimJob(
  pool: Pool,
  kind: string,
  leaseMs = 30000,
  scope?: { chainId: number }
): Promise<Job | null> {
  boundedInteger(leaseMs, 300000);
  if (scope) boundedInteger(scope.chainId, 2147483647);
  return transaction(pool, async (client) => {
    // A worker can disappear during its last attempt. Retire that lease too.
    await client.query(
      `
      UPDATE yunipals_market.job SET state='failed',lease_token=NULL,lease_until=NULL,
        last_error_code='attempts_exhausted',updated_at=clock_timestamp()
      WHERE id IN (
        SELECT id FROM yunipals_market.job WHERE kind=$1 AND attempts>=max_attempts
          ${scope ? "AND payload->>'chainId'=$2" : ""}
          AND ((state='running' AND lease_until<=clock_timestamp())
            OR (state='pending' AND available_at<=clock_timestamp()))
        ORDER BY available_at LIMIT 100 FOR UPDATE SKIP LOCKED
      )`,
      scope ? [kind, String(scope.chainId)] : [kind]
    );
    const token = randomUUID();
    const result = await client.query<{
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      attempts: number;
      maxAttempts: number;
    }>(
      `
      UPDATE yunipals_market.job SET state='running',attempts=attempts+1,
        lease_token=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond',
        updated_at=clock_timestamp()
      WHERE id=(SELECT id FROM yunipals_market.job WHERE kind=$1 AND attempts<max_attempts
        ${scope ? "AND payload->>'chainId'=$4" : ""}
        AND ((state='pending' AND available_at<=clock_timestamp())
          OR (state='running' AND lease_until<=clock_timestamp()))
        ORDER BY available_at,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id,kind,payload,attempts,max_attempts AS "maxAttempts"`,
      [kind, token, leaseMs, ...(scope ? [String(scope.chainId)] : [])]
    );
    const row = result.rows[0];
    return row ? { ...row, leaseToken: token } : null;
  });
}

export async function renewJob(db: Queryable, job: Job, leaseMs = 30000) {
  boundedInteger(leaseMs, 300000);
  const result = await db.query(
    `
    UPDATE yunipals_market.job SET lease_until=clock_timestamp()+$3*interval '1 millisecond',
      updated_at=clock_timestamp()
    WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp()`,
    [job.id, job.leaseToken, leaseMs]
  );
  return result.rowCount === 1;
}

export class LostJobLeaseError extends Error {
  constructor() {
    super("Job lease expired or was replaced.");
  }
}

// Every durable result/checkpoint write belongs inside this callback. Lock first,
// check again after work, and roll back everything if the lease elapsed meanwhile.
// External network actions must use their own idempotency/reconciliation protocol.
export async function completeJob<T>(
  pool: Pool,
  job: Job,
  commit: (client: PoolClient) => Promise<T>
) {
  return transaction(pool, async (client) => {
    const locked = await client.query(
      `
      SELECT id FROM yunipals_market.job WHERE id=$1 AND lease_token=$2
        AND state='running' AND lease_until>clock_timestamp() FOR UPDATE`,
      [job.id, job.leaseToken]
    );
    if (locked.rowCount !== 1) throw new LostJobLeaseError();
    const value = await commit(client);
    const result = await client.query(
      `
      UPDATE yunipals_market.job SET state='completed',lease_token=NULL,lease_until=NULL,
        last_error_code=NULL,updated_at=clock_timestamp()
      WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp()`,
      [job.id, job.leaseToken]
    );
    if (result.rowCount !== 1) throw new LostJobLeaseError();
    return value;
  });
}

export async function retryJob(
  db: Queryable,
  job: Job,
  errorCode: string,
  delayMs: number
) {
  boundedInteger(delayMs, 3600000);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(errorCode))
    throw new Error("Invalid job error code.");
  const result = await db.query(
    `
    UPDATE yunipals_market.job SET state=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
      lease_token=NULL,lease_until=NULL,available_at=clock_timestamp()+$4*interval '1 millisecond',
      last_error_code=$3,updated_at=clock_timestamp()
    WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp()`,
    [job.id, job.leaseToken, errorCode, delayMs]
  );
  return result.rowCount === 1;
}
