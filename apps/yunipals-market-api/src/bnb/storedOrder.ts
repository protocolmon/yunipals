import type { Pool } from "pg";
import type { Hex } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { hex } from "@protopals/yunipals-market-core/validation";

import { BnbOrderError, parseBnbOrderRequest } from "@/bnb/orders";
import { bnbOrderIdentity } from "@/bnb/recovery";

export async function loadAcceptedBnbOrder(pool: Pool, hash: Hex) {
  bnbOrderIdentity("bnb", seaportDeployment.address, hash);
  const result = await pool.query<{
    contract_address: string;
    token_id: string;
    lifecycle: number;
    components: unknown;
    signature: string;
    policy_version: string;
    reconcile_generation: string;
    reconcile_failures: number;
  }>(
    `SELECT contract_address,token_id::text,lifecycle,components,signature,policy_version,reconcile_generation::text,reconcile_failures
    FROM yunipals_market.orders WHERE chain_id=56 AND protocol_address=$1 AND order_hash=$2
    AND publication_state='accepted' AND source='yunipals'`,
    [seaportDeployment.address.toLowerCase(), hash.toLowerCase()]
  );
  const row = result.rows[0];
  if (!row) throw new BnbOrderError("order_not_found", 404);
  try {
    const input = parseBnbOrderRequest({
      asset: {
        chain: "bnb",
        chainId: 56,
        contractAddress: row.contract_address,
        tokenId: row.token_id
      },
      lifecycle: row.lifecycle,
      order: row.components
    });
    if (input.hash.toLowerCase() !== hash.toLowerCase()) throw new Error();
    return {
      ...input,
      signature: hex(row.signature),
      policyVersion: row.policy_version,
      reconcileGeneration: BigInt(row.reconcile_generation),
      reconcileFailures: row.reconcile_failures
    };
  } catch {
    throw new BnbOrderError("stored_order_mismatch", 503);
  }
}

/** Live mode executes only orders reconstructed from Seaport validation logs. */
export async function loadBnbTradeOrder(pool: Pool, hash: Hex) {
  bnbOrderIdentity("bnb", seaportDeployment.address, hash);
  const mode = await pool.query<{ mode: "preview" | "live" }>(
    "SELECT mode FROM yunipals_market.bnb_discovery_cursor WHERE singleton"
  );
  if (mode.rows[0]?.mode !== "live")
    return loadAcceptedBnbOrder(pool, hash);
  const result = await pool.query<{
    contract_address: string;
    token_id: string;
    bound_lifecycle: number;
    published_components: unknown;
  }>(
    `SELECT contract_address,token_id::text,bound_lifecycle,published_components
     FROM yunipals_market.bnb_discovered_order
     WHERE protocol_address=$1 AND order_hash=$2
       AND bound_lifecycle IS NOT NULL AND published_components IS NOT NULL`,
    [seaportDeployment.address.toLowerCase(), hash.toLowerCase()]
  );
  const row = result.rows[0];
  if (!row) throw new BnbOrderError("order_not_found", 404);
  try {
    const input = parseBnbOrderRequest({
      asset: {
        chain: "bnb",
        chainId: 56,
        contractAddress: row.contract_address,
        tokenId: row.token_id
      },
      lifecycle: row.bound_lifecycle,
      order: row.published_components
    });
    if (input.hash.toLowerCase() !== hash.toLowerCase()) throw new Error();
    return {
      ...input,
      signature: "0x" as Hex,
      policyVersion: "validated",
      reconcileGeneration: 0n,
      reconcileFailures: 0
    };
  } catch {
    throw new BnbOrderError("stored_order_mismatch", 503);
  }
}
