import pg, { type Pool, type PoolClient } from "pg";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import {
  marketplaceChains,
  type MarketplaceChain
} from "@protopals/yunipals-market-core/registry";
import {
  createIndexerReader,
  CanonicalSourceUnavailable,
  type IndexerReader,
  type RegisteredRelease,
  type SourceStatus
} from "@protopals/yunipals-indexer-server/readers";
import {
  ownershipReference,
  ownershipTokenSql,
  ownershipHistorySql,
  readOwnershipToken,
  type OwnershipReadDefinition
} from "@protopals/yunipals-indexer-server/ownership";
import { sqlIdentifier } from "@protopals/yunipals-indexer-server/database";

import { readSourcePoolMax, sourcePoolMax } from "@/indexer/sourcePool";

export type MarketplaceOwnershipConfiguration =
  | { mode: "legacy" }
  | {
      mode: "unified";
      databaseUrl: string;
      releaseId: string;
      readSchema: string;
      poolMax?: number;
    };

export function readMarketplaceOwnershipEnvironment(
  input: NodeJS.ProcessEnv
): MarketplaceOwnershipConfiguration {
  const mode = input.MARKET_OWNERSHIP_INDEXER_MODE ?? "legacy";
  const databaseUrl = input.MARKET_OWNERSHIP_INDEXER_DATABASE_URL;
  const releaseId = input.MARKET_OWNERSHIP_INDEXER_RELEASE_ID;
  const readSchema = input.MARKET_OWNERSHIP_INDEXER_READ_SCHEMA;
  const poolMax = input.MARKET_OWNERSHIP_INDEXER_POOL_MAX;
  if (
    mode === "legacy" &&
    databaseUrl === undefined &&
    releaseId === undefined &&
    readSchema === undefined &&
    poolMax === undefined
  )
    return { mode };
  try {
    if (
      mode !== "unified" ||
      !databaseUrl ||
      !releaseId ||
      !readSchema ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(readSchema) ||
      !/^0x[0-9a-f]{64}$/.test(releaseId)
    )
      throw new Error();
    const url = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash
    )
      throw new Error();
    return {
      mode,
      databaseUrl,
      releaseId,
      readSchema,
      poolMax: readSourcePoolMax(poolMax)
    };
  } catch {
    throw new Error(
      "Configure MARKET_OWNERSHIP_INDEXER_MODE=unified with an exact database URL, release ID and read schema, or legacy without candidate selectors."
    );
  }
}

export function marketplaceOwnershipDefinition(
  release: RegisteredRelease,
  collection: string
): OwnershipReadDefinition {
  const chain = marketplaceChains[collection as MarketplaceChain];
  const sourceId = `ownership:${collection}`;
  const source = release.manifest.sources.find(
    (source) => source.id === sourceId
  );
  if (
    !chain ||
    !source?.enabled ||
    source.feature !== "ownership" ||
    source.abiHash !== manifestDigest(collectionAbi) ||
    source.chainId !== chain.chainId ||
    source.address !== chain.contractAddress.toLowerCase()
  )
    throw new CanonicalSourceUnavailable(
      "Marketplace ownership deployment mismatch."
    );
  const depths = source.policies.filter((policy) => policy.kind === "depth");
  if (
    collection === "bnb" &&
    (depths.length !== 1 || depths[0]!.subsequentBlocks > 1000)
  )
    throw new CanonicalSourceUnavailable(
      "BNB ownership confirmation policy requires review."
    );
  return {
    collection,
    sourceId,
    policy: collection === "bnb" ? depths[0]! : { kind: "latest" }
  };
}

