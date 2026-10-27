import type { Pool } from "pg";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";

import type { BnbPolicy } from "@/bnb/orders";
import { bnbDiscoveryPolicyFingerprint } from "@/bnb/discovery";
import { sharedBnbSaleRuntimeConfiguration } from "@/activity/sharedBnbReplay";
import { wakeReorgedSaleOrders } from "@/activity/collectionSaleProjection";
import { marketplaceConsumerState } from "./consumerSelection";

export type LegacyMarketplaceSelection =
  | {
      kind: "collection-sales";
      chain: OpenSeaChain;
      startBlock: string;
      confirmations: number;
      policy: string;
      finality: "confirmations" | "finalized";
    }
  | { kind: "bnb-sales"; deployment: "staging" | "production" }
  | { kind: "bnb-discovery"; policy: BnbPolicy; launchBlock: bigint };

function configuration(selection: LegacyMarketplaceSelection) {
  if (selection.kind === "bnb-discovery") {
    if (selection.launchBlock < 1n || selection.launchBlock >= 2n ** 63n)
      throw new Error("Invalid legacy discovery history.");
    return {
      consumer: "bnb-discovery",
      chainId: 56,
      policy: bnbDiscoveryPolicyFingerprint(selection.policy),
      launchBlock: selection.launchBlock.toString(),
      decoder: "compatible-legacy-discovery-v1"
    };
  }
  if (selection.kind === "bnb-sales") {
    if (!["staging", "production"].includes(selection.deployment))
      throw new Error("Invalid legacy BNB deployment.");
    const config = sharedBnbSaleRuntimeConfiguration(selection.deployment);
    return {
      consumer: "bnb-sales",
      chainId: 56,
      deployment: selection.deployment,
      policy: config.policy,
      finality:
        selection.deployment === "production" ? "finalized" : "confirmations",
      decoder: "compatible-legacy-bnb-sales-v1"
    };
  }
  if (
    !["ethereum", "base", "polygon"].includes(selection.chain) ||
    !/^(0|[1-9][0-9]*)$/.test(selection.startBlock) ||
    BigInt(selection.startBlock) >= 2n ** 63n ||
    !Number.isSafeInteger(selection.confirmations) ||
    selection.confirmations < 1 ||
    selection.confirmations > 100000 ||
    !/^[a-z][a-z0-9_-]{0,127}$/.test(selection.policy) ||
    !["confirmations", "finalized"].includes(selection.finality)
  ) {
    throw new Error(
      "Legacy sale rollback requires explicit positive depth, history and truthful policy."
    );
  }
  return {
    ...selection,
    consumer: `collection-sales:${selection.chain}`,
    chainId: marketplaceChains[selection.chain].chainId,
    decoder: "compatible-legacy-collection-sales-v1"
  };
}

/** Reviewed fallback to the compatible scanner. Clears only derived canonical
 * coverage; preserves orders, immutable receipts, native provenance and audit. */
