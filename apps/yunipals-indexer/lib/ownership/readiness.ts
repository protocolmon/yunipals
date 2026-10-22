import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { indexedCollections, type CollectionId } from "../constants.js";
import {
  ownershipReadConfig,
  physicalPonderSchemaName,
  ponderSchema,
  sqlIdentifier
} from "../offchain/sql.js";

export class OwnershipSourceUnavailable extends Error {
  readonly code = "YI001";
  constructor(readonly reason: string) {
    super("Ownership source unavailable.");
  }
}
type Queryable = Pick<Pool, "query">;
async function sourceQuery<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (["42P01", "42883", "42501", "3F000"].includes(code))
      throw new OwnershipSourceUnavailable("read_configuration_unavailable");
    throw error;
  }
}
export type OwnershipSourceStatus = {
  collection: CollectionId;
  available: boolean;
  ready: boolean;
  reason: string;
  source_id?: string;
  chain_id?: number;
  contract_address?: string;
  block_number?: string;
  block_hash?: string;
  block_timestamp?: string;
  observed_at?: string;
  heartbeat_at?: string;
  release_id?: string;
  manifest_hash?: string;
  policy?: string;
};
export async function assertLegacyOwnershipSelection(
  db: Queryable,
  selection: { physicalSchema: string; readSchema: string }
) {
  const row = (
    await db.query<{
      physical_source: string | null;
      read_source: string | null;
      marker: string | null;
    }>(
      "SELECT to_regclass($1) AS physical_source,to_regclass($2) AS read_source,to_regclass($3) AS marker",
      [
        `${sqlIdentifier(selection.physicalSchema)}.indexer_source`,
        `${sqlIdentifier(selection.readSchema)}.indexer_source`,
        `${sqlIdentifier(selection.readSchema)}._unified_read_release`
      ]
    )
  ).rows[0];
  if (row?.physical_source || row?.read_source || row?.marker)
    throw new OwnershipSourceUnavailable("mixed_read_configuration");
}
export async function assertOwnershipSourceSelection(db: Queryable) {
  // Unified requests validate identity/readiness lazily, preserving independent
  // healthy sources when another deployment has not finished starting.
  if (ownershipReadConfig.mode === "legacy")
    await assertLegacyOwnershipSelection(db, {
      physicalSchema: physicalPonderSchemaName,
      readSchema: ownershipReadConfig.readSchema
    });
}
export async function ownershipReadIdentity(db: Queryable) {
  if (ownershipReadConfig.mode !== "unified") return null;
  const row = (
    await sourceQuery(() =>
      db.query<{
        identity: string;
        release_id: string;
        manifest_hash: string;
        physical_schema: string;
      }>(
        `SELECT v.identity,v.release_id,v.manifest_hash,r.physical_schema FROM ${ponderSchema}._unified_read_release v
    JOIN yunipals_indexer_control.release r ON r.id=v.release_id WHERE v.singleton`
      )
    )
  ).rows[0];
  if (
    !row ||
    row.release_id !== ownershipReadConfig.releaseId ||
    row.physical_schema !== physicalPonderSchemaName ||
    !/^0x[0-9a-f]{64}$/.test(row.identity) ||
    !/^0x[0-9a-f]{64}$/.test(row.manifest_hash)
  )
    throw new OwnershipSourceUnavailable("release_mismatch");
  return row;
}
export async function unifiedOwnershipStatus(
  db: Queryable,
  collections: readonly CollectionId[]
) {
  if (collections.some((collection) => !indexedCollections[collection]))
    throw new Error("Invalid ownership collections.");
  const identity = await ownershipReadIdentity(db);
  if (!identity) return null;
  const statuses: OwnershipSourceStatus[] = [];
  for (const collection of [...new Set(collections)]) {
    const value = (
      await sourceQuery(() =>
        db.query<{ status: Record<string, unknown> }>(
          `SELECT ${ponderSchema}.source_probe($1) AS status`,
          [collection]
        )
      )
    ).rows[0]?.status;
    if (
      !value ||
      value.collection !== collection ||
      typeof value.available !== "boolean" ||
      typeof value.ready !== "boolean"
    )
      throw new OwnershipSourceUnavailable("source_status_invalid");
    const status = Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key,
        ["block_number", "block_timestamp", "heartbeat_at"].includes(key)
          ? String(value)
          : value
      ])
    ) as OwnershipSourceStatus;
    if (
      status.available &&
      (status.release_id !== identity.release_id ||
        status.manifest_hash !== identity.manifest_hash ||
        status.chain_id !== indexedCollections[collection].chainId ||
        status.contract_address !== indexedCollections[collection].address ||
        status.policy !==
          (collection === "bnb"
            ? `depth:${ownershipReadConfig.bnbConfirmations}`
            : "latest") ||
        !/^(0|[1-9][0-9]*)$/.test(status.block_number ?? "") ||
        !/^0x[0-9a-f]{64}$/.test(status.block_hash ?? ""))
    )
      throw new OwnershipSourceUnavailable("source_mismatch");
    statuses.push(status);
  }
  const blocked = statuses
    .filter((status) => !status.available)
    .map((status) => status.collection);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        identity.identity,
        ...statuses.map((status) => [
          status.collection,
          status.block_number,
          status.block_hash,
          status.policy,
          status.available
        ])
      ])
    )
    .digest("hex");
  return {
    mode: "unified" as const,
    ready: blocked.length === 0,
    caughtUp: statuses.every((status) => status.ready),
    blocked,
    collections: statuses,
    identity,
    fingerprint
  };
}
export async function assertOwnershipAvailable(
  db: Queryable,
  collections: readonly CollectionId[]
) {
  if (ownershipReadConfig.mode === "legacy")
    await assertOwnershipSourceSelection(db);
  const status = await unifiedOwnershipStatus(db, collections);
  if (status && !status.ready)
    throw new OwnershipSourceUnavailable(
      status.collections.find((source) => !source.available)?.reason ??
        "source_unavailable"
    );
  return { fingerprint: status?.fingerprint ?? "legacy" };
}
