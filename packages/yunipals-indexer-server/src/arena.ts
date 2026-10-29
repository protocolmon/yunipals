import { arenaEconomics } from "../../yunipals-market-core/src/anime.js";
import type { SourceDefinition } from "../../yunipals-indexer-client/src/sources.js";
import type { PoolClient } from "pg";
import type { IndexerReader, SourceStatus } from "./readers.js";
import { readBoundRuntime } from "./releases.js";
import { sqlIdentifier } from "./database.js";
import { manifestDigest } from "./identity.js";
import { CanonicalSourceUnavailable } from "./paging.js";

export type ArenaReadDefinition = {
  mediaKind?: "video" | "anime";
  contract: string;
  startBlock: string;
  abiHash: string;
};
export type ArenaEventEvidence = {
  id: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
};
type NativeRow = {
  state: unknown;
  opened_event_id: string;
  opened_block_hash: string;
  last_event_id: string;
  block_number: string;
  block_hash: string;
};
const decimal = /^(0|[1-9][0-9]*)$/;
const hash = /^0x[0-9a-f]{64}$/;
function sourceOf(reader: IndexerReader, definition: ArenaReadDefinition) {
  if (
    !/^0x[0-9a-f]{40}$/.test(definition.contract) ||
    /^0x0{40}$/.test(definition.contract) ||
    !decimal.test(definition.startBlock) ||
    !hash.test(definition.abiHash)
  )
    throw new Error("Invalid Arena read deployment.");
  const source = reader.release.manifest.sources.find(
    (source) => source.id === `arena:8453:${definition.contract}`
  );
  if (
    !source?.enabled ||
    source.feature !== "arena" ||
    source.chainId !== 8453 ||
    source.address !== definition.contract ||
    source.startBlock !== definition.startBlock ||
    source.abiHash !== definition.abiHash
  )
    throw new Error(
      "Arena read deployment differs from the registered source."
    );
  return source;
}
function available(status: SourceStatus) {
  if (
    !["ready", "catching_up"].includes(status.readiness.reason) ||
    !status.anchor
  )
    throw new CanonicalSourceUnavailable(
      `Arena source unavailable: ${status.readiness.reason}.`
    );
}
type EventRow = {
  id: string;
  source_id: string;
  chain_id: number;
  address: string;
  abi_hash: string;
  name: string;
  args: string;
  block_number: string;
  block_hash: string;
  transaction_hash: string;
  log_index: number;
};
function eventArgs(row: EventRow): Record<string, unknown> {
  try {
    const args: unknown = JSON.parse(row.args);
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error();
    return args as Record<string, unknown>;
  } catch {
    throw new CanonicalSourceUnavailable("Arena event payload is invalid.");
  }
}
function evidence(
  row: EventRow | undefined,
  source: SourceDefinition,
  tournamentId?: string
): ArenaEventEvidence {
  if (
    !row ||
    row.source_id !== source.id ||
    row.chain_id !== 8453 ||
    row.address !== source.address ||
    row.abi_hash !== source.abiHash ||
    !source.events.includes(row.name) ||
    !decimal.test(row.block_number) ||
    !hash.test(row.block_hash) ||
    !hash.test(row.transaction_hash) ||
    !Number.isSafeInteger(row.log_index) ||
    row.log_index < 0 ||
    row.id !== `8453:${source.address}:${row.transaction_hash}:${row.log_index}`
  )
    throw new CanonicalSourceUnavailable("Arena event evidence is incomplete.");
  const args = eventArgs(row);
  if (
    !args ||
    typeof args !== "object" ||
    (tournamentId !== undefined &&
      (!("id" in args) || String(args.id) !== tournamentId))
  )
    throw new CanonicalSourceUnavailable(
      "Arena event belongs to another tournament."
    );
  return {
    id: row.id,
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    transactionHash: row.transaction_hash,
    logIndex: row.log_index
  };
}

async function frame(
  db: PoolClient,
  reader: IndexerReader,
  status: SourceStatus,
  source: SourceDefinition
) {
  available(status);
  const runtime = await readBoundRuntime(db, reader.release);
  const indexed = runtime.chains.find(
    (chain) => chain.chainId === 8453
  )?.completeThroughBlock;
  if (indexed === null || indexed === undefined)
    throw new CanonicalSourceUnavailable(
      "Arena complete block is unavailable."
    );
  return {
    indexed,
    coverage: {
      releaseId: reader.release.id,
      sourceId: source.id,
      indexedThroughBlock: String(indexed),
      observedThroughBlock: status.anchor!.number
    }
  };
}

