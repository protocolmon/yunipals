import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { record } from "@protopals/yunipals-market-core/validation";

import { transaction } from "@/db/pool";
import { OpenSeaError, type OpenSeaClient } from "@/opensea/client";
import {
  OpenSeaPolicyError,
  resolveOpenSeaCollectionPolicy
} from "@/opensea/policy";

export type PolicyResolutionTiming = {
  chain: OpenSeaChain;
  purpose: "transaction" | "browse";
  totalMs: number;
  databaseMs: number;
  providerMs: number;
  leaseWaitMs: number;
  cacheHit: boolean;
  outcome: "success" | "error";
};

type Observation = {
  generation: string;
  response: unknown | null;
  observed_at: Date | null;
  error_code: string | null;
  retry_ms: number;
  leased: boolean;
  now: Date;
  last_attempt_at: Date | null;
  last_error_at: Date | null;
  response_version: string | null;
};

type PolicyFreshness = "current" | "stale";

export type OpenSeaBrowsePolicyObservation = {
  policy: ReturnType<typeof resolveOpenSeaCollectionPolicy>;
  freshness: PolicyFreshness;
  lastSuccessAt: string;
  lastAttemptAt: string | null;
  lastError: { code: string; at: string } | null;
  responseVersion: string;
};

const transactionFreshMs = 60000;
const browseStaleMs = 15 * 60 * 1000;

function browseRefreshMs(chain: OpenSeaChain) {
  // Stable per-chain jitter avoids all collections refreshing on the same tick.
  return 270000 + (marketplaceChains[chain].chainId % 30001);
}

// Only policy-bearing fields are stored. Collection metadata is not an order,
// signature or protected fulfillment authorization, and is never used as one.
function policyFields(raw: unknown) {
  const source = record(raw);
  const result: Record<string, unknown> = {};
  for (const key of [
    "collection",
    "contracts",
    "is_disabled",
    "pricing_currencies",
    "fees",
    "required_zone"
  ])
    if (Object.hasOwn(source, key)) result[key] = source[key];
  if (Buffer.byteLength(JSON.stringify(result)) > 60000)
    throw new OpenSeaError("provider_response_too_large");
  return result;
}

