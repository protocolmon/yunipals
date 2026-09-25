import type { Pool, PoolClient } from "pg";
import { keccak256, type Hex, type PublicClient } from "viem";
import { parseMarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import {
  observeMarketSale,
  type ObservedMarketSale,
  type SaleBlock
} from "@protopals/yunipals-market-core/settledSale";

import { readBnbHead, seaportCodeHash } from "@/bnb/protocol";
import { transaction } from "@/db/pool";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

const protocol = seaportDeployment.address.toLowerCase();
const checkpointWhere = "source='chain' AND chain_id=56 AND name='bnb-sales'";
const event = seaportEventAbi.find((item) => item.name === "OrderFulfilled")!;
const depth = 20n;
// BNB production RPC is intentionally dispatched at about one request per
// second. Wider ranges reduce fixed head/canonical checks while the log-count
// bound below still shrinks dense ranges before retaining any receipt proof.
const batchBlocks = 256n;
const maxLogs = 512;
const maxReceipts = 32;
// The initial timestamp-to-block search requires about log2(chain height)
// sequential reads. Keep it bounded, but allow that search to finish through
// the cost-capped production proxy.
const budgetMs = 60000;

type Checkpoint = {
  generation: string;
  block_number: string | null;
  block_hash: Hex | null;
  coverage_start: string | null;
  replay_from: string | null;
  first_admission: string | null;
  first_start_time: string | null;
  missing_admission: boolean;
};
type Proof = { sale: ObservedMarketSale; receipt: string; block: string };
const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item
  );
function boundedJson(value: unknown, bytes: number) {
  const encoded = json(value);
  // PostgreSQL jsonb's rendered form adds whitespace; leave room below its limit.
  if (Buffer.byteLength(encoded) > bytes / 2)
    throw new Error("Sale proof exceeds the retained receipt limit.");
  return encoded;
}

/**
 * Bounded replay of our admitted BNB orders. Validation defaults to depth 20;
 * production explicitly uses the provider's finalized tag and records a distinct
 * confirmation policy. Every mutation is generation-fenced. No database
 * transaction or advisory lock is held during RPC work.
 */
export class BnbSaleReplay {
  private readonly finality: "confirmations" | "finalized";
  private readonly confirmationPolicy: string;
  private runtimeVerifiedAt = 0;
  private cursorVerifiedAt = 0;

  constructor(
    private readonly pool: Pool,
    private readonly client: PublicClient,
    private readonly now: () => number = Date.now,
    options: {
      finality?: "confirmations" | "finalized";
      confirmationPolicy?: string;
    } = {}
  ) {
    this.finality = options.finality ?? "confirmations";
    this.confirmationPolicy =
      options.confirmationPolicy ?? "bnb-local-validation-depth-20-v1";
    if (
      (this.finality !== "confirmations" && this.finality !== "finalized") ||
      !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(this.confirmationPolicy)
    )
      throw new Error("Invalid BNB sale confirmation policy.");
  }

  private confirmed(head: Awaited<ReturnType<typeof readBnbHead>>) {
    if (this.finality === "finalized") {
      if (head.finalizedNumber === undefined)
        throw new Error("BNB finalized head is unavailable.");
      return head.finalizedNumber;
    }
    if (head.number < depth)
      throw new Error("Insufficient confirmation depth.");
    return head.number - depth;
  }

  private async checkpoint(): Promise<Checkpoint> {
    const result = await this.pool.query<Checkpoint>(
      `SELECT generation::text,block_number::text,block_hash,coverage_start::text,replay_from::text,
        (SELECT min(admission_block_number)::text FROM yunipals_market.orders
          WHERE chain_id=56 AND source='yunipals' AND publication_state='accepted') AS first_admission,
        (SELECT min(start_time)::text FROM yunipals_market.orders WHERE chain_id=56 AND source='yunipals'
          AND publication_state='accepted' AND admission_block_number IS NOT NULL) AS first_start_time,
        EXISTS(SELECT 1 FROM yunipals_market.orders WHERE chain_id=56 AND source='yunipals'
          AND publication_state='accepted' AND admission_block_number IS NULL) AS missing_admission
      FROM yunipals_market.checkpoint WHERE ${checkpointWhere}`
    );
    if (!result.rows[0]) throw new Error("Missing BNB activity checkpoint.");
    return result.rows[0];
  }

