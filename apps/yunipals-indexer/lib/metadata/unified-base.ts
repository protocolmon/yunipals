import type { Pool, PoolClient } from "pg";
import { decodeEventLog, type Hex } from "viem";
import type {
  BlockAnchor,
  CanonicalCursor,
  CanonicalEventRecord
} from "../../../../packages/yunipals-indexer-client/src/events.js";
import type { IndexerReader } from "../../../../packages/yunipals-indexer-server/src/readers.js";
import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";
import { collections } from "../constants.js";
import { baseMetadataAbi } from "./base-abi.js";
import {
  insertBaseMetadataEvents,
  validateBaseMetadataEvents,
  type BaseMetadataEvent
} from "./source/base-events.js";
import { canonicalJson } from "./source/canonical.js";

const name = "base_metadata_v1";
const sourceId = "metadata:base";
const policy = { kind: "finalized" } as const;
import { approvedBaseMetadataImplementation } from "./base-implementation.js";
export { approvedBaseMetadataImplementation } from "./base-implementation.js";

// Point reads only: this consumer has no log-scanning interface.
export type BaseMetadataPointRpc = {
  chainId(): Promise<number>;
  blockHash(number: bigint): Promise<string>;
  implementation(number: bigint): Promise<string>;
};
type Scan = {
  chain_id: number;
  contract_address: string;
  deployment_block: string;
  next_block: string;
  target_block: string;
  target_hash: string;
  last_scanned_hash: string | null;
  ingestion_mode: "rpc" | "unified";
  release_id: string | null;
  manifest_hash: string | null;
  cursor: CanonicalCursor | null;
};

async function state(db: PoolClient, lock = false) {
  return (
    (
      await db.query<Scan>(
        `SELECT s.chain_id,s.contract_address,s.deployment_block::text,s.next_block::text,
      s.target_block::text,s.target_hash,s.last_scanned_hash,s.ingestion_mode,
      c.release_id,c.manifest_hash,c.cursor
      FROM metadata_source.chain_metadata_scan s
      LEFT JOIN metadata_source.chain_metadata_consumer c USING(name)
      WHERE s.name=$1 ${lock ? "FOR UPDATE OF s" : ""}`,
        [name]
      )
    ).rows[0] ?? null
  );
}

async function withWriter<T>(pool: Pool, task: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  let acquired = false;
  try {
    acquired = (
      await db.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('metadata:base-replay')) AS acquired"
      )
    ).rows[0]!.acquired;
    if (!acquired) return { busy: true as const };
    return await task(db);
  } finally {
    if (acquired)
      await db
        .query("SELECT pg_advisory_unlock(hashtext('metadata:base-replay'))")
        .finally(() => db.release());
    else db.release();
  }
}

function assertSource(reader: IndexerReader) {
  const source = reader.release.manifest.sources.find(
    (source) => source.id === sourceId
  );
  if (
    !source?.enabled ||
    source.chainId !== 8453 ||
    source.feature !== "base-metadata" ||
    source.address !== collections.base.address ||
    source.startBlock !== String(collections.base.deploymentBlock) ||
    source.endBlock !== null ||
    source.abiHash !== manifestDigest(baseMetadataAbi)
  )
    throw new Error("Base metadata source requires configuration/ABI review.");
}

async function checkBoundary(rpc: BaseMetadataPointRpc, boundary: BlockAnchor) {
  if ((await rpc.chainId()) !== 8453)
    throw new Error("Base metadata RPC chain mismatch.");
  if ((await rpc.blockHash(BigInt(boundary.number))) !== boundary.hash)
    throw new Error("Finalized Base metadata boundary changed.");
  if (
    (await rpc.implementation(BigInt(boundary.number))) !==
    approvedBaseMetadataImplementation
  )
    throw new Error("Base implementation needs ABI review.");
}