// Shared by all callers using the same provider account coordinator, even when
// their marketplace/indexer databases differ. No local policy cache can conceal
// another process's failed refresh or changed fee/currency policy.
export class OpenSeaSharedPolicyResolver {
  constructor(
    private readonly pool: Pool,
    private readonly scope: string,
    private readonly provider: Pick<OpenSeaClient, "getCollection">,
    private readonly options: {
      maxDurationSeconds: number;
      timeoutMs?: number;
      observe?: (timing: PolicyResolutionTiming) => void;
    }
  ) {
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope) ||
      !Number.isSafeInteger(options.maxDurationSeconds) ||
      options.maxDurationSeconds < 3600 ||
      options.maxDurationSeconds > 180 * 86400 ||
      (options.timeoutMs !== undefined &&
        (!Number.isSafeInteger(options.timeoutMs) ||
          options.timeoutMs < 1 ||
          options.timeoutMs > 10000))
    )
      throw new Error("Invalid shared OpenSea policy settings.");
  }

  private parse(
    chain: OpenSeaChain,
    response: unknown,
    observedAt: Date,
    validForSeconds = 60,
    maxAgeMs = transactionFreshMs
  ) {
    const now = Date.now();
    const started = observedAt.getTime();
    if (
      !Number.isSafeInteger(started) ||
      started > now ||
      now - started >= maxAgeMs
    )
      throw new OpenSeaError("provider_timeout");
    // Every consumer revalidates the cached response and applies its own order
    // duration ceiling. Reuse retains the original fetch-start timestamp/expiry.
    return resolveOpenSeaCollectionPolicy(response, {
      chain,
      collectionSlug: marketplaceChains[chain].collectionSlug,
      observedAt: started,
      maxDurationSeconds: this.options.maxDurationSeconds,
      validForSeconds
    });
  }

  async resolve(chain: OpenSeaChain, fresh = false) {
    return (await this.resolveInternal(chain, fresh, "transaction")).policy;
  }

  async resolveBrowse(
    chain: OpenSeaChain
  ): Promise<OpenSeaBrowsePolicyObservation> {
    return this.resolveInternal(chain, false, "browse");
  }

  async resolveCurrentBrowsePolicy(chain: OpenSeaChain) {
    const observation = await this.resolveBrowse(chain);
    if (observation.freshness !== "current")
      throw new OpenSeaError("provider_busy", undefined, 30000);
    return observation.policy;
  }

  private async resolveInternal(
    chain: OpenSeaChain,
    fresh: boolean,
    purpose: "transaction" | "browse"
  ): Promise<OpenSeaBrowsePolicyObservation> {
    if (!isOpenSeaChain(chain))
      throw new OpenSeaPolicyError("provider_collection_mismatch");
    const chainId = marketplaceChains[chain].chainId;
    const requestedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10000
    );
    const timing: PolicyResolutionTiming = {
      chain,
      purpose,
      totalMs: 0,
      databaseMs: 0,
      providerMs: 0,
      leaseWaitMs: 0,
      cacheHit: false,
      outcome: "success"
    };
    const measure = async <T>(
      key: "databaseMs" | "providerMs" | "leaseWaitMs",
      work: () => Promise<T>
    ) => {
      const start = performance.now();
      try {
        return await work();
      } finally {
        timing[key] += performance.now() - start;
      }
    };
    const startedAt = performance.now();
    let baseline: bigint | undefined;
    try {
      while (!controller.signal.aborted) {
        const action = await measure("databaseMs", () =>
          transaction(this.pool, async (db) => {
            await db.query(
              `INSERT INTO yunipals_market.opensea_policy_observation(scope,chain_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
              [this.scope, chainId]
            );
            const result = await db.query<Observation>(
              `SELECT generation::text,response,observed_at,error_code,
            CASE WHEN retry_at='-infinity' THEN 0 ELSE greatest(0,extract(epoch FROM retry_at-clock_timestamp())*1000)::double precision END AS retry_ms,
            coalesce(lease_until>clock_timestamp(),false) AS leased,clock_timestamp() AS now,
            last_attempt_at,last_error_at,response_version
            FROM yunipals_market.opensea_policy_observation WHERE scope=$1 AND chain_id=$2 FOR UPDATE`,
              [this.scope, chainId]
            );
            const row = result.rows[0]!;
            baseline ??= BigInt(row.generation);
            const age = row.observed_at
              ? row.now.getTime() - row.observed_at.getTime()
              : Number.POSITIVE_INFINITY;
            const confirmedInvalid = [
              "provider_collection_mismatch",
              "provider_policy_unsupported",
              "provider_collection_disabled"
            ].includes(row.error_code ?? "");
            if (confirmedInvalid) return { type: "failed" as const, row };
            if (
              row.response !== null &&
              row.observed_at &&
              !row.leased &&
              (!fresh ||
                BigInt(row.generation) > baseline ||
                row.observed_at.getTime() > requestedAt) &&
              age >= 0 &&
              age <
                (purpose === "browse"
                  ? browseRefreshMs(chain)
                  : transactionFreshMs)
            )
              return {
                type: "cached" as const,
                row,
                freshness: "current" as const
              };
            if (
              purpose === "browse" &&
              row.response !== null &&
              row.observed_at &&
              age >= 0 &&
              age < browseStaleMs &&
              (row.leased || row.retry_ms > 0)
            )
              return {
                type: "cached" as const,
                row,
                freshness: "stale" as const
              };
            if (row.leased) return { type: "wait" as const };
            if (row.retry_ms > 0) return { type: "failed" as const, row };
            const token = randomUUID();
            const claimed = await db.query<{ started: Date }>(
              `UPDATE yunipals_market.opensea_policy_observation
            SET lease_token=$3,lease_until=clock_timestamp()+interval '15 seconds',last_attempt_at=clock_timestamp()
            WHERE scope=$1 AND chain_id=$2 RETURNING clock_timestamp() AS started`,
              [this.scope, chainId, token]
            );
            return {
              type: "fetch" as const,
              token,
              started: claimed.rows[0]!.started
            };
          })
        );
        if (controller.signal.aborted)
          throw new OpenSeaError("provider_timeout");
        if (action.type === "cached") {
          timing.cacheHit = true;
          if (purpose === "browse")
            return this.browseResult(chain, action.row, action.freshness);
          const observedAt = action.row.observed_at!;
          return {
            policy: this.parse(chain, action.row.response, observedAt),
            freshness: "current",
            lastSuccessAt: observedAt.toISOString(),
            lastAttemptAt: action.row.last_attempt_at?.toISOString() ?? null,
            lastError: null,
            responseVersion:
              action.row.response_version ??
              createHash("sha256")
                .update(JSON.stringify(action.row.response))
                .digest("hex")
          };
        }
        if (action.type === "failed") {
          const reason = action.row.error_code;
          if (
            reason === "provider_collection_mismatch" ||
            reason === "provider_policy_unsupported" ||
            reason === "provider_collection_disabled"
          )
            throw new OpenSeaPolicyError(reason);
          throw new OpenSeaError(
            "provider_busy",
            undefined,
            Math.ceil(action.row.retry_ms)
          );
        }
        if (action.type === "wait") {
          await measure("leaseWaitMs", () =>
            delay(50, undefined, { signal: controller.signal })
          );
          continue;
        }
        try {
          const raw = policyFields(
            await measure("providerMs", () =>
              this.provider.getCollection(
                marketplaceChains[chain].collectionSlug,
                controller.signal
              )
            )
          );
          if (controller.signal.aborted)
            throw new OpenSeaError("provider_timeout");
          const resolved = this.parse(
            chain,
            raw,
            action.started,
            purpose === "browse" ? 300 : 60,
            purpose === "browse" ? browseStaleMs : transactionFreshMs
          );
          const responseVersion = createHash("sha256")
            .update(JSON.stringify(raw))
            .digest("hex");
          const stored = await this.pool.query(
            `UPDATE yunipals_market.opensea_policy_observation
            SET response=$4::jsonb,observed_at=$5,generation=generation+1,error_code=NULL,
              retry_at='-infinity',lease_token=NULL,lease_until=NULL,last_attempt_at=$5,response_version=$6
            WHERE scope=$1 AND chain_id=$2 AND lease_token=$3 AND lease_until>clock_timestamp()`,
            [
              this.scope,
              chainId,
              action.token,
              JSON.stringify(raw),
              action.started,
              responseVersion
            ]
          );
          if (!stored.rowCount || controller.signal.aborted)
            throw new OpenSeaError("provider_timeout");
          return {
            policy: resolved,
            freshness: "current",
            lastSuccessAt: action.started.toISOString(),
            lastAttemptAt: action.started.toISOString(),
            lastError: null,
            responseVersion
          };
        } catch (error) {
          const code =
            error instanceof OpenSeaError || error instanceof OpenSeaPolicyError
              ? error.code
              : "provider_policy_unavailable";
          const backoff =
            error instanceof OpenSeaError
              ? Math.max(1000, error.retryAfterMs ?? 60000)
              : 60000;
          // A stale/late worker cannot erase a successor's observation or lease.
          await this.pool.query(
            `UPDATE yunipals_market.opensea_policy_observation
            SET generation=generation+1,error_code=$4,
              retry_at=clock_timestamp()+$5::double precision*interval '1 millisecond',
              lease_token=NULL,lease_until=NULL,last_attempt_at=clock_timestamp(),last_error_at=clock_timestamp()
            WHERE scope=$1 AND chain_id=$2 AND lease_token=$3`,
            [this.scope, chainId, action.token, code, backoff]
          );
          if (purpose === "browse") {
            const stale = await this.readStale(chainId);
            if (stale) return this.browseResult(chain, stale, "stale");
          }
          throw error;
        }
      }
      throw new OpenSeaError("provider_timeout");
    } catch (error) {
      timing.outcome = "error";
      if (error instanceof OpenSeaError || error instanceof OpenSeaPolicyError)
        throw error;
      throw new OpenSeaError(
        controller.signal.aborted ? "provider_timeout" : "provider_busy"
      );
    } finally {
      clearTimeout(timer);
      timing.totalMs = performance.now() - startedAt;
      try {
        this.options.observe?.(timing);
      } catch {
        /* Diagnostics must not affect policy validation. */
      }
    }
  }

  private async readStale(chainId: number) {
    const result = await this.pool.query<Observation>(
      `SELECT generation::text,response,observed_at,error_code,
      CASE WHEN retry_at='-infinity' THEN 0 ELSE greatest(0,extract(epoch FROM retry_at-clock_timestamp())*1000)::double precision END AS retry_ms,
      coalesce(lease_until>clock_timestamp(),false) AS leased,clock_timestamp() AS now,
      last_attempt_at,last_error_at,response_version
      FROM yunipals_market.opensea_policy_observation WHERE scope=$1 AND chain_id=$2
        AND response IS NOT NULL AND observed_at>clock_timestamp()-interval '15 minutes'`,
      [this.scope, chainId]
    );
    return result.rows[0];
  }

  private browseResult(
    chain: OpenSeaChain,
    row: Observation,
    freshness: PolicyFreshness
  ): OpenSeaBrowsePolicyObservation {
    const observedAt = row.observed_at!;
    return {
      policy: this.parse(chain, row.response, observedAt, 300, browseStaleMs),
      freshness,
      lastSuccessAt: observedAt.toISOString(),
      lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
      lastError:
        row.error_code && row.last_error_at
          ? { code: row.error_code, at: row.last_error_at.toISOString() }
          : null,
      responseVersion:
        row.response_version ??
        createHash("sha256").update(JSON.stringify(row.response)).digest("hex")
    };
  }
}