export type MarketplaceOwnershipCheckpoint = {
  number: bigint;
  hash: string;
  timestamp: bigint;
  heartbeatAt: number;
  releaseId: string;
  sourceId: string;
};
function checkpoint(
  release: RegisteredRelease,
  status: SourceStatus
): MarketplaceOwnershipCheckpoint {
  if (
    !status.readiness.ready ||
    !status.anchor ||
    status.errorCode !== null ||
    !/^0x[0-9a-f]{64}$/.test(status.anchor.hash) ||
    !/^(0|[1-9][0-9]*)$/.test(status.anchor.timestamp)
  )
    throw new CanonicalSourceUnavailable(
      status.errorCode ?? status.readiness.reason
    );
  return {
    number: BigInt(status.anchor.number),
    hash: status.anchor.hash,
    timestamp: BigInt(status.anchor.timestamp),
    heartbeatAt: status.snapshot.indexerObservedAtMs,
    releaseId: release.id,
    sourceId: status.source.id
  };
}

type Query = Pick<Pool, "query">;
type Visibility = {
  token_id: string;
  owner: string;
  lifecycle: number;
  anchor_event_id: string;
  anchor_block: string;
  anchor_transaction_index: number;
  anchor_log_index: number;
};
type EventPosition = {
  blockNumber: string;
  transactionIndex: number;
  logIndex: number;
};
export class MarketplaceOwnershipIndexer {
  constructor(
    readonly pool: Pool,
    readonly releaseId: string,
    readonly databaseUrl: string,
    readonly readSchema: string,
    private readonly now?: () => number
  ) {}
  private async reader() {
    return createIndexerReader(this.pool, {
      releaseId: this.releaseId,
      now: this.now
    });
  }
  private async snapshot<T>(
    collection: string,
    task: (
      db: PoolClient,
      reader: IndexerReader,
      definition: OwnershipReadDefinition,
      context: { release: RegisteredRelease; status: SourceStatus },
      anchor: MarketplaceOwnershipCheckpoint
    ) => Promise<T>
  ) {
    const reader = await this.reader();
    const definition = marketplaceOwnershipDefinition(
      reader.release,
      collection
    );
    const read = await reader.snapshot(
      definition.sourceId,
      definition.policy,
      async (db, context) => {
        const anchor = checkpoint(context.release, context.status);
        const pinned: IndexerReader = {
          ...reader,
          snapshot: async (_source, _policy, read) => read(db, context)
        };
        return {
          value: await task(db, pinned, definition, context, anchor),
          anchor
        };
      }
    );
    // The local visibility query may await another database. Re-read source
    // health and the original branch in a new snapshot before exposing it.
    await reader.snapshot(
      definition.sourceId,
      definition.policy,
      async (db, context) => {
        const fresh = checkpoint(context.release, context.status);
        if (
          fresh.number < read.anchor.number ||
          (
            await db.query(
              `SELECT 1 FROM ${sqlIdentifier(context.release.schema)}.chain_block WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
              [
                context.status.source.chainId,
                read.anchor.number.toString(),
                read.anchor.hash
              ]
            )
          ).rowCount !== 1
        )
          throw new CanonicalSourceUnavailable(
            "Ownership branch changed during the read."
          );
      }
    );
    return read.value;
  }
  async status(collection: string) {
    return this.snapshot(
      collection,
      async (_db, _reader, _definition, _context, anchor) => anchor
    );
  }
  async assertCheckpoint(
    collection: string,
    before: { number: bigint; hash: string }
  ) {
    return this.snapshot(
      collection,
      async (db, _reader, _definition, context, anchor) => {
        if (
          anchor.number < before.number ||
          (
            await db.query(
              `SELECT 1 FROM ${sqlIdentifier(context.release.schema)}.chain_block WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
              [
                context.status.source.chainId,
                before.number.toString(),
                before.hash
              ]
            )
          ).rowCount !== 1
        )
          throw new CanonicalSourceUnavailable(
            "Held ownership snapshot branch changed."
          );
      }
    );
  }
  async token(
    local: Query,
    asset: {
      chain: string;
      chainId: number;
      contractAddress: string;
      tokenId: string;
    }
  ) {
    return this.snapshot(
      asset.chain,
      async (db, reader, definition, context, anchor) => {
        if (
          context.status.source.chainId !== asset.chainId ||
          context.status.source.address !== asset.contractAddress.toLowerCase()
        )
          throw new CanonicalSourceUnavailable(
            "Marketplace asset deployment mismatch."
          );
        const result = await readOwnershipToken(
          reader,
          definition,
          asset.tokenId,
          { requireReady: true }
        );
        if (!result.token) return null;
        const token = result.token;
        const visibility = await local.query<Visibility>(
          `SELECT token_id::text,owner,lifecycle,anchor_event_id,anchor_block::text,anchor_transaction_index,anchor_log_index FROM metadata.token_visibility WHERE collection=$1 AND token_id=$2::numeric AND owner=$3 AND lifecycle=$4`,
          [asset.chain, asset.tokenId, token.owner, token.lifecycle]
        );
        let hidden = false;
        const ref = ownershipReference(
          context.release.schema,
          context.status.source,
          asset.chain
        );
        for (const v of visibility.rows) {
          const verified = await db.query(
            `SELECT 1 FROM (${ownershipHistorySql(ref, "transfer_event", { parameter: 1 })}) anchor
          WHERE anchor.id=$2 AND anchor.token_id=$3 AND anchor.lifecycle=$4 AND anchor.block_number=$5::bigint AND anchor.transaction_index=$6 AND anchor.log_index=$7
            AND NOT EXISTS(SELECT 1 FROM (${ownershipHistorySql(ref, "transfer_event", { parameter: 1 })}) change WHERE change.token_id=anchor.token_id AND change.lifecycle=anchor.lifecycle AND change."from"<>change."to" AND (change.block_number,change.transaction_index,change.log_index)>(anchor.block_number,anchor.transaction_index,anchor.log_index))`,
            [
              anchor.number.toString(),
              v.anchor_event_id,
              asset.tokenId,
              token.lifecycle,
              v.anchor_block,
              v.anchor_transaction_index,
              v.anchor_log_index
            ]
          );
          if (verified.rowCount === 1) hidden = true;
        }
        return { token, hidden, checkpoint: anchor };
      }
    );
  }
  async transfers(collection: string, tokenIds: readonly string[]) {
    const unique = [...new Set(tokenIds)];
    if (!unique.length)
      return new Map<
        string,
        { tokenId: string; lifecycle: number; transactionHash: string }
      >();
    if (
      unique.length > 100 ||
      unique.some(
        (id) => !/^(0|[1-9][0-9]*)$/.test(id) || BigInt(id) >= 2n ** 256n
      )
    )
      throw new Error("Invalid indexed transfer batch.");
    return this.snapshot(
      collection,
      async (db, _reader, _definition, context, anchor) => {
        const ref = ownershipReference(
          context.release.schema,
          context.status.source,
          collection
        );
        const rows = await db.query<{
          token_id: string;
          lifecycle: number;
          last_transaction_hash: string;
          proof: boolean;
        }>(
          `SELECT t.token_id,t.lifecycle,t.last_transaction_hash,EXISTS(SELECT 1 FROM ${sqlIdentifier(context.release.schema)}.canonical_event j WHERE j.source_id=$3 AND j.chain_id=t.chain_id AND j.address=t.contract_address AND j.transaction_hash=t.last_transaction_hash AND j.block_number=t.last_transfer_block AND j.name='Transfer' AND j.abi_hash=$4) AS proof FROM (${ownershipTokenSql(ref, { parameter: 1 })}) t WHERE t.token_id=ANY($2::text[])`,
          [
            anchor.number.toString(),
            unique,
            context.status.source.id,
            context.status.source.abiHash
          ]
        );
        for (const row of rows.rows)
          if (
            !Number.isSafeInteger(row.lifecycle) ||
            row.lifecycle < 1 ||
            !/^0x[0-9a-f]{64}$/.test(row.last_transaction_hash) ||
            !row.proof
          )
            throw new CanonicalSourceUnavailable(
              "Ownership transfer proof is incomplete."
            );
        return new Map(
          rows.rows.map((row) => [
            row.token_id,
            {
              tokenId: row.token_id,
              lifecycle: row.lifecycle,
              transactionHash: row.last_transaction_hash
            }
          ])
        );
      }
    );
  }
  async lifecycleBefore(
    collection: string,
    tokenId: string,
    position: EventPosition
  ) {
    if (
      !/^(0|[1-9][0-9]*)$/.test(tokenId) ||
      BigInt(tokenId) >= 2n ** 256n ||
      !/^(0|[1-9][0-9]*)$/.test(position.blockNumber) ||
      !Number.isSafeInteger(position.transactionIndex) ||
      position.transactionIndex < 0 ||
      !Number.isSafeInteger(position.logIndex) ||
      position.logIndex < 0
    )
      throw new Error("Invalid lifecycle event position.");
    return this.snapshot(
      collection,
      async (db, _reader, _definition, context, anchor) => {
        if (BigInt(position.blockNumber) > anchor.number)
          throw new CanonicalSourceUnavailable(
            "Publication is beyond ownership coverage."
          );
        const ref = ownershipReference(
          context.release.schema,
          context.status.source,
          collection
        );
        const result = await db.query<{
          lifecycle: number;
          to: string;
          proof: boolean;
        }>(
          `SELECT e.lifecycle,e."to",e.transaction_hash,e.block_number::text,e.transaction_index,e.log_index,EXISTS(SELECT 1 FROM ${sqlIdentifier(context.release.schema)}.canonical_event j WHERE j.source_id=$6 AND j.chain_id=e.chain_id AND j.address=e.contract_address AND j.transaction_hash=e.transaction_hash AND j.log_index=e.log_index AND j.block_number=e.block_number AND j.name='Transfer' AND j.abi_hash=$7) AS proof FROM (${ownershipHistorySql(ref, "transfer_event", { parameter: 1 })}) e WHERE e.token_id=$2 AND (e.block_number,e.transaction_index,e.log_index)<($3::bigint,$4::integer,$5::integer) ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1`,
          [
            anchor.number.toString(),
            tokenId,
            position.blockNumber,
            position.transactionIndex,
            position.logIndex,
            context.status.source.id,
            context.status.source.abiHash
          ]
        );
        const row = result.rows[0];
        if (
          row &&
          (!Number.isSafeInteger(row.lifecycle) ||
            row.lifecycle < 1 ||
            !/^0x[0-9a-f]{40}$/.test(row.to) ||
            !row.proof)
        )
          throw new CanonicalSourceUnavailable(
            "Ownership lifecycle proof is incomplete."
          );
        return { transfer: row ?? null, checkpoint: anchor };
      }
    );
  }
}

