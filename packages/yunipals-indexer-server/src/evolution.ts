import type { Pool, PoolClient } from "pg";
import { indexerTransaction, sqlIdentifier } from "./database.js";
import {
  loadIndexerRelease,
  readBoundRuntime,
  type RegisteredRelease
} from "./releases.js";
import { readIndexerSourceStatus } from "./status.js";
import { CanonicalSourceUnavailable } from "./paging.js";
import { readChainStatus } from "./chain-status.js";

export type EvolutionReadContext = {
  release: RegisteredRelease;
  deployment: string;
  block: bigint;
  hash: string;
  timestamp: number;
  schema: string;
  cards: string;
  adventures: string;
  evolution: string;
};
/** Uses the same global source readiness/branch witnesses as every other confirmed consumer. */
export class EvolutionReader {
  constructor(
    readonly pool: Pool,
    readonly releaseId?: string
  ) {}
  /** Immutable publication reads can use a retained, verified prefix during an
   * intake pause or RPC outage. Reorg/identity checks still fail closed. */
  async publications(hash: string) {
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid asset hash.");
    return indexerTransaction(
      this.pool,
      async (db) => {
        const release = await loadIndexerRelease(db, this.releaseId);
        const runtime = await readBoundRuntime(db, release);
        const source = release.manifest.sources.find(
          (v) => v.id === "evolution:8453:evolution" && v.enabled
        );
        const status = await readChainStatus(db, release.id, 8453);
        const indexed = runtime.chains.find(
          (c) => c.chainId === 8453
        )?.completeThroughBlock;
        if (
          !source?.address ||
          !status ||
          status.halted ||
          indexed == null ||
          status.head_number === null ||
          status.witness_number === null ||
          !status.witness_hash ||
          (status.error_code !== null &&
            ![
              "rpc_unavailable",
              "head_stale",
              "provider_lag",
              "indexer_not_ready"
            ].includes(status.error_code))
        )
          throw new CanonicalSourceUnavailable(
            "Publication evidence is unavailable."
          );
        const schema = sqlIdentifier(release.schema);
        const witness = await db.query(
          `SELECT 1 FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
          [status.witness_number, status.witness_hash]
        );
        const limit = BigInt(status.head_number) - 12n;
        const anchors = Object.values(status.anchors).filter(
          (anchor) =>
            /^(0|[1-9][0-9]*)$/.test(anchor.number) &&
            /^0x[0-9a-f]{64}$/.test(anchor.hash) &&
            BigInt(anchor.number) <= limit &&
            BigInt(anchor.number) <= indexed &&
            (source.endBlock === null ||
              BigInt(anchor.number) <= BigInt(source.endBlock))
        );
        if (!witness.rows.length || !anchors.length)
          throw new CanonicalSourceUnavailable(
            "Publication branch is unverified."
          );
        const boundary = anchors.reduce((a, b) =>
          BigInt(a.number) > BigInt(b.number) ? a : b
        ).number;
        return (
          await db.query<{ artworkHash: string; metadataHash: string }>(
            `SELECT DISTINCT args::jsonb->>'artworkHash' AS "artworkHash", args::jsonb->>'metadataHash' AS "metadataHash"
         FROM ${schema}.canonical_event WHERE chain_id=8453 AND address=$1
         AND name='EvolutionCompleted' AND block_number<=$2
         AND (args::jsonb->>'artworkHash'=$3 OR args::jsonb->>'metadataHash'=$3)`,
            [source.address, boundary, hash]
          )
        ).rows;
      },
      true
    );
  }
  async snapshot<T>(
    read: (db: PoolClient, context: EvolutionReadContext) => Promise<T>
  ): Promise<T> {
    return indexerTransaction(
      this.pool,
      async (db) => {
        const release = await loadIndexerRelease(db, this.releaseId);
        await readBoundRuntime(db, release);
        const sources = release.manifest.sources.filter(
          (v) => v.feature === "evolution" && v.enabled
        );
        if (sources.length !== 3)
          throw new CanonicalSourceUnavailable(
            "Evolution sources are not configured."
          );
        const collection = sources.find(
          (v) => v.id === "evolution:8453:cards"
        )?.address;
        const ownership = release.manifest.sources.find(
          (v) =>
            v.enabled &&
            v.contractName === "BoosterMonsters" &&
            v.address === collection
        );
        const grading = release.manifest.sources.find(
          (v) => v.enabled && v.id === "portals:8453:grading"
        );
        if (!ownership || !grading)
          throw new CanonicalSourceUnavailable(
            "Evolution requires collection and grading coverage."
          );
        const status = await Promise.all(
          [...sources, ownership, grading].map((v) =>
            readIndexerSourceStatus(db, release, v.id, {
              kind: "depth",
              subsequentBlocks: 12
            })
          )
        );
        if (
          status.some(
            (s) =>
              !s.readiness.ready ||
              !s.anchor ||
              s.readiness.availableThroughBlock === null
          )
        )
          throw new CanonicalSourceUnavailable(
            "Evolution is waiting for confirmed indexer coverage."
          );
        const anchor = status[0].anchor!;
        if (
          status.some(
            (s) =>
              s.anchor!.number !== anchor.number ||
              s.anchor!.hash !== anchor.hash
          )
        )
          throw new CanonicalSourceUnavailable(
            "Evolution sources have inconsistent boundaries."
          );
        const address = (kind: string) =>
          sources.find((v) => v.id === `evolution:8453:${kind}`)!.address!;
        return read(db, {
          release,
          schema: sqlIdentifier(release.schema),
          deployment: `8453:${address("evolution")}`,
          cards: address("cards"),
          adventures: address("adventures"),
          evolution: address("evolution"),
          block: BigInt(anchor.number),
          hash: anchor.hash,
          timestamp: Number(anchor.timestamp)
        });
      },
      true
    );
  }
  async projection(domain: "card" | "job" | "adventure", id: string) {
    if (!/^[1-9][0-9]{0,77}$/.test(id))
      throw new Error("Invalid evolution entity.");
    return this.snapshot(async (db, context) => {
      const row = (
        await db.query<{ value: Record<string, unknown> }>(
          `SELECT value FROM ${context.schema}.evolution_projection_version
        WHERE deployment=$1 AND domain=$2 AND entity=$3 AND block_number<=$4
        ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
          [
            context.deployment,
            domain,
            `${context.deployment}:${domain}:${id}`,
            context.block.toString()
          ]
        )
      ).rows[0];
      return {
        value: row?.value ?? null,
        block: context.block,
        hash: context.hash
      };
    });
  }
  async unsettled(domain: "adventure" | "job", afterRequestId = 0n) {
    if (afterRequestId < 0n) throw new Error("Invalid settlement position.");
    return this.snapshot(async (db, context) => {
      const rows = (
        await db.query<{ value: Record<string, unknown> }>(
          `SELECT value FROM (
        SELECT DISTINCT ON(entity) value FROM ${context.schema}.evolution_projection_version
        WHERE deployment=$1 AND domain=$2 AND block_number<=$3
        ORDER BY entity,block_number DESC,transaction_index DESC,log_index DESC
      ) j WHERE (value->>'requestId')::numeric>$4 AND
        (($2='adventure' AND value->>'settled'='false') OR ($2='job' AND value->>'status'='randomness'))
        ORDER BY (value->>'requestId')::numeric LIMIT 100`,
          [
            context.deployment,
            domain,
            context.block.toString(),
            afterRequestId.toString()
          ]
        )
      ).rows;
      return { rows, block: context.block, hash: context.hash };
    });
  }
  async jobs(afterRequestId = 0n) {
    if (afterRequestId < 0n) throw new Error("Invalid job position.");
    return this.snapshot(async (db, context) => {
      const rows = (
        await db.query<{
          value: Record<string, unknown>;
          block_number: string;
        }>(
          `SELECT value,block_number::text FROM (
        SELECT DISTINCT ON(entity) value,block_number FROM ${context.schema}.evolution_projection_version
        WHERE deployment=$1 AND domain='job' AND block_number<=$2
        ORDER BY entity,block_number DESC,transaction_index DESC,log_index DESC
      ) j WHERE value->>'status'='generating' AND (value->>'requestId')::numeric>$3
      ORDER BY (value->>'requestId')::numeric LIMIT 100`,
          [
            context.deployment,
            context.block.toString(),
            afterRequestId.toString()
          ]
        )
      ).rows;
      return { rows, block: context.block, hash: context.hash };
    });
  }
}
