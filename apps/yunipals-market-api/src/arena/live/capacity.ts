import type { Pool } from "pg";
import { ArenaIntake, ArenaRequestError } from "./intake";

export type CapacitySnapshot = {
  runwareMicrousd: number;
  openaiBudgetMicrousd: number;
  openaiBudgetExpiresAt: number;
  vrfAvailableWei: string;
  vrfQuoteWei: string;
  vrfMaxWei: string;
  refereeGasWei: string;
  operatorGasWei: string;
  diskFreeBytes: number;
};
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const wei = (value: unknown) =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  BigInt(value) < 2n ** 256n;
type CapacityTournament = {
  id: string;
  phase: string;
  seats: number;
  referee: boolean;
  media: boolean;
  active: boolean;
  mediaReserved?: string;
};

export function runwareCreditMicrousd(payload: unknown, taskUUID: string) {
  const data = (payload as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) throw new Error("Runware balance is unavailable.");
  const row = data.find(
    (r) =>
      typeof r === "object" &&
      r !== null &&
      (r as { taskUUID?: string }).taskUUID === taskUUID
  ) as { balance?: unknown } | undefined;
  const balance = row?.balance;
  // Live account endpoint currently returns numeric USD; the newer documented
  // envelope wraps it in {amount,currency}. Support both without adding credits.
  const usd =
    typeof balance === "number"
      ? balance
      : balance &&
          typeof balance === "object" &&
          (balance as { currency?: unknown }).currency === "USD"
        ? (balance as { amount?: unknown }).amount
        : null;
  if (
    typeof usd !== "number" ||
    !Number.isFinite(usd) ||
    usd < 0 ||
    !Number.isSafeInteger(Math.floor(usd * 1000000))
  )
    throw new Error("Runware balance is unavailable.");
  return Math.floor(usd * 1000000);
}
export function validateCapacity(value: CapacitySnapshot) {
  if (
    !integer(value.runwareMicrousd) ||
    !integer(value.openaiBudgetMicrousd) ||
    !integer(value.openaiBudgetExpiresAt) ||
    !integer(value.diskFreeBytes) ||
    ![
      value.vrfAvailableWei,
      value.vrfQuoteWei,
      value.vrfMaxWei,
      value.refereeGasWei,
      value.operatorGasWei
    ].every(wei)
  )
    throw new Error("Invalid arena funding snapshot.");
  return value;
}

/** Reads cached health only. UI/admission never polls providers or scans the chain.
 * OpenAI's allowance is an explicitly prefunded cumulative operator ceiling,
 * NOT an inferred account balance. Expired allowances close new admission. */
