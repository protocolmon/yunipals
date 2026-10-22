import type { SourceDefinition } from "../../yunipals-indexer-client/src/sources.js";
import type { PoolClient } from "pg";
import type { IndexerReader, SourceStatus } from "./readers.js";
import { readBoundRuntime } from "./releases.js";
import { sqlIdentifier } from "./database.js";
import { manifestDigest } from "./identity.js";
import { CanonicalSourceUnavailable } from "./paging.js";

export type ArenaReadDefinition = {
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
