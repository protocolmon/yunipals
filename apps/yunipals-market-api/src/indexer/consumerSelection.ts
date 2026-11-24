import type { Pool, PoolClient } from "pg";
import type { IndexerReader } from "@protopals/yunipals-indexer-server/readers";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import {
  reviewMarketplaceContinuity,
  type MarketplaceQualification
} from "@protopals/yunipals-indexer-server/marketplace";

import {
  sharedCollectionSaleConfiguration,
  type SharedCollectionSaleConfiguration
} from "@/activity/sharedCollectionReplay";
import {
  sharedBnbSaleConfiguration,
  type SharedBnbSaleConfiguration
} from "@/activity/sharedBnbReplay";
import { sharedBnbDiscoveryConfiguration } from "@/bnb/sharedDiscovery";
import type { BnbPolicy } from "@/bnb/orders";

export type MarketplaceConsumerSelection =
  | { kind: "collection-sales"; config: SharedCollectionSaleConfiguration }
  | { kind: "bnb-sales"; config: SharedBnbSaleConfiguration }
  | { kind: "bnb-discovery"; policy: BnbPolicy; launchBlock: bigint };

function registration(
  reader: IndexerReader,
  selection: MarketplaceConsumerSelection
) {
  if (selection.kind === "bnb-discovery") {
    const config = sharedBnbDiscoveryConfiguration(
      reader,
      selection.policy,
      selection.launchBlock
    );
    return { ...config, releaseId: reader.release.id };
  }
  const config =
    selection.kind === "bnb-sales"
      ? sharedBnbSaleConfiguration(reader, selection.config)
      : sharedCollectionSaleConfiguration(reader, selection.config);
  return {
    consumer: config.consumer,
    chainId: config.definition.chainId,
    sourceId: config.definition.sourceId,
    confirmationPolicy: selection.config.confirmationPolicy,
    configurationHash: config.configurationHash,
    releaseId: reader.release.id
  };
}
type Db = Pick<PoolClient, "query">;

export class MarketplaceReplayRequired extends Error {
  constructor() {
    super(
      "Marketplace cutover blocked: continuity could not be preserved. Keep the current source serving; inspect impact.reason in the read-only review. An intentional rebuild requires a new --replay review and --replay apply."
    );
  }
}

async function selectionImpact(
  db: Db,
  reader: IndexerReader,
  next: ReturnType<typeof registration>,
  state: Awaited<ReturnType<typeof marketplaceConsumerState>>,
  forceReplay: boolean
) {
  const replay = (reason: string) => ({ mode: "replay" as const, reason });
  if (forceReplay) return replay("explicit_replay");
  const previous = state.common;
  const operational = "cursor" in state ? state.cursor : state.checkpoint;
  if (
    !previous ||
    !operational ||
    operational.reader_mode !== "unified" ||
    state.legacy
  )
    return replay("no_unified_consumer");
  if (
    previous.chain_id !== next.chainId ||
    previous.source_id !== next.sourceId ||
    previous.configuration_hash !== next.configurationHash ||
    manifestDigest(previous.confirmation_policy) !==
      manifestDigest(next.confirmationPolicy)
  )
    return replay("consumer_configuration_changed");
  if (previous.release_id === next.releaseId)
    return { mode: "unchanged" as const, reason: "already_selected" };
  if (!previous.cursor) return replay("no_completed_history");
  const qualifications = (
    await db.query<
      MarketplaceQualification & {
        proof_valid: boolean;
        proof_hash: string;
        policy: string;
      }
    >(
      `SELECT q.*, q.proof_hash='0x'||encode(sha256(convert_to(
       jsonb_build_object('receipt',r.receipt,'block',r.block)::text,'UTF8')),'hex') AS proof_valid
     FROM yunipals_market.sale_receipt_qualification q
     JOIN yunipals_market.sale_receipt r USING(chain_id,block_hash,transaction_hash)
     WHERE q.consumer=$1 ORDER BY q.chain_id,q.block_hash,q.transaction_hash,q.policy`,
      [next.consumer]
    )
  ).rows;
  if (qualifications.some((q) => !q.proof_valid))
    return replay("retained_receipt_changed");
  const continuity = await reviewMarketplaceContinuity(
    reader,
    previous.release_id,
    next.sourceId,
    next.confirmationPolicy,
    previous.cursor,
    qualifications
  );
  return {
    ...continuity,
    qualificationHash: manifestDigest(qualifications),
    qualificationCount: qualifications.length
  };
}

