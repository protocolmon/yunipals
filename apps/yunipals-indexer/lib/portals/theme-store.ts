import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export const portalThemeSchema = `CREATE TABLE IF NOT EXISTS portal_v4_theme_job (
 deployment text NOT NULL, pool text NOT NULL, batch_id numeric(78,0) NOT NULL,
 sources_hash text NOT NULL, policy_hash text NOT NULL, progress jsonb NOT NULL DEFAULT '{}',
 lease_token text, lease_until timestamptz,
 PRIMARY KEY(deployment,pool,batch_id,sources_hash,policy_hash)
)`;
export type ThemeJob = {
  pool: string;
  batchId: string;
  sourcesHash: string;
  policyHash: string;
  lease: string;
  progress: Record<string, unknown>;
};
export class PortalThemeStore {
  constructor(
    readonly db: Pick<Pool, "query">,
    readonly deployment: string
  ) {}
  async claim(
    input: Omit<ThemeJob, "lease" | "progress">
  ): Promise<ThemeJob | null> {
    const lease = randomUUID();
    const result = await this.db.query<{ progress: Record<string, unknown> }>(
      `INSERT INTO portal_v4_theme_job(deployment,pool,batch_id,sources_hash,policy_hash,lease_token,lease_until)
   VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')
   ON CONFLICT(deployment,pool,batch_id,sources_hash,policy_hash) DO UPDATE SET lease_token=$6,lease_until=now()+interval '5 minutes'
   WHERE portal_v4_theme_job.lease_until IS NULL OR portal_v4_theme_job.lease_until<now() RETURNING progress`,
      [
        this.deployment,
        input.pool.toLowerCase(),
        input.batchId,
        input.sourcesHash,
        input.policyHash,
        lease
      ]
    );
    return result.rows[0]
      ? { ...input, lease, progress: result.rows[0].progress }
      : null;
  }
  private keys(job: ThemeJob) {
    return [
      this.deployment,
      job.pool.toLowerCase(),
      job.batchId,
      job.sourcesHash,
      job.policyHash,
      job.lease
    ];
  }
  async save(job: ThemeJob) {
    const r = await this.db.query(
      `UPDATE portal_v4_theme_job SET progress=$7,lease_until=now()+interval '5 minutes' WHERE deployment=$1 AND pool=$2 AND batch_id=$3 AND sources_hash=$4 AND policy_hash=$5 AND lease_token=$6 AND lease_until>now() RETURNING batch_id`,
      [...this.keys(job), JSON.stringify(job.progress)]
    );
    if (!r.rows.length) throw new Error("Theme job lease lost.");
  }
  async heartbeat(job: ThemeJob) {
    const r = await this.db.query(
      `UPDATE portal_v4_theme_job SET lease_until=now()+interval '5 minutes' WHERE deployment=$1 AND pool=$2 AND batch_id=$3 AND sources_hash=$4 AND policy_hash=$5 AND lease_token=$6 AND lease_until>now() RETURNING batch_id`,
      this.keys(job)
    );
    if (!r.rows.length) throw new Error("Theme job lease lost.");
  }
  async release(job: ThemeJob) {
    await this.db.query(
      `UPDATE portal_v4_theme_job SET lease_token=NULL,lease_until=NULL WHERE deployment=$1 AND pool=$2 AND batch_id=$3 AND sources_hash=$4 AND policy_hash=$5 AND lease_token=$6`,
      this.keys(job)
    );
  }
}
