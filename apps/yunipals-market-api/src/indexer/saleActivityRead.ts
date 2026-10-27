import type { PoolClient } from "pg";
import {
  marketplaceChains,
  type MarketplaceChain
} from "@protopals/yunipals-market-core/registry";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import {
  createIndexerReader,
  type IndexerReader,
  type CanonicalPageOptions
} from "@protopals/yunipals-indexer-server/readers";

import { sharedCollectionSaleConfiguration } from "@/activity/sharedCollectionReplay";
import {
  sharedBnbSaleConfiguration,
  sharedBnbSaleRuntimeConfiguration
} from "@/activity/sharedBnbReplay";
import { marketplaceOwnershipIndexer } from "./ownership";

/** Prove the sale cursor itself against the current release/branch. Current
 * token ownership cannot establish canonicality of an older sale receipt. */
export async function readSaleActivityBinding(
  db: Pick<PoolClient, "query">,
  chain: MarketplaceChain,
  sourceReader?: IndexerReader
) {
  const chainId = marketplaceChains[chain].chainId;
  const row = (
    await db.query<{
      reader_mode: string;
      block_number: string | null;
      block_hash: string | null;
      start_block: string | null;
      confirmations: number | null;
      policy: string | null;
      environment: string;
      consumer: string | null;
      chain_id: number;
      release_id: string | null;
      source_id: string | null;
      configuration_hash: string | null;
      confirmation_policy: Parameters<IndexerReader["status"]>[1] | null;
      cursor: CanonicalPageOptions["cursor"] | null;
      legacy_epoch: string | null;
      legacy_policy: string | null;
      legacy_configuration_hash: string | null;
      legacy_configuration: {
        policy: string;
        chainId: number;
        deployment?: string;
        startBlock?: string;
        confirmations?: number;
      } | null;
    }>(
      `SELECT c.reader_mode,c.block_number::text,c.block_hash,c.chain_id,p.start_block::text,p.confirmations,p.policy,
    d.environment,i.consumer,i.release_id,i.source_id,i.configuration_hash,i.confirmation_policy,i.cursor,
    l.epoch AS legacy_epoch,l.policy AS legacy_policy,l.configuration_hash AS legacy_configuration_hash,
    l.configuration AS legacy_configuration
    FROM yunipals_market.checkpoint c CROSS JOIN yunipals_market.deployment d
    LEFT JOIN yunipals_market.sale_replay_config p ON p.chain_id=c.chain_id
    LEFT JOIN yunipals_market.shared_indexer_consumer i ON i.consumer=$2
    LEFT JOIN yunipals_market.marketplace_legacy_selection l ON l.consumer=$2 AND l.chain_id=c.chain_id
    WHERE c.source='chain' AND c.chain_id=$1 AND c.name=$3`,
      [
        chainId,
        chain === "bnb" ? "bnb-sales" : `collection-sales:${chain}`,
        chain === "bnb" ? "bnb-sales" : "seaport-sales"
      ]
    )
  ).rows[0];
  if (!row || row.reader_mode !== "unified") {
    if (!row?.legacy_epoch) return true;
    const config = row.legacy_configuration;
    if (
      !config ||
      manifestDigest(config) !== row.legacy_configuration_hash ||
      config.chainId !== chainId ||
      config.policy !== row.legacy_policy
    )
      return false;
    if (chain === "bnb")
      return (
        config.deployment === row.environment &&
        config.policy ===
          sharedBnbSaleRuntimeConfiguration(
            row.environment === "production" ? "production" : "staging"
          ).policy
      );
    return (
      config.policy === row.policy &&
      config.startBlock === row.start_block &&
      config.confirmations === row.confirmations &&
      row.confirmations !== null &&
      row.confirmations > 0
    );
  }
  try {
    const configured = marketplaceOwnershipIndexer();
    const reader =
      sourceReader ??
      (configured
        ? await createIndexerReader(configured.pool, {
            releaseId: configured.releaseId
          })
        : undefined);
    if (
      !reader ||
      row.release_id !== reader.release.id ||
      !row.confirmation_policy ||
      !row.cursor ||
      row.block_number === null ||
      !row.block_hash
    )
      return false;
    const bnbConfig = sharedBnbSaleRuntimeConfiguration(
      row.environment === "production" ? "production" : "staging"
    );
    const expectedPolicy =
      chain === "bnb"
        ? bnbConfig.confirmationPolicy
        : chain === "base"
          ? { kind: "latest" as const }
          : row.environment === "production"
            ? { kind: "finalized" as const }
            : {
                kind: "depth" as const,
                subsequentBlocks: row.confirmations!
              };
    if (
      manifestDigest(expectedPolicy) !== manifestDigest(row.confirmation_policy)
    )
      return false;
    const registration =
      chain === "bnb"
        ? sharedBnbSaleConfiguration(reader, bnbConfig)
        : sharedCollectionSaleConfiguration(reader, {
            chain,
            startBlock: row.start_block!,
            confirmations: row.confirmations!,
            policy: row.policy!,
            confirmationPolicy: expectedPolicy
          });
    if (
      row.consumer !== registration.consumer ||
      row.chain_id !== registration.definition.chainId ||
      row.source_id !== registration.definition.sourceId ||
      row.configuration_hash !== registration.configurationHash ||
      row.cursor.completed?.number !== row.block_number ||
      row.cursor.completed.hash !== row.block_hash
    )
      return false;
    await reader.page(row.source_id, expectedPolicy, {
      cursor: row.cursor,
      limit: 1,
      includeReceipts: false
    });
    const fresh = await reader.status(row.source_id, expectedPolicy);
    return (
      ["ready", "catching_up"].includes(fresh.readiness.reason) &&
      !!fresh.anchor &&
      BigInt(row.block_number) <= BigInt(fresh.anchor.number)
    );
  } catch {
    return false;
  }
}
