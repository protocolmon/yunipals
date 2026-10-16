import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";

type ResponseRecord = {
  id: string;
  status: string;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
  usage?: { input_tokens: number; output_tokens: number };
};
type Task = {
  request_id: string;
  provider_id: string | null;
  state: string;
  request: Record<string, unknown>;
  response: ResponseRecord | null;
};

export function refereeRequest(
  instructions: string,
  input: unknown,
  schema: unknown
) {
  const request = {
    model: "gpt-6.1-sol",
    reasoning: { effort: "xhigh" },
    service_tier: "default",
    background: true,
    store: true,
    max_output_tokens: 32000,
    instructions,
    input: canonicalJson(input),
    tools: [],
    text: {
      format: {
        type: "json_schema",
        name: "arena_outcome",
        strict: true,
        schema
      }
    }
  };
  // Conservative byte ceiling keeps even the worst tokenization under short-context pricing.
  // Reserve $0.70 including cache-write pricing; the caller enforces its combined generation cap.
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > 120_000)
    throw new Error("Referee input exceeds the approved request envelope.");
  return request;
}

export class ArenaRefereeApi {
  constructor(
    private readonly pool: Pool,
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!key.trim()) throw new Error("OPENAI_API_KEY is required.");
  }
  async reserve(
    deployment: string,
    id: string,
    request: ReturnType<typeof refereeRequest>,
    budgetMicrousd: number
  ) {
    if (!Number.isSafeInteger(budgetMicrousd) || budgetMicrousd < 700000)
      throw new Error("Insufficient referee budget.");
    await transaction(this.pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `arena/spend/${deployment}/${id}`
      ]);
      const existing = (
        await db.query<Task>(
          "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND kind='referee' AND asset='candidate-1'",
          [deployment, id]
        )
      ).rows[0];
      if (existing) {
        if (canonicalJson(existing.request) !== canonicalJson(request))
          throw new Error("Referee request is already frozen.");
        return;
      }
      const cost = (
        await db.query<{ total: string }>(
          "SELECT coalesce(sum(coalesce(actual_microusd,reserved_microusd)),0)::text AS total FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2",
          [deployment, id]
        )
      ).rows[0]!;
      if (BigInt(cost.total) + 700000n > BigInt(budgetMicrousd))
        throw new Error("Combined generation budget exhausted.");
      await db.query(
        `INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,request,reserved_microusd)
        VALUES($1,$2,'referee','candidate-1',$3,$4,700000)`,
        [deployment, id, randomUUID(), JSON.stringify(request)]
      );
    });
  }
  async step(deployment: string, id: string) {
    const task = (
      await this.pool.query<Task>(
        "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND kind='referee' AND asset='candidate-1'",
        [deployment, id]
      )
    ).rows[0];
    if (!task) throw new Error("Referee request must be reserved first.");
    if (
      ["completed", "failed", "incomplete", "cancelled", "uncertain"].includes(
        task.state
      )
    )
      return task;
    let response: Response;
    if (task.provider_id) {
      if (!/^resp_[A-Za-z0-9_-]+$/.test(task.provider_id))
        throw new Error("Invalid saved OpenAI response ID.");
      response = await this.fetcher(
        `https://api.openai.com/v1/responses/${task.provider_id}`,
        {
          headers: { Authorization: `Bearer ${this.key}` },
          signal: AbortSignal.timeout(30_000)
        }
      );
      if (!response.ok)
        throw new Error(
          "Existing referee response could not be retrieved; no new request was created."
        );
    } else {
      const ready = (
        await this.pool.query(
          `SELECT 1 FROM yunipals_arena.tournament t
        JOIN yunipals_arena.frozen_input f ON f.deployment=t.deployment AND f.tournament_id=t.id
        JOIN yunipals_arena.deployment d ON d.id=t.deployment
        WHERE t.deployment=$1 AND t.id=$2 AND t.state->>'phase'='resolving'
          AND (t.state->>'deadline')::bigint>extract(epoch FROM now())+60
          AND f.revealed_at IS NOT NULL AND f.input_hash=t.state->>'inputHash'
          AND NOT d.halted AND d.finalized_at>now()-interval '3 minutes'`,
          [deployment, id]
        )
      ).rowCount;
      if (!ready)
        throw new Error(
          "Referee submission requires a confirmed, revealed, active input."
        );
      // Only one worker may POST. A crash or timeout after this transition is ambiguous
      // and never authorizes another candidate. Saved response IDs can always be polled.
      const claimed = await this.pool.query(
        "UPDATE yunipals_arena.provider_task SET state='submitting',updated_at=now() WHERE request_id=$1 AND state='reserved' RETURNING request_id",
        [task.request_id]
      );
      if (!claimed.rowCount) return task;
      try {
        response = await this.fetcher("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
            "X-Client-Request-Id": task.request_id
          },
          body: JSON.stringify(task.request),
          signal: AbortSignal.timeout(45_000)
        });
        if (!response.ok)
          throw new Error("Referee submission requires reconciliation.");
      } catch {
        await this.pool.query(
          "UPDATE yunipals_arena.provider_task SET state='uncertain',error_code='submission_unconfirmed',updated_at=now() WHERE request_id=$1",
          [task.request_id]
        );
        throw new Error(
          "Referee submission could not be confirmed. Automatic replacement is blocked."
        );
      }
    }
    let value: ResponseRecord;
    try {
      value = (await response.json()) as ResponseRecord;
      if (
        !/^resp_[A-Za-z0-9_-]+$/.test(value.id) ||
        ![
          "queued",
          "in_progress",
          "completed",
          "failed",
          "incomplete",
          "cancelled"
        ].includes(value.status)
      )
        throw new Error("Invalid referee response.");
      if (task.provider_id && task.provider_id !== value.id)
        throw new Error("Referee response ID changed.");
    } catch {
      if (!task.provider_id)
        await this.pool.query(
          "UPDATE yunipals_arena.provider_task SET state='uncertain',error_code='response_unreadable' WHERE request_id=$1",
          [task.request_id]
        );
      throw new Error(
        "Referee response needs reconciliation; no replacement created."
      );
    }
    // Store token usage and a conservative pricing estimate separately from actual billing.
    // Cache writes can be $2.50/M input; $10/M output. Keep the reservation until billing reconciliation.
    await this.pool.query(
      "UPDATE yunipals_arena.provider_task SET provider_id=$2,state=$3,response=$4,updated_at=now() WHERE request_id=$1 AND state NOT IN ('completed','failed','incomplete','cancelled')",
      [task.request_id, value.id, value.status, JSON.stringify(value)]
    );
    return {
      ...task,
      state: value.status,
      provider_id: value.id,
      response: value
    };
  }
}

export function refereeCandidate(response: ResponseRecord): unknown {
  if (response.status !== "completed")
    throw new Error("Referee has no completed candidate.");
  if (
    response.output?.some(
      (item) => !["reasoning", "message"].includes(item.type)
    )
  )
    throw new Error("Unexpected tool output in referee response.");
  const content =
    response.output
      ?.filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? []) ?? [];
  if (content.some((item) => item.type !== "output_text"))
    throw new Error("Referee refused or returned unsupported content.");
  return JSON.parse(content.map((item) => item.text ?? "").join(""));
}