export type ArenaTransactionInclusion =
  | "canonical"
  | "changed"
  | "expired"
  | "not_indexed"
  | null;

/** Identified transaction evidence in one source snapshot. This is not a
 * receipt fetcher or a second public-state projection. Approvals may have no
 * Arena event, so recent block witnesses also bind their receipt inclusion.
 */
export async function readArenaTransaction(
  reader: IndexerReader,
  definition: ArenaReadDefinition,
  transactionHash: string,
  options: {
    tournamentId?: string;
    blockNumber?: bigint;
    blockHash?: string;
  } = {}
) {
  const source = sourceOf(reader, definition);
  if (
    !hash.test(transactionHash) ||
    (options.tournamentId !== undefined &&
      (!decimal.test(options.tournamentId) ||
        BigInt(options.tournamentId) >= 2n ** 256n)) ||
    (options.blockNumber === undefined) !== (options.blockHash === undefined) ||
    (options.blockNumber !== undefined && options.blockNumber < 0n) ||
    (options.blockHash !== undefined && !hash.test(options.blockHash))
  )
    throw new Error("Invalid Arena transaction proof request.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source),
        schema = sqlIdentifier(reader.release.schema);
      const finalizedThroughBlock =
        status.snapshot.finalized?.blockNumber.toString() ?? null;
      let inclusion: ArenaTransactionInclusion = null;
      const empty = {
        ...coverage,
        finalizedThroughBlock,
        events: [] as Array<
          ArenaEventEvidence & { name: string; args: Record<string, unknown> }
        >,
        origin: null as {
          incarnation: string;
          opened: ArenaEventEvidence;
        } | null
      };
      if (options.blockNumber !== undefined && options.blockNumber > indexed)
        return { ...empty, inclusion: "not_indexed" as const };
      const rows = (
        await db.query<EventRow>(
          `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
      FROM ${schema}.canonical_event WHERE source_id=$1 AND chain_id=8453 AND transaction_hash=$2 ORDER BY log_index LIMIT 257`,
          [source.id, transactionHash]
        )
      ).rows;
      if (rows.length > 256)
        throw new CanonicalSourceUnavailable(
          "Arena transaction event limit exceeded."
        );
      const events = rows.map((row) => ({
        ...evidence(row, source),
        name: row.name,
        args: eventArgs(row)
      }));
      if (events.some((event) => BigInt(event.blockNumber) > indexed))
        return { ...empty, inclusion: "not_indexed" as const };
      if (options.blockNumber !== undefined) {
        const witness = (
          await db.query<{ block_hash: string }>(
            `SELECT block_hash FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1`,
            [String(options.blockNumber)]
          )
        ).rows[0];
        inclusion = witness
          ? witness.block_hash === options.blockHash
            ? "canonical"
            : "changed"
          : events.some(
                (event) =>
                  event.blockNumber === String(options.blockNumber) &&
                  event.blockHash === options.blockHash
              )
            ? "canonical"
            : "expired";
        if (
          events.some(
            (event) =>
              event.blockNumber !== String(options.blockNumber) ||
              event.blockHash !== options.blockHash
          )
        )
          inclusion = "changed";
      }
      let origin: typeof empty.origin = null;
      if (options.tournamentId !== undefined) {
        const row = (
          await db.query<{
            opened_event_id: string;
            opened_block_hash: string;
            block_number: string;
          }>(
            `SELECT opened_event_id,opened_block_hash,block_number::text FROM ${schema}.arena_tournament WHERE deployment=$1 AND tournament_id=$2`,
            [`8453:${definition.contract}`, options.tournamentId]
          )
        ).rows[0];
        if (row) {
          if (
            !decimal.test(row.block_number) ||
            BigInt(row.block_number) > indexed
          )
            return { ...empty, inclusion: "not_indexed" as const };
          const opening = (
            await db.query<EventRow>(
              `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
          FROM ${schema}.canonical_event WHERE id=$1`,
              [row.opened_event_id]
            )
          ).rows[0];
          const opened = evidence(opening, source, options.tournamentId);
          if (
            opening!.name !== "TournamentOpened" ||
            opened.blockHash !== row.opened_block_hash ||
            BigInt(opened.blockNumber) > indexed
          )
            throw new CanonicalSourceUnavailable(
              "Arena transaction opening proof is invalid."
            );
          if (
            events.some(
              (event) =>
                String(event.args.id) === options.tournamentId &&
                event.name !== "TournamentOpened" &&
                (BigInt(event.blockNumber) < BigInt(opened.blockNumber) ||
                  (event.blockNumber === opened.blockNumber &&
                    event.logIndex <= opened.logIndex))
            )
          )
            throw new CanonicalSourceUnavailable(
              "Arena transaction predates its current opening."
            );
          origin = {
            opened,
            incarnation: manifestDigest({
              deployment: `8453:${definition.contract}`,
              tournamentId: options.tournamentId,
              openedEventId: opened.id,
              openedBlockHash: opened.blockHash
            })
          };
        }
      }
      return { ...coverage, finalizedThroughBlock, inclusion, events, origin };
    }
  );
}