let configured: MarketplaceOwnershipIndexer | undefined;
let ownedPool: Pool | undefined;
let selected = false;
export function marketplaceOwnershipIndexer() {
  return configured;
}
export function configureMarketplaceOwnershipIndexer(
  config: MarketplaceOwnershipConfiguration,
  options: { pool?: Pool; now?: () => number } = {}
) {
  if (selected || configured || ownedPool)
    throw new Error(
      "Marketplace ownership indexer is already configured; close it before replacing the source."
    );
  const poolMax =
    config.mode === "unified" ? sourcePoolMax(config.poolMax) : undefined;
  selected = true;
  if (config.mode === "legacy") return;
  const pool =
    options.pool ??
    new pg.Pool({
      connectionString: config.databaseUrl,
      application_name: "yunipals_market_shared_ownership",
      max: poolMax,
      connectionTimeoutMillis: 1500,
      statement_timeout: 8000,
      lock_timeout: 1500,
      idle_in_transaction_session_timeout: 10000
    });
  if (!options.pool) ownedPool = pool;
  configured = new MarketplaceOwnershipIndexer(
    pool,
    config.releaseId,
    config.databaseUrl,
    config.readSchema,
    options.now
  );
}
export async function closeMarketplaceOwnershipIndexer() {
  const pool = ownedPool;
  configured = undefined;
  ownedPool = undefined;
  selected = false;
  await pool?.end();
}

export async function withMarketplaceOwnershipIndexer<T>(
  config: MarketplaceOwnershipConfiguration,
  task: () => Promise<T>
) {
  configureMarketplaceOwnershipIndexer(config);
  try {
    return await task();
  } finally {
    await closeMarketplaceOwnershipIndexer();
  }
}
