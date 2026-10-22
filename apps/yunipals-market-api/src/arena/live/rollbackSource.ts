import type { Pool, PoolClient } from "pg";
import type { PublicClient } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import type { ArenaEventEvidence } from "@protopals/yunipals-indexer-server/arena";
import {
  nativeTournamentState,
  type NativeArenaObservation,
  type NativeArenaSource
} from "./nativeSource";
import { canonicalJson } from "../draw";

const hash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
type Event = {
  block_number: string;
  block_hash: string;
  transaction_hash: string;
  log_index: number;
  event_name: string;
  args: Record<string, unknown>;
};
type Frame = {
  cursor: string;
  cursor_hash: string;
  finalized_at: Date;
  start_block: string;
  contract: string;
  indexer_mode: string;
  halted: boolean;
};
export type RollbackFloor = { block: string; hash: string };
export function arenaRollbackSourceId(
  url: string,
  contract: string,
  start: bigint
) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Arena rollback requires PostgreSQL.");
  // No password, username or connection query parameters in the review identity.
  return manifestDigest({
    kind: "arena-legacy-rollback-v1",
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname,
    deployment: `8453:${contract.toLowerCase()}`,
    startBlock: String(start),
    abiHash: manifestDigest(arenaAbi)
  });
}

/** Rollback changes the public source, never private identities or worker
 * semantics. Only an isolated old projection is read. Its cursor means complete
 * indexed coverage; this adapter deliberately does not call it Ethereum finality.
 */
