import type pg from "pg";

import { transaction } from "@/db/pool";

export const alchemyComputeUnitModel = "alchemy-2026-09-08";

const methodComputeUnits: Readonly<Record<string, number>> = {
  // Alchemy currently prices these methods at zero CU. A paid route reserves
  // one CU; a free route uses the non-consuming policy authorization below.
  eth_chainId: 1,
  eth_protocolVersion: 1,
  eth_syncing: 1,
  net_listening: 1,
  net_peerCount: 1,
  net_version: 1,
  eth_blockNumber: 10,
  eth_feeHistory: 10,
  eth_gasPrice: 20,
  eth_maxPriorityFeePerGas: 10,
  eth_getBalance: 20,
  eth_getBlockByHash: 20,
  eth_getBlockByNumber: 20,
  eth_getCode: 20,
  eth_getStorageAt: 20,
  eth_getTransactionByHash: 20,
  eth_getTransactionCount: 20,
  eth_getTransactionReceipt: 20,
  eth_call: 26,
  eth_estimateGas: 20,
  eth_getLogs: 60
};

// Unknown methods receive a conservative charge and remain visible as "other"
// in transport telemetry. This preserves the hard bound if a dependency adds a
// read before its exact weight is reviewed.
export function alchemyComputeUnits(method: string) {
  return methodComputeUnits[method] ?? 1000;
}

export type RpcComputePriority = "background" | "foreground";

export type RpcComputeBudget = {
  authorizeFreeDispatch(): Promise<void>;
  reserve(method: string): Promise<void>;
  snapshot(): {
    model: string;
    workload: string;
    priority: RpcComputePriority;
    grantedCu: number;
    usedCu: number;
    remainingCu: number;
    denied: number;
  };
};

export class RpcComputeBudgetError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("rpc_budget_exhausted");
  }
}

export function isRpcComputeBudgetError(error: unknown) {
  return rpcComputeBudgetError(error) !== undefined;
}

export function rpcComputeBudgetError(error: unknown) {
  const seen = new Set<object>();
  for (
    let cause = error;
    cause && typeof cause === "object" && seen.size < 8;
    cause = "cause" in cause ? cause.cause : undefined
  ) {
    if (cause instanceof RpcComputeBudgetError) return cause;
    if (seen.has(cause)) break;
    seen.add(cause);
  }
  return undefined;
}

type Policy = {
  enabled: boolean;
  daily_cu: string;
  foreground_reserve_cu: string;
  allocation_cu: string;
  configured_priority: RpcComputePriority;
  window_start: string;
  reset_at: string;
};

type Window = {
  granted_cu: string;
  background_granted_cu: string;
  workload_granted_cu: string;
};

/**
 * Leases small, conservatively charged CU grants from PostgreSQL. A crash may
 * waste the unused tail of a grant, but can never exceed the durable daily cap.
 */
export class PostgresRpcComputeBudget implements RpcComputeBudget {
  private remainingCu = 0;
  private grantedCu = 0;
  private usedCu = 0;
  private denied = 0;
  private acquiring: Promise<void> | undefined;
  private authorizingFree: Promise<void> | undefined;
  private freeAuthorizedUntil = 0;