export async function selectLegacyMarketplaceConsumer(
  pool: Pool,
  selection: LegacyMarketplaceSelection,
  applyReview?: string
) {
  const next = configuration(selection);
  const state = await marketplaceConsumerState(
    pool,
    next.consumer,
    next.chainId
  );
  const cursor = "cursor" in state ? state.cursor : state.checkpoint;
  if (!state.common || !cursor || cursor.reader_mode !== "unified") {
    throw new Error(
      "Legacy rollback requires a currently selected shared consumer."
    );
  }
  if (
    selection.kind === "bnb-discovery" &&
    String(cursor.launch_block) !== selection.launchBlock.toString()
  ) {
    throw new Error("Rollback must retain the discovery launch block.");
  }
  if (selection.kind === "collection-sales") {
    const current = "policy" in state ? state.policy : null;
    if (!current || String(current.start_block) !== selection.startBlock)
      throw new Error(
        "Rollback must retain the indexed history coverage start."
      );
    const targetKind =
      selection.finality === "finalized" ? "finalized" : "depth";
    if (
      (current.confirmations !== selection.confirmations ||
        state.common.confirmation_policy?.kind !== targetKind) &&
      current.policy === selection.policy
    ) {
      throw new Error(
        "Changed legacy confirmation semantics require a distinct truthful policy label."
      );
    }
  }
  if (
    selection.kind === "bnb-sales" &&
    ("policy" in state ? state.policy?.environment : null) !==
      selection.deployment
  ) {
    throw new Error(
      "Legacy rollback deployment differs from the operational database."
    );
  }
  const configurationHash = manifestDigest(next);
  const reviewHash = manifestDigest({
    version: 1,
    targetMode: "legacy",
    next,
    state
  });
  const review = {
    consumer: next.consumer,
    targetMode: "legacy",
    configuration: next,
    configurationHash,
    reviewHash
  };
  if (applyReview === undefined) return { ...review, applied: false };
  if (applyReview !== reviewHash)
    throw new Error(
      "Marketplace rollback changed; review its current cursor and configuration."
    );
  const db = await pool.connect();
  try {
    await db.query("BEGIN; SET LOCAL lock_timeout='3s'");
    await db.query(
      next.consumer === "bnb-discovery"
        ? "SELECT pg_advisory_xact_lock(561609,1)"
        : "SELECT pg_advisory_xact_lock(561610,$1)",
      next.consumer === "bnb-discovery" ? [] : [next.chainId]
    );
    const owner = (
      await db.query(`SELECT pg_has_role(current_user,c.relowner,'USAGE') AS permitted
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='yunipals_market' AND c.relname='marketplace_legacy_selection'`)
    ).rows[0];
    if (owner?.permitted !== true)
      throw new Error("Marketplace rollback requires the migration owner.");
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
    ) {
      throw new Error(
        "Marketplace cursor changed during rollback; stop its worker and review again."
      );
    }
    await db.query(
      `INSERT INTO yunipals_market.marketplace_source_review
      (review_hash,consumer,target_mode,previous_state,target_configuration) VALUES($1,$2,'legacy',$3,$4)`,
      [reviewHash, next.consumer, JSON.stringify(state), JSON.stringify(next)]
    );
    await db.query(
      `INSERT INTO yunipals_market.marketplace_legacy_selection
      (consumer,epoch,chain_id,policy,configuration_hash,configuration) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        next.consumer,
        reviewHash,
        next.chainId,
        next.policy,
        configurationHash,
        JSON.stringify(next)
      ]
    );
    if (selection.kind === "bnb-discovery") {
      // These are discovered projection rows, not signed/admitted orders.
      await db.query("DELETE FROM yunipals_market.bnb_discovered_order");
      await db.query(
        `UPDATE yunipals_market.bnb_discovery_cursor SET reader_mode='legacy',
        launch_block=$1,next_block=$1,target_block=NULL,scanned_block_hash=NULL,policy_fingerprint=$2,
        last_error_code='legacy_replay_required',updated_at=to_timestamp(0) WHERE singleton`,
        [selection.launchBlock.toString(), next.policy]
      );
    } else {
      if (selection.kind === "collection-sales") {
        await db.query(
          `UPDATE yunipals_market.sale_replay_config SET confirmations=$2,policy=$3 WHERE chain_id=$1`,
          [next.chainId, selection.confirmations, selection.policy]
        );
      }
      await wakeReorgedSaleOrders(db, next.chainId, null);
      for (const table of ["sale", "sale_exclusion"])
        await db.query(
          `UPDATE yunipals_market.${table} SET canonical=false WHERE chain_id=$1 AND canonical`,
          [next.chainId]
        );
      await db.query(
        "DELETE FROM yunipals_market.activity_block WHERE chain_id=$1",
        [next.chainId]
      );
      await db.query(
        `UPDATE yunipals_market.checkpoint SET reader_mode='legacy',block_number=NULL,block_hash=NULL,
        coverage_start=NULL,coverage_start_time=NULL,replay_from=NULL,state='unavailable',
        last_error_code='legacy_replay_required',generation=generation+1,canonical_generation=canonical_generation+1,
        checked_at=clock_timestamp(),progress_at=clock_timestamp()
        WHERE source='chain' AND chain_id=$1 AND name=$2`,
        [
          next.chainId,
          next.consumer === "bnb-sales" ? "bnb-sales" : "seaport-sales"
        ]
      );
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
