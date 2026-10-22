import type { Pool, PoolClient } from "pg";
import type { PublicClient } from "viem";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import {
  readMarketplacePage,
  type MarketplaceReadDefinition
} from "@protopals/yunipals-indexer-server/marketplace";
import {
  CanonicalCursorInvalidated,
  CanonicalSourceUnavailable,
  type IndexerReader
} from "@protopals/yunipals-indexer-server/readers";

import { transaction } from "@/db/pool";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";
import {
  qualifySharedCollectionReceipt,
  storeCollectionSale,
  wakeReorgedSaleOrders,
  wakeSaleOrderProjection
} from "./collectionSaleProjection";
import {
  decodeSharedCollectionSales,
  SalePageCapacityError,
  type SharedMarketPage
} from "./sharedCollectionSales";

type Policy = Parameters<IndexerReader["status"]>[1];
type Cursor = SharedMarketPage["cursor"];
type Anchor = NonNullable<Cursor["completed"]>;
export type SharedCollectionSaleConfiguration = {
  chain: OpenSeaChain;
  startBlock: string;
  confirmations: number;
  policy: string;
  confirmationPolicy: Policy;
};
export function sharedCollectionSaleConfiguration(
  reader: Pick<IndexerReader, "release">,
  config: SharedCollectionSaleConfiguration
) {
  const chain = marketplaceChains[config.chain];
  const definition: MarketplaceReadDefinition = {
    sourceId: `ownership:${config.chain}`,
    chainId: chain.chainId,
    address: chain.contractAddress.toLowerCase(),
    abiHash: manifestDigest(collectionAbi),
    feature: "ownership"
  };
  const source = reader.release.manifest.sources.find(
    (row) => row.id === definition.sourceId
  );
  if (
    !/^(0|[1-9][0-9]*)$/.test(config.startBlock) ||
    BigInt(config.startBlock) > BigInt(Number.MAX_SAFE_INTEGER) ||
    !Number.isSafeInteger(config.confirmations) ||
    config.confirmations < 0 ||
    config.confirmations > 100000 ||
    !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(config.policy) ||
    !source?.enabled ||
    source.startBlock === null ||
    BigInt(source.startBlock) > BigInt(config.startBlock) ||
    (source.receiptStartBlock !== undefined &&
      BigInt(source.receiptStartBlock) > BigInt(config.startBlock)) ||
    source.endBlock !== null ||
    source.address !== definition.address ||
    source.chainId !== definition.chainId ||
    source.abiHash !== definition.abiHash ||
    source.feature !== "ownership" ||
    source.receiptRequirement !== "full" ||
    !source.events.includes("Transfer") ||
    !source.policies.some(
      (policy) =>
        manifestDigest(policy) === manifestDigest(config.confirmationPolicy)
    ) ||
    (config.confirmationPolicy.kind === "latest" &&
      (config.chain !== "base" || config.confirmations !== 0)) ||
    (config.confirmationPolicy.kind !== "latest" && config.confirmations < 1) ||
    (config.confirmationPolicy.kind === "depth" &&
      config.confirmationPolicy.subsequentBlocks !== config.confirmations)
  )
    throw new CanonicalSourceUnavailable(
      "Sale source, history boundary or confirmation policy requires review."
    );
  const consumer = `collection-sales:${config.chain}`;
  return {
    consumer,
    definition,
    configurationHash: manifestDigest({
      version: 1,
      decoder: "collection-sales-v1",
      consumer,
      definition,
      ...(source.receiptStartBlock === undefined
        ? {}
        : { receiptStartBlock: source.receiptStartBlock }),
      ...config
    })
  };
}

type Observation = {
  generation: string;
  reader_mode: string;
  block_number: string | null;
  block_hash: string | null;
  coverage_start: string | null;
  replay_from: string | null;
  start_block: string;
  confirmations: number;
  policy: string;
  consumer_generation: string;
  release_id: string;
  source_id: string;
  configuration_hash: string;
  confirmation_policy: Policy;
  cursor: Cursor | null;
};

/** Operational sale projection over the one canonical ingestion ledger. RPC is
 * limited to old block witnesses; transfers and full receipts come from Ponder. */
