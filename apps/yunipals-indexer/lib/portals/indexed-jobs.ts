import type { Pool } from "pg";
import { indexerTransaction } from "../../../../packages/yunipals-indexer-server/src/database.js";
import { PortalStore, type PortalJob } from "./store.js";
import type { SharedPortalLedger } from "./shared-ledger.js";
import type { PortalChain } from "./chain.js";

export interface PortalJobSource {
  ingest(): Promise<void>;
  verify(job: PortalJob): Promise<void>;
}

export class IndexedPortalJobs implements PortalJobSource {
  constructor(
    readonly ledger: SharedPortalLedger,
    readonly privatePool: Pool,
    readonly store: PortalStore,
    readonly chain: PortalChain
  ) {}

  async ingest() {
    await this.ledger.snapshot(async () => {
      const boundary = await this.ledger.cursor();
      const identity = this.ledger.sourceIdentity().readIdentity;
      await indexerTransaction(this.privatePool, async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `portal-consumer:${this.store.deployment}`
        ]);
        const previous = (
          await db.query<{
            identity: string;
            block: string;
            hash: string;
            tx: number;
            log: number;
          }>(
            "SELECT identity,block_number::text AS block,block_hash AS hash,transaction_index AS tx,log_index AS log FROM portal_v6_consumer WHERE deployment=$1 FOR UPDATE",
            [this.store.deployment]
          )
        ).rows[0];
        const valid =
          previous?.identity === identity &&
          BigInt(previous.block) <= BigInt(boundary.block) &&
          (
            await this.chain.client.getBlock({
              blockNumber: BigInt(previous.block)
            })
          ).hash === previous.hash;
        const after = valid
          ? [previous.block, previous.tx, previous.log]
          : ["0", -1, -1];
        const events = (
          await this.ledger.db.query<{
            block: string;
            hash: string;
            tx: number;
            log: number;
            args: Record<string, string>;
          }>(
            `SELECT block_number::text AS block,block_hash AS hash,transaction_index AS tx,log_index AS log,args
           FROM portal_v2_ledger_event WHERE deployment=$1 AND event_type='GradingRequested'
           AND (block_number,transaction_index,log_index)>($2::numeric,$3::int,$4::int)
           ORDER BY block_number,transaction_index,log_index LIMIT 100`,
            [this.ledger.deployment, ...after]
          )
        ).rows;
        const target = new PortalStore(db, this.store.deployment);
        for (const event of events) {
          const id = BigInt(event.args.requestId);
          const [request, binding] = await Promise.all([
            this.chain.request(id, BigInt(boundary.block)),
            this.chain.binding(id)
          ]);
          if (
            request.acceptedAt === 0n ||
            request.acceptedBlock.toString() !== event.block ||
            request.spellCommitment !== event.args.spellCommitment
          )
            throw new Error("Indexed grading request binding mismatch.");
          const rubric = await this.chain.rubric(request.rubricId);
          // Preserve expensive outputs when a reorg changes a request incarnation.
          await db.query(
            `INSERT INTO portal_v6_job_revision(deployment,request_id,binding,job)
            SELECT deployment,request_id,binding,to_jsonb(j) FROM portal_v1_job j
            WHERE deployment=$1 AND request_id=$2 AND binding<>$3
            ON CONFLICT(deployment,request_id,binding) DO UPDATE SET job=excluded.job,saved_at=now()`,
            [this.store.deployment, id.toString(), binding]
          );
          await target.enqueue({
            requestId: id.toString(),
            commitment: request.spellCommitment,
            binding,
            acceptedBlock: event.block,
            acceptedAt: Number(request.acceptedAt),
            modelPolicy: rubric.modelPolicy
          });
        }
        const last =
          events.length === 100
            ? events.at(-1)!
            : {
                block: boundary.block,
                hash: boundary.hash,
                tx: 2147483647,
                log: 2147483647
              };
        await db.query(
          `INSERT INTO portal_v6_consumer(deployment,identity,block_number,block_hash,transaction_index,log_index)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(deployment) DO UPDATE SET identity=excluded.identity,
          block_number=excluded.block_number,block_hash=excluded.block_hash,transaction_index=excluded.transaction_index,log_index=excluded.log_index`,
          [
            this.store.deployment,
            identity,
            last.block,
            last.hash,
            last.tx,
            last.log
          ]
        );
        await target.saveCursor(BigInt(last.block), last.hash);
      });
    });
  }
  async verify(job: PortalJob) {
    await this.ledger.snapshot(async () => {
      const row = (
        await this.ledger.db.query<{
          commitment: string;
          requested_block: string;
        }>(
          "SELECT commitment,requested_block::text FROM portal_v5_request WHERE deployment=$1 AND request_id=$2",
          [this.ledger.deployment, job.requestId]
        )
      ).rows[0];
      if (!row || row.commitment !== job.commitment)
        throw new Error(
          "Grading job is not present in the selected canonical source."
        );
      if ((await this.chain.binding(BigInt(job.requestId))) !== job.binding)
        throw new Error("Grading job incarnation changed.");
    });
  }
}
