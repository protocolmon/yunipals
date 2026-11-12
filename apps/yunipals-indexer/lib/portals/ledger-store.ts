import {
  portalApplicationSchema,
  projectPortalApplication
} from "./ledger-application.js";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface PortalLedgerCursor {
  block: string;
  hash: string;
  generation: string;
}
export interface PortalLedgerEvent {
  type: string;
  tokenId: string;
  block: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  source: string;
  args: Record<string, string>;
}

const schema = `
CREATE TABLE IF NOT EXISTS portal_v2_ledger_cursor (
 deployment text PRIMARY KEY, block_number numeric(20,0) NOT NULL,
 block_hash text NOT NULL, generation text NOT NULL
);
ALTER TABLE portal_v2_ledger_cursor ADD COLUMN IF NOT EXISTS projection_version integer NOT NULL DEFAULT 2;
CREATE TABLE IF NOT EXISTS portal_v2_ledger_event (
 deployment text NOT NULL, transaction_hash text NOT NULL, log_index integer NOT NULL,
 block_number numeric(20,0) NOT NULL, block_hash text NOT NULL,
 transaction_index integer NOT NULL, source text NOT NULL, event_type text NOT NULL,
 token_id numeric(78,0) NOT NULL, args jsonb NOT NULL,
 PRIMARY KEY(deployment,transaction_hash,log_index)
);
CREATE INDEX IF NOT EXISTS portal_v2_ledger_token ON portal_v2_ledger_event(deployment,token_id,block_number,log_index);
CREATE UNIQUE INDEX IF NOT EXISTS portal_v2_ledger_credit ON portal_v2_ledger_event(deployment,(args->>'requestId')) WHERE event_type='PortalFeeAccrued';
CREATE INDEX IF NOT EXISTS portal_v2_ledger_claimant ON portal_v2_ledger_event(deployment,lower(args->>'owner'),block_number,log_index) WHERE event_type='PortalClaimed';
CREATE TABLE IF NOT EXISTS portal_v2_token (
 deployment text NOT NULL, token_id numeric(78,0) NOT NULL,
 owner text NOT NULL, kind_id numeric(78,0), retired boolean NOT NULL DEFAULT false,
 earned numeric(78,0) NOT NULL DEFAULT 0, claimed numeric(78,0) NOT NULL DEFAULT 0,
 balance numeric(78,0) NOT NULL DEFAULT 0, claimant text,
 PRIMARY KEY(deployment,token_id)
);
CREATE INDEX IF NOT EXISTS portal_v2_token_owner ON portal_v2_token(deployment,owner,token_id);
CREATE TABLE IF NOT EXISTS portal_v3_competition_entry (
 deployment text NOT NULL, entry_id numeric(78,0) NOT NULL, batch_id numeric(78,0) NOT NULL,
 request_id numeric(78,0) NOT NULL, submitter text NOT NULL, amount numeric(78,0) NOT NULL,
 score integer, PRIMARY KEY(deployment,entry_id), UNIQUE(deployment,request_id)
);
CREATE TABLE IF NOT EXISTS portal_v3_competition_batch (
 deployment text NOT NULL, batch_id numeric(78,0) NOT NULL, funded integer NOT NULL DEFAULT 0,
 completed integer NOT NULL DEFAULT 0, pool numeric(78,0) NOT NULL DEFAULT 0,
 ready boolean NOT NULL DEFAULT false, winners jsonb,
 PRIMARY KEY(deployment,batch_id)
);
CREATE TABLE IF NOT EXISTS portal_v3_competition_prize (
 deployment text NOT NULL, batch_id numeric(78,0) NOT NULL, rank integer NOT NULL,
 winner text NOT NULL, amount numeric(78,0) NOT NULL,
 PRIMARY KEY(deployment,batch_id,rank)
);
`;

export class PortalLedgerStore {
  constructor(
    readonly db: Pick<Pool, "query">,
    readonly deployment: string
  ) {}