export class ArenaRollbackSource
  implements
    Pick<NativeArenaSource, "read" | "list" | "work" | "credit" | "transaction">
{
  readonly deployment: string;
  constructor(
    readonly pool: Pool,
    readonly releaseId: string,
    readonly contract: string,
    readonly startBlock: bigint,
    readonly floor: RollbackFloor,
    private readonly client: Pick<PublicClient, "getBlock" | "getChainId">
  ) {
    if (
      !hash(releaseId) ||
      !/^0x[0-9a-f]{40}$/.test(contract) ||
      startBlock < 0n ||
      !decimal(floor.block) ||
      !hash(floor.hash) ||
      BigInt(floor.block) < startBlock
    )
      throw new Error("Invalid Arena rollback source/floor.");
    this.deployment = `8453:${contract}`;
  }
  private async snapshot<T>(
    read: (db: PoolClient, frame: Frame) => Promise<T>
  ) {
    const db = await this.pool.connect();
    let frame: Frame;
    let result: T;
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      frame = (
        await db.query<Frame>(
          "SELECT cursor::text,cursor_hash,finalized_at,start_block::text,contract,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",
          [this.deployment]
        )
      ).rows[0]!;
      if (
        !frame ||
        frame.halted ||
        frame.indexer_mode !== "legacy" ||
        frame.contract !== this.contract ||
        frame.start_block !== String(this.startBlock) ||
        !decimal(frame.cursor) ||
        !hash(frame.cursor_hash) ||
        !frame.finalized_at ||
        Math.abs(Date.now() - frame.finalized_at.getTime()) > 180000 ||
        BigInt(frame.cursor) < BigInt(this.floor.block)
      )
        throw new Error(
          "Arena rollback source is stale, halted or below its accepted floor."
        );
      result = await read(db, frame);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    if ((await this.client.getChainId()) !== 8453)
      throw new Error("Arena rollback source requires Base.");
    const [head, boundary, floor] = await Promise.all([
      this.client.getBlock({ blockTag: "latest" }),
      this.client.getBlock({ blockNumber: BigInt(frame.cursor) }),
      this.client.getBlock({ blockNumber: BigInt(this.floor.block) })
    ]);
    if (
      !head.hash ||
      Math.abs(Date.now() - Number(head.timestamp) * 1000) > 120000 ||
      head.number < BigInt(frame.cursor) ||
      boundary.hash !== frame.cursor_hash ||
      floor.hash !== this.floor.hash ||
      (await this.client.getBlock({ blockNumber: head.number })).hash !==
        head.hash
    )
      throw new Error("Arena rollback coverage is not currently canonical.");
    return result;
  }
  private coverage(frame: Frame) {
    return {
      releaseId: this.releaseId,
      sourceId: `arena:${this.deployment}`,
      indexedThroughBlock: frame.cursor,
      observedThroughBlock: frame.cursor
    };
  }
  private evidence(event: Event, frame: Frame): ArenaEventEvidence {
    if (
      !decimal(event.block_number) ||
      BigInt(event.block_number) < this.startBlock ||
      BigInt(event.block_number) > BigInt(frame.cursor) ||
      !hash(event.block_hash) ||
      !hash(event.transaction_hash) ||
      !Number.isSafeInteger(event.log_index) ||
      event.log_index < 0 ||
      !arenaAbi.some(
        (entry) => entry.type === "event" && entry.name === event.event_name
      ) ||
      !event.args ||
      typeof event.args !== "object" ||
      Array.isArray(event.args)
    )
      throw new Error("Arena rollback event evidence is incomplete.");
    return {
      id: `${this.deployment}:${event.transaction_hash}:${event.log_index}`,
      blockNumber: event.block_number,
      blockHash: event.block_hash,
      transactionHash: event.transaction_hash,
      logIndex: event.log_index
    };
  }
  private async tournament(db: PoolClient, frame: Frame, id: string) {
    const row = (
      await db.query<{ state: unknown }>(
        "SELECT state FROM yunipals_arena.tournament WHERE deployment=$1 AND id=$2",
        [this.deployment, id]
      )
    ).rows[0];
    if (!row) return null;
    const state = nativeTournamentState(row.state);
    const events = (
      await db.query<Event>(
        `SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
      FROM yunipals_arena.chain_event WHERE deployment=$1 AND args->>'id'=$2
      ORDER BY block_number,log_index LIMIT 257`,
        [this.deployment, id]
      )
    ).rows;
    if (
      state.id !== id ||
      !events.length ||
      events.length > 256 ||
      events[0]!.event_name !== "TournamentOpened" ||
      events.filter((e) => e.event_name === "TournamentOpened").length !== 1 ||
      events[0]!.args.rulesHash !== state.rulesHash ||
      events[0]!.args.poolHash !== state.poolHash
    )
      throw new Error("Arena rollback opening/public state is incomplete.");
    const proofs = events.map((event) => this.evidence(event, frame));
    const opened = proofs[0]!,
      last = proofs.at(-1)!;
    let freezeIndex = -1;
    for (let index = events.length - 1; index >= 0; index--)
      if (events[index]!.event_name === "InputFrozen") {
        freezeIndex = index;
        break;
      }
    const freeze = freezeIndex < 0 ? null : events[freezeIndex]!;
    if (
      state.inputHash
        ? !freeze ||
          freeze.args.inputHash !== state.inputHash ||
          canonicalJson(freeze.args.strategyCommitments) !==
            canonicalJson(state.commitments)
        : freeze !== null
    )
      throw new Error("Arena rollback frozen input differs from public state.");
    return {
      deployment: this.deployment,
      id,
      state,
      incarnation: manifestDigest({
        deployment: this.deployment,
        tournamentId: id,
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      }),
      opened,
      last,
      inputFrozen: freezeIndex < 0 ? null : proofs[freezeIndex]!
    };
  }
  async read(
    id: string,
    options: Parameters<NativeArenaSource["read"]>[1] = {}
  ): Promise<NativeArenaObservation> {
    if (
      !decimal(id) ||
      BigInt(id) >= 2n ** 256n ||
      (options.requiredThroughBlock !== undefined &&
        options.requiredThroughBlock < 0n) ||
      (options.expectedIncarnation !== undefined &&
        !hash(options.expectedIncarnation))
    )
      throw new Error("Invalid rollback tournament selector.");
    return this.snapshot(async (db, frame) => {
      if (
        options.requiredThroughBlock !== undefined &&
        BigInt(frame.cursor) < options.requiredThroughBlock
      )
        throw new Error(
          "Arena rollback source has not indexed the required block."
        );
      const tournament = await this.tournament(db, frame, id);
      if (
        options.expectedIncarnation &&
        tournament?.incarnation !== options.expectedIncarnation
      )
        throw new Error("Arena rollback tournament opening changed.");
      return { ...this.coverage(frame), tournament };
    });
  }
  private ids(wallet?: string, work = false) {
    if (wallet && !/^0x[0-9a-f]{40}$/.test(wallet))
      throw new Error("Invalid Arena wallet.");
    return this.snapshot(async (db, frame) => {
      const rows = (
        await db.query<{ id: string }>(
          `SELECT id::text FROM yunipals_arena.tournament WHERE deployment=$1
        ${work ? "AND (state->>'phase' IN('open','strategies','resolving') OR (state->>'phase'='settled' AND state->>'videoHash' IS NULL))" : ""}
        ${wallet ? "AND (state->>'islandBeneficiary'=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$2))" : ""}
        ORDER BY id ${work ? "ASC LIMIT 100" : "DESC LIMIT 30"}`,
          [this.deployment, ...(wallet ? [wallet] : [])]
        )
      ).rows;
      return { ...this.coverage(frame), ids: rows.map((row) => row.id) };
    });
  }
  list(wallet?: string) {
    return this.ids(wallet?.toLowerCase());
  }
  work() {
    return this.ids(undefined, true);
  }
  async credit(wallet: string): ReturnType<NativeArenaSource["credit"]> {
    wallet = wallet.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet))
      throw new Error("Invalid Arena wallet.");
    return this.snapshot(async (db, frame) => {
      const amount =
        (
          await db.query<{ amount: string }>(
            "SELECT amount::text FROM yunipals_arena.credit WHERE deployment=$1 AND wallet=$2",
            [this.deployment, wallet]
          )
        ).rows[0]?.amount ?? "0";
      if (!decimal(amount) || BigInt(amount) >= 2n ** 256n)
        throw new Error("Invalid rollback credit.");
      const row = (
        await db.query<Event>(
          `SELECT e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,e.event_name,e.args
        FROM yunipals_arena.chain_event e LEFT JOIN yunipals_arena.tournament t
        ON t.deployment=e.deployment AND t.id::text=e.args->>'id'
        WHERE e.deployment=$1 AND ((e.event_name='Claimed' AND e.args->>'player'=$2)
        OR (e.event_name='TournamentExpired' AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') seat WHERE seat->>'player'=$2))
        OR (e.event_name='PayoutsReleased' AND (t.state->>'treasury'=$2 OR t.state->>'islandBeneficiary'=$2
        OR t.state->'seats'->((t.state->'winners'->>2)::integer)->>'player'=$2)))
        ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1`,
          [this.deployment, wallet]
        )
      ).rows[0];
      if (!row && amount !== "0")
        throw new Error("Rollback credit has no event proof.");
      return {
        ...this.coverage(frame),
        amount,
        last: row ? this.evidence(row, frame) : null
      };
    });
  }
  async transaction(
    transactionHash: string,
    options: Parameters<NativeArenaSource["transaction"]>[1] = {}
  ): ReturnType<NativeArenaSource["transaction"]> {
    transactionHash = transactionHash.toLowerCase();
    if (
      !hash(transactionHash) ||
      (options.tournamentId !== undefined && !decimal(options.tournamentId)) ||
      (options.blockNumber === undefined) !==
        (options.blockHash === undefined) ||
      (options.blockNumber !== undefined && options.blockNumber < 0n) ||
      (options.blockHash !== undefined && !hash(options.blockHash))
    )
      throw new Error("Invalid rollback transaction selector.");
    return this.snapshot(async (db, frame) => {
      const empty = {
        ...this.coverage(frame),
        finalizedThroughBlock: null,
        events: [] as Array<
          ArenaEventEvidence & { name: string; args: Record<string, unknown> }
        >,
        origin: null as {
          incarnation: string;
          opened: ArenaEventEvidence;
        } | null
      };
      if (
        options.blockNumber !== undefined &&
        options.blockNumber > BigInt(frame.cursor)
      )
        return { ...empty, inclusion: "not_indexed" as const };
      const rows = (
        await db.query<Event>(
          `SELECT block_number::text,block_hash,transaction_hash,log_index,event_name,args
        FROM yunipals_arena.chain_event WHERE deployment=$1 AND transaction_hash=$2 ORDER BY log_index LIMIT 257`,
          [this.deployment, transactionHash]
        )
      ).rows;
      if (rows.length > 256)
        throw new Error("Rollback transaction event limit exceeded.");
      const events = rows.map((row) => ({
        ...this.evidence(row, frame),
        name: row.event_name,
        args: row.args
      }));
      let inclusion: "canonical" | "changed" | null = null;
      if (options.blockNumber !== undefined) {
        const block = await this.client.getBlock({
          blockNumber: options.blockNumber
        });
        inclusion = block.hash === options.blockHash ? "canonical" : "changed";
        if (
          events.some(
            (event) =>
              event.blockNumber !== String(options.blockNumber) ||
              event.blockHash !== options.blockHash
          )
        )
          inclusion = "changed";
      }
      const tournament = options.tournamentId
        ? await this.tournament(db, frame, options.tournamentId)
        : null;
      if (
        tournament &&
        events.some(
          (event) =>
            String(event.args.id) === options.tournamentId &&
            (BigInt(event.blockNumber) <
              BigInt(tournament.opened.blockNumber) ||
              (event.blockNumber === tournament.opened.blockNumber &&
                event.logIndex < tournament.opened.logIndex))
        )
      )
        throw new Error("Rollback transaction predates the current opening.");
      return {
        ...empty,
        events,
        inclusion,
        origin: tournament
          ? { incarnation: tournament.incarnation, opened: tournament.opened }
          : null
      };
    });
  }
}