async function checkStoredScan(scan: Scan, rpc: BaseMetadataPointRpc) {
  const deployment = BigInt(collections.base.deploymentBlock);
  if (
    scan.chain_id !== 8453 ||
    scan.contract_address !== collections.base.address ||
    BigInt(scan.deployment_block) !== deployment ||
    BigInt(scan.next_block) < deployment ||
    BigInt(scan.target_block) < deployment ||
    BigInt(scan.next_block) > BigInt(scan.target_block) + 1n
  )
    throw new Error("Base metadata scan configuration changed.");
  if (
    BigInt(scan.next_block) > deployment &&
    (!scan.last_scanned_hash ||
      (await rpc.blockHash(BigInt(scan.next_block) - 1n)) !==
        scan.last_scanned_hash)
  )
    throw new Error("Previously finalized Base checkpoint changed.");
  if ((await rpc.blockHash(BigInt(scan.target_block))) !== scan.target_hash)
    throw new Error("Previously finalized Base target changed.");
}

function assertBound(scan: Scan, reader: IndexerReader) {
  if (
    scan.ingestion_mode !== "unified" ||
    scan.release_id !== reader.release.id ||
    scan.manifest_hash !== reader.release.manifestHash ||
    !scan.cursor
  )
    throw new Error("Base metadata consumer needs explicit release adoption.");
  if (
    scan.cursor.releaseId !== scan.release_id ||
    scan.cursor.sourceId !== sourceId ||
    scan.cursor.policy !== "finalized" ||
    (scan.cursor.completed
      ? BigInt(scan.cursor.completed.number) + 1n
      : BigInt(collections.base.deploymentBlock)) !== BigInt(scan.next_block) ||
    (scan.cursor.completed &&
      scan.cursor.completed.hash !== scan.last_scanned_hash)
  )
    throw new Error("Base metadata cursor and published coverage disagree.");
}

