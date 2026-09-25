import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import type { Hex } from "viem";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { parseMarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import { bindOpenSeaOrder } from "@protopals/yunipals-market-core/openseaOrder";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@protopals/yunipals-market-core/seaportWire";
import { address, record } from "@protopals/yunipals-market-core/validation";

import { OpenSeaOrderError, type OpenSeaPublication } from "@/opensea/orders";
import { parseOpenSeaDiscoveredOrder } from "@/opensea/discoveryOrder";
import { readRetainedOpenSeaCandidate } from "@/opensea/outbox";

const protocol = seaportDeployment.address.toLowerCase();

export function retainedOpenSeaResponse(
  stored: NonNullable<Awaited<ReturnType<typeof readRetainedOpenSeaCandidate>>>
) {
  return {
    schemaVersion: 1 as const,
    persisted: true as const,
    providerAccepted: stored.state === "accepted",
    publicationState: stored.state,
    // Provider acceptance alone never makes an order eligible for checkout.
    order: { ...stored.publication.summary, status: "unavailable" as const }
  };
}

/** Retained signatures remain recoverable without admission, provider or RPC configuration. */
export class OpenSeaRecoveryService {
  constructor(private readonly pool: Pool) {}

  async accepted(chain: OpenSeaChain, hash: Hex) {
    const stored = await readRetainedOpenSeaCandidate(
      this.pool,
      marketplaceChains[chain].chainId,
      hash
    );
    if (!stored) throw new OpenSeaOrderError("order_not_found", 404);
    return retainedOpenSeaResponse(stored);
  }

  async cancellation(chain: OpenSeaChain, hash: Hex, value: unknown) {
    let actor;
    try {
      const data = record(value);
      if (Object.keys(data).length !== 1 || !Object.hasOwn(data, "actor"))
        throw new Error();
      actor = address(data.actor);
    } catch {
      throw new OpenSeaOrderError("invalid_cancellation_request", 400);
    }
    const row = (
      await this.pool.query<{
        components: OpenSeaPublication["order"];
        signature: Hex;
        summary: OpenSeaPublication["summary"];
      }>(
        `SELECT components,signature,summary FROM yunipals_market.orders WHERE chain_id=$1
      AND protocol_address=$2 AND order_hash=$3 AND source='opensea'`,
        [marketplaceChains[chain].chainId, protocol, hash.toLowerCase()]
      )
    ).rows[0];
    if (!row) {
      const discovered = (
        await this.pool.query<{
          components: unknown;
          provider_observation: unknown;
          side: "listing" | "offer";
          maker: string;
        }>(
          `SELECT components,provider_observation,side,maker FROM yunipals_market.opensea_discovered_order
        WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
          [marketplaceChains[chain].chainId, protocol, hash.toLowerCase()]
        )
      ).rows[0];
      if (!discovered) throw new OpenSeaOrderError("order_not_found", 404);
      let parsed;
      try {
        parsed = parseOpenSeaDiscoveredOrder(
          discovered.provider_observation,
          chain,
          discovered.side
        );
        if (
          parsed.orderHash !== hash.toLowerCase() ||
          parsed.protocolAddress !== protocol ||
          parsed.maker !== discovered.maker ||
          !isDeepStrictEqual(parsed.components, discovered.components)
        )
          throw new Error();
      } catch {
        throw new OpenSeaOrderError("stored_order_mismatch", 503);
      }
      if (parsed.maker !== actor.toLowerCase())
        throw new OpenSeaOrderError("cancellation_maker_mismatch", 400);
      return {
        schemaVersion: 1 as const,
        chainId: marketplaceChains[chain].chainId,
        protocolAddress: seaportDeployment.address,
        orderHash: hash,
        order: parsed.components
      };
    }
    // Cancellation does not depend on provider acknowledgment, live policy,
    // current ownership, visibility or a reachable RPC. Actor is a public scope
    // check; only the maker's onchain transaction can revoke the signature.
    const components = decodeSeaportOrder(row.components);
    const summary = parseMarketOrder(row.summary);
    bindOpenSeaOrder(components, summary);
    const snapshot = { order: encodeSeaportOrder(components), summary };
    if (
      snapshot.summary.asset.chain !== chain ||
      snapshot.summary.orderHash.toLowerCase() !== hash.toLowerCase()
    )
      throw new OpenSeaOrderError("stored_order_mismatch", 503);
    if (snapshot.summary.maker !== actor)
      throw new OpenSeaOrderError("cancellation_maker_mismatch", 400);
    return {
      schemaVersion: 1 as const,
      chainId: marketplaceChains[chain].chainId,
      protocolAddress: seaportDeployment.address,
      orderHash: hash,
      order: snapshot.order
    };
  }
}