export async function readArenaCredit(
  reader: IndexerReader,
  definition: ArenaReadDefinition,
  wallet: string
) {
  const source = sourceOf(reader, definition);
  if (!/^0x[0-9a-f]{40}$/.test(wallet))
    throw new Error("Invalid Arena credit wallet.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source),
        schema = sqlIdentifier(reader.release.schema);
      const row = (
        await db.query<{
          amount: string;
          last_event_id: string;
          block_number: string;
          block_hash: string;
        }>(
          `SELECT amount::text,last_event_id,block_number::text,block_hash FROM ${schema}.arena_credit WHERE deployment=$1 AND wallet=$2`,
          [`8453:${definition.contract}`, wallet]
        )
      ).rows[0];
      if (!row) return { ...coverage, amount: "0", last: null };
      if (
        !decimal.test(row.amount) ||
        BigInt(row.amount) >= 2n ** 256n ||
        !decimal.test(row.block_number) ||
        BigInt(row.block_number) > indexed
      )
        throw new CanonicalSourceUnavailable(
          "Arena credit exceeds complete indexing coverage."
        );
      const event = (
        await db.query<EventRow>(
          `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
      FROM ${schema}.canonical_event WHERE id=$1`,
          [row.last_event_id]
        )
      ).rows[0];
      if (
        !event ||
        !["Claimed", "PayoutsReleased", "TournamentExpired"].includes(
          event.name
        )
      )
        throw new CanonicalSourceUnavailable(
          "Arena credit event proof is incomplete."
        );
      const args = eventArgs(event);
      if (
        !args ||
        typeof args !== "object" ||
        (event.name === "Claimed" &&
          (!("player" in args) || String(args.player).toLowerCase() !== wallet))
      )
        throw new CanonicalSourceUnavailable(
          "Arena credit event wallet disagrees."
        );
      // Claimed is a deployment-level event without a tournament id.
      const eventId =
        event.name === "Claimed" ? "0" : String("id" in args ? args.id : "");
      const last = evidence(
        event,
        source,
        event.name === "Claimed" ? undefined : eventId
      );
      if (
        last.blockNumber !== row.block_number ||
        last.blockHash !== row.block_hash
      )
        throw new CanonicalSourceUnavailable(
          "Arena credit and event inclusion disagree."
        );
      return { ...coverage, amount: row.amount, last };
    }
  );
}

