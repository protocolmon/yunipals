import { readFileSync } from "node:fs";
import type pg from "pg";

import {
  unifiedRpcManifestId,
  unifiedRpcPaidRange,
  unifiedRpcProfileId,
  validateUnifiedRpcProfile,
  type UnifiedRpcCall,
  type UnifiedRpcProfile,
  type UnifiedRpcWorkload
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";
import { alchemyComputeUnits } from "@/opensea/rpcComputeBudget";

export type UnifiedRpcPolicyGate = {
  profile: UnifiedRpcProfile;
  chainId: number;
  ready(workload: UnifiedRpcWorkload): Promise<void>;
  inspect(
    workload: UnifiedRpcWorkload,
    permit?: string
  ): Promise<Record<string, unknown>>;
  reservePaid(
    permit: string | undefined,
    calls: UnifiedRpcCall[]
  ): Promise<void>;
};

export function readUnifiedRpcPolicyEnvironment(
  input: NodeJS.ProcessEnv = process.env
) {
  const path = input.MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE;
  if (!path) {
    if (
      input.MARKET_RPC_PROXY_UNIFIED_PROFILE_ID ||
      input.MARKET_RPC_PROXY_CHAIN_ID
    )
      throw new Error("Incomplete unified RPC profile configuration.");
    return undefined;
  }
  if (!path.startsWith("/"))
    throw new Error("Unified RPC profile path must be absolute.");
  const profile = validateUnifiedRpcProfile(
    JSON.parse(readFileSync(path, "utf8"))
  );
  if (
    unifiedRpcProfileId(profile) !== input.MARKET_RPC_PROXY_UNIFIED_PROFILE_ID
  )
    throw new Error("Unified RPC profile differs from reviewed identity.");
  const chainId = Number(input.MARKET_RPC_PROXY_CHAIN_ID);
  if (
    !profile.manifest.sources.some(
      (source) => source.enabled && source.chainId === chainId
    )
  )
    throw new Error("Unified RPC chain is not reviewed.");
  return { profile, chainId };
}

export function createUnifiedRpcPolicyGate(
  pool: pg.Pool,
  scope: string,
  profile: UnifiedRpcProfile,
  chainId: number
): UnifiedRpcPolicyGate {
  const id = unifiedRpcProfileId(profile);
  if (profile.scope !== scope)
    throw new Error("Unified RPC coordinator scope mismatch.");
  return {
    profile,
    chainId,
    async ready(workload) {
      const result = await pool.query(
        `SELECT 1 FROM yunipals_market.unified_rpc_profile p
        JOIN yunipals_market.opensea_request_budget c USING(scope)
        JOIN yunipals_market.rpc_compute_budget b USING(scope)
        JOIN yunipals_market.rpc_compute_allocation a USING(scope)
        WHERE p.profile_id=$1 AND p.scope=$2 AND p.manifest_hash=$3 AND p.policy=$4::jsonb
          AND p.enabled AND p.expires_at>clock_timestamp()
          AND c.coordinator_id=$5::uuid AND c.enabled AND b.enabled
          AND a.workload=$6 AND a.priority='background' AND a.daily_cu>0`,
        [
          id,
          scope,
          unifiedRpcManifestId(profile),
          JSON.stringify(profile),
          profile.coordinatorId,
          workload
        ]
      );
      if (result.rowCount !== 1)
        throw new Error("Unified RPC profile/budget is not approved.");
    },
    async reservePaid(permit, calls) {
      if (!permit || !/^0x[0-9a-f]{64}$/.test(permit))
        throw new Error("Explicit unified RPC replay permit required.");
      const ranges = calls.map(unifiedRpcPaidRange);
      const from = ranges.reduce(
        (value, range) =>
          BigInt(range.fromBlock) < value ? BigInt(range.fromBlock) : value,
        BigInt(ranges[0]!.fromBlock)
      );
      const to = ranges.reduce(
        (value, range) =>
          BigInt(range.toBlock) > value ? BigInt(range.toBlock) : value,
        BigInt(ranges[0]!.toBlock)
      );
      const cu = calls.reduce(
        (value, call) => value + alchemyComputeUnits(call.method),
        0
      );
      await pool.query(
        "SELECT yunipals_market.reserve_unified_rpc_replay($1,$2,$3,$4,$5,$6)",
        [permit, id, chainId, String(from), String(to), cu]
      );
    },
    async inspect(workload, permit) {
      const budget = (
        await pool.query(
          `SELECT b.daily_cu::text,b.foreground_reserve_cu::text,a.daily_cu::text AS allocation_cu,
        coalesce(w.granted_cu,0)::text AS account_granted_cu,coalesce(w.background_granted_cu,0)::text AS background_granted_cu,
        coalesce(aw.granted_cu,0)::text AS allocation_granted_cu
        FROM yunipals_market.rpc_compute_budget b JOIN yunipals_market.rpc_compute_allocation a USING(scope)
        LEFT JOIN yunipals_market.rpc_compute_window w ON w.scope=b.scope AND w.window_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
        LEFT JOIN yunipals_market.rpc_compute_workload_window aw ON aw.scope=a.scope AND aw.workload=a.workload AND aw.window_start=(clock_timestamp() AT TIME ZONE 'UTC')::date
        WHERE b.scope=$1 AND a.workload=$2`,
          [scope, workload]
        )
      ).rows[0];
      if (!budget) throw new Error("Unified RPC allocation is unavailable.");
      let replay: Record<string, unknown> = { mode: "free_only" };
      if (permit !== undefined) {
        if (!/^0x[0-9a-f]{64}$/.test(permit))
          throw new Error("Invalid replay identity.");
        const row = (
          await pool.query(
            `SELECT from_block::text,through_block::text,maximum_cu::text,spent_cu::text,expires_at
          FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1 AND profile_id=$2 AND chain_id=$3
          AND enabled AND expires_at>clock_timestamp() AND spent_cu<maximum_cu`,
            [permit, id, chainId]
          )
        ).rows[0];
        if (!row) throw new Error("Unified replay permit is unavailable.");
        replay = { mode: "bounded_replay", permitId: permit, ...row };
      }
      return { budget, replay };
    }
  };
}
