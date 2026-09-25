import type { Pool, PoolClient } from "pg";
import { getAddress, type Hex } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@protopals/yunipals-market-core/seaportWire";
import { address, record } from "@protopals/yunipals-market-core/validation";

import {
  BnbOrderError,
  type bnbOrderSummary,
  type OrderStatus
} from "@/bnb/orders";

const protocol = seaportDeployment.address.toLowerCase();

export function bnbOrderIdentity(
  chain: string,
  suppliedProtocol: string,
  hash: string
): Hex {
  if (chain !== "bnb" || suppliedProtocol.toLowerCase() !== protocol)
    throw new BnbOrderError("unsupported_order_identity", 400);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new BnbOrderError("invalid_order_hash", 400);
  return hash.toLowerCase() as Hex;
}

export async function findAcceptedBnbOrder(
  db: Pick<PoolClient, "query">,
  hash: Hex,
  now: number,
  lifecycle?: number
) {
  const result = await db.query<{
    summary: ReturnType<typeof bnbOrderSummary>;
    state: OrderStatus;
    lifecycle: number;
    state_observed_at: Date | null;
  }>(
    `SELECT summary,state,lifecycle,state_observed_at FROM yunipals_market.orders
    WHERE chain_id=56 AND protocol_address=$1 AND order_hash=$2 AND publication_state='accepted' AND source='yunipals'`,
    [protocol, hash.toLowerCase()]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (lifecycle !== undefined && row.lifecycle !== lifecycle)
    throw new BnbOrderError("accepted_lifecycle_mismatch");
  const freshnessMs = ["active", "unavailable"].includes(row.state)
    ? 15000
    : 90000;
  const stale =
    !row.state_observed_at ||
    row.state_observed_at.getTime() > now + 30000 ||
    now - row.state_observed_at.getTime() > freshnessMs;
  return {
    schemaVersion: 1 as const,
    persisted: true as const,
    order: {
      ...row.summary,
      status: stale ? ("unavailable" as const) : row.state
    }
  };
}

export class BnbRecoveryService {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = Date.now
  ) {}

  async accepted(hash: Hex) {
    bnbOrderIdentity("bnb", protocol, hash);
    const live = await this.pool.query<{ mode: string }>(
      "SELECT mode FROM yunipals_market.bnb_discovery_cursor WHERE singleton"
    );
    if (live.rows[0]?.mode === "live") {
      const found = await this.pool.query<{
        summary: ReturnType<typeof bnbOrderSummary>;
        state: OrderStatus;
        state_observed_at: Date | null;
      }>(
        `SELECT summary,state,state_observed_at
         FROM yunipals_market.bnb_discovered_order
         WHERE protocol_address=$1 AND order_hash=$2 AND bound_lifecycle IS NOT NULL`,
        [protocol, hash.toLowerCase()]
      );
      const row = found.rows[0];
      if (!row?.summary) throw new BnbOrderError("order_not_found", 404);
      const fresh =
        row.state_observed_at &&
        row.state_observed_at.getTime() <= this.now() + 30_000 &&
        this.now() - row.state_observed_at.getTime() <= 720_000;
      return {
        schemaVersion: 1 as const,
        persisted: true as const,
        order: {
          ...row.summary,
          status: fresh ? row.state : ("unavailable" as const)
        }
      };
    }
    const result = await findAcceptedBnbOrder(this.pool, hash, this.now());
    if (!result) throw new BnbOrderError("order_not_found", 404);
    return result;
  }

  async cancellation(hash: Hex, value: unknown) {
    bnbOrderIdentity("bnb", protocol, hash);
    let actor;
    try {
      const data = record(value);
      if (Object.keys(data).length !== 1 || !("actor" in data))
        throw new Error();
      actor = address(data.actor);
    } catch {
      throw new BnbOrderError("invalid_cancellation_request", 400);
    }
    const result = await this.pool.query<{
      maker: string;
      components: unknown;
    }>(
      `SELECT maker,published_components AS components
       FROM yunipals_market.bnb_discovered_order
       WHERE protocol_address=$1 AND order_hash=$2 AND published_components IS NOT NULL
         AND EXISTS(SELECT 1 FROM yunipals_market.bnb_discovery_cursor
           WHERE singleton AND mode='live')
       UNION ALL
       SELECT maker,components FROM yunipals_market.orders
       WHERE chain_id=56 AND protocol_address=$1 AND order_hash=$2
         AND publication_state='accepted' AND source='yunipals'
         AND NOT EXISTS(SELECT 1 FROM yunipals_market.bnb_discovery_cursor
           WHERE singleton AND mode='live')`,
      [protocol, hash.toLowerCase()]
    );
    const row = result.rows[0];
    if (!row) throw new BnbOrderError("order_not_found", 404);
    // Actor is a scope check, not authentication. These unsigned parameters are
    // public order evidence; only the maker can cancel through Seaport onchain.
    if (getAddress(row.maker) !== actor)
      throw new BnbOrderError("cancellation_maker_mismatch", 400);
    const order = decodeSeaportOrder(row.components);
    if (
      seaportOrderHash(order).toLowerCase() !== hash.toLowerCase() ||
      getAddress(order.offerer) !== actor
    )
      throw new BnbOrderError("stored_order_mismatch", 503);
    return {
      schemaVersion: 1 as const,
      chainId: 56 as const,
      protocolAddress: seaportDeployment.address,
      orderHash: hash,
      order: encodeSeaportOrder(order)
    };
  }
}
