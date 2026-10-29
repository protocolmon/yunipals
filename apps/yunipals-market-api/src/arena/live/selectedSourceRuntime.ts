import type { Pool } from "pg";
import type { Address, PublicClient } from "viem";
import { arenaNativeConfiguration, NativeArenaSource } from "./nativeSource";
import { ArenaRollbackSource, arenaRollbackSourceId } from "./rollbackSource";
import {
  selectedArenaSource,
  type ArenaSourceBinding
} from "./sourceSelection";
import {
  arenaSourceSelectionMigration,
  arenaSourceWatermarkMigration,
  arenaSourceDeleteFenceMigration,
  arenaSourcePredecessorMigration
} from "./sourceSelectionSchema";

/** Select only the public source and epoch. No key, signer, provider or catalog
 * configuration is loaded here; disclosure uses the same fence as other workers.
 * The caller must still assert the binding before using the returned source. */
export async function selectedArenaRuntimeSource(options: {
  pool: Pool;
  sourcePool?: Pool;
  native: ReturnType<typeof arenaNativeConfiguration>;
  deployment: { id: string; contract: Address; startBlock: bigint };
  mediaKind?: "video" | "anime";
  base: Pick<PublicClient, "getBlock" | "getChainId">;
}) {
  const { pool, sourcePool, native, deployment, base } = options;
  const selected = await selectedArenaSource(pool, deployment.id);
  let binding: ArenaSourceBinding | undefined;
  if (selected) {
    if (
      native.mode !== "unified" ||
      selected.kind !== native.sourceKind ||
      selected.source_id !== native.releaseId
    )
      throw new Error(
        "Arena runtime does not match its selected source epoch."
      );
    binding = {
      epoch: selected.epoch,
      kind: selected.kind,
      sourceId: selected.source_id
    };
  }
  if (
    native.mode === "unified" &&
    native.sourceKind === "legacy_rollback" &&
    !binding
  )
    throw new Error(
      "Arena rollback requires an explicitly reviewed source switch."
    );
  for (const migration of [
    arenaSourceSelectionMigration,
    arenaSourceWatermarkMigration,
    arenaSourceDeleteFenceMigration,
    arenaSourcePredecessorMigration
  ]) {
    const marker = (
      await pool.query<{ checksum: string }>(
        "SELECT checksum FROM yunipals_arena.operational_migration WHERE version=$1",
        [migration.version]
      )
    ).rows[0];
    if (marker?.checksum !== migration.checksum)
      throw new Error(
        "Arena source selection schema does not match this runtime."
      );
  }
  if (native.mode !== "unified") return { nativeSource: undefined, binding };
  if (!sourcePool)
    throw new Error("Native Arena requires its read-only source pool.");
  if (native.sourceKind === "unified")
    return {
      nativeSource: new NativeArenaSource(
        sourcePool,
        native.releaseId,
        deployment.contract,
        deployment.startBlock,
        options.mediaKind
      ),
      binding
    };
  const floor = (
    await pool.query<{ block: string; hash: string }>(
      "SELECT accepted_block::text AS block,accepted_hash AS hash FROM yunipals_arena.source_selection WHERE deployment=$1",
      [deployment.id]
    )
  ).rows[0];
  if (!floor)
    throw new Error("Arena rollback requires its reviewed source floor.");
  if (
    arenaRollbackSourceId(
      native.databaseUrl,
      deployment.contract,
      deployment.startBlock
    ) !== native.releaseId
  )
    throw new Error(
      "Arena rollback source identity differs from its endpoint/configuration."
    );
  const [operational, source] = await Promise.all([
    pool.query(
      "SELECT current_database() AS db,inet_server_addr()::text AS host,inet_server_port() AS port"
    ),
    sourcePool.query(
      "SELECT current_database() AS db,inet_server_addr()::text AS host,inet_server_port() AS port"
    )
  ]);
  if (JSON.stringify(operational.rows[0]) === JSON.stringify(source.rows[0]))
    throw new Error(
      "Arena rollback requires an isolated public projection database."
    );
  return {
    nativeSource: new ArenaRollbackSource(
      sourcePool,
      native.releaseId,
      deployment.contract.toLowerCase(),
      deployment.startBlock,
      floor,
      base
    ),
    binding
  };
}
