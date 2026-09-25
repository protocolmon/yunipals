import type { Pool } from "pg";
import { getAddress } from "viem";

import { BnbOrderError } from "@/bnb/orders";
import { indexedTokenHiddenSql } from "@/reads/visibility";

const table = "yunipals_market.bnb_discovered_order";

export class BnbDiscoveryReadService {
  constructor(private readonly pool: Pool) {}

  async status() {
    const cursor = await this.pool.query<{
      launch_block: string;
      next_block: string;
      target_block: string | null;
      mode: "preview" | "live";
      has_unbound: boolean;
      has_stale_active: boolean;
      updated_at: Date;
      last_error_code: string | null;
    }>(
      `SELECT launch_block::text,next_block::text,target_block::text,
       mode,updated_at,last_error_code,
       EXISTS(SELECT 1 FROM yunipals_market.bnb_discovered_order d
         WHERE d.bound_lifecycle IS NULL AND d.end_time>extract(epoch FROM clock_timestamp())) AS has_unbound,
       EXISTS(SELECT 1 FROM yunipals_market.bnb_discovered_order d
         WHERE d.state IN ('active','unavailable','inconsistent')
           AND d.end_time>extract(epoch FROM clock_timestamp())
           AND (d.state_observed_at IS NULL OR d.state_observed_at<
             clock_timestamp()-interval '720 seconds')) AS has_stale_active
       FROM yunipals_market.bnb_discovery_cursor WHERE singleton`
    );
    const progress = cursor.rows[0];
    const complete =
      !!progress &&
      progress.target_block !== null &&
      BigInt(progress.next_block) > BigInt(progress.target_block) &&
      !progress.has_unbound &&
      !progress.has_stale_active &&
      !progress.last_error_code &&
      Date.now() - progress.updated_at.getTime() <= 720_000;
    return {
      coverage: complete ? ("complete" as const) : ("partial" as const),
      launchBlock: progress?.launch_block ?? null,
      nextBlock: progress?.next_block ?? null,
      targetBlock: progress?.target_block ?? null,
      mode: progress?.mode ?? ("preview" as const),
      updatedAt: progress?.updated_at?.toISOString() ?? null
    };
  }

