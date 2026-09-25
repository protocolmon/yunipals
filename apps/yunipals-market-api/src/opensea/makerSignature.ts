import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import type { Address, Hex } from "viem";
import { transaction } from "@/db/pool";
import type { OpenSeaObservation } from "@/opensea/chain";
import type { OpenSeaFulfillmentCandidate } from "@/opensea/fulfillmentCandidate";
import { OpenSeaOrderError } from "@/opensea/orders";

/** Retain maker bytes after verified fulfillment inspection, never zone authorization.
 * The historical validation does not grant current eligibility: reconciliation
 * must verify the signature, protocol, lifecycle, provider and policy again.
 */
export async function retainOpenSeaMakerSignature(
  pool: Pool,
  candidate: OpenSeaFulfillmentCandidate,
  actor: Address,
  signature: Hex,
  observed: OpenSeaObservation
) {
  if (candidate.origin !== "discovered" || signature === "0x") return;
  const { summary } = candidate;
  if (
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) ||
    signature.length > 32770 ||
    actor.toLowerCase() === summary.maker.toLowerCase() ||
    observed.chainId !== summary.asset.chainId ||
    !candidate.providerVersion ||
    !candidate.mintHash
  )
    throw new OpenSeaOrderError("invalid_maker_signature", 409);
  const identity = [
    summary.asset.chainId,
    summary.protocolAddress.toLowerCase(),
    summary.orderHash.toLowerCase()
  ];
  await transaction(pool, async (db) => {
    // Serialize lifecycle binding with reconciliation. Provider observations stay
    // read-only: this proof records the source version we actually validated;
    // it never advances the projection's provider version or grants eligibility.
    const state = (
      await db.query<{ bound_lifecycle: number; bound_mint_hash: string }>(
        `SELECT bound_lifecycle,bound_mint_hash FROM yunipals_market.opensea_discovered_state
       WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3 FOR UPDATE`,
        identity
      )
    ).rows[0];
    const source = (
      await db.query<{
        components: unknown;
        provider_version: string;
        present: boolean;
        provider_status: string;
      }>(
        `SELECT components,last_changed_at::text AS provider_version,present,provider_status
       FROM yunipals_market.opensea_discovered_order
       WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
        identity
      )
    ).rows[0];
    const retained = await db.query(
      "SELECT 1 FROM yunipals_market.orders WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3",
      identity
    );
    if (
      !source?.present ||
      source.provider_status !== "ACTIVE" ||
      source.provider_version !== candidate.providerVersion ||
      !isDeepStrictEqual(source.components, candidate.wire) ||
      state?.bound_lifecycle !== summary.lifecycle ||
      state.bound_mint_hash !== candidate.mintHash ||
      retained.rowCount !== 0
    )
      throw new OpenSeaOrderError("order_changed_during_fulfillment", 503);
    await db.query(
      `INSERT INTO yunipals_market.opensea_maker_signature
       (chain_id,protocol_address,order_hash,signature,validation_actor,block_number,block_hash,validated_at,provider_seen_at,lifecycle,mint_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(chain_id,protocol_address,order_hash) DO UPDATE SET
         signature=EXCLUDED.signature,validation_actor=EXCLUDED.validation_actor,
         block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,
         validated_at=EXCLUDED.validated_at,provider_seen_at=EXCLUDED.provider_seen_at,
         lifecycle=EXCLUDED.lifecycle,mint_hash=EXCLUDED.mint_hash
       WHERE yunipals_market.opensea_maker_signature.validated_at<=EXCLUDED.validated_at`,
      [
        ...identity,
        signature,
        actor.toLowerCase(),
        String(observed.number),
        observed.hash.toLowerCase(),
        new Date(observed.checkedAt),
        candidate.providerVersion,
        summary.lifecycle,
        candidate.mintHash
      ]
    );
    await db.query(
      `UPDATE yunipals_market.opensea_discovered_state SET next_reconcile_at=least(next_reconcile_at,clock_timestamp())
       WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
      identity
    );
  });
}
