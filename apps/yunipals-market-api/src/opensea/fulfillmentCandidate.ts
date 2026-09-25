import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import { getAddress, type Hex } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  decodeSeaportOrder,
  type SeaportOrderJson
} from "@protopals/yunipals-market-core/seaportWire";
import {
  parseOpenSeaDiscoveredOrder,
  summarizeDiscoveredOpenSeaOrder
} from "@/opensea/discoveryOrder";
import { readRetainedOpenSeaCandidate } from "@/opensea/outbox";
import { OpenSeaOrderError } from "@/opensea/orders";

export type OpenSeaFulfillmentCandidate = {
  origin: "retained" | "discovered";
  summary: MarketOrder;
  wire: SeaportOrderJson;
  policyVersion: string | null;
  mintHash: Hex | null;
  providerSeenAt: number | null;
  providerVersion: string | null;
  provenance: unknown;
};

export async function loadOpenSeaFulfillmentCandidate(
  pool: Pool,
  chain: OpenSeaChain,
  hash: Hex
): Promise<OpenSeaFulfillmentCandidate> {
  const retained = await readRetainedOpenSeaCandidate(
    pool,
    marketplaceChains[chain].chainId,
    hash
  );
  if (retained) {
    if (retained.state !== "accepted")
      throw new OpenSeaOrderError("order_not_accepted");
    return {
      origin: "retained",
      summary: retained.publication.summary,
      wire: retained.publication.order,
      policyVersion: retained.policyVersion,
      mintHash: null,
      providerSeenAt: null,
      providerVersion: null,
      provenance: {
        publication: retained.publication,
        state: retained.state,
        policyVersion: retained.policyVersion
      }
    };
  }
  const row = (
    await pool.query<{
      components: SeaportOrderJson;
      signature: Hex | null;
      provider_observation: unknown;
      side: "listing" | "offer";
      classification: string;
      token_id: string | null;
      contract_address: string;
      maker: string;
      provider_status: string;
      present: boolean;
      last_seen_at: Date;
      provider_version: string;
      bound_lifecycle: number | null;
      bound_mint_hash: Hex | null;
    }>(
      `SELECT d.*,d.token_id::text,d.last_changed_at::text AS provider_version,s.bound_lifecycle,s.bound_mint_hash
    FROM yunipals_market.opensea_discovered_order d LEFT JOIN yunipals_market.opensea_discovered_state s USING(chain_id,protocol_address,order_hash)
    WHERE d.chain_id=$1 AND d.protocol_address=$2 AND d.order_hash=$3`,
      [
        marketplaceChains[chain].chainId,
        seaportDeployment.address.toLowerCase(),
        hash.toLowerCase()
      ]
    )
  ).rows[0];
  if (!row) throw new OpenSeaOrderError("order_not_found", 404);
  if (row.classification !== "item")
    throw new OpenSeaOrderError("unsupported_discovered_order");
  const parsed = parseOpenSeaDiscoveredOrder(
    row.provider_observation,
    chain,
    row.side
  );
  if (
    parsed.classification !== "item" ||
    parsed.orderHash !== hash.toLowerCase() ||
    parsed.protocolAddress !== seaportDeployment.address.toLowerCase() ||
    parsed.contractAddress !== row.contract_address ||
    parsed.tokenId !== row.token_id ||
    parsed.maker !== row.maker ||
    parsed.providerStatus !== row.provider_status ||
    !isDeepStrictEqual(parsed.components, row.components)
  )
    throw new OpenSeaOrderError("discovery_identity_conflict", 503);
  if (
    !row.present ||
    row.provider_status !== "ACTIVE" ||
    parsed.remainingQuantity !== 1
  )
    throw new OpenSeaOrderError("provider_order_unavailable", 503);
  if (row.bound_lifecycle === null || !row.bound_mint_hash)
    throw new OpenSeaOrderError("discovery_not_reconciled", 503);
  return {
    origin: "discovered",
    wire: parsed.components,
    summary: summarizeDiscoveredOpenSeaOrder(
      decodeSeaportOrder(parsed.components),
      chain,
      row.side,
      getAddress(parsed.protocolAddress),
      row.bound_lifecycle
    ),
    policyVersion: null,
    mintHash: row.bound_mint_hash,
    providerSeenAt: row.last_seen_at.getTime(),
    providerVersion: row.provider_version,
    // Scan bookkeeping renews freshness without changing the validated order.
    // last_changed_at/provider_version still fence every substantive transition.
    provenance: {
      ...row,
      last_seen_at: undefined,
      last_seen_run_id: undefined,
      missing_since: undefined
    }
  };
}