/** Explicit migration step, never called implicitly by worker startup. */
export async function adoptBaseMetadataConsumer(
  pool: Pool,
  reader: IndexerReader,
  rpc: BaseMetadataPointRpc
) {
  assertSource(reader);
  return withWriter(pool, async (db) => {
    const before = await state(db);
    const status = await reader.status(sourceId, policy);
    if (
      !["ready", "catching_up"].includes(status.readiness.reason) ||
      !status.anchor
    )
      throw new Error("Finalized Base metadata source is unavailable.");
    await checkBoundary(rpc, status.anchor);
    if (before) {
      await checkStoredScan(before, rpc);
      if (before.ingestion_mode === "unified") {
        assertBound(before, reader);
        return { adopted: false, releaseId: reader.release.id };
      }
      if (
        before.cursor ||
        BigInt(before.target_block) > BigInt(status.anchor.number)
      )
        throw new Error(
          "Shared source has not covered the existing Base scan target."
        );
    }
    const cursor: CanonicalCursor = {
      version: 1,
      releaseId: reader.release.id,
      sourceId,
      policy: "finalized",
      completed:
        before &&
        BigInt(before.next_block) > BigInt(collections.base.deploymentBlock)
          ? {
              number: String(BigInt(before.next_block) - 1n),
              hash: before.last_scanned_hash!
            }
          : null,
      target: null,
      after: null
    };
    await db.query("BEGIN");
    try {
      if (canonicalJson(await state(db, true)) !== canonicalJson(before))
        throw new Error("Base metadata writer changed during adoption.");
      if (!before)
        await db.query(
          `INSERT INTO metadata_source.chain_metadata_scan
          (name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash,ingestion_mode)
          VALUES($1,8453,$2,$3,$3,$4,$5,'unified')`,
          [
            name,
            collections.base.address,
            collections.base.deploymentBlock,
            status.anchor.number,
            status.anchor.hash
          ]
        );
      else
        await db.query(
          "UPDATE metadata_source.chain_metadata_scan SET ingestion_mode='unified',updated_at=now() WHERE name=$1",
          [name]
        );
      await db.query(
        `INSERT INTO metadata_source.chain_metadata_consumer(name,release_id,manifest_hash,cursor)
        VALUES($1,$2,$3,$4)`,
        [
          name,
          reader.release.id,
          reader.release.manifestHash,
          JSON.stringify(cursor)
        ]
      );
      await db.query("COMMIT");
      return { adopted: true, releaseId: reader.release.id };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}

export function decodeBaseMetadataEvent(
  event: CanonicalEventRecord
): BaseMetadataEvent {
  if (
    event.sourceId !== sourceId ||
    event.chainId !== 8453 ||
    event.address !== collections.base.address ||
    event.abiHash !== manifestDigest(baseMetadataAbi)
  )
    throw new Error("Unexpected Base metadata event source.");
  const decoded = decodeEventLog({
    abi: baseMetadataAbi,
    topics: event.topics as [Hex, ...Hex[]],
    data: event.data as Hex,
    strict: true
  });
  if (
    decoded.eventName !== event.name ||
    canonicalJson(
      JSON.parse(
        JSON.stringify(decoded.args, (_, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value
        )
      )
    ) !== canonicalJson(event.args)
  )
    throw new Error("Base metadata decoded payload differs from raw evidence.");
  const args = decoded.args;
  return {
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    eventName: decoded.eventName,
    tokenId: String(args.tokenId),
    recipient: args.to.toLowerCase(),
    traits: { ...args.yunipal, rarityScore: String(args.yunipal.rarityScore) }
  };
}

export async function consumeBaseMetadataPage(
  pool: Pool,
  reader: IndexerReader,
  rpc: BaseMetadataPointRpc,
  options: { limit?: number } = {}
) {
  assertSource(reader);
  return withWriter(pool, async (db) => {
    const before = await state(db);
    if (!before)
      throw new Error("Base metadata consumer has not been adopted.");
    assertBound(before, reader);
    await checkStoredScan(before, rpc);
    const page = await reader.page(sourceId, policy, {
      cursor: before.cursor,
      limit: options.limit,
      verifyOldAnchor: async (anchor, chainId) =>
        chainId === 8453 &&
        (await rpc.blockHash(BigInt(anchor.number))) === anchor.hash
    });
    const target = page.cursor.target ?? page.cursor.completed;
    if (!target) throw new Error("Base metadata page has no coverage target.");
    await checkBoundary(rpc, target);
    const events = page.events.map(decodeBaseMetadataEvent);
    if (
      page.complete &&
      !events.length &&
      BigInt(target.number) < BigInt(before.next_block)
    )
      return { applied: 0, complete: true, cursor: page.cursor };
    validateBaseMetadataEvents(
      BigInt(before.next_block),
      BigInt(target.number),
      target.hash,
      events
    );
    const current = await reader.status(sourceId, policy);
    if (
      !["ready", "catching_up"].includes(current.readiness.reason) ||
      current.readiness.availableThroughBlock === null ||
      current.readiness.availableThroughBlock < BigInt(target.number)
    )
      throw new Error("Finalized Base metadata source changed before commit.");
    await db.query("BEGIN");
    try {
      if (canonicalJson(await state(db, true)) !== canonicalJson(before))
        throw new Error(
          "Base metadata writer changed before destination commit."
        );
      await insertBaseMetadataEvents(db, events);
      await db.query(
        `UPDATE metadata_source.chain_metadata_consumer SET cursor=$2,updated_at=now() WHERE name=$1`,
        [name, JSON.stringify(page.cursor)]
      );
      // Partially applied pages remain invisible to publication. The old
      // next_block and new target retain existing read-cache invalidation rules.
      await db.query(
        `UPDATE metadata_source.chain_metadata_scan SET target_block=$2,target_hash=$3,
        next_block=CASE WHEN $4 THEN $2::bigint+1 ELSE next_block END,
        last_scanned_hash=CASE WHEN $4 THEN $3 ELSE last_scanned_hash END,updated_at=now()
        WHERE name=$1`,
        [name, target.number, target.hash, page.complete]
      );
      await db.query("COMMIT");
      return {
        applied: events.length,
        complete: page.complete,
        cursor: page.cursor
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}
