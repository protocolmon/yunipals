import type { IndexerReader } from "./readers.js";
import { readBoundRuntime } from "./releases.js";
import { sqlIdentifier } from "./database.js";
import {
  CanonicalSourceUnavailable,
  CanonicalCursorInvalidated
} from "./paging.js";
import { manifestDigest } from "./identity.js";
import { animeRegistryAbi } from "../../yunipals-market-core/src/animeRegistryAbi.js";
import {
  ANIME_STATUSES,
  animeTokenId,
  type AnimeFighter,
  type AnimeStatus
} from "../../yunipals-market-core/src/anime.js";

type FighterRow = {
  id: string;
  status: number;
  recipe_version: number;
  manifest_hash: string;
  applicant: string;
  applications: number;
  reason_code: number | null;
  note: string | null;
  applied_block: string;
  last_event_id: string;
  block_number: string;
  block_hash: string;
  event_source: string;
  event_address: string;
  event_abi: string;
  event_name: string;
  event_args: string;
  event_block: string;
  event_hash: string;
  transaction_hash: string;
  log_index: number;
};
const columns = `f.*,f.applied_block::text,f.block_number::text,e.source_id AS event_source,e.address AS event_address,e.abi_hash AS event_abi,e.name AS event_name,e.args AS event_args,e.block_number::text AS event_block,e.block_hash AS event_hash,e.transaction_hash,e.log_index`;
const hash = /^0x[0-9a-f]{64}$/;
function wire(row: FighterRow, indexed: bigint, address: string): AnimeFighter {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(row.event_args);
  } catch {
    throw new CanonicalSourceUnavailable("Invalid anime event payload.");
  }
  if (
    !ANIME_STATUSES[row.status] ||
    row.status < 1 ||
    BigInt(row.block_number) > indexed ||
    row.block_number !== row.event_block ||
    row.block_hash !== row.event_hash ||
    !hash.test(row.block_hash) ||
    !hash.test(row.manifest_hash) ||
    row.event_source !== "anime-registry:8453" ||
    row.event_address !== address ||
    row.event_abi !== manifestDigest(animeRegistryAbi) ||
    row.last_event_id !==
      `8453:${address}:${row.transaction_hash}:${row.log_index}` ||
    !hash.test(row.transaction_hash) ||
    String(args.tokenId) !== row.id ||
    row.event_name !== ANIME_STATUSES[row.status] ||
    (row.status === 2 &&
      (args.manifestHash !== row.manifest_hash ||
        Number(args.recipeVersion) !== row.recipe_version)) ||
    ([3, 4].includes(row.status) &&
      (Number(args.reasonCode) !== row.reason_code || args.note !== row.note))
  )
    throw new CanonicalSourceUnavailable(
      "Anime fighter and canonical event disagree."
    );
  return {
    tokenId: row.id,
    status: ANIME_STATUSES[row.status]!,
    recipeVersion: row.recipe_version,
    manifestHash: row.manifest_hash,
    applicant: row.applicant,
    applications: row.applications,
    reasonCode: row.reason_code,
    note: row.note,
    appliedBlock: row.applied_block
  };
}
export async function readAnimeFighters(
  reader: IndexerReader,
  options: {
    status?: AnimeStatus;
    cursor?: string;
    limit?: number;
    tokenId?: string;
    registry?: string;
  } = {}
) {
  const source = reader.release.manifest.sources.find(
    (s) => s.id === "anime-registry:8453"
  );
  if (
    !source?.enabled ||
    source.chainId !== 8453 ||
    source.abiHash !== manifestDigest(animeRegistryAbi) ||
    (options.registry && source.address !== options.registry.toLowerCase())
  )
    throw new CanonicalSourceUnavailable(
      "Anime registry does not match the registered source."
    );
  const limit = options.limit ?? 24;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (options.status !== undefined && !ANIME_STATUSES.includes(options.status))
  )
    throw new Error("Invalid anime queue query.");
  if (options.tokenId !== undefined) animeTokenId(options.tokenId);
  const filter =
    options.status === undefined
      ? null
      : ANIME_STATUSES.indexOf(options.status);
  let after: [string, string] | null = null;
  if (options.cursor) {
    try {
      const c = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
      if (
        options.cursor.length > 2048 ||
        c.release !== reader.release.id ||
        c.registry !== source.address ||
        c.status !== filter ||
        !/^[0-9]+$/.test(c.block)
      )
        throw new Error();
      after = [c.block, animeTokenId(c.tokenId)];
    } catch {
      throw new CanonicalCursorInvalidated(
        "Anime queue cursor changed; refresh the queue."
      );
    }
  }
  return reader.snapshot(
    source.id,
    { kind: "latest" },
    async (db, { status }) => {
      if (
        !["ready", "catching_up"].includes(status.readiness.reason) ||
        !status.anchor
      )
        throw new CanonicalSourceUnavailable("Anime registry is catching up.");
      const runtime = await readBoundRuntime(db, reader.release);
      const indexed = runtime.chains.find(
        (c) => c.chainId === 8453
      )?.completeThroughBlock;
      if (indexed === null || indexed === undefined)
        throw new CanonicalSourceUnavailable("Anime coverage is unavailable.");
      const schema = sqlIdentifier(reader.release.schema);
      if (
        (
          await db.query(
            `SELECT 1 FROM ${schema}.anime_fighter WHERE block_number>$1 LIMIT 1`,
            [String(indexed)]
          )
        ).rowCount
      )
        throw new CanonicalSourceUnavailable(
          "Anime queue is still indexing a block."
        );
      const rows = (
        await db.query<FighterRow>(
          `SELECT ${columns} FROM ${schema}.anime_fighter f LEFT JOIN ${schema}.canonical_event e ON e.id=f.last_event_id WHERE ($1::integer IS NULL OR f.status=$1) AND ($2::text IS NULL OR f.id=$2) AND ($3::numeric IS NULL OR (f.applied_block,f.id::numeric)>($3::numeric,$4::numeric)) ORDER BY f.applied_block,f.id::numeric LIMIT $5`,
          [
            filter,
            options.tokenId ?? null,
            after?.[0] ?? null,
            after?.[1] ?? null,
            limit + 1
          ]
        )
      ).rows;
      const counts = (
        await db.query<{ status: number; count: string }>(
          `SELECT status,count(*)::text FROM ${schema}.anime_fighter GROUP BY status`
        )
      ).rows;
      const items = rows
        .slice(0, limit)
        .map((r) => wire(r, indexed, source.address!));
      if (options.tokenId && items[0]?.status === "Applied") {
        items[0].queuePosition = Number(
          (
            await db.query<{ position: string }>(
              `SELECT (count(*)+1)::text AS position FROM ${schema}.anime_fighter WHERE status=1 AND (applied_block,id::numeric)<($1::bigint,$2::numeric)`,
              [items[0].appliedBlock, items[0].tokenId]
            )
          ).rows[0]!.position
        );
      }
      const last = items.at(-1);
      return {
        releaseId: reader.release.id,
        sourceId: source.id,
        indexedThroughBlock: String(indexed),
        observedThroughBlock: status.anchor.number,
        items,
        counts: Object.fromEntries(
          ANIME_STATUSES.map((name, i) => [
            name,
            Number(counts.find((c) => c.status === i)?.count ?? 0)
          ])
        ),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  release: reader.release.id,
                  registry: source.address,
                  status: filter,
                  block: last.appliedBlock,
                  tokenId: last.tokenId
                })
              ).toString("base64url")
            : null
      };
    }
  );
}
export async function readAnimeFighter(
  reader: IndexerReader,
  tokenId: string,
  registry?: string
) {
  const result = await readAnimeFighters(reader, {
    tokenId,
    registry,
    limit: 1
  });
  return { ...result, fighter: result.items[0] ?? null };
}