export async function readArenaTournamentIds(
  reader: IndexerReader,
  definition: ArenaReadDefinition,
  options: { wallet?: string; limit?: number; workOnly?: boolean } = {}
) {
  const source = sourceOf(reader, definition),
    limit = options.limit ?? 30;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (options.wallet !== undefined && !/^0x[0-9a-f]{40}$/.test(options.wallet))
  )
    throw new Error("Invalid Arena tournament list.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source),
        schema = sqlIdentifier(reader.release.schema);
      if (
        (
          await db.query(
            `SELECT 1 FROM ${schema}.arena_tournament WHERE deployment=$1 AND block_number>$2 LIMIT 1`,
            [`8453:${definition.contract}`, String(indexed)]
          )
        ).rowCount
      )
        throw new CanonicalSourceUnavailable(
          "Arena list is still indexing the current block."
        );
      const rows = (
        await db.query<{ id: string }>(
          `SELECT tournament_id AS id FROM ${schema}.arena_tournament WHERE deployment=$1
      ${options.workOnly ? `AND (state->>'phase' IN ('open','strategies','resolving') OR (state->>'phase'='settled' AND state->>'videoHash' IS NULL))` : ""}
      ${options.wallet ? `AND (state->>'islandBeneficiary'=$3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') seat WHERE seat->>'player'=$3))` : ""}
      ORDER BY tournament_id::numeric ${options.workOnly ? "ASC" : "DESC"} LIMIT $2`,
          [
            `8453:${definition.contract}`,
            limit,
            ...(options.wallet ? [options.wallet] : [])
          ]
        )
      ).rows;
      return { ...coverage, ids: rows.map((row) => row.id) };
    }
  );
}

/** Native public state only. No application cursor, projection or private jobs.
 * The latest complete Ponder block may precede the next observer poll. Expose
 * both boundaries; an application must recheck canonical evidence/current phase
 * before an irreversible action, rather than add a fixed block-count wait.
 */
export async function readArenaTournament(
  reader: IndexerReader,
  definition: ArenaReadDefinition,
  tournamentId: string,
  options: { requiredThroughBlock?: bigint; expectedIncarnation?: string } = {}
) {
  const source = sourceOf(reader, definition);
  if (!decimal.test(tournamentId) || BigInt(tournamentId) >= 2n ** 256n)
    throw new Error("Invalid Arena tournament ID.");
  if (
    (options.requiredThroughBlock !== undefined &&
      options.requiredThroughBlock < 0n) ||
    (options.expectedIncarnation !== undefined &&
      !hash.test(options.expectedIncarnation))
  )
    throw new Error("Invalid Arena read requirement.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      available(status);
      const runtime = await readBoundRuntime(db, reader.release);
      const indexed = runtime.chains.find(
        (chain) => chain.chainId === 8453
      )?.completeThroughBlock;
      if (
        indexed === undefined ||
        indexed === null ||
        (options.requiredThroughBlock !== undefined &&
          indexed < options.requiredThroughBlock)
      )
        throw new CanonicalSourceUnavailable(
          "Arena is still indexing the required block."
        );
      const deployment = `8453:${definition.contract}`,
        schema = sqlIdentifier(reader.release.schema);
      const row = (
        await db.query<NativeRow>(
          `SELECT state,opened_event_id,opened_block_hash,last_event_id,
      block_number::text,block_hash FROM ${schema}.arena_tournament WHERE deployment=$1 AND tournament_id=$2`,
          [deployment, tournamentId]
        )
      ).rows[0];
      const coverage = {
        releaseId: reader.release.id,
        sourceId: source.id,
        indexedThroughBlock: indexed.toString(),
        observedThroughBlock: status.anchor!.number
      };
      if (!row) {
        if (options.expectedIncarnation)
          throw new CanonicalSourceUnavailable(
            "Arena tournament is no longer canonical."
          );
        return { ...coverage, tournament: null };
      }
      if (!decimal.test(row.block_number) || BigInt(row.block_number) > indexed)
        throw new CanonicalSourceUnavailable(
          "Arena tournament exceeds complete indexing coverage."
        );
      const events = (
        await db.query<EventRow>(
          `SELECT id,source_id,chain_id,address,abi_hash,name,args,
      block_number::text,block_hash,transaction_hash,log_index FROM ${schema}.canonical_event WHERE id=ANY($1::text[])`,
          [[row.opened_event_id, row.last_event_id]]
        )
      ).rows;
      const openedRow = events.find(
        (event) => event.id === row.opened_event_id
      );
      const opened = evidence(openedRow, source, tournamentId),
        last = evidence(
          events.find((event) => event.id === row.last_event_id),
          source,
          tournamentId
        );
      if (
        openedRow!.name !== "TournamentOpened" ||
        opened.blockHash !== row.opened_block_hash ||
        last.blockHash !== row.block_hash ||
        last.blockNumber !== row.block_number ||
        BigInt(opened.blockNumber) > BigInt(last.blockNumber)
      )
        throw new CanonicalSourceUnavailable(
          "Arena state and event evidence disagree."
        );
      if (
        !row.state ||
        typeof row.state !== "object" ||
        !("id" in row.state) ||
        String(row.state.id) !== tournamentId
      )
        throw new CanonicalSourceUnavailable(
          "Arena tournament state identity is invalid."
        );
      const incarnation = manifestDigest({
        deployment,
        tournamentId,
        openedEventId: opened.id,
        openedBlockHash: opened.blockHash
      });
      let inputFrozen: ArenaEventEvidence | null = null;
      if (
        "inputHash" in row.state &&
        row.state.inputHash !== null &&
        row.state.inputHash !== undefined
      ) {
        const frozenRow = (
          await db.query<EventRow>(
            `SELECT id,source_id,chain_id,address,abi_hash,name,args,
          block_number::text,block_hash,transaction_hash,log_index FROM ${schema}.canonical_event
          WHERE source_id=$1 AND name='InputFrozen' AND args::jsonb->>'id'=$2
          ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
            [source.id, tournamentId]
          )
        ).rows[0];
        inputFrozen = evidence(frozenRow, source, tournamentId);
        const args: unknown = JSON.parse(frozenRow!.args);
        if (
          !args ||
          typeof args !== "object" ||
          !("inputHash" in args) ||
          !("strategyCommitments" in args) ||
          args.inputHash !== row.state.inputHash ||
          !("commitments" in row.state) ||
          JSON.stringify(args.strategyCommitments) !==
            JSON.stringify(row.state.commitments) ||
          BigInt(inputFrozen.blockNumber) > BigInt(last.blockNumber) ||
          (inputFrozen.blockNumber === last.blockNumber &&
            inputFrozen.logIndex > last.logIndex)
        )
          throw new CanonicalSourceUnavailable(
            "Arena frozen input evidence disagrees with public state."
          );
      }
      if (
        options.expectedIncarnation &&
        options.expectedIncarnation !== incarnation
      )
        throw new CanonicalSourceUnavailable(
          "Arena tournament incarnation changed."
        );
      return {
        ...coverage,
        tournament: {
          deployment,
          id: tournamentId,
          state: row.state,
          incarnation,
          opened,
          last,
          inputFrozen
        }
      };
    }
  );
}

