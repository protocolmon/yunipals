import type { PoolClient } from "pg";
import type { Address, Hex } from "viem";
import type { ArenaTournament } from "@protopals/yunipals-market-core/arena";
import type {
  ArenaHistoryPage,
  ArenaHistoryRole,
  ArenaIslandHistory,
  ArenaListStatus,
  ArenaRewardRecord,
  ArenaRewardsPage,
  ArenaTimelineEvent,
  ArenaTournamentSummary,
  ArenaWalletSummary
} from "@protopals/yunipals-market-core/arenaViews";
import type { ArenaBrowseRequest } from "@protopals/yunipals-indexer-server/arena";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import { ARENA_ISLANDS } from "./catalog";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { parseMediaPublication } from "./mediaPublication";
import { nativeTournamentState, type NativeArenaSource } from "./nativeSource";

type Filter = {
  wallet?: Address;
  role?: ArenaHistoryRole;
  status?: ArenaListStatus;
  islandId?: string;
};
type Page = { cursor?: string; limit?: number };
type Browse = Awaited<ReturnType<NativeArenaSource["browse"]>>;
type Row = Browse["rows"][number] & { state: ArenaTournament };
type Cursor = {
  deployment: string;
  release: string;
  source: string;
  selection: string;
  filter: string;
  id: string;
  anchor: { number: string; hash: string };
};
const address = /^0x[0-9a-f]{40}$/;
const hash = /^0x[0-9a-f]{64}$/;
const decimal = /^(0|[1-9][0-9]*)$/;
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,77}$/.test(value) &&
  BigInt(value) < 2n ** 256n;
const updating = () =>
  new ArenaRequestError(
    503,
    "Arena public history is updating. Please try again."
  );

/** Public chain state comes exclusively from the selected canonical reader.
 * Only private application enrichments are read from the operational database.
 */
export class NativeArenaReadModels {
  constructor(private readonly service: ArenaIntake) {}

