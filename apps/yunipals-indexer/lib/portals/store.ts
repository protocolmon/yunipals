import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  normalizedSpell,
  type PortalOriginality,
  type PortalScores,
  type PortalAIContext,
  type PortalGradingAssessment
} from "@protopals/yunipals-market-core/portals";
import { PortalUserError } from "./errors.js";
import { portalThemeSchema } from "./theme-store.js";
import { portalTransactionSchema } from "./transactions.js";

export interface PrivatePortalSpell {
  commitment: string;
  submitter: string;
  tokenId: string;
  artVersion: string;
  nonce: string;
  spell: string;
  salt: string;
}
export interface PortalCandidate {
  requestId: string;
  submitter: string;
  spell: string;
  sameAuthor: boolean;
  similarity: number;
}
export interface PortalWorkerProgress {
  displayOnly?: boolean;
  portalContext?: PortalAIContext;
  embedding?: number[];
  candidates?: PortalCandidate[];
  image?: { hash: string; uri: string; usage: unknown; model: string };
  originality?: PortalOriginality;
  grading?: {
    scores: PortalScores;
    reason: string;
    usage: unknown;
    model: string;
    assessment?: PortalGradingAssessment;
  };
  completion?: Record<string, unknown>;
  transactionHash?: string;
  transactionSubmittedAt?: number;
}
export interface PortalJob {
  requestId: string;
  commitment: string;
  binding: string;
  acceptedBlock: string;
  acceptedAt: number;
  leaseToken: string;
  attempts: number;
  progress: PortalWorkerProgress;
}

export const portalSchema = `
CREATE TABLE IF NOT EXISTS portal_v1_spell (
  deployment text NOT NULL, commitment text NOT NULL, submitter text NOT NULL,
  token_id numeric(78,0) NOT NULL, art_version numeric(20,0) NOT NULL,
  nonce numeric(78,0) NOT NULL, spell text NOT NULL, salt text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(deployment,commitment)
);
CREATE INDEX IF NOT EXISTS portal_v1_spell_owner ON portal_v1_spell(deployment,submitter,uploaded_at);
CREATE TABLE IF NOT EXISTS portal_v1_job (
  deployment text NOT NULL, request_id numeric(78,0) NOT NULL, commitment text NOT NULL,
  binding text NOT NULL, model_policy text, accepted_block numeric(20,0) NOT NULL, accepted_at bigint NOT NULL,
  attempts integer NOT NULL DEFAULT 0, progress jsonb NOT NULL DEFAULT '{}',
  completed boolean NOT NULL DEFAULT false, retry_at timestamptz NOT NULL DEFAULT now(),
  lease_token text, lease_until timestamptz, last_error text,
  PRIMARY KEY(deployment,request_id)
);
ALTER TABLE portal_v1_job ADD COLUMN IF NOT EXISTS model_policy text;
CREATE TABLE IF NOT EXISTS portal_v1_publication (
  deployment text NOT NULL, request_id numeric(78,0) NOT NULL, token_id numeric(78,0) NOT NULL,
  submitter text NOT NULL, spell text NOT NULL, normalized text NOT NULL,
  embedding double precision[] NOT NULL, embedding_model text NOT NULL DEFAULT 'text-embedding-3-small', publication_block numeric(20,0) NOT NULL,
  publication_timestamp bigint NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL, artifact_hashes text[] NOT NULL,
  PRIMARY KEY(deployment,request_id)
);
ALTER TABLE portal_v1_publication ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT 'text-embedding-3-small';
CREATE INDEX IF NOT EXISTS portal_v1_publication_cutoff ON portal_v1_publication(deployment,publication_block);
CREATE INDEX IF NOT EXISTS portal_v1_publication_exact ON portal_v1_publication(deployment,normalized);
CREATE INDEX IF NOT EXISTS portal_v1_publication_card ON portal_v1_publication(deployment,token_id,request_id);
CREATE TABLE IF NOT EXISTS portal_v1_author_link (
  deployment text NOT NULL, left_wallet text NOT NULL, right_wallet text NOT NULL,
  left_signature text NOT NULL, right_signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(deployment,left_wallet,right_wallet)
);
CREATE TABLE IF NOT EXISTS portal_v1_cursor (
  deployment text PRIMARY KEY, block_number numeric(20,0) NOT NULL, block_hash text NOT NULL
);`;

