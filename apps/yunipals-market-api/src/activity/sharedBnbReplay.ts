import type { Pool, PoolClient } from "pg";
import type { PublicClient } from "viem";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
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
  wakeReorgedSaleOrders
} from "./collectionSaleProjection";
import {
  decodeSharedBnbSaleProofs,
  sharedBnbReceiptCandidates,
  SharedBnbSalePageCapacityError,
  type SharedBnbAdmittedOrder
} from "./sharedBnbReplayProof";
import type { SharedMarketPage } from "./sharedCollectionSales";

type Cursor = SharedMarketPage["cursor"];
type Anchor = NonNullable<Cursor["completed"]>;
type Policy = Parameters<IndexerReader["status"]>[1];
export type SharedBnbSaleConfiguration = {
  confirmationPolicy: Policy;
  policy: string;
};

export function sharedBnbSaleRuntimeConfiguration(
  deployment: "staging" | "production"
): SharedBnbSaleConfiguration {
  return deployment === "production"
    ? {
        confirmationPolicy: { kind: "finalized" },
        policy: "bnb-finalized-tag-v1"
      }
    : {
        confirmationPolicy: { kind: "depth", subsequentBlocks: 20 },
        policy: "bnb-local-validation-depth-20-v1"
      };
}

const where = "source='chain' AND chain_id=56 AND name='bnb-sales'";
const consumer = "bnb-sales";
const protocol = seaportDeployment.address.toLowerCase();

export function sharedBnbSaleConfiguration(
  reader: Pick<IndexerReader, "release">,
  config: SharedBnbSaleConfiguration
) {
  const definition: MarketplaceReadDefinition = {
    sourceId: "ownership:bnb",
    chainId: 56,
    address: marketplaceChains.bnb.contractAddress.toLowerCase(),
    abiHash: manifestDigest(collectionAbi),
    feature: "ownership"
  };
  const source = reader.release.manifest.sources.find(
    (row) => row.id === definition.sourceId
  );
  if (
    !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(config.policy) ||
    !source?.enabled ||
    source.address !== definition.address ||
    source.chainId !== 56 ||
    source.feature !== "ownership" ||
    source.abiHash !== definition.abiHash ||
    source.receiptRequirement !== "full" ||
    source.startBlock === null ||
    source.endBlock !== null ||
    !source.events.includes("Transfer") ||
    !source.policies.some(
      (policy) =>
        manifestDigest(policy) === manifestDigest(config.confirmationPolicy)
    ) ||
    (config.confirmationPolicy.kind !== "finalized" &&
      (config.confirmationPolicy.kind !== "depth" ||
        config.confirmationPolicy.subsequentBlocks !== 20))
  )
    throw new CanonicalSourceUnavailable(
      "BNB sale source, history or confirmation policy requires review."
    );
  return {
    consumer,
    definition,
    startBlock: source.startBlock,
    receiptStartBlock: source.receiptStartBlock,
    configurationHash: manifestDigest({
      version: 1,
      decoder: "admitted-bnb-sales-v1",
      history: "earliest-accepted-start-and-admission-v1",
      consumer,
      definition,
      sourceStartBlock: source.startBlock,
      ...(source.receiptStartBlock === undefined
        ? {}
        : { receiptStartBlock: source.receiptStartBlock }),
      ...config
    })
  };
}

type Observation = {
  reader_mode: string;
  generation: string;
  block_number: string | null;
  block_hash: string | null;
  coverage_start: string | null;
  coverage_start_time: string | null;
  replay_from: string | null;
  first_admission: string | null;
  first_start_time: string | null;
  missing_admission: boolean;
  consumer_generation: string;
  release_id: string;
  source_id: string;
  configuration_hash: string;
  confirmation_policy: Policy;
  cursor: Cursor | null;
};

/** Replays only accepted Yunipals order settlements from shared collection
 * transfers and complete receipts. Admission writes fence every commit. */