  async list(params: URLSearchParams) {
    for (const key of params.keys())
      if (
        !["tokenId", "maker", "limit", "cursor"].includes(key) ||
        params.getAll(key).length !== 1
      )
        throw new BnbOrderError("invalid_discovery_query", 400);
    const tokenId = params.get("tokenId");
    const maker = params.get("maker");
    const limit = params.get("limit") ?? "25";
    const pageCursor = params.get("cursor");
    const cursorParts = pageCursor?.split(":") ?? null;
    if (
      (tokenId !== null &&
        (!/^(0|[1-9][0-9]{0,77})$/.test(tokenId) ||
          BigInt(tokenId) >= 2n ** 256n)) ||
      (maker !== null && !/^0x[0-9a-fA-F]{40}$/.test(maker)) ||
      !/^[1-9][0-9]?$/.test(limit) ||
      Number(limit) > 25 ||
      (cursorParts !== null &&
        (cursorParts.length !== 3 ||
          !/^(0|[1-9][0-9]{0,77})$/.test(cursorParts[0] ?? "") ||
          BigInt(cursorParts[0]!) >= 2n ** 256n ||
          !/^(0|[1-9][0-9]{0,9})$/.test(cursorParts[1] ?? "") ||
          BigInt(cursorParts[1]!) > 2_147_483_647n ||
          !/^0x[0-9a-fA-F]{64}$/.test(cursorParts[2] ?? "")))
    )
      throw new BnbOrderError("invalid_discovery_query", 400);
    const normalizedMaker = maker ? getAddress(maker).toLowerCase() : null;
    const [status, orders] = await Promise.all([
      this.status(),
      this.pool.query<{
        order_hash: string;
        token_id: string;
        maker: string;
        side: string;
        currency: string;
        gross_amount: string;
        parameters: unknown;
        components: unknown;
        published_components: unknown;
        published_counter: string | null;
        bound_lifecycle: number | null;
        state: string;
        state_observed_at: Date | null;
        publication_block: string;
        publication_hash: string;
        publication_tx: string;
        publication_log_index: number;
        contract_address: string;
      }>(
        `SELECT d.order_hash,d.token_id::text,d.maker,d.side,d.currency,
         d.gross_amount::text,d.parameters,d.components,d.published_components,
         d.published_counter::text,d.bound_lifecycle,d.state,d.state_observed_at,
         d.publication_block::text,d.publication_hash,d.publication_tx,
         d.publication_log_index,d.contract_address
         FROM ${table} d
         WHERE ($1::numeric IS NULL OR d.token_id=$1::numeric)
           AND ($2::text IS NULL OR d.maker=$2)
           AND d.end_time>extract(epoch FROM clock_timestamp())
           AND ($4::numeric IS NULL OR
             (d.publication_block,d.publication_log_index,d.order_hash) <
             ($4::numeric,$5::integer,$6::text))
         ORDER BY d.publication_block DESC,d.publication_log_index DESC,d.order_hash DESC
         LIMIT $3`,
        [
          tokenId,
          normalizedMaker,
          Number(limit) + 1,
          cursorParts?.[0] ?? null,
          cursorParts?.[1] ?? null,
          cursorParts?.[2]?.toLowerCase() ?? null
        ]
      )
    ]);
    const pageRows = orders.rows.slice(0, Number(limit));
    const tokens = pageRows.length
      ? await this.pool.query<{
          contract_address: string;
          token_id: string;
          lifecycle: number;
          owner: string;
          burned: boolean;
          hidden: boolean;
        }>(
          `SELECT t.contract_address,t.token_id,t.lifecycle,t.owner,t.burned,
           ${indexedTokenHiddenSql} AS hidden
           FROM yunipals_read_v4.token t
           WHERE t.collection='bnb' AND t.chain_id=56
             AND t.token_id=ANY($1::text[])`,
          [[...new Set(pageRows.map((row) => row.token_id))]]
        )
      : null;
    const currentAssets = new Map(
      tokens?.rows.map((row) => [
        `${row.contract_address.toLowerCase()}:${row.token_id}`,
        row
      ]) ?? []
    );
    const last = pageRows.at(-1);
    return {
      schemaVersion: 1,
      chain: "bnb" as const,
      ...status,
      nextCursor:
        orders.rows.length > Number(limit) && last
          ? `${last.publication_block}:${last.publication_log_index}:${last.order_hash}`
          : null,
      orders: pageRows.map((row) => {
        const currentAsset = currentAssets.get(
          `${row.contract_address.toLowerCase()}:${row.token_id}`
        );
        return {
          orderHash: row.order_hash,
          tokenId: row.token_id,
          maker: row.maker,
          side: row.side,
          currency: row.currency,
          grossAmount: row.gross_amount,
          parameters: row.parameters,
          components: row.components,
          publishedComponents: row.published_components,
          publishedCounter: row.published_counter,
          boundLifecycle: row.bound_lifecycle,
          protocolStatus:
            row.state_observed_at &&
            Date.now() - row.state_observed_at.getTime() <= 720_000
              ? row.state
              : "unavailable",
          stateObservedAt: row.state_observed_at?.toISOString() ?? null,
          currentAsset: {
            lifecycle: currentAsset?.lifecycle ?? null,
            owner: currentAsset?.owner ?? null,
            burned: currentAsset?.burned ?? null,
            hidden: currentAsset?.hidden ?? null
          },
          publication: {
            block: row.publication_block,
            hash: row.publication_hash,
            transaction: row.publication_tx,
            logIndex: row.publication_log_index
          }
        };
      })
    };
  }
}
