import type { Pool, PoolClient } from "pg";
import type { IndexerReader } from "@protopals/yunipals-indexer-server/readers";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";

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
  applyReview?: string
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
  const reviewHash = manifestDigest({ version: 1, next, state });
  const review = {
    consumer: next.consumer,
    releaseId: next.releaseId,
    sourceId: next.sourceId,
    configurationHash: next.configurationHash,
    confirmationPolicy: next.confirmationPolicy,
    reviewHash
  };
  if (applyReview === undefined) return { ...review, applied: false };
  if (applyReview !== reviewHash)
    throw new Error(
      "Marketplace selection changed; review the new configuration and cursor."
    );
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
    // Keep existing immutable receipt proofs. Qualifications tied to a replaced
    // source must be earned again by replaying its new canonical evidence.
    await db.query(
      `INSERT INTO yunipals_market.marketplace_source_review(review_hash,consumer,target_mode,previous_state,target_configuration)
       VALUES($1,$2,'unified',$3,$4)`,
      [reviewHash, next.consumer, JSON.stringify(state), JSON.stringify(next)]
    );
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