export class SharedBnbSaleReplay {
  private readonly registration;
  constructor(
    private readonly pool: Pool,
    private readonly reader: IndexerReader,
    private readonly client: PublicClient,
    private readonly config: SharedBnbSaleConfiguration,
    private readonly pageSize = 250,
    private readonly now: () => number = Date.now
  ) {
    this.registration = sharedBnbSaleConfiguration(reader, config);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000)
      throw new Error("Invalid shared BNB sale page size.");
  }
  private async observation() {
    return (
      await this.pool.query<Observation>(
        `SELECT c.reader_mode,c.generation::text,c.block_number::text,c.block_hash,
       c.coverage_start::text,c.coverage_start_time::text,c.replay_from::text,
       (SELECT min(admission_block_number)::text FROM yunipals_market.orders
        WHERE chain_id=56 AND source='yunipals' AND publication_state='accepted') AS first_admission,
       (SELECT min(start_time)::text FROM yunipals_market.orders WHERE chain_id=56 AND source='yunipals'
        AND publication_state='accepted' AND admission_block_number IS NOT NULL) AS first_start_time,
       EXISTS(SELECT 1 FROM yunipals_market.orders WHERE chain_id=56 AND source='yunipals'
        AND publication_state='accepted' AND admission_block_number IS NULL) AS missing_admission,
       i.generation::text AS consumer_generation,i.release_id,i.source_id,i.configuration_hash,
       i.confirmation_policy,i.cursor
       FROM yunipals_market.checkpoint c LEFT JOIN yunipals_market.shared_indexer_consumer i ON i.consumer=$1
       WHERE c.source='chain' AND c.chain_id=56 AND c.name='bnb-sales'`,
        [consumer]
      )
    ).rows[0];
  }
  private async commit(
    observed: Observation,
    task: (db: PoolClient) => Promise<void>
  ) {
    return transaction(this.pool, async (db) => {
      const locked = await db.query(
        `SELECT 1 FROM yunipals_market.checkpoint c JOIN yunipals_market.shared_indexer_consumer i ON i.consumer=$1
         WHERE c.source='chain' AND c.chain_id=56 AND c.name='bnb-sales' AND c.reader_mode='unified'
          AND c.generation=$2::bigint AND i.generation=$3::bigint AND i.chain_id=56
          AND i.release_id=$4 AND i.source_id=$5 AND i.configuration_hash=$6
         FOR UPDATE OF c,i`,
        [
          consumer,
          observed.generation,
          observed.consumer_generation,
          this.reader.release.id,
          this.registration.definition.sourceId,
          this.registration.configurationHash
        ]
      );
      if (locked.rowCount !== 1) return false;
      await task(db);
      await db.query(
        `UPDATE yunipals_market.checkpoint SET generation=generation+1 WHERE ${where}`
      );
      return true;
    });
  }
  private async unavailable(observed: Observation, code: string) {
    await this.commit(observed, async (db) => {
      await db.query(
        `UPDATE yunipals_market.checkpoint SET state='unavailable',last_error_code=$1,
        checked_at=clock_timestamp() WHERE ${where}`,
        [code]
      );
    });
  }
  private verifyOldAnchor = async (anchor: Anchor, chainId: number) => {
    if (chainId !== 56) return false;
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
    const page = await readMarketplacePage(
      this.reader,
      this.registration.definition,
      this.config.confirmationPolicy,
      cursor,
      { limit: 1, verifyOldAnchor: this.verifyOldAnchor }
    );
    if (
      cursor.completed &&
      BigInt(cursor.completed.number) > BigInt(page.status.anchor!.number)
    )
      throw new CanonicalSourceUnavailable(
        "Shared BNB sales are recovering previously applied coverage."
      );
    return page.status;
  }
  private async saveCursor(db: PoolClient, cursor: Cursor) {
    await db.query(
      `UPDATE yunipals_market.shared_indexer_consumer SET cursor=$2::jsonb,
      generation=generation+1,updated_at=clock_timestamp() WHERE consumer=$1`,
      [consumer, JSON.stringify(cursor)]
    );
  }
  private async firstPossibleSale(
    startTime: bigint,
    head: bigint,
    started: number
  ) {
    let low = BigInt(this.registration.startBlock),
      high = head + 1n,
      reads = 0;
    while (low < high) {
      if (++reads > 64 || this.now() - started > 60000)
        throw new Error("Shared BNB sale coverage search exceeded its budget.");
      const middle = (low + high) / 2n;
      const block = await this.client.getBlock({ blockNumber: middle });
      if (!block.hash || block.number !== middle || block.timestamp < 0n)
        throw new Error("Shared BNB sale history point unavailable.");
      if (block.timestamp < startTime) low = middle + 1n;
      else high = middle;
    }
    return low;
  }
  private async reset(observed: Observation, started: number) {
    if (
      observed.first_start_time === null ||
      observed.first_admission === null
    ) {
      await this.unavailable(observed, "admission_coverage_missing");
      return "unavailable" as const;
    }
    const status = await this.reader.status(
      this.registration.definition.sourceId,
      this.config.confirmationPolicy
    );
    if (
      !status.anchor ||
      !["ready", "catching_up"].includes(status.readiness.reason)
    )
      throw new CanonicalSourceUnavailable(
        "Shared BNB sale history source is unavailable."
      );
    const signedTime = BigInt(observed.first_start_time);
    const signedBoundary = await this.firstPossibleSale(
      signedTime,
      BigInt(status.anchor.number),
      started
    );
    const admissionBoundary = BigInt(observed.first_admission);
    const earliest =
      signedBoundary < admissionBoundary ? signedBoundary : admissionBoundary;
    if (
      this.registration.receiptStartBlock !== undefined &&
      earliest < BigInt(this.registration.receiptStartBlock)
    )
      throw new CanonicalSourceUnavailable(
        "Required BNB sale history predates the registered receipt history floor."
      );
    const start =
      earliest < BigInt(this.registration.startBlock)
        ? BigInt(this.registration.startBlock)
        : earliest;
    let retained: Anchor | null = null;
    const requiresEarlierHistory =
      observed.coverage_start_time === null ||
      signedTime < BigInt(observed.coverage_start_time);
    if (
      observed.cursor &&
      !requiresEarlierHistory &&
      observed.replay_from !== "0"
    ) {
      const before =
        observed.replay_from ??
        observed.cursor.after?.blockNumber ??
        observed.cursor.completed?.number ??
        observed.block_number;
      const rows = await this.pool.query<{
        block_number: string;
        block_hash: string;
      }>(
        `SELECT block_number::text,block_hash FROM yunipals_market.activity_block WHERE chain_id=56
         AND block_number>=$1::numeric AND ($2::numeric IS NULL OR block_number<$2::numeric)
         ORDER BY activity_block.block_number DESC LIMIT 128`,
        [start.toString(), before]
      );
      for (const row of rows.rows) {
        if (this.now() - started > 60000)
          throw new Error("Shared BNB sale rewind exceeded its budget.");
        const anchor = { number: row.block_number, hash: row.block_hash };
        if (
          BigInt(anchor.number) <= BigInt(status.anchor.number) &&
          (await this.verifyOldAnchor(anchor, 56))
        ) {
          retained = anchor;
          break;
        }
      }
    }
    let anchor = retained;
    if (!anchor && start > 0n) {
      const prior = await this.client.getBlock({ blockNumber: start - 1n });
      if (!prior.hash || prior.number !== start - 1n)
        throw new Error("Shared BNB sale predecessor is unavailable.");
      anchor = {
        number: prior.number.toString(),
        hash: prior.hash.toLowerCase()
      };
    }
    const cursor = this.cursor(anchor);
    await this.validate(cursor);
    const committed = await this.commit(observed, async (db) => {
      await wakeReorgedSaleOrders(
        db,
        56,
        retained ? BigInt(retained.number) : null
      );
      await db.query(
        `UPDATE yunipals_market.sale SET canonical=false WHERE chain_id=56 AND canonical
        AND ($1::numeric IS NULL OR block_number>$1::numeric)`,
        [retained?.number ?? null]
      );
      await db.query(
        `DELETE FROM yunipals_market.activity_block WHERE chain_id=56
        AND ($1::numeric IS NULL OR block_number>$1::numeric)`,
        [retained?.number ?? null]
      );
      await db.query(
        "UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp() WHERE kind='activity' AND invalidated_at IS NULL"
      );
      await this.saveCursor(db, cursor);
      await db.query(
        `UPDATE yunipals_market.checkpoint SET block_number=$1::numeric,block_hash=$2,
        coverage_start=CASE WHEN $1::numeric IS NULL THEN NULL ELSE coverage_start END,
        coverage_start_time=CASE WHEN $1::numeric IS NULL THEN NULL ELSE coverage_start_time END,
        replay_from=NULL,canonical_generation=canonical_generation+1,state='syncing',
        last_error_code='canonical_replay_required',checked_at=clock_timestamp(),progress_at=clock_timestamp()
        WHERE ${where}`,
        [retained?.number ?? null, retained?.hash ?? null]
      );
    });
    return committed ? ("rewound" as const) : ("superseded" as const);
  }
  async tick(): Promise<
    "advanced" | "idle" | "rewound" | "superseded" | "unavailable"
  > {
    const observed = await this.observation();
    if (!observed || observed.reader_mode !== "unified") return "superseded";
    if (
      observed.release_id !== this.reader.release.id ||
      observed.source_id !== this.registration.definition.sourceId ||
      observed.configuration_hash !== this.registration.configurationHash ||
      manifestDigest(observed.confirmation_policy) !==
        manifestDigest(this.config.confirmationPolicy)
    )
      throw new Error(
        "Shared BNB sale registration differs from the reviewed worker configuration."
      );
    const started = this.now();
    try {
      if (
        this.registration.receiptStartBlock !== undefined &&
        ((observed.first_admission !== null &&
          BigInt(observed.first_admission) <
            BigInt(this.registration.receiptStartBlock)) ||
          (observed.coverage_start !== null &&
            BigInt(observed.coverage_start) <
              BigInt(this.registration.receiptStartBlock)))
      )
        throw new CanonicalSourceUnavailable(
          "Required BNB sale history predates the registered receipt history floor."
        );
      if (
        !observed.cursor ||
        observed.replay_from !== null ||
        (observed.first_start_time !== null &&
          observed.coverage_start_time !== null &&
          BigInt(observed.first_start_time) <
            BigInt(observed.coverage_start_time))
      )
        return await this.reset(observed, started);
      if (
        observed.first_start_time === null ||
        observed.first_admission === null
      ) {
        await this.unavailable(observed, "admission_coverage_missing");
        return "unavailable";
      }
      let limit = this.pageSize;
      let page: SharedMarketPage;
      let candidates: ReturnType<typeof sharedBnbReceiptCandidates>;
      let proofs: ReturnType<typeof decodeSharedBnbSaleProofs>;
      for (;;) {
        page = await readMarketplacePage(
          this.reader,
          this.registration.definition,
          this.config.confirmationPolicy,
          observed.cursor,
          { limit, verifyOldAnchor: this.verifyOldAnchor }
        );
        candidates = sharedBnbReceiptCandidates(page);
        const hashes = [
          ...new Set(
            candidates.flatMap((candidate) =>
              candidate.logs.map((log) => log.args.orderHash.toLowerCase())
            )
          )
        ];
        const known = await this.pool.query<SharedBnbAdmittedOrder>(
          `SELECT order_hash,summary,components FROM yunipals_market.orders WHERE chain_id=56
           AND protocol_address=$1 AND source='yunipals' AND publication_state='accepted' AND order_hash=ANY($2::text[])`,
          [protocol, hashes]
        );
        try {
          proofs = decodeSharedBnbSaleProofs(candidates, known.rows);
          break;
        } catch (error) {
          if (!(error instanceof SharedBnbSalePageCapacityError) || limit === 1)
            throw error;
          limit = Math.max(1, Math.floor(limit / 2));
        }
      }
      const status = await this.validate(page.cursor);
      if (this.now() - started > 60000)
        throw new Error("Shared BNB sale observation exceeded its budget.");
      const initialStart = observed.cursor.completed
        ? (BigInt(observed.cursor.completed.number) + 1n).toString()
        : this.registration.startBlock;
      const completed =
        page.complete &&
        page.cursor.completed &&
        BigInt(page.cursor.completed.number) >=
          BigInt(observed.coverage_start ?? initialStart)
          ? page.cursor.completed
          : null;
      const idle =
        manifestDigest(page.cursor) === manifestDigest(observed.cursor);
      const committed = await this.commit(observed, async (db) => {
        const retained = new Set<string>();
        for (const proof of proofs) {
          const key = `${proof.blockHash}:${proof.transactionHash}`;
          if (!retained.has(key)) {
            const candidate = candidates.find(
              (candidate) =>
                candidate.evidence.block_hash === proof.blockHash &&
                candidate.evidence.transaction_hash === proof.transactionHash
            )!;
            await qualifySharedCollectionReceipt(
              db,
              56,
              proof,
              this.config.policy,
              {
                consumer,
                releaseId: this.reader.release.id,
                sourceId: this.registration.definition.sourceId,
                eventId: candidate.event.id,
                payloadHash: candidate.evidence.payload_hash
              }
            );
            retained.add(key);
          }
          await storeCollectionSale(db, 56, proof);
        }
        await this.saveCursor(db, page.cursor);
        if (completed) {
          await db.query(
            `INSERT INTO yunipals_market.activity_block(chain_id,block_number,block_hash) VALUES(56,$1,$2)
            ON CONFLICT(chain_id,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash`,
            [completed.number, completed.hash]
          );
          await db.query(`DELETE FROM yunipals_market.activity_block WHERE chain_id=56 AND block_number<
            (SELECT block_number FROM yunipals_market.activity_block WHERE chain_id=56 ORDER BY block_number DESC OFFSET 127 LIMIT 1)`);
        }
        await db.query(
          `UPDATE yunipals_market.checkpoint SET block_number=coalesce($1::numeric,block_number),
          block_hash=coalesce($2,block_hash),coverage_start=coalesce(coverage_start,CASE WHEN $1::numeric IS NOT NULL THEN $3::numeric END),
          coverage_start_time=coalesce(coverage_start_time,$4::numeric),replay_from=NULL,
          state=CASE WHEN $5 OR $6 THEN 'unavailable' WHEN $7 THEN 'available' ELSE 'syncing' END,
          last_error_code=CASE WHEN $5 THEN 'admission_coverage_missing' WHEN $6 THEN 'shared_receipt_pending' ELSE NULL END,
          checked_at=clock_timestamp(),progress_at=CASE WHEN $1::numeric IS NULL THEN progress_at ELSE clock_timestamp() END
          WHERE ${where}`,
          [
            completed?.number ?? null,
            completed?.hash ?? null,
            initialStart,
            observed.first_start_time,
            observed.missing_admission,
            page.waitingReceipt,
            page.complete &&
              status.readiness.ready &&
              completed?.number === status.anchor?.number
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
          return await this.reset(observed, started);
        } catch (recoveryError) {
          if (rpcComputeBudgetError(recoveryError)) throw recoveryError;
        }
      }
      await this.unavailable(observed, "shared_sale_source_unavailable");
      return "unavailable";
    }
  }
}