  private selection() {
    return canonicalJson(this.service.sourceSelection ?? null);
  }
  private limit(value?: number) {
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 1 || value > 50)
    )
      throw new ArenaRequestError(400, "Choose a page size from 1 to 50.");
    return value ?? 24;
  }
  private filter(input: Filter) {
    const filter = {
      wallet: input.wallet?.toLowerCase() ?? null,
      role: input.role ?? "any",
      status: input.status ?? "all",
      islandId: input.islandId ?? null
    };
    if (
      (filter.wallet !== null && !address.test(filter.wallet)) ||
      !["any", "entrant", "host"].includes(filter.role) ||
      !["all", "active", "completed", "refunded"].includes(filter.status) ||
      (filter.role !== "any" && !filter.wallet) ||
      (filter.islandId !== null && !validId(filter.islandId))
    )
      throw new ArenaRequestError(400, "Invalid history filters.");
    return filter;
  }
  private boundary(filter: unknown, raw?: string): Cursor | null {
    if (!raw) return null;
    try {
      if (raw.length > 2048) throw new Error();
      const value = JSON.parse(
        Buffer.from(raw, "base64url").toString("utf8")
      ) as Cursor;
      if (
        value.deployment !== this.service.deployment ||
        value.filter !== sha256(canonicalJson(filter)) ||
        value.selection !== this.selection() ||
        !hash.test(value.release) ||
        value.source !== `arena:${this.service.deployment}` ||
        !validId(value.id) ||
        !value.anchor ||
        !decimal.test(value.anchor.number) ||
        !hash.test(value.anchor.hash)
      )
        throw new Error();
      return value;
    } catch {
      throw new ArenaRequestError(
        400,
        "This history cursor does not match the selected source and filters."
      );
    }
  }
  private cursor(filter: unknown, id: string, frame: Browse) {
    return Buffer.from(
      JSON.stringify({
        deployment: this.service.deployment,
        release: frame.releaseId,
        source: frame.sourceId,
        selection: this.selection(),
        filter: sha256(canonicalJson(filter)),
        id,
        anchor: frame.cursorAnchor
      } satisfies Cursor)
    ).toString("base64url");
  }
  private fingerprint(frame: Browse) {
    return sha256(
      canonicalJson({
        release: frame.releaseId,
        source: frame.sourceId,
        rows: frame.rows,
        events: frame.events,
        totals: frame.totals,
        island: frame.island,
        amount: frame.amount,
        withdrawals: frame.withdrawals
      })
    );
  }
  private async snapshot<T>(
    request: ArenaBrowseRequest,
    read: (db: PoolClient, frame: Browse) => Promise<T>,
    cursor?: Cursor | null
  ): Promise<T> {
    const source = this.service.nativeSource;
    if (!source?.browse)
      throw new ArenaRequestError(
        503,
        "Arena public history indexing is not ready."
      );
    await this.service.assertSourceSelection();
    const anchored = {
      ...request,
      ...(cursor ? { cursorAnchor: cursor.anchor } : {})
    };
    const first = await source.browse(anchored);
    if (
      first.sourceId !== `arena:${this.service.deployment}` ||
      !hash.test(first.releaseId) ||
      !decimal.test(first.indexedThroughBlock) ||
      (cursor &&
        (first.releaseId !== cursor.release ||
          first.sourceId !== cursor.source))
    )
      throw updating();
    const result = await transaction(this.service.pool, async (db) => {
      await db.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
      );
      await this.service.assertSourceSelection(db);
      const result = await read(db, first);
      const fresh = await source.browse!({
        ...anchored,
        cursorAnchor: first.cursorAnchor
      });
      if (this.fingerprint(first) !== this.fingerprint(fresh)) throw updating();
      await this.service.assertSourceSelection(db);
      return result;
    });
    await this.service.assertSourceSelection();
    return result;
  }
  private rows(frame: Browse): Row[] {
    return frame.rows.map((row) => {
      const state = nativeTournamentState(row.state);
      if (
        !validId(row.id) ||
        state.id !== row.id ||
        !hash.test(row.incarnation)
      )
        throw updating();
      return { ...row, state };
    });
  }
  private async summaries(
    db: PoolClient,
    rows: Row[]
  ): Promise<ArenaTournamentSummary[]> {
    if (!rows.length) return [];
    const parameters = [
      this.service.deployment,
      JSON.stringify(
        rows.map((row) => ({
          ...row,
          frozen_event_id: row.inputFrozen?.id ?? null,
          frozen_block_hash: row.inputFrozen?.blockHash ?? null
        }))
      )
    ];
    const submissions = (
      await db.query<{ id: string; seat: number }>(
        `SELECT n.id,s.seat::int FROM jsonb_to_recordset($2::jsonb) AS n(id text,incarnation text,state jsonb)
       JOIN yunipals_arena.submission s ON s.deployment=$1 AND s.tournament_id=n.id::numeric AND s.incarnation=n.incarnation
       JOIN LATERAL jsonb_array_elements(n.state->'seats') AS roster(value) ON (roster.value->>'seat')::int=s.seat AND roster.value->>'player'=s.wallet
         AND (n.state->>'inputHash' IS NULL OR s.commitment=n.state->'commitments'->>s.seat)
       ORDER BY n.id,s.seat`,
        parameters
      )
    ).rows;
    const snapshots = (
      await db.query<{
        id: string;
        incarnation: string;
        nft_chain_id: number;
        collection: string;
        token_id: string;
        snapshot: {
          chainId: number;
          collection: string;
          tokenId: string;
          name: string;
          image: string;
        };
        snapshot_hash: string;
      }>(
        `SELECT n.id,n.incarnation,s.nft_chain_id,s.collection,s.token_id::text,s.snapshot,s.snapshot_hash
       FROM jsonb_to_recordset($2::jsonb) AS n(id text,incarnation text,state jsonb)
       JOIN yunipals_arena.fighter_snapshot s ON s.deployment=$1 AND s.tournament_id=n.id::numeric AND s.incarnation=n.incarnation
       JOIN LATERAL jsonb_array_elements(n.state->'seats') AS roster(value) ON (roster.value->>'nftChainId')::int=s.nft_chain_id
         AND roster.value->>'collection'=s.collection AND roster.value->>'tokenId'=s.token_id::text`,
        parameters
      )
    ).rows;
    const media = (
      await db.query<{
        id: string;
        incarnation: string;
        manifest: unknown;
        publication_hash: string;
        film_sha256: string;
      }>(
        `SELECT n.id,n.incarnation,p.manifest,m.publication_hash,m.film_sha256
       FROM jsonb_to_recordset($2::jsonb) AS n(id text,incarnation text,state jsonb,frozen_event_id text,frozen_block_hash text)
       JOIN yunipals_arena.media_job m ON m.deployment=$1 AND m.tournament_id=n.id::numeric AND m.incarnation=n.incarnation
       JOIN yunipals_arena.media_publication p ON p.deployment=m.deployment AND p.tournament_id=m.tournament_id AND p.incarnation=m.incarnation AND p.publication_hash=m.publication_hash
       JOIN yunipals_arena.adjudication a ON a.deployment=m.deployment AND a.tournament_id=m.tournament_id AND a.incarnation=m.incarnation
       JOIN yunipals_arena.frozen_input f ON f.deployment=m.deployment AND f.tournament_id=m.tournament_id AND f.incarnation=m.incarnation
       WHERE n.state->>'phase'='settled' AND m.state='ready'
         AND m.input_hash=n.state->>'inputHash' AND m.outcome_hash=n.state->>'resultHash'
         AND a.state='valid' AND a.input_hash=m.input_hash AND a.outcome_hash=m.outcome_hash
         AND f.input_hash=m.input_hash AND f.revealed_at IS NOT NULL
         AND f.revealed_event_id=n.frozen_event_id AND f.revealed_block_hash=n.frozen_block_hash`,
        parameters
      )
    ).rows;
    const imageMap = new Map<string, { name: string; image: string }>();
    for (const row of snapshots) {
      const image = row.snapshot;
      if (
        !image ||
        sha256(canonicalJson(image)) !== row.snapshot_hash ||
        image.chainId !== row.nft_chain_id ||
        image.collection !== row.collection ||
        image.tokenId !== row.token_id ||
        typeof image.name !== "string" ||
        typeof image.image !== "string"
      )
        throw updating();
      imageMap.set(
        `${row.id}/${row.incarnation}/${row.nft_chain_id}/${row.collection}/${row.token_id}`,
        image
      );
    }
    const ready = new Set<string>();
    for (const row of media) {
      const state = rows.find(
        (r) => r.id === row.id && r.incarnation === row.incarnation
      )?.state;
      const publication = parseMediaPublication(
        row.manifest,
        row.publication_hash
      );
      if (
        !state ||
        publication.deployment !== this.service.deployment ||
        publication.tournamentId !== row.id ||
        publication.incarnation !== row.incarnation ||
        publication.inputHash !== state.inputHash ||
        publication.outcomeHash !== state.resultHash ||
        publication.filmSha256 !== row.film_sha256 ||
        (state.videoHash && state.videoHash !== `0x${publication.filmSha256}`)
      )
        throw updating();
      ready.add(`${row.id}/${row.incarnation}`);
    }
    return rows.map(({ id, incarnation, state }) => ({
      id,
      phase: state.phase,
      deadline: state.deadline,
      islandId: state.islandId,
      islandBeneficiary: state.islandBeneficiary,
      submittedSeats: submissions.filter((s) => s.id === id).map((s) => s.seat),
      automaticStrategyMask: state.automaticStrategyMask ?? 0,
      videoReady: ready.has(`${id}/${incarnation}`),
      payoutsReleased: !!state.videoHash,
      championSeat: state.winners?.[2] ?? null,
      fighters: state.seats.map((seat) => {
        const image = imageMap.get(
          `${id}/${incarnation}/${seat.nftChainId}/${seat.collection}/${seat.tokenId}`
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
    }));
  }
  async tournaments(
    input: Filter = {},
    page: Page = {}
  ): Promise<ArenaHistoryPage> {
    const filter = this.filter(input),
      limit = this.limit(page.limit),
      boundary = this.boundary(filter, page.cursor);
    return this.snapshot(
      {
        kind: "tournaments",
        wallet: filter.wallet ?? undefined,
        role: filter.role,
        status: filter.status,
        islandId: filter.islandId ?? undefined,
        before: boundary?.id,
        limit: limit + 1
      },
      async (db, frame) => {
        const rows = this.rows(frame),
          selected = rows.slice(0, limit);
        return {
          items: await this.summaries(db, selected),
          nextCursor:
            rows.length > limit
              ? this.cursor(filter, selected.at(-1)!.id, frame)
              : null
        };
      },
      boundary
    );
  }
  private count(value: string) {
    if (!decimal.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
      throw updating();
    return Number(value);
  }
  private amount(value: string) {
    if (!decimal.test(value)) throw updating();
    return value;
  }
  async wallet(wallet: Address): Promise<ArenaWalletSummary> {
    if (!address.test(wallet.toLowerCase()))
      throw new ArenaRequestError(400, "Invalid wallet.");
    return this.snapshot(
      { kind: "wallet", wallet: wallet.toLowerCase() },
      async (_db, frame) => {
        const t = frame.totals;
        if (!t) throw updating();
        return {
          wallet,
          enteredTournaments: this.count(t.entered_tournaments),
          enteredSeats: this.count(t.entered_seats),
          hostedTournaments: this.count(t.hosted_tournaments),
          championships: this.count(t.championships),
          entryPayments: String(
            BigInt(this.amount(t.entered_seats)) * this.service.economics.entry
          ),
          winnings: this.amount(t.winnings),
          hostingRewards: this.amount(t.hosting),
          operationsRewards: this.amount(t.operations),
          refunds: this.amount(t.refunds),
          withdrawals: this.amount(frame.withdrawals),
          available: this.amount(frame.amount),
          pending: this.amount(t.pending),
          indexedThroughBlock: frame.indexedThroughBlock
        };
      }
    );
  }
  async island(tokenId: string, page: Page = {}): Promise<ArenaIslandHistory> {
    if (!validId(tokenId))
      throw new ArenaRequestError(400, "Invalid island ID.");
    const filter = this.filter({ islandId: tokenId }),
      limit = this.limit(page.limit),
      boundary = this.boundary(filter, page.cursor);
    return this.snapshot(
      {
        kind: "island",
        islandId: tokenId,
        before: boundary?.id,
        limit: limit + 1
      },
      async (db, frame) => {
        if (!frame.island) throw updating();
        const rows = this.rows(frame),
          selected = rows.slice(0, limit);
        return {
          items: await this.summaries(db, selected),
          nextCursor:
            rows.length > limit
              ? this.cursor(filter, selected.at(-1)!.id, frame)
              : null,
          chainId: 8453,
          collection: ARENA_ISLANDS,
          tokenId,
          hostedTournaments: this.count(frame.island.hosted),
          releasedRewards: this.amount(frame.island.released),
          pendingRewards: this.amount(frame.island.pending)
        };
      },
      boundary
    );
  }
  async timeline(id: string): Promise<ArenaTimelineEvent[]> {
    if (!validId(id))
      throw new ArenaRequestError(400, "Invalid tournament ID.");
    return this.snapshot(
      { kind: "timeline", tournamentId: id, limit: 100 },
      async (_db, frame) => {
        if (!frame.events.length)
          throw new ArenaRequestError(404, "Tournament not found.");
        return frame.events.map((event) => ({
          event: event.event_name,
          transactionHash: event.transaction_hash as Hex,
          blockNumber: event.block_number,
          logIndex: event.log_index
        }));
      }
    );
  }
  async rewards(wallet: Address, page: Page = {}): Promise<ArenaRewardsPage> {
    if (!address.test(wallet.toLowerCase()))
      throw new ArenaRequestError(400, "Invalid wallet.");
    const filter = { wallet: wallet.toLowerCase(), kind: "rewards" },
      limit = this.limit(page.limit),
      boundary = this.boundary(filter, page.cursor);
    return this.snapshot(
      {
        kind: "rewards",
        wallet: filter.wallet,
        before: boundary?.id,
        limit: limit + 1
      },
      async (_db, frame) => {
        const items: ArenaRewardRecord[] = [];
        for (const row of frame.events.slice(0, limit)) {
          const state =
            row.state === null ? null : nativeTournamentState(row.state);
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
              tournamentId:
                row.event_name === "Claimed" ? null : (state?.id ?? null),
              islandId:
                row.event_name === "Claimed" ? null : (state?.islandId ?? null),
              transactionHash: row.transaction_hash as Hex,
              blockNumber: row.block_number
            });
          if (row.event_name === "Claimed") {
            if (
              typeof row.args.amount !== "string" ||
              typeof row.args.recipient !== "string" ||
              !address.test(row.args.recipient) ||
              row.args.player !== filter.wallet
            )
              throw updating();
            add(
              "withdrawal",
              this.amount(row.args.amount),
              row.args.recipient as Address
            );
          } else {
            if (!state) throw updating();
            if (row.event_name === "TournamentExpired") {
              if (state.phase !== "expired") throw updating();
              const count = state.seats.filter(
                (s) => s.player === filter.wallet
              ).length;
              if (count)
                add(
                  "refund",
                  String(BigInt(count) * this.service.economics.entry),
                  wallet
                );
            } else if (row.event_name === "PayoutsReleased") {
              if (state.phase !== "settled" || !state.videoHash)
                throw updating();
              if (
                state.winners &&
                state.seats[state.winners[2]]?.player === filter.wallet
              )
                add("winner", this.service.economics.winner.toString(), wallet);
              if (state.islandBeneficiary === filter.wallet)
                add("host", this.service.economics.island.toString(), wallet);
              if (state.treasury === filter.wallet)
                add(
                  "operations",
                  this.service.economics.operations.toString(),
                  wallet
                );
            } else throw updating();
          }
        }
        return {
          items,
          nextCursor:
            frame.events.length > limit
              ? this.cursor(filter, frame.events[limit - 1]!.n, frame)
              : null
        };
      },
      boundary
    );
  }
}