export async function marketplaceConsumerState(
  db: Db,
  consumer: string,
  chainId: number
) {
  const common =
    (
      await db.query(
        "SELECT to_jsonb(i) AS value FROM yunipals_market.shared_indexer_consumer i WHERE consumer=$1",
        [consumer]
      )
    ).rows[0]?.value ?? null;
  const legacy =
    (
      await db.query(
        "SELECT to_jsonb(l) AS value FROM yunipals_market.marketplace_legacy_selection l WHERE consumer=$1",
        [consumer]
      )
    ).rows[0]?.value ?? null;
  if (consumer === "bnb-discovery") {
    const cursor =
      (
        await db.query(
          "SELECT to_jsonb(c) AS value FROM yunipals_market.bnb_discovery_cursor c WHERE singleton"
        )
      ).rows[0]?.value ?? null;
    return { common, cursor, legacy };
  }
  const checkpoint =
    (
      await db.query(
        "SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE source='chain' AND chain_id=$1 AND name=$2",
        [chainId, consumer === "bnb-sales" ? "bnb-sales" : "seaport-sales"]
      )
    ).rows[0]?.value ?? null;
  const policy =
    consumer === "bnb-sales"
      ? (
          await db.query(
            "SELECT environment FROM yunipals_market.deployment WHERE singleton"
          )
        ).rows[0]
      : ((
          await db.query(
            "SELECT to_jsonb(p) AS value FROM yunipals_market.sale_replay_config p WHERE chain_id=$1",
            [chainId]
          )
        ).rows[0]?.value ?? null);
  return { common, checkpoint, policy, legacy };
}

/** Default is read-only review. Explicit application binds public configuration
 * and the exact operational cursor. It never changes provider/signer settings. */
