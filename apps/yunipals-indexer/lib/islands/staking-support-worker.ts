import type { Pool } from "pg";
import { ownershipReadConfiguration } from "../ownership/read-mode.js";
import { ownershipReadIdentity } from "../ownership/readiness.js";
import { ownershipReadConfig, physicalPonderSchemaName } from "../offchain/sql.js";
import { createStakingSupportAdapter, type StakingSupportLimits } from "./staking-support-adapter.js";
import { verifyNativeIslandStaking } from "./staking-verifier.js";

export const stakingSupportRole = "yunipals_islands_staking";
export function stakingSupportPeerUrl(value: string | undefined): string {
  if (!value) throw new Error("staking_support_peer_url_required");
  const url = new URL(value);
  const query = url.searchParams;
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.password ||
      (url.username || query.get("user")) !== stakingSupportRole ||
      (query.has("user") && query.get("user") !== stakingSupportRole) ||
      query.get("host") !== "/var/run/postgresql" || !["", "localhost"].includes(url.hostname) ||
      !["", "5432"].includes(url.port) || (query.get("port") ?? "5432") !== "5432" ||
      !/^\/[a-z_][a-z0-9_]{0,62}$/.test(url.pathname) ||
      [...query.keys()].some((key) => !["host", "port", "user"].includes(key) || query.getAll(key).length !== 1)) {
    throw new Error("staking_support_local_dedicated_peer_required");
  }
  return value;
}
export type StakingSupportConfiguration = {
  readSchema: string;
  physicalSchema: string;
  releaseId: string;
  readIdentity: string;
  buildId: string;
  limits: StakingSupportLimits;
};

export function stakingSupportConfiguration(env: NodeJS.ProcessEnv = process.env): StakingSupportConfiguration {
  if (env.ISLANDS_STAKING_SUPPORT_ENABLED !== "true") throw new Error("staking_support_disabled");
  const source = ownershipReadConfiguration(env);
  const readIdentity = env.ISLANDS_STAKING_READ_IDENTITY;
  const buildId = env.ISLANDS_STAKING_BUILD_ID;
  if (source.mode !== "unified" || !readIdentity || !/^0x[0-9a-f]{64}$/.test(readIdentity) || !buildId || !/^[a-zA-Z0-9_-]{1,128}$/.test(buildId)) {
    throw new Error("staking_support_source_binding_required");
  }
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("staking_support_limit_invalid");
    return value;
  };
  return { readSchema: source.readSchema, physicalSchema: env.DATABASE_SCHEMA!, releaseId: source.releaseId,
    readIdentity, buildId, limits: {
      maxTokens: bounded("ISLANDS_STAKING_MAX_TOKENS", 50, 1, 500),
      maxRpcCalls: bounded("ISLANDS_STAKING_MAX_RPC_CALLS", 128, 6, 2048),
      maxSeconds: bounded("ISLANDS_STAKING_MAX_SECONDS", 120, 1, 180),
      maxResponseBytes: bounded("ISLANDS_STAKING_MAX_RESPONSE_BYTES", 1048576, 1024, 1048576)
    } };
}

/** Separate operational job only. It never applies owner DDL/grants, selects a
 * read release, or constructs a provider as a side effect of an API request.
 */
export async function runStakingSupportOnce(
  pool: Pick<Pool, "connect" | "query">,
  config: StakingSupportConfiguration,
  options: { fetch?: typeof fetch; now?: () => number; signal?: AbortSignal } = {}
) {
  const now = options.now ?? Date.now;
  const deadline = now() + config.limits.maxSeconds * 1000;
  const guard = () => {
    if (options.signal?.aborted || now() >= deadline) throw new Error("staking_support_deadline_or_stop");
  };
  guard();
  if (ownershipReadConfig.mode !== "unified" || config.readSchema !== ownershipReadConfig.readSchema ||
      config.physicalSchema !== physicalPonderSchemaName || config.releaseId !== ownershipReadConfig.releaseId) throw new Error("staking_support_runtime_binding_mismatch");
  const state = (await pool.query<{ role: string; actor: string; build: string; ready: boolean }>(`
    SELECT session_user AS role,current_user AS actor,
      (SELECT build_id FROM yunipals_indexer_control.release WHERE id=$1 AND physical_schema=$2) AS build,
      (SELECT count(*)=2 FROM information_schema.columns WHERE table_schema='metadata' AND table_name='island_staking_scan'
        AND column_name IN('ownership_release_id','ownership_read_identity'))
      AND to_regclass('metadata.island_staking_position') IS NOT NULL AS ready`, [config.releaseId, config.physicalSchema])).rows[0];
  if (!state?.ready) throw new Error("staking_support_owner_migration_pending");
  if (state.role !== stakingSupportRole || state.actor !== stakingSupportRole || state.build !== config.buildId) throw new Error("staking_support_role_or_build_mismatch");
  const identity = await ownershipReadIdentity(pool);
  if (!identity || identity.identity !== config.readIdentity) throw new Error("staking_support_read_identity_mismatch");
  // Verify the exact operational tables are writable; missing grants fail
  // before any provider request. No role creation or broad inherited owner.
  const grants = (await pool.query<{ allowed: boolean }>(`SELECT
    (SELECT bool_and(has_table_privilege(current_user,table_name,privilege)) FROM (VALUES
      ('metadata.island_staking_scan','SELECT'),('metadata.island_staking_scan','INSERT'),('metadata.island_staking_scan','UPDATE'),
      ('metadata.island_staking_position','SELECT'),('metadata.island_staking_position','INSERT'),('metadata.island_staking_position','DELETE')
    ) required(table_name,privilege))
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user))
    AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN($1,$2,'yunipals_indexer_control') AND c.relkind IN('r','p','v','m','f')
      AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))
    AND NOT has_schema_privilege(current_user,'metadata','CREATE')
    AS allowed`, [config.physicalSchema,config.readSchema])).rows[0];
  if (!grants?.allowed) throw new Error("staking_support_restricted_grants_pending");
  guard();
  const timeout = AbortSignal.timeout(Math.max(1, deadline - now()));
  const adapter = createStakingSupportAdapter(config.limits, { ...options,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  await adapter.assertFreeProof();
  // Stop scheduling SQL too. A statement already in flight retains its8s
  // server timeout; ROLLBACK is always allowed so a deadline cannot strand a
  // partial replacement or allow a new COMMIT after the deadline.
  const guardedPool: Pick<Pool, "connect"> = {
    connect: async () => {
      guard();
      const client = await pool.connect();
      return new Proxy(client, { get(target, property) {
        const value = Reflect.get(target, property);
        if (property === "query") return (...args: unknown[]) => {
          if (!(typeof args[0] === "string" && /^ROLLBACK\b/i.test(args[0]))) guard();
          return Reflect.apply(target.query, target, args);
        };
        return typeof value === "function" ? value.bind(target) : value;
      } });
    }
  };
  const result = await verifyNativeIslandStaking(guardedPool, config.readSchema, adapter.chain, {
    maxTokens: config.limits.maxTokens, maxReadCalls: Math.min(config.limits.maxRpcCalls, 5000)
  });
  await adapter.assertFreeProof();
  if (result.releaseId !== config.releaseId || result.readIdentity !== config.readIdentity) throw new Error("staking_support_published_identity_mismatch");
  return { ...result, complete: result.unverified === 0, reason: result.unverified === 0 ? null : "membership_unverified",
    sourceSchema: config.physicalSchema, readSchema: config.readSchema, buildId: config.buildId,
    rpc: adapter.statistics(), scanner: false, paidFallback: false };
}
