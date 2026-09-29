import {
  createHmac,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { MarketChainAvailability } from "@protopals/yunipals-market-core/marketAvailability";
import type { MarketplaceChain } from "@protopals/yunipals-market-core/registry";

import { BnbOrderError } from "@/bnb/orders";
import { readOrderSources } from "@/reads/orders";
import { indexedTokenHiddenSql } from "@/reads/visibility";
import { snapshotLimits } from "@/reads/snapshots";
import { CatalogLeaseQueue } from "@/reads/catalogLease";
import { annotateRead } from "@/reads/diagnostics";
import {
  fetchCatalogCounts,
  fetchCatalogBooks,
  fetchCatalogPage,
  fetchCatalogFirstPage,
  parseCatalogRequest,
  visibilityFingerprint,
  type CatalogPosition,
  type CatalogQuery,
  type CatalogSources,
  type CatalogRow
} from "@/reads/catalogQuery";

export const catalogLimits = {
  lifetimeMs: 90000,
  reuseMs: 30000,
  generations: 3,
  queriesPerGeneration: 256
} as const;
type Counts = {
  total: number;
  listedTotal: number | null;
  verifiedListedTotal: number;
};
type IndexerLane = { client: PoolClient; active: number };
type Generation = {
  id: string;
  projectionGenerationId: string | null;
  projectionMetadataReleaseId: string | null;
  observedAt: Date;
  expiresAt: number;
  createdAt: number;
  client: PoolClient;
  indexers: IndexerLane[];
  secret: Buffer;
  fingerprint: string;
  sources: CatalogSources;
  queries: Map<
    string,
    {
      counts: Promise<Counts>;
      firstPages: Map<
        number,
        Promise<Awaited<ReturnType<typeof fetchCatalogPage>>>
      >;
      missingSearchEmpty: boolean;
    }
  >;
  live: boolean;
  lease: CatalogLeaseQueue;
  released: boolean;
  retirementReason?: "expired" | "failed" | "changed" | "shutdown";
  timer?: ReturnType<typeof setTimeout>;
  releaseTimer?: ReturnType<typeof setTimeout>;
};
type Options = {
  indexerKeepers?: Pool;
  readSources?: typeof readOrderSources;
  lifetimeMs?: number;
  reuseMs?: number;
  projectionMode?: "legacy" | "generation";
};

function chainAvailability(
  sources: CatalogSources,
  chain: MarketplaceChain
): MarketChainAvailability {
  const current = sources.availability?.[chain];
  if (current) return current;
  const status = sources.statuses[chain];
  const evidence =
    status === "available"
      ? "current"
      : status === "syncing"
        ? "recovering"
        : "unavailable";
  const coverage =
    status === "available"
      ? "complete"
      : status === "syncing"
        ? "partial"
        : "unavailable";
  return {
    chain,
    evidence,
    listings: { status: coverage, completedAt: null, revision: null },
    offers: { status: coverage, completedAt: null, revision: null }
  };
}

function v2Sources(sources: CatalogSources): CatalogSources {
  return {
    ...sources,
    readVersion: 2,
    statuses: Object.fromEntries(
      (Object.keys(sources.statuses) as MarketplaceChain[]).map((chain) => [
        chain,
        chainAvailability(sources, chain).evidence === "current"
          ? "available"
          : "unavailable"
      ])
    ) as CatalogSources["statuses"],
    availability: Object.fromEntries(
      (Object.keys(sources.statuses) as MarketplaceChain[]).map((chain) => [
        chain,
        chainAvailability(sources, chain)
      ])
    ) as NonNullable<CatalogSources["availability"]>
  };
}

function sourceLaneCount(generation: Generation, query: CatalogQuery) {
  if (!generation.indexers.length || !query.chains.length) return 0;
  const families =
    query.chains.includes("bnb") &&
    query.chains.some((chain) => chain !== "bnb")
      ? 2
      : 1;
  return Math.min(families, generation.indexers.length);
}

function mac(
  generation: Generation,
  query: CatalogQuery,
  payload: Buffer,
  readVersion: 1 | 2
) {
  return createHmac("sha256", generation.secret)
    .update(
      JSON.stringify([generation.id, readVersion, query.key, query.page.limit])
    )
    .update(payload)
    .digest()
    .subarray(0, 16);
}
function encodeCursor(
  generation: Generation,
  query: CatalogQuery,
  position: CatalogPosition,
  readVersion: 1 | 2
) {
  const score = Buffer.from(position.value ?? "", "utf8");
  if (score.length > 80)
    throw new BnbOrderError("invalid_catalog_position", 503);
  const payload = Buffer.alloc(37 + score.length);
  payload.writeUInt32BE(position.chainId, 0);
  Buffer.from(
    BigInt(position.tokenId).toString(16).padStart(64, "0"),
    "hex"
  ).copy(payload, 4);
  payload[36] = position.value === null ? 0 : 1;
  score.copy(payload, 37);
  return Buffer.concat([
    mac(generation, query, payload, readVersion),
    payload
  ]).toString("base64url");
}
function decodeCursor(
  generation: Generation,
  query: CatalogQuery,
  readVersion: 1 | 2
): CatalogPosition | undefined {
  if (!query.page.cursor) return undefined;
  try {
    const bytes = Buffer.from(query.page.cursor, "base64url"),
      payload = bytes.subarray(16);
    if (
      bytes.length < 53 ||
      bytes.length > 133 ||
      bytes.toString("base64url") !== query.page.cursor ||
      !timingSafeEqual(
        bytes.subarray(0, 16),
        mac(generation, query, payload, readVersion)
      )
    )
      throw new Error();
    const value =
      payload[36] === 0 ? null : payload.subarray(37).toString("utf8");
    if (
      ![0, 1].includes(payload[36]!) ||
      (value === null && payload.length !== 37) ||
      (value !== null &&
        (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(value) ||
          !Number.isFinite(Number(value))))
    )
      throw new Error();
    return {
      chainId: payload.readUInt32BE(0),
      tokenId: BigInt(
        "0x" + payload.subarray(4, 36).toString("hex")
      ).toString(),
      value
    };
  } catch {
    throw new BnbOrderError("snapshot_refresh_required", 409);
  }
}

/** Catalog MVCC views are shared by all filters, never copied per visitor. */
export class CatalogService {
  private readonly generations = new Map<string, Generation>();
  private opening?: Promise<Generation>;
  private stopped = false;
  private readonly lifetimeMs: number;
  private readonly reuseMs: number;
  private readonly projectionGenerationMode: boolean;
  constructor(
    private readonly pool: Pool,
    private readonly keepers: Pool,
    private readonly options: Options = {}
  ) {
    this.lifetimeMs = options.lifetimeMs ?? catalogLimits.lifetimeMs;
    this.reuseMs = options.reuseMs ?? catalogLimits.reuseMs;
    const projectionMode =
      options.projectionMode ??
      process.env.YUNIPALS_PROJECTION_MODE ??
      "legacy";
    if (projectionMode !== "legacy" && projectionMode !== "generation") {
      throw new Error(`Invalid YUNIPALS_PROJECTION_MODE: ${projectionMode}`);
    }
    this.projectionGenerationMode = projectionMode === "generation";
    if (
      this.lifetimeMs < 1 ||
      this.lifetimeMs > catalogLimits.lifetimeMs ||
      this.reuseMs < 1 ||
      this.reuseMs > this.lifetimeMs
    )
      throw new Error("Invalid catalog snapshot lifetime.");
  }
  private releaseGeneration(generation: Generation) {
    if (generation.released) return;
    generation.released = true;
    clearTimeout(generation.releaseTimer);
    generation.client.release(true);
    for (const lane of generation.indexers) lane.client.release(true);
  }
  private invalidate(
    generation: Generation,
    reason: Generation["retirementReason"] = "changed"
  ) {
    if (!generation.live) return;
    generation.live = false;
    generation.retirementReason = reason;
    clearTimeout(generation.timer);
    this.generations.delete(generation.id);
    generation.lease.close(
      new BnbOrderError(
        reason === "failed" || reason === "shutdown"
          ? "catalog_indexer_unavailable"
          : "snapshot_refresh_required",
        reason === "failed" || reason === "shutdown" ? 503 : 409
      )
    );
    // Let in-flight bounded reads settle before destroying their connections.
    // The hard guard also covers a transport which stops honoring its deadline.
    if (generation.lease.active) {
      generation.releaseTimer = setTimeout(
        () => this.releaseGeneration(generation),
        12000
      );
      generation.releaseTimer.unref();
    } else this.releaseGeneration(generation);
  }
  async close() {
    this.stopped = true;
    if (this.opening) await this.opening.catch(() => {});
    for (const generation of this.generations.values())
      this.invalidate(generation, "shutdown");
    await this.keepers.end();
    await this.options.indexerKeepers?.end();
  }
  async assertIndexerReady() {
    if (!this.options.indexerKeepers) return;
    const result = await this.options.indexerKeepers.query<{ ready: boolean }>(
      `SELECT bool_and(to_regclass(name) IS NOT NULL
        AND has_table_privilege(current_user,to_regclass(name),'SELECT')
        AND NOT has_table_privilege(current_user,to_regclass(name),'INSERT,UPDATE,DELETE,TRUNCATE')) AS ready
      FROM unnest(ARRAY['yunipals_indexer_v3.token','bnb_indexer.token','yunipals_read_v4.token',
        'yunipals_read_v4.transfer_event','metadata.token_metadata','metadata.token_search',
        'metadata.token_visibility','metadata.market_catalog_trait'
        ${this.projectionGenerationMode ? ",'metadata_projection.active','metadata_projection.generation','metadata_projection.search'" : ""}]) name`
    );
    if (result.rows[0]?.ready !== true)
      throw new BnbOrderError("catalog_indexer_unavailable", 503);
  }
  private assertLive(generation: Generation) {
    if (
      this.stopped ||
      generation.retirementReason === "failed" ||
      generation.retirementReason === "shutdown"
    )
      throw new BnbOrderError("catalog_indexer_unavailable", 503);
    if (!generation.live || Date.now() >= generation.expiresAt)
      throw new BnbOrderError("snapshot_refresh_required", 409);
  }
  private async acquire(id?: string): Promise<Generation> {
    if (this.stopped) throw new BnbOrderError("market_unavailable", 503);
    if (id) {
      const generation = this.generations.get(id);
      if (!generation)
        throw new BnbOrderError("snapshot_refresh_required", 409);
      this.assertLive(generation);
      return generation;
    }
    for (const generation of this.generations.values())
      if (Date.now() >= generation.expiresAt)
        this.invalidate(generation, "expired");
    const current = [...this.generations.values()].at(-1);
    if (current && Date.now() - current.createdAt < this.reuseMs)
      return current;
    if (this.opening) return this.opening;
    if (this.generations.size >= catalogLimits.generations)
      throw new BnbOrderError("catalog_snapshot_capacity", 503);
    this.opening = (async () => {
      // Scope indexer readiness to catalog work; retained-order recovery must
      // still start and operate when this separate read connection is unavailable.
      await this.assertIndexerReady();
      const client = await this.keepers.connect();
      const indexers: PoolClient[] = [];
      let released = false;
      let generation: Generation | undefined;
      const discard = () => {
        if (released) return;
        released = true;
        client.release(true);
        for (const indexer of indexers) indexer.release(true);
      };
      const onError = () => {
        if (generation) this.invalidate(generation, "failed");
        else discard();
      };
      client.on("error", onError);
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await client.query<{ now: Date }>(
          "SELECT clock_timestamp() AS now"
        );
        const row = result.rows[0]!;
        const sources = await (this.options.readSources ?? readOrderSources)(
          client,
          row.now
        );
        if (this.options.indexerKeepers) {
          const indexer = await this.options.indexerKeepers.connect();
          indexers.push(indexer);
          if (released) {
            indexer.release(true);
            throw new BnbOrderError("market_unavailable", 503);
          }
          indexer.on("error", onError);
          await indexer.query(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          );
          const exported = await indexer.query<{ snapshot: string }>(
            "SELECT pg_export_snapshot() AS snapshot"
          );
          const snapshot = exported.rows[0]?.snapshot;
          if (!snapshot || !/^[0-9A-Fa-f-]+$/.test(snapshot))
            throw new BnbOrderError("catalog_indexer_unavailable", 503);
          const follower = await this.options.indexerKeepers.connect();
          indexers.push(follower);
          follower.on("error", onError);
          await follower.query(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          );
          await follower.query(`SET TRANSACTION SNAPSHOT '${snapshot}'`);
        }
        const projection = this.projectionGenerationMode
          ? (
              await (indexers[0] ?? client).query<{
                current_id: string;
                metadata_release_id: string | null;
              }>(`SELECT a.current_id,g.metadata_release_id
              FROM metadata_projection.active a JOIN metadata_projection.generation g
                ON g.id=a.current_id
              WHERE a.singleton AND g.state='ready' AND g.format_version=1`)
            ).rows[0]
          : undefined;
        const projectionGenerationId = projection?.current_id ?? null;
        if (this.projectionGenerationMode && !projectionGenerationId)
          throw new BnbOrderError("catalog_indexer_unavailable", 503);
        const fingerprint = await visibilityFingerprint(indexers[0] ?? client);
        generation = {
          id: randomUUID(),
          projectionGenerationId,
          projectionMetadataReleaseId: projection?.metadata_release_id ?? null,
          observedAt: row.now,
          client,
          indexers: indexers.map((indexer) => ({ client: indexer, active: 0 })),
          sources,
          fingerprint,
          createdAt: Date.now(),
          expiresAt: Date.now() + this.lifetimeMs,
          secret: randomBytes(32),
          queries: new Map(),
          live: true,
          lease: new CatalogLeaseQueue(),
          released: false
        };
        generation.timer = setTimeout(
          () => this.invalidate(generation!, "expired"),
          this.lifetimeMs
        );
        generation.timer.unref();
        this.generations.set(generation.id, generation);
        return generation;
      } catch (error) {
        discard();
        throw error;
      }
    })();
    try {
      return await this.opening;
    } finally {
      this.opening = undefined;
    }
  }
  private async heldRead<T>(
    generation: Generation,
    indexerCount: number,
    task: (db: PoolClient, indexers: PoolClient[]) => Promise<T>,
    phase: string
  ) {
    this.assertLive(generation);
    const queuedAt = performance.now();
    annotateRead({
      phase: "queue",
      snapshotAgeMs: Date.now() - generation.createdAt
    });
    const release = await generation.lease.acquire();
    const started = performance.now();
    annotateRead({
      phase,
      queueWaitMs: Math.round(started - queuedAt),
      snapshotAgeMs: Date.now() - generation.createdAt,
      projectionGeneration: generation.projectionGenerationId
    });
    // postgres_fdw stays on the single local connection. Direct indexer lanes
    // import one exported snapshot, so source families can run concurrently
    // without allowing counts or rankings to change between pages. Local books
    // are query parameters; no source writes or per-visitor copies are needed.
    const lanes = [...generation.indexers]
      .sort((left, right) => left.active - right.active)
      .slice(0, indexerCount);
    let lanesHeld = false;
    try {
      this.assertLive(generation);
      if (lanes.length !== indexerCount)
        throw new BnbOrderError("catalog_snapshot_capacity", 503);
      for (const lane of lanes) lane.active++;
      lanesHeld = true;
      const result = await task(
        generation.client,
        lanes.map((lane) => lane.client)
      );
      this.assertLive(generation);
      return result;
    } catch (error) {
      // A statement error aborts the held transaction. Retire all its cursors.
      const expired =
        generation.retirementReason === "expired" ||
        Date.now() >= generation.expiresAt;
      this.invalidate(generation, expired ? "expired" : "failed");
      if (expired) throw new BnbOrderError("snapshot_refresh_required", 409);
      throw error;
    } finally {
      if (lanesHeld) for (const lane of lanes) lane.active--;
      annotateRead({ executionMs: Math.round(performance.now() - started) });
      release();
      if (!generation.live) this.releaseGeneration(generation);
    }
  }
  private async currentAssets(generation: Generation, items: CatalogRow[]) {
    if (!items.length) return;
    const changed = await this.pool.query<{ changed: boolean }>(
      `SELECT EXISTS(
      SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS a(chain text,token_id text,owner text,lifecycle integer)
      LEFT JOIN yunipals_read_v4.token t ON t.collection=a.chain AND t.token_id=a.token_id
      WHERE t.owner IS NULL OR lower(t.owner)<>lower(a.owner) OR t.lifecycle<>a.lifecycle OR t.burned OR ${indexedTokenHiddenSql}) AS changed`,
      [
        JSON.stringify(
          items.map(({ token }) => ({
            chain: token.chain,
            token_id: token.tokenId,
            owner: token.owner,
            lifecycle: token.lifecycle
          }))
        )
      ]
    );
    if (changed.rows[0]?.changed) {
      this.invalidate(generation);
      throw new BnbOrderError("snapshot_refresh_required", 409);
    }
  }
  async tokens(params: URLSearchParams) {
    const response = await this.tokensByVersion(params, 1);
    if (response.schemaVersion !== 1)
      throw new BnbOrderError("stored_order_mismatch", 503);
    return response;
  }

  async tokensV2(params: URLSearchParams) {
    const response = await this.tokensByVersion(params, 2);
    if (response.schemaVersion !== 2)
      throw new BnbOrderError("stored_order_mismatch", 503);
    return response;
  }

  private async tokensByVersion(params: URLSearchParams, readVersion: 1 | 2) {
    const query = parseCatalogRequest(params);
    annotateRead({
      phase: "acquire",
      filterHash: createHash("sha256")
        .update(query.key)
        .digest("hex")
        .slice(0, 16),
      sort: query.filters.sort
    });
    let generation = await this.acquire(query.page.snapshot);
    if ((await visibilityFingerprint(this.pool)) !== generation.fingerprint) {
      for (const old of this.generations.values()) this.invalidate(old);
      if (query.page.snapshot)
        throw new BnbOrderError("snapshot_refresh_required", 409);
      generation = await this.acquire();
    }
    const financial =
      query.filters.sale !== "all" ||
      query.currency ||
      query.min !== undefined ||
      query.max !== undefined ||
      query.filters.sort.startsWith("price-");
    const availability = Object.fromEntries(
      query.chains.map((chain) => [
        chain,
        chainAvailability(generation.sources, chain)
      ])
    ) as Partial<Record<MarketplaceChain, MarketChainAvailability>>;
    const complete = query.chains.every((chain) =>
      readVersion === 1
        ? generation.sources.statuses[chain] === "available"
        : availability[chain]!.evidence === "current" &&
          availability[chain]!.listings.status === "complete"
    );
    if (readVersion === 1 && financial && !complete)
      throw new BnbOrderError("catalog_source_unavailable", 503);
    const sources =
      readVersion === 2 ? v2Sources(generation.sources) : generation.sources;
    const effectiveQuery: CatalogQuery =
      readVersion === 2 && query.filters.sale === "unlisted"
        ? {
            ...query,
            projectionGenerationId:
              generation.projectionGenerationId ?? undefined,
            chains: query.chains.filter(
              (chain) =>
                availability[chain]!.evidence === "current" &&
                availability[chain]!.listings.status === "complete"
            )
          }
        : {
            ...query,
            projectionGenerationId:
              generation.projectionGenerationId ?? undefined
          };
    const position = decodeCursor(generation, query, readVersion);
    const stateKey = `v${readVersion}:${query.key}`;
    let state = generation.queries.get(stateKey);
    if (!state) {
      if (generation.queries.size >= catalogLimits.queriesPerGeneration)
        throw new BnbOrderError("catalog_query_capacity", 503);
      const held = generation;
      const firstPages = new Map<
        number,
        Promise<Awaited<ReturnType<typeof fetchCatalogPage>>>
      >();
      const laneCount = sourceLaneCount(held, effectiveQuery);
      const combineFirstPage =
        laneCount > 0 &&
        !position &&
        !query.filters.sort.startsWith("token-id") &&
        Object.keys(query.filters.traits).length > 0;
      const read = this.heldRead(
        held,
        laneCount,
        async (db, indexers) => {
          const books = indexers.length
            ? await fetchCatalogBooks(
                db,
                effectiveQuery,
                held.observedAt,
                sources
              )
            : undefined;
          // Filtered rank/price pages already sort the complete candidate set.
          // Token-ID pages can stop an ordered index scan early; combining those
          // with the count adds unnecessary search joins for the whole population.
          let result: { total: bigint; listed: bigint };
          let page: Awaited<ReturnType<typeof fetchCatalogPage>> | undefined;
          if (combineFirstPage) {
            const combined = await fetchCatalogFirstPage(
              indexers,
              effectiveQuery,
              held.observedAt,
              sources,
              books!
            );
            page = combined.page;
            result = combined;
          } else {
            result = await fetchCatalogCounts(
              indexers.length ? indexers : db,
              effectiveQuery,
              held.observedAt,
              sources,
              books
            );
          }
          const total = Number(result.total),
            listed = Number(result.listed);
          if (!Number.isSafeInteger(total) || !Number.isSafeInteger(listed))
            throw new BnbOrderError("catalog_count_capacity", 503);
          return {
            counts: {
              total,
              listedTotal: complete ? listed : null,
              verifiedListedTotal: listed
            },
            page
          };
        },
        combineFirstPage ? "counts_and_page" : "counts"
      );
      const counts = read.then((result) => result.counts);
      if (combineFirstPage) {
        const page = read.then((result) => result.page!);
        firstPages.set(query.page.limit, page);
        void page.catch(() => {});
      }
      state = { counts, firstPages, missingSearchEmpty: false };
      generation.queries.set(stateKey, state);
      void counts.catch(() => held.queries.delete(stateKey));
    }
    const totals = await state.counts;
    let page: Awaited<ReturnType<typeof fetchCatalogPage>>;
    if (totals.total === 0) page = { items: [], next: null };
    else {
      let pending = position
        ? undefined
        : state.firstPages.get(query.page.limit);
      if (!pending) {
        pending = this.heldRead(
          generation,
          sourceLaneCount(generation, effectiveQuery),
          async (db, indexers) => {
            const books = indexers.length
              ? await fetchCatalogBooks(
                  db,
                  effectiveQuery,
                  generation.observedAt,
                  sources
                )
              : undefined;
            return fetchCatalogPage(
              indexers.length ? indexers : db,
              effectiveQuery,
              generation.observedAt,
              sources,
              position,
              state,
              totals.total,
              books
            );
          },
          position ? "continuation" : "first_page"
        );
        if (!position) {
          state.firstPages.set(query.page.limit, pending);
          const cached = pending;
          void pending.catch(() => {
            if (state.firstPages.get(query.page.limit) === cached)
              state.firstPages.delete(query.page.limit);
          });
        }
      }
      page = await pending;
    }
    await this.currentAssets(generation, page.items);
    if ((await visibilityFingerprint(this.pool)) !== generation.fingerprint) {
      for (const old of this.generations.values()) this.invalidate(old);
      throw new BnbOrderError("snapshot_refresh_required", 409);
    }
    this.assertLive(generation);
    const base = {
      query: query.key,
      snapshot: {
        id: generation.id,
        observedAt: generation.observedAt.toISOString()
      },
      sources: Object.fromEntries(
        query.chains.map((chain) => [chain, generation.sources.statuses[chain]])
      ),
      total: totals.total,
      listedTotal: totals.listedTotal,
      items: page.items,
      nextCursor: page.next
        ? encodeCursor(generation, query, page.next, readVersion)
        : null
    };
    const listingCompleteness = complete
      ? "complete"
      : query.chains.some(
            (chain) => availability[chain]!.evidence === "current"
          )
        ? "partial"
        : "unavailable";
    const response =
      readVersion === 1
        ? { schemaVersion: 1 as const, ...base }
        : {
            schemaVersion: 2 as const,
            ...base,
            availability,
            listingCompleteness,
            verifiedListedTotal: totals.verifiedListedTotal
          };
    if (
      Buffer.byteLength(JSON.stringify(response)) > snapshotLimits.responseBytes
    )
      throw new BnbOrderError("response_capacity", 503);
    return response;
  }
}