export async function selectSharedMarketplaceConsumer(
  pool: Pool,
  reader: IndexerReader,
  selection: MarketplaceConsumerSelection,
  applyReview?: string,
  options: { replay?: boolean } = {}
) {
  const next = registration(reader, selection);
  const status = await reader.status(next.sourceId, next.confirmationPolicy);
  if (
    !["ready", "catching_up"].includes(status.readiness.reason) ||
    !status.anchor
  )
    throw new Error("Candidate marketplace source is unavailable.");
  const state = await marketplaceConsumerState(
    pool,
    next.consumer,
    next.chainId
  );
  if (selection.kind === "collection-sales") {
    const configured = "policy" in state ? state.policy : null;
    if (
      !configured ||
      String(configured.start_block) !== selection.config.startBlock ||
      configured.confirmations !== selection.config.confirmations ||
      configured.policy !== selection.config.policy
    )
      throw new Error(
        "Sale selection differs from its owner-configured history and policy."
      );
  }
  const impact = await selectionImpact(
    pool,
    reader,
    next,
    state,
    options.replay === true
  );
  const reviewHash = manifestDigest({ version: 2, next, state, impact });
  const review = {
    consumer: next.consumer,
    releaseId: next.releaseId,
    sourceId: next.sourceId,
    configurationHash: next.configurationHash,
    confirmationPolicy: next.confirmationPolicy,
    impact,
    applyAllowed: impact.mode !== "replay" || options.replay === true,
    reviewHash
  };
  if (applyReview === undefined) return { ...review, applied: false };
  if (applyReview !== reviewHash)
    throw new Error(
      "Marketplace selection changed; review the new configuration and cursor."
    );
  // A review of a failed continuity proof is not approval to discard live
  // progress. Explicit replay has a different, separately reviewed hash.
  if (!review.applyAllowed) throw new MarketplaceReplayRequired();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='3s'");
    await db.query(
      next.consumer === "bnb-discovery"
        ? "SELECT pg_advisory_xact_lock(561609,1)"
        : "SELECT pg_advisory_xact_lock(561610,$1)",
      next.consumer === "bnb-discovery" ? [] : [next.chainId]
    );
    const owner = await db.query<{
      permitted: boolean;
    }>(`SELECT pg_has_role(current_user,c.relowner,'USAGE') AS permitted
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='yunipals_market' AND c.relname='shared_indexer_consumer'`);
    if (owner.rows[0]?.permitted !== true)
      throw new Error("Marketplace selection requires the migration owner.");
    if (next.consumer === "bnb-discovery")
      await db.query(
        "SELECT singleton FROM yunipals_market.bnb_discovery_cursor FOR UPDATE"
      );
    else
      await db.query(
        "SELECT chain_id FROM yunipals_market.checkpoint WHERE source='chain' AND chain_id=$1 AND name=$2 FOR UPDATE",
        [
          next.chainId,
          next.consumer === "bnb-sales" ? "bnb-sales" : "seaport-sales"
        ]
      );
    await db.query(
      "SELECT consumer FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1 FOR UPDATE",
      [next.consumer]
    );
    if (
      manifestDigest(
        await marketplaceConsumerState(db, next.consumer, next.chainId)
      ) !== manifestDigest(state)
    )
      throw new Error(
        "Marketplace cursor changed during selection; stop the old worker and review again."
      );
    const fresh = await reader.status(next.sourceId, next.confirmationPolicy);
    if (
      !["ready", "catching_up"].includes(fresh.readiness.reason) ||
      !fresh.anchor
    )
      throw new Error("Candidate marketplace source changed during selection.");
    // Recheck the proof after fencing the operational worker. A stale review
    // can never silently become a destructive replay (or preserve new data).
    const freshImpact = await selectionImpact(
      db,
      reader,
      next,
      state,
      options.replay === true
    );
    if (manifestDigest(freshImpact) !== manifestDigest(impact))
      throw new Error("Marketplace continuity changed; review again.");
    if (impact.mode === "unchanged") {
      await db.query("COMMIT");
      return { ...review, applied: true };
    }
    await db.query(
      `INSERT INTO yunipals_market.marketplace_source_review(review_hash,consumer,target_mode,previous_state,target_configuration)
       VALUES($1,$2,'unified',$3,$4)`,
      [
        reviewHash,
        next.consumer,
        JSON.stringify(state),
        JSON.stringify({ ...next, impact })
      ]
    );
    if (impact.mode === "preserve") {
      // The identity trigger deliberately requires replacement registration.
      // Keep the proven rows in transaction-local tables while replacing it;
      // foreign keys and runtime-role fences remain enabled throughout.
      await db.query(
        `CREATE TEMP TABLE marketplace_handover_consumer ON COMMIT DROP AS
        SELECT * FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1`,
        [next.consumer]
      );
      await db.query(
        `CREATE TEMP TABLE marketplace_handover_qualifications ON COMMIT DROP AS
        SELECT * FROM yunipals_market.sale_receipt_qualification WHERE consumer=$1`,
        [next.consumer]
      );
    }
    await db.query(
      "DELETE FROM yunipals_market.legacy_sale_receipt_qualification WHERE consumer=$1",
      [next.consumer]
    );
    await db.query(
      "DELETE FROM yunipals_market.marketplace_legacy_selection WHERE consumer=$1",
      [next.consumer]
    );
    await db.query(
      "DELETE FROM yunipals_market.sale_receipt_qualification WHERE consumer=$1",
      [next.consumer]
    );
    await db.query(
      "DELETE FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1",
      [next.consumer]
    );
    if (impact.mode === "preserve") {
      await db.query(
        `INSERT INTO yunipals_market.shared_indexer_consumer
         (consumer,chain_id,release_id,source_id,confirmation_policy,configuration_hash,cursor,generation,created_at)
         SELECT consumer,chain_id,$2,source_id,confirmation_policy,configuration_hash,$3::jsonb,generation+1,created_at
         FROM pg_temp.marketplace_handover_consumer WHERE consumer=$1`,
        [next.consumer, next.releaseId, JSON.stringify(impact.cursor)]
      );
      await db.query(
        `INSERT INTO yunipals_market.sale_receipt_qualification
         (chain_id,block_hash,transaction_hash,policy,consumer,release_id,source_id,event_id,proof_hash,source_payload_hash)
         SELECT chain_id,block_hash,transaction_hash,policy,consumer,$2,source_id,event_id,proof_hash,source_payload_hash
         FROM pg_temp.marketplace_handover_qualifications WHERE consumer=$1`,
        [next.consumer, next.releaseId]
      );
      await db.query("COMMIT");
      return { ...review, applied: true };
    }
    // A changed or unverifiable source still follows the full replay path.
    await db.query(
      `INSERT INTO yunipals_market.shared_indexer_consumer
      (consumer,chain_id,release_id,source_id,confirmation_policy,configuration_hash)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [
        next.consumer,
        next.chainId,
        next.releaseId,
        next.sourceId,
        JSON.stringify(next.confirmationPolicy),
        next.configurationHash
      ]
    );
    if (selection.kind === "bnb-discovery") {
      await db.query("DELETE FROM yunipals_market.bnb_discovered_order");
      const fingerprint = sharedBnbDiscoveryConfiguration(
        reader,
        selection.policy,
        selection.launchBlock
      ).policyFingerprint;
      await db.query(
        `INSERT INTO yunipals_market.bnb_discovery_cursor(singleton,launch_block,next_block,policy_fingerprint,reader_mode,last_error_code)
        VALUES(true,$1,$1,$2,'unified','shared_consumer_changed') ON CONFLICT(singleton) DO UPDATE SET
          launch_block=$1,next_block=$1,target_block=NULL,scanned_block_hash=NULL,policy_fingerprint=$2,
          reader_mode='unified',last_error_code='shared_consumer_changed',updated_at=clock_timestamp()`,
        [selection.launchBlock.toString(), fingerprint]
      );
    } else {
      const changed = await db.query(
        `UPDATE yunipals_market.checkpoint SET reader_mode='unified',
        generation=generation+1,canonical_generation=canonical_generation+1,
        state='unavailable',last_error_code='shared_consumer_changed',checked_at=clock_timestamp()
        WHERE source='chain' AND chain_id=$1 AND name=$2`,
        [
          next.chainId,
          selection.kind === "bnb-sales" ? "bnb-sales" : "seaport-sales"
        ]
      );
      if (changed.rowCount !== 1)
        throw new Error("Missing operational marketplace checkpoint.");
      await db.query(
        "UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp() WHERE kind='activity' AND invalidated_at IS NULL"
      );
    }
    await db.query("COMMIT");
    return { ...review, applied: true };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