export class SharedCollectionSaleReplay {
  private readonly registration;
  private readonly chainId;
  constructor(
    private readonly pool: Pool,
    private readonly reader: IndexerReader,
    private readonly client: PublicClient,
    private readonly config: SharedCollectionSaleConfiguration,
    private readonly pageSize = 250
  ) {
    this.registration = sharedCollectionSaleConfiguration(reader, config);
    this.chainId = this.registration.definition.chainId;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000)
      throw new Error("Invalid shared sale page size.");
  }
  private async observation() {
    const result = await this.pool.query<Observation>(
      `SELECT c.reader_mode,c.generation::text,c.block_number::text,c.block_hash,
       c.coverage_start::text,c.replay_from::text,p.start_block::text,p.confirmations,p.policy,
       i.generation::text AS consumer_generation,i.release_id,i.source_id,i.configuration_hash,
       i.confirmation_policy,i.cursor
       FROM yunipals_market.checkpoint c JOIN yunipals_market.sale_replay_config p USING(chain_id)
       LEFT JOIN yunipals_market.shared_indexer_consumer i ON i.consumer=$2
       WHERE c.source='chain' AND c.chain_id=$1 AND c.name='seaport-sales'`,
      [this.chainId, this.registration.consumer]
    );
    return result.rows[0];
  }
  private async commit(
    observed: Observation,
    task: (db: PoolClient) => Promise<void>
  ) {
    return transaction(this.pool, async (db) => {
      const lock = await db.query(
        `SELECT 1 FROM yunipals_market.checkpoint c JOIN yunipals_market.sale_replay_config p USING(chain_id)
         JOIN yunipals_market.shared_indexer_consumer i ON i.consumer=$2
         WHERE c.source='chain' AND c.chain_id=$1 AND c.name='seaport-sales' AND c.reader_mode='unified'
         AND c.generation=$3::bigint AND p.start_block=$4::numeric AND p.confirmations=$5 AND p.policy=$6
         AND i.generation=$7::bigint AND i.release_id=$8 AND i.source_id=$9 AND i.configuration_hash=$10
         FOR UPDATE OF c,i`,
        [
          this.chainId,
          this.registration.consumer,
          observed.generation,
          observed.start_block,
          observed.confirmations,
          observed.policy,
          observed.consumer_generation,
          this.reader.release.id,
          this.registration.definition.sourceId,
          this.registration.configurationHash
        ]
      );
      if (lock.rowCount !== 1) return false;
      await task(db);
      await db.query(
        `UPDATE yunipals_market.checkpoint SET generation=generation+1
         WHERE source='chain' AND chain_id=$1 AND name='seaport-sales'`,
        [this.chainId]
      );
      return true;
    });
  }
  private verifyOldAnchor = async (anchor: Anchor, chainId: number) => {
    if (chainId !== this.chainId) return false;
    const block = await this.client.getBlock({
      blockNumber: BigInt(anchor.number)
    });
    return (
      block.number?.toString() === anchor.number &&
      block.hash?.toLowerCase() === anchor.hash
    );
  };
  private cursor(anchor: Anchor | null): Cursor {
    const policy = this.config.confirmationPolicy;
    return {
      version: 1,
      releaseId: this.reader.release.id,
      sourceId: this.registration.definition.sourceId,
      policy:
        policy.kind === "depth"
          ? `depth:${policy.subsequentBlocks}`
          : policy.kind,
      completed: anchor,
      target: null,
      after: null
    };
  }
  private async validate(cursor: Cursor) {
    await this.reader.page(
      this.registration.definition.sourceId,
      this.config.confirmationPolicy,
      {
        cursor,
        limit: 1,
        includeReceipts: false,
        verifyOldAnchor: this.verifyOldAnchor
      }
    );
  }
  private async saveCursor(db: PoolClient, cursor: Cursor) {
    await db.query(
      `UPDATE yunipals_market.shared_indexer_consumer SET cursor=$2::jsonb,
       generation=generation+1,updated_at=clock_timestamp() WHERE consumer=$1`,
      [this.registration.consumer, JSON.stringify(cursor)]
    );
  }
  private async reset(observed: Observation) {
    let retained: Anchor | null = null;
    if (observed.cursor && observed.coverage_start === this.config.startBlock) {
      const anchors = await this.pool.query<{
        block_number: string;
        block_hash: string;
      }>(
        `SELECT block_number::text,block_hash FROM yunipals_market.activity_block
         WHERE chain_id=$1 AND block_number>=$2::numeric AND ($3::numeric IS NULL OR block_number<$3::numeric)
         ORDER BY activity_block.block_number DESC LIMIT 128`,
        [this.chainId, this.config.startBlock, observed.replay_from]
      );
      const deadline = Date.now() + 20000;
      for (const row of anchors.rows) {
        if (Date.now() > deadline)
          throw new Error("Shared sale rewind witness budget elapsed.");
        const anchor = { number: row.block_number, hash: row.block_hash };
        if (await this.verifyOldAnchor(anchor, this.chainId)) {
          retained = anchor;
          break;
        }
      }
    }
    let anchor = retained;
    if (!anchor && BigInt(this.config.startBlock) > 0n) {
      const prior = await this.client.getBlock({
        blockNumber: BigInt(this.config.startBlock) - 1n
      });
      if (!prior.hash || prior.number !== BigInt(this.config.startBlock) - 1n)
        throw new Error("Sale history predecessor is unavailable.");
      anchor = {
        number: prior.number.toString(),
        hash: prior.hash.toLowerCase()
      };
    }
    const cursor = this.cursor(anchor);
    await this.validate(cursor);
    return this.commit(observed, async (db) => {
      await wakeReorgedSaleOrders(
        db,
        this.chainId,
        retained ? BigInt(retained.number) : null
      );
      for (const table of ["sale", "sale_exclusion"])
        await db.query(
          `UPDATE yunipals_market.${table} SET canonical=false WHERE chain_id=$1
          AND canonical AND ($2::numeric IS NULL OR block_number>$2::numeric)`,
          [this.chainId, retained?.number ?? null]
        );
      await db.query(
        `DELETE FROM yunipals_market.activity_block WHERE chain_id=$1
        AND ($2::numeric IS NULL OR block_number>$2::numeric)`,
        [this.chainId, retained?.number ?? null]
      );
      await db.query(
        "UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp() WHERE kind='activity' AND invalidated_at IS NULL"
      );
      await db.query(
        `UPDATE yunipals_market.checkpoint SET block_number=$2::numeric,block_hash=$3,
        coverage_start=CASE WHEN $2::numeric IS NULL THEN NULL ELSE coverage_start END,
        coverage_start_time=CASE WHEN $2::numeric IS NULL THEN NULL ELSE coverage_start_time END,
        replay_from=NULL,canonical_generation=canonical_generation+1,state='syncing',
        last_error_code='canonical_replay_required',checked_at=clock_timestamp(),progress_at=clock_timestamp()
        WHERE source='chain' AND chain_id=$1 AND name='seaport-sales'`,
        [this.chainId, retained?.number ?? null, retained?.hash ?? null]
      );
      await this.saveCursor(db, cursor);
    });
  }
  async tick(): Promise<
    "advanced" | "idle" | "rewound" | "superseded" | "unavailable"
  > {
    const observed = await this.observation();
    if (!observed || observed.reader_mode !== "unified") return "superseded";
    if (
      observed.start_block !== this.config.startBlock ||
      observed.confirmations !== this.config.confirmations ||
      observed.policy !== this.config.policy ||
      observed.release_id !== this.reader.release.id ||
      observed.source_id !== this.registration.definition.sourceId ||
      observed.configuration_hash !== this.registration.configurationHash ||
      manifestDigest(observed.confirmation_policy) !==
        manifestDigest(this.config.confirmationPolicy)
    )
      throw new Error(
        "Shared sale registration differs from the reviewed worker configuration."
      );
    try {
      if (
        !observed.cursor ||
        observed.replay_from !== null ||
        (observed.coverage_start !== null &&
          observed.coverage_start !== this.config.startBlock)
      )
        return (await this.reset(observed)) ? "rewound" : "superseded";
      let limit = this.pageSize;
      let page: SharedMarketPage;
      let proofs: ReturnType<typeof decodeSharedCollectionSales>;
      for (;;) {
        page = await readMarketplacePage(
          this.reader,
          this.registration.definition,
          this.config.confirmationPolicy,
          observed.cursor,
          { limit, verifyOldAnchor: this.verifyOldAnchor }
        );
        try {
          proofs = decodeSharedCollectionSales(this.config.chain, page);
          break;
        } catch (error) {
          if (!(error instanceof SalePageCapacityError) || limit === 1)
            throw error;
          limit = Math.max(1, Math.floor(limit / 2));
        }
      }
      await this.validate(page.cursor);
      const startTime =
        observed.coverage_start === null && page.complete
          ? (
              await this.client.getBlock({
                blockNumber: BigInt(this.config.startBlock)
              })
            ).timestamp.toString()
          : null;
      const completed = page.complete ? page.cursor.completed : null;
      const idle =
        manifestDigest(page.cursor) === manifestDigest(observed.cursor);
      const committed = await this.commit(observed, async (db) => {
        const receipts = new Set<string>();
        for (const proof of proofs) {
          const key = `${proof.blockHash}:${proof.transactionHash}`;
          if (!receipts.has(key)) {
            const evidence = page.receipts.find(
              (row) =>
                row.block_hash === proof.blockHash &&
                row.transaction_hash === proof.transactionHash
            )!;
            const event = page.events.find(
              (event) =>
                event.blockHash === proof.blockHash &&
                event.transactionHash === proof.transactionHash
            )!;
            await qualifySharedCollectionReceipt(
              db,
              this.chainId,
              proof,
              observed.policy,
              {
                consumer: this.registration.consumer,
                releaseId: this.reader.release.id,
                sourceId: this.registration.definition.sourceId,
                eventId: event.id,
                payloadHash: evidence.payload_hash
              }
            );
            receipts.add(key);
          }
          await storeCollectionSale(db, this.chainId, proof);
          if (proof.sale)
            await wakeSaleOrderProjection(db, this.chainId, proof.sale);
        }
        await this.saveCursor(db, page.cursor);
        if (completed) {
          await db.query(
            `INSERT INTO yunipals_market.activity_block(chain_id,block_number,block_hash)
            VALUES($1,$2,$3) ON CONFLICT(chain_id,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash`,
            [this.chainId, completed.number, completed.hash]
          );
          await db.query(
            `DELETE FROM yunipals_market.activity_block WHERE chain_id=$1 AND block_number<
            (SELECT block_number FROM yunipals_market.activity_block WHERE chain_id=$1 ORDER BY block_number DESC OFFSET 127 LIMIT 1)`,
            [this.chainId]
          );
        }
        await db.query(
          `UPDATE yunipals_market.checkpoint SET block_number=coalesce($2::numeric,block_number),
          block_hash=coalesce($3,block_hash),coverage_start=coalesce(coverage_start,CASE WHEN $2::numeric IS NOT NULL THEN $4::numeric END),
          coverage_start_time=coalesce(coverage_start_time,$5::numeric),replay_from=NULL,
          state=CASE WHEN $6 THEN 'unavailable' WHEN EXISTS(SELECT 1 FROM yunipals_market.sale_exclusion WHERE chain_id=$1 AND canonical) THEN 'unavailable'
            WHEN $7 THEN 'available' ELSE 'syncing' END,
          last_error_code=CASE WHEN $6 THEN 'shared_receipt_pending'
            WHEN EXISTS(SELECT 1 FROM yunipals_market.sale_exclusion WHERE chain_id=$1 AND canonical) THEN 'unsupported_sale_events' ELSE NULL END,
          checked_at=clock_timestamp(),progress_at=CASE WHEN $2::numeric IS NULL THEN progress_at ELSE clock_timestamp() END
          WHERE source='chain' AND chain_id=$1 AND name='seaport-sales'`,
          [
            this.chainId,
            completed?.number ?? null,
            completed?.hash ?? null,
            this.config.startBlock,
            startTime,
            page.waitingReceipt,
            page.complete &&
              page.status.readiness.ready &&
              completed?.number === page.status.anchor?.number
          ]
        );
      });
      return !committed
        ? "superseded"
        : page.waitingReceipt
          ? "unavailable"
          : idle
            ? "idle"
            : "advanced";
    } catch (error) {
      if (rpcComputeBudgetError(error)) throw error;
      if (error instanceof CanonicalCursorInvalidated) {
        try {
          return (await this.reset(observed)) ? "rewound" : "superseded";
        } catch (resetError) {
          if (rpcComputeBudgetError(resetError)) throw resetError;
        }
      }
      await this.commit(observed, async (db) => {
        await db.query(
          `UPDATE yunipals_market.checkpoint SET state='unavailable',last_error_code='shared_sale_source_unavailable',
          checked_at=clock_timestamp() WHERE source='chain' AND chain_id=$1 AND name='seaport-sales'`,
          [this.chainId]
        );
      });
      return "unavailable";
    }
  }
}
