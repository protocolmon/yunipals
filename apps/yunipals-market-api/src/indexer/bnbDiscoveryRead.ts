import type { PoolClient } from "pg";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import {
  createIndexerReader,
  type IndexerReader,
  type CanonicalPageOptions
} from "@protopals/yunipals-indexer-server/readers";
import { marketplaceOwnershipIndexer } from "@/indexer/ownership";
import { BnbOrderError } from "@/bnb/orders";

export type BnbDiscoveryQualification = {
  reader: IndexerReader;
  readSchema: string;
  configurationHash: string;
  policyFingerprint: string;
  epoch: string;
  generation: string;
  completed: { number: string; hash: string };
  cursor: NonNullable<CanonicalPageOptions["cursor"]>;
};
export type BnbDiscoveryBinding = {
  native: boolean;
  ready: boolean;
  qualification?: BnbDiscoveryQualification;
};

/** Read-only counterpart of the owner/worker's immutable registration. The GET
 * may verify a single canonical page, but never advances or repairs a cursor. */
export async function readBnbDiscoveryBinding(
  db: Pick<PoolClient, "query">
): Promise<BnbDiscoveryBinding> {
  const row = (
    await db.query<{
      reader_mode: string;
      launch_block: string;
      next_block: string;
      target_block: string | null;
      scanned_block_hash: string | null;
      policy_fingerprint: string;
      updated_at: Date;
      mode: string;
      last_error_code: string | null;
      chain_id: number | null;
      release_id: string | null;
      source_id: string | null;
      confirmation_policy: unknown;
      configuration_hash: string | null;
      cursor: CanonicalPageOptions["cursor"] | null;
      generation: string | null;
      created_at: Date | null;
    }>(`SELECT d.reader_mode,d.mode,d.last_error_code,d.launch_block::text,d.next_block::text,d.target_block::text,d.scanned_block_hash,d.policy_fingerprint,d.updated_at,
    c.chain_id,c.release_id,c.source_id,c.confirmation_policy,c.configuration_hash,c.cursor,c.generation::text,c.created_at
    FROM yunipals_market.bnb_discovery_cursor d LEFT JOIN yunipals_market.shared_indexer_consumer c ON c.consumer='bnb-discovery' WHERE d.singleton`)
  ).rows[0];
  if (!row || row.reader_mode !== "unified")
    return { native: false, ready: true };
  const indexer = marketplaceOwnershipIndexer();
  if (!indexer) throw new BnbOrderError("indexer_unavailable", 503);
  try {
    const reader = await createIndexerReader(indexer.pool, {
      releaseId: indexer.releaseId
    });
    const source = reader.release.manifest.sources.find(
      (source) => source.id === "marketplace:bnb:seaport"
    );
    if (
      !source?.enabled ||
      source.chainId !== 56 ||
      source.feature !== "marketplace" ||
      source.address !== seaportDeployment.address.toLowerCase() ||
      source.abiHash !== manifestDigest(seaportEventAbi) ||
      !source.startBlock ||
      source.endBlock !== null ||
      source.receiptRequirement !== "full" ||
      !["OrderValidated", "CounterIncremented"].every((event) =>
        source.events.includes(event)
      ) ||
      !source.policies.some((policy) => policy.kind === "finalized") ||
      !/^[1-9][0-9]*$/.test(row.launch_block) ||
      BigInt(row.launch_block) < BigInt(source.startBlock) ||
      !/^0x[0-9a-f]{64}$/.test(row.policy_fingerprint)
    )
      throw new Error("BNB discovery source binding mismatch.");
    const configurationHash = manifestDigest({
      version: 1,
      consumer: "bnb-discovery",
      sourceId: source.id,
      chainId: 56,
      address: source.address,
      abiHash: source.abiHash,
      startBlock: source.startBlock,
      launchBlock: row.launch_block,
      confirmationPolicy: { kind: "finalized" },
      policyFingerprint: row.policy_fingerprint
    });
    if (
      row.release_id !== indexer.releaseId ||
      row.chain_id !== 56 ||
      row.source_id !== source.id ||
      row.configuration_hash !== configurationHash ||
      manifestDigest(row.confirmation_policy) !==
        manifestDigest({ kind: "finalized" })
    )
      throw new Error("BNB discovery registration mismatch.");
    if (!row.cursor) return { native: true, ready: false };
    await reader.page(
      source.id,
      { kind: "finalized" },
      { cursor: row.cursor, limit: 1, includeReceipts: false }
    );
    const fresh = await reader.status(source.id, { kind: "finalized" });
    const complete = row.cursor.completed;
    const ready =
      fresh.readiness.ready &&
      !!fresh.anchor &&
      complete !== null &&
      row.cursor.target === null &&
      row.cursor.after === null &&
      BigInt(complete.number) <= BigInt(fresh.anchor.number) &&
      Number.isFinite(row.updated_at.getTime()) &&
      row.updated_at.getTime() <= Date.now() + 30_000 &&
      Date.now() - row.updated_at.getTime() <= 720_000 &&
      row.target_block !== null &&
      BigInt(row.target_block) === BigInt(complete.number) &&
      row.scanned_block_hash === complete.hash &&
      BigInt(row.next_block) === BigInt(row.target_block) + 1n;
    // Per-order processing may already cover a completed block while later
    // pages or unrelated orders are catching up. Do not weaken global ready.
    const qualified =
      complete !== null &&
      row.mode === "live" &&
      row.last_error_code === null &&
      row.generation !== null &&
      /^(0|[1-9][0-9]*)$/.test(row.generation) &&
      row.created_at instanceof Date &&
      Number.isFinite(row.created_at.getTime()) &&
      row.created_at.getTime() <= Date.now() + 30_000 &&
      ["ready", "catching_up"].includes(fresh.readiness.reason) &&
      !!fresh.anchor &&
      BigInt(complete.number) <= BigInt(fresh.anchor.number) &&
      Number.isFinite(row.updated_at.getTime()) &&
      row.updated_at.getTime() <= Date.now() + 30_000 &&
      Date.now() - row.updated_at.getTime() <= 720_000 &&
      row.scanned_block_hash === complete.hash &&
      BigInt(row.next_block) === BigInt(complete.number) + 1n &&
      row.target_block !== null &&
      BigInt(row.target_block) >= BigInt(complete.number);
    return {
      native: true,
      ready,
      ...(qualified
        ? {
            qualification: {
              reader,
              readSchema: indexer.readSchema,
              configurationHash,
              policyFingerprint: row.policy_fingerprint,
              epoch: row.created_at!.toISOString(),
              generation: row.generation!,
              completed: complete!,
              cursor: row.cursor
            }
          }
        : {})
    };
  } catch {
    throw new BnbOrderError("indexer_unavailable", 503);
  }
}
