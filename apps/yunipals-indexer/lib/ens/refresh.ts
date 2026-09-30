import { collectionSlugs, collections } from "../constants.js";
import { pool } from "../offchain/db.js";
import { verifiedPrimaryName, type EnsClient } from "./resolver.js";
import { ensTargets, type EnsCandidate } from "./targets.js";

async function mapConcurrent<T>(values: T[], concurrency: number, task: (value: T) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) await task(values[index++]!);
  }));
}

export async function refreshLeaderboardEns(options: { limit?: number; concurrency?: number; client?: EnsClient } = {}) {
  const limit = options.limit ?? Number(process.env.ENS_LEADERBOARD_LIMIT ?? 1_000);
  const candidates = await pool.query<EnsCandidate>(`
    WITH ranked AS (
      SELECT scope, owner, row_number() OVER (PARTITION BY scope ORDER BY collector_score DESC, owner) AS position
      FROM leaderboard.wallet_stats WHERE scope = ANY($2::text[])
    )
    SELECT owner, array_agg(scope ORDER BY scope) AS scopes FROM ranked
    WHERE position <= $1 GROUP BY owner
  `, [limit, ["all", ...collectionSlugs]]);
  const targets = ensTargets(candidates.rows);
  const due = (await pool.query<{ chain_id: number; address: string }>(`
    SELECT requested.chain_id, requested.address FROM unnest($1::int[], $2::text[]) AS requested(chain_id, address)
    LEFT JOIN metadata.ens_identity identity
      ON identity.chain_id=requested.chain_id AND identity.address=requested.address
    WHERE identity.address IS NULL OR (identity.expires_at <= now() AND identity.retry_after <= now())
  `, [targets.map((target) => collections[target.chain].chainId), targets.map((target) => target.address.toLowerCase())])).rows;
  const dueKeys = new Set(due.map((row) => `${row.chain_id}:${row.address}`));
  const work = targets.filter((target) => dueKeys.has(`${collections[target.chain].chainId}:${target.address.toLowerCase()}`));
  let verified = 0, missing = 0, failed = 0;
  await mapConcurrent(work, options.concurrency ?? Number(process.env.ENS_REFRESH_CONCURRENCY ?? 4), async (target) => {
    const chainId = collections[target.chain].chainId;
    const address = target.address.toLowerCase();
    try {
      const name = await verifiedPrimaryName(target.address, target.chain, options.client);
      if (name) verified++; else missing++;
      await pool.query(`INSERT INTO metadata.ens_identity
        (chain_id, address, name, verified, resolved_at, expires_at, last_error, retry_after, updated_at)
        VALUES ($1, $2, $3, $4, now(), now() + ($5 * interval '1 millisecond'), NULL, now(), now())
        ON CONFLICT (chain_id, address) DO UPDATE SET name=excluded.name, verified=excluded.verified,
          resolved_at=excluded.resolved_at, expires_at=excluded.expires_at, last_error=NULL,
          retry_after=excluded.retry_after, updated_at=excluded.updated_at`,
      [chainId, address, name, Boolean(name), name ? 86_400_000 : 7 * 86_400_000]);
    } catch (error) {
      failed++;
      await pool.query(`INSERT INTO metadata.ens_identity
        (chain_id, address, name, verified, resolved_at, expires_at, last_error, retry_after, updated_at)
        VALUES ($1, $2, NULL, false, now(), now(), $3, now() + interval '1 hour', now())
        ON CONFLICT (chain_id, address) DO UPDATE SET last_error=excluded.last_error,
          expires_at=excluded.expires_at, retry_after=excluded.retry_after, updated_at=excluded.updated_at`,
      [chainId, address, error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000)]);
    }
  });
  return { candidates: candidates.rows.length, targets: targets.length, attempted: work.length, verified, missing, failed };
}
