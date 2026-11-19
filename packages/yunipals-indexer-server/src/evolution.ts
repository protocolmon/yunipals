import type { Pool, PoolClient } from "pg";
import { indexerTransaction, sqlIdentifier } from "./database.js";
import {
  loadIndexerRelease,
  readBoundRuntime,
  type RegisteredRelease
} from "./releases.js";
import { readIndexerSourceStatus } from "./status.js";
import { CanonicalSourceUnavailable } from "./paging.js";

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
        const status = await Promise.all(
          sources.map((v) =>
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