  private async commit(
    observed: Checkpoint,
    task: (db: PoolClient) => Promise<void>
  ) {
    return transaction(this.pool, async (db) => {
      const locked = await db.query(
        `SELECT generation FROM yunipals_market.checkpoint WHERE ${checkpointWhere}
          AND generation=$1 FOR UPDATE`,
        [observed.generation]
      );
      if (locked.rowCount !== 1) return false;
      await task(db);
      await db.query(
        `UPDATE yunipals_market.checkpoint SET generation=generation+1 WHERE ${checkpointWhere}`
      );
      return true;
    });
  }

  private async status(observed: Checkpoint, code: string) {
    return this.commit(observed, async (db) => {
      await db.query(
        `UPDATE yunipals_market.checkpoint SET state='unavailable',checked_at=clock_timestamp(),
          last_error_code=$1 WHERE ${checkpointWhere}`,
        [code]
      );
    });
  }

  private async canonical(number: bigint): Promise<SaleBlock> {
    const block = await this.client.getBlock({ blockNumber: number });
    if (!block.hash || block.number !== number || block.timestamp < 0n)
      throw new Error("Canonical sale block unavailable.");
    return { number, hash: block.hash, timestamp: block.timestamp };
  }

  private async firstPossibleSale(
    startTime: bigint,
    head: bigint,
    started: number
  ) {
    // BNB block timestamps are nondecreasing. Find the first possible settlement
    // block on this branch, including equal timestamps, with a bounded search.
    let left = 0n;
    let right = head + 1n;
    let reads = 0;
    while (left < right) {
      if (++reads > 64 || this.now() - started > budgetMs)
        throw new Error("Sale coverage search exceeded its budget.");
      const mid = (left + right) / 2n;
      const block = await this.canonical(mid);
      if (block.timestamp < startTime) left = mid + 1n;
      else right = mid;
    }
    return left;
  }

  private async rewind(observed: Checkpoint, before: bigint, started: number) {
    const anchors = await this.pool.query<{
      block_number: string;
      block_hash: Hex;
    }>(
      `SELECT block_number::text,block_hash FROM yunipals_market.activity_block
        WHERE chain_id=56 AND block_number<$1::numeric ORDER BY activity_block.block_number DESC LIMIT 128`,
      [before.toString()]
    );
    let retained: SaleBlock | undefined;
    for (const anchor of anchors.rows) {
      if (this.now() - started > budgetMs)
        throw new Error("Replay budget elapsed.");
      const block = await this.canonical(BigInt(anchor.block_number));
      if (block.hash.toLowerCase() === anchor.block_hash) {
        retained = block;
        break;
      }
    }
    if (
      retained &&
      (await this.canonical(retained.number)).hash !== retained.hash
    )
      throw new Error("Reorg changed during rewind.");
    return this.commit(observed, async (db) => {
      await db.query(
        `UPDATE yunipals_market.sale SET canonical=false WHERE chain_id=56 AND canonical
          AND ($1::numeric IS NULL OR block_number>$1::numeric)`,
        [retained?.number.toString() ?? null]
      );
      await db.query(
        `DELETE FROM yunipals_market.activity_block WHERE chain_id=56
          AND ($1::numeric IS NULL OR block_number>$1::numeric)`,
        [retained?.number.toString() ?? null]
      );
      // A page may include a now-orphaned record or a superseded count/checkpoint.
      await db.query(
        `UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp()
          WHERE kind='activity' AND invalidated_at IS NULL`
      );
      await db.query(
        `UPDATE yunipals_market.checkpoint SET block_number=$1::numeric,block_hash=$2,
          coverage_start=CASE WHEN $1::numeric IS NULL THEN NULL ELSE LEAST(coverage_start,$1::numeric) END,
          coverage_start_time=CASE WHEN $1::numeric IS NULL THEN NULL ELSE coverage_start_time END,
          replay_from=CASE WHEN $1::numeric IS NULL THEN LEAST(coverage_start,replay_from,$3::numeric)
            ELSE NULL END,
          canonical_generation=canonical_generation+1,
          state='syncing',last_error_code='canonical_replay_required',checked_at=clock_timestamp(),
          progress_at=clock_timestamp() WHERE ${checkpointWhere}`,
        [
          retained?.number.toString() ?? null,
          retained?.hash.toLowerCase() ?? null,
          observed.first_admission
        ]
      );
    });
  }