  async migrate() {
    for (const sql of (schema + portalApplicationSchema)
      .split(";")
      .filter((s) => s.trim()))
      await this.db.query(sql);
  }

  async requiresReplay() {
    const result = await this.db.query(
      "SELECT 1 FROM portal_v2_ledger_cursor WHERE deployment=$1 AND projection_version<>5",
      [this.deployment]
    );
    return result.rows.length > 0;
  }

  async cursor(): Promise<PortalLedgerCursor | null> {
    const result = await this.db.query<PortalLedgerCursor>(
      "SELECT block_number::text AS block,block_hash AS hash,generation FROM portal_v2_ledger_cursor WHERE deployment=$1",
      [this.deployment]
    );
    return result.rows[0] ?? null;
  }

  /** A dedicated PG connection keeps events, projections and cursor atomic. */
  async apply(
    events: PortalLedgerEvent[],
    block: string,
    hash: string,
    expected: PortalLedgerCursor | null,
    reset = false,
    competitionRules = { batchSize: 111n, contribution: 500_000n }
  ) {
    if (
      competitionRules.batchSize < 3n ||
      competitionRules.batchSize > 65535n ||
      competitionRules.contribution <= 0n
    )
      throw new Error("Invalid onchain competition rules.");
    const connection =
      "connect" in this.db ? await (this.db as Pool).connect() : null;
    const tx = connection ?? this.db;
    try {
      await tx.query("BEGIN");
      if (connection)
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          this.deployment
        ]);
      const current = await tx.query<PortalLedgerCursor>(
        "SELECT block_number::text AS block,block_hash AS hash,generation FROM portal_v2_ledger_cursor WHERE deployment=$1",
        [this.deployment]
      );
      const observed = current.rows[0] ?? null;
      if (
        observed?.block !== expected?.block ||
        observed?.hash !== expected?.hash ||
        observed?.generation !== expected?.generation
      )
        throw new Error("Portal ledger cursor changed; retry.");
      if (reset) {
        for (const table of [
          "portal_v5_request",
          "portal_v5_mint",
          "portal_v5_state",
          "portal_v3_competition_prize",
          "portal_v3_competition_entry",
          "portal_v3_competition_batch"
        ])
          await tx.query(`DELETE FROM ${table} WHERE deployment=$1`, [
            this.deployment
          ]);
        await tx.query(
          "DELETE FROM portal_v2_ledger_event WHERE deployment=$1",
          [this.deployment]
        );
        await tx.query("DELETE FROM portal_v2_token WHERE deployment=$1", [
          this.deployment
        ]);
      }
      for (const event of events) {
        const inserted = await tx.query(
          `INSERT INTO portal_v2_ledger_event(deployment,transaction_hash,log_index,block_number,block_hash,transaction_index,source,event_type,token_id,args)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(deployment,transaction_hash,log_index) DO NOTHING RETURNING token_id`,
          [
            this.deployment,
            event.transactionHash,
            event.logIndex,
            event.block,
            event.blockHash,
            event.transactionIndex,
            event.source,
            event.type,
            event.tokenId,
            JSON.stringify(event.args)
          ]
        );
        if (!inserted.rows.length) continue;
        await projectPortalApplication(tx, this.deployment, event);
        if (event.type.startsWith("Competition")) {
          const a = event.args;
          if (event.type === "CompetitionEntered") {
            if (
              a.amount !== competitionRules.contribution.toString() ||
              BigInt(a.entryId) < 1n ||
              (BigInt(a.entryId) - 1n) / competitionRules.batchSize + 1n !==
                BigInt(a.batchId)
            )
              throw new Error("Invalid competition allocation.");
            await tx.query(
              "INSERT INTO portal_v3_competition_entry(deployment,entry_id,batch_id,request_id,submitter,amount) VALUES($1,$2,$3,$4,$5,$6)",
              [
                this.deployment,
                a.entryId,
                a.batchId,
                a.requestId,
                a.submitter.toLowerCase(),
                a.amount
              ]
            );
            await tx.query(
              `INSERT INTO portal_v3_competition_batch(deployment,batch_id,funded,pool) VALUES($1,$2,1,$3)
              ON CONFLICT(deployment,batch_id) DO UPDATE SET funded=portal_v3_competition_batch.funded+1,pool=portal_v3_competition_batch.pool+excluded.pool`,
              [this.deployment, a.batchId, a.amount]
            );
          } else if (event.type === "CompetitionResult") {
            const changed = await tx.query(
              "UPDATE portal_v3_competition_entry SET score=$5 WHERE deployment=$1 AND entry_id=$2 AND batch_id=$3 AND request_id=$4 AND score IS NULL RETURNING entry_id",
              [this.deployment, a.entryId, a.batchId, a.requestId, a.score]
            );
            if (!changed.rows.length)
              throw new Error(
                "Competition result does not match a funded entry."
              );
            await tx.query(
              "UPDATE portal_v3_competition_batch SET completed=completed+1 WHERE deployment=$1 AND batch_id=$2",
              [this.deployment, a.batchId]
            );
          } else if (event.type === "CompetitionReady") {
            const changed = await tx.query(
              "UPDATE portal_v3_competition_batch SET ready=true WHERE deployment=$1 AND batch_id=$2 AND funded=$3 AND completed=$3 RETURNING batch_id",
              [this.deployment, a.batchId, Number(competitionRules.batchSize)]
            );
            if (!changed.rows.length)
              throw new Error("Competition readiness does not reconcile.");
          } else if (event.type === "CompetitionSettled") {
            const leaders = await tx.query<{ entry: string }>(
              "SELECT entry_id::text AS entry FROM portal_v3_competition_entry WHERE deployment=$1 AND batch_id=$2 AND score IS NOT NULL ORDER BY score DESC,entry_id ASC LIMIT 3",
              [this.deployment, a.batchId]
            );
            const expected = [a.first, a.second, a.third];
            if (
              leaders.rows.length !== 3 ||
              leaders.rows.some((row, i) => row.entry !== expected[i])
            )
              throw new Error("Competition winners do not reconcile.");
            const changed = await tx.query(
              "UPDATE portal_v3_competition_batch SET winners=$3 WHERE deployment=$1 AND batch_id=$2 AND ready AND winners IS NULL RETURNING batch_id",
              [this.deployment, a.batchId, JSON.stringify(expected)]
            );
            if (!changed.rows.length)
              throw new Error("Competition settlement is not ready.");
          } else if (event.type === "CompetitionPrizePaid") {
            const rank = Number(a.rank),
              amounts = [50n, 30n, 20n].map((share) =>
                (
                  (competitionRules.batchSize *
                    competitionRules.contribution *
                    share) /
                  100n
                ).toString()
              );
            const winner = await tx.query<{ submitter: string }>(
              "SELECT e.submitter FROM portal_v3_competition_batch b JOIN portal_v3_competition_entry e ON e.deployment=b.deployment AND e.entry_id=(b.winners->>($3::int))::numeric WHERE b.deployment=$1 AND b.batch_id=$2",
              [this.deployment, a.batchId, rank]
            );
            if (
              a.amount !== amounts[rank] ||
              winner.rows[0]?.submitter !== a.winner.toLowerCase()
            )
              throw new Error("Competition payout does not reconcile.");
            await tx.query(
              "INSERT INTO portal_v3_competition_prize(deployment,batch_id,rank,winner,amount) VALUES($1,$2,$3,$4,$5)",
              [
                this.deployment,
                a.batchId,
                a.rank,
                a.winner.toLowerCase(),
                a.amount
              ]
            );
          }
          continue;
        }
        const key = [this.deployment, event.tokenId];
        if (event.type === "Transfer") {
          const owner = event.args.to.toLowerCase();
          await tx.query(
            `INSERT INTO portal_v2_token(deployment,token_id,owner,retired) VALUES($1,$2,$3,$4)
            ON CONFLICT(deployment,token_id) DO UPDATE SET owner=excluded.owner,retired=excluded.retired`,
            [...key, owner, /^0x0{40}$/.test(owner)]
          );
        } else if (event.type === "PortalMinted") {
          await tx.query(
            "UPDATE portal_v2_token SET kind_id=$3 WHERE deployment=$1 AND token_id=$2",
            [...key, event.args.kindId]
          );
        } else if (event.type === "PortalFeeAccrued") {
          const updated = await tx.query(
            "UPDATE portal_v2_token SET earned=earned+$3,balance=balance+$3 WHERE deployment=$1 AND token_id=$2 AND NOT retired AND balance+$3=$4 RETURNING token_id",
            [...key, event.args.amount, event.args.newBalance]
          );
          if (!updated.rows.length)
            throw new Error(
              "Portal credit does not reconcile; check ledger start block."
            );
        } else if (event.type === "PortalClaimed") {
          const updated = await tx.query(
            "UPDATE portal_v2_token SET claimed=claimed+$3,balance=0,claimant=$4 WHERE deployment=$1 AND token_id=$2 AND retired AND balance=$3 RETURNING token_id",
            [...key, event.args.amount, event.args.owner.toLowerCase()]
          );
          if (!updated.rows.length)
            throw new Error("Portal claim does not reconcile.");
        }
      }
      await tx.query(
        `INSERT INTO portal_v2_ledger_cursor(deployment,block_number,block_hash,generation,projection_version) VALUES($1,$2,$3,$4,5)
        ON CONFLICT(deployment) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,generation=excluded.generation,projection_version=excluded.projection_version`,
        [
          this.deployment,
          block,
          hash,
          reset || !observed ? randomUUID() : observed.generation
        ]
      );
      await tx.query("COMMIT");
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      connection?.release();
    }
  }

  async holdings(owner: string, block: string, after: string, limit: number) {
    const result = await this.db.query<{ tokenId: string }>(
      `WITH owners AS (
      SELECT DISTINCT ON (token_id) token_id,args->>'to' AS owner FROM portal_v2_ledger_event
      WHERE deployment=$1 AND event_type='Transfer' AND block_number<=$2
      ORDER BY token_id,block_number DESC,log_index DESC
    ) SELECT token_id::text AS "tokenId" FROM owners WHERE lower(owner)=$3 AND token_id>$4 ORDER BY token_id LIMIT $5`,
      [this.deployment, block, owner.toLowerCase(), after, limit]
    );
    return result.rows;
  }

  async totals(tokenId: string) {
    const result = await this.db.query<{
      earned: string;
      claimed: string;
      claimant: string | null;
    }>(
      "SELECT earned::text,claimed::text,claimant FROM portal_v2_token WHERE deployment=$1 AND token_id=$2",
      [this.deployment, tokenId]
    );
    return result.rows[0] ?? null;
  }

  async activity(input: {
    tokenId?: string;
    owner?: string;
    block: string;
    beforeBlock: string;
    beforeLog: number;
    limit: number;
  }) {
    const result = await this.db.query<{
      type: string;
      tokenId: string;
      block: string;
      blockHash: string;
      transactionHash: string;
      logIndex: number;
      args: Record<string, string>;
    }>(
      `SELECT event_type AS type,token_id::text AS "tokenId",block_number::text AS block,block_hash AS "blockHash",transaction_hash AS "transactionHash",log_index AS "logIndex",args
      FROM portal_v2_ledger_event WHERE deployment=$1 AND block_number<=$2
      AND event_type NOT LIKE 'Competition%'
      AND (block_number<$3 OR (block_number=$3 AND log_index<$4))
      AND ($5::numeric IS NULL OR token_id=$5)
      AND ($6::text IS NULL OR (event_type='PortalClaimed' AND lower(args->>'owner')=$6))
      ORDER BY block_number DESC,log_index DESC LIMIT $7`,
      [
        this.deployment,
        input.block,
        input.beforeBlock,
        input.beforeLog,
        input.tokenId ?? null,
        input.owner?.toLowerCase() ?? null,
        input.limit
      ]
    );
    return result.rows;
  }
}