export class ArenaCapacity {
  constructor(
    private readonly pool: Pool,
    private readonly deployment: string,
    private readonly service?: ArenaIntake
  ) {}
  get indexerMode() {
    return this.service?.indexerMode ?? "legacy";
  }
  async save(value: CapacitySnapshot) {
    validateCapacity(value);
    await this.pool.query(
      "INSERT INTO yunipals_arena.capacity(deployment,snapshot,checked_at) VALUES($1,$2,now()) ON CONFLICT(deployment) DO UPDATE SET snapshot=excluded.snapshot,checked_at=excluded.checked_at",
      [this.deployment, value]
    );
  }
  async check(newLobby: boolean) {
    const health = (
      await this.pool.query<{ snapshot: CapacitySnapshot }>(
        "SELECT snapshot FROM yunipals_arena.capacity WHERE deployment=$1 AND checked_at>now()-interval '6 minutes'",
        [this.deployment]
      )
    ).rows[0];
    const unavailable = (reason: string): never => {
      throw new ArenaRequestError(503, reason);
    };
    if (!health)
      return unavailable(
        "New entries are temporarily paused while operating capacity is checked."
      );
    const h = validateCapacity(health.snapshot);
    if (h.openaiBudgetExpiresAt <= Date.now())
      return unavailable(
        "New entries are paused until the referee allowance is renewed."
      );
    if (
      h.diskFreeBytes < 2_000_000_000 ||
      BigInt(h.refereeGasWei) < 100_000_000_000_000n ||
      BigInt(h.operatorGasWei) < 50_000_000_000_000n
    )
      return unavailable(
        "New entries are paused while operating funds or storage are replenished."
      );
    const rows: CapacityTournament[] = this.service?.nativeSource
      ? await this.nativeRows()
      : (
          await this.pool.query<{
            id: string;
            phase: string;
            seats: number;
            referee: boolean;
            media: boolean;
            active: boolean;
          }>(
            `SELECT t.id::text,t.state->>'phase' AS phase,jsonb_array_length(t.state->'seats') AS seats,
       EXISTS(SELECT 1 FROM yunipals_arena.provider_task p WHERE p.deployment=t.deployment AND p.tournament_id=t.id AND kind='referee') AS referee,
       EXISTS(SELECT 1 FROM yunipals_arena.media_job m WHERE m.deployment=t.deployment AND m.tournament_id=t.id AND m.state='ready') AS media,
       (t.state->>'phase' IN ('open','strategies','resolving')) AS active
       FROM yunipals_arena.tournament t WHERE t.deployment=$1`,
            [this.deployment]
          )
        ).rows;
    const active = rows.filter(
      (r) => r.active || (r.phase === "settled" && !r.media)
    );
    if (
      newLobby &&
      (active.length >= 2 ||
        rows.some((r) => r.phase === "open" && r.seats < 4))
    )
      return unavailable(
        "The current tournament must progress before another lobby opens."
      );
    const usage = (
      await this.pool.query<{
        referee_cost: string;
        media_unfinished: string;
        media_reserved: string;
      }>(
        `SELECT coalesce(sum(coalesce(actual_microusd,reserved_microusd)) FILTER(WHERE kind='referee'),0)::text AS referee_cost,
       coalesce(sum(reserved_microusd) FILTER(WHERE kind='media' AND state NOT IN ('completed','failed')),0)::text AS media_unfinished,
       coalesce(sum(reserved_microusd) FILTER(WHERE kind='media'),0)::text AS media_reserved
       FROM yunipals_arena.provider_task WHERE deployment=$1`,
        [this.deployment]
      )
    ).rows[0]!;
    const futureReferees =
      rows.filter((r) => r.active && !r.referee).length + Number(newLobby);
    if (
      BigInt(usage.referee_cost) + BigInt(futureReferees) * 700000n >
      BigInt(h.openaiBudgetMicrousd)
    )
      return unavailable(
        "New entries are paused while referee funds are replenished."
      );
    // Every unsettled or not-yet-published tournament requires up to $0.90 media.
    // Subtract only tasks already issued for those same tournaments, not old films.
    const reserved = this.service?.nativeSource
      ? {
          amount: rows
            .filter((r) => r.active || (r.phase === "settled" && !r.media))
            .reduce(
              (total, row) => total + BigInt(row.mediaReserved ?? "0"),
              0n
            )
            .toString()
        }
      : (
          await this.pool.query<{ amount: string }>(
            `SELECT coalesce(sum(p.reserved_microusd),0)::text AS amount FROM yunipals_arena.provider_task p
       JOIN yunipals_arena.tournament t ON t.deployment=p.deployment AND t.id=p.tournament_id
       WHERE p.deployment=$1 AND p.kind='media' AND t.state->>'phase'<>'expired'
       AND NOT EXISTS(SELECT 1 FROM yunipals_arena.media_job m WHERE m.deployment=p.deployment AND m.tournament_id=p.tournament_id AND m.state='ready')`,
            [this.deployment]
          )
        ).rows[0]!;
    const remainingMedia =
      BigInt(active.length + Number(newLobby)) * 900000n -
      BigInt(reserved.amount);
    if (
      (remainingMedia > 0n ? remainingMedia : 0n) +
        BigInt(usage.media_unfinished) >
      BigInt(h.runwareMicrousd)
    )
      return unavailable(
        "New entries are paused while video funds are replenished."
      );
    const firstEntries =
      rows.filter((r) => r.phase === "open" && r.seats === 0).length +
      Number(newLobby);
    if (
      firstEntries &&
      (BigInt(h.vrfQuoteWei) === 0n ||
        BigInt(h.vrfQuoteWei) > BigInt(h.vrfMaxWei) ||
        BigInt(h.vrfAvailableWei) <
          BigInt(h.vrfQuoteWei) * BigInt(firstEntries))
    )
      return unavailable(
        "New entries are paused while island-draw funds are replenished."
      );
    return { ready: true as const };
  }

  private async nativeRows() {
    const service = this.service!;
    await service.ready();
    const source = service.nativeSource!;
    if (!source.work)
      throw new ArenaRequestError(
        503,
        "Native Arena work coverage is unavailable."
      );
    const work = await source.work();
    if (work.ids.length >= 100)
      throw new ArenaRequestError(
        503,
        "Native Arena work requires reconciliation before admission."
      );
    const rows = [];
    for (const id of work.ids) {
      const context = await service.tournamentContext(id);
      const saved = (
        await this.pool.query<{
          referee: boolean;
          media: boolean;
          reserved: string;
        }>(
          `SELECT EXISTS(SELECT 1 FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND kind='referee') AS referee,
          EXISTS(SELECT 1 FROM yunipals_arena.media_job WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND state='ready') AS media,
          (SELECT coalesce(sum(reserved_microusd),0)::text FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 AND kind='media') AS reserved`,
          [this.deployment, id, context.incarnation]
        )
      ).rows[0]!;
      rows.push({
        id,
        phase: context.state.phase,
        seats: context.state.seats.length,
        referee: saved.referee,
        media: saved.media,
        active: ["open", "strategies", "resolving"].includes(
          context.state.phase
        ),
        mediaReserved: saved.reserved
      });
    }
    return rows;
  }
}