  async tick(): Promise<
    "advanced" | "idle" | "rewound" | "superseded" | "unavailable"
  > {
    const observed = await this.checkpoint();
    const started = this.now();
    try {
      const head = await readBnbHead(this.client, this.now, this.finality);
      const confirmed = this.confirmed(head);
      const cursor =
        observed.block_number === null ? null : BigInt(observed.block_number);
      const requested =
        observed.replay_from === null ? null : BigInt(observed.replay_from);
      const verifyRuntime = async () => {
        const code = await this.client.getCode({
          address: seaportDeployment.address,
          blockNumber: head.number
        });
        if (!code || keccak256(code) !== seaportCodeHash)
          throw new Error("BNB Seaport deployment mismatch.");
        this.runtimeVerifiedAt = started;
      };
      if (
        observed.first_start_time !== null &&
        cursor !== null &&
        cursor === confirmed &&
        requested === null
      ) {
        if (started - this.runtimeVerifiedAt >= 6 * 60 * 60 * 1000)
          await verifyRuntime();
        if (started - this.cursorVerifiedAt >= 15 * 60 * 1000) {
          if (
            (await this.canonical(cursor)).hash.toLowerCase() !==
            observed.block_hash
          )
            return (await this.rewind(observed, cursor, started))
              ? "rewound"
              : "superseded";
          this.cursorVerifiedAt = started;
        }
        const updated = await this.commit(observed, async (db) => {
          await db.query(
            `UPDATE yunipals_market.checkpoint SET state=$1,last_error_code=$2,checked_at=clock_timestamp()
              WHERE ${checkpointWhere}`,
            [
              observed.missing_admission ? "unavailable" : "available",
              observed.missing_admission ? "admission_coverage_missing" : null
            ]
          );
        });
        return updated ? "idle" : "superseded";
      }
      if (started - this.runtimeVerifiedAt >= 6 * 60 * 60 * 1000)
        await verifyRuntime();
      if (cursor !== null) {
        const changed =
          cursor > confirmed ||
          (await this.canonical(cursor)).hash.toLowerCase() !==
            observed.block_hash;
        if (changed || (requested !== null && requested <= cursor)) {
          const before =
            requested !== null && requested <= cursor ? requested : cursor;
          const limit = before > confirmed + 1n ? confirmed + 1n : before;
          return (await this.rewind(observed, limit, started))
            ? "rewound"
            : "superseded";
        }
      }
      const first = observed.first_start_time;
      if (first === null) {
        await this.status(observed, "admission_coverage_missing");
        return "unavailable";
      }
      const from =
        cursor === null
          ? await this.firstPossibleSale(BigInt(first), confirmed, started)
          : cursor + 1n;
      if (from > confirmed) {
        if (
          (await this.canonical(head.number)).hash !== head.hash ||
          this.now() - started > budgetMs
        )
          throw new Error("Idle sale observation changed or expired.");
        const updated = await this.commit(observed, async (db) => {
          await db.query(
            `UPDATE yunipals_market.checkpoint SET state=$1,last_error_code=$2,checked_at=clock_timestamp()
              WHERE ${checkpointWhere}`,
            [
              observed.missing_admission
                ? "unavailable"
                : cursor === null
                  ? "syncing"
                  : "available",
              observed.missing_admission ? "admission_coverage_missing" : null
            ]
          );
        });
        return updated ? "idle" : "superseded";
      }
      let to =
        from + batchBlocks - 1n < confirmed
          ? from + batchBlocks - 1n
          : confirmed;
      let logs;
      for (;;) {
        logs = await this.client.getLogs({
          address: seaportDeployment.address,
          event,
          fromBlock: from,
          toBlock: to,
          strict: true
        });
        if (logs.length <= maxLogs) break;
        if (to === from)
          throw new Error("Single sale block exceeds bounded log capacity.");
        to = from + (to - from) / 2n;
      }
      const end = await this.canonical(to);
      const known = await this.pool.query<{
        order_hash: Hex;
        summary: unknown;
        components: unknown;
        admission_block_number: string | null;
      }>(
        `SELECT order_hash,summary,components,admission_block_number::text FROM yunipals_market.orders
          WHERE chain_id=56 AND protocol_address=$1 AND source='yunipals' AND publication_state='accepted'
            AND order_hash=ANY($2::text[])`,
        [protocol, logs.map((log) => log.args.orderHash.toLowerCase())]
      );
      const byHash = new Map(known.rows.map((row) => [row.order_hash, row]));
      const selected = logs.filter((log) =>
        byHash.has(log.args.orderHash.toLowerCase() as Hex)
      );
      if (
        new Set(selected.map((log) => `${log.blockHash}:${log.logIndex}`))
          .size !== selected.length
      )
        throw new Error("Duplicate sale event in RPC response.");
      if (
        new Set(selected.map((log) => log.transactionHash)).size > maxReceipts
      )
        throw new Error("Sale range exceeds bounded receipt capacity.");
      const proofs: Proof[] = [];
      const receipts = new Map<
        Hex,
        Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>
      >();
      const blocks = new Map<bigint, SaleBlock>();
      for (const log of selected) {
        if (this.now() - started > budgetMs)
          throw new Error("Replay budget elapsed.");
        if (
          log.removed ||
          log.blockNumber < from ||
          log.blockNumber > to ||
          log.address.toLowerCase() !== protocol
        )
          throw new Error("Invalid sale log range.");
        let receipt = receipts.get(log.transactionHash);
        if (!receipt) {
          receipt = await this.client.getTransactionReceipt({
            hash: log.transactionHash
          });
          receipts.set(log.transactionHash, receipt);
        }
        let block = blocks.get(log.blockNumber);
        if (!block) {
          block = await this.canonical(log.blockNumber);
          blocks.set(log.blockNumber, block);
          const historicalCode = await this.client.getCode({
            address: seaportDeployment.address,
            blockNumber: block.number
          });
          if (!historicalCode || keccak256(historicalCode) !== seaportCodeHash)
            throw new Error("Historical Seaport deployment mismatch.");
        }
        const row = byHash.get(log.args.orderHash.toLowerCase() as Hex)!;
        const order = parseMarketOrder(row.summary);
        if (
          order.asset.chainId !== 56 ||
          order.source !== "yunipals" ||
          order.orderHash.toLowerCase() !== row.order_hash ||
          seaportOrderHash(decodeSeaportOrder(row.components)).toLowerCase() !==
            row.order_hash
        )
          throw new Error("Stored sale order provenance mismatch.");
        const sale = observeMarketSale(order, receipt, block);
        if (
          sale.fulfillmentLogIndex !== log.logIndex ||
          sale.blockHash.toLowerCase() !== log.blockHash.toLowerCase() ||
          sale.transactionHash.toLowerCase() !==
            log.transactionHash.toLowerCase()
        )
          throw new Error("Receipt differs from the scanned event.");
        proofs.push({
          sale,
          receipt: boundedJson(receipt, 2097152),
          block: boundedJson(block, 8192)
        });
      }
      const latest = await readBnbHead(this.client, this.now, this.finality);
      const latestConfirmed = this.confirmed(latest);
      // A fast chain can advance while this bounded scan is running. Completing
      // the finalized boundary captured at the start is still a complete,
      // canonical snapshot through `to`; chasing the later observation here
      // would keep production in a tight paid-log polling loop forever.
      const caughtUp = to === confirmed;
      if (
        latestConfirmed < to ||
        (await this.canonical(head.number)).hash !== head.hash ||
        (await this.canonical(to)).hash !== end.hash ||
        (cursor !== null &&
          (await this.canonical(cursor)).hash.toLowerCase() !==
            observed.block_hash) ||
        this.now() - started > budgetMs
      )
        throw new Error("Sale scan observation changed or expired.");
      const committed = await this.commit(observed, async (db) => {
        if (this.now() - started > budgetMs)
          throw new Error("Sale commit observation expired.");
        for (const proof of proofs) await this.store(db, proof);
        if (this.now() - started > budgetMs)
          throw new Error("Sale commit observation expired.");
        await db.query(
          `INSERT INTO yunipals_market.activity_block(chain_id,block_number,block_hash) VALUES (56,$1,$2)
            ON CONFLICT(chain_id,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash`,
          [to.toString(), end.hash.toLowerCase()]
        );
        await db.query(
          `DELETE FROM yunipals_market.activity_block WHERE chain_id=56 AND block_number<
            (SELECT block_number FROM yunipals_market.activity_block WHERE chain_id=56 ORDER BY block_number DESC OFFSET 127 LIMIT 1)`
        );
        await db.query(
          `UPDATE yunipals_market.checkpoint SET block_number=$1,block_hash=$2,
            coverage_start=coalesce(coverage_start,$3::numeric),coverage_start_time=coalesce(coverage_start_time,$6::numeric),replay_from=NULL,
            state=$4,last_error_code=$5,checked_at=clock_timestamp(),progress_at=clock_timestamp()
            WHERE ${checkpointWhere}`,
          [
            to.toString(),
            end.hash.toLowerCase(),
            from.toString(),
            observed.missing_admission
              ? "unavailable"
              : caughtUp
                ? "available"
                : "syncing",
            observed.missing_admission ? "admission_coverage_missing" : null,
            first
          ]
        );
      });
      if (committed) this.cursorVerifiedAt = started;
      return committed
        ? caughtUp && this.finality === "finalized"
          ? "idle"
          : "advanced"
        : "superseded";
    } catch (error) {
      if (rpcComputeBudgetError(error)) throw error;
      // Retain previous proofs/cursor on RPC or verification failure. A reorg is
      // retracted only after establishing a canonical rewind point, never guessed.
      await this.status(observed, "sale_replay_failed");
      return "unavailable";
    }
  }

