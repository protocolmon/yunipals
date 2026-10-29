import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { transaction } from "@/db/pool";
import { canonicalJson } from "../draw";
import {
  ANIME_DIRECTOR_ASSET,
  ANIME_DIRECTOR_MODEL,
  ANIME_DIRECTOR_RESERVE,
  animeDirectorRequest,
  applyAnimeProviderDirection,
  type AnimeDirectionInput,
  type AnimeDirectorReceipt
} from "./animeDirection";
import { boundedBody } from "./mediaApi";
import { savedMediaFolder } from "./mediaPaths";
import { NativeArenaProvider } from "./nativeProvider";
import { withArenaSourceLease } from "./sourceSelection";

type Completion = {
  id: string;
  model: string;
  choices?: Array<{
    finish_reason: string;
    message?: { content?: string; tool_calls?: unknown[] };
  }>;
  usage?: Record<string, unknown>;
};
type DirectorTask = {
  request_id: string;
  state: string;
  provider_id: string | null;
  request: {
    input: AnimeDirectionInput;
    body: ReturnType<typeof animeDirectorRequest>;
  };
  response: { provider: Completion; receipt?: AnimeDirectorReceipt } | null;
};
const generationId = (value: unknown): value is string =>
  typeof value === "string" && /^gen-[A-Za-z0-9_-]{1,180}$/.test(value);
function usd(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(Math.ceil(value * 1000000))
  );
}

/** A single durable media task. Lost submissions never authorize a replacement.
 * Retrieval of a saved generation's accounting remains possible after a reorg. */
export class AnimeDirectorApi {
  constructor(
    private readonly pool: Pool,
    private readonly key: string,
    readonly native: NativeArenaProvider,
    private readonly storage: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!key.trim())
      throw new Error("OpenRouter access is required for Claude cut-ins.");
  }
  private async task(id: string, incarnation: string) {
    return (
      await this.pool.query<DirectorTask>(
        "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND kind='media' AND asset=$4",
        [this.native.service.deployment, id, incarnation, ANIME_DIRECTOR_ASSET]
      )
    ).rows[0];
  }
  private bound(
    input: AnimeDirectionInput,
    proof: { inputHash: string; resultHash: string | null }
  ) {
    if (
      `0x${input.tournament.source.inputSha256}` !== proof.inputHash ||
      `0x${input.tournament.source.outcomeSha256}` !== proof.resultHash
    )
      throw new Error(
        "Anime direction does not match the canonical input and outcome."
      );
  }
  async direct(job: string, input: AnimeDirectionInput) {
    const id = input.tournament.source.tournamentId;
    const before = await this.native.check(id, "media");
    this.bound(input, before.proof);
    const incarnation = before.proof.incarnation;
    const folder = await savedMediaFolder(
      this.pool,
      this.storage,
      this.native.service.deployment,
      id,
      incarnation
    );
    if (resolve(job) !== folder)
      throw new Error("Anime director job origin mismatch.");
    const request = { input, body: animeDirectorRequest(input) };
    await transaction(this.pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `arena/spend/${this.native.service.deployment}/${id}`
      ]);
      const old = (
        await db.query<DirectorTask>(
          "SELECT * FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND kind='media' AND asset=$4",
          [
            this.native.service.deployment,
            id,
            incarnation,
            ANIME_DIRECTOR_ASSET
          ]
        )
      ).rows[0];
      if (old) {
        if (canonicalJson(old.request) !== canonicalJson(request))
          throw new Error("Anime director request is already frozen.");
        return;
      }
      const total = (
        await db.query<{ total: string }>(
          "SELECT coalesce(sum(coalesce(actual_microusd,reserved_microusd)),0)::text AS total FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
          [this.native.service.deployment, id, incarnation]
        )
      ).rows[0]!;
      if (BigInt(total.total) + BigInt(ANIME_DIRECTOR_RESERVE) > 1600000n)
        throw new Error("Combined generation budget exhausted.");
      await db.query(
        "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,incarnation,kind,asset,request_id,request,reserved_microusd) VALUES($1,$2,$3,'media',$4,$5,$6,$7)",
        [
          this.native.service.deployment,
          id,
          incarnation,
          ANIME_DIRECTOR_ASSET,
          randomUUID(),
          request,
          ANIME_DIRECTOR_RESERVE
        ]
      );
    });
    const task = await this.step(id, incarnation);
    if (task.state !== "completed" || !task.response?.receipt)
      throw new Error(
        "Claude direction needs recovery; the existing task is retained."
      );
    return {
      choreography: applyAnimeProviderDirection(
        input,
        this.candidate(task.response.provider)
      ),
      receipt: task.response.receipt
    };
  }
  async step(id: string, incarnation: string) {
    return withArenaSourceLease(this.native.service, () =>
      this.stepSelected(id, incarnation)
    );
  }
  private async stepSelected(
    id: string,
    incarnation: string
  ): Promise<DirectorTask> {
    let task = await this.task(id, incarnation);
    if (!task)
      throw new Error("Anime director request must be reserved first.");
    if (["completed", "failed", "incomplete", "cancelled"].includes(task.state))
      return task;
    if (task.state === "reserved") {
      if (
        canonicalJson(task.request.body) !==
        canonicalJson(animeDirectorRequest(task.request.input))
      )
        throw new Error("Saved Claude request differs from its pinned policy.");
      const authorized = await this.native.authorize(id, "media", incarnation);
      this.bound(task.request.input, authorized.proof);
      if (!(await this.native.claim(task.request_id, "media", authorized)))
        return (await this.task(id, incarnation))!;
      let response: Response;
      try {
        response = await this.fetcher(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.key}`,
              "Content-Type": "application/json",
              "X-Client-Request-Id": task.request_id
            },
            body: JSON.stringify(task.request.body),
            redirect: "error",
            signal: AbortSignal.timeout(120000)
          }
        );
        if (!response.ok) throw new Error("Director submission failed.");
        const provider = JSON.parse(
          (await boundedBody(response, 256000)).toString("utf8")
        ) as Completion;
        if (!generationId(provider.id))
          throw new Error("Missing generation ID.");
        await this.pool.query(
          "UPDATE yunipals_arena.provider_task SET state='accounting',provider_id=$2,response=$3,updated_at=now() WHERE request_id=$1 AND state='submitting'",
          [task.request_id, provider.id, { provider }]
        );
      } catch {
        await this.pool.query(
          "UPDATE yunipals_arena.provider_task SET state='uncertain',error_code='director_submission_unconfirmed',updated_at=now() WHERE request_id=$1 AND state='submitting'",
          [task.request_id]
        );
        throw new Error(
          "Claude submission is unconfirmed; automatic replacement is blocked."
        );
      }
      task = (await this.task(id, incarnation))!;
    }
    if (
      task.state !== "accounting" ||
      !task.response ||
      !generationId(task.provider_id)
    )
      throw new Error(
        "Claude task needs reconciliation; no new request was created."
      );
    const provider = task.response.provider;
    if (provider.id !== task.provider_id)
      throw new Error("Saved Claude generation ID changed.");
    let cost = provider.usage?.cost;
    if (!usd(cost)) {
      const response = await this.fetcher(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(task.provider_id)}`,
        {
          headers: { Authorization: `Bearer ${this.key}` },
          redirect: "error",
          signal: AbortSignal.timeout(20000)
        }
      );
      const result = JSON.parse(
        (await boundedBody(response, 64000)).toString("utf8")
      ) as { data?: { id: string; total_cost?: unknown } };
      if (result.data?.id !== task.provider_id || !usd(result.data.total_cost))
        throw new Error(
          "Claude cost is not available yet; the saved generation will be checked again."
        );
      cost = result.data.total_cost;
    }
    if (!usd(cost)) throw new Error("Claude charge is unavailable.");
    const receipt: AnimeDirectorReceipt = {
      provider: "openrouter",
      model: ANIME_DIRECTOR_MODEL,
      requestId: task.request_id,
      generationId: task.provider_id,
      actualCostUsd: cost,
      actualMicrousd: Math.ceil(cost * 1000000),
      usage: provider.usage ?? null
    };
    let valid = true;
    try {
      if (receipt.actualMicrousd > ANIME_DIRECTOR_RESERVE)
        throw new Error("Director charge exceeded its reservation.");
      applyAnimeProviderDirection(task.request.input, this.candidate(provider));
    } catch {
      valid = false;
    }
    await this.pool.query(
      "UPDATE yunipals_arena.provider_task SET state=$2,response=$3,actual_microusd=$4,error_code=$5,updated_at=now() WHERE request_id=$1 AND state='accounting'",
      [
        task.request_id,
        valid ? "completed" : "failed",
        { provider, receipt },
        receipt.actualMicrousd,
        valid ? null : "director_output_invalid"
      ]
    );
    return (await this.task(id, incarnation))!;
  }
  private candidate(response: Completion): unknown {
    const choice = response.choices?.[0];
    if (
      response.model !== ANIME_DIRECTOR_MODEL ||
      response.choices?.length !== 1 ||
      choice?.finish_reason !== "stop" ||
      choice.message?.tool_calls?.length ||
      typeof choice.message?.content !== "string"
    )
      throw new Error("Claude did not return the pinned structured direction.");
    return JSON.parse(choice.message.content);
  }
}