export type ArenaBrowseRequest = {
  kind: "tournaments" | "wallet" | "island" | "timeline" | "rewards";
  wallet?: string;
  role?: "any" | "entrant" | "host";
  status?: "all" | "active" | "completed" | "refunded";
  islandId?: string;
  tournamentId?: string;
  before?: string | null;
  limit?: number;
  cursorAnchor?: { number: string; hash: string };
};
export type ArenaBrowseRow = {
  id: string;
  state: unknown;
  incarnation: string;
  inputFrozen: ArenaEventEvidence | null;
};
export type ArenaBrowseEvent = {
  n: string;
  event_name: string;
  args: Record<string, unknown>;
  transaction_hash: string;
  block_number: string;
  log_index: number;
  state: unknown | null;
};
export type ArenaBrowseWalletTotals = {
  entered_tournaments: string;
  entered_seats: string;
  hosted_tournaments: string;
  championships: string;
  winnings: string;
  hosting: string;
  operations: string;
  refunds: string;
  pending: string;
};

/** Public browsing uses the very same source/complete-block snapshot as native
 * effects. It owns no application projection, scanner or independently moving
 * cursor. Keyset pages never silently truncate history to the worker's worklist.
 */
export async function readArenaBrowse(
  reader: IndexerReader,
  definition: ArenaReadDefinition,
  request: ArenaBrowseRequest
) {
  const source = sourceOf(reader, definition),
    limit = request.limit ?? 25;
  if (
    !["tournaments", "wallet", "island", "timeline", "rewards"].includes(
      request.kind
    ) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (request.wallet !== undefined &&
      !/^0x[0-9a-f]{40}$/.test(request.wallet)) ||
    [request.before, request.islandId, request.tournamentId].some(
      (v) => v != null && (!decimal.test(v) || BigInt(v) >= 2n ** 256n)
    ) ||
    (request.role !== undefined &&
      !["any", "entrant", "host"].includes(request.role)) ||
    (request.status !== undefined &&
      !["all", "active", "completed", "refunded"].includes(request.status)) ||
    (["wallet", "rewards"].includes(request.kind) && !request.wallet) ||
    (request.kind === "island" && !request.islandId) ||
    (request.kind === "timeline" && !request.tournamentId) ||
    (request.cursorAnchor !== undefined &&
      (!decimal.test(request.cursorAnchor.number) ||
        !hash.test(request.cursorAnchor.hash))) ||
    (request.role && request.role !== "any" && !request.wallet)
  )
    throw new Error("Invalid Arena public browse request.");
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      const { indexed, coverage } = await frame(db, reader, status, source),
        schema = sqlIdentifier(reader.release.schema),
        deployment = `8453:${definition.contract}`;
      // Ponder may publish event handlers within a block before its checkpoint.
      // Do not expose their partial aggregate state or an empty substitute.
      if (
        (
          await db.query(
            `SELECT 1 FROM ${schema}.arena_tournament WHERE deployment=$1 AND block_number>$2
       UNION ALL SELECT 1 FROM ${schema}.arena_credit WHERE deployment=$1 AND block_number>$2 LIMIT 1`,
            [deployment, String(indexed)]
          )
        ).rowCount
      )
        throw new CanonicalSourceUnavailable(
          "Arena public history is still indexing the current block."
        );
      if (
        request.cursorAnchor &&
        (BigInt(request.cursorAnchor.number) > indexed ||
          (
            await db.query(
              `SELECT 1 FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
              [request.cursorAnchor.number, request.cursorAnchor.hash]
            )
          ).rowCount !== 1)
      )
        throw new CanonicalSourceUnavailable(
          "Arena history cursor anchor changed or expired."
        );
      const currentAnchor = request.cursorAnchor ?? {
        number: status.anchor!.number,
        hash: status.anchor!.hash
      };
      if (
        BigInt(currentAnchor.number) > indexed ||
        (
          await db.query(
            `SELECT 1 FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
            [currentAnchor.number, currentAnchor.hash]
          )
        ).rowCount !== 1
      )
        throw new CanonicalSourceUnavailable(
          "Arena history canonical anchor is unavailable."
        );
      // Aggregate queries must authenticate every public row they sum, too.
      // Exact writer-owned opening/last inclusions, not a legacy mirror, determine
      // current identity. A malformed or partial row blocks the whole response.
      if (
        (
          await db.query(
            `SELECT 1 FROM ${schema}.arena_tournament t
      LEFT JOIN ${schema}.canonical_event o ON o.id=t.opened_event_id
      LEFT JOIN ${schema}.canonical_event e ON e.id=t.last_event_id
      WHERE t.deployment=$1 AND NOT COALESCE(
        o.name='TournamentOpened' AND o.source_id=$2 AND e.source_id=$2
        AND o.chain_id=8453 AND e.chain_id=8453 AND o.address=$3 AND e.address=$3 AND o.abi_hash=$4 AND e.abi_hash=$4
        AND o.args::jsonb->>'id'=t.tournament_id AND e.args::jsonb->>'id'=t.tournament_id AND t.state->>'id'=t.tournament_id
        AND o.block_hash=t.opened_block_hash AND e.block_hash=t.block_hash AND e.block_number=t.block_number
        AND o.block_number<=e.block_number AND e.block_number<=$5
        AND (o.block_number<e.block_number OR o.log_index<=e.log_index),false) LIMIT 1`,
            [
              deployment,
              source.id,
              definition.contract,
              definition.abiHash,
              String(indexed)
            ]
          )
        ).rowCount
      )
        throw new CanonicalSourceUnavailable(
          "Arena history aggregate evidence disagrees."
        );
      if (
        (
          await db.query(
            `SELECT 1 FROM ${schema}.arena_credit c LEFT JOIN ${schema}.canonical_event e ON e.id=c.last_event_id
      WHERE c.deployment=$1 AND NOT COALESCE(e.source_id=$2 AND e.chain_id=8453 AND e.address=$3 AND e.abi_hash=$4
       AND e.name IN ('Claimed','PayoutsReleased','TournamentExpired') AND e.block_hash=c.block_hash AND e.block_number=c.block_number
       AND e.block_number<=$5 AND (e.name<>'Claimed' OR lower(e.args::jsonb->>'player')=c.wallet),false) LIMIT 1`,
            [
              deployment,
              source.id,
              definition.contract,
              definition.abiHash,
              String(indexed)
            ]
          )
        ).rowCount
      )
        throw new CanonicalSourceUnavailable(
          "Arena history credit evidence disagrees."
        );
      const result = {
        ...coverage,
        cursorAnchor: currentAnchor,
        rows: [] as ArenaBrowseRow[],
        events: [] as ArenaBrowseEvent[],
        totals: null as ArenaBrowseWalletTotals | null,
        island: null as {
          hosted: string;
          released: string;
          pending: string;
        } | null,
        amount: "0",
        withdrawals: "0"
      };
      if (request.kind === "island") {
        result.island = (
          await db.query<{ hosted: string; released: string; pending: string }>(
            `SELECT count(*)::text AS hosted,
       (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL)*${arenaEconomics(definition.mediaKind).island})::text AS released,
       (count(*) FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL)*${arenaEconomics(definition.mediaKind).island})::text AS pending
       FROM ${schema}.arena_tournament WHERE deployment=$1 AND state->>'islandId'=$2`,
            [deployment, request.islandId]
          )
        ).rows[0]!;
      }
      if (request.kind === "tournaments" || request.kind === "island") {
        const rows = (
          await db.query<NativeRow & { id: string }>(
            `SELECT tournament_id AS id,state,opened_event_id,opened_block_hash,last_event_id,block_number::text,block_hash
       FROM ${schema}.arena_tournament t WHERE deployment=$1 AND ($2::numeric IS NULL OR tournament_id::numeric<$2)
       AND ($3::text IS NULL OR ($4 IN ('any','entrant') AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$3))
         OR ($4 IN ('any','host') AND state->>'islandBeneficiary'=$3))
       AND ($5='all' OR ($5='active' AND state->>'phase' IN ('open','strategies','resolving'))
         OR ($5='completed' AND state->>'phase'='settled') OR ($5='refunded' AND state->>'phase'='expired'))
       AND ($6::text IS NULL OR state->>'islandId'=$6) ORDER BY tournament_id::numeric DESC LIMIT $7`,
            [
              deployment,
              request.before ?? null,
              request.wallet ?? null,
              request.role ?? "any",
              request.status ?? "all",
              request.islandId ?? null,
              limit
            ]
          )
        ).rows;
        const events = rows.length
          ? (
              await db.query<EventRow>(
                `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
       FROM ${schema}.canonical_event WHERE id=ANY($1::text[])`,
                [rows.flatMap((r) => [r.opened_event_id, r.last_event_id])]
              )
            ).rows
          : [];
        result.rows = await Promise.all(
          rows.map(async (row) => {
            const opening = events.find((e) => e.id === row.opened_event_id),
              opened = evidence(opening, source, row.id),
              last = evidence(
                events.find((e) => e.id === row.last_event_id),
                source,
                row.id
              );
            if (
              opening?.name !== "TournamentOpened" ||
              opened.blockHash !== row.opened_block_hash ||
              last.blockHash !== row.block_hash ||
              last.blockNumber !== row.block_number ||
              BigInt(last.blockNumber) > indexed ||
              BigInt(opened.blockNumber) > BigInt(last.blockNumber) ||
              !row.state ||
              typeof row.state !== "object" ||
              !("id" in row.state) ||
              row.state.id !== row.id
            )
              throw new CanonicalSourceUnavailable(
                "Arena public history evidence disagrees."
              );
            let inputFrozen: ArenaEventEvidence | null = null;
            if ("inputHash" in row.state && row.state.inputHash != null) {
              const frozen = (
                await db.query<EventRow>(
                  `SELECT id,source_id,chain_id,address,abi_hash,name,args,block_number::text,block_hash,transaction_hash,log_index
            FROM ${schema}.canonical_event WHERE source_id=$1 AND name='InputFrozen' AND args::jsonb->>'id'=$2
            ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
                  [source.id, row.id]
                )
              ).rows[0];
              inputFrozen = evidence(frozen, source, row.id);
              const args = eventArgs(frozen!);
              if (
                args.inputHash !== row.state.inputHash ||
                !("commitments" in row.state) ||
                JSON.stringify(args.strategyCommitments) !==
                  JSON.stringify(row.state.commitments) ||
                BigInt(inputFrozen.blockNumber) > BigInt(last.blockNumber) ||
                BigInt(inputFrozen.blockNumber) < BigInt(opened.blockNumber) ||
                (inputFrozen.blockNumber === opened.blockNumber &&
                  inputFrozen.logIndex <= opened.logIndex) ||
                (inputFrozen.blockNumber === last.blockNumber &&
                  inputFrozen.logIndex > last.logIndex)
              )
                throw new CanonicalSourceUnavailable(
                  "Arena history frozen input disagrees."
                );
            }
            return {
              id: row.id,
              state: row.state,
              inputFrozen,
              incarnation: manifestDigest({
                deployment,
                tournamentId: row.id,
                openedEventId: opened.id,
                openedBlockHash: opened.blockHash
              })
            };
          })
        );
      } else if (request.kind === "wallet") {
        result.totals = (
          await db.query<ArenaBrowseWalletTotals>(
            `WITH participants AS (
        SELECT state,(SELECT count(*) FROM jsonb_array_elements(state->'seats') s WHERE s->>'player'=$2) AS own,
         state->>'islandBeneficiary'=$2 AS host,state->>'treasury'=$2 AS treasury,
         state->'seats'->((state->'winners'->>2)::int)->>'player'=$2 AS winner
        FROM ${schema}.arena_tournament WHERE deployment=$1)
       SELECT count(*) FILTER(WHERE own>0)::text AS entered_tournaments,coalesce(sum(own),0)::text AS entered_seats,
        count(*) FILTER(WHERE host)::text AS hosted_tournaments,count(*) FILTER(WHERE state->>'phase'='settled' AND winner)::text AS championships,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND winner)*${arenaEconomics(definition.mediaKind).winner})::text AS winnings,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND host)*${arenaEconomics(definition.mediaKind).island})::text AS hosting,
        (count(*) FILTER(WHERE state->>'videoHash' IS NOT NULL AND treasury)*${arenaEconomics(definition.mediaKind).operations})::text AS operations,
        coalesce(sum(own*${arenaEconomics(definition.mediaKind).entry}) FILTER(WHERE state->>'phase'='expired'),0)::text AS refunds,
        coalesce(sum((CASE WHEN winner THEN ${arenaEconomics(definition.mediaKind).winner} ELSE 0 END)+(CASE WHEN host THEN ${arenaEconomics(definition.mediaKind).island} ELSE 0 END)+(CASE WHEN treasury THEN ${arenaEconomics(definition.mediaKind).operations} ELSE 0 END))
          FILTER(WHERE state->>'phase'='settled' AND state->>'videoHash' IS NULL),0)::text AS pending FROM participants`,
            [deployment, request.wallet]
          )
        ).rows[0]!;
        result.amount =
          (
            await db.query<{ amount: string }>(
              `SELECT amount::text FROM ${schema}.arena_credit WHERE deployment=$1 AND wallet=$2`,
              [deployment, request.wallet]
            )
          ).rows[0]?.amount ?? "0";
        result.withdrawals = (
          await db.query<{ amount: string }>(
            `SELECT coalesce(sum((args::jsonb->>'amount')::numeric),0)::text AS amount
       FROM ${schema}.canonical_event WHERE source_id=$1 AND name='Claimed' AND lower(args::jsonb->>'player')=$2 AND block_number<=$3`,
            [source.id, request.wallet, String(indexed)]
          )
        ).rows[0]!.amount;
      } else {
        const rows = (
          await db.query<EventRow & { state: unknown | null }>(
            `SELECT e.id,e.source_id,e.chain_id,e.address,e.abi_hash,e.name,e.args,e.block_number::text,e.block_hash,e.transaction_hash,e.log_index,t.state
       FROM ${schema}.canonical_event e LEFT JOIN ${schema}.arena_tournament t ON t.deployment=$1 AND t.tournament_id=e.args::jsonb->>'id'
       LEFT JOIN ${schema}.canonical_event o ON o.id=t.opened_event_id
       WHERE e.source_id=$2 AND e.block_number<=$3
       AND (e.name='Claimed' OR (e.block_number>o.block_number OR (e.block_number=o.block_number AND e.log_index>=o.log_index)))
       AND ($4::numeric IS NULL OR e.block_number::numeric*4294967296+e.log_index+1<$4)
       AND (${request.kind === "timeline" ? "e.args::jsonb->>'id'=$5" : "e.name IN ('PayoutsReleased','TournamentExpired','Claimed') AND ((e.name='Claimed' AND lower(e.args::jsonb->>'player')=$5) OR (e.name<>'Claimed' AND (t.state->>'islandBeneficiary'=$5 OR t.state->>'treasury'=$5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.state->'seats') s WHERE s->>'player'=$5))))"})
       ORDER BY e.block_number ${request.kind === "timeline" ? "ASC" : "DESC"},e.log_index ${request.kind === "timeline" ? "ASC" : "DESC"} LIMIT $6`,
            [
              deployment,
              source.id,
              String(indexed),
              request.before ?? null,
              request.kind === "timeline"
                ? request.tournamentId
                : request.wallet,
              limit
            ]
          )
        ).rows;
        result.events = rows.map((row) => {
          evidence(
            row,
            source,
            request.kind === "timeline" ? request.tournamentId : undefined
          );
          return {
            n: String(
              BigInt(row.block_number) * 4294967296n +
                BigInt(row.log_index) +
                1n
            ),
            event_name: row.name,
            args: eventArgs(row),
            transaction_hash: row.transaction_hash,
            block_number: row.block_number,
            log_index: row.log_index,
            state: row.state
          };
        });
      }
      return result;
    }
  );
}
