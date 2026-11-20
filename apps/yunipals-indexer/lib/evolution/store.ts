import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Hex } from "viem";
import type { EvolutionHistory } from "./art.js";

export type EvolutionArtifact = {
  uri: string;
  hash: Hex;
  metadataURI: string;
  metadataHash: Hex;
};
export type EvolutionProgress = {
  parents?: EvolutionHistory[];
  prompt?: string;
  image?: { uri: string; hash: Hex; model: string; usage: unknown };
  artifact?: EvolutionArtifact;
  transactionHash?: Hex;
};
export type EvolutionJob = {
  requestId: string;
  binding: Hex;
  policy: Hex;
  lease: string;
  attempts: number;
  progress: EvolutionProgress;
};
export const evolutionWorkerSchema = `CREATE TABLE IF NOT EXISTS evolution_v1_job (
 deployment text NOT NULL, request_id numeric(78,0) NOT NULL, binding text NOT NULL,
 policy text NOT NULL, progress jsonb NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0,
 completed boolean NOT NULL DEFAULT false, lease text, lease_until timestamptz,
 retry_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(deployment,request_id,binding)
)`;
/** Private processing state only. Every binding retains its own paid outputs across reorgs. */
export class EvolutionStore {
  constructor(
    readonly db: Pick<Pool, "query">,
    readonly deployment: string
  ) {}
  /** Claim only requests returned by the canonical outstanding-job reader.
   * A prior completion may have been reorganized away; retain its paid outputs
   * and let the worker revalidate the binding and chain state before reuse.
   */
  async claim(
    requestId: string,
    binding: Hex,
    policy: Hex
  ): Promise<EvolutionJob | null> {
    await this.db.query(
      `INSERT INTO evolution_v1_job(deployment,request_id,binding,policy)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [this.deployment, requestId, binding, policy]
    );
    const result = await this.db.query<EvolutionJob>(
      `UPDATE evolution_v1_job SET lease=$5, completed=false,
      lease_until=now()+interval '15 minutes', attempts=attempts+1
      WHERE deployment=$1 AND request_id=$2 AND binding=$3 AND policy=$4
      AND (completed OR retry_at<=now()) AND (lease_until IS NULL OR lease_until<now())
      RETURNING request_id::text AS "requestId",binding,policy,lease,attempts,progress`,
      [this.deployment, requestId, binding, policy, randomUUID()]
    );
    return result.rows[0] ?? null;
  }
  async save(job: EvolutionJob) {
    const result = await this.db.query(
      `UPDATE evolution_v1_job SET progress=$5,
      lease_until=now()+interval '15 minutes' WHERE deployment=$1 AND request_id=$2
      AND binding=$3 AND lease=$4 AND lease_until>now() RETURNING request_id`,
      [
        this.deployment,
        job.requestId,
        job.binding,
        job.lease,
        JSON.stringify(job.progress)
      ]
    );
    if (!result.rows.length) throw new Error("Evolution job lease lost.");
  }
  async release(job: EvolutionJob, completed = false) {
    await this.db.query(
      `UPDATE evolution_v1_job SET completed=$5, lease=NULL,lease_until=NULL,
      retry_at=now()+make_interval(secs=>$6) WHERE deployment=$1 AND request_id=$2 AND binding=$3 AND lease=$4`,
      [
        this.deployment,
        job.requestId,
        job.binding,
        job.lease,
        completed,
        Math.min(3600, 5 * 2 ** Math.min(10, job.attempts))
      ]
    );
  }
}