/** Current account credit capped by this key's own remaining allowance. Raw
 * account/key metadata is intentionally never logged or stored. */
export function openRouterCreditMicrousd(account: unknown, key: unknown) {
  const credits = (
    account as {
      data?: { total_credits?: unknown; total_usage?: unknown };
    } | null
  )?.data;
  const allowance = (
    key as {
      data?: {
        limit_remaining?: unknown;
        expires_at?: string | null;
        disabled?: boolean;
      };
    } | null
  )?.data;
  if (
    !usd(credits?.total_credits) ||
    !usd(credits?.total_usage) ||
    !allowance ||
    allowance.disabled ||
    (allowance.expires_at != null &&
      (typeof allowance.expires_at !== "string" ||
        !Number.isFinite(Date.parse(allowance.expires_at)) ||
        Date.parse(allowance.expires_at) <= Date.now())) ||
    (allowance.limit_remaining !== null && !usd(allowance.limit_remaining))
  )
    throw new Error("OpenRouter funding is unavailable.");
  return Math.floor(
    Math.max(
      0,
      Math.min(
        credits.total_credits - credits.total_usage,
        allowance.limit_remaining === null
          ? Infinity
          : (allowance.limit_remaining as number)
      )
    ) * 1000000
  );
}
export async function measureOpenRouterCredit(
  key: string,
  fetcher: typeof fetch = fetch
) {
  if (!key.trim())
    throw new Error("OpenRouter access is required for anime funding checks.");
  const results = await Promise.allSettled(
    ["credits", "key"].map(async (path) => {
      const response = await fetcher(`https://openrouter.ai/api/v1/${path}`, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: "error",
        signal: AbortSignal.timeout(20000)
      });
      return JSON.parse(
        (await boundedBody(response, 64000)).toString("utf8")
      ) as unknown;
    })
  );
  if (results[0]!.status !== "fulfilled" || results[1]!.status !== "fulfilled")
    throw new Error("OpenRouter funding check failed.");
  return openRouterCreditMicrousd(results[0]!.value, results[1]!.value);
}