  constructor(
    private readonly pool: pg.Pool,
    private readonly scope: string,
    private readonly workload: string,
    private readonly priority: RpcComputePriority,
    private readonly grantSizeCu = 1000
  ) {
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(workload) ||
      !["background", "foreground"].includes(priority) ||
      !Number.isSafeInteger(grantSizeCu) ||
      grantSizeCu < 20 ||
      grantSizeCu > 100000
    )
      throw new Error("Invalid RPC compute budget configuration.");
  }

  private async acquire(minimumCu: number) {
    const requestedCu = Math.max(minimumCu, this.grantSizeCu);
    const result = await transaction(this.pool, async (client) => {
      const policy = (
        await client.query<Policy>(
          `SELECT b.enabled,b.daily_cu::text,b.foreground_reserve_cu::text,
          a.daily_cu::text AS allocation_cu,a.priority AS configured_priority,
          (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS window_start,
          floor(extract(epoch FROM ((date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'))*1000)::bigint::text AS reset_at
          FROM yunipals_market.rpc_compute_budget b
          JOIN yunipals_market.rpc_compute_allocation a USING(scope)
          WHERE b.scope=$1 AND a.workload=$2`,
          [this.scope, this.workload]
        )
      ).rows[0];
      if (!policy)
        throw new Error("RPC compute budget is not provisioned for workload.");
      if (policy.configured_priority !== this.priority)
        throw new Error("RPC compute budget priority differs from policy.");
      const now = Date.now();
      const resetAt = Number(policy.reset_at);
      if (!policy.enabled)
        return { granted: 0, retryAfterMs: Math.max(1, resetAt - now) };
      await client.query(
        `INSERT INTO yunipals_market.rpc_compute_window(scope,window_start)
        VALUES($1,$2::date) ON CONFLICT DO NOTHING`,
        [this.scope, policy.window_start]
      );
      await client.query(
        `INSERT INTO yunipals_market.rpc_compute_workload_window(scope,workload,window_start)
        VALUES($1,$2,$3::date) ON CONFLICT DO NOTHING`,
        [this.scope, this.workload, policy.window_start]
      );
      const window = (
        await client.query<Window>(
          `SELECT w.granted_cu::text,w.background_granted_cu::text,
          a.granted_cu::text AS workload_granted_cu
          FROM yunipals_market.rpc_compute_window w
          JOIN yunipals_market.rpc_compute_workload_window a
            USING(scope,window_start)
          WHERE w.scope=$1 AND w.window_start=$3::date AND a.workload=$2
          FOR UPDATE OF w,a`,
          [this.scope, this.workload, policy.window_start]
        )
      ).rows[0]!;
      const daily = Number(policy.daily_cu);
      const reserve = Number(policy.foreground_reserve_cu);
      const allocation = Number(policy.allocation_cu);
      const granted = Number(window.granted_cu);
      const background = Number(window.background_granted_cu);
      const workload = Number(window.workload_granted_cu);
      const globalRemaining =
        this.priority === "foreground"
          ? daily - granted
          : Math.min(daily - reserve - background, daily - granted);
      const available = Math.min(globalRemaining, allocation - workload);
      if (available < minimumCu)
        return { granted: 0, retryAfterMs: Math.max(1, resetAt - now) };
      const amount = Math.min(requestedCu, available);
      await client.query(
        `UPDATE yunipals_market.rpc_compute_window SET
          granted_cu=granted_cu+$3,
          background_granted_cu=background_granted_cu+CASE WHEN $4='background' THEN $3 ELSE 0 END
        WHERE scope=$1 AND window_start=$2::date`,
        [this.scope, policy.window_start, amount, this.priority]
      );
      await client.query(
        `UPDATE yunipals_market.rpc_compute_workload_window
        SET granted_cu=granted_cu+$4
        WHERE scope=$1 AND workload=$2 AND window_start=$3::date`,
        [this.scope, this.workload, policy.window_start, amount]
      );
      await client.query(
        `DELETE FROM yunipals_market.rpc_compute_workload_window
        WHERE window_start<$1::date-31`,
        [policy.window_start]
      );
      await client.query(
        `DELETE FROM yunipals_market.rpc_compute_window
        WHERE window_start<$1::date-31`,
        [policy.window_start]
      );
      return { granted: amount, retryAfterMs: 0 };
    });
    if (!result.granted) {
      this.denied++;
      throw new RpcComputeBudgetError(result.retryAfterMs);
    }
    this.grantedCu += result.granted;
    this.remainingCu += result.granted;
  }

  /**
   * Keep the operator kill switch fail-closed for public RPC traffic without
   * recording free-provider requests as paid Alchemy compute units.
   */
  async authorizeFreeDispatch() {
    if (Date.now() < this.freeAuthorizedUntil) return;
    if (!this.authorizingFree)
      this.authorizingFree = (async () => {
        const policy = (
          await this.pool.query<{
            enabled: boolean;
            configured_priority: RpcComputePriority;
            reset_at: string;
          }>(
            `SELECT b.enabled,a.priority AS configured_priority,
            floor(extract(epoch FROM ((date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'))*1000)::bigint::text AS reset_at
            FROM yunipals_market.rpc_compute_budget b
            JOIN yunipals_market.rpc_compute_allocation a USING(scope)
            WHERE b.scope=$1 AND a.workload=$2`,
            [this.scope, this.workload]
          )
        ).rows[0];
        if (!policy)
          throw new Error(
            "RPC compute budget is not provisioned for workload."
          );
        if (policy.configured_priority !== this.priority)
          throw new Error("RPC compute budget priority differs from policy.");
        if (!policy.enabled) {
          this.denied++;
          throw new RpcComputeBudgetError(
            Math.max(1, Number(policy.reset_at) - Date.now())
          );
        }
        this.freeAuthorizedUntil = Math.min(
          Date.now() + 1000,
          Number(policy.reset_at)
        );
      })().finally(() => {
        this.authorizingFree = undefined;
      });
    await this.authorizingFree;
  }

  async reserve(method: string) {
    const cost = alchemyComputeUnits(method);
    if (cost === 0) return;
    while (this.remainingCu < cost) {
      if (!this.acquiring)
        this.acquiring = this.acquire(cost).finally(() => {
          this.acquiring = undefined;
        });
      await this.acquiring;
    }
    this.remainingCu -= cost;
    this.usedCu += cost;
  }

  snapshot() {
    return {
      model: alchemyComputeUnitModel,
      workload: this.workload,
      priority: this.priority,
      grantedCu: this.grantedCu,
      usedCu: this.usedCu,
      remainingCu: this.remainingCu,
      denied: this.denied
    };
  }
}
