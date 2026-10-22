import type { PoolClient } from "pg";
import type { Address, Hex } from "viem";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import type {
  ArenaHistoryPage,
  ArenaListStatus,
  ArenaHistoryRole,
  ArenaTournamentSummary,
  ArenaWalletSummary,
  ArenaRewardRecord,
  ArenaRewardsPage,
  ArenaIslandHistory
} from "@protopals/yunipals-market-core/arenaViews";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { ARENA_ISLANDS } from "./catalog";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { NativeArenaReadModels } from "./nativeReadModels";

type Filter = {
  wallet?: Address;
  role?: ArenaHistoryRole;
  status?: ArenaListStatus;
  islandId?: string;
};
type Page = { cursor?: string; limit?: number };
type TournamentRow = {
  id: string;
  state: ArenaTournament;
  submitted: number[];
  video_ready: boolean;
};
const lower = (value: string) => value.toLowerCase();

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,77}$/.test(value) &&
    BigInt(value) < 2n ** 256n
  );
}

/** Bounded browsing reads only confirmed projections; no RPCs or inference. */
export class ArenaReadModels {
  private readonly native?: NativeArenaReadModels;
  constructor(private readonly service: ArenaIntake) {
    this.native = service.nativeSource
      ? new NativeArenaReadModels(service)
      : undefined;
  }
  private cursor(filter: unknown, id: string) {
    return Buffer.from(
      JSON.stringify({
        deployment: this.service.deployment,
        filter: sha256(canonicalJson(filter)),
        id
      })
    ).toString("base64url");
  }
  private boundary(filter: unknown, cursor?: string) {
    if (!cursor) return null;
    try {
      if (cursor.length > 1024) throw new Error();
      const value = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8")
      );
      if (
        value.deployment !== this.service.deployment ||
        value.filter !== sha256(canonicalJson(filter)) ||
        !validId(value.id)
      )
        throw new Error();
      return value.id as string;
    } catch {
      throw new ArenaRequestError(
        400,
        "This history cursor does not match the selected filters."
      );
    }
  }
  private limit(limit?: number) {
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 50)
    )
      throw new ArenaRequestError(400, "Choose a page size from 1 to 50.");
    return limit ?? 24;
  }
  private async snapshot<T>(read: (db: PoolClient) => Promise<T>) {
    const result = await transaction(this.service.pool, async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await this.service.assertSourceSelection(db);
      return read(db);
    });
    await this.service.assertSourceSelection();
    return result;
  }
  private filter(input: Filter) {
    const filter = {
      wallet: input.wallet?.toLowerCase() ?? null,
      role: input.role ?? "any",
      status: input.status ?? "all",
      islandId: input.islandId ?? null
    };
    if (
      !["any", "entrant", "host"].includes(filter.role) ||
      !["all", "active", "completed", "refunded"].includes(filter.status)
    )
      throw new ArenaRequestError(400, "Invalid history filters.");
    if (filter.role !== "any" && !filter.wallet)
      throw new ArenaRequestError(
        400,
        "A wallet is required for this history filter."
      );
    if (filter.islandId && !validId(filter.islandId))
      throw new ArenaRequestError(400, "Invalid island ID.");
    return filter;
  }
  async tournaments(
    input: Filter = {},
    page: Page = {}
  ): Promise<ArenaHistoryPage> {
    if (this.native) return this.native.tournaments(input, page);
    const filter = this.filter(input),
      limit = this.limit(page.limit),
      boundary = this.boundary(filter, page.cursor);
    return this.snapshot(async (db) => {
      const rows = (
        await db.query<TournamentRow>(
          `SELECT t.id::text,t.state,
          ARRAY(SELECT s.seat::int FROM yunipals_arena.submission s WHERE s.deployment=t.deployment AND s.tournament_id=t.id ORDER BY s.seat) AS submitted,
          EXISTS(SELECT 1 FROM yunipals_arena.media_job m WHERE m.deployment=t.deployment AND m.tournament_id=t.id AND m.state='ready') AS video_ready
         FROM yunipals_arena.tournament t WHERE t.deployment=$1
          AND ($2::numeric IS NULL OR t.id<$2)
          AND ($3::text IS NULL OR ($4 IN ('any','entrant') AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') s WHERE s->>'player'=$3))
            OR ($4 IN ('any','host') AND t.state->>'islandBeneficiary'=$3))
          AND ($5='all' OR ($5='active' AND t.state->>'phase' IN ('open','strategies','resolving'))
            OR ($5='completed' AND t.state->>'phase'='settled') OR ($5='refunded' AND t.state->>'phase'='expired'))
          AND ($6::text IS NULL OR t.state->>'islandId'=$6)
         ORDER BY t.id DESC LIMIT $7`,
          [
            this.service.deployment,
            boundary,
            filter.wallet,
            filter.role,
            filter.status,
            filter.islandId,
            limit + 1
          ]
        )
      ).rows;
      const selected = rows.slice(0, limit);
      const snapshots = selected.length
        ? (
            await db.query<{
              tournament_id: string;
              nft_chain_id: number;
              collection: string;
              token_id: string;
              snapshot: { name: string; image: string };
            }>(
              `SELECT tournament_id::text,nft_chain_id,collection,token_id::text,snapshot FROM yunipals_arena.fighter_snapshot
         WHERE deployment=$1 AND tournament_id=ANY($2::numeric[])`,
              [this.service.deployment, selected.map((r) => r.id)]
            )
          ).rows
        : [];
      const indexed = new Map(
        snapshots.map((s) => [
          `${s.tournament_id}/${s.nft_chain_id}/${s.collection}/${s.token_id}`,
          s.snapshot
        ])
      );
      const items: ArenaTournamentSummary[] = selected.map(
        ({ id, state: s, submitted, video_ready }) => ({
          id,
          phase: s.phase,
          deadline: s.deadline,
          islandId: s.islandId,
          islandBeneficiary: s.islandBeneficiary,
          submittedSeats: submitted,
          automaticStrategyMask: s.automaticStrategyMask ?? 0,
          videoReady: video_ready,
          payoutsReleased: !!s.videoHash,
          championSeat: s.winners?.[2] ?? null,
          fighters: s.seats.map((seat) => {
            const image = indexed.get(
              `${id}/${seat.nftChainId}/${lower(seat.collection)}/${seat.tokenId}`
            );
            return {
              seat: seat.seat,
              player: seat.player,
              chainId: seat.nftChainId,
              collection: seat.collection,
              tokenId: seat.tokenId,
              name: image?.name ?? `Yunipal #${seat.tokenId}`,
              image: image?.image ?? null
            };
          })
        })
      );
      return {
        items,
        nextCursor:
          rows.length > limit ? this.cursor(filter, items.at(-1)!.id) : null
      };
    });
  }
  async wallet(wallet: Address): Promise<ArenaWalletSummary> {
    if (this.native) return this.native.wallet(wallet);
    const address = wallet.toLowerCase();
    return this.snapshot(async (db) => {
      const state = (
        await db.query<{ state: ArenaTournament }>(
          `SELECT state FROM yunipals_arena.tournament WHERE deployment=$1
        AND (state->>'islandBeneficiary'=$2 OR state->>'treasury'=$2
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$2))`,
          [this.service.deployment, address]
        )
      ).rows;
      let enteredTournaments = 0,
        enteredSeats = 0,
        hostedTournaments = 0,
        championships = 0;
      let winnings = 0n,
        hosting = 0n,
        operations = 0n,
        refunds = 0n,
        pending = 0n;
      for (const { state: s } of state) {
        const own = s.seats.filter(
          (seat) => lower(seat.player) === address
        ).length;
        enteredSeats += own;
        if (own) enteredTournaments++;
        const host = s.islandBeneficiary?.toLowerCase() === address;
        if (host) hostedTournaments++;
        const winner =
          s.winners && s.seats[s.winners[2]]?.player.toLowerCase() === address;
        const treasury = s.treasury?.toLowerCase() === address;
        if (s.phase === "settled" && winner) championships++;
        if (s.videoHash) {
          if (winner) winnings += 6000000n;
          if (host) hosting += 400000n;
          if (treasury) operations += 1600000n;
        } else if (s.phase === "settled") {
          pending +=
            (winner ? 6000000n : 0n) +
            (host ? 400000n : 0n) +
            (treasury ? 1600000n : 0n);
        }
        if (s.phase === "expired") refunds += BigInt(own) * 2000000n;
      }
      const available =
        (
          await db.query<{ amount: string }>(
            "SELECT amount::text FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
            [this.service.deployment, address]
          )
        ).rows[0]?.amount ?? "0";
      const withdrawals = (
        await db.query<{ amount: string }>(
          `SELECT coalesce(sum((args->>'amount')::numeric),0)::text AS amount
        FROM yunipals_arena.chain_event WHERE deployment=$1 AND event_name='Claimed' AND lower(args->>'player')=$2`,
          [this.service.deployment, address]
        )
      ).rows[0]!.amount;
      const cursor =
        (
          await db.query<{ cursor: string | null }>(
            "SELECT cursor::text FROM yunipals_arena.deployment WHERE id=$1",
            [this.service.deployment]
          )
        ).rows[0]?.cursor ?? null;
      return {
        wallet,
        enteredTournaments,
        enteredSeats,
        hostedTournaments,
        championships,
        entryPayments: String(BigInt(enteredSeats) * 2000000n),
        winnings: String(winnings),
        hostingRewards: String(hosting),
        operationsRewards: String(operations),
        refunds: String(refunds),
        withdrawals,
        available,
        pending: String(pending),
        indexedThroughBlock: cursor
      };
    });
  }
  async island(tokenId: string, page: Page = {}): Promise<ArenaIslandHistory> {
    if (this.native) return this.native.island(tokenId, page);
    if (!validId(tokenId))
      throw new ArenaRequestError(400, "Invalid island ID.");
    const history = await this.tournaments({ islandId: tokenId }, page);
    const totals = await this.snapshot(
      async (db) =>
        (
          await db.query<{
            hosted: string;
            released: string;
            pending: string;
          }>(
            `SELECT count(*)::text AS hosted,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL)*400000)::text AS released,
        (count(*) FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL)*400000)::text AS pending
       FROM yunipals_arena.tournament WHERE deployment=$1 AND state->>'islandId'=$2`,
            [this.service.deployment, tokenId]
          )
        ).rows[0]!
    );
    return {
      ...history,
      chainId: 8453,
      collection: ARENA_ISLANDS,
      tokenId,
      hostedTournaments: Number(totals.hosted),
      releasedRewards: totals.released,
      pendingRewards: totals.pending
    };
  }
  async timeline(id: string) {
    if (this.native) return this.native.timeline(id);
    await this.service.state(id);
    const events = await this.snapshot(
      async (db) =>
        (
          await db.query<{
            event_name: string;
            transaction_hash: Hex;
            block_number: string;
            log_index: number;
          }>(
            `SELECT event_name,transaction_hash,block_number::text,log_index FROM yunipals_arena.chain_event
       WHERE deployment=$1 AND args->>'id'=$2 ORDER BY block_number,log_index LIMIT 100`,
            [this.service.deployment, id]
          )
        ).rows
    );
    return events.map((e) => ({
      event: e.event_name,
      transactionHash: e.transaction_hash,
      blockNumber: e.block_number,
      logIndex: e.log_index
    }));
  }
  async rewards(wallet: Address, page: Page = {}): Promise<ArenaRewardsPage> {
    if (this.native) return this.native.rewards(wallet, page);
    // Read the immutable event ledger. Credits and wallet withdrawals stay distinct;
    // Claimed is aggregate and cannot truthfully be assigned to one tournament.
    const limit = this.limit(page.limit),
      filter = { wallet: lower(wallet), kind: "rewards" };
    const boundary = this.boundary(filter, page.cursor);
    const rows = await this.snapshot(
      async (db) =>
        (
          await db.query<{
            n: string;
            event_name: string;
            args: Record<string, string>;
            transaction_hash: Hex;
            block_number: string;
            log_index: number;
            state: ArenaTournament | null;
          }>(
            `WITH records AS (SELECT (e.block_number::numeric*4294967296+e.log_index+1)::text AS n,e.event_name,e.args,e.transaction_hash,e.block_number::text,e.log_index,t.state
       FROM yunipals_arena.chain_event e LEFT JOIN yunipals_arena.tournament t ON t.deployment=e.deployment AND t.id=(e.args->>'id')::numeric
       WHERE e.deployment=$1 AND e.event_name IN ('PayoutsReleased','TournamentExpired','Claimed')
        AND ((e.event_name='Claimed' AND lower(e.args->>'player')=$2)
          OR (e.event_name<>'Claimed' AND (t.state->>'islandBeneficiary'=$2 OR t.state->>'treasury'=$2
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') s WHERE s->>'player'=$2)))))
       SELECT * FROM records WHERE ($3::numeric IS NULL OR n::numeric<$3) ORDER BY n::numeric DESC LIMIT $4`,
            [this.service.deployment, lower(wallet), boundary, limit + 1]
          )
        ).rows
    );
    const items: ArenaRewardRecord[] = [];
    for (const row of rows.slice(0, limit)) {
      const add = (
        kind: ArenaRewardRecord["kind"],
        amount: string,
        recipient: Address
      ) =>
        items.push({
          id: `${row.transaction_hash}/${row.log_index}/${kind}`,
          kind,
          amount,
          recipient,
          wallet,
          tournamentId: row.state?.id ?? null,
          islandId: row.state?.islandId ?? null,
          transactionHash: row.transaction_hash,
          blockNumber: row.block_number
        });
      if (row.event_name === "Claimed") {
        add("withdrawal", row.args.amount!, row.args.recipient! as Address);
        continue;
      }
      const s = row.state;
      if (!s) continue;
      if (row.event_name === "TournamentExpired") {
        const count = s.seats.filter(
          (seat) => lower(seat.player) === lower(wallet)
        ).length;
        if (count) add("refund", String(BigInt(count) * 2000000n), wallet);
      } else {
        if (
          s.winners &&
          s.seats[s.winners[2]]?.player.toLowerCase() === lower(wallet)
        )
          add("winner", "6000000", wallet);
        if (s.islandBeneficiary?.toLowerCase() === lower(wallet))
          add("host", "400000", wallet);
        if (s.treasury?.toLowerCase() === lower(wallet))
          add("operations", "1600000", wallet);
      }
    }
    return {
      items,
      nextCursor:
        rows.length > limit ? this.cursor(filter, rows[limit - 1]!.n) : null
    };
  }
}
