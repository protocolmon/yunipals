import type { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import { indexerTransaction } from "../../../../packages/yunipals-indexer-server/src/database.js";
import { loadIndexerRelease } from "../../../../packages/yunipals-indexer-server/src/releases.js";
import { readIndexerSourceStatus } from "../../../../packages/yunipals-indexer-server/src/status.js";
import { confirmationPolicyKey } from "../../../../packages/yunipals-indexer-client/src/sources.js";
import { solanaStatus } from "../solana/api.js";

async function isolated<T>(
  db: PoolClient,
  name: string,
  task: () => Promise<T>
) {
  await db.query(`SAVEPOINT ${name}`);
  try {
    const result = await task();
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return { available: false, reason: "source_unavailable" } as const;
  }
}

export function mountProjectIndexerStatus(
  app: Hono,
  pool: Pool,
  options: { evmReleaseId: string | null; solanaEnabled: boolean }
) {
  app.get("/v1/indexer/status", async (c) => {
    const status = await indexerTransaction(
      pool,
      async (db) => {
        const evm = options.evmReleaseId
          ? await isolated(db, "evm_status", async () => {
              const release = await loadIndexerRelease(
                db,
                options.evmReleaseId!
              );
              const sources = [];
              for (const source of release.manifest.sources) {
                const policies = [];
                for (const policy of source.policies) {
                  if (!source.enabled) {
                    policies.push({
                      policy: confirmationPolicyKey(policy),
                      ready: false,
                      reason: "disabled",
                      availableThroughBlock: null,
                      requiredThroughBlock: null,
                      anchor: null
                    });
                    continue;
                  }
                  const status = await readIndexerSourceStatus(
                    db,
                    release,
                    source.id,
                    policy
                  );
                  policies.push({
                    policy: confirmationPolicyKey(policy),
                    ready: status.readiness.ready,
                    reason: status.readiness.reason,
                    availableThroughBlock:
                      status.readiness.availableThroughBlock?.toString() ??
                      null,
                    requiredThroughBlock:
                      status.readiness.requiredThroughBlock?.toString() ?? null,
                    anchor: status.anchor
                  });
                }
                sources.push({
                  id: source.id,
                  feature: source.feature,
                  chainId: source.chainId,
                  address: source.address,
                  enabled: source.enabled,
                  receiptRequirement: source.receiptRequirement,
                  policies
                });
              }
              return {
                available: true,
                sourceKind: "evm-events",
                releaseId: release.id,
                manifestHash: release.manifestHash,
                sources
              };
            })
          : { available: false, reason: "unified_release_not_selected" };
        const solana = options.solanaEnabled
          ? await isolated(db, "solana_status", async () => ({
              available: true,
              ...(await solanaStatus(db))
            }))
          : { enabled: false, available: false, reason: "disabled" };
        return { scope: "source_observations", evm, solana };
      },
      true
    );
    // This diagnostic does not assert feature launch or completed receipt work.
    return c.json(status);
  });
}
