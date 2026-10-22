import type { Pool, PoolClient } from "pg";
import type { ConfirmationPolicy } from "../../yunipals-indexer-client/src/sources.js";
import { indexerTransaction } from "./database.js";
import { readCanonicalPage } from "./paging.js";
import {
  loadIndexerRelease,
  readBoundRuntime,
  type RegisteredRelease
} from "./releases.js";
import { indexerSourceStatus, readIndexerSourceStatus } from "./status.js";

export {
  CanonicalCursorInvalidated,
  CanonicalSourceUnavailable
} from "./paging.js";
export { loadIndexerRelease, type RegisteredRelease } from "./releases.js";
export type SourceStatus = Awaited<ReturnType<typeof readIndexerSourceStatus>>;
export type CanonicalPage = Awaited<ReturnType<typeof readCanonicalPage>>;
export type CanonicalPageOptions = NonNullable<
  Parameters<typeof readCanonicalPage>[4]
>;

// Construct per request or explicitly pin for a worker batch. Publication never
// silently switches a reader or an in-progress cursor to another physical schema.
export async function createIndexerReader(
  pool: Pool,
  options: { releaseId?: string; now?: () => number } = {}
) {
  const release = await indexerTransaction(
    pool,
    async (db) => {
      const selected = await loadIndexerRelease(db, options.releaseId);
      await readBoundRuntime(db, selected);
      return selected;
    },
    true
  );
  return {
    release,
    status(sourceId: string, policy: ConfirmationPolicy) {
      return indexerSourceStatus(pool, release, sourceId, policy, {
        nowMs: options.now?.()
      });
    },
    page(
      sourceId: string,
      policy: ConfirmationPolicy,
      pageOptions?: CanonicalPageOptions
    ) {
      return readCanonicalPage(pool, release, sourceId, policy, {
        nowMs: options.now?.(),
        ...pageOptions
      });
    },
    snapshot<T>(
      sourceId: string,
      policy: ConfirmationPolicy,
      read: (
        db: PoolClient,
        context: {
          release: RegisteredRelease;
          status: SourceStatus;
        }
      ) => Promise<T>
    ): Promise<T> {
      return indexerTransaction(
        pool,
        async (db) => {
          const status = await readIndexerSourceStatus(
            db,
            release,
            sourceId,
            policy,
            { nowMs: options.now?.() }
          );
          return read(db, { release, status });
        },
        true
      );
    }
  };
}

export type IndexerReader = Awaited<ReturnType<typeof createIndexerReader>>;
