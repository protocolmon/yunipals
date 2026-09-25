import { randomUUID } from "node:crypto";
import pg from "pg";

import { transaction } from "@/db/pool";
import { readOpenSeaBudgetEnvironment } from "@/environment";
import {
  PostgresRpcComputeBudget,
  type RpcComputePriority
} from "@/opensea/rpcComputeBudget";

export type OpenSeaRequestKind = "read" | "fulfillment" | "publication";
export type OpenSeaEndpointClass =
  | "collection_policy"
  | "contract"
  | "listings"
  | "offers"
  | "order_lookup"
  | "fulfillment"
  | "publication"
  | "unknown";
export type OpenSeaBudgetContext = {
  caller:
    | "api"
    | "discovery"
    | "read_worker"
    | "signature"
    | "publication"
    | "probe"
    | "incident"
    | "retired_staging"
    | "test"
    | "legacy";
  workload:
    | "foreground"
    | "discovery"
    | "order_projection"
    | "signature"
    | "publication"
    | "incident"
    | "legacy";
  priority: "background" | "foreground";
};
export type OpenSeaRequestBudget = {
  reserve(
    kind: OpenSeaRequestKind,
    endpointClass?: OpenSeaEndpointClass
  ): Promise<string>;
  observe(
    reservation: string,
    response: { status: number; headers: Headers }
  ): Promise<void>;
  fail?(
    reservation: string,
    outcome: "network_error" | "timeout" | "aborted",
    retryAfterMs?: number
  ): Promise<void>;
};

export type OpenSeaRequestHeadroom = {
  allPerHour: number;
  fulfillmentPerMinute: number;
};

export class OpenSeaBudgetError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("provider_budget_exhausted");
  }
}

type BudgetState = {
  all_per_hour: number;
  fulfillment_per_minute: number;
  publication_per_hour: number;
  enabled: boolean;
  now: string;
  blocked_until: string;
  coordinator_id: string;
};