  private async store(db: PoolClient, proof: Proof) {
    const { sale } = proof;
    const receipt = await db.query(
      `INSERT INTO yunipals_market.sale_receipt(chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy)
        VALUES(56,$1,$2,$3,$4,$5) ON CONFLICT(chain_id,block_hash,transaction_hash) DO UPDATE
          SET receipt=yunipals_market.sale_receipt.receipt
          WHERE yunipals_market.sale_receipt.receipt=EXCLUDED.receipt
            AND yunipals_market.sale_receipt.block=EXCLUDED.block
            AND yunipals_market.sale_receipt.confirmation_policy=EXCLUDED.confirmation_policy RETURNING chain_id`,
      [
        sale.blockHash.toLowerCase(),
        sale.transactionHash.toLowerCase(),
        proof.receipt,
        proof.block,
        this.confirmationPolicy
      ]
    );
    if (receipt.rowCount !== 1)
      throw new Error("Stored receipt proof conflicts with replay.");
    const stored = await db.query(
      `INSERT INTO yunipals_market.sale(chain_id,block_number,block_hash,log_index,transaction_hash,protocol_address,
        order_hash,contract_address,token_id,seller,nft_recipient,observation,canonical,block_timestamp)
        VALUES(56,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,to_timestamp($12))
        ON CONFLICT(chain_id,block_hash,log_index) DO UPDATE SET canonical=true
          WHERE yunipals_market.sale.observation=EXCLUDED.observation RETURNING chain_id`,
      [
        sale.blockNumber,
        sale.blockHash.toLowerCase(),
        sale.fulfillmentLogIndex,
        sale.transactionHash.toLowerCase(),
        protocol,
        sale.orderHash.toLowerCase(),
        sale.asset.contractAddress.toLowerCase(),
        sale.asset.tokenId,
        sale.seller.toLowerCase(),
        sale.nftRecipient.toLowerCase(),
        json(sale),
        sale.blockTimestamp
      ]
    );
    if (stored.rowCount !== 1)
      throw new Error("Stored sale proof conflicts with replay.");
  }
}
