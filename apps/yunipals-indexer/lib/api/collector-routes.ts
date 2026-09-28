import type { Hono } from "hono";
import type { Pool } from "pg";
import type { CollectionSlug } from "../constants.js";
import type { ResolvedOwner } from "../ens/resolver.js";
import {
  collectorQuery,
  CollectorQueryError,
  parseCollectorRequest,
  type CollectorRow,
} from "./collector-query.js";

export function registerCollectorRoutes(
  app: Hono,
  dependencies: {
    pool: Pick<Pool, "connect">;
    resolveOwner: (
      input: string,
      chains: readonly CollectionSlug[],
    ) => Promise<ResolvedOwner>;
    checkReadiness: (chains: readonly CollectionSlug[]) => Promise<{ ready: boolean }>;
    enabled?: () => boolean;
    nameSearchEnabled?: () => boolean;
    rarityRangeEnabled?: () => boolean;
  },
) {
  const enabled =
    dependencies.enabled ??
    (() => process.env.API_COLLECTOR_FILTERS_ENABLED === "true");
  const nameSearchEnabled =
    dependencies.nameSearchEnabled ??
    (() => process.env.API_COLLECTOR_NAME_SEARCH_ENABLED === "true");
  const rarityRangeEnabled =
    dependencies.rarityRangeEnabled ??
    (() => process.env.API_COLLECTOR_RARITY_RANGE_ENABLED === "true");
  app.get("/v1/collector-capabilities", (c) =>
    c.json({
      version: enabled() ? 1 : 0,
      namePrefixSearch: enabled() && nameSearchEnabled(),
      rarityRange: enabled() && rarityRangeEnabled(),
    }),
  );
  app.get("/v2/owners/:address/tokens", async (c) => {
    if (!enabled())
      return c.json({ error: "collector_filters_unavailable" }, 503);
    try {
      const request = parseCollectorRequest(new URL(c.req.url).searchParams);
      if (
        request.filters.search &&
        !/^\d+$/.test(request.filters.search) &&
        !nameSearchEnabled()
      ) {
        throw new CollectorQueryError(
          "invalid_collector_query",
          "Name search is not available. Search by token ID instead.",
        );
      }
      if (
        (request.filters.rarityMin || request.filters.rarityMax) &&
        !rarityRangeEnabled()
      ) {
        throw new CollectorQueryError(
          "invalid_collector_query",
          "Rarity range filtering is not available.",
        );
      }
      const readiness = await dependencies.checkReadiness(request.chains);
      if (!readiness.ready) return c.json({ error: "ownership_rebuilding", ownership: readiness }, 503);
      const owner = await dependencies.resolveOwner(
        c.req.param("address"),
        request.chains,
      );
      const statement = collectorQuery(request, owner);
      const started = performance.now();
      const client = await dependencies.pool.connect();
      let rows: CollectorRow[];
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL statement_timeout = '1000ms'");
        // Large owner estimates can trigger costly JIT compilation for a tiny page.
        await client.query("SET LOCAL jit = off");
        await client.query("SET LOCAL work_mem = '16MB'");
        rows = (
          await client.query<CollectorRow>(statement.text, statement.values)
        ).rows;
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      c.header(
        "Server-Timing",
        `page;dur=${(performance.now() - started).toFixed(1)}`,
      );
      c.header("Cache-Control", "no-store");
      return c.json({
        owner: request.chains
          .map((chain) => owner.addresses[chain])
          .find(Boolean)
          ?.toLowerCase(),
        ownerInput: owner.input,
        ownerName: owner.normalizedName,
        resolvedAddresses: owner.addresses,
        chains: request.chains,
        chain: request.chains.length === 1 ? request.chains[0] : null,
        visibility: request.visibility,
        ...statement.page(rows),
      });
    } catch (error) {
      if (error instanceof CollectorQueryError)
        return c.json(
          { error: error.code, message: error.message },
          error.code === "invalid_collector_cursor" ? 409 : 400,
        );
      throw error;
    }
  });
}
