import { parseArgs } from "node:util";
import { pool, apiPool } from "../lib/offchain/db.js";
import { collectionSlugs } from "../lib/constants.js";
import { physicalPonderSchemaName } from "../lib/offchain/sql.js";
import {
  buildReadCache,
  preparedReadCacheFreshSql
} from "../lib/metadata/read-cache.js";
import { refreshNativeBaseMetadata } from "../lib/metadata/native-base.js";
import { baseMetadataPointRpc } from "../lib/metadata/unified-runtime.js";

const { values } = parseArgs({ options: { generation: { type: "string" } } });
const client = await pool.connect();
try {
  const id = values.generation ?? "";
  if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
    throw new Error("projection_cache_generation_required");
  const locked = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('yunipals:read-cache')) AS acquired"
  );
  if (!locked.rows[0]?.acquired)
    throw new Error("projection_cache_writer_busy");
  // The global guard installation is a separately reviewed maintenance step.
  // Refuse caches whose invalidation still watches the predecessor's source.
  const guards = await client.query<{ complete: boolean }>(
    `SELECT count(*)=4 AS complete FROM metadata_projection.read_guard
    WHERE collection=ANY($1::text[]) AND relation_oid=$2::regclass::oid`,
    [collectionSlugs, `${physicalPonderSchemaName}.token`]
  );
  if (!guards.rows[0]?.complete)
    throw new Error("projection_cache_source_guards_missing");
  const candidate = await client.query(
    `SELECT 1 FROM metadata_projection.generation g CROSS JOIN metadata_projection.active a
    WHERE g.id=$1 AND g.state='ready' AND g.published_at IS NULL AND a.singleton
      AND g.id NOT IN(a.current_id,a.previous_id)
      AND (g.validation->'sourceSnapshot'->>'predecessor')::bigint=a.current_id`,
    [id]
  );
  if (candidate.rowCount !== 1)
    throw new Error("projection_cache_unpublished_candidate_required");
  const rpc = baseMetadataPointRpc();
  // Base is built last so its native approval is fresh for the combined probe.
  for (const chain of [
    ...collectionSlugs.filter((chain) => chain !== "base"),
    "base"
  ] as const) {
    await refreshNativeBaseMetadata(pool, rpc);
    const rows = await buildReadCache(client, id, chain);
    console.log(
      JSON.stringify({
        event: "prepared_read_cache_built",
        generation: id,
        chain,
        rows
      })
    );
  }
  await refreshNativeBaseMetadata(pool, rpc);
  const proof = await client.query<{ fresh: boolean }>(
    `SELECT ${preparedReadCacheFreshSql(id, collectionSlugs)} AS fresh`
  );
  if (proof.rows[0]?.fresh !== true)
    throw new Error("projection_prepared_cache_unavailable");
  console.log(
    JSON.stringify({
      event: "prepared_read_cache_verified",
      generation: id,
      published: false
    })
  );
} catch (error) {
  const code =
    error instanceof Error && /^projection_[a-z_]+$/.test(error.message)
      ? error.message
      : "projection_cache_preparation_refused";
  console.error(JSON.stringify({ event: "prepared_read_cache_stopped", code }));
  process.exitCode = 1;
} finally {
  await client
    .query("SELECT pg_advisory_unlock(hashtext('yunipals:read-cache'))")
    .catch(() => undefined);
  client.release();
  await Promise.all([pool.end(), apiPool.end()]);
}