function headerInteger(raw: string | null) {
  if (!raw || !/^[0-9]{1,13}$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

// One operator-configured account scope in one coordinator database, shared by
// API, workers, collectors and rotated keys. No credentials or order bytes are
// persisted. A reservation is charged even if a process dies before dispatch.
export class PostgresOpenSeaRequestBudget implements OpenSeaRequestBudget {
  constructor(
    private readonly pool: pg.Pool,
    private readonly scope: string,
    private readonly headroom: OpenSeaRequestHeadroom = {
      allPerHour: 0,
      fulfillmentPerMinute: 0
    },
    private readonly context: OpenSeaBudgetContext = {
      caller: "legacy",
      workload: "legacy",
      priority: "foreground"
    },
    private readonly coordinatorId?: string
  ) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope))
      throw new Error("Invalid OpenSea budget scope.");
    if (
      !Number.isSafeInteger(headroom.allPerHour) ||
      headroom.allPerHour < 0 ||
      headroom.allPerHour > 1000000 ||
      !Number.isSafeInteger(headroom.fulfillmentPerMinute) ||
      headroom.fulfillmentPerMinute < 0 ||
      headroom.fulfillmentPerMinute > 100000
    )
      throw new Error("Invalid OpenSea background request headroom.");
    if (
      ![
        "api",
        "discovery",
        "read_worker",
        "signature",
        "publication",
        "probe",
        "incident",
        "retired_staging",
        "test",
        "legacy"
      ].includes(context.caller) ||
      ![
        "foreground",
        "discovery",
        "order_projection",
        "signature",
        "publication",
        "incident",
        "legacy"
      ].includes(context.workload) ||
      !["background", "foreground"].includes(context.priority)
    )
      throw new Error("Invalid OpenSea request budget context.");
    this.headroom = { ...headroom };
    this.context = { ...context };
    if (
      coordinatorId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        coordinatorId
      )
    )
      throw new Error("Invalid OpenSea budget coordinator identity.");
  }

  private async lock(client: pg.PoolClient) {
    const result = await client.query<BudgetState>(
      `
      SELECT b.*, greatest(s.clock_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)::text AS now,
        s.blocked_until::text
      FROM yunipals_market.opensea_request_budget b
      JOIN yunipals_market.opensea_request_budget_state s USING(scope)
      WHERE b.scope=$1 FOR UPDATE OF s`,
      [this.scope]
    );
    const state = result.rows[0];
    if (!state) throw new Error("OpenSea budget is not provisioned.");
    if (
      this.coordinatorId &&
      state.coordinator_id.toLowerCase() !== this.coordinatorId
    )
      throw new Error("OpenSea budget coordinator identity mismatch.");
    await client.query(
      "UPDATE yunipals_market.opensea_request_budget_state SET clock_at=$2 WHERE scope=$1",
      [this.scope, state.now]
    );
    return state;
  }

  async reserve(
    kind: OpenSeaRequestKind,
    endpointClass: OpenSeaEndpointClass = "unknown"
  ) {
    if (!["read", "fulfillment", "publication"].includes(kind))
      throw new Error("Invalid OpenSea request kind.");
    if (
      ![
        "collection_policy",
        "contract",
        "listings",
        "offers",
        "order_lookup",
        "fulfillment",
        "publication",
        "unknown"
      ].includes(endpointClass)
    )
      throw new Error("Invalid OpenSea endpoint class.");
    const result = await transaction(this.pool, async (client) => {
      const state = await this.lock(client);
      const now = Number(state.now);
      if (!state.enabled) {
        await this.rejectedMetric(client, kind, endpointClass, now, 60000);
        return { delay: 60000 };
      }
      let delay = Math.max(0, Number(state.blocked_until) - now);
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_endpoint_window WHERE scope=$1 AND reset_at<=$2",
        [this.scope, now]
      );
      // Version 19 and earlier coordinators write the aggregate table. Keep
      // respecting those rows during a rolling deployment until they expire.
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_window WHERE scope=$1 AND reset_at<=$2",
        [this.scope, now]
      );
      const windows = await client.query<{ until: string | null }>(
        `SELECT max(reset_at)::text AS until FROM (
          SELECT reset_at FROM yunipals_market.opensea_request_endpoint_window
          WHERE scope=$1 AND endpoint_class IN ($2,'unknown') AND remaining<=$3
          UNION ALL
          SELECT reset_at FROM yunipals_market.opensea_request_window
          WHERE scope=$1 AND remaining<=$3
        ) AS active_windows`,
        // Aggregate hourly headroom is enforced by the local rolling counter.
        // Provider windows apply only to their request group; preserve explicit
        // fulfillment headroom without treating a minute bucket as hourly.
        [
          this.scope,
          endpointClass,
          kind === "fulfillment" ? this.headroom.fulfillmentPerMinute : 0
        ]
      );
      delay = Math.max(delay, Number(windows.rows[0]!.until) - now);
      // Bounded retention; uncertain and lost requests remain charged for the
      // full longest window. We never refund HTTP errors, aborts or timeouts.
      await client.query(
        `INSERT INTO yunipals_market.opensea_request_metric_minute
        (scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status,requests,latency_ms,retry_after_ms)
        SELECT scope,to_timestamp(floor(reserved_at::double precision/60000)*60),caller,workload,priority,kind,
          endpoint_class,'lost',0,count(*),sum(greatest(0,$2-reserved_at)),0
        FROM yunipals_market.opensea_request_reservation
        WHERE scope=$1 AND reserved_at<=$2-3600000 AND NOT completed
        GROUP BY scope,to_timestamp(floor(reserved_at::double precision/60000)*60),caller,workload,priority,kind,endpoint_class
        ON CONFLICT(scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status)
        DO UPDATE SET requests=opensea_request_metric_minute.requests+excluded.requests,
          latency_ms=opensea_request_metric_minute.latency_ms+excluded.latency_ms`,
        [this.scope, now]
      );
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_reservation WHERE scope=$1 AND reserved_at<=$2",
        [this.scope, now - 3600000]
      );
      await client.query(
        "DELETE FROM yunipals_market.opensea_request_metric_minute WHERE scope=$1 AND bucket_at<to_timestamp($2::double precision/1000)-interval '90 days'",
        [this.scope, now]
      );
      const counts = await client.query<{
        total: number;
        fulfillment: number;
        publication: number;
        first_all: string | null;
        first_fulfillment: string | null;
        first_publication: string | null;
      }>(
        `
        SELECT count(*)::integer AS total,
          count(*) FILTER(WHERE kind='fulfillment' AND reserved_at>$2)::integer AS fulfillment,
          count(*) FILTER(WHERE kind='publication')::integer AS publication,
          min(reserved_at)::text AS first_all,
          min(reserved_at) FILTER(WHERE kind='fulfillment' AND reserved_at>$2)::text AS first_fulfillment,
          min(reserved_at) FILTER(WHERE kind='publication')::text AS first_publication
        FROM yunipals_market.opensea_request_reservation WHERE scope=$1`,
        [this.scope, now - 60000]
      );
      const row = counts.rows[0]!;
      if (row.total >= state.all_per_hour - this.headroom.allPerHour)
        delay = Math.max(
          delay,
          row.first_all === null ? 60000 : Number(row.first_all) + 3600000 - now
        );
      if (
        kind === "fulfillment" &&
        row.fulfillment >=
          state.fulfillment_per_minute - this.headroom.fulfillmentPerMinute
      )
        delay = Math.max(
          delay,
          row.first_fulfillment === null
            ? 60000
            : Number(row.first_fulfillment) + 60000 - now
        );
      if (
        kind === "publication" &&
        row.publication >= state.publication_per_hour
      )
        delay = Math.max(delay, Number(row.first_publication) + 3600000 - now);
      if (delay > 0) {
        await this.rejectedMetric(client, kind, endpointClass, now, delay);
        return { delay };
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO yunipals_market.opensea_request_reservation
        (id,scope,kind,reserved_at,caller,workload,priority,endpoint_class)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          this.scope,
          kind,
          now,
          this.context.caller,
          this.context.workload,
          this.context.priority,
          endpointClass
        ]
      );
      await client.query(
        `UPDATE yunipals_market.opensea_request_endpoint_window SET remaining=greatest(0,remaining-1)
        WHERE scope=$1 AND endpoint_class IN ($2,'unknown')`,
        [this.scope, endpointClass]
      );
      await client.query(
        `UPDATE yunipals_market.opensea_request_window SET remaining=greatest(0,remaining-1)
        WHERE scope=$1`,
        [this.scope]
      );
      return { id };
    });
    if (!result.id)
      throw new OpenSeaBudgetError(Math.max(1, result.delay ?? 60000));
    return result.id;
  }

  async observe(
    reservation: string,
    response: { status: number; headers: Headers }
  ) {
    await transaction(this.pool, async (client) => {
      const state = await this.lock(client);
      const now = Number(state.now);
      const recorded = await client.query<{
        reserved_at: string;
        kind: OpenSeaRequestKind;
        caller: OpenSeaBudgetContext["caller"];
        workload: OpenSeaBudgetContext["workload"];
        priority: OpenSeaBudgetContext["priority"];
        endpoint_class: OpenSeaEndpointClass;
      }>(
        `UPDATE yunipals_market.opensea_request_reservation
        SET completed=true,response_status=$3,outcome=$4,completed_at=$5
        WHERE scope=$1 AND id=$2 AND NOT completed
        RETURNING reserved_at::text,kind,caller,workload,priority,endpoint_class`,
        [
          this.scope,
          reservation,
          response.status,
          response.status < 400 ? "completed" : "provider_error",
          now
        ]
      );
      // Duplicate/late callbacks cannot refill a bucket or shorten a backoff.
      if (!recorded.rowCount) return;
      let blocked = Number(state.blocked_until);
      const rawReset = headerInteger(response.headers.get("x-ratelimit-reset"));
      const reportedReset =
        rawReset !== undefined && Number.isSafeInteger(rawReset * 1000)
          ? rawReset
          : undefined;
      const reportedRemaining = headerInteger(
        response.headers.get("x-ratelimit-remaining")
      );
      const reportedLimit = headerInteger(
        response.headers.get("x-ratelimit-limit")
      );
      const request = recorded.rows[0]!;
      if (
        reportedReset !== undefined &&
        reportedReset * 1000 > now &&
        reportedRemaining !== undefined &&
        reportedRemaining <= 2147483647
      ) {
        const pending = await client.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM yunipals_market.opensea_request_reservation
          WHERE scope=$1 AND endpoint_class=$4 AND id<>$2 AND (NOT completed OR reserved_at>=$3)`,
          [this.scope, reservation, request.reserved_at, request.endpoint_class]
        );
        const allowance = Math.max(
          0,
          Math.min(reportedRemaining, reportedLimit ?? reportedRemaining) -
            pending.rows[0]!.count
        );
        // The response came from this request group. A late/duplicate response
        // can never increase an existing allowance for that group/reset.
        await client.query(
          `INSERT INTO yunipals_market.opensea_request_endpoint_window(scope,endpoint_class,reset_at,remaining) VALUES($1,$2,$3,$4)
          ON CONFLICT(scope,endpoint_class,reset_at) DO UPDATE SET remaining=least(opensea_request_endpoint_window.remaining,excluded.remaining)`,
          [this.scope, request.endpoint_class, reportedReset * 1000, allowance]
        );
      }
      if (response.status === 429) {
        const raw = response.headers.get("retry-after");
        const seconds = headerInteger(raw);
        const retryAt =
          seconds !== undefined
            ? now + seconds * 1000
            : raw
              ? Date.parse(raw)
              : NaN;
        blocked = Math.max(
          blocked,
          now + 1000,
          Number.isSafeInteger(retryAt) ? retryAt : now + 60000,
          reportedReset !== undefined ? reportedReset * 1000 : 0
        );
      }
      await client.query(
        `UPDATE yunipals_market.opensea_request_budget_state
        SET blocked_until=$2 WHERE scope=$1`,
        [this.scope, blocked]
      );
      await this.metric(
        client,
        request,
        now,
        response.status < 400 ? "completed" : "provider_error",
        response.status,
        Math.max(0, blocked - now)
      );
    });
  }

  private async metric(
    client: pg.PoolClient,
    request: {
      reserved_at: string;
      kind: OpenSeaRequestKind;
      caller: OpenSeaBudgetContext["caller"];
      workload: OpenSeaBudgetContext["workload"];
      priority: OpenSeaBudgetContext["priority"];
      endpoint_class: OpenSeaEndpointClass;
    },
    now: number,
    outcome:
      | "completed"
      | "provider_error"
      | "network_error"
      | "timeout"
      | "aborted"
      | "lost",
    responseStatus: number,
    retryAfterMs: number
  ) {
    await client.query(
      `INSERT INTO yunipals_market.opensea_request_metric_minute
      (scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status,requests,latency_ms,retry_after_ms)
      VALUES($1,to_timestamp(floor($2::double precision/60000)*60),$3,$4,$5,$6,$7,$8,$9,1,$10,$11)
      ON CONFLICT(scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status)
      DO UPDATE SET requests=opensea_request_metric_minute.requests+1,
        latency_ms=opensea_request_metric_minute.latency_ms+excluded.latency_ms,
        retry_after_ms=greatest(opensea_request_metric_minute.retry_after_ms,excluded.retry_after_ms)`,
      [
        this.scope,
        now,
        request.caller,
        request.workload,
        request.priority,
        request.kind,
        request.endpoint_class,
        outcome,
        responseStatus,
        Math.max(0, now - Number(request.reserved_at)),
        retryAfterMs
      ]
    );
  }

  private async rejectedMetric(
    client: pg.PoolClient,
    kind: OpenSeaRequestKind,
    endpointClass: OpenSeaEndpointClass,
    now: number,
    retryAfterMs: number
  ) {
    await client.query(
      `INSERT INTO yunipals_market.opensea_request_metric_minute
      (scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status,requests,latency_ms,retry_after_ms)
      VALUES($1,to_timestamp(floor($2::double precision/60000)*60),$3,$4,$5,$6,$7,'local_quota',0,1,0,$8)
      ON CONFLICT(scope,bucket_at,caller,workload,priority,kind,endpoint_class,outcome,response_status)
      DO UPDATE SET requests=opensea_request_metric_minute.requests+1,
        retry_after_ms=greatest(opensea_request_metric_minute.retry_after_ms,excluded.retry_after_ms)`,
      [
        this.scope,
        now,
        this.context.caller,
        this.context.workload,
        this.context.priority,
        kind,
        endpointClass,
        Math.min(86400000, Math.max(1, Math.ceil(retryAfterMs)))
      ]
    );
  }

  async fail(
    reservation: string,
    outcome: "network_error" | "timeout" | "aborted",
    retryAfterMs = 0
  ) {
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)
      throw new Error("Invalid OpenSea request retry delay.");
    await transaction(this.pool, async (client) => {
      const state = await this.lock(client);
      const now = Number(state.now);
      const recorded = await client.query<{
        reserved_at: string;
        kind: OpenSeaRequestKind;
        caller: OpenSeaBudgetContext["caller"];
        workload: OpenSeaBudgetContext["workload"];
        priority: OpenSeaBudgetContext["priority"];
        endpoint_class: OpenSeaEndpointClass;
      }>(
        `UPDATE yunipals_market.opensea_request_reservation
        SET completed=true,outcome=$3,completed_at=$4,retry_after_ms=$5
        WHERE scope=$1 AND id=$2 AND NOT completed
        RETURNING reserved_at::text,kind,caller,workload,priority,endpoint_class`,
        [
          this.scope,
          reservation,
          outcome,
          now,
          Math.min(retryAfterMs, 86400000)
        ]
      );
      if (!recorded.rowCount) return;
      await this.metric(
        client,
        recorded.rows[0]!,
        now,
        outcome,
        0,
        retryAfterMs
      );
    });
  }
}

export function createOpenSeaRequestBudget(
  input: NodeJS.ProcessEnv = process.env
) {
  const { databaseUrl, scope, coordinatorId } =
    readOpenSeaBudgetEnvironment(input);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    application_name: "yunipals_opensea_budget",
    max: 2,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1500,
    lock_timeout: 1000,
    idle_in_transaction_session_timeout: 3000
  });
  pool.on("error", () =>
    console.error("OpenSea budget database connection failed.")
  );
  try {
    return {
      pool,
      scope,
      budget: new PostgresOpenSeaRequestBudget(
        pool,
        scope,
        undefined,
        undefined,
        coordinatorId
      ),
      budgetFor: (context: OpenSeaBudgetContext) =>
        new PostgresOpenSeaRequestBudget(
          pool,
          scope,
          undefined,
          context,
          coordinatorId
        ),
      backgroundBudget: (
        headroom: OpenSeaRequestHeadroom,
        context: OpenSeaBudgetContext = {
          caller: "legacy",
          workload: "legacy",
          priority: "background"
        }
      ) =>
        new PostgresOpenSeaRequestBudget(
          pool,
          scope,
          headroom,
          context,
          coordinatorId
        ),
      rpcBudget: (workload: string, priority: RpcComputePriority) =>
        new PostgresRpcComputeBudget(pool, scope, workload, priority),
      close: () => pool.end()
    };
  } catch (error) {
    void pool.end();
    throw error;
  }
}