export class PortalStore {
  constructor(
    readonly db: Pick<Pool, "query">,
    readonly deployment: string
  ) {}

  async migrate() {
    await this.db.query(portalTransactionSchema);
    await this.db.query(portalThemeSchema);
    for (const statement of portalSchema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await this.db.query(statement);
    // Rebuild display artifacts for older publications using their saved work.
    // Keep original public timestamps so originality eligibility cannot change.
    await this.db.query(
      `UPDATE portal_v1_job j SET completed=false,retry_at=now(),
      progress=progress || '{"displayOnly":true}'::jsonb
      WHERE j.deployment=$1 AND j.completed AND EXISTS (
        SELECT 1 FROM portal_v1_publication p WHERE p.deployment=j.deployment
        AND p.request_id=j.request_id AND p.result->'slab' IS NULL)`,
      [this.deployment]
    );
  }

  async saveSpell(spell: PrivatePortalSpell) {
    const existing = await this.spell(spell.commitment);
    if (existing) return;
    const count = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM portal_v1_spell s
      WHERE deployment=$1 AND submitter=$2 AND uploaded_at>now()-interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM portal_v1_job j WHERE j.deployment=s.deployment AND j.commitment=s.commitment)`,
      [this.deployment, spell.submitter.toLowerCase()]
    );
    if (Number(count.rows[0].count) >= 30)
      throw new PortalUserError(
        "Too many unsubmitted spells; try again later.",
        429
      );
    await this.db.query(
      `INSERT INTO portal_v1_spell(deployment,commitment,submitter,token_id,art_version,nonce,spell,salt)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [
        this.deployment,
        spell.commitment,
        spell.submitter.toLowerCase(),
        spell.tokenId,
        spell.artVersion,
        spell.nonce,
        spell.spell,
        spell.salt
      ]
    );
  }

  async spell(commitment: string): Promise<PrivatePortalSpell | null> {
    const result = await this.db.query<PrivatePortalSpell>(
      `SELECT commitment,submitter,token_id::text AS "tokenId",art_version::text AS "artVersion",nonce::text,spell,salt
      FROM portal_v1_spell WHERE deployment=$1 AND commitment=$2`,
      [this.deployment, commitment]
    );
    return result.rows[0] ?? null;
  }

  async enqueue(input: {
    requestId: string;
    commitment: string;
    binding: string;
    acceptedBlock: string;
    acceptedAt: number;
    modelPolicy?: string;
  }) {
    await this.db.query(
      `WITH stale AS (DELETE FROM portal_v1_publication p WHERE p.deployment=$1 AND p.request_id=$2
      AND EXISTS(SELECT 1 FROM portal_v1_job j WHERE j.deployment=$1 AND j.request_id=$2 AND j.binding<>$4))
      INSERT INTO portal_v1_job(deployment,request_id,commitment,binding,accepted_block,accepted_at,model_policy)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(deployment,request_id) DO UPDATE
      SET commitment=excluded.commitment,binding=excluded.binding,accepted_block=excluded.accepted_block,accepted_at=excluded.accepted_at,
        model_policy=excluded.model_policy,attempts=0,progress='{}',completed=false,retry_at=now(),lease_token=NULL,lease_until=NULL
      WHERE portal_v1_job.binding<>excluded.binding`,
      [
        this.deployment,
        input.requestId,
        input.commitment,
        input.binding,
        input.acceptedBlock,
        input.acceptedAt,
        input.modelPolicy ?? null
      ]
    );
  }

  async claim(modelPolicy?: string): Promise<PortalJob | null> {
    const token = randomUUID();
    const result = await this.db.query<PortalJob>(
      `UPDATE portal_v1_job j SET lease_token=$2,
      lease_until=now()+interval '15 minutes',attempts=j.attempts+1
      WHERE (j.deployment,j.request_id) IN (
        SELECT deployment,request_id FROM portal_v1_job WHERE deployment=$1 AND NOT completed
          AND retry_at<=now() AND (lease_until IS NULL OR lease_until<now())
          AND ($3::text IS NULL OR model_policy IS NULL OR model_policy=$3)
        ORDER BY request_id FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING request_id::text AS "requestId",commitment,binding,accepted_block::text AS "acceptedBlock",
        accepted_at::float8 AS "acceptedAt",lease_token AS "leaseToken",attempts,progress`,
      [this.deployment, token, modelPolicy ?? null]
    );
    return result.rows[0] ?? null;
  }

  async save(job: PortalJob) {
    const result = await this.db.query(
      `UPDATE portal_v1_job SET progress=$4::jsonb,lease_until=now()+interval '15 minutes'
      WHERE deployment=$1 AND request_id=$2 AND lease_token=$3 AND lease_until>now() RETURNING request_id`,
      [
        this.deployment,
        job.requestId,
        job.leaseToken,
        JSON.stringify(job.progress)
      ]
    );
    if (!result.rows.length) throw new Error("Portal job lease lost");
  }

  async heartbeat(job: PortalJob) {
    const result = await this.db.query(
      `UPDATE portal_v1_job SET lease_until=now()+interval '15 minutes'
      WHERE deployment=$1 AND request_id=$2 AND lease_token=$3 AND lease_until>now() RETURNING request_id`,
      [this.deployment, job.requestId, job.leaseToken]
    );
    if (!result.rows.length) throw new Error("Portal job lease lost");
  }

  async retry(job: PortalJob, error: string) {
    const delay = Math.min(3600, 2 ** Math.min(job.attempts, 11));
    await this.db.query(
      `UPDATE portal_v1_job SET lease_token=NULL,lease_until=NULL,last_error=$4,
      retry_at=now()+make_interval(secs=>$5) WHERE deployment=$1 AND request_id=$2 AND lease_token=$3`,
      [
        this.deployment,
        job.requestId,
        job.leaseToken,
        error.slice(0, 300),
        delay
      ]
    );
  }

  async candidates(
    job: PortalJob,
    spell: string,
    embedding: number[],
    embeddingModel = "text-embedding-3-small"
  ): Promise<PortalCandidate[]> {
    const result = await this.db.query<PortalCandidate>(
      `WITH RECURSIVE authors(wallet) AS (
      SELECT submitter FROM portal_v1_spell WHERE deployment=$1 AND commitment=$6
      UNION SELECT CASE WHEN l.left_wallet=a.wallet THEN l.right_wallet ELSE l.left_wallet END
      FROM portal_v1_author_link l JOIN authors a ON l.left_wallet=a.wallet OR l.right_wallet=a.wallet
      WHERE l.deployment=$1 AND l.created_at<=to_timestamp($3)
    ), eligible AS (
      SELECT p.*,p.submitter IN(SELECT wallet FROM authors) AS same_author,
        CASE WHEN normalized=$4 THEN 2::float8 ELSE
        (SELECT coalesce(sum(e.value*($5::float8[])[e.n]),0) FROM unnest(p.embedding) WITH ORDINALITY AS e(value,n)) END AS similarity
      FROM portal_v1_publication p WHERE deployment=$1 AND publication_block<$2::numeric
        AND publication_timestamp<$3 AND published_at<=to_timestamp($3)
        AND cardinality(embedding)=cardinality($5::float8[]) AND embedding_model=$7
    ) SELECT request_id::text AS "requestId",submitter,spell,same_author AS "sameAuthor",similarity
      FROM eligible ORDER BY similarity DESC,request_id LIMIT 8`,
      [
        this.deployment,
        job.acceptedBlock,
        job.acceptedAt,
        normalizedSpell(spell),
        embedding,
        job.commitment,
        embeddingModel
      ]
    );
    return result.rows;
  }

  async publish(
    job: PortalJob,
    publication: {
      tokenId: string;
      submitter: string;
      spell: string;
      embedding: number[];
      embeddingModel?: string;
      block: string;
      timestamp: number;
      result: unknown;
      artifacts: string[];
    }
  ) {
    // Fencing and publication are one statement: a replaced worker cannot expose artifacts.
    const result = await this.db.query(
      `WITH owned AS (
      UPDATE portal_v1_job SET completed=true,lease_token=NULL,lease_until=NULL,last_error=NULL
      WHERE deployment=$1 AND request_id=$2 AND lease_token=$13 AND binding=$14 AND lease_until>now() RETURNING request_id
    ), published AS (
      INSERT INTO portal_v1_publication(deployment,request_id,token_id,submitter,spell,normalized,embedding,publication_block,publication_timestamp,result,artifact_hashes,embedding_model)
      SELECT $1,$2,$3,$4,$5,$6,$7::float8[],$8,$9,$10::jsonb,$11::text[],$12 FROM owned
      ON CONFLICT(deployment,request_id) DO UPDATE SET
        result=portal_v1_publication.result || jsonb_build_object('slab',excluded.result->'slab'),
        artifact_hashes=ARRAY(SELECT DISTINCT unnest(portal_v1_publication.artifact_hashes || excluded.artifact_hashes))
      WHERE portal_v1_publication.result->'slab' IS NULL
        AND portal_v1_publication.result->'result'->>'requestBinding'=excluded.result->'result'->>'requestBinding'
        AND portal_v1_publication.result->'result'->'artwork'=excluded.result->'result'->'artwork'
      RETURNING request_id
    ) SELECT request_id FROM owned`,
      [
        this.deployment,
        job.requestId,
        publication.tokenId,
        publication.submitter.toLowerCase(),
        publication.spell,
        normalizedSpell(publication.spell),
        publication.embedding,
        publication.block,
        publication.timestamp,
        JSON.stringify(publication.result),
        publication.artifacts,
        publication.embeddingModel ?? "text-embedding-3-small",
        job.leaseToken,
        job.binding
      ]
    );
    if (!result.rows.length) throw new Error("Portal job lease lost");
  }

  async publicHistory(tokenId: string, requests?: string[]) {
    const result = await this.db.query<{
      requestId: string;
      spell: string;
      result: unknown;
    }>(
      `SELECT request_id::text AS "requestId",spell,result
      FROM portal_v1_publication WHERE deployment=$1 AND token_id=$2 AND ($3::text[] IS NULL OR request_id::text=ANY($3)) ORDER BY request_id DESC LIMIT 100`,
      [this.deployment, tokenId, requests ?? null]
    );
    return result.rows;
  }

  async isPublishedArtifact(hash: string) {
    const result = await this.db.query(
      `SELECT 1 FROM portal_v1_publication WHERE deployment=$1 AND $2=ANY(artifact_hashes) LIMIT 1`,
      [this.deployment, hash]
    );
    return result.rows.length > 0;
  }

  async linkAuthors(
    left: string,
    right: string,
    leftSignature: string,
    rightSignature: string
  ) {
    await this.db.query(
      `INSERT INTO portal_v1_author_link(deployment,left_wallet,right_wallet,left_signature,right_signature)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [this.deployment, left, right, leftSignature, rightSignature]
    );
  }

  async cursor(): Promise<{ block: bigint; hash: string } | null> {
    const result = await this.db.query<{ block: string; hash: string }>(
      `SELECT block_number::text AS block,block_hash AS hash FROM portal_v1_cursor WHERE deployment=$1`,
      [this.deployment]
    );
    return result.rows[0]
      ? { block: BigInt(result.rows[0].block), hash: result.rows[0].hash }
      : null;
  }

  async rewind(from: bigint) {
    // Remove public visibility before replay. Canonical cached results are reused after reconfirmation.
    await this.db.query(
      `WITH hidden AS (DELETE FROM portal_v1_publication WHERE deployment=$1 AND publication_block >= $2)
      UPDATE portal_v1_job SET completed=false,retry_at=now(),lease_token=NULL,lease_until=NULL
      WHERE deployment=$1 AND accepted_block >= $2`,
      [this.deployment, from.toString()]
    );
  }

  async saveCursor(block: bigint, hash: string) {
    await this.db.query(
      `INSERT INTO portal_v1_cursor(deployment,block_number,block_hash) VALUES($1,$2,$3)
      ON CONFLICT(deployment) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash`,
      [this.deployment, block.toString(), hash]
    );
  }
}
